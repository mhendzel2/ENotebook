/**
 * Notifications Routes Module
 */

import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { User } from '@eln/shared';

export function createNotificationsRoutes(prisma: PrismaClient): Router {
  const router = Router();

  router.get('/notifications', async (req, res) => {
    const user = (req as any).user as User;
    const { unreadOnly } = req.query;

    try {
      const where: any = { userId: user.id };
      if (unreadOnly === 'true') where.read = false;

      const notifications = await prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: 50
      });
      res.json(notifications);
    } catch (error) {
      res.status(500).json({ error: 'Database error' });
    }
  });

  router.patch('/notifications/:id/read', async (req, res) => {
    const user = (req as any).user as User;
    try {
      const notification = await prisma.notification.findUnique({ where: { id: req.params.id } });
      if (!notification || notification.userId !== user.id) {
        return res.status(404).json({ error: 'Notification not found' });
      }
      const updated = await prisma.notification.update({
        where: { id: req.params.id },
        data: { read: true }
      });
      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: 'Failed to update notification' });
    }
  });

  router.patch('/notifications/read-all', async (req, res) => {
    const user = (req as any).user as User;
    try {
      await prisma.notification.updateMany({
        where: { userId: user.id, read: false },
        data: { read: true }
      });
      res.json({ status: 'ok' });
    } catch (error) {
      res.status(500).json({ error: 'Failed to update notifications' });
    }
  });

  return router;
}
