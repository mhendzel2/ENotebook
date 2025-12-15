/**
 * Immutable Audit Trail Service
 * Time-stamped audit logs with hash chain verification
 * 
 * Features:
 * - Hash chain for tamper detection
 * - Comprehensive event tracking
 * - Export capabilities for compliance
 * - Searchable audit history
 */

import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';
import { Request, Response, Router } from 'express';

// ==================== TYPES ====================

export interface AuditEntry {
  id: string;
  timestamp: Date;
  userId: string;
  userName: string;
  action: AuditAction;
  entityType: string;
  entityId: string;
  entityName?: string;
  details: Record<string, any>;
  previousHash: string | null;
  entryHash: string;
  ipAddress?: string;
  userAgent?: string;
  deviceId?: string;
}

export type AuditAction =
  | 'create'
  | 'read'
  | 'update'
  | 'delete'
  | 'sign'
  | 'approve'
  | 'reject'
  | 'export'
  | 'import'
  | 'login'
  | 'logout'
  | 'permission_change'
  | 'settings_change'
  | 'api_key_create'
  | 'api_key_revoke'
  | 'stock_use'
  | 'stock_adjust'
  | 'backup_create'
  | 'backup_restore';

export interface AuditQuery {
  userId?: string;
  entityType?: string;
  entityId?: string;
  action?: AuditAction;
  startDate?: Date;
  endDate?: Date;
  search?: string;
  limit?: number;
  offset?: number;
}

// ==================== AUDIT TRAIL SERVICE ====================

