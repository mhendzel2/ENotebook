/**
 * Experiments Routes Module
 * Handles all experiment-related CRUD operations, search, and project organization
 */

import { Router } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { PrismaClient } from '@prisma/client';
import { MODALITIES, EXPERIMENT_STATUSES, SIGNATURE_TYPES } from '@eln/shared/dist/types.js';
import type { User } from '@eln/shared/dist/types.js';
import { 
  asyncHandler, 
  NotFoundError, 
  ForbiddenError, 
  ValidationError,
  errorResponse
} from '../middleware/errorHandler.js';

// ==================== SCHEMAS ====================

const modalityEnum = z.enum(MODALITIES as unknown as [string, ...string[]]);
const experimentStatusEnum = z.enum(EXPERIMENT_STATUSES as unknown as [string, ...string[]]);
const signatureTypeEnum = z.enum(SIGNATURE_TYPES as unknown as [string, ...string[]]);

export const experimentSchema = z.object({
  title: z.string().min(1),
  project: z.string().optional(),
  modality: modalityEnum,
  protocolRef: z.string().optional(),
  params: z.any().optional(),
  observations: z.any().optional(),
  resultsSummary: z.string().optional(),
  dataLink: z.string().optional(),
  tags: z.array(z.string()).optional(),
  status: experimentStatusEnum.default('draft')
});

export const experimentUpdateSchema = experimentSchema.partial().refine(
  (val) => Object.keys(val).length > 0,
  { message: 'At least one field must be provided for update' }
);

// ==================== HELPERS ====================

function coerceQueryString(value: unknown, maxLen: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, maxLen);
}

function coerceQueryInt(value: unknown, defaultValue: number, min: number, max: number): number {
  if (typeof value !== 'string') return defaultValue;
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return defaultValue;
  return Math.max(min, Math.min(max, n));
}

function safeSingleLineSnippet(text: string, maxLen: number): string {
  return text.replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, maxLen);
}

function canAccessExperiment(user: User, experiment: { userId: string }): boolean {
  return user.role === 'manager' || user.role === 'admin' || experiment.userId === user.id;
}

// ==================== ROUTE FACTORY ====================

