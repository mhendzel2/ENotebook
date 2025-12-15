/**
 * Methods Routes Module
 * Handles all method-related CRUD operations, versioning, signatures, and comments
 */

import { Router } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';
import type { User } from '@eln/shared/dist/types.js';
import { 
  asyncHandler, 
  NotFoundError, 
  ForbiddenError, 
  ValidationError
} from '../middleware/errorHandler.js';

// ==================== SCHEMAS ====================

export const methodSchema = z.object({
  title: z.string().min(1),
  category: z.string().optional(),
  steps: z.any(),
  reagents: z.any().optional(),
  attachments: z.any().optional(),
  isPublic: z.boolean().default(true)
});

export const methodUpdateSchema = methodSchema.partial().refine(
  (val) => Object.keys(val).length > 0,
  { message: 'At least one field must be provided for update' }
);

// ==================== HELPERS ====================

function canEditMethod(user: User, method: { createdBy: string | null }): boolean {
  return user.role === 'manager' || user.role === 'admin' || method.createdBy === user.id;
}

function computeContentHash(content: any): string {
  return crypto.createHash('sha256').update(JSON.stringify(content)).digest('hex');
}

// ==================== ROUTE FACTORY ====================

export function createMethodsRoutes(
  prisma: PrismaClient,
  logChange: (entityType: string, entityId: string, operation: string, oldValue?: any, newValue?: any) => Promise<void>
) {
  const router = Router();

  // ==================== LIST METHODS ====================

  router.get('/methods', asyncHandler(async (_req, res) => {
    const methods = await prisma.method.findMany();
    res.json(methods);
  }));

  // ==================== CREATE METHOD ====================

  router.post('/methods', asyncHandler(async (req, res) => {
    const user = (req as any).user as User;
    const parse = methodSchema.safeParse(req.body);
    
    if (!parse.success) {
      throw new ValidationError('Invalid method data', parse.error.flatten());
    }
    
    const { steps, reagents, attachments, ...rest } = parse.data;
    const method = await prisma.method.create({
      data: {
        createdBy: user.id,
        version: 1,
        ...rest,
        steps: steps,
        reagents: reagents || undefined,
        attachments: attachments || undefined
      }
    });
    
    res.status(201).json(method);
  }));

  // ==================== UPDATE METHOD ====================

  router.patch('/methods/:id', asyncHandler(async (req, res) => {
    const user = (req as any).user as User;
    const parse = methodUpdateSchema.safeParse(req.body);

    if (!parse.success) {
      throw new ValidationError('Invalid update data', parse.error.flatten());
    }

    const methodId = req.params.id;
    const existing = await prisma.method.findUnique({ where: { id: methodId } });
    
    if (!existing) {
      throw new NotFoundError('Method', methodId);
    }

    if (!canEditMethod(user, existing)) {
      throw new ForbiddenError('Not authorized to edit this method');
    }

    const { steps, reagents, attachments, ...rest } = parse.data;
    const updateData: any = { ...rest };
    if (steps !== undefined) updateData.steps = steps;
    if (reagents !== undefined) updateData.reagents = reagents || undefined;
    if (attachments !== undefined) updateData.attachments = attachments || undefined;
    updateData.version = (existing.version || 1) + 1;

    const updated = await prisma.method.update({ where: { id: methodId }, data: updateData });

    await logChange('methods', methodId, 'update', existing, updated);

    res.json(updated);
  }));

  // ==================== METHOD VERSIONING ====================

  router.post('/methods/:id/new-version', asyncHandler(async (req, res) => {
    const user = (req as any).user as User;
    const { id } = req.params;

    const original = await prisma.method.findUnique({ where: { id } });
    if (!original) {
      throw new NotFoundError('Method', id);
    }

    // Find the root parent (original method)
    const rootId = original.parentMethodId || original.id;

    // Get the latest version number
    const latestVersion = await prisma.method.findFirst({
      where: { OR: [{ id: rootId }, { parentMethodId: rootId }] },
      orderBy: { version: 'desc' }
    });

    const newVersion = await prisma.method.create({
      data: {
        title: original.title,
        category: original.category,
        steps: original.steps as any,
        reagents: original.reagents as any,
        attachments: original.attachments as any,
        createdBy: user.id,
        version: (latestVersion?.version || 0) + 1,
        isPublic: original.isPublic,
        parentMethodId: rootId
      }
    });

    res.status(201).json(newVersion);
  }));

  router.get('/methods/:id/versions', asyncHandler(async (req, res) => {
    const { id } = req.params;
    
    const method = await prisma.method.findUnique({ where: { id } });
    if (!method) {
      throw new NotFoundError('Method', id);
    }

    const rootId = method.parentMethodId || method.id;
    const versions = await prisma.method.findMany({
      where: { OR: [{ id: rootId }, { parentMethodId: rootId }] },
      orderBy: { version: 'desc' }
    });

    res.json(versions);
  }));

  // ==================== METHOD SIGNATURES ====================

  const signatureSchema = z.object({
    signatureType: z.enum(['author', 'witness', 'reviewer', 'approver']),
    meaning: z.string().optional()
  });

  router.post('/methods/:id/sign', asyncHandler(async (req, res) => {
    const user = (req as any).user as User;
    const { id } = req.params;
    const parse = signatureSchema.safeParse(req.body);
    
    if (!parse.success) {
      throw new ValidationError('Invalid signature data', parse.error.flatten());
    }

    const method = await prisma.method.findUnique({ where: { id } });
    if (!method) {
      throw new NotFoundError('Method', id);
    }

    const contentHash = computeContentHash(method);

    const signature = await prisma.signature.create({
      data: {
        userId: user.id,
        methodId: id,
        signatureType: parse.data.signatureType,
        meaning: parse.data.meaning,
        contentHash,
        ipAddress: req.ip,
        userAgent: req.get('user-agent')
      }
    });

    res.status(201).json(signature);
  }));

  // ==================== METHOD COMMENTS ====================

  const commentSchema = z.object({
    content: z.string().min(1),
    parentId: z.string().uuid().optional()
  });

  router.get('/methods/:id/comments', asyncHandler(async (req, res) => {
    const comments = await prisma.comment.findMany({
      where: { methodId: req.params.id },
      include: { 
        author: { select: { id: true, name: true } },
        replies: { include: { author: { select: { id: true, name: true } } } }
      },
      orderBy: { createdAt: 'asc' }
    });
    res.json(comments.filter(c => !c.parentId));
  }));

  router.post('/methods/:id/comments', asyncHandler(async (req, res) => {
    const user = (req as any).user as User;
    const { id } = req.params;
    const parse = commentSchema.safeParse(req.body);
    
    if (!parse.success) {
      throw new ValidationError('Invalid comment data', parse.error.flatten());
    }

    const method = await prisma.method.findUnique({ where: { id } });
    if (!method) {
      throw new NotFoundError('Method', id);
    }

    const comment = await prisma.comment.create({
      data: {
        content: parse.data.content,
        authorId: user.id,
        methodId: id,
        parentId: parse.data.parentId
      },
      include: { author: { select: { id: true, name: true } } }
    });

    res.status(201).json(comment);
  }));

  return router;
}
