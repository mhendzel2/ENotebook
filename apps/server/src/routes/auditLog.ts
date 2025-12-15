/**
 * Audit Log Routes Module
 * Exposes change log history stored in ChangeLog.
 */

import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import type { User } from '@eln/shared/dist/types.js';

export function createAuditLogRoutes(prisma: PrismaClient): Router {
  const router = Router();

  router.get('/audit-log', async (req, res) => {
    const user = (req as any).user as User;
    if (user.role !== 'manager' && user.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { entityType, entityId, limit = 100 } = req.query;
    try {
      const where: any = {};
      if (entityType) where.entityType = entityType;
      if (entityId) where.entityId = entityId;

      const logs = await prisma.changeLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: Number(limit)
      });

      res.json(
        logs.map(log => ({
          ...log,
          oldValue: log.oldValue ? JSON.parse(log.oldValue) : undefined,
          newValue: log.newValue ? JSON.parse(log.newValue) : undefined
        }))
      );
    } catch (error) {
      res.status(500).json({ error: 'Database error' });
    }
  });

  return router;
}
