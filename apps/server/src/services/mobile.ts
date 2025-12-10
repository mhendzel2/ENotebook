/**
 * Mobile Companion API
 * 
 * RESTful endpoints optimized for mobile devices (similar to Labguru's Labhandy).
 * Supports:
 * - Lightweight data entry at the bench
 * - Label scanning and lookup
 * - Equipment booking
 * - Offline-first data sync
 * - Push notifications
 * - Voice notes
 * - Photo attachments
 */

import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { v4 as uuid } from 'uuid';

// ==================== TYPES ====================

export interface MobileDevice {
  id: string;
  userId: string;
  deviceName: string;
  platform: 'ios' | 'android' | 'web';
  pushToken?: string;
  lastSyncAt?: Date;
  registeredAt: Date;
}

export interface QuickEntry {
  id: string;
  experimentId: string;
  type: 'observation' | 'note' | 'photo' | 'voice' | 'measurement';
  content: unknown;
  metadata?: Record<string, unknown>;
  timestamp: Date;
  syncStatus: 'pending' | 'synced' | 'conflict';
  deviceId: string;
}

export interface EquipmentBooking {
  id: string;
  equipmentId: string;
  userId: string;
  startTime: Date;
  endTime: Date;
  purpose?: string;
  status: 'pending' | 'confirmed' | 'cancelled' | 'completed';
}

// ==================== MOBILE SERVICE ====================

export class MobileService {
  constructor(private prisma: PrismaClient) {}

  /**
   * Register a mobile device for push notifications
   */
  async registerDevice(
    userId: string,
    deviceName: string,
    platform: 'ios' | 'android' | 'web',
    pushToken?: string
  ): Promise<MobileDevice> {
    // Check if device already registered
    const existing = await this.prisma.mobileDevice.findFirst({
      where: { userId, deviceName, platform },
    });

    if (existing) {
      // Update push token
      const updated = await this.prisma.mobileDevice.update({
        where: { id: existing.id },
        data: { pushToken, updatedAt: new Date() },
      });
      return this.mapDevice(updated);
    }

    const device = await this.prisma.mobileDevice.create({
      data: {
        userId,
        deviceName,
        platform,
        pushToken,
      },
    });

    return this.mapDevice(device);
  }

  /**
   * Get devices for a user
   */
  async getUserDevices(userId: string): Promise<MobileDevice[]> {
    const devices = await this.prisma.mobileDevice.findMany({
      where: { userId },
    });
    return devices.map(this.mapDevice);
  }

  /**
   * Unregister a device
   */
  async unregisterDevice(deviceId: string): Promise<void> {
    await this.prisma.mobileDevice.delete({
      where: { id: deviceId },
    });
  }

  /**
   * Create a quick entry (lightweight observation)
   */
  async createQuickEntry(
    experimentId: string,
    type: QuickEntry['type'],
    content: unknown,
    deviceId: string,
    metadata?: Record<string, unknown>
  ): Promise<QuickEntry> {
    const entry = await this.prisma.quickEntry.create({
      data: {
        experimentId,
        type,
        content: JSON.stringify(content),
        metadata: metadata ? JSON.stringify(metadata) : undefined,
        deviceId,
        syncStatus: 'pending',
      },
    });

    return this.mapQuickEntry(entry);
  }

  /**
   * Get pending entries for sync
   */
  async getPendingEntries(deviceId: string): Promise<QuickEntry[]> {
    const entries = await this.prisma.quickEntry.findMany({
      where: { deviceId, syncStatus: 'pending' },
      orderBy: { createdAt: 'asc' },
    });
    return entries.map(this.mapQuickEntry);
  }

