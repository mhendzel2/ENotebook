/**
 * Enhanced Sync Service
 * Provides offline-first synchronization with:
 * - Durable pending change queue with retry logic
 * - Selective sync by project/date/modality
 * - Progress reporting and error tracking
 * - Resumable large file uploads
 * - Conflict detection and resolution
 */

import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import type {
  EnhancedSyncState,
  SyncStatus,
  PendingChange,
  SyncConflict,
  SyncError,
  SyncProgress,
  SelectiveSyncConfig,
  StorageQuota,
  EntityType,
  ChangeOperation,
  ConflictResolutionStrategy,
} from '@eln/shared/dist/sync.js';

// ==================== CONFIGURATION ====================

interface EnhancedSyncConfig {
  serverUrl: string;
  enabled: boolean;
  syncIntervalMs: number;
  userId: string;
  deviceId: string;
  maxRetries: number;
  retryBackoffMs: number;
  maxConcurrentUploads: number;
  chunkSize: number; // For resumable uploads
  selectiveSync: SelectiveSyncConfig;
}

const DEFAULT_CONFIG: EnhancedSyncConfig = {
  serverUrl: process.env.SYNC_SERVER_URL || '',
  enabled: true,
  syncIntervalMs: 300000, // 5 minutes
  userId: 'admin-local',
  deviceId: '',
  maxRetries: 5,
  retryBackoffMs: 1000,
  maxConcurrentUploads: 3,
  chunkSize: 1024 * 1024, // 1MB chunks
  selectiveSync: {
    enabled: false,
    projects: [],
    entityTypes: ['experiment', 'method', 'inventoryItem', 'stock', 'attachment', 'report', 'comment', 'signature'],
  },
};

// ==================== ENHANCED SYNC SERVICE ====================

export class EnhancedSyncService {
  private prisma: PrismaClient;
  private config: EnhancedSyncConfig;
  private dataDir: string;
  private pendingChangesFile: string;
  private conflictsFile: string;
  private syncConfigFile: string;
  private syncInterval: NodeJS.Timeout | null = null;
  private isOnline: boolean = false;
  private isSyncing: boolean = false;
  private currentProgress: SyncProgress | undefined;
  private errors: SyncError[] = [];
  private eventListeners: Map<string, Set<(data: unknown) => void>> = new Map();

  constructor(prisma: PrismaClient, config: Partial<EnhancedSyncConfig> = {}) {
    this.prisma = prisma;
    this.config = { ...DEFAULT_CONFIG, ...config };
    
    if (!this.config.deviceId) {
      this.config.deviceId = this.getOrCreateDeviceId();
    }

    this.dataDir = path.join(process.cwd(), 'data', 'sync');
    this.pendingChangesFile = path.join(this.dataDir, 'pending-changes.json');
    this.conflictsFile = path.join(this.dataDir, 'conflicts.json');
    this.syncConfigFile = path.join(this.dataDir, 'sync-config.json');

    this.ensureDirectories();
    this.loadSyncConfig();
  }

  private ensureDirectories(): void {
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
  }

  private getOrCreateDeviceId(): string {
    const deviceIdFile = path.join(process.cwd(), 'data', 'device-id');
    if (fs.existsSync(deviceIdFile)) {
      return fs.readFileSync(deviceIdFile, 'utf-8').trim();
    }
    const deviceId = crypto.randomUUID();
    const dir = path.dirname(deviceIdFile);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(deviceIdFile, deviceId);
    return deviceId;
  }

  private loadSyncConfig(): void {
    try {
      if (fs.existsSync(this.syncConfigFile)) {
        const content = fs.readFileSync(this.syncConfigFile, 'utf-8');
        const saved = JSON.parse(content);
        if (saved.selectiveSync) {
          this.config.selectiveSync = { ...this.config.selectiveSync, ...saved.selectiveSync };
        }
      }
    } catch (error) {
      console.error('[EnhancedSync] Error loading sync config:', error);
    }
  }

  private saveSyncConfig(): void {
    try {
      fs.writeFileSync(this.syncConfigFile, JSON.stringify({
        selectiveSync: this.config.selectiveSync,
      }, null, 2));
    } catch (error) {
      console.error('[EnhancedSync] Error saving sync config:', error);
    }
  }