export class AuditTrailService {
  private prisma: PrismaClient;
  private lastHash: string | null = null;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
    this.initializeHashChain();
  }

  /**
   * Initialize hash chain from existing records
   */
  private async initializeHashChain(): Promise<void> {
    const lastEntry = await this.prisma.changeLog.findFirst({
      orderBy: { createdAt: 'desc' }
    });

    if (lastEntry && lastEntry.newValue) {
      try {
        const parsed = JSON.parse(lastEntry.newValue);
        this.lastHash = parsed.entryHash || null;
      } catch {
        this.lastHash = null;
      }
    }
  }

  /**
   * Generate hash for audit entry
   */
  private generateEntryHash(
    previousHash: string | null,
    timestamp: Date,
    userId: string,
    action: string,
    entityType: string,
    entityId: string,
    details: string
  ): string {
    const data = [
      previousHash || 'GENESIS',
      timestamp.toISOString(),
      userId,
      action,
      entityType,
      entityId,
      details
    ].join('|');

    return crypto.createHash('sha256').update(data).digest('hex');
  }

  /**
   * Log an audit event
   */
  async log(
    userId: string,
    userName: string,
    action: AuditAction,
    entityType: string,
    entityId: string,
    details: Record<string, any>,
    options?: {
      ipAddress?: string;
      userAgent?: string;
      deviceId?: string;
      entityName?: string;
    }
  ): Promise<AuditEntry> {
    const timestamp = new Date();
    const detailsStr = JSON.stringify(details);
    
    const entryHash = this.generateEntryHash(
      this.lastHash,
      timestamp,
      userId,
      action,
      entityType,
      entityId,
      detailsStr
    );

    const auditData = {
      timestamp,
      userId,
      userName,
      action,
      entityType,
      entityId,
      entityName: options?.entityName,
      details,
      previousHash: this.lastHash,
      entryHash,
      ipAddress: options?.ipAddress,
      userAgent: options?.userAgent,
      deviceId: options?.deviceId,
    };

    // Store in database
    const entry = await this.prisma.changeLog.create({
      data: {
        entityType,
        entityId,
        operation: action,
        deviceId: options?.deviceId,
        newValue: JSON.stringify(auditData),
      }
    });

    // Update hash chain
    this.lastHash = entryHash;

    return {
      id: entry.id,
      ...auditData,
    };
  }

  /**
   * Query audit trail
   */
  async query(params: AuditQuery): Promise<{ entries: AuditEntry[]; total: number }> {
    const where: any = {};

    if (params.entityType) where.entityType = params.entityType;
    if (params.entityId) where.entityId = params.entityId;
    if (params.action) where.operation = params.action;
    
    if (params.startDate || params.endDate) {
      where.createdAt = {};
      if (params.startDate) where.createdAt.gte = params.startDate;
      if (params.endDate) where.createdAt.lte = params.endDate;
    }

    const [entries, total] = await Promise.all([
      this.prisma.changeLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: params.limit || 100,
        skip: params.offset || 0,
      }),
      this.prisma.changeLog.count({ where })
    ]);

    // Parse and filter by userId if needed
    let parsedEntries = entries.map((e: any) => {
      try {
        const data = e.newValue ? JSON.parse(e.newValue) : {};
        return {
          id: e.id,
          timestamp: e.createdAt,
          userId: data.userId || '',
          userName: data.userName || '',
          action: e.operation as AuditAction,
          entityType: e.entityType,
          entityId: e.entityId,
          entityName: data.entityName,
          details: data.details || {},
          previousHash: data.previousHash,
          entryHash: data.entryHash,
          ipAddress: data.ipAddress,
          userAgent: data.userAgent,
          deviceId: e.deviceId || undefined,
        };
      } catch {
        return null;
      }
    }).filter((entry: any): entry is NonNullable<any> => entry !== null) as AuditEntry[];

    if (params.userId) {
      parsedEntries = parsedEntries.filter((e: any) => e.userId === params.userId);
    }

    if (params.search) {
      const searchLower = params.search.toLowerCase();
      parsedEntries = parsedEntries.filter((e: any) =>
        e.userName?.toLowerCase().includes(searchLower) ||
        e.entityType.toLowerCase().includes(searchLower) ||
        e.entityId.toLowerCase().includes(searchLower) ||
        e.entityName?.toLowerCase().includes(searchLower) ||
        JSON.stringify(e.details).toLowerCase().includes(searchLower)
      );
    }

    return { entries: parsedEntries, total };
  }

  /**
   * Verify hash chain integrity
   */
  async verifyIntegrity(startFrom?: Date): Promise<{
    valid: boolean;
    totalEntries: number;
    validEntries: number;
    invalidEntries: { id: string; reason: string }[];
  }> {
    const where: any = startFrom ? { createdAt: { gte: startFrom } } : {};
    
    const entries = await this.prisma.changeLog.findMany({
      where,
      orderBy: { createdAt: 'asc' },
    });

    let previousHash: string | null = null;
    let validCount = 0;
    const invalid: { id: string; reason: string }[] = [];

    for (const entry of entries) {
      try {
        const data = entry.newValue ? JSON.parse(entry.newValue) : null;
        
        if (!data) {
          invalid.push({ id: entry.id, reason: 'Missing audit data' });
          continue;
        }

        // Verify previous hash matches chain
        if (data.previousHash !== previousHash && previousHash !== null) {
          invalid.push({ 
            id: entry.id, 
            reason: `Chain break: expected ${previousHash}, got ${data.previousHash}` 
          });
        }

        // Recalculate and verify entry hash
        const expectedHash = this.generateEntryHash(
          data.previousHash,
          new Date(data.timestamp),
          data.userId,
          data.action || entry.operation,
          data.entityType || entry.entityType,
          data.entityId || entry.entityId,
          JSON.stringify(data.details || {})
        );

        if (data.entryHash !== expectedHash) {
          invalid.push({ 
            id: entry.id, 
            reason: 'Hash mismatch - entry may have been tampered with' 
          });
        } else {
          validCount++;
        }

        previousHash = data.entryHash;
      } catch (error) {
        invalid.push({ id: entry.id, reason: 'Failed to parse entry' });
      }
    }

    return {
      valid: invalid.length === 0,
      totalEntries: entries.length,
      validEntries: validCount,
      invalidEntries: invalid,
    };
  }

  /**
   * Get audit trail for specific entity
   */
  async getEntityHistory(entityType: string, entityId: string): Promise<AuditEntry[]> {
    const result = await this.query({ entityType, entityId, limit: 1000 });
    return result.entries;
  }

  /**
   * Get user activity
   */
  async getUserActivity(userId: string, days: number = 30): Promise<AuditEntry[]> {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const result = await this.query({ userId, startDate, limit: 1000 });
    return result.entries;
  }

  /**
   * Export audit trail
   */
  async export(
    params: AuditQuery,
    format: 'json' | 'csv'
  ): Promise<string> {
    const result = await this.query({ ...params, limit: 100000 });

    if (format === 'csv') {
      const headers = [
        'ID', 'Timestamp', 'User ID', 'User Name', 'Action',
        'Entity Type', 'Entity ID', 'Entity Name', 'Details',
        'IP Address', 'User Agent', 'Entry Hash'
      ];

      const rows = result.entries.map(e => [
        e.id,
        e.timestamp.toISOString(),
        e.userId,
        e.userName,
        e.action,
        e.entityType,
        e.entityId,
        e.entityName || '',
        JSON.stringify(e.details),
        e.ipAddress || '',
        e.userAgent || '',
        e.entryHash
      ]);

      return [headers.join(','), ...rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))].join('\n');
    }

    return JSON.stringify({
      exportedAt: new Date().toISOString(),
      query: params,
      total: result.total,
      entries: result.entries,
    }, null, 2);
  }
}

