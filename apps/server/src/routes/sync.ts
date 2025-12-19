/**
 * Sync Routes Module
 * Implements push/pull sync for offline/local clients.
 * Enhanced with selective sync, status endpoints, and conflict resolution.
 */

import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { EnhancedSyncService } from '../services/enhancedSync.js';

// Singleton instance of the enhanced sync service
let syncService: EnhancedSyncService | null = null;

export function createSyncRoutes(prisma: PrismaClient): Router {
  const router = Router();

  // Initialize enhanced sync service
  if (!syncService) {
    syncService = new EnhancedSyncService(prisma, {
      serverUrl: process.env.SYNC_SERVER_URL || '',
    });
    syncService.initialize().catch(console.error);
  }

  const syncMethodSchema = z.object({
    id: z.string().uuid(),
    title: z.string().min(1),
    category: z.string().optional(),
    steps: z.any(),
    reagents: z.any().optional(),
    attachments: z.any().optional(),
    isPublic: z.boolean().default(true),
    createdBy: z.string().optional(),
    version: z.number().int().positive(),
    updatedAt: z.string(),
    parentMethodId: z.string().uuid().optional()
  }).passthrough();

  const syncExperimentSchema = z.object({
    id: z.string().uuid(),
    userId: z.string(),
    title: z.string().min(1),
    project: z.string().optional(),
    modality: z.string(),
    protocolRef: z.string().optional(),
    params: z.any().optional(),
    observations: z.any().optional(),
    resultsSummary: z.string().optional(),
    dataLink: z.string().optional(),
    tags: z.array(z.string()).optional(),
    status: z.string().optional(),
    version: z.number().int().positive(),
    createdAt: z.string(),
    updatedAt: z.string()
  }).passthrough();

  const syncPayloadSchema = z.object({
    methods: z.array(syncMethodSchema),
    experiments: z.array(syncExperimentSchema)
  });

  // Push changes to server
  router.post('/sync/push', async (req, res) => {
    const parse = syncPayloadSchema.safeParse(req.body);
    if (!parse.success) {
      return res.status(400).json({ error: parse.error.flatten() });
    }

    const { methods, experiments } = parse.data;
    const conflicts: any[] = [];
    const applied: any[] = [];

    try {
      await prisma.$transaction(async (tx: any) => {
        // Handle Experiments
        for (const incExp of experiments) {
          const existing = await tx.experiment.findUnique({ where: { id: incExp.id } });

          const { params, observations, tags, ...rest } = incExp;
          const dataToSave: any = {
            ...rest,
            params: params || undefined,
            observations: observations || undefined,
            tags: tags || []
          };

          if (!existing) {
            await tx.experiment.create({ data: dataToSave });
            applied.push({ id: incExp.id, status: 'created' });
          } else {
            if (incExp.version > existing.version) {
              await tx.experiment.update({
                where: { id: incExp.id },
                data: dataToSave
              });
              applied.push({ id: incExp.id, status: 'updated' });
            } else if (incExp.version < existing.version) {
              conflicts.push({ id: incExp.id, serverVersion: existing.version, clientVersion: incExp.version });
            }
          }
        }

        // Handle Methods
        for (const incMethod of methods) {
          const existing = await tx.method.findUnique({ where: { id: incMethod.id } });

          const { steps, reagents, attachments, ...rest } = incMethod;
          const dataToSave = {
            ...rest,
            steps: steps,
            reagents: reagents || undefined,
            attachments: attachments || undefined
          };

          if (!existing) {
            await tx.method.create({ data: dataToSave });
            applied.push({ id: incMethod.id, status: 'created' });
          } else {
            if (incMethod.version > existing.version) {
              await tx.method.update({
                where: { id: incMethod.id },
                data: dataToSave
              });
              applied.push({ id: incMethod.id, status: 'updated' });
            } else if (incMethod.version < existing.version) {
              conflicts.push({ id: incMethod.id, serverVersion: existing.version, clientVersion: incMethod.version });
            }
          }
        }
      });

      res.json({ status: 'processed', applied, conflicts });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Sync transaction failed' });
    }
  });

  // Pull full dataset from server (with selective sync support)
  router.get('/sync/pull', async (req, res) => {
    try {
      const since = req.query.since as string | undefined;
      const projects = req.query.projects ? (req.query.projects as string).split(',') : undefined;
      const modalities = req.query.modalities ? (req.query.modalities as string).split(',') : undefined;
      const dateStart = req.query.dateStart as string | undefined;
      const dateEnd = req.query.dateEnd as string | undefined;

      // Build method filters
      const methodWhere: Record<string, unknown> = {};
      if (since) {
        methodWhere.updatedAt = { gte: new Date(since) };
      }

      // Build experiment filters
      const experimentWhere: Record<string, unknown> = {};
      if (since) {
        experimentWhere.updatedAt = { gte: new Date(since) };
      }
      if (projects && projects.length > 0) {
        experimentWhere.project = { in: projects };
      }
      if (modalities && modalities.length > 0) {
        experimentWhere.modality = { in: modalities };
      }
      if (dateStart || dateEnd) {
        experimentWhere.createdAt = {
          ...(dateStart && { gte: new Date(dateStart) }),
          ...(dateEnd && { lte: new Date(dateEnd) }),
        };
      }

      const methods = await prisma.method.findMany({ where: methodWhere });
      const experiments = await prisma.experiment.findMany({ where: experimentWhere });

      res.json({
        methods,
        experiments,
        syncedAt: new Date().toISOString(),
        filters: { since, projects, modalities, dateStart, dateEnd },
      });
    } catch (error) {
      console.error('[Sync Pull]', error);
      res.status(500).json({ error: 'Database error' });
    }
  });

  // ==================== SYNC STATUS ENDPOINTS ====================

  // Get current sync status
  router.get('/sync/status', async (_req, res) => {
    try {
      if (!syncService) {
        return res.status(503).json({ error: 'Sync service not initialized' });
      }
      const status = await syncService.getStatus();
      res.json(status);
    } catch (error) {
      console.error('[Sync Status]', error);
      res.status(500).json({ error: 'Failed to get sync status' });
    }
  });

  // Get pending changes
  router.get('/sync/pending', async (_req, res) => {
    try {
      if (!syncService) {
        return res.status(503).json({ error: 'Sync service not initialized' });
      }
      const pending = syncService.getPendingChanges();
      res.json({ pending, count: pending.length });
    } catch (error) {
      console.error('[Sync Pending]', error);
      res.status(500).json({ error: 'Failed to get pending changes' });
    }
  });

  // Get unresolved conflicts
  router.get('/sync/conflicts', async (_req, res) => {
    try {
      if (!syncService) {
        return res.status(503).json({ error: 'Sync service not initialized' });
      }
      const conflicts = syncService.getConflicts();
      res.json({ conflicts, count: conflicts.length });
    } catch (error) {
      console.error('[Sync Conflicts]', error);
      res.status(500).json({ error: 'Failed to get conflicts' });
    }
  });

  // Retry a specific pending change
  router.post('/sync/retry/:changeId', async (req, res) => {
    try {
      if (!syncService) {
        return res.status(503).json({ error: 'Sync service not initialized' });
      }
      const success = await syncService.retryChange(req.params.changeId);
      if (success) {
        res.json({ status: 'retry_queued' });
      } else {
        res.status(404).json({ error: 'Change not found' });
      }
    } catch (error) {
      console.error('[Sync Retry]', error);
      res.status(500).json({ error: 'Failed to retry change' });
    }
  });

  // Cancel a pending change
  router.delete('/sync/pending/:changeId', async (req, res) => {
    try {
      if (!syncService) {
        return res.status(503).json({ error: 'Sync service not initialized' });
      }
      const success = await syncService.cancelChange(req.params.changeId);
      if (success) {
        res.json({ status: 'cancelled' });
      } else {
        res.status(404).json({ error: 'Change not found' });
      }
    } catch (error) {
      console.error('[Sync Cancel]', error);
      res.status(500).json({ error: 'Failed to cancel change' });
    }
  });

  // Resolve a conflict
  const resolveConflictSchema = z.object({
    resolution: z.enum(['client-wins', 'server-wins', 'merge', 'manual']),
    mergedData: z.any().optional(),
  });

  router.post('/sync/conflicts/:conflictId/resolve', async (req, res) => {
    try {
      if (!syncService) {
        return res.status(503).json({ error: 'Sync service not initialized' });
      }
      
      const parse = resolveConflictSchema.safeParse(req.body);
      if (!parse.success) {
        return res.status(400).json({ error: parse.error.flatten() });
      }

      const success = await syncService.resolveConflict(
        req.params.conflictId,
        parse.data.resolution,
        parse.data.mergedData
      );

      if (success) {
        res.json({ status: 'resolved' });
      } else {
        res.status(404).json({ error: 'Conflict not found' });
      }
    } catch (error) {
      console.error('[Sync Resolve]', error);
      res.status(500).json({ error: 'Failed to resolve conflict' });
    }
  });

  // Trigger manual sync
  router.post('/sync/now', async (_req, res) => {
    try {
      if (!syncService) {
        return res.status(503).json({ error: 'Sync service not initialized' });
      }
      const result = await syncService.syncNow();
      res.json(result);
    } catch (error) {
      console.error('[Sync Now]', error);
      res.status(500).json({ error: 'Sync failed' });
    }
  });

  // ==================== SELECTIVE SYNC CONFIG ====================

  // Get selective sync configuration
  router.get('/sync/config', async (_req, res) => {
    try {
      if (!syncService) {
        return res.status(503).json({ error: 'Sync service not initialized' });
      }
      const config = syncService.getSelectiveSyncConfig();
      res.json(config);
    } catch (error) {
      console.error('[Sync Config Get]', error);
      res.status(500).json({ error: 'Failed to get sync config' });
    }
  });

  // Update selective sync configuration
  const selectiveSyncConfigSchema = z.object({
    enabled: z.boolean().optional(),
    projects: z.array(z.string()).optional(),
    entityTypes: z.array(z.string()).optional(),
    dateRange: z.object({
      start: z.string(),
      end: z.string(),
    }).optional(),
    modalities: z.array(z.string()).optional(),
    userIds: z.array(z.string()).optional(),
    maxAttachmentSize: z.number().positive().optional(),
  });

  router.put('/sync/config', async (req, res) => {
    try {
      if (!syncService) {
        return res.status(503).json({ error: 'Sync service not initialized' });
      }

      const parse = selectiveSyncConfigSchema.safeParse(req.body);
      if (!parse.success) {
        return res.status(400).json({ error: parse.error.flatten() });
      }

      syncService.updateSelectiveSyncConfig(parse.data as any);
      const updated = syncService.getSelectiveSyncConfig();
      res.json({ status: 'updated', config: updated });
    } catch (error) {
      console.error('[Sync Config Update]', error);
      res.status(500).json({ error: 'Failed to update sync config' });
    }
  });

  // Get storage quota
  router.get('/sync/quota', async (_req, res) => {
    try {
      if (!syncService) {
        return res.status(503).json({ error: 'Sync service not initialized' });
      }
      const quota = await syncService.getStorageQuota();
      res.json(quota);
    } catch (error) {
      console.error('[Sync Quota]', error);
      res.status(500).json({ error: 'Failed to get storage quota' });
    }
  });

  return router;
}