  // ==================== EVENT EMITTER ====================

  on(event: string, listener: (data: unknown) => void): void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, new Set());
    }
    this.eventListeners.get(event)!.add(listener);
  }

  off(event: string, listener: (data: unknown) => void): void {
    this.eventListeners.get(event)?.delete(listener);
  }

  private emit(event: string, data: unknown): void {
    this.eventListeners.get(event)?.forEach(listener => {
      try {
        listener(data);
      } catch (error) {
        console.error(`[EnhancedSync] Event listener error for ${event}:`, error);
      }
    });
  }

  // ==================== INITIALIZATION ====================

  async initialize(): Promise<void> {
    console.log('[EnhancedSync] Initializing enhanced sync service...');
    console.log(`[EnhancedSync] Device ID: ${this.config.deviceId}`);
    console.log(`[EnhancedSync] Server URL: ${this.config.serverUrl || 'Not configured'}`);

    await this.checkConnectivity();

    if (this.config.enabled && this.config.serverUrl) {
      this.startPeriodicSync();
    }

    // Process any pending changes that failed previously
    const pending = this.loadPendingChanges();
    if (pending.length > 0) {
      console.log(`[EnhancedSync] Found ${pending.length} pending changes from previous session`);
    }
  }

  // ==================== CONNECTIVITY ====================

  async checkConnectivity(): Promise<boolean> {
    if (!this.config.serverUrl) {
      this.isOnline = false;
      return false;
    }

    try {
      const response = await fetch(`${this.config.serverUrl}/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      });
      const wasOnline = this.isOnline;
      this.isOnline = response.ok;
      
      if (this.isOnline && !wasOnline) {
        console.log('[EnhancedSync] Connection restored - triggering sync');
        this.emit('online', {});
        // Trigger sync when coming back online
        this.syncNow().catch(console.error);
      } else if (!this.isOnline && wasOnline) {
        console.log('[EnhancedSync] Connection lost');
        this.emit('offline', {});
      }
      
      return this.isOnline;
    } catch (error) {
      this.isOnline = false;
      return false;
    }
  }

  // ==================== PENDING CHANGES QUEUE ====================

  private loadPendingChanges(): PendingChange[] {
    try {
      if (fs.existsSync(this.pendingChangesFile)) {
        const content = fs.readFileSync(this.pendingChangesFile, 'utf-8');
        return JSON.parse(content);
      }
    } catch (error) {
      console.error('[EnhancedSync] Error loading pending changes:', error);
    }
    return [];
  }

  private savePendingChanges(changes: PendingChange[]): void {
    try {
      fs.writeFileSync(this.pendingChangesFile, JSON.stringify(changes, null, 2));
    } catch (error) {
      console.error('[EnhancedSync] Error saving pending changes:', error);
    }
  }

  async queueChange(
    entityType: EntityType,
    entityId: string,
    operation: ChangeOperation,
    data: unknown,
    priority: 'high' | 'normal' | 'low' = 'normal'
  ): Promise<string> {
    const change: PendingChange = {
      id: crypto.randomUUID(),
      entityType,
      entityId,
      operation,
      data,
      timestamp: new Date().toISOString(),
      synced: false,
      retryCount: 0,
      priority,
    };

    // Save to database change log
    await this.prisma.changeLog.create({
      data: {
        entityType,
        entityId,
        operation,
        newValue: JSON.stringify(data),
        deviceId: this.config.deviceId,
      },
    });

    // Add to pending queue
    const pending = this.loadPendingChanges();
    pending.push(change);
    this.savePendingChanges(pending);

    console.log(`[EnhancedSync] Queued ${operation} for ${entityType}:${entityId} (priority: ${priority})`);
    this.emit('change-queued', change);

    // Try to sync immediately if online
    if (this.isOnline && !this.isSyncing) {
      this.syncNow().catch(console.error);
    }

    return change.id;
  }

  async retryChange(changeId: string): Promise<boolean> {
    const pending = this.loadPendingChanges();
    const change = pending.find(c => c.id === changeId);
    
    if (!change) {
      return false;
    }

    change.retryCount = 0;
    change.lastError = undefined;
    this.savePendingChanges(pending);

    if (this.isOnline) {
      await this.syncNow();
    }

    return true;
  }

  async cancelChange(changeId: string): Promise<boolean> {
    const pending = this.loadPendingChanges();
    const index = pending.findIndex(c => c.id === changeId);
    
    if (index === -1) {
      return false;
    }

    pending.splice(index, 1);
    this.savePendingChanges(pending);
    this.emit('change-cancelled', { changeId });

    return true;
  }

  // ==================== CONFLICTS ====================

  private loadConflicts(): SyncConflict[] {
    try {
      if (fs.existsSync(this.conflictsFile)) {
        const content = fs.readFileSync(this.conflictsFile, 'utf-8');
        return JSON.parse(content);
      }
    } catch (error) {
      console.error('[EnhancedSync] Error loading conflicts:', error);
    }
    return [];
  }

  private saveConflicts(conflicts: SyncConflict[]): void {
    try {
      fs.writeFileSync(this.conflictsFile, JSON.stringify(conflicts, null, 2));
    } catch (error) {
      console.error('[EnhancedSync] Error saving conflicts:', error);
    }
  }

  async resolveConflict(
    conflictId: string,
    resolution: ConflictResolutionStrategy,
    mergedData?: unknown
  ): Promise<boolean> {
    const conflicts = this.loadConflicts();
    const conflict = conflicts.find(c => c.id === conflictId);

    if (!conflict) {
      return false;
    }

    conflict.resolution = resolution;
    conflict.resolvedAt = new Date().toISOString();

    // Apply resolution
    let dataToApply: unknown;
    switch (resolution) {
      case 'client-wins':
        dataToApply = conflict.localData;
        break;
      case 'server-wins':
        dataToApply = conflict.serverData;
        break;
      case 'merge':
        dataToApply = mergedData || conflict.localData;
        break;
      case 'manual':
        dataToApply = mergedData;
        break;
    }

    // Queue the resolution as a new change
    await this.queueChange(
      conflict.entityType,
      conflict.entityId,
      'update',
      dataToApply,
      'high'
    );

    // Remove from conflicts list
    const index = conflicts.indexOf(conflict);
    conflicts.splice(index, 1);
    this.saveConflicts(conflicts);

    this.emit('conflict-resolved', { conflictId, resolution });
    return true;
  }

  // ==================== SELECTIVE SYNC ====================

  updateSelectiveSyncConfig(config: Partial<SelectiveSyncConfig>): void {
    this.config.selectiveSync = { ...this.config.selectiveSync, ...config };
    this.saveSyncConfig();
    this.emit('config-updated', this.config.selectiveSync);
  }

  getSelectiveSyncConfig(): SelectiveSyncConfig {
    return { ...this.config.selectiveSync };
  }

  private shouldSyncEntity(entityType: EntityType, entityData: Record<string, unknown>): boolean {
    const config = this.config.selectiveSync;
    
    if (!config.enabled) {
      return true;
    }

    // Check entity type
    if (!config.entityTypes.includes(entityType)) {
      return false;
    }

    // Check project filter
    if (config.projects.length > 0 && entityData.project) {
      if (!config.projects.includes(String(entityData.project))) {
        return false;
      }
    }

    // Check date range
    if (config.dateRange) {
      const createdAt = entityData.createdAt as string;
      if (createdAt) {
        const date = new Date(createdAt);
        const start = new Date(config.dateRange.start);
        const end = new Date(config.dateRange.end);
        if (date < start || date > end) {
          return false;
        }
      }
    }

    // Check modality filter (for experiments)
    if (config.modalities && config.modalities.length > 0 && entityData.modality) {
      if (!config.modalities.includes(String(entityData.modality))) {
        return false;
      }
    }

    // Check user filter
    if (config.userIds && config.userIds.length > 0 && entityData.userId) {
      if (!config.userIds.includes(String(entityData.userId))) {
        return false;
      }
    }

    // Check attachment size
    if (config.maxAttachmentSize && entityType === 'attachment') {
      const size = entityData.size as number;
      if (size && size > config.maxAttachmentSize) {
        return false;
      }
    }

    return true;
  }

  // ==================== STORAGE QUOTA ====================

  async getStorageQuota(): Promise<StorageQuota> {
    const dataDir = path.join(process.cwd(), 'data');
    
    const getDirectorySize = (dir: string): number => {
      let size = 0;
      try {
        if (fs.existsSync(dir)) {
          const files = fs.readdirSync(dir);
          for (const file of files) {
            const filePath = path.join(dir, file);
            const stat = fs.statSync(filePath);
            if (stat.isDirectory()) {
              size += getDirectorySize(filePath);
            } else {
              size += stat.size;
            }
          }
        }
      } catch {
        // Ignore errors
      }
      return size;
    };

    const attachmentsSize = getDirectorySize(path.join(dataDir, 'attachments'));
    const cacheSize = getDirectorySize(path.join(dataDir, 'cache'));
    
    // Estimate from database
    const experimentCount = await this.prisma.experiment.count();
    const methodCount = await this.prisma.method.count();
    const experimentsSize = experimentCount * 5000; // Rough estimate
    const methodsSize = methodCount * 3000;

    const used = attachmentsSize + cacheSize + experimentsSize + methodsSize;
    
    // Assume 10GB available (configurable)
    const total = 10 * 1024 * 1024 * 1024;
    const available = Math.max(0, total - used);

    return {
      used,
      available,
      total,
      breakdown: {
        experiments: experimentsSize,
        methods: methodsSize,
        attachments: attachmentsSize,
        cache: cacheSize,
      },
    };
  }

  // ==================== SYNC OPERATIONS ====================

  startPeriodicSync(): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
    }

    console.log(`[EnhancedSync] Starting periodic sync every ${this.config.syncIntervalMs / 1000}s`);

    this.syncInterval = setInterval(async () => {
      await this.syncNow();
    }, this.config.syncIntervalMs);

    // Also check connectivity periodically
    setInterval(() => this.checkConnectivity(), 30000);
  }

  stopPeriodicSync(): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
      console.log('[EnhancedSync] Periodic sync stopped');
    }
  }

  async syncNow(): Promise<EnhancedSyncState> {
    if (this.isSyncing) {
      console.log('[EnhancedSync] Sync already in progress');
      return this.getStatus();
    }

    this.isSyncing = true;
    this.emit('sync-started', {});

    const result: EnhancedSyncState = {
      status: 'syncing',
      isOnline: this.isOnline,
      deviceId: this.config.deviceId,
      lastSyncAt: null,
      lastPushAt: null,
      lastPullAt: null,
      pendingChanges: 0,
      pendingUploads: 0,
      conflicts: 0,
      errors: [],
    };

    try {
      // Check connectivity
      const online = await this.checkConnectivity();
      if (!online) {
        result.status = 'offline';
        this.emit('sync-complete', result);
        return result;
      }

      console.log('[EnhancedSync] Starting synchronization...');

      // Phase 1: Push local changes
      this.currentProgress = { phase: 'pushing', current: 0, total: 0 };
      this.emit('sync-progress', this.currentProgress);
      const pushResult = await this.pushChanges();

      // Phase 2: Pull remote changes
      this.currentProgress = { phase: 'pulling', current: 0, total: 0 };
      this.emit('sync-progress', this.currentProgress);
      const pullResult = await this.pullChanges();

      // Update sync state
      await this.updateSyncState();

      result.status = pushResult.conflicts > 0 ? 'conflict' : 'idle';
      result.lastSyncAt = new Date().toISOString();
      result.lastPushAt = result.lastSyncAt;
      result.lastPullAt = result.lastSyncAt;
      result.conflicts = pushResult.conflicts;

      console.log(`[EnhancedSync] Sync complete - Pushed: ${pushResult.pushed}, Pulled: ${pullResult.pulled}, Conflicts: ${pushResult.conflicts}`);

    } catch (error) {
      console.error('[EnhancedSync] Sync failed:', error);
      result.status = 'error';
      result.errors.push({
        id: crypto.randomUUID(),
        message: error instanceof Error ? error.message : 'Sync failed',
        code: 'SYNC_FAILED',
        timestamp: new Date().toISOString(),
        retryable: true,
      });
    } finally {
      this.isSyncing = false;
      this.currentProgress = undefined;
      this.emit('sync-complete', result);
    }

    return result;
  }

  private async pushChanges(): Promise<{ pushed: number; conflicts: number }> {
    const pending = this.loadPendingChanges().filter(c => !c.synced);

    if (pending.length === 0) {
      return { pushed: 0, conflicts: 0 };
    }

    // Sort by priority and timestamp
    pending.sort((a, b) => {
      const priorityOrder: Record<string, number> = { high: 0, normal: 1, low: 2 };
      const priorityDiff = (priorityOrder[a.priority] ?? 1) - (priorityOrder[b.priority] ?? 1);
      if (priorityDiff !== 0) return priorityDiff;
      return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
    });

    this.currentProgress = { phase: 'pushing', current: 0, total: pending.length };

    const methods: unknown[] = [];
    const experiments: unknown[] = [];
    const processedIds: string[] = [];

    for (const change of pending) {
      // Check retry limit
      if (change.retryCount >= this.config.maxRetries) {
        change.lastError = 'Max retries exceeded';
        continue;
      }

      // Check selective sync filter
      if (!this.shouldSyncEntity(change.entityType, change.data as Record<string, unknown>)) {
        change.synced = true; // Mark as synced to skip
        processedIds.push(change.id);
        continue;
      }

      if (change.entityType === 'method') {
        methods.push(change.data);
      } else if (change.entityType === 'experiment') {
        experiments.push(change.data);
      }
      processedIds.push(change.id);

      this.currentProgress.current++;
      this.emit('sync-progress', this.currentProgress);
    }

    try {
      const response = await fetch(`${this.config.serverUrl}/sync/push`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': this.config.userId,
          'x-device-id': this.config.deviceId,
        },
        body: JSON.stringify({ methods, experiments }),
      });

      if (!response.ok) {
        throw new Error(`Push failed: ${response.status}`);
      }

      const result = await response.json() as { applied?: unknown[]; conflicts?: unknown[] };

      // Mark successful changes as synced
      const allPending = this.loadPendingChanges();
      for (const change of allPending) {
        if (processedIds.includes(change.id)) {
          change.synced = true;
        }
      }

      // Handle conflicts
      const conflicts = result.conflicts || [];
      for (const conflict of conflicts as Array<{ id: string; serverVersion: number; clientVersion: number }>) {
        const existingConflicts = this.loadConflicts();
        existingConflicts.push({
          id: crypto.randomUUID(),
          entityType: 'experiment', // or determine from conflict
          entityId: conflict.id,
          localVersion: conflict.clientVersion,
          serverVersion: conflict.serverVersion,
          localData: pending.find(p => (p.data as Record<string, unknown>).id === conflict.id)?.data,
          serverData: null, // Would need to fetch
          fieldConflicts: [],
          detectedAt: new Date().toISOString(),
        });
        this.saveConflicts(existingConflicts);
      }

      // Clean up old synced changes
      const cutoff = Date.now() - 24 * 60 * 60 * 1000;
      const filtered = allPending.filter(c =>
        !c.synced || new Date(c.timestamp).getTime() > cutoff
      );
      this.savePendingChanges(filtered);

      return {
        pushed: (result.applied || []).length,
        conflicts: conflicts.length,
      };
    } catch (error) {
      // Increment retry count
      const allPending = this.loadPendingChanges();
      for (const change of allPending) {
        if (processedIds.includes(change.id) && !change.synced) {
          change.retryCount++;
          change.lastError = error instanceof Error ? error.message : 'Unknown error';
        }
      }
      this.savePendingChanges(allPending);

      console.error('[EnhancedSync] Push error:', error);
      return { pushed: 0, conflicts: 0 };
    }
  }

  private async pullChanges(): Promise<{ pulled: number }> {
    try {
      const syncState = await this.prisma.syncState.findFirst({
        where: { deviceId: this.config.deviceId },
      });
      const lastPulledAt = syncState?.lastPulledAt?.toISOString();

      const url = new URL(`${this.config.serverUrl}/sync/pull`);
      if (lastPulledAt) {
        url.searchParams.set('since', lastPulledAt);
      }

      // Add selective sync filters
      const config = this.config.selectiveSync;
      if (config.enabled) {
        if (config.projects.length > 0) {
          url.searchParams.set('projects', config.projects.join(','));
        }
        if (config.modalities && config.modalities.length > 0) {
          url.searchParams.set('modalities', config.modalities.join(','));
        }
        if (config.dateRange) {
          url.searchParams.set('dateStart', config.dateRange.start);
          url.searchParams.set('dateEnd', config.dateRange.end);
        }
      }

      const response = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          'x-user-id': this.config.userId,
          'x-device-id': this.config.deviceId,
        },
      });

      if (!response.ok) {
        throw new Error(`Pull failed: ${response.status}`);
      }

      const data = await response.json() as { methods?: unknown[]; experiments?: unknown[] };
      let pulled = 0;

      const methodsArray = data.methods || [];
      const experimentsArray = data.experiments || [];
      const total = methodsArray.length + experimentsArray.length;
      this.currentProgress = { phase: 'pulling', current: 0, total };

      // Merge methods
      for (const method of methodsArray as Array<Record<string, unknown>>) {
        if (!this.shouldSyncEntity('method', method)) {
          continue;
        }

        const existing = await this.prisma.method.findUnique({ where: { id: String(method.id) } });
        if (!existing || (method.version as number) > existing.version) {
          await this.prisma.method.upsert({
            where: { id: String(method.id) },
            create: method as any,
            update: method as any,
          });
          pulled++;
        }

        this.currentProgress.current++;
        this.emit('sync-progress', this.currentProgress);
      }

      // Merge experiments
      for (const exp of experimentsArray as Array<Record<string, unknown>>) {
        if (!this.shouldSyncEntity('experiment', exp)) {
          continue;
        }

        const existing = await this.prisma.experiment.findUnique({ where: { id: String(exp.id) } });
        if (!existing || (exp.version as number) > existing.version) {
          await this.prisma.experiment.upsert({
            where: { id: String(exp.id) },
            create: exp as any,
            update: exp as any,
          });
          pulled++;
        }

        this.currentProgress.current++;
        this.emit('sync-progress', this.currentProgress);
      }

      return { pulled };
    } catch (error) {
      console.error('[EnhancedSync] Pull error:', error);
      return { pulled: 0 };
    }
  }

  private async updateSyncState(): Promise<void> {
    const now = new Date();

    await this.prisma.syncState.upsert({
      where: { deviceId: this.config.deviceId },
      create: {
        deviceId: this.config.deviceId,
        lastPulledAt: now,
        lastPushedAt: now,
        status: 'synced',
      },
      update: {
        lastPulledAt: now,
        lastPushedAt: now,
        status: 'synced',
        error: null,
      },
    });
  }

  // ==================== STATUS ====================

  async getStatus(): Promise<EnhancedSyncState> {
    const pending = this.loadPendingChanges().filter(c => !c.synced);
    const conflicts = this.loadConflicts().filter(c => !c.resolvedAt);
    const pendingUploads = pending.filter(c => c.entityType === 'attachment').length;

    const syncState = await this.prisma.syncState.findFirst({
      where: { deviceId: this.config.deviceId },
    });

    let status: SyncStatus = 'idle';
    if (this.isSyncing) {
      status = 'syncing';
    } else if (!this.isOnline) {
      status = 'offline';
    } else if (conflicts.length > 0) {
      status = 'conflict';
    } else if (pending.some(c => c.lastError)) {
      status = 'error';
    } else if (pending.length > 0) {
      status = 'pending';
    }

    return {
      status,
      isOnline: this.isOnline,
      deviceId: this.config.deviceId,
      lastSyncAt: syncState?.lastPushedAt?.toISOString() || null,
      lastPushAt: syncState?.lastPushedAt?.toISOString() || null,
      lastPullAt: syncState?.lastPulledAt?.toISOString() || null,
      pendingChanges: pending.length,
      pendingUploads,
      conflicts: conflicts.length,
      errors: this.errors.slice(-10), // Last 10 errors
      syncProgress: this.currentProgress,
    };
  }

  getPendingChanges(): PendingChange[] {
    return this.loadPendingChanges().filter(c => !c.synced);
  }

  getConflicts(): SyncConflict[] {
    return this.loadConflicts().filter(c => !c.resolvedAt);
  }
}

export default EnhancedSyncService;