// ==================== EXPRESS MIDDLEWARE ====================

/**
 * Middleware to automatically log requests
 */
export function auditMiddleware(auditService: AuditTrailService) {
  return async (req: Request, res: Response, next: Function) => {
    const originalSend = res.send;
    const user = (req as any).user;

    res.send = function(body: any) {
      // Only log successful mutations
      if (user && res.statusCode < 400) {
        const action = getActionFromMethod(req.method);
        const { entityType, entityId } = parseRoute(req.path);

        if (entityType && action !== 'read') {
          auditService.log(
            user.id,
            user.name,
            action,
            entityType,
            entityId || 'new',
            {
              method: req.method,
              path: req.path,
              statusCode: res.statusCode,
              bodySize: body ? body.length : 0,
            },
            {
              ipAddress: req.ip,
              userAgent: req.get('User-Agent'),
            }
          ).catch(console.error);
        }
      }

      return originalSend.call(this, body);
    };

    next();
  };
}

function getActionFromMethod(method: string): AuditAction {
  switch (method.toUpperCase()) {
    case 'POST': return 'create';
    case 'PUT':
    case 'PATCH': return 'update';
    case 'DELETE': return 'delete';
    default: return 'read';
  }
}

function parseRoute(path: string): { entityType?: string; entityId?: string } {
  const parts = path.split('/').filter(Boolean);
  
  // Handle common patterns like /experiments/123 or /api/v1/experiments/123
  const entityTypes = ['experiments', 'methods', 'inventory', 'stocks', 'users', 'signatures'];
  
  for (let i = 0; i < parts.length; i++) {
    if (entityTypes.includes(parts[i])) {
      return {
        entityType: parts[i].replace(/s$/, ''), // Remove trailing 's'
        entityId: parts[i + 1] || undefined
      };
    }
  }

  return {};
}

// ==================== EXPRESS ROUTES ====================

export function createAuditRoutes(prisma: PrismaClient): Router {
  const router = Router();
  const auditService = new AuditTrailService(prisma);

  // Query audit trail
  router.get('/audit', async (req: Request, res: Response) => {
    const user = (req as any).user;
    
    // Only managers/admins can view full audit trail
    if (user.role !== 'manager' && user.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied' });
    }

    const {
      userId, entityType, entityId, action,
      startDate, endDate, search, limit, offset
    } = req.query;

    try {
      const result = await auditService.query({
        userId: userId as string,
        entityType: entityType as string,
        entityId: entityId as string,
        action: action as AuditAction,
        startDate: startDate ? new Date(startDate as string) : undefined,
        endDate: endDate ? new Date(endDate as string) : undefined,
        search: search as string,
        limit: limit ? parseInt(limit as string) : 100,
        offset: offset ? parseInt(offset as string) : 0,
      });

      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get entity history
  router.get('/audit/entity/:entityType/:entityId', async (req: Request, res: Response) => {
    const { entityType, entityId } = req.params;

    try {
      const history = await auditService.getEntityHistory(entityType, entityId);
      res.json(history);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Verify audit trail integrity
  router.get('/audit/verify', async (req: Request, res: Response) => {
    const user = (req as any).user;
    
    if (user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const { startDate } = req.query;

    try {
      const result = await auditService.verifyIntegrity(
        startDate ? new Date(startDate as string) : undefined
      );
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Export audit trail
  router.get('/audit/export', async (req: Request, res: Response) => {
    const user = (req as any).user;
    
    if (user.role !== 'manager' && user.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied' });
    }

    const {
      format = 'json',
      entityType, entityId, action,
      startDate, endDate
    } = req.query;

    try {
      const exported = await auditService.export(
        {
          entityType: entityType as string,
          entityId: entityId as string,
          action: action as AuditAction,
          startDate: startDate ? new Date(startDate as string) : undefined,
          endDate: endDate ? new Date(endDate as string) : undefined,
        },
        format as 'json' | 'csv'
      );

      if (format === 'csv') {
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename=audit-trail.csv');
      } else {
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', 'attachment; filename=audit-trail.json');
      }

      res.send(exported);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  return router;
}
