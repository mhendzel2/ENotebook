/**
 * API Key Authentication and Management
 * Provides programmatic access to the ELN API for third-party scripts and automation
 */

import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import { PrismaClient } from '@prisma/client';
import { API_PERMISSIONS, APIPermission } from '@eln/shared';

const router = Router();

// Extend Express Request to include apiKey
declare global {
  namespace Express {
    interface Request {
      apiKey?: {
        id: string;
        userId: string;
        permissions: APIPermission[];
      };
    }
  }
}

// ==================== API KEY GENERATION ====================

/**
 * Generate a secure API key
 * Format: eln_<random 32 chars>
 */
function generateApiKey(): string {
  const prefix = 'eln_';
  const randomPart = crypto.randomBytes(24).toString('base64url');
  return prefix + randomPart;
}

/**
 * Hash API key for storage
 */
function hashApiKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex');
}

/**
 * Get key prefix for identification
 */
function getKeyPrefix(key: string): string {
  return key.substring(0, 12);
}

// ==================== MIDDLEWARE ====================

/**
 * API Key authentication middleware
 * Checks for x-api-key header and validates the key
 */
export function apiKeyAuth(prisma: PrismaClient) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const apiKeyHeader = req.header('x-api-key');
    
    // If no API key, fall back to user-id based auth
    if (!apiKeyHeader) {
      return next();
    }

    try {
      const keyHash = hashApiKey(apiKeyHeader);
      
      // Find API key in database
      const apiKey = await prisma.aPIKey.findFirst({
        where: {
          keyHash,
          revokedAt: null
        }
      });

      if (!apiKey) {
        return res.status(401).json({ error: 'Invalid API key' });
      }

      // Check expiration
      if (apiKey.expiresAt && new Date(apiKey.expiresAt) < new Date()) {
        return res.status(401).json({ error: 'API key has expired' });
      }

      // Update last used timestamp
      await prisma.aPIKey.update({
        where: { id: apiKey.id },
        data: { lastUsedAt: new Date() }
      });

      // Attach API key info to request
      req.apiKey = {
        id: apiKey.id,
        userId: apiKey.userId,
        permissions: JSON.parse(apiKey.permissions) as APIPermission[]
      };

      // Also set user context
      const user = await prisma.user.findUnique({ where: { id: apiKey.userId } });
      if (user) {
        (req as any).user = user;
      }

      next();
    } catch (error) {
      console.error('API key auth error:', error);
      res.status(500).json({ error: 'Authentication error' });
    }
  };
}

/**
 * Check if request has required permission
 */
export function requirePermission(...permissions: APIPermission[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    // If using user-id auth (not API key), allow through
    if (!req.apiKey) {
      return next();
    }

    // Check if API key has any of the required permissions
    const hasPermission = permissions.some(p => 
      req.apiKey!.permissions.includes(p) || req.apiKey!.permissions.includes('admin')
    );

    if (!hasPermission) {
      return res.status(403).json({ 
        error: 'Insufficient permissions',
        required: permissions 
      });
    }

    next();
  };
}

// ==================== API KEY ROUTES ====================

export function createApiKeyRoutes(prisma: PrismaClient): Router {
  
  const apiKeyCreateSchema = z.object({
    name: z.string().min(1).max(100),
    permissions: z.array(z.enum(API_PERMISSIONS as [string, ...string[]])).min(1),
    expiresAt: z.string().datetime().optional()
  });

  // List user's API keys
  router.get('/api-keys', async (req, res) => {
    const user = (req as any).user;
    
    try {
      const keys = await prisma.aPIKey.findMany({
        where: { 
          userId: user.id,
          revokedAt: null
        },
        select: {
          id: true,
          name: true,
          keyPrefix: true,
          permissions: true,
          expiresAt: true,
          lastUsedAt: true,
          createdAt: true
        },
        orderBy: { createdAt: 'desc' }
      });

      res.json(keys.map(k => ({
        ...k,
        permissions: JSON.parse(k.permissions)
      })));
    } catch (error) {
      res.status(500).json({ error: 'Failed to list API keys' });
    }
  });

  // Create new API key
  router.post('/api-keys', async (req, res) => {
    const user = (req as any).user;
    const parse = apiKeyCreateSchema.safeParse(req.body);
    
    if (!parse.success) {
      return res.status(400).json({ error: parse.error.flatten() });
    }

    try {
      // Generate the key
      const key = generateApiKey();
      const keyHash = hashApiKey(key);
      const keyPrefix = getKeyPrefix(key);

      // Store in database
      const apiKey = await prisma.aPIKey.create({
        data: {
          userId: user.id,
          name: parse.data.name,
          keyHash,
          keyPrefix,
          permissions: JSON.stringify(parse.data.permissions),
          expiresAt: parse.data.expiresAt ? new Date(parse.data.expiresAt) : null
        }
      });

      // Return the key (only shown once!)
      res.status(201).json({
        key, // Only returned on creation
        apiKey: {
          id: apiKey.id,
          name: apiKey.name,
          keyPrefix: apiKey.keyPrefix,
          permissions: parse.data.permissions,
          expiresAt: apiKey.expiresAt,
          createdAt: apiKey.createdAt
        }
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to create API key' });
    }
  });

  // Revoke API key
  router.delete('/api-keys/:id', async (req, res) => {
    const user = (req as any).user;
    const { id } = req.params;

    try {
      const apiKey = await prisma.aPIKey.findFirst({
        where: { id, userId: user.id }
      });

      if (!apiKey) {
        return res.status(404).json({ error: 'API key not found' });
      }

      await prisma.aPIKey.update({
        where: { id },
        data: { revokedAt: new Date() }
      });

      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: 'Failed to revoke API key' });
    }
  });

  return router;
}

// ==================== RATE LIMITING ====================

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const rateLimitStore = new Map<string, RateLimitEntry>();

export function rateLimit(options: { windowMs: number; max: number }) {
  return (req: Request, res: Response, next: NextFunction) => {
    const key = req.apiKey?.id || req.header('x-user-id') || req.ip;
    const now = Date.now();
    
    let entry = rateLimitStore.get(key);
    
    if (!entry || now > entry.resetAt) {
      entry = {
        count: 0,
        resetAt: now + options.windowMs
      };
    }
    
    entry.count++;
    rateLimitStore.set(key, entry);
    
    // Set rate limit headers
    res.setHeader('X-RateLimit-Limit', options.max);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, options.max - entry.count));
    res.setHeader('X-RateLimit-Reset', Math.ceil(entry.resetAt / 1000));
    
    if (entry.count > options.max) {
      return res.status(429).json({ 
        error: 'Too many requests',
        retryAfter: Math.ceil((entry.resetAt - now) / 1000)
      });
    }
    
    next();
  };
}

// Clean up expired rate limit entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitStore.entries()) {
    if (now > entry.resetAt) {
      rateLimitStore.delete(key);
    }
  }
}, 60000); // Clean every minute

export default router;
