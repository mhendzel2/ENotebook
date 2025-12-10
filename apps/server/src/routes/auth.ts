import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';
import { z } from 'zod';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const registerSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
});

/**
 * Hash password using SHA-256 with salt
 */
function hashPassword(password: string, salt?: string): { hash: string; salt: string } {
  const useSalt = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, useSalt, 10000, 64, 'sha512').toString('hex');
  return { hash, salt: useSalt };
}

/**
 * Verify password against stored hash
 */
function verifyPassword(password: string, storedHash: string): boolean {
  // storedHash format: salt:hash
  const [salt, hash] = storedHash.split(':');
  if (!salt || !hash) return false;
  const { hash: computedHash } = hashPassword(password, salt);
  return computedHash === hash;
}

export function createAuthRoutes(prisma: PrismaClient) {
  const router = Router();

  /**
   * POST /api/auth/register
   * Create a new user account
   */
  router.post('/api/auth/register', async (req, res) => {
    const parse = registerSchema.safeParse(req.body);
    if (!parse.success) {
      return res.status(400).json({ error: parse.error.flatten() });
    }

    const { name, email, password } = parse.data;

    try {
      // Check if user already exists
      const existingUser = await prisma.user.findUnique({ where: { email } });
      if (existingUser) {
        return res.status(409).json({ error: 'Email already registered' });
      }

      // Hash password
      const { hash, salt } = hashPassword(password);
      const passwordHash = `${salt}:${hash}`;

      // Create user - first user is admin, rest are members
      const userCount = await prisma.user.count();
      const role = userCount === 0 ? 'admin' : 'member';

      const user = await prisma.user.create({
        data: {
          name,
          email,
          passwordHash,
          role,
          active: true,
        },
      });

      // Return user without password hash
      res.status(201).json({
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      });
    } catch (error) {
      console.error('Registration error:', error);
      res.status(500).json({ error: 'Failed to create account' });
    }
  });

  /**
   * POST /api/auth/login
   * Authenticate user and return session
   */
  router.post('/api/auth/login', async (req, res) => {
    const parse = loginSchema.safeParse(req.body);
    if (!parse.success) {
      return res.status(400).json({ error: parse.error.flatten() });
    }

    const { email, password } = parse.data;

    try {
      // Find user by email
      const user = await prisma.user.findUnique({ where: { email } });
      if (!user) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }

      // Check if user is active
      if (!user.active) {
        return res.status(403).json({ error: 'Account is deactivated' });
      }

      // Verify password
      if (!verifyPassword(password, user.passwordHash)) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }

      // Return user without password hash
      res.json({
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      });
    } catch (error) {
      console.error('Login error:', error);
      res.status(500).json({ error: 'Login failed' });
    }
  });

  /**
   * POST /api/auth/logout
   * Logout user (clears any server-side session if implemented)
   */
  router.post('/api/auth/logout', async (_req, res) => {
    // For now, just return success since we're using client-side storage
    res.json({ success: true });
  });

  /**
   * GET /api/auth/me
   * Get current user info (requires authentication)
   */
  router.get('/api/auth/me', async (req, res) => {
    const userId = req.header('x-user-id');
    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    try {
      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      res.json({
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to get user info' });
    }
  });

  /**
   * PUT /api/auth/password
   * Change user password
   */
  router.put('/api/auth/password', async (req, res) => {
    const userId = req.header('x-user-id');
    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const schema = z.object({
      currentPassword: z.string(),
      newPassword: z.string().min(8),
    });

    const parse = schema.safeParse(req.body);
    if (!parse.success) {
      return res.status(400).json({ error: parse.error.flatten() });
    }

    const { currentPassword, newPassword } = parse.data;

    try {
      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      // Verify current password
      if (!verifyPassword(currentPassword, user.passwordHash)) {
        return res.status(401).json({ error: 'Current password is incorrect' });
      }

      // Hash new password
      const { hash, salt } = hashPassword(newPassword);
      const passwordHash = `${salt}:${hash}`;

      await prisma.user.update({
        where: { id: userId },
        data: { passwordHash },
      });

      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: 'Failed to change password' });
    }
  });

  return router;
}
