/**
 * Admin Routes Module
 * Provides lab manager/admin visibility across users and records.
 */

import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
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

  // Admin: Update user role (admin only)
  router.patch('/admin/users/:userId/role', async (req, res) => {
    const user = (req as any).user as User;
    const { userId } = req.params;
    const { role } = req.body;

    // Only admins can change roles
    if (user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required to change user roles' });
    }

    // Validate role
    const validRoles = ['member', 'manager', 'admin'];
    if (!role || !validRoles.includes(role)) {
      return res.status(400).json({ error: 'Invalid role. Must be one of: member, manager, admin' });
    }

    // Prevent admin from changing their own role
    if (userId === user.id) {
      return res.status(400).json({ error: 'Cannot change your own role' });
    }

    try {
      // Check if target user exists
      const targetUser = await prisma.user.findUnique({ where: { id: userId } });
      if (!targetUser) {
        return res.status(404).json({ error: 'User not found' });
      }

      // Update the role
      const updatedUser = await prisma.user.update({
        where: { id: userId },
        data: { role },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          active: true
        }
      });

      res.json(updatedUser);
    } catch (error) {
      console.error('Failed to update user role:', error);
      res.status(500).json({ error: 'Database error' });
    }
  });

  // Admin: Toggle user active status (admin only)
  router.patch('/admin/users/:userId/status', async (req, res) => {
    const user = (req as any).user as User;
    const { userId } = req.params;
    const { active } = req.body;

    if (user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    // Prevent admin from deactivating themselves
    if (userId === user.id) {
      return res.status(400).json({ error: 'Cannot change your own status' });
    }

    if (typeof active !== 'boolean') {
      return res.status(400).json({ error: 'Invalid status. Must be true or false' });
    }

    try {
      const updatedUser = await prisma.user.update({
        where: { id: userId },
        data: { active },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          active: true
        }
      });

      res.json(updatedUser);
    } catch (error) {
      console.error('Failed to update user status:', error);
      res.status(500).json({ error: 'Database error' });
    }
  });

  // Admin/Manager: Reset user password (generates a temporary password)
  router.post('/admin/users/:userId/reset-password', async (req, res) => {
    const user = (req as any).user as User;
    const { userId } = req.params;

    // Both admins and managers can reset passwords
    if (user.role !== 'admin' && user.role !== 'manager') {
      return res.status(403).json({ error: 'Admin or manager access required to reset passwords' });
    }

    // Prevent resetting own password through this endpoint
    if (userId === user.id) {
      return res.status(400).json({ error: 'Cannot reset your own password through admin panel. Use account settings instead.' });
    }

    // Managers cannot reset admin passwords
    const targetUser = await prisma.user.findUnique({ where: { id: userId } });
    if (!targetUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (user.role === 'manager' && targetUser.role === 'admin') {
      return res.status(403).json({ error: 'Managers cannot reset admin passwords' });
    }

    try {
      // Generate a secure temporary password
      const tempPassword = crypto.randomBytes(4).toString('hex'); // 8 character hex string
      const passwordHash = await bcrypt.hash(tempPassword, 10);

      // Update the user's password
      await prisma.user.update({
        where: { id: userId },
        data: { passwordHash }
      });

      // Return the temporary password (admin/manager will communicate it to the user)
      res.json({
        success: true,
        message: `Password reset successfully for ${targetUser.name}`,
        temporaryPassword: tempPassword,
        note: 'Please securely communicate this temporary password to the user. They should change it upon next login.'
      });
    } catch (error) {
      console.error('Failed to reset user password:', error);
      res.status(500).json({ error: 'Failed to reset password' });
    }
  });

  return router;
}
