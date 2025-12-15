/**
 * Admin Routes Module
 * Provides lab manager/admin visibility across users and records.
 */

import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import type { User } from '@eln/shared/dist/types.js';

export function createAdminRoutes(prisma: PrismaClient): Router {
  const router = Router();

  // Admin: Get all experiments with user information (for lab managers/admins)
  router.get('/admin/experiments', async (req, res) => {
    const user = (req as any).user as User;

    if (user.role !== 'admin' && user.role !== 'manager') {
      return res.status(403).json({ error: 'Admin or manager access required' });
    }

    try {
      const experiments = await prisma.experiment.findMany({
        include: {
          user: { select: { id: true, name: true, email: true, role: true } },
          signatures: { select: { id: true, signatureType: true, timestamp: true } }
        },
        orderBy: { updatedAt: 'desc' }
      });

      res.json(experiments);
    } catch (error) {
      console.error('Failed to get all experiments:', error);
      res.status(500).json({ error: 'Database error' });
    }
  });

  // Admin: Get all methods with creator information
  router.get('/admin/methods', async (req, res) => {
    const user = (req as any).user as User;

    if (user.role !== 'admin' && user.role !== 'manager') {
      return res.status(403).json({ error: 'Admin or manager access required' });
    }

    try {
      const methods = await prisma.method.findMany({
        include: {
          creator: { select: { id: true, name: true, email: true, role: true } }
        },
        orderBy: { updatedAt: 'desc' }
      });

      res.json(methods);
    } catch (error) {
      console.error('Failed to get all methods:', error);
      res.status(500).json({ error: 'Database error' });
    }
  });

  // Admin: Get all users and their activity summary
  router.get('/admin/users', async (req, res) => {
    const user = (req as any).user as User;

    if (user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    try {
      const users = await prisma.user.findMany({
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          active: true,
          createdAt: true,
          _count: {
            select: {
              experiments: true,
              methods: true,
              signatures: true
            }
          }
        },
        orderBy: { name: 'asc' }
      });

      res.json(users);
    } catch (error) {
      console.error('Failed to get users:', error);
      res.status(500).json({ error: 'Database error' });
    }
  });

  // Admin: Get experiments by specific user
  router.get('/admin/users/:userId/experiments', async (req, res) => {
    const user = (req as any).user as User;
    const { userId } = req.params;

    if (user.role !== 'admin' && user.role !== 'manager') {
      return res.status(403).json({ error: 'Admin or manager access required' });
    }

    try {
      const experiments = await prisma.experiment.findMany({
        where: { userId },
        include: {
          user: { select: { id: true, name: true, email: true } },
          signatures: true
        },
        orderBy: { updatedAt: 'desc' }
      });

      res.json(experiments);
    } catch (error) {
      console.error('Failed to get user experiments:', error);
      res.status(500).json({ error: 'Database error' });
    }
  });

  return router;
}