  /**
   * Sync entries to experiment observations
   */
  async syncEntries(entryIds: string[]): Promise<{ synced: number; conflicts: number }> {
    let synced = 0;
    let conflicts = 0;

    for (const entryId of entryIds) {
      try {
        const entry = await this.prisma.quickEntry.findUnique({
          where: { id: entryId },
        });

        if (!entry) continue;

        // Get experiment
        const experiment = await this.prisma.experiment.findUnique({
          where: { id: entry.experimentId },
        });

        if (!experiment) {
          conflicts++;
          continue;
        }

        // Parse existing observations
        let observations: Record<string, unknown> = {};
        if (experiment.observations) {
          observations = JSON.parse(experiment.observations);
        }

        // Add new entry to observations
        const content = JSON.parse(entry.content);
        const entryKey = `mobile_${entry.type}_${Date.now()}`;

        if (entry.type === 'observation' || entry.type === 'measurement') {
          if (!observations.mobile_entries) observations.mobile_entries = [];
          (observations.mobile_entries as unknown[]).push({
            type: entry.type,
            content,
            timestamp: entry.createdAt,
            deviceId: entry.deviceId,
          });
        } else if (entry.type === 'note') {
          if (!observations.notes) observations.notes = [];
          (observations.notes as unknown[]).push({
            text: content,
            timestamp: entry.createdAt,
            source: 'mobile',
          });
        } else if (entry.type === 'photo') {
          if (!observations.attachments) observations.attachments = [];
          (observations.attachments as unknown[]).push({
            type: 'photo',
            data: content,
            timestamp: entry.createdAt,
            source: 'mobile',
          });
        }

        // Update experiment
        await this.prisma.experiment.update({
          where: { id: entry.experimentId },
          data: {
            observations: JSON.stringify(observations),
            version: experiment.version + 1,
          },
        });

        // Mark entry as synced
        await this.prisma.quickEntry.update({
          where: { id: entryId },
          data: { syncStatus: 'synced' },
        });

        synced++;
      } catch (error) {
        conflicts++;
      }
    }

    return { synced, conflicts };
  }

  /**
   * Lookup entity by barcode/QR code scan
   */
  async lookupByBarcode(barcodeData: string, userId: string): Promise<{
    entityType: string;
    entityId: string;
    entity: unknown;
  } | null> {
    // Check labels table
    const label = await this.prisma.label.findFirst({
      where: { barcodeData },
    });

    if (!label) return null;

    // Fetch the actual entity
    let entity: unknown = null;

    switch (label.entityType) {
      case 'stock':
        entity = await this.prisma.stock.findUnique({
          where: { id: label.entityId },
          include: { item: true },
        });
        break;
      case 'experiment':
        entity = await this.prisma.experiment.findUnique({
          where: { id: label.entityId },
        });
        break;
      case 'location':
        entity = await this.prisma.location.findUnique({
          where: { id: label.entityId },
        });
        break;
      case 'pool':
        entity = await this.prisma.samplePool.findUnique({
          where: { id: label.entityId },
        });
        break;
    }

    // Record scan event
    await this.prisma.scanEvent.create({
      data: {
        labelId: label.id,
        scannedBy: userId,
        scannedAt: new Date(),
      },
    });

    return {
      entityType: label.entityType,
      entityId: label.entityId,
      entity,
    };
  }

  /**
   * Book equipment
   */
  async bookEquipment(
    equipmentId: string,
    userId: string,
    startTime: Date,
    endTime: Date,
    purpose?: string
  ): Promise<EquipmentBooking> {
    // Check for conflicts
    const conflicts = await this.prisma.equipmentBooking.findMany({
      where: {
        equipmentId,
        status: { in: ['pending', 'confirmed'] },
        OR: [
          { startTime: { lte: endTime }, endTime: { gte: startTime } },
        ],
      },
    });

    if (conflicts.length > 0) {
      throw new Error('Equipment is already booked during this time');
    }

    const booking = await this.prisma.equipmentBooking.create({
      data: {
        equipmentId,
        userId,
        startTime,
        endTime,
        purpose,
        status: 'pending',
      },
    });

    return this.mapBooking(booking);
  }

  /**
   * Get user's equipment bookings
   */
  async getUserBookings(userId: string): Promise<EquipmentBooking[]> {
    const bookings = await this.prisma.equipmentBooking.findMany({
      where: { userId },
      orderBy: { startTime: 'asc' },
    });
    return bookings.map(this.mapBooking);
  }

