import type { NextFunction, Request, Response } from 'express';
import type { PrismaClient } from '@prisma/client';
import crypto from 'crypto';
import { jwtVerify, SignJWT, type JWTPayload } from 'jose';

const COOKIE_NAME = 'eln_session';
const ISSUER = 'eln-server';
const AUDIENCE = 'eln-client';

function getSecretKey(): Uint8Array {
  const fromEnv = process.env.AUTH_JWT_SECRET;
  if (fromEnv && fromEnv.trim().length >= 32) {
    return new TextEncoder().encode(fromEnv.trim());
  }

  // Dev-friendly fallback: ephemeral secret. Sessions are invalidated on restart.
  const fallback = crypto.randomBytes(32).toString('hex');
  console.warn('[auth] AUTH_JWT_SECRET not set (or too short). Using an ephemeral secret; sessions will reset on server restart.');
  return new TextEncoder().encode(fallback);
}

const SECRET_KEY = getSecretKey();

function parseCookie(header: string | undefined): Record<string, string> {
  if (!header) return {};
  const out: Record<string, string> = {};
  const parts = header.split(';');
  for (const part of parts) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (!key) continue;
    out[key] = decodeURIComponent(value);
  }
  return out;
}

function getBearerToken(req: Request): string | null {
  const auth = req.header('authorization');
  if (!auth) return null;
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return m?.[1]?.trim() || null;
}

export function getSessionTokenFromRequest(req: Request): string | null {
  const bearer = getBearerToken(req);
  if (bearer) return bearer;

  const cookies = parseCookie(req.header('cookie'));
  return cookies[COOKIE_NAME] || null;
}

export async function verifySessionToken(token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, SECRET_KEY, { issuer: ISSUER, audience: AUDIENCE });
    return typeof payload.sub === 'string' ? payload.sub : null;
  } catch {
    return null;
  }
}

export async function issueSessionToken(userId: string, opts?: { expiresInSeconds?: number }): Promise<string> {
  const expiresInSeconds = opts?.expiresInSeconds ?? 60 * 60 * 8; // 8 hours
  const now = Math.floor(Date.now() / 1000);

  return await new SignJWT({ sub: userId } satisfies JWTPayload)
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt(now)
    .setExpirationTime(now + expiresInSeconds)
    .sign(SECRET_KEY);
}

export function setSessionCookie(res: Response, token: string): void {
  const secure = process.env.NODE_ENV === 'production';
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/',
    maxAge: 1000 * 60 * 60 * 8,
  });
}

export function clearSessionCookie(res: Response): void {
  const secure = process.env.NODE_ENV === 'production';
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/',
  });
}

export function createSessionAuthMiddleware(prisma: PrismaClient) {
  return async (req: Request, res: Response, next: NextFunction) => {
    // Public endpoints
    if (req.path === '/health') return next();
    if (req.path === '/api/auth/login') return next();
    if (req.path === '/api/auth/register') return next();
    if (req.path === '/api/auth/logout') return next();
    if (req.path === '/api/auth/reset-password') return next();
    if (req.path === '/api/auth/password-hint') return next();

    // If API key middleware already attached a user, enforce active and continue.
    const existingUser = (req as any).user;
    if (existingUser) {
      if (existingUser.active === false) {
        return res.status(403).json({ error: 'Account is deactivated' });
      }
      return next();
    }

    // Prefer signed session.
    const token = getSessionTokenFromRequest(req);
    if (token) {
      try {
        const userId = await verifySessionToken(token);
        if (!userId) {
          return res.status(401).json({ error: 'Invalid session' });
        }

        const user = await prisma.user.findUnique({ where: { id: userId } });
        if (!user) return res.status(403).json({ error: 'User not found' });
        if (!user.active) return res.status(403).json({ error: 'Account is deactivated' });

        (req as any).user = user;
        return next();
      } catch {
        return res.status(401).json({ error: 'Invalid or expired session' });
      }
    }

    // Legacy insecure fallback (disabled by default)
    // NOTE: Prefer sessions or API keys. This exists only for transitional support.
    const allowLegacy = process.env.ALLOW_INSECURE_X_USER_ID_AUTH === 'true'
      || (process.env.ALLOW_INSECURE_SYNC_HEADER_AUTH === 'true' && req.path.startsWith('/sync'));

    if (allowLegacy) {
      const userId = req.header('x-user-id');
      if (userId) {
        try {
          const user = await prisma.user.findUnique({ where: { id: userId } });
          if (!user) return res.status(403).json({ error: 'User not found' });
          if (!user.active) return res.status(403).json({ error: 'Account is deactivated' });
          (req as any).user = user;
          return next();
        } catch {
          return res.status(500).json({ error: 'Database error during auth' });
        }
      }
    }

    return res.status(401).json({ error: 'Not authenticated' });
  };
}

export async function issuePasswordResetToken(targetUserId: string, opts?: { expiresInSeconds?: number }): Promise<string> {
  const expiresInSeconds = opts?.expiresInSeconds ?? 60 * 15; // 15 minutes
  const now = Math.floor(Date.now() / 1000);

  return await new SignJWT({ sub: targetUserId, purpose: 'password_reset' } satisfies JWTPayload)
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt(now)
    .setExpirationTime(now + expiresInSeconds)
    .sign(SECRET_KEY);
}

export async function verifyPasswordResetToken(token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, SECRET_KEY, { issuer: ISSUER, audience: AUDIENCE });
    if (payload.purpose !== 'password_reset') return null;
    return typeof payload.sub === 'string' ? payload.sub : null;
  } catch {
    return null;
  }
}
