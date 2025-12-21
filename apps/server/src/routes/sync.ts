/**
 * Sync Routes Module
 * Implements push/pull sync for offline/local clients.
 * Enhanced with selective sync, status endpoints, and conflict resolution.
 */

import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { EnhancedSyncService } from '../services/enhancedSync.js';
import archiver from 'archiver';
import * as fs from 'fs';
import * as path from 'path';
import crypto from 'crypto';
import AdmZip from 'adm-zip';
import { validate as uuidValidate } from 'uuid';

// Singleton instance of the enhanced sync service
let syncService: EnhancedSyncService | null = null;

export function createSyncRoutes(prisma: PrismaClient): Router {
  const router = Router();

  function isValidUuidSegment(segment: string): boolean {
    if (!segment) return false;
    if (!uuidValidate(segment)) return false;
    if (segment.includes('/') || segment.includes('\\') || segment.includes('..')) return false;
    return true;
  }

  function safeWriteWithin(baseDir: string, relativePath: string, data: Buffer): boolean {
    const normalized = relativePath.replace(/\\/g, '/');
    const dest = path.resolve(baseDir, normalized);
    const resolvedBase = path.resolve(baseDir);
    if (!dest.startsWith(resolvedBase + path.sep) && dest !== resolvedBase) return false;
    const dir = path.dirname(dest);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(dest, data);
    return true;
  }

  function makePlaceholderPasswordHash(): string {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.pbkdf2Sync(crypto.randomUUID(), salt, 10000, 64, 'sha512').toString('hex');
    return `${salt}:${hash}`;
  }

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

  const usbImportSchema = z.object({
    bundleBase64: z.string().min(1),
  });

  // Import a portable sync bundle (ZIP) produced by /sync/export.
  // Designed for a "parent" workstation to ingest data from a USB stick.
  router.post('/sync/import', async (req, res) => {
    const user = (req as any).user as { id: string; role?: string } | undefined;
    if (!user || (user.role !== 'admin' && user.role !== 'manager')) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const parse = usbImportSchema.safeParse(req.body);
    if (!parse.success) {
      return res.status(400).json({ error: parse.error.flatten() });
    }

    try {
      const zipBuffer = Buffer.from(parse.data.bundleBase64, 'base64');
      const zip = new AdmZip(zipBuffer);

      const dbEntry = zip.getEntry('db.json');
      if (!dbEntry) {
        return res.status(400).json({ error: 'Bundle missing db.json' });
      }

      const payload = JSON.parse(dbEntry.getData().toString('utf-8')) as any;
      if (!payload || typeof payload !== 'object') {
        return res.status(400).json({ error: 'Invalid db.json payload' });
      }

      const summary = {
        created: 0,
        updated: 0,
        skipped: 0,
        filesWritten: 0,
      };

      await prisma.$transaction(async (tx: any) => {
        // Users: only create placeholders if missing (passwordHash is required).
        const users: any[] = Array.isArray(payload.users) ? payload.users : [];
        for (const u of users) {
          if (!u?.id || typeof u.id !== 'string') continue;
          const existing = await tx.user.findUnique({ where: { id: u.id } });
          if (existing) {
            // Update non-sensitive fields only.
            await tx.user.update({
              where: { id: u.id },
              data: {
                name: typeof u.name === 'string' ? u.name : existing.name,
                email: typeof u.email === 'string' ? u.email : existing.email,
                role: u.role ?? existing.role,
                active: typeof u.active === 'boolean' ? u.active : existing.active,
              },
            });
            summary.updated++;
          } else {
            await tx.user.create({
              data: {
                id: u.id,
                name: typeof u.name === 'string' ? u.name : 'Imported User',
                email: typeof u.email === 'string' ? u.email : null,
                role: u.role ?? 'member',
                active: false,
                passwordHash: makePlaceholderPasswordHash(),
                createdAt: u.createdAt ? new Date(u.createdAt) : undefined,
              },
            });
            summary.created++;
          }
        }

        // Methods (version-based)
        const methods: any[] = Array.isArray(payload.methods) ? payload.methods : [];
        for (const m of methods) {
          if (!m?.id) continue;
          const existing = await tx.method.findUnique({ where: { id: m.id } });
          if (!existing) {
            await tx.method.create({ data: m });
            summary.created++;
            continue;
          }
          if (typeof m.version === 'number' && typeof existing.version === 'number' && m.version > existing.version) {
            await tx.method.update({ where: { id: m.id }, data: m });
            summary.updated++;
          } else {
            summary.skipped++;
          }
        }

        // Experiments (version-based)
        const experiments: any[] = Array.isArray(payload.experiments) ? payload.experiments : [];
        for (const e of experiments) {
          if (!e?.id) continue;
          const existing = await tx.experiment.findUnique({ where: { id: e.id } });
          const normalized = { ...e, tags: Array.isArray(e.tags) ? e.tags : [] };
          if (!existing) {
            await tx.experiment.create({ data: normalized });
            summary.created++;
            continue;
          }
          if (typeof e.version === 'number' && typeof existing.version === 'number' && e.version > existing.version) {
            await tx.experiment.update({ where: { id: e.id }, data: normalized });
            summary.updated++;
          } else {
            summary.skipped++;
          }
        }

        // Locations (updatedAt-based)
        const locations: any[] = Array.isArray(payload.locations) ? payload.locations : [];
        for (const loc of locations) {
          if (!loc?.id) continue;
          const existing = await tx.location.findUnique({ where: { id: loc.id } });
          if (!existing) {
            await tx.location.create({ data: loc });
            summary.created++;
            continue;
          }
          const incUpdated = loc.updatedAt ? new Date(loc.updatedAt) : null;
          if (incUpdated && existing.updatedAt && incUpdated > existing.updatedAt) {
            await tx.location.update({ where: { id: loc.id }, data: loc });
            summary.updated++;
          } else {
            summary.skipped++;
          }
        }

        // Inventory items
        const inventoryItems: any[] = Array.isArray(payload.inventoryItems) ? payload.inventoryItems : [];
        for (const item of inventoryItems) {
          if (!item?.id) continue;
          const existing = await tx.inventoryItem.findUnique({ where: { id: item.id } });
          if (!existing) {
            await tx.inventoryItem.create({ data: item });
            summary.created++;
            continue;
          }
          const incUpdated = item.updatedAt ? new Date(item.updatedAt) : null;
          if (incUpdated && existing.updatedAt && incUpdated > existing.updatedAt) {
            await tx.inventoryItem.update({ where: { id: item.id }, data: item });
            summary.updated++;
          } else {
            summary.skipped++;
          }
        }

        // Stocks
        const stocks: any[] = Array.isArray(payload.stocks) ? payload.stocks : [];
        for (const s of stocks) {
          if (!s?.id) continue;
          const existing = await tx.stock.findUnique({ where: { id: s.id } });
          if (!existing) {
            await tx.stock.create({ data: s });
            summary.created++;
            continue;
          }
          const incUpdated = s.updatedAt ? new Date(s.updatedAt) : null;
          if (incUpdated && existing.updatedAt && incUpdated > existing.updatedAt) {
            await tx.stock.update({ where: { id: s.id }, data: s });
            summary.updated++;
          } else {
            summary.skipped++;
          }
        }

        // ExperimentStock join table
        const experimentStocks: any[] = Array.isArray(payload.experimentStocks) ? payload.experimentStocks : [];
        for (const es of experimentStocks) {
          if (!es?.id) continue;
          const existing = await tx.experimentStock.findUnique({ where: { id: es.id } });
          if (!existing) {
            await tx.experimentStock.create({ data: es });
            summary.created++;
          } else {
            // Keep latest usage record updates (rare)
            await tx.experimentStock.update({ where: { id: es.id }, data: es });
            summary.updated++;
          }
        }

        // Attachments + Reports DB rows
        const attachments: any[] = Array.isArray(payload.attachments) ? payload.attachments : [];
        for (const a of attachments) {
          if (!a?.id) continue;
          const existing = await tx.attachment.findUnique({ where: { id: a.id } });
          if (!existing) {
            await tx.attachment.create({ data: a });
            summary.created++;
          } else {
            await tx.attachment.update({ where: { id: a.id }, data: a });
            summary.updated++;
          }
        }

        const reports: any[] = Array.isArray(payload.reports) ? payload.reports : [];
        for (const r of reports) {
          if (!r?.id) continue;
          const existing = await tx.report.findUnique({ where: { id: r.id } });
          if (!existing) {
            await tx.report.create({ data: r });
            summary.created++;
          } else {
            await tx.report.update({ where: { id: r.id }, data: r });
            summary.updated++;
          }
        }

        // Signatures + Comments (skip if parents missing)
        const signatures: any[] = Array.isArray(payload.signatures) ? payload.signatures : [];
        for (const sig of signatures) {
          if (!sig?.id) continue;
          if (!sig.userId) continue;
          if (!sig.experimentId && !sig.methodId) continue;
          const existing = await tx.signature.findUnique({ where: { id: sig.id } });
          if (!existing) {
            await tx.signature.create({ data: sig });
            summary.created++;
          } else {
            await tx.signature.update({ where: { id: sig.id }, data: sig });
            summary.updated++;
          }
        }

        const comments: any[] = Array.isArray(payload.comments) ? payload.comments : [];
        for (const c of comments) {
          if (!c?.id) continue;
          if (!c.authorId) continue;
          if (!c.experimentId && !c.methodId) continue;
          const existing = await tx.comment.findUnique({ where: { id: c.id } });
          if (!existing) {
            await tx.comment.create({ data: c });
            summary.created++;
          } else {
            await tx.comment.update({ where: { id: c.id }, data: c });
            summary.updated++;
          }
        }

        // ChangeLog: append-only; only create if missing.
        const changeLogs: any[] = Array.isArray(payload.changeLogs) ? payload.changeLogs : [];
        for (const cl of changeLogs) {
          if (!cl?.id) continue;
          const existing = await tx.changeLog.findUnique({ where: { id: cl.id } });
          if (!existing) {
            await tx.changeLog.create({ data: cl });
            summary.created++;
          } else {
            summary.skipped++;
          }
        }
      });

      // Restore files after DB transaction.
      const attachmentsDir = process.env.DATA_DIR || path.join(process.cwd(), 'data', 'attachments');
      const reportsDir = process.env.REPORTS_DIR || path.join(process.cwd(), 'data', 'reports');

      const entries = zip.getEntries();
      for (const entry of entries) {
        if (entry.isDirectory) continue;
        const name = entry.entryName.replace(/\\/g, '/');
        if (name === 'db.json') continue;

        // Only allow attachments/<expId>/<file> and reports/<expId>/<file>
        const parts = name.split('/');
        if (parts.length !== 3) continue;
        const [top, expId, fileName] = parts;
        if (top !== 'attachments' && top !== 'reports') continue;
        if (!isValidUuidSegment(expId)) continue;

        const base = top === 'attachments' ? attachmentsDir : reportsDir;
        // Ensure file name begins with UUID (as used by our upload routes)
        const fileStem = fileName.split('.')[0];
        if (!isValidUuidSegment(fileStem)) continue;

        const ok = safeWriteWithin(base, `${expId}/${fileName}`, entry.getData());
        if (ok) summary.filesWritten++;
      }

      return res.json({ status: 'imported', ...summary });
    } catch (error) {
      console.error('[Sync Import]', error);
      return res.status(500).json({ error: 'Failed to import sync bundle' });
    }
  });

  // Export a portable sync bundle (ZIP) for offline USB transfer.
  // This is intentionally designed for air-gapped environments.
  router.get('/sync/export', async (req, res) => {
    try {
      const user = (req as any).user as { id: string; role?: string } | undefined;

      const now = new Date();
      const safeTimestamp = now.toISOString().replace(/[:.]/g, '-');
      const filename = `eln-usb-sync-${safeTimestamp}.zip`;

      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename=${filename}`);

      const archive = archiver('zip', { zlib: { level: 9 } });
      archive.on('error', (error) => {
        console.error('[Sync Export] Archive error:', error);
        if (!res.headersSent) {
          res.status(500);
        }
        res.end();
      });

      archive.pipe(res);

      // DB snapshot (sanitized): exclude password hashes and API keys.
      const [
        users,
        methods,
        experiments,
        attachments,
        reports,
        locations,
        inventoryItems,
        stocks,
        experimentStocks,
        signatures,
        comments,
        changeLogs,
      ] = await Promise.all([
        prisma.user.findMany({
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
            active: true,
            createdAt: true,
          },
        }),
        prisma.method.findMany(),
        prisma.experiment.findMany(),
        prisma.attachment.findMany(),
        prisma.report.findMany(),
        prisma.location.findMany(),
        prisma.inventoryItem.findMany(),
        prisma.stock.findMany(),
        prisma.experimentStock.findMany(),
        prisma.signature.findMany(),
        prisma.comment.findMany(),
        prisma.changeLog.findMany({ orderBy: { createdAt: 'asc' } }),
      ]);

      const exportData = {
        schemaVersion: 1,
        exportedAt: now.toISOString(),
        exportedBy: user?.id ?? null,
        users,
        methods,
        experiments,
        attachments,
        reports,
        locations,
        inventoryItems,
        stocks,
        experimentStocks,
        signatures,
        comments,
        changeLogs,
      };

      archive.append(JSON.stringify(exportData, null, 2), { name: 'db.json' });

      // Include file storage folders if present.
      const attachmentsDir = process.env.DATA_DIR || path.join(process.cwd(), 'data', 'attachments');
      const reportsDir = process.env.REPORTS_DIR || path.join(process.cwd(), 'data', 'reports');
      if (fs.existsSync(attachmentsDir)) {
        archive.directory(attachmentsDir, 'attachments');
      }
      if (fs.existsSync(reportsDir)) {
        archive.directory(reportsDir, 'reports');
      }

      await archive.finalize();
    } catch (error) {
      console.error('[Sync Export]', error);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to export sync bundle' });
      }
    }
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