  /**
   * Get equipment availability
   */
  async getEquipmentAvailability(
    equipmentId: string,
    date: Date
  ): Promise<{ start: Date; end: Date }[]> {
    const dayStart = new Date(date);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(date);
    dayEnd.setHours(23, 59, 59, 999);

    const bookings = await this.prisma.equipmentBooking.findMany({
      where: {
        equipmentId,
        status: { in: ['pending', 'confirmed'] },
        startTime: { lte: dayEnd },
        endTime: { gte: dayStart },
      },
      orderBy: { startTime: 'asc' },
    });

    // Calculate free slots
    const freeSlots: { start: Date; end: Date }[] = [];
    let currentTime = new Date(dayStart);
    currentTime.setHours(8, 0, 0, 0); // Lab hours start at 8am
    const labEnd = new Date(dayStart);
    labEnd.setHours(18, 0, 0, 0); // Lab hours end at 6pm

    for (const booking of bookings) {
      if (booking.startTime > currentTime) {
        freeSlots.push({ start: new Date(currentTime), end: booking.startTime });
      }
      if (booking.endTime > currentTime) {
        currentTime = booking.endTime;
      }
    }

    if (currentTime < labEnd) {
      freeSlots.push({ start: new Date(currentTime), end: labEnd });
    }

    return freeSlots;
  }

  /**
   * Cancel booking
   */
  async cancelBooking(bookingId: string, userId: string): Promise<void> {
    const booking = await this.prisma.equipmentBooking.findUnique({
      where: { id: bookingId },
    });

    if (!booking) throw new Error('Booking not found');
    if (booking.userId !== userId) throw new Error('Not authorized to cancel this booking');

    await this.prisma.equipmentBooking.update({
      where: { id: bookingId },
      data: { status: 'cancelled' },
    });
  }

  /**
   * Get offline sync manifest
   */
  async getOfflineSyncManifest(userId: string, lastSyncAt?: Date): Promise<{
    experiments: unknown[];
    methods: unknown[];
    inventory: unknown[];
    timestamp: Date;
  }> {
    const where = lastSyncAt ? { updatedAt: { gt: lastSyncAt } } : {};

    const [experiments, methods, inventory] = await Promise.all([
      this.prisma.experiment.findMany({
        where: { ...where, userId },
        select: {
          id: true,
          title: true,
          status: true,
          modality: true,
          project: true,
          updatedAt: true,
        },
      }),
      this.prisma.method.findMany({
        where: { ...where, isPublic: true },
        select: {
          id: true,
          title: true,
          category: true,
          updatedAt: true,
        },
      }),
      this.prisma.stock.findMany({
        where,
        select: {
          id: true,
          quantity: true,
          status: true,
          itemId: true,
          updatedAt: true,
        },
        take: 100,
      }),
    ]);

    return {
      experiments,
      methods,
      inventory,
      timestamp: new Date(),
    };
  }

  /**
   * Send push notification
   */
  async sendPushNotification(
    userId: string,
    title: string,
    body: string,
    data?: Record<string, unknown>
  ): Promise<void> {
    const devices = await this.prisma.mobileDevice.findMany({
      where: { userId, pushToken: { not: null } },
    });

    // In production, integrate with FCM (Firebase Cloud Messaging) or APNs
    // For now, just log the notification
    console.log(`[Push Notification] User: ${userId}`);
    console.log(`  Title: ${title}`);
    console.log(`  Body: ${body}`);
    console.log(`  Devices: ${devices.length}`);

    // Store notification for retrieval
    for (const device of devices) {
      await this.prisma.notification.create({
        data: {
          userId,
          type: 'push',
          title,
          message: body,
        },
      });
    }
  }

  // Helper methods
  private mapDevice(device: any): MobileDevice {
    return {
      id: device.id,
      userId: device.userId,
      deviceName: device.deviceName,
      platform: device.platform,
      pushToken: device.pushToken,
      lastSyncAt: device.lastSyncAt,
      registeredAt: device.createdAt,
    };
  }

  private mapQuickEntry(entry: any): QuickEntry {
    return {
      id: entry.id,
      experimentId: entry.experimentId,
      type: entry.type,
      content: entry.content ? JSON.parse(entry.content) : null,
      metadata: entry.metadata ? JSON.parse(entry.metadata) : undefined,
      timestamp: entry.createdAt,
      syncStatus: entry.syncStatus,
      deviceId: entry.deviceId,
    };
  }

  private mapBooking(booking: any): EquipmentBooking {
    return {
      id: booking.id,
      equipmentId: booking.equipmentId,
      userId: booking.userId,
      startTime: booking.startTime,
      endTime: booking.endTime,
      purpose: booking.purpose,
      status: booking.status,
    };
  }
}

