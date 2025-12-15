/**
 * Sync Routes Module
 * Implements push/pull sync for offline/local clients.
 */

import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';

import { experimentSchema } from './experiments.js';
import { methodSchema } from './methods.js';

export function createSyncRoutes(prisma: PrismaClient): Router {
  const router = Router();

  const syncPayloadSchema = z.object({
    methods: z.array(methodSchema.extend({ id: z.string().uuid(), version: z.number().int().positive(), updatedAt: z.string() })),
    experiments: z.array(
      experimentSchema.extend({
        id: z.string().uuid(),
        userId: z.string(),
        version: z.number().int().positive(),
        createdAt: z.string(),
        updatedAt: z.string()
      })
    )
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
      await prisma.$transaction(async (tx) => {
        // Handle Experiments
        for (const incExp of experiments) {
          const existing = await tx.experiment.findUnique({ where: { id: incExp.id } });

          const { params, observations, tags, ...rest } = incExp;
          const dataToSave = {
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

  // Pull full dataset from server
  router.get('/sync/pull', async (_req, res) => {
    try {
      const methods = await prisma.method.findMany();
      const experiments = await prisma.experiment.findMany();
      res.json({ methods, experiments });
    } catch (error) {
      res.status(500).json({ error: 'Database error' });
    }
  });

  return router;
}
