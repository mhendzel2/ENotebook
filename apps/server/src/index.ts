import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import crypto from 'crypto';
import http from 'http';
import { PrismaClient } from '@prisma/client';
import type { User } from '@eln/shared/dist/types.js';
import { createApiKeyRoutes, apiKeyAuth, requirePermission as apiKeyRequirePermission } from './middleware/apiKey.js';
import { createExportRoutes } from './routes/export.js';
import { createAuthRoutes } from './routes/auth.js';
import { createAttachmentRoutes } from './routes/attachments.js';
import { createReportRoutes } from './routes/reports.js';
import { createSignatureRoutes, SignatureService } from './services/signatures.js';
import { createAuditRoutes, AuditTrailService } from './services/auditTrail.js';
import { createElnExportRoutes } from './services/elnExport.js';
import { CollaborationManager } from './services/websocket.js';
// New Labguru-style feature imports
import { WorkflowEngine, createWorkflowRoutes } from './services/workflows.js';
import { LabelService, createLabelRoutes } from './services/labels.js';
import { DashboardService, createDashboardRoutes } from './services/dashboard.js';
import { SamplePoolService, createPoolRoutes } from './services/pools.js';
// Developer & Integration tools
import { createGraphQLRoutes } from './services/graphql.js';
import { createMobileRoutes, MobileService } from './services/mobile.js';
import { createMLAnalyticsRoutes } from './services/mlAnalytics.js';
import { createExperimentsRoutes } from './routes/experiments.js';
import { createMethodsRoutes } from './routes/methods.js';
import { createAdminRoutes } from './routes/admin.js';
import { createSyncRoutes } from './routes/sync.js';
import { createNotificationsRoutes } from './routes/notifications.js';
import { createAuditLogRoutes } from './routes/auditLog.js';
import { createInventoryRoutes } from './routes/inventory.js';
import { notFoundHandler, errorHandler } from './middleware/errorHandler.js';

const prisma = new PrismaClient();

const app = express();
const server = http.createServer(app);


// Initialize WebSocket collaboration
const collaboration = new CollaborationManager(server, prisma);

// Initialize services
const auditService = new AuditTrailService(prisma);
const signatureService = new SignatureService(prisma);

// Initialize new Labguru-style services
const workflowEngine = new WorkflowEngine(prisma);
const labelService = new LabelService(prisma);
const dashboardService = new DashboardService(prisma);
const poolService = new SamplePoolService(prisma);

// Access MDB imports are uploaded as base64 JSON; base64 expands payload size by ~33%.
// Keep this above the import route's 50MB raw-file cap.
app.use(express.json({ limit: '100mb' }));
app.use(cors());
app.use(helmet());
app.use(morgan('dev'));

// Auth routes (no authentication required)
app.use(createAuthRoutes(prisma));

// Simple header-based auth stub with API key fallback.
app.use(async (req, res, next) => {
  // Skip auth for health check and auth routes
  if (req.path === '/health' || req.path.startsWith('/api/auth')) {
    return next();
  }
  
  // Try API key auth first
  const apiKey = req.header('x-api-key');
  if (apiKey) {
    try {
      // Hash the provided key
      const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');
      
      const apiKeyRecord = await prisma.aPIKey.findFirst({
        where: { keyHash, revokedAt: null },
        include: { user: true }
      });
      
      if (!apiKeyRecord) {
        return res.status(401).json({ error: 'Invalid API key' });
      }
      
      // Check expiration
      if (apiKeyRecord.expiresAt && apiKeyRecord.expiresAt < new Date()) {
        return res.status(401).json({ error: 'API key expired' });
      }
      
      // Update last used
      await prisma.aPIKey.update({
        where: { id: apiKeyRecord.id },
        data: { lastUsedAt: new Date() }
      });
      
      // Attach user and key info
      (req as any).user = apiKeyRecord.user;
      (req as any).apiKey = apiKeyRecord;
      return next();
    } catch (error) {
      return res.status(500).json({ error: 'API key validation error' });
    }
  }
  
  // Fall back to user ID header auth
  const userId = req.header('x-user-id');
  if (!userId) {
    return res.status(401).json({ error: 'Missing x-user-id or x-api-key header' });
  }
  try {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return res.status(403).json({ error: 'User not found' });
    }
    (req as any).user = user;
    next();
  } catch (error) {
    res.status(500).json({ error: 'Database error during auth' });
  }
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString(), websocket: true });
});

// ==================== API KEY MANAGEMENT ====================
app.use(createApiKeyRoutes(prisma));

// ==================== DATA EXPORT ====================
app.use(createExportRoutes(prisma));

// ==================== ELECTRONIC SIGNATURES ====================
app.use(createSignatureRoutes(prisma));

// ==================== AUDIT TRAIL ====================
app.use(createAuditRoutes(prisma));

// ==================== ELN EXPORT (RO-CRATE/.eln) ====================
app.use(createElnExportRoutes(prisma));

// ==================== ATTACHMENTS (IMAGES, SPREADSHEETS) ====================
app.use(createAttachmentRoutes(prisma));

// ==================== REPORTS (FRAP, SPT, etc.) ====================
app.use(createReportRoutes(prisma));

// ==================== AUTOMATION WORKFLOWS ====================
app.use(createWorkflowRoutes(prisma, workflowEngine));

// ==================== LABEL GENERATION & SCANNING ====================
app.use(createLabelRoutes(prisma, labelService));

// ==================== DASHBOARDS & VISUALIZATIONS ====================
app.use(createDashboardRoutes(prisma, dashboardService));

// ==================== SAMPLE POOLING ====================
app.use(createPoolRoutes(prisma, poolService));

// ==================== GRAPHQL API ====================
app.use('/api/graphql', createGraphQLRoutes(prisma));

// ==================== MOBILE COMPANION API ====================
const mobileService = new MobileService(prisma);
app.use('/api/mobile', createMobileRoutes(prisma, mobileService));

// ==================== ML ANALYTICS ====================
app.use('/api/ml', createMLAnalyticsRoutes());

// ==================== ENHANCED AUDIT LOGGING ====================

async function logChange(
  entityType: string,
  entityId: string,
  operation: string,
  oldValue?: any,
  newValue?: any,
  fieldName?: string,
  deviceId?: string
) {
  await prisma.changeLog.create({
    data: {
      entityType,
      entityId,
      operation,
      oldValue: oldValue ? JSON.stringify(oldValue) : undefined,
      newValue: newValue ? JSON.stringify(newValue) : undefined,
      fieldName,
      deviceId
    }
  });
}