// ==================== API ROUTES ====================

const deviceSchema = z.object({
  deviceName: z.string().min(1),
  platform: z.enum(['ios', 'android', 'web']),
  pushToken: z.string().optional(),
});

const quickEntrySchema = z.object({
  experimentId: z.string(),
  type: z.enum(['observation', 'note', 'photo', 'voice', 'measurement']),
  content: z.any(),
  metadata: z.record(z.unknown()).optional(),
});

const bookingSchema = z.object({
  equipmentId: z.string(),
  startTime: z.string().transform(s => new Date(s)),
  endTime: z.string().transform(s => new Date(s)),
  purpose: z.string().optional(),
});

export function createMobileRoutes(prisma: PrismaClient, mobileService: MobileService) {
  const router = Router();

  // ==================== DEVICE REGISTRATION ====================

  // Register device
  router.post('/api/mobile/devices', async (req, res) => {
    const parse = deviceSchema.safeParse(req.body);
    if (!parse.success) {
      return res.status(400).json({ error: parse.error.flatten() });
    }

    const user = (req as any).user;
    const { deviceName, platform, pushToken } = parse.data;

    try {
      const device = await mobileService.registerDevice(
        user.id,
        deviceName,
        platform,
        pushToken
      );
      res.status(201).json(device);
    } catch (error) {
      res.status(500).json({ error: 'Failed to register device' });
    }
  });

  // Get user's devices
  router.get('/api/mobile/devices', async (req, res) => {
    const user = (req as any).user;

    try {
      const devices = await mobileService.getUserDevices(user.id);
      res.json(devices);
    } catch (error) {
      res.status(500).json({ error: 'Failed to get devices' });
    }
  });

  // Unregister device
  router.delete('/api/mobile/devices/:id', async (req, res) => {
    try {
      await mobileService.unregisterDevice(req.params.id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: 'Failed to unregister device' });
    }
  });

  // ==================== QUICK ENTRIES ====================

  // Create quick entry
  router.post('/api/mobile/entries', async (req, res) => {
    const parse = quickEntrySchema.safeParse(req.body);
    if (!parse.success) {
      return res.status(400).json({ error: parse.error.flatten() });
    }

    const deviceId = req.header('x-device-id') || 'unknown';

    try {
      const entry = await mobileService.createQuickEntry(
        parse.data.experimentId,
        parse.data.type,
        parse.data.content,
        deviceId,
        parse.data.metadata
      );
      res.status(201).json(entry);
    } catch (error) {
      res.status(500).json({ error: 'Failed to create entry' });
    }
  });

  // Get pending entries
  router.get('/api/mobile/entries/pending', async (req, res) => {
    const deviceId = req.header('x-device-id');
    if (!deviceId) {
      return res.status(400).json({ error: 'x-device-id header required' });
    }

    try {
      const entries = await mobileService.getPendingEntries(deviceId);
      res.json(entries);
    } catch (error) {
      res.status(500).json({ error: 'Failed to get entries' });
    }
  });

  // Sync entries
  router.post('/api/mobile/entries/sync', async (req, res) => {
    const { entryIds } = req.body;

    if (!Array.isArray(entryIds)) {
      return res.status(400).json({ error: 'entryIds must be an array' });
    }

    try {
      const result = await mobileService.syncEntries(entryIds);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: 'Failed to sync entries' });
    }
  });

  // ==================== BARCODE SCANNING ====================

  // Lookup by barcode
  router.get('/api/mobile/scan/:barcode', async (req, res) => {
    try {
      const result = await mobileService.lookupByBarcode(req.params.barcode);
      if (!result) {
        return res.status(404).json({ error: 'Entity not found' });
      }
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: 'Scan failed' });
    }
  });

  // ==================== EQUIPMENT BOOKING ====================

  // Book equipment
  router.post('/api/mobile/bookings', async (req, res) => {
    const parse = bookingSchema.safeParse(req.body);
    if (!parse.success) {
      return res.status(400).json({ error: parse.error.flatten() });
    }

    const user = (req as any).user;

    try {
      const booking = await mobileService.bookEquipment(
        parse.data.equipmentId,
        user.id,
        parse.data.startTime,
        parse.data.endTime,
        parse.data.purpose
      );
      res.status(201).json(booking);
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : 'Booking failed' });
    }
  });

  // Get user's bookings
  router.get('/api/mobile/bookings', async (req, res) => {
    const user = (req as any).user;

    try {
      const bookings = await mobileService.getUserBookings(user.id);
      res.json(bookings);
    } catch (error) {
      res.status(500).json({ error: 'Failed to get bookings' });
    }
  });

  // Get equipment availability
  router.get('/api/mobile/equipment/:id/availability', async (req, res) => {
    const date = req.query.date ? new Date(req.query.date as string) : new Date();

    try {
      const availability = await mobileService.getEquipmentAvailability(req.params.id, date);
      res.json(availability);
    } catch (error) {
      res.status(500).json({ error: 'Failed to get availability' });
    }
  });

  // Cancel booking
  router.delete('/api/mobile/bookings/:id', async (req, res) => {
    const user = (req as any).user;

    try {
      await mobileService.cancelBooking(req.params.id, user.id);
      res.json({ success: true });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : 'Cancel failed' });
    }
  });

  // ==================== OFFLINE SYNC ====================

  // Get sync manifest
  router.get('/api/mobile/sync/manifest', async (req, res) => {
    const user = (req as any).user;
    const lastSync = req.query.lastSync ? new Date(req.query.lastSync as string) : undefined;

    try {
      const manifest = await mobileService.getOfflineSyncManifest(user.id, lastSync);
      res.json(manifest);
    } catch (error) {
      res.status(500).json({ error: 'Failed to get sync manifest' });
    }
  });

  // Bulk sync
  router.post('/api/mobile/sync', async (req, res) => {
    const { entries, deviceId, lastSyncAt } = req.body;
    const user = (req as any).user;

    try {
      // Sync entries from device
      if (entries && Array.isArray(entries)) {
        for (const entry of entries) {
          await mobileService.createQuickEntry(
            entry.experimentId,
            entry.type,
            entry.content,
            deviceId,
            entry.metadata
          );
        }
      }

      // Get updates from server
      const manifest = await mobileService.getOfflineSyncManifest(
        user.id,
        lastSyncAt ? new Date(lastSyncAt) : undefined
      );

      res.json({
        uploaded: entries?.length || 0,
        ...manifest,
      });
    } catch (error) {
      res.status(500).json({ error: 'Sync failed' });
    }
  });

  // ==================== MOBILE-OPTIMIZED ENDPOINTS ====================

  // Get user's active experiments (lightweight)
  router.get('/api/mobile/experiments', async (req, res) => {
    const user = (req as any).user;

    try {
      const experiments = await prisma.experiment.findMany({
        where: {
          userId: user.id,
          status: { in: ['draft', 'in_progress'] },
        },
        select: {
          id: true,
          title: true,
          status: true,
          modality: true,
          project: true,
          updatedAt: true,
        },
        orderBy: { updatedAt: 'desc' },
        take: 20,
      });
      res.json(experiments);
    } catch (error) {
      res.status(500).json({ error: 'Failed to get experiments' });
    }
  });

  // Quick add observation to experiment
  router.post('/api/mobile/experiments/:id/observe', async (req, res) => {
    const { key, value, notes } = req.body;
    const deviceId = req.header('x-device-id') || 'unknown';

    try {
      const entry = await mobileService.createQuickEntry(
        req.params.id,
        'observation',
        { key, value, notes },
        deviceId
      );
      res.status(201).json(entry);
    } catch (error) {
      res.status(500).json({ error: 'Failed to add observation' });
    }
  });

  // Get recent notifications
  router.get('/api/mobile/notifications', async (req, res) => {
    const user = (req as any).user;

    try {
      const notifications = await prisma.notification.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: 'desc' },
        take: 50,
      });
      res.json(notifications);
    } catch (error) {
      res.status(500).json({ error: 'Failed to get notifications' });
    }
  });

  // Mark notification as read
  router.patch('/api/mobile/notifications/:id/read', async (req, res) => {
    try {
      await prisma.notification.update({
        where: { id: req.params.id },
        data: { read: true },
      });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: 'Failed to update notification' });
    }
  });

  return router;
}

export default { MobileService, createMobileRoutes };
