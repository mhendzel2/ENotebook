import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import crypto from 'crypto';
import http from 'http';
import { PrismaClient } from '@prisma/client';
import type { User } from '@eln/shared/dist/types.js';
import { createApiKeyRoutes } from './middleware/apiKey.js';
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