export function createExperimentsRoutes(
  prisma: PrismaClient,
  logChange: (entityType: string, entityId: string, operation: string, oldValue?: any, newValue?: any) => Promise<void>
) {
  const router = Router();

  // Rate limiter for search
  const searchResultsLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
      const userId = (req as any).user?.id;
      return userId || req.ip || 'anonymous';
    }
  });

  // ==================== LIST EXPERIMENTS ====================

  router.get('/experiments', asyncHandler(async (req, res) => {
    const user = (req as any).user as User;
    const where = user.role === 'manager' || user.role === 'admin' ? {} : { userId: user.id };
    const data = await prisma.experiment.findMany({ where });
    res.json(data);
  }));

  // ==================== GET SINGLE EXPERIMENT ====================

  router.get('/experiments/:id', asyncHandler(async (req, res) => {
    const user = (req as any).user as User;
    const { id } = req.params;
    
    const experiment = await prisma.experiment.findUnique({
      where: { id },
      include: {
        attachments: true,
        reports: true,
        signatures: {
          include: {
            user: { select: { id: true, name: true, email: true } }
          }
        },
        comments: {
          include: {
            author: { select: { id: true, name: true } }
          },
          orderBy: { createdAt: 'desc' }
        },
        stockUsages: {
          include: {
            stock: {
              include: {
                item: { select: { name: true, catalogNumber: true } }
              }
            }
          }
        },
        user: { select: { id: true, name: true, email: true } }
      }
    });
    
    if (!experiment) {
      throw new NotFoundError('Experiment', id);
    }
    
    if (!canAccessExperiment(user, experiment)) {
      throw new ForbiddenError('Not authorized to view this experiment');
    }
    
    res.json(experiment);
  }));

  // ==================== SEARCH RESULTS ====================

  router.get('/search/results', searchResultsLimiter, asyncHandler(async (req, res) => {
    const user = (req as any).user as User;

    const q = coerceQueryString(req.query.q, 200);
    if (!q) throw new ValidationError('Missing query parameter: q');

    const limit = coerceQueryInt(req.query.limit, 25, 1, 50);
    const offset = coerceQueryInt(req.query.offset, 0, 0, 5000);
    const typesRaw = coerceQueryString(req.query.types, 100);
    const types = (typesRaw ? typesRaw.split(',') : ['experiments', 'reports'])
      .map(t => t.trim().toLowerCase())
      .filter(Boolean);
    const includeExperiments = types.includes('experiments') || types.includes('experiment');
    const includeReports = types.includes('reports') || types.includes('report');

    const qLower = q.toLowerCase();
    const experimentAccessWhere = user.role === 'manager' || user.role === 'admin' ? {} : { userId: user.id };

    type SearchResult =
      | { type: 'experiment'; experimentId: string; title: string; project: string | null; updatedAt: Date; snippet: string; }
      | { type: 'report'; reportId: string; experimentId: string; title: string; project: string | null; updatedAt: Date; reportType: string; filename: string; snippet: string; };

    const matches: SearchResult[] = [];

    if (includeExperiments) {
      const scanExperimentLimit = 2000;
      const experiments = await prisma.experiment.findMany({
        where: experimentAccessWhere,
        orderBy: { updatedAt: 'desc' },
        take: scanExperimentLimit,
        select: {
          id: true,
          title: true,
          project: true,
          resultsSummary: true,
          observations: true,
          tags: true,
          updatedAt: true
        }
      });

      for (const exp of experiments) {
        const parts: string[] = [];
        parts.push(exp.title);
        if (exp.project) parts.push(exp.project);
        if (exp.resultsSummary) parts.push(exp.resultsSummary);
        if (Array.isArray(exp.tags)) parts.push(exp.tags.join(' '));

        if (exp.observations !== null && exp.observations !== undefined) {
          try {
            const obsStr = typeof exp.observations === 'string' ? exp.observations : JSON.stringify(exp.observations);
            if (obsStr) parts.push(obsStr.slice(0, 20000));
          } catch {
            // ignore non-serializable observations
          }
        }

        const haystack = parts.join('\n');
        if (!haystack.toLowerCase().includes(qLower)) continue;

        const snippetSource = exp.resultsSummary || (typeof exp.observations === 'string' ? exp.observations : '') || haystack;
        matches.push({
          type: 'experiment',
          experimentId: exp.id,
          title: exp.title,
          project: exp.project,
          updatedAt: exp.updatedAt,
          snippet: safeSingleLineSnippet(String(snippetSource), 220)
        });
      }
    }

    if (includeReports) {
      const scanReportLimit = 2000;
      const reports = await prisma.report.findMany({
        where: { experiment: experimentAccessWhere },
        orderBy: { updatedAt: 'desc' },
        take: scanReportLimit,
        include: { experiment: { select: { id: true, title: true, project: true } } }
      });

      for (const report of reports) {
        const text = [
          report.reportType,
          report.filename,
          report.originalFilename || '',
          report.notes || ''
        ].join('\n');
        if (!text.toLowerCase().includes(qLower)) continue;

        matches.push({
          type: 'report',
          reportId: report.id,
          experimentId: report.experimentId,
          title: report.experiment.title,
          project: report.experiment.project,
          updatedAt: report.updatedAt,
          reportType: report.reportType,
          filename: report.originalFilename || report.filename,
          snippet: safeSingleLineSnippet(report.notes || `${report.reportType}: ${report.originalFilename || report.filename}`, 220)
        });
      }
    }

    matches.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
    const paged = matches.slice(offset, offset + limit);

    res.json({
      query: q,
      types: { experiments: includeExperiments, reports: includeReports },
      limit,
      offset,
      returned: paged.length,
      totalApprox: matches.length,
      results: paged.map(r => ({ ...r, updatedAt: r.updatedAt.toISOString() }))
    });
  }));

  // ==================== CREATE EXPERIMENT ====================

  router.post('/experiments', asyncHandler(async (req, res) => {
    const user = (req as any).user as User;
    const parse = experimentSchema.safeParse(req.body);
    
    if (!parse.success) {
      throw new ValidationError('Invalid experiment data', parse.error.flatten());
    }

    const { tags, modality, ...rest } = parse.data;
    const experiment = await prisma.experiment.create({
      data: {
        userId: user.id,
        version: 1,
        modality: modality as any, // Type assertion for Prisma enum
        ...rest,
        tags: tags || []
      }
    });
    
    res.status(201).json(experiment);
  }));

  // ==================== UPDATE EXPERIMENT ====================

  router.patch('/experiments/:id', asyncHandler(async (req, res) => {
    const user = (req as any).user as User;
    const parse = experimentUpdateSchema.safeParse(req.body);

    if (!parse.success) {
      throw new ValidationError('Invalid update data', parse.error.flatten());
    }

    const experimentId = req.params.id;
    const existing = await prisma.experiment.findUnique({ where: { id: experimentId } });
    
    if (!existing) {
      throw new NotFoundError('Experiment', experimentId);
    }

    if (!canAccessExperiment(user, existing)) {
      throw new ForbiddenError('Not authorized to edit this experiment');
    }

    const { params, observations, tags, ...rest } = parse.data;
    const updateData: any = { ...rest };
    if (params !== undefined) updateData.params = params;
    if (observations !== undefined) updateData.observations = observations;
    if (tags !== undefined) updateData.tags = tags;
    updateData.version = (existing.version || 1) + 1;

    const updated = await prisma.experiment.update({ where: { id: experimentId }, data: updateData });

    await logChange('experiments', experimentId, 'update', existing, updated);

    res.json(updated);
  }));

  // ==================== PROJECT ORGANIZATION ====================

  router.get('/experiments/by-project', asyncHandler(async (req, res) => {
    const user = (req as any).user as User;
    const where = user.role === 'manager' || user.role === 'admin' ? {} : { userId: user.id };
    
    const experiments = await prisma.experiment.findMany({
      where,
      include: { user: { select: { id: true, name: true } } },
      orderBy: { updatedAt: 'desc' }
    });
    
    const byProject: Record<string, typeof experiments> = {};
    const unassigned: typeof experiments = [];
    
    for (const exp of experiments) {
      if (exp.project && exp.project.trim()) {
        if (!byProject[exp.project]) {
          byProject[exp.project] = [];
        }
        byProject[exp.project].push(exp);
      } else {
        unassigned.push(exp);
      }
    }
    
    res.json({
      projects: byProject,
      unassigned,
      projectList: Object.keys(byProject).sort(),
      summary: {
        totalProjects: Object.keys(byProject).length,
        totalExperiments: experiments.length,
        unassignedCount: unassigned.length
      }
    });
  }));

  router.get('/projects', asyncHandler(async (req, res) => {
    const user = (req as any).user as User;
    const where = user.role === 'manager' || user.role === 'admin' ? {} : { userId: user.id };
    
    const experiments = await prisma.experiment.findMany({
      where,
      select: { project: true, id: true, status: true, updatedAt: true }
    });
    
    const projectStats: Record<string, { count: number; statuses: Record<string, number>; lastUpdated: Date }> = {};
    
    for (const exp of experiments) {
      const projectName = exp.project || 'Unassigned';
      if (!projectStats[projectName]) {
        projectStats[projectName] = { count: 0, statuses: {}, lastUpdated: exp.updatedAt };
      }
      projectStats[projectName].count++;
      const status = exp.status || 'draft';
      projectStats[projectName].statuses[status] = (projectStats[projectName].statuses[status] || 0) + 1;
      if (exp.updatedAt > projectStats[projectName].lastUpdated) {
        projectStats[projectName].lastUpdated = exp.updatedAt;
      }
    }
    
    const projects = Object.entries(projectStats).map(([name, stats]) => ({
      name,
      experimentCount: stats.count,
      statuses: stats.statuses,
      lastUpdated: stats.lastUpdated
    })).sort((a, b) => b.lastUpdated.getTime() - a.lastUpdated.getTime());
    
    res.json(projects);
  }));

  router.get('/projects/:projectName/experiments', asyncHandler(async (req, res) => {
    const user = (req as any).user as User;
    const { projectName } = req.params;
    
    const baseWhere = user.role === 'manager' || user.role === 'admin' ? {} : { userId: user.id };
    const where = projectName === 'Unassigned' 
      ? { ...baseWhere, OR: [{ project: null }, { project: '' }] }
      : { ...baseWhere, project: decodeURIComponent(projectName) };
    
    const experiments = await prisma.experiment.findMany({
      where,
      include: {
        user: { select: { id: true, name: true } },
        signatures: { select: { id: true, signatureType: true } }
      },
      orderBy: { updatedAt: 'desc' }
    });
    
    res.json(experiments);
  }));

  // ==================== CREATE FROM METHOD TEMPLATE ====================

  router.post('/experiments/from-method/:methodId', asyncHandler(async (req, res) => {
    const user = (req as any).user as User;
    const { methodId } = req.params;
    const { title, project, modality } = req.body;

    const method = await prisma.method.findUnique({ where: { id: methodId } });
    if (!method) {
      throw new NotFoundError('Method', methodId);
    }

    const experiment = await prisma.experiment.create({
      data: {
        userId: user.id,
        title: title || `${method.title} - ${new Date().toLocaleDateString()}`,
        project,
        modality: modality || 'biochemistry',
        protocolRef: methodId,
        version: 1,
        status: 'draft',
        observations: method.steps || undefined,
        tags: []
      }
    });

    res.status(201).json(experiment);
  }));

  // ==================== STOCK USAGE ====================

  router.post('/experiments/:experimentId/stock-usage', asyncHandler(async (req, res) => {
    const user = (req as any).user as User;
    const { experimentId } = req.params;
    const { stockId, quantityUsed, notes } = req.body;

    const experiment = await prisma.experiment.findUnique({ where: { id: experimentId } });
    if (!experiment) {
      throw new NotFoundError('Experiment', experimentId);
    }
    
    if (experiment.userId !== user.id && user.role !== 'manager') {
      throw new ForbiddenError('Not authorized');
    }

    const stock = await prisma.stock.findUnique({ where: { id: stockId } });
    if (!stock) {
      throw new NotFoundError('Stock', stockId);
    }
    
    if (stock.quantity < quantityUsed) {
      throw new ValidationError('Insufficient stock');
    }

    const [usage] = await prisma.$transaction([
      prisma.experimentStock.create({
        data: { experimentId, stockId, quantityUsed, notes }
      }),
      prisma.stock.update({
        where: { id: stockId },
        data: { quantity: stock.quantity - quantityUsed }
      })
    ]);

    res.status(201).json(usage);
  }));

  // ==================== SIGNATURES ====================

  const signatureSchema = z.object({
    signatureType: signatureTypeEnum,
    meaning: z.string().optional()
  });

  function computeContentHash(content: any): string {
    return crypto.createHash('sha256').update(JSON.stringify(content)).digest('hex');
  }

  router.post('/experiments/:id/sign', asyncHandler(async (req, res) => {
    const user = (req as any).user as User;
    const { id } = req.params;
    const parse = signatureSchema.safeParse(req.body);
    
    if (!parse.success) {
      throw new ValidationError('Invalid signature data', parse.error.flatten());
    }

    const experiment = await prisma.experiment.findUnique({ where: { id } });
    if (!experiment) {
      throw new NotFoundError('Experiment', id);
    }

    const contentHash = computeContentHash(experiment);

    const signature = await prisma.signature.create({
      data: {
        userId: user.id,
        experimentId: id,
        signatureType: parse.data.signatureType,
        meaning: parse.data.meaning,
        contentHash,
        ipAddress: req.ip,
        userAgent: req.get('user-agent')
      }
    });

    if (parse.data.signatureType === 'author') {
      await prisma.experiment.update({
        where: { id },
        data: { status: 'signed' }
      });
    }

    res.status(201).json(signature);
  }));

  router.get('/experiments/:id/signatures', asyncHandler(async (req, res) => {
    const signatures = await prisma.signature.findMany({
      where: { experimentId: req.params.id },
      include: { user: { select: { id: true, name: true, email: true } } }
    });
    res.json(signatures);
  }));

  // ==================== COMMENTS ====================

  const commentSchema = z.object({
    content: z.string().min(1),
    parentId: z.string().uuid().optional()
  });

  router.get('/experiments/:id/comments', asyncHandler(async (req, res) => {
    const comments = await prisma.comment.findMany({
      where: { experimentId: req.params.id },
      include: { 
        author: { select: { id: true, name: true } },
        replies: { include: { author: { select: { id: true, name: true } } } }
      },
      orderBy: { createdAt: 'asc' }
    });
    res.json(comments.filter((c: any) => !c.parentId));
  }));

  router.post('/experiments/:id/comments', asyncHandler(async (req, res) => {
    const user = (req as any).user as User;
    const { id } = req.params;
    const parse = commentSchema.safeParse(req.body);
    
    if (!parse.success) {
      throw new ValidationError('Invalid comment data', parse.error.flatten());
    }

    const experiment = await prisma.experiment.findUnique({ where: { id } });
    if (!experiment) {
      throw new NotFoundError('Experiment', id);
    }

    const comment = await prisma.comment.create({
      data: {
        content: parse.data.content,
        authorId: user.id,
        experimentId: id,
        parentId: parse.data.parentId
      },
      include: { author: { select: { id: true, name: true } } }
    });

    if (experiment.userId !== user.id) {
      await prisma.notification.create({
        data: {
          userId: experiment.userId,
          type: 'comment',
          title: 'New Comment',
          message: `${user.name} commented on your experiment "${experiment.title}"`,
          entityType: 'experiment',
          entityId: id
        }
      });
    }

    res.status(201).json(comment);
  }));

  return router;
}
