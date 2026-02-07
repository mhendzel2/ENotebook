import { Router } from 'express';
import { PrismaClient, type User as PrismaUser } from '@prisma/client';
import crypto from 'crypto';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import type { AuditTrailService } from '../services/auditTrail.js';
import {
  clearSessionCookie,
  issuePasswordResetToken,
  issueSessionToken,
  getSessionTokenFromRequest,
  setSessionCookie,
  verifySessionToken,
  verifyPasswordResetToken,
} from '../middleware/sessionAuth.js';

const loginSchema = z.object({
  identifier: z.string().min(1).optional(),
  email: z.string().email().optional(),
  username: z.string().min(1).optional(),
  password: z.string().min(1),
}).refine((data) => Boolean(data.identifier || data.email || data.username), {
  message: 'identifier, email, or username is required',
});

const registerSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(12),
  bootstrapSecret: z.string().optional(),
  passwordHint: z.string().max(200).optional(),
});

function isBcryptHash(storedHash: string): boolean {
  return storedHash.startsWith('$2a$') || storedHash.startsWith('$2b$') || storedHash.startsWith('$2y$');
}

function verifyLegacyPbkdf2(password: string, storedHash: string): boolean {
  // legacy storedHash format: salt:hash
  const [salt, hash] = storedHash.split(':');
  if (!salt || !hash) return false;
  const computedHash = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
  return computedHash === hash;
}

async function verifyPassword(password: string, storedHash: string): Promise<{ ok: boolean; needsMigration: boolean }> {
  if (isBcryptHash(storedHash)) {
    return { ok: await bcrypt.compare(password, storedHash), needsMigration: false };
  }

  const ok = verifyLegacyPbkdf2(password, storedHash);
  return { ok, needsMigration: ok };
}

function validatePasswordPolicy(password: string): string | null {
  if (password.length < 12) return 'Password must be at least 12 characters';
  const hasLower = /[a-z]/.test(password);
  const hasUpper = /[A-Z]/.test(password);
  const hasDigit = /\d/.test(password);
  const hasSymbol = /[^A-Za-z0-9]/.test(password);
  const score = [hasLower, hasUpper, hasDigit, hasSymbol].filter(Boolean).length;
  if (score < 3) return 'Password must include at least 3 of: lowercase, uppercase, number, symbol';
  return null;
}

const loginLimiter = rateLimit({
  windowMs: 60_000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
});

const registerLimiter = rateLimit({
  windowMs: 60_000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
});

const passwordLimiter = rateLimit({
  windowMs: 60_000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
});

const passwordHintLimiter = rateLimit({
  windowMs: 60_000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
});

