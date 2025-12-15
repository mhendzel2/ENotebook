/**
 * Local Sync Service
 * Handles offline caching and synchronization with the central server
 */

import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

interface SyncConfig {
  serverUrl: string;
  enabled: boolean;
  syncIntervalMs: number;
  userId: string;
  deviceId: string;
}

interface PendingChange {
  id: string;
  entityType: string;
  entityId: string;
  operation: 'create' | 'update' | 'delete';
  data: any;
  timestamp: string;
  synced: boolean;
}

export class LocalSyncService {
  private prisma: PrismaClient;
  private config: SyncConfig;
  private pendingChangesFile: string;
  private syncInterval: NodeJS.Timeout | null = null;
  private isOnline: boolean = false;

  constructor(prisma: PrismaClient, config: Partial<SyncConfig>) {
    this.prisma = prisma;
    this.config = {
      serverUrl: config.serverUrl || process.env.SYNC_SERVER_URL || '',
      enabled: config.enabled ?? true,
      syncIntervalMs: config.syncIntervalMs || 300000, // 5 minutes
      userId: config.userId || 'admin-local',
      deviceId: config.deviceId || this.getOrCreateDeviceId()
    };
    
    const dataDir = path.join(process.cwd(), 'data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    this.pendingChangesFile = path.join(dataDir, 'pending-sync.json');
  }

  private getOrCreateDeviceId(): string {
    const deviceIdFile = path.join(process.cwd(), 'data', 'device-id');
    if (fs.existsSync(deviceIdFile)) {
      return fs.readFileSync(deviceIdFile, 'utf-8').trim();
    }
    const deviceId = crypto.randomUUID();
    const dataDir = path.dirname(deviceIdFile);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    fs.writeFileSync(deviceIdFile, deviceId);
    return deviceId;
  }

  /**
   * Initialize the sync service
   */
  async initialize(): Promise<void> {
    console.log('[LocalSync] Initializing sync service...');
    console.log(`[LocalSync] Device ID: ${this.config.deviceId}`);
    console.log(`[LocalSync] Sync Server: ${this.config.serverUrl || 'Not configured'}`);

    // Check network connectivity
    await this.checkConnectivity();

    // Start periodic sync if enabled and server is configured
    if (this.config.enabled && this.config.serverUrl) {
      this.startPeriodicSync();
    }
  }

  /**
   * Check if the central server is reachable
   */
  async checkConnectivity(): Promise<boolean> {
    if (!this.config.serverUrl) {
      this.isOnline = false;
      return false;
    }

    try {
      const response = await fetch(`${this.config.serverUrl}/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000)
      });
      this.isOnline = response.ok;
      console.log(`[LocalSync] Server connectivity: ${this.isOnline ? 'ONLINE' : 'OFFLINE'}`);
      return this.isOnline;
    } catch (error) {
      this.isOnline = false;
      console.log('[LocalSync] Server connectivity: OFFLINE (unreachable)');
      return false;
    }
  }

  /**
   * Queue a change for synchronization
   */
  async queueChange(
    entityType: string,
    entityId: string,
    operation: 'create' | 'update' | 'delete',
    data: any
  ): Promise<void> {
    const change: PendingChange = {
      id: crypto.randomUUID(),
      entityType,
      entityId,
      operation,
      data,
      timestamp: new Date().toISOString(),
      synced: false
    };

    // Save to local change log
    await this.prisma.changeLog.create({
      data: {
        entityType,
        entityId,
        operation,
        newValue: JSON.stringify(data),
        deviceId: this.config.deviceId
      }
    });

    // Also save to pending changes file for persistence
    const pending = this.loadPendingChanges();
    pending.push(change);
    this.savePendingChanges(pending);

    console.log(`[LocalSync] Queued ${operation} for ${entityType}:${entityId}`);

    // Try to sync immediately if online
    if (this.isOnline) {
      await this.syncNow();
    }
  }

  /**
   * Load pending changes from file
   */
  private loadPendingChanges(): PendingChange[] {
    try {
      if (fs.existsSync(this.pendingChangesFile)) {
        const content = fs.readFileSync(this.pendingChangesFile, 'utf-8');
        return JSON.parse(content);
      }
    } catch (error) {
      console.error('[LocalSync] Error loading pending changes:', error);
    }
    return [];
  }

  /**
   * Save pending changes to file
   */
  private savePendingChanges(changes: PendingChange[]): void {
    try {
      fs.writeFileSync(this.pendingChangesFile, JSON.stringify(changes, null, 2));
    } catch (error) {
      console.error('[LocalSync] Error saving pending changes:', error);
    }
  }

  /**
   * Start periodic synchronization
   */
  startPeriodicSync(): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
    }

    console.log(`[LocalSync] Starting periodic sync every ${this.config.syncIntervalMs / 1000}s`);
    
    this.syncInterval = setInterval(async () => {
      await this.syncNow();
    }, this.config.syncIntervalMs);
  }

  /**
   * Stop periodic synchronization
   */
  stopPeriodicSync(): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
      console.log('[LocalSync] Periodic sync stopped');
    }
  }

  /**
   * Perform synchronization now
   */
  async syncNow(): Promise<{ success: boolean; pushed: number; pulled: number; conflicts: number }> {
    const result = { success: false, pushed: 0, pulled: 0, conflicts: 0 };

    // Check connectivity first
    const isOnline = await this.checkConnectivity();
    if (!isOnline) {
      console.log('[LocalSync] Cannot sync - server is offline');
      return result;
    }

    try {
      console.log('[LocalSync] Starting synchronization...');

      // 1. Push local changes
      const pushResult = await this.pushChanges();
      result.pushed = pushResult.pushed;
      result.conflicts = pushResult.conflicts;

      // 2. Pull remote changes
      const pullResult = await this.pullChanges();
      result.pulled = pullResult.pulled;

      // 3. Update sync state
      await this.updateSyncState();

      result.success = true;
      console.log(`[LocalSync] Sync complete - Pushed: ${result.pushed}, Pulled: ${result.pulled}, Conflicts: ${result.conflicts}`);
    } catch (error) {
      console.error('[LocalSync] Sync failed:', error);
    }

    return result;
  }

  /**
   * Push local changes to the server
   */
  private async pushChanges(): Promise<{ pushed: number; conflicts: number }> {
    const pending = this.loadPendingChanges().filter(c => !c.synced);
    
    if (pending.length === 0) {
      return { pushed: 0, conflicts: 0 };
    }

    console.log(`[LocalSync] Pushing ${pending.length} pending changes...`);

    // Group changes by entity type
    const methods: any[] = [];
    const experiments: any[] = [];

    for (const change of pending) {
      if (change.entityType === 'method') {
        methods.push(change.data);
      } else if (change.entityType === 'experiment') {
        experiments.push(change.data);
      }
    }

    try {
      const response = await fetch(`${this.config.serverUrl}/sync/push`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': this.config.userId,
          'x-device-id': this.config.deviceId
        },
        body: JSON.stringify({ methods, experiments })
      });

      if (!response.ok) {
        throw new Error(`Push failed: ${response.status}`);
      }

      const result = await response.json();
      
      // Mark pushed changes as synced
      const updatedPending = this.loadPendingChanges().map(c => {
        if (pending.find(p => p.id === c.id)) {
          return { ...c, synced: true };
        }
        return c;
      });
      
      // Remove synced changes older than 24 hours
      const cutoff = Date.now() - 24 * 60 * 60 * 1000;
      const filteredPending = updatedPending.filter(c => 
        !c.synced || new Date(c.timestamp).getTime() > cutoff
      );
      this.savePendingChanges(filteredPending);

      return {
        pushed: (result as any).applied?.length || 0,
        conflicts: (result as any).conflicts?.length || 0
      };
    } catch (error) {
      console.error('[LocalSync] Push error:', error);
      return { pushed: 0, conflicts: 0 };
    }
  }

  /**
   * Pull changes from the server
   */
  private async pullChanges(): Promise<{ pulled: number }> {
    try {
      // Get last sync timestamp
      const syncState = await this.prisma.syncState.findFirst({
        where: { deviceId: this.config.deviceId }
      });
      const lastPulledAt = syncState?.lastPulledAt?.toISOString();

      const url = new URL(`${this.config.serverUrl}/sync/pull`);
      if (lastPulledAt) {
        url.searchParams.set('since', lastPulledAt);
      }

      const response = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          'x-user-id': this.config.userId,
          'x-device-id': this.config.deviceId
        }
      });

      if (!response.ok) {
        throw new Error(`Pull failed: ${response.status}`);
      }

      const data = await response.json() as { methods?: any[]; experiments?: any[] };
      let pulled = 0;

      // Merge methods
      for (const method of data.methods || []) {
        const existing = await this.prisma.method.findUnique({ where: { id: method.id } });
        if (!existing || method.version > existing.version) {
          await this.prisma.method.upsert({
            where: { id: method.id },
            create: {
              ...method,
              steps: JSON.stringify(method.steps),
              reagents: method.reagents ? JSON.stringify(method.reagents) : null,
              attachments: method.attachments ? JSON.stringify(method.attachments) : null
            },
            update: {
              ...method,
              steps: JSON.stringify(method.steps),
              reagents: method.reagents ? JSON.stringify(method.reagents) : null,
              attachments: method.attachments ? JSON.stringify(method.attachments) : null
            }
          });
          pulled++;
        }
      }

      // Merge experiments
      for (const exp of data.experiments || []) {
        const existing = await this.prisma.experiment.findUnique({ where: { id: exp.id } });
        if (!existing || exp.version > existing.version) {
          await this.prisma.experiment.upsert({
            where: { id: exp.id },
            create: {
              ...exp,
              params: exp.params ? JSON.stringify(exp.params) : null,
              observations: exp.observations ? JSON.stringify(exp.observations) : null,
              tags: JSON.stringify(exp.tags || [])
            },
            update: {
              ...exp,
              params: exp.params ? JSON.stringify(exp.params) : null,
              observations: exp.observations ? JSON.stringify(exp.observations) : null,
              tags: JSON.stringify(exp.tags || [])
            }
          });
          pulled++;
        }
      }

      return { pulled };
    } catch (error) {
      console.error('[LocalSync] Pull error:', error);
      return { pulled: 0 };
    }
  }

  /**
   * Update the sync state record
   */
  private async updateSyncState(): Promise<void> {
    const now = new Date();
    
    await this.prisma.syncState.upsert({
      where: { deviceId: this.config.deviceId },
      create: {
        deviceId: this.config.deviceId,
        lastPulledAt: now,
        lastPushedAt: now,
        status: 'synced'
      },
      update: {
        lastPulledAt: now,
        lastPushedAt: now,
        status: 'synced',
        error: null
      }
    });
  }

  /**
   * Get sync status
   */
  async getStatus(): Promise<{
    isOnline: boolean;
    pendingChanges: number;
    lastSyncAt: string | null;
    deviceId: string;
  }> {
    const pending = this.loadPendingChanges().filter(c => !c.synced);
    const syncState = await this.prisma.syncState.findFirst({
      where: { deviceId: this.config.deviceId }
    });

    return {
      isOnline: this.isOnline,
      pendingChanges: pending.length,
      lastSyncAt: syncState?.lastPushedAt?.toISOString() || null,
      deviceId: this.config.deviceId
    };
  }

  /**
   * Export local data for backup
   */
  async exportLocalData(outputPath: string): Promise<void> {
    const data = {
      exportedAt: new Date().toISOString(),
      deviceId: this.config.deviceId,
      users: await this.prisma.user.findMany(),
      methods: await this.prisma.method.findMany(),
      experiments: await this.prisma.experiment.findMany(),
      inventory: await this.prisma.inventoryItem.findMany(),
      stock: await this.prisma.stock.findMany(),
      locations: await this.prisma.location.findMany(),
      comments: await this.prisma.comment.findMany(),
      signatures: await this.prisma.signature.findMany()
    };

    fs.writeFileSync(outputPath, JSON.stringify(data, null, 2));
    console.log(`[LocalSync] Data exported to ${outputPath}`);
  }

  /**
   * Import data from backup
   */
  async importLocalData(inputPath: string): Promise<void> {
    const content = fs.readFileSync(inputPath, 'utf-8');
    const data = JSON.parse(content);

    console.log(`[LocalSync] Importing data from ${inputPath}...`);
    console.log(`[LocalSync] Export date: ${data.exportedAt}`);

    // Import in transaction
    await this.prisma.$transaction(async (tx: any) => {
      // Import users
      for (const user of data.users || []) {
        await tx.user.upsert({
          where: { id: user.id },
          create: user,
          update: user
        });
      }

      // Import locations
      for (const location of data.locations || []) {
        await tx.location.upsert({
          where: { id: location.id },
          create: location,
          update: location
        });
      }

      // Import inventory items
      for (const item of data.inventory || []) {
        await tx.inventoryItem.upsert({
          where: { id: item.id },
          create: item,
          update: item
        });
      }

      // Import methods
      for (const method of data.methods || []) {
        await tx.method.upsert({
          where: { id: method.id },
          create: method,
          update: method
        });
      }

      // Import experiments
      for (const exp of data.experiments || []) {
        await tx.experiment.upsert({
          where: { id: exp.id },
          create: exp,
          update: exp
        });
      }

      // Import stock
      for (const stock of data.stock || []) {
        await tx.stock.upsert({
          where: { id: stock.id },
          create: stock,
          update: stock
        });
      }
    });

    console.log('[LocalSync] Data import complete');
  }
}

export default LocalSyncService;