// ==================== CORE APP ROUTES ====================

app.use(createMethodsRoutes(prisma, logChange));
app.use(createExperimentsRoutes(prisma, logChange));
app.use(createAdminRoutes(prisma));
app.use(createSyncRoutes(prisma));
app.use(createNotificationsRoutes(prisma));
app.use(createAuditLogRoutes(prisma));
app.use(createInventoryRoutes(prisma));

// ==================== NOT FOUND + ERROR HANDLING ====================

app.use(notFoundHandler);
app.use(errorHandler);

const port = process.env.PORT || 4000;
server.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`ELN server listening on http://localhost:${port}`);
  console.log(`WebSocket server ready for real-time collaboration`);
});

// Export collaboration manager for use in routes
export { collaboration };

/*
 * LEGACY INLINE ROUTES
 *
 * These routes were extracted into modular routers under src/routes/.
 * They are intentionally disabled to avoid duplicate route registrations.


app.patch('/methods/:id', async (req, res) => {
  const user = (req as any).user as User;
  const parse = methodUpdateSchema.safeParse(req.body);

  if (!parse.success) {
    return res.status(400).json({ error: parse.error.flatten() });
  }

  const methodId = req.params.id;

  try {
    const existing = await prisma.method.findUnique({ where: { id: methodId } });
    if (!existing) return res.status(404).json({ error: 'Method not found' });

    const canEdit = user.role === 'manager' || user.role === 'admin' || existing.createdBy === user.id;
    if (!canEdit) return res.status(403).json({ error: 'Not authorized to edit this method' });

    const { steps, reagents, attachments, ...rest } = parse.data;
    const updateData: any = { ...rest };
    if (steps !== undefined) updateData.steps = steps;
    if (reagents !== undefined) updateData.reagents = reagents || undefined;
    if (attachments !== undefined) updateData.attachments = attachments || undefined;
    updateData.version = (existing.version || 1) + 1;

    const updated = await prisma.method.update({ where: { id: methodId }, data: updateData });

    await logChange('methods', methodId, 'update', existing, updated);

    res.json(updated);
  } catch (error) {
    console.error('Failed to update method:', error);
    res.status(500).json({ error: 'Failed to update method' });
  }
});

const experimentSchema = z.object({
  title: z.string().min(1),
  project: z.string().optional(),
  modality: z.enum(MODALITIES),
  protocolRef: z.string().optional(),
  params: z.any().optional(),
  observations: z.any().optional(),
  resultsSummary: z.string().optional(),
  dataLink: z.string().optional(), // Supports URLs or file paths (multiple paths separated by newlines)
  tags: z.array(z.string()).optional(),
  status: z.enum(EXPERIMENT_STATUSES).default('draft')
});

const experimentUpdateSchema = experimentSchema.partial().refine(
  (val) => Object.keys(val).length > 0,
  { message: 'At least one field must be provided for update' }
);

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

// 1. Replace GET /experiments with Prisma
app.get('/experiments', async (req, res) => {
  const user = (req as any).user as User;
  try {
    const where = user.role === 'manager' || user.role === 'admin' ? {} : { userId: user.id };
    const data = await prisma.experiment.findMany({ where });
    res.json(data);
  } catch (error) {
    console.error('Failed to get experiments:', error);
    res.status(500).json({ error: 'Database error' });
  }
});

// GET single experiment with all related data (attachments, reports, etc.)
app.get('/experiments/:id', async (req, res) => {
  const user = (req as any).user as User;
  const { id } = req.params;
  
  try {
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
      return res.status(404).json({ error: 'Experiment not found' });
    }
    
    // Check authorization
    const canView = user.role === 'manager' || user.role === 'admin' || experiment.userId === user.id;
    if (!canView) {
      return res.status(403).json({ error: 'Not authorized to view this experiment' });
    }
    
    res.json(experiment);
  } catch (error) {
    console.error('Failed to get experiment:', error);
    res.status(500).json({ error: 'Database error' });
  }
});

// Experimental results search across experiments + reports
// GET /search/results?q=...&types=experiments,reports&limit=25&offset=0
app.get('/search/results', searchResultsLimiter, async (req, res) => {
  const user = (req as any).user as User;

  const q = coerceQueryString(req.query.q, 200);
  if (!q) return res.status(400).json({ error: 'Missing query parameter: q' });

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
    | {
        type: 'experiment';
        experimentId: string;
        title: string;
        project: string | null;
        updatedAt: Date;
        snippet: string;
      }
    | {
        type: 'report';
        reportId: string;
        experimentId: string;
        title: string;
        project: string | null;
        updatedAt: Date;
        reportType: string;
        filename: string;
        snippet: string;
      };

  const matches: SearchResult[] = [];

  try {
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
  } catch (error) {
    console.error('Failed to search results:', error);
    res.status(500).json({ error: 'Search failed' });
  }
});

// 2. Replace POST /experiments with Prisma
app.post('/experiments', async (req, res) => {
  const user = (req as any).user as User;
  const parse = experimentSchema.safeParse(req.body);
  
  if (!parse.success) {
    return res.status(400).json({ error: parse.error.flatten() });
  }

  try {
    const { tags, ...rest } = parse.data;
    const experiment = await prisma.experiment.create({
      data: {
        userId: user.id,
        version: 1,
        ...rest,
        tags: tags || []
      }
    });
    res.status(201).json(experiment);
  } catch (error) {
    console.error('Failed to create experiment:', error);
    res.status(500).json({ error: 'Failed to save experiment' });
  }
});

app.patch('/experiments/:id', async (req, res) => {
  const user = (req as any).user as User;
  const parse = experimentUpdateSchema.safeParse(req.body);

  if (!parse.success) {
    return res.status(400).json({ error: parse.error.flatten() });
  }

  const experimentId = req.params.id;

  try {
    const existing = await prisma.experiment.findUnique({ where: { id: experimentId } });
    if (!existing) return res.status(404).json({ error: 'Experiment not found' });

    const canEdit = user.role === 'manager' || user.role === 'admin' || existing.userId === user.id;
    if (!canEdit) return res.status(403).json({ error: 'Not authorized to edit this experiment' });

    const { params, observations, tags, ...rest } = parse.data;
    const updateData: any = { ...rest };
    if (params !== undefined) updateData.params = params;
    if (observations !== undefined) updateData.observations = observations;
    if (tags !== undefined) updateData.tags = tags;
    updateData.version = (existing.version || 1) + 1;

    const updated = await prisma.experiment.update({ where: { id: experimentId }, data: updateData });

    await logChange('experiments', experimentId, 'update', existing, updated);

    res.json(updated);
  } catch (error) {
    console.error('Failed to update experiment:', error);
    res.status(500).json({ error: 'Failed to update experiment' });
  }
});

// ==================== ADMIN ENDPOINTS ====================

// Admin: Get all experiments with user information (for lab managers/admins)
app.get('/admin/experiments', async (req, res) => {
  const user = (req as any).user as User;
  
  if (user.role !== 'admin' && user.role !== 'manager') {
    return res.status(403).json({ error: 'Admin or manager access required' });
  }
  
  try {
    const experiments = await prisma.experiment.findMany({
      include: {
        user: { select: { id: true, name: true, email: true, role: true } },
        signatures: { select: { id: true, signatureType: true, createdAt: true } }
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
app.get('/admin/methods', async (req, res) => {
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
app.get('/admin/users', async (req, res) => {
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
app.get('/admin/users/:userId/experiments', async (req, res) => {
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

// ==================== PROJECT ORGANIZATION ====================

// Get experiments organized by project
app.get('/experiments/by-project', async (req, res) => {
  const user = (req as any).user as User;
  
  try {
    const where = user.role === 'manager' || user.role === 'admin' ? {} : { userId: user.id };
    
    const experiments = await prisma.experiment.findMany({
      where,
      include: {
        user: { select: { id: true, name: true } }
      },
      orderBy: { updatedAt: 'desc' }
    });
    
    // Group experiments by project
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
  } catch (error) {
    console.error('Failed to get experiments by project:', error);
    res.status(500).json({ error: 'Database error' });
  }
});

// Get list of all projects
app.get('/projects', async (req, res) => {
  const user = (req as any).user as User;
  
  try {
    const where = user.role === 'manager' || user.role === 'admin' ? {} : { userId: user.id };
    
    const experiments = await prisma.experiment.findMany({
      where,
      select: { project: true, id: true, status: true, updatedAt: true }
    });
    
    // Aggregate project statistics
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
  } catch (error) {
    console.error('Failed to get projects:', error);
    res.status(500).json({ error: 'Database error' });
  }
});

// Get experiments for a specific project
app.get('/projects/:projectName/experiments', async (req, res) => {
  const user = (req as any).user as User;
  const { projectName } = req.params;
  
  try {
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
  } catch (error) {
    console.error('Failed to get project experiments:', error);
    res.status(500).json({ error: 'Database error' });
  }
});

// Create experiment from method template
app.post('/experiments/from-method/:methodId', async (req, res) => {
  const user = (req as any).user as User;
  const { methodId } = req.params;
  const { title, project, modality } = req.body;

  try {
    const method = await prisma.method.findUnique({ where: { id: methodId } });
    if (!method) {
      return res.status(404).json({ error: 'Method not found' });
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
  } catch (error) {
    console.error('Failed to create experiment from method:', error);
    res.status(500).json({ error: 'Failed to create experiment from method' });
  }
});

const syncPayloadSchema = z.object({
  methods: z.array(methodSchema.extend({ id: z.string().uuid(), version: z.number().int().positive(), updatedAt: z.string() })),
  experiments: z.array(
    experimentSchema.extend({
      id: z.string().uuid(),
      userId: z.string(),
      version: z.number().int().positive(),
      createdAt: z.string(),
      updatedAt: z.string()
    })
  )
});

// 3. Implement the Sync Logic (Replacing the placeholder)
app.post('/sync/push', async (req, res) => {
  const parse = syncPayloadSchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ error: parse.error.flatten() });
  }

  const { methods, experiments } = parse.data;
  const conflicts: any[] = [];
  const applied: any[] = [];

  // Transaction ensures atomicity
  try {
    await prisma.$transaction(async (tx) => {
      
      // Handle Experiments
      for (const incExp of experiments) {
        const existing = await tx.experiment.findUnique({ where: { id: incExp.id } });
        
        const { params, observations, tags, ...rest } = incExp;
        const dataToSave = {
          ...rest,
          params: params || undefined,
          observations: observations || undefined,
          tags: tags || []
        };

        if (!existing) {
          // It's new, insert it
          await tx.experiment.create({ data: dataToSave });
          applied.push({ id: incExp.id, status: 'created' });
        } else {
          // Conflict Detection: simple version check
          if (incExp.version > existing.version) {
            await tx.experiment.update({
              where: { id: incExp.id },
              data: dataToSave
            });
            applied.push({ id: incExp.id, status: 'updated' });
          } else if (incExp.version < existing.version) {
            // Server has newer version; reject push and notify client
            conflicts.push({ id: incExp.id, serverVersion: existing.version, clientVersion: incExp.version });
          }
          // If versions equal, do nothing (idempotent)
        }
      }
      
      // Handle Methods
      for (const incMethod of methods) {
        const existing = await tx.method.findUnique({ where: { id: incMethod.id } });
        
        const { steps, reagents, attachments, ...rest } = incMethod;
        const dataToSave = {
          ...rest,
          steps: steps,
          reagents: reagents || undefined,
          attachments: attachments || undefined
        };

        if (!existing) {
          // It's new, insert it
          await tx.method.create({ data: dataToSave });
          applied.push({ id: incMethod.id, status: 'created' });
        } else {
          // Conflict Detection: simple version check
          if (incMethod.version > existing.version) {
            await tx.method.update({
              where: { id: incMethod.id },
              data: dataToSave
            });
            applied.push({ id: incMethod.id, status: 'updated' });
          } else if (incMethod.version < existing.version) {
            // Server has newer version; reject push and notify client
            conflicts.push({ id: incMethod.id, serverVersion: existing.version, clientVersion: incMethod.version });
          }
          // If versions equal, do nothing (idempotent)
        }
      }
    });

    res.json({ status: 'processed', applied, conflicts });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Sync transaction failed' });
  }
});

app.get('/sync/pull', async (_req, res) => {
  try {
    const methods = await prisma.method.findMany();
    const experiments = await prisma.experiment.findMany();
    
    // Prisma's Json type already returns parsed objects
    res.json({ methods, experiments });
  } catch (error) {
    res.status(500).json({ error: 'Database error' });
  }
});

const port = process.env.PORT || 4000;
server.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`ELN server listening on http://localhost:${port}`);
  console.log(`WebSocket server ready for real-time collaboration`);
});

// Small helper for role checks if needed later.
function requireRole(user: User, roles: Role[]) {
  if (!roles.includes(user.role)) {
    throw new Error('forbidden');
  }
}

// Export collaboration manager for use in routes
export { collaboration };
// ==================== INVENTORY MANAGEMENT ====================

const locationSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  parentId: z.string().uuid().optional(),
  temperature: z.string().optional()
});

app.get('/locations', async (_req, res) => {
  try {
    const locations = await prisma.location.findMany({
      include: { children: true, stocks: { select: { id: true } } }
    });
    res.json(locations);
  } catch (error) {
    res.status(500).json({ error: 'Database error' });
  }
});

app.post('/locations', async (req, res) => {
  const parse = locationSchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ error: parse.error.flatten() });
  }
  try {
    const location = await prisma.location.create({ data: parse.data });
    res.status(201).json(location);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create location' });
  }
});

const inventoryItemSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  category: z.enum(INVENTORY_CATEGORIES),
  catalogNumber: z.string().optional(),
  manufacturer: z.string().optional(),
  supplier: z.string().optional(),
  unit: z.string().optional(),
  properties: z.any().optional(),
  safetyInfo: z.string().optional(),
  storageConditions: z.string().optional()
});

const inventoryItemUpdateSchema = inventoryItemSchema.partial().refine(
  (val) => Object.keys(val).length > 0,
  { message: 'At least one field must be provided for update' }
);

const importBase64FileSchema = z.object({
  filename: z.string().min(1).max(255),
  data: z.string().min(1),
  options: z.any().optional()
});

const INVENTORY_IMPORT_MAX_BYTES = 50 * 1024 * 1024; // 50MB
const INVENTORY_IMPORT_MAX_ROWS = 10000;
const IMPORTS_DIR = process.env.IMPORTS_DIR || path.join(process.cwd(), 'data', 'imports');

if (!fs.existsSync(IMPORTS_DIR)) {
  fs.mkdirSync(IMPORTS_DIR, { recursive: true });
}

const inventoryImportLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const userId = (req as any).user?.id;
    return userId || req.ip || 'anonymous';
  }
});

function decodeBase64ToBuffer(base64: string, maxBytes: number) {
  let buf: Buffer;
  try {
    buf = Buffer.from(base64, 'base64');
  } catch {
    return { ok: false as const, error: 'Invalid base64 data' };
  }
  if (buf.length === 0) return { ok: false as const, error: 'Empty file data' };
  if (buf.length > maxBytes) {
    return { ok: false as const, error: `File too large. Maximum size is ${Math.floor(maxBytes / (1024 * 1024))}MB` };
  }
  return { ok: true as const, buffer: buf };
}

function normalizeRecordKeys(record: Record<string, any>): Record<string, any> {
  const normalized: Record<string, any> = {};
  for (const [key, value] of Object.entries(record)) {
    normalized[String(key).trim().toLowerCase()] = value;
  }
  return normalized;
}

function getFirstField(record: Record<string, any>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (value === undefined || value === null) continue;
    const str = String(value).trim();
    if (str.length === 0) continue;
    return str;
  }
  return undefined;
}

function parseOptionalNumber(raw: unknown): number | undefined {
  if (raw === undefined || raw === null) return undefined;
  const str = String(raw).trim();
  if (!str) return undefined;
  const n = Number(str);
  if (!Number.isFinite(n)) return undefined;
  return n;
}

function sanitizeBracketIdentifier(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed.length === 0 || trimmed.length > 128) return null;
  if (!/^[A-Za-z0-9_\-\s]+$/.test(trimmed)) return null;
  return trimmed;
}

app.get('/inventory', async (req, res) => {
  try {
    const categoryQuery = req.query.category;
    const searchQuery = req.query.search;
    const category = typeof categoryQuery === 'string' ? categoryQuery : undefined;
    const search = typeof searchQuery === 'string' ? searchQuery : undefined;
    const where: any = {};
    if (category && INVENTORY_CATEGORIES.includes(category as any)) {
      where.category = category;
    }
    if (search && typeof search === 'string') {
      // Sanitize search input
      const sanitizedSearch = String(search).slice(0, 200);
      where.OR = [
        { name: { contains: sanitizedSearch } },
        { catalogNumber: { contains: sanitizedSearch } },
        { manufacturer: { contains: sanitizedSearch } }
      ];
    }
    const items = await prisma.inventoryItem.findMany({
      where,
      include: { stocks: { include: { location: true } } }
    });
    const parsedItems = items.map(item => ({
      ...item,
      properties: item.properties ? JSON.parse(item.properties) : undefined
    }));
    res.json(parsedItems);
  } catch (error) {
    res.status(500).json({ error: 'Database error' });
  }
});

app.post('/inventory', async (req, res) => {
  const parse = inventoryItemSchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ error: parse.error.flatten() });
  }
  try {
    const { properties, ...rest } = parse.data;
    const item = await prisma.inventoryItem.create({
      data: {
        ...rest,
        properties: properties ? JSON.stringify(properties) : undefined
      }
    });
    res.status(201).json({
      ...item,
      properties: item.properties ? JSON.parse(item.properties) : undefined
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create inventory item' });
  }
});

app.patch('/inventory/:id', async (req, res) => {
  const parse = inventoryItemUpdateSchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ error: parse.error.flatten() });
  }
  try {
    const existing = await prisma.inventoryItem.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Item not found' });

    const { properties, ...rest } = parse.data;
    const updated = await prisma.inventoryItem.update({
      where: { id: req.params.id },
      data: {
        ...rest,
        properties: properties !== undefined ? (properties ? JSON.stringify(properties) : null) : undefined
      }
    });

    res.json({
      ...updated,
      properties: updated.properties ? JSON.parse(updated.properties) : undefined
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update inventory item' });
  }
});

app.delete('/inventory/:id', async (req, res) => {
  const user = (req as any).user as User;
  try {
    // Keep inventory safe: only managers/admins can delete items.
    if (user?.role !== 'admin' && user?.role !== 'manager') {
      return res.status(403).json({ error: 'Not authorized' });
    }

    const existing = await prisma.inventoryItem.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Item not found' });

    await prisma.$transaction(async (tx) => {
      await tx.stock.deleteMany({ where: { itemId: req.params.id } });
      await tx.inventoryItem.delete({ where: { id: req.params.id } });
    });

    res.json({ status: 'deleted' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete inventory item' });
  }
});

// Import inventory items/stocks from CSV
app.post('/inventory/import/csv', inventoryImportLimiter, async (req, res) => {
  const user = (req as any).user as User;
  const parse = importBase64FileSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: parse.error.flatten() });

  if (user?.role !== 'admin' && user?.role !== 'manager') {
    return res.status(403).json({ error: 'Not authorized' });
  }

  const { filename, data } = parse.data;
  const ext = path.extname(filename).toLowerCase();
  if (ext !== '.csv' && ext !== '.tsv') {
    return res.status(400).json({ error: 'Only .csv or .tsv files are supported' });
  }

  const decoded = decodeBase64ToBuffer(data, INVENTORY_IMPORT_MAX_BYTES);
  if (!decoded.ok) return res.status(400).json({ error: decoded.error });

  try {
    const text = decoded.buffer.toString('utf8');
    const records = parseCsv(text, {
      columns: true,
      skip_empty_lines: true,
      relax_column_count: true,
      trim: true
    }) as Record<string, any>[];

    if (records.length > INVENTORY_IMPORT_MAX_ROWS) {
      return res.status(400).json({ error: `CSV has too many rows (${records.length}). Maximum is ${INVENTORY_IMPORT_MAX_ROWS}.` });
    }

    const summary = {
      rows: records.length,
      itemsCreated: 0,
      itemsUpdated: 0,
      stocksCreated: 0,
      warnings: [] as string[],
      errors: [] as string[]
    };

    for (let i = 0; i < records.length; i++) {
      const row = normalizeRecordKeys(records[i]);
      const name = getFirstField(row, ['name', 'item', 'itemname', 'reagent', 'material']);
      if (!name) {
        if (summary.errors.length < 25) summary.errors.push(`Row ${i + 2}: missing item name`);
        continue;
      }

      const categoryRaw = (getFirstField(row, ['category', 'type']) || 'reagent').toLowerCase();
      const category = INVENTORY_CATEGORIES.includes(categoryRaw as any) ? (categoryRaw as any) : ('reagent' as any);
      if (categoryRaw && categoryRaw !== category) {
        if (summary.warnings.length < 25) summary.warnings.push(`Row ${i + 2}: unknown category '${categoryRaw}', defaulted to 'reagent'`);
      }

      const catalogNumber = getFirstField(row, ['catalognumber', 'catalog', 'sku', 'partnumber']);
      const manufacturer = getFirstField(row, ['manufacturer', 'mfg']);
      const supplier = getFirstField(row, ['supplier', 'vendor']);
      const unit = getFirstField(row, ['unit', 'uom']);
      const description = getFirstField(row, ['description', 'desc']);
      const safetyInfo = getFirstField(row, ['safetyinfo', 'safety', 'hazard']);
      const storageConditions = getFirstField(row, ['storageconditions', 'storage']);

      const quantity = parseOptionalNumber(getFirstField(row, ['quantity', 'qty', 'amount']));
      const lotNumber = getFirstField(row, ['lotnumber', 'lot']);
      const barcode = getFirstField(row, ['barcode']);
      const notes = getFirstField(row, ['notes', 'note']);
      const expirationDateRaw = getFirstField(row, ['expirationdate', 'expiry', 'expires']);
      const locationName = getFirstField(row, ['location', 'freezer', 'room', 'shelf']);

      const itemMatchWhere = catalogNumber
        ? { name, catalogNumber }
        : { name };

      const existing = await prisma.inventoryItem.findFirst({ where: itemMatchWhere });
      const item = existing
        ? await prisma.inventoryItem.update({
            where: { id: existing.id },
            data: {
              category,
              description: description ?? existing.description,
              catalogNumber: catalogNumber ?? existing.catalogNumber,
              manufacturer: manufacturer ?? existing.manufacturer,
              supplier: supplier ?? existing.supplier,
              unit: unit ?? existing.unit,
              safetyInfo: safetyInfo ?? existing.safetyInfo,
              storageConditions: storageConditions ?? existing.storageConditions
            }
          })
        : await prisma.inventoryItem.create({
            data: {
              name,
              category,
              description,
              catalogNumber,
              manufacturer,
              supplier,
              unit,
              safetyInfo,
              storageConditions
            }
          });

      if (existing) summary.itemsUpdated++;
      else summary.itemsCreated++;

      if (quantity !== undefined && quantity > 0) {
        let locationId: string | undefined;
        if (locationName) {
          const existingLocation = await prisma.location.findFirst({ where: { name: locationName } });
          const loc = existingLocation || (await prisma.location.create({ data: { name: locationName } }));
          locationId = loc.id;
        }

        let expirationDate: Date | undefined;
        if (expirationDateRaw) {
          const d = new Date(expirationDateRaw);
          if (!Number.isNaN(d.valueOf())) expirationDate = d;
          else if (summary.warnings.length < 25) summary.warnings.push(`Row ${i + 2}: invalid expirationDate '${expirationDateRaw}' ignored`);
        }

        try {
          await prisma.stock.create({
            data: {
              itemId: item.id,
              locationId,
              lotNumber,
              quantity,
              initialQuantity: quantity,
              expirationDate,
              barcode,
              notes
            }
          });
          summary.stocksCreated++;
        } catch (e: any) {
          // Common case: duplicate barcode unique constraint
          if (summary.errors.length < 25) summary.errors.push(`Row ${i + 2}: failed to create stock (${e?.code || 'error'})`);
        }
      }
    }

    res.json(summary);
  } catch (error) {
    console.error('CSV import error:', error);
    res.status(500).json({ error: 'Failed to import CSV' });
  }
});

// Import inventory items/stocks from Microsoft Access (.mdb/.accdb)
app.post('/inventory/import/access', inventoryImportLimiter, async (req, res) => {
  const user = (req as any).user as User;
  const parse = importBase64FileSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: parse.error.flatten() });

  if (user?.role !== 'admin' && user?.role !== 'manager') {
    return res.status(403).json({ error: 'Not authorized' });
  }

  const { filename, data, options } = parse.data;
  const ext = path.extname(filename).toLowerCase();
  if (ext !== '.mdb' && ext !== '.accdb') {
    return res.status(400).json({ error: 'Only .mdb or .accdb files are supported' });
  }

  const decoded = decodeBase64ToBuffer(data, INVENTORY_IMPORT_MAX_BYTES);
  if (!decoded.ok) return res.status(400).json({ error: decoded.error });

  const tableRequested = typeof options?.table === 'string' ? options.table : 'Inventory';
  const sanitizedTable = sanitizeBracketIdentifier(tableRequested);
  if (!sanitizedTable) return res.status(400).json({ error: 'Invalid table name' });

  const mapping = (options?.mapping && typeof options.mapping === 'object') ? options.mapping : {};
  const require = createRequire(import.meta.url);

  let ADODB: any;
  try {
    ADODB = require('node-adodb');
  } catch (e) {
    return res.status(500).json({
      error: 'Access import dependency not available (node-adodb)',
      hint: 'Run server install (pnpm/npm install) and ensure dependencies are built.'
    });
  }

  const fileId = uuid();
  const importPath = path.join(IMPORTS_DIR, `${fileId}${ext}`);

  try {
    fs.writeFileSync(importPath, decoded.buffer);

    const providers: string[] = ext === '.accdb'
      ? ['Microsoft.ACE.OLEDB.12.0']
      : ['Microsoft.ACE.OLEDB.12.0', 'Microsoft.Jet.OLEDB.4.0'];

    let connection: any;
    let lastError: any;
    for (const provider of providers) {
      try {
        const connectionString = `Provider=${provider};Data Source=${importPath};Persist Security Info=False;`;
        connection = ADODB.open(connectionString);
        // quick sanity query to validate provider works
        await connection.query(`SELECT TOP 1 * FROM [${sanitizedTable}]`);
        lastError = null;
        break;
      } catch (e) {
        lastError = e;
      }
    }

    if (!connection) {
      return res.status(400).json({
        error: 'Unable to open Access database with available OLEDB providers',
        hint: 'Install Microsoft Access Database Engine (ACE OLEDB 12.0+) on this machine, or export your tables to CSV.',
        details: String(lastError?.message || lastError || 'unknown')
      });
    }

    const rows = (await connection.query(`SELECT * FROM [${sanitizedTable}]`)) as Record<string, any>[];
    if (rows.length > INVENTORY_IMPORT_MAX_ROWS) {
      return res.status(400).json({ error: `Access table has too many rows (${rows.length}). Maximum is ${INVENTORY_IMPORT_MAX_ROWS}.` });
    }

    const summary = {
      rows: rows.length,
      itemsCreated: 0,
      itemsUpdated: 0,
      stocksCreated: 0,
      warnings: [] as string[],
      errors: [] as string[]
    };

    for (let i = 0; i < rows.length; i++) {
      const rowRaw = rows[i] || {};
      const row = normalizeRecordKeys(rowRaw);

      const nameKey = typeof mapping?.name === 'string' ? mapping.name : undefined;
      const categoryKey = typeof mapping?.category === 'string' ? mapping.category : undefined;
      const quantityKey = typeof mapping?.quantity === 'string' ? mapping.quantity : undefined;
      const unitKey = typeof mapping?.unit === 'string' ? mapping.unit : undefined;
      const locationKey = typeof mapping?.location === 'string' ? mapping.location : undefined;
      const catalogKey = typeof mapping?.catalogNumber === 'string' ? mapping.catalogNumber : undefined;
      const manufacturerKey = typeof mapping?.manufacturer === 'string' ? mapping.manufacturer : undefined;
      const supplierKey = typeof mapping?.supplier === 'string' ? mapping.supplier : undefined;
      const lotKey = typeof mapping?.lotNumber === 'string' ? mapping.lotNumber : undefined;
      const barcodeKey = typeof mapping?.barcode === 'string' ? mapping.barcode : undefined;
      const expiryKey = typeof mapping?.expirationDate === 'string' ? mapping.expirationDate : undefined;
      const notesKey = typeof mapping?.notes === 'string' ? mapping.notes : undefined;
      const descKey = typeof mapping?.description === 'string' ? mapping.description : undefined;

      const name = nameKey ? getFirstField(row, [String(nameKey).toLowerCase()]) : getFirstField(row, ['name', 'item', 'itemname']);
      if (!name) {
        if (summary.errors.length < 25) summary.errors.push(`Row ${i + 2}: missing item name`);
        continue;
      }

      const categoryRaw = (categoryKey
        ? (getFirstField(row, [String(categoryKey).toLowerCase()]) || 'reagent')
        : (getFirstField(row, ['category', 'type']) || 'reagent')
      ).toLowerCase();
      const category = INVENTORY_CATEGORIES.includes(categoryRaw as any) ? (categoryRaw as any) : ('reagent' as any);

      const catalogNumber = catalogKey ? getFirstField(row, [String(catalogKey).toLowerCase()]) : getFirstField(row, ['catalognumber', 'catalog', 'sku']);
      const manufacturer = manufacturerKey ? getFirstField(row, [String(manufacturerKey).toLowerCase()]) : getFirstField(row, ['manufacturer', 'mfg']);
      const supplier = supplierKey ? getFirstField(row, [String(supplierKey).toLowerCase()]) : getFirstField(row, ['supplier', 'vendor']);
      const unit = unitKey ? getFirstField(row, [String(unitKey).toLowerCase()]) : getFirstField(row, ['unit', 'uom']);
      const description = descKey ? getFirstField(row, [String(descKey).toLowerCase()]) : getFirstField(row, ['description', 'desc']);

      const quantityRaw = quantityKey ? getFirstField(row, [String(quantityKey).toLowerCase()]) : getFirstField(row, ['quantity', 'qty', 'amount']);
      const quantity = parseOptionalNumber(quantityRaw);

      const locationName = locationKey ? getFirstField(row, [String(locationKey).toLowerCase()]) : getFirstField(row, ['location', 'freezer', 'room', 'shelf']);
      const lotNumber = lotKey ? getFirstField(row, [String(lotKey).toLowerCase()]) : getFirstField(row, ['lotnumber', 'lot']);
      const barcode = barcodeKey ? getFirstField(row, [String(barcodeKey).toLowerCase()]) : getFirstField(row, ['barcode']);
      const notes = notesKey ? getFirstField(row, [String(notesKey).toLowerCase()]) : getFirstField(row, ['notes', 'note']);
      const expirationDateRaw = expiryKey ? getFirstField(row, [String(expiryKey).toLowerCase()]) : getFirstField(row, ['expirationdate', 'expiry', 'expires']);

      const itemMatchWhere = catalogNumber
        ? { name, catalogNumber }
        : { name };

      const existing = await prisma.inventoryItem.findFirst({ where: itemMatchWhere });
      const item = existing
        ? await prisma.inventoryItem.update({
            where: { id: existing.id },
            data: {
              category,
              description: description ?? existing.description,
              catalogNumber: catalogNumber ?? existing.catalogNumber,
              manufacturer: manufacturer ?? existing.manufacturer,
              supplier: supplier ?? existing.supplier,
              unit: unit ?? existing.unit
            }
          })
        : await prisma.inventoryItem.create({
            data: {
              name,
              category,
              description,
              catalogNumber,
              manufacturer,
              supplier,
              unit
            }
          });

      if (existing) summary.itemsUpdated++;
      else summary.itemsCreated++;

      if (quantity !== undefined && quantity > 0) {
        let locationId: string | undefined;
        if (locationName) {
          const existingLocation = await prisma.location.findFirst({ where: { name: locationName } });
          const loc = existingLocation || (await prisma.location.create({ data: { name: locationName } }));
          locationId = loc.id;
        }

        let expirationDate: Date | undefined;
        if (expirationDateRaw) {
          const d = new Date(expirationDateRaw);
          if (!Number.isNaN(d.valueOf())) expirationDate = d;
          else if (summary.warnings.length < 25) summary.warnings.push(`Row ${i + 2}: invalid expirationDate '${expirationDateRaw}' ignored`);
        }

        try {
          await prisma.stock.create({
            data: {
              itemId: item.id,
              locationId,
              lotNumber,
              quantity,
              initialQuantity: quantity,
              expirationDate,
              barcode,
              notes
            }
          });
          summary.stocksCreated++;
        } catch (e: any) {
          if (summary.errors.length < 25) summary.errors.push(`Row ${i + 2}: failed to create stock (${e?.code || 'error'})`);
        }
      }
    }

    res.json(summary);
  } catch (error) {
    console.error('Access import error:', error);
    res.status(500).json({ error: 'Failed to import Access database' });
  } finally {
    try {
      if (fs.existsSync(importPath)) fs.unlinkSync(importPath);
    } catch {
      // ignore cleanup errors
    }
  }
});

app.get('/inventory/:id', async (req, res) => {
  try {
    const item = await prisma.inventoryItem.findUnique({
      where: { id: req.params.id },
      include: { stocks: { include: { location: true } } }
    });
    if (!item) return res.status(404).json({ error: 'Item not found' });
    res.json({
      ...item,
      properties: item.properties ? JSON.parse(item.properties) : undefined
    });
  } catch (error) {
    res.status(500).json({ error: 'Database error' });
  }
});

const stockSchema = z.object({
  itemId: z.string().uuid(),
  locationId: z.string().uuid().optional(),
  lotNumber: z.string().optional(),
  quantity: z.number().positive(),
  expirationDate: z.string().optional(),
  barcode: z.string().optional(),
  notes: z.string().optional()
});

app.get('/stock', async (req, res) => {
  try {
    const { itemId, locationId, status } = req.query;
    const where: any = {};
    if (itemId) where.itemId = itemId;
    if (locationId) where.locationId = locationId;
    if (status) where.status = status;
    
    const stocks = await prisma.stock.findMany({
      where,
      include: { item: true, location: true }
    });
    res.json(stocks);
  } catch (error) {
    res.status(500).json({ error: 'Database error' });
  }
});

app.post('/stock', async (req, res) => {
  const parse = stockSchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ error: parse.error.flatten() });
  }
  try {
    const { expirationDate, ...rest } = parse.data;
    const stock = await prisma.stock.create({
      data: {
        ...rest,
        initialQuantity: rest.quantity,
        expirationDate: expirationDate ? new Date(expirationDate) : undefined
      },
      include: { item: true, location: true }
    });
    res.status(201).json(stock);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create stock' });
  }
});

app.patch('/stock/:id', async (req, res) => {
  const { quantity, status, locationId, notes } = req.body;
  try {
    const stock = await prisma.stock.update({
      where: { id: req.params.id },
      data: { quantity, status, locationId, notes },
      include: { item: true, location: true }
    });
    
    // Auto-update status based on quantity
    if (stock.quantity === 0 && stock.status !== 'empty') {
      await prisma.stock.update({
        where: { id: req.params.id },
        data: { status: 'empty' }
      });
    } else if (stock.quantity < stock.initialQuantity * 0.1 && stock.status === 'available') {
      await prisma.stock.update({
        where: { id: req.params.id },
        data: { status: 'low' }
      });
      // Create notification for low stock
      const managers = await prisma.user.findMany({ where: { role: 'manager' } });
      for (const manager of managers) {
        await prisma.notification.create({
          data: {
            userId: manager.id,
            type: 'stock_low',
            title: 'Low Stock Alert',
            message: `Stock for ${stock.item.name} is running low`,
            entityType: 'stock',
            entityId: stock.id
          }
        });
      }
    }
    
    res.json(stock);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update stock' });
  }
});

// Record stock usage in experiment
app.post('/experiments/:experimentId/stock-usage', async (req, res) => {
  const user = (req as any).user as User;
  const { experimentId } = req.params;
  const { stockId, quantityUsed, notes } = req.body;

  try {
    const experiment = await prisma.experiment.findUnique({ where: { id: experimentId } });
    if (!experiment) return res.status(404).json({ error: 'Experiment not found' });
    if (experiment.userId !== user.id && user.role !== 'manager') {
      return res.status(403).json({ error: 'Not authorized' });
    }

    const stock = await prisma.stock.findUnique({ where: { id: stockId } });
    if (!stock) return res.status(404).json({ error: 'Stock not found' });
    if (stock.quantity < quantityUsed) {
      return res.status(400).json({ error: 'Insufficient stock' });
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
  } catch (error) {
    res.status(500).json({ error: 'Failed to record stock usage' });
  }
});

// ==================== METHOD VERSIONING ====================

app.post('/methods/:id/new-version', async (req, res) => {
  const user = (req as any).user as User;
  const { id } = req.params;

  try {
    const original = await prisma.method.findUnique({ where: { id } });
    if (!original) return res.status(404).json({ error: 'Method not found' });

    // Find the root parent (original method)
    let rootId = original.parentMethodId || original.id;

    // Get the latest version number
    const latestVersion = await prisma.method.findFirst({
      where: { OR: [{ id: rootId }, { parentMethodId: rootId }] },
      orderBy: { version: 'desc' }
    });

    const newVersion = await prisma.method.create({
      data: {
        title: original.title,
        category: original.category,
        steps: original.steps,
        reagents: original.reagents,
        attachments: original.attachments,
        createdBy: user.id,
        version: (latestVersion?.version || 0) + 1,
        isPublic: original.isPublic,
        parentMethodId: rootId
      }
    });

    res.status(201).json(newVersion);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create new version' });
  }
});

app.get('/methods/:id/versions', async (req, res) => {
  const { id } = req.params;
  try {
    const method = await prisma.method.findUnique({ where: { id } });
    if (!method) return res.status(404).json({ error: 'Method not found' });

    const rootId = method.parentMethodId || method.id;
    const versions = await prisma.method.findMany({
      where: { OR: [{ id: rootId }, { parentMethodId: rootId }] },
      orderBy: { version: 'desc' }
    });

    res.json(versions);
  } catch (error) {
    res.status(500).json({ error: 'Database error' });
  }
});

// ==================== ELECTRONIC SIGNATURES ====================

const signatureSchema = z.object({
  signatureType: z.enum(SIGNATURE_TYPES),
  meaning: z.string().optional()
});

function computeContentHash(content: any): string {
  return crypto.createHash('sha256').update(JSON.stringify(content)).digest('hex');
}

app.post('/experiments/:id/sign', async (req, res) => {
  const user = (req as any).user as User;
  const { id } = req.params;
  const parse = signatureSchema.safeParse(req.body);
  
  if (!parse.success) {
    return res.status(400).json({ error: parse.error.flatten() });
  }

  try {
    const experiment = await prisma.experiment.findUnique({ where: { id } });
    if (!experiment) return res.status(404).json({ error: 'Experiment not found' });

    // Compute hash of current experiment state
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

    // Update experiment status if author signs
    if (parse.data.signatureType === 'author') {
      await prisma.experiment.update({
        where: { id },
        data: { status: 'signed' }
      });
    }

    res.status(201).json(signature);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create signature' });
  }
});

app.get('/experiments/:id/signatures', async (req, res) => {
  try {
    const signatures = await prisma.signature.findMany({
      where: { experimentId: req.params.id },
      include: { user: { select: { id: true, name: true, email: true } } }
    });
    res.json(signatures);
  } catch (error) {
    res.status(500).json({ error: 'Database error' });
  }
});

app.post('/methods/:id/sign', async (req, res) => {
  const user = (req as any).user as User;
  const { id } = req.params;
  const parse = signatureSchema.safeParse(req.body);
  
  if (!parse.success) {
    return res.status(400).json({ error: parse.error.flatten() });
  }

  try {
    const method = await prisma.method.findUnique({ where: { id } });
    if (!method) return res.status(404).json({ error: 'Method not found' });

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
  } catch (error) {
    res.status(500).json({ error: 'Failed to create signature' });
  }
});

// ==================== COMMENTS ====================

const commentSchema = z.object({
  content: z.string().min(1),
  parentId: z.string().uuid().optional()
});

app.get('/experiments/:id/comments', async (req, res) => {
  try {
    const comments = await prisma.comment.findMany({
      where: { experimentId: req.params.id },
      include: { 
        author: { select: { id: true, name: true } },
        replies: { include: { author: { select: { id: true, name: true } } } }
      },
      orderBy: { createdAt: 'asc' }
    });
    res.json(comments.filter(c => !c.parentId)); // Return only top-level comments
  } catch (error) {
    res.status(500).json({ error: 'Database error' });
  }
});

app.post('/experiments/:id/comments', async (req, res) => {
  const user = (req as any).user as User;
  const { id } = req.params;
  const parse = commentSchema.safeParse(req.body);
  
  if (!parse.success) {
    return res.status(400).json({ error: parse.error.flatten() });
  }

  try {
    const experiment = await prisma.experiment.findUnique({ where: { id } });
    if (!experiment) return res.status(404).json({ error: 'Experiment not found' });

    const comment = await prisma.comment.create({
      data: {
        content: parse.data.content,
        authorId: user.id,
        experimentId: id,
        parentId: parse.data.parentId
      },
      include: { author: { select: { id: true, name: true } } }
    });

    // Notify experiment owner
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
  } catch (error) {
    res.status(500).json({ error: 'Failed to create comment' });
  }
});

app.get('/methods/:id/comments', async (req, res) => {
  try {
    const comments = await prisma.comment.findMany({
      where: { methodId: req.params.id },
      include: { 
        author: { select: { id: true, name: true } },
        replies: { include: { author: { select: { id: true, name: true } } } }
      },
      orderBy: { createdAt: 'asc' }
    });
    res.json(comments.filter(c => !c.parentId));
  } catch (error) {
    res.status(500).json({ error: 'Database error' });
  }
});

app.post('/methods/:id/comments', async (req, res) => {
  const user = (req as any).user as User;
  const { id } = req.params;
  const parse = commentSchema.safeParse(req.body);
  
  if (!parse.success) {
    return res.status(400).json({ error: parse.error.flatten() });
  }

  try {
    const method = await prisma.method.findUnique({ where: { id } });
    if (!method) return res.status(404).json({ error: 'Method not found' });

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
  } catch (error) {
    res.status(500).json({ error: 'Failed to create comment' });
  }
});

// ==================== NOTIFICATIONS ====================

app.get('/notifications', async (req, res) => {
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

app.patch('/notifications/:id/read', async (req, res) => {
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

app.patch('/notifications/read-all', async (req, res) => {
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

// ==================== ENHANCED AUDIT LOGGING ====================

async function logChange(
  entityType: string,
  entityId: string,
  operation: string,
  oldValue?: any,
  newValue?: any,
  fieldName?: string,
  deviceId?: string
) {
  await prisma.changeLog.create({
    data: {
      entityType,
      entityId,
      operation,
      oldValue: oldValue ? JSON.stringify(oldValue) : undefined,
      newValue: newValue ? JSON.stringify(newValue) : undefined,
      fieldName,
      deviceId
    }
  });
}

app.get('/audit-log', async (req, res) => {
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

    res.json(logs.map(log => ({
      ...log,
      oldValue: log.oldValue ? JSON.parse(log.oldValue) : undefined,
      newValue: log.newValue ? JSON.parse(log.newValue) : undefined
    })));
  } catch (error) {
    res.status(500).json({ error: 'Database error' });
  }
});

*/