export function createAuthRoutes(prisma: PrismaClient, auditService?: AuditTrailService) {
  const router = Router();

  async function findUserByLoginIdentifier(identifier: string): Promise<PrismaUser | { ambiguous: true } | null> {
    const input = identifier.trim();
    if (input.length === 0) return null;

    const byEmail = await prisma.user.findFirst({
      where: { email: { equals: input, mode: 'insensitive' } },
    });
    if (byEmail) return byEmail;

    const byName = await prisma.user.findMany({
      where: { name: { equals: input, mode: 'insensitive' } },
      take: 2,
    });

    if (byName.length > 1) {
      return { ambiguous: true as const };
    }
    return byName[0] || null;
  }

  /**
   * POST /api/auth/register
   * Create a new user account
   */
  router.post('/api/auth/register', registerLimiter, async (req, res) => {
    const parse = registerSchema.safeParse(req.body);
    if (!parse.success) {
      return res.status(400).json({ error: parse.error.flatten() });
    }

    const { name, email, password, bootstrapSecret, passwordHint } = parse.data;

    const policyError = validatePasswordPolicy(password);
    if (policyError) {
      return res.status(400).json({ error: policyError });
    }

    try {
      // Check if user already exists
      const existingUser = await prisma.user.findUnique({ where: { email } });
      if (existingUser) {
        return res.status(409).json({ error: 'Email already registered' });
      }

      // Create user - first user is admin, rest are members
      const userCount = await prisma.user.count();
      if (userCount === 0) {
        const bootstrap = process.env.BOOTSTRAP_ADMIN_SECRET;
        if (bootstrap && bootstrap.trim().length > 0) {
          if (bootstrapSecret !== bootstrap.trim()) {
            return res.status(403).json({ error: 'Bootstrap secret required to create the first admin user' });
          }
        } else {
          console.warn('[auth] First-user admin creation is enabled without BOOTSTRAP_ADMIN_SECRET. Set it to harden initial provisioning.');
        }
      }

      // Hash password (bcrypt)
      const passwordHash = await bcrypt.hash(password, 12);

      const role = userCount === 0 ? 'admin' : 'member';

      const user = await prisma.user.create({
        data: {
          name,
          email,
          passwordHash,
          passwordHint: passwordHint?.trim() ? passwordHint.trim() : null,
          role,
          active: true,
        },
      });

      const token = await issueSessionToken(user.id);
      setSessionCookie(res, token);

      if (auditService) {
        try {
          await auditService.log(user.id, user.name, 'create', 'user', user.id, { method: 'register', email: user.email, role: user.role });
        } catch {
          // best-effort
        }
      }

      // Return user without password hash
      res.status(201).json({
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        token,
      });
    } catch (error) {
      console.error('Registration error:', error);
      res.status(500).json({ error: 'Failed to create account' });
    }
  });

  /**
   * POST /api/auth/password-hint
   * Returns the stored password hint (if set) for the provided email.
   * Note: A hint helps a user remember a password; it does not recover/decrypt it.
   */
  router.post('/api/auth/password-hint', passwordHintLimiter, async (req, res) => {
    const schema = z.object({ email: z.string().email() });
    const parse = schema.safeParse(req.body);
    if (!parse.success) {
      return res.status(400).json({ error: parse.error.flatten() });
    }

    const { email } = parse.data;

    try {
      const user = await prisma.user.findUnique({
        where: { email },
        select: { passwordHint: true, active: true },
      });

      // Always return 200 to reduce account enumeration. If the email doesn't exist or is inactive,
      // return null.
      if (!user || !user.active) {
        return res.json({ hint: null });
      }

      return res.json({ hint: user.passwordHint || null });
    } catch (error) {
      console.error('Password hint error:', error);
      return res.status(500).json({ error: 'Failed to retrieve hint' });
    }
  });

  /**
   * POST /api/auth/login
   * Authenticate user and return session
   */
  router.post('/api/auth/login', loginLimiter, async (req, res) => {
    const parse = loginSchema.safeParse(req.body);
    if (!parse.success) {
      return res.status(400).json({ error: parse.error.flatten() });
    }

    const { password } = parse.data;
    const identifier = (parse.data.identifier || parse.data.email || parse.data.username || '').trim();
    try {
      // Find user by email (preferred) or username.
      const found = await findUserByLoginIdentifier(identifier);
      if (found && 'ambiguous' in found) {
        return res.status(409).json({ error: 'Multiple accounts match this username. Please sign in with email.' });
      }
      const user = found;
      if (!user) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }

      // Check if user is active
      if (!user.active) {
        return res.status(403).json({ error: 'Account is deactivated' });
      }

      // Verify password
      const verification = await verifyPassword(password, user.passwordHash);
      if (!verification.ok) {
        if (auditService) {
          try {
            await auditService.log(user.id, user.name, 'login', 'user', user.id, { success: false }, { ipAddress: req.ip, userAgent: req.header('user-agent') || undefined });
          } catch {
            // best-effort
          }
        }
        return res.status(401).json({ error: 'Invalid email or password' });
      }

      if (verification.needsMigration) {
        try {
          const newHash = await bcrypt.hash(password, 12);
          await prisma.user.update({ where: { id: user.id }, data: { passwordHash: newHash } });
        } catch {
          // best-effort migration
        }
      }

      const token = await issueSessionToken(user.id);
      setSessionCookie(res, token);

      if (auditService) {
        try {
          await auditService.log(user.id, user.name, 'login', 'user', user.id, { success: true }, { ipAddress: req.ip, userAgent: req.header('user-agent') || undefined });
        } catch {
          // best-effort
        }
      }

      // Return user without password hash
      res.json({
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        token,
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
  router.post('/api/auth/logout', async (req, res) => {
    // Best-effort audit log (logout is allowed even when already logged out)
    if (auditService) {
      try {
        const token = getSessionTokenFromRequest(req);
        if (token) {
          const userId = await verifySessionToken(token);
          if (userId) {
            const user = await prisma.user.findUnique({ where: { id: userId } });
            if (user) {
              await auditService.log(
                user.id,
                user.name,
                'logout',
                'user',
                user.id,
                { success: true },
                { ipAddress: req.ip, userAgent: req.header('user-agent') || undefined }
              );
            }
          }
        }
      } catch {
        // best-effort
      }
    }

    clearSessionCookie(res);
    res.json({ success: true });
  });

  /**
   * POST /api/auth/reset-password
   * Reset password using a signed, expiring token
   */
  router.post('/api/auth/reset-password', passwordLimiter, async (req, res) => {
    const schema = z.object({
      token: z.string().min(1),
      newPassword: z.string().min(12),
    });

    const parse = schema.safeParse(req.body);
    if (!parse.success) {
      return res.status(400).json({ error: parse.error.flatten() });
    }

    const { token, newPassword } = parse.data;
    const policyError = validatePasswordPolicy(newPassword);
    if (policyError) {
      return res.status(400).json({ error: policyError });
    }

    const userId = await verifyPasswordResetToken(token);
    if (!userId) {
      return res.status(401).json({ error: 'Invalid or expired reset token' });
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (!user.active) return res.status(403).json({ error: 'Account is deactivated' });

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await prisma.user.update({ where: { id: userId }, data: { passwordHash } });

    if (auditService) {
      try {
        await auditService.log(user.id, user.name, 'update', 'user', user.id, { method: 'reset-password' }, { ipAddress: req.ip, userAgent: req.header('user-agent') || undefined });
      } catch {
        // best-effort
      }
    }

    res.json({ success: true });
  });

  /**
   * GET /api/auth/me
   * Get current user info (requires authentication)
   */
  router.get('/api/auth/me', async (req, res) => {
    try {
      const user = (req as any).user;
      if (!user) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const freshUser = await prisma.user.findUnique({ where: { id: user.id } });
      if (!freshUser) {
        return res.status(404).json({ error: 'User not found' });
      }

      if (!freshUser.active) {
        return res.status(403).json({ error: 'Account is deactivated' });
      }

      res.json({
        id: freshUser.id,
        name: freshUser.name,
        email: freshUser.email,
        role: freshUser.role,
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to get user info' });
    }
  });

  /**
   * PUT /api/auth/password
   * Change user password
   */
  router.put('/api/auth/password', passwordLimiter, async (req, res) => {
    const userCtx = (req as any).user;
    if (!userCtx) return res.status(401).json({ error: 'Not authenticated' });

    const schema = z.object({
      currentPassword: z.string(),
      newPassword: z.string().min(12),
    });

    const parse = schema.safeParse(req.body);
    if (!parse.success) {
      return res.status(400).json({ error: parse.error.flatten() });
    }

    const { currentPassword, newPassword } = parse.data;

    const policyError = validatePasswordPolicy(newPassword);
    if (policyError) {
      return res.status(400).json({ error: policyError });
    }

    try {
      const user = await prisma.user.findUnique({ where: { id: userCtx.id } });
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      if (!user.active) {
        return res.status(403).json({ error: 'Account is deactivated' });
      }

      // Verify current password
      const verification = await verifyPassword(currentPassword, user.passwordHash);
      if (!verification.ok) {
        return res.status(401).json({ error: 'Current password is incorrect' });
      }

      // Hash new password
      const passwordHash = await bcrypt.hash(newPassword, 12);

      await prisma.user.update({
        where: { id: userCtx.id },
        data: { passwordHash },
      });

      if (auditService) {
        try {
          await auditService.log(user.id, user.name, 'update', 'user', user.id, { method: 'change-password' }, { ipAddress: req.ip, userAgent: req.header('user-agent') || undefined });
        } catch {
          // best-effort
        }
      }

      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: 'Failed to change password' });
    }
  });

  return router;
}
