/**
 * Data Export Service
 * Provides export functionality in multiple formats (JSON, CSV, XLSX, PDF)
 */

import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { Parser } from 'json2csv';

const router = Router();

// ==================== EXPORT HELPERS ====================

/**
 * Flatten nested object for CSV export
 */
function flattenObject(obj: Record<string, unknown>, prefix = ''): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  
  for (const [key, value] of Object.entries(obj)) {
    const newKey = prefix ? `${prefix}.${key}` : key;
    
    if (value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)) {
      Object.assign(result, flattenObject(value as Record<string, unknown>, newKey));
    } else if (Array.isArray(value)) {
      result[newKey] = JSON.stringify(value);
    } else {
      result[newKey] = value;
    }
  }
  
  return result;
}

/**
 * Convert data to CSV format
 */
function toCSV(data: Record<string, unknown>[]): string {
  if (data.length === 0) return '';
  
  // Flatten all objects
  const flattened = data.map(item => flattenObject(item));
  
  // Get all unique keys
  const allKeys = new Set<string>();
  flattened.forEach(item => Object.keys(item).forEach(key => allKeys.add(key)));
  
  const parser = new Parser({ fields: Array.from(allKeys) });
  return parser.parse(flattened);
}

/**
 * Generate PDF report (placeholder - would use a PDF library)
 */
function toPDF(data: Record<string, unknown>[], title: string): Buffer {
  // In a real implementation, use pdfkit, puppeteer, or similar
  // For now, return a simple text representation
  const content = `${title}\n${'='.repeat(title.length)}\n\n${JSON.stringify(data, null, 2)}`;
  return Buffer.from(content, 'utf-8');
}

// ==================== EXPORT ROUTES ====================

export function createExportRoutes(prisma: PrismaClient): Router {
  
  // Export experiments
  router.get('/export/experiments', async (req: Request, res: Response) => {
    const user = (req as any).user;
    const { format = 'json', ids, includeAttachments } = req.query;
    
    try {
      // Build query
      const where: any = user.role === 'manager' ? {} : { userId: user.id };
      
      if (ids) {
        const idList = Array.isArray(ids) ? ids : [ids];
        where.id = { in: idList };
      }
      
      // Fetch experiments
      const experiments = await prisma.experiment.findMany({
        where,
        include: {
          signatures: {
            include: { user: { select: { id: true, name: true, email: true } } }
          },
          comments: {
            include: { author: { select: { id: true, name: true } } }
          },
          attachments: includeAttachments === 'true',
          stockUsages: {
            include: { 
              stock: { 
                include: { item: true } 
              } 
            }
          }
        }
      });
      
      // Parse JSON fields (Prisma returns JSON fields as objects, not strings)
      const parsed = experiments.map((e: any) => ({
        ...e,
        params: e.params ?? undefined,
        observations: e.observations ?? undefined,
        tags: e.tags ?? []
      }));
      
      // Return in requested format
      switch (format) {
        case 'csv':
          res.setHeader('Content-Type', 'text/csv');
          res.setHeader('Content-Disposition', 'attachment; filename=experiments.csv');
          return res.send(toCSV(parsed));
          
        case 'xlsx':
          // Would use exceljs or xlsx library
          res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
          res.setHeader('Content-Disposition', 'attachment; filename=experiments.xlsx');
          // For now, return CSV as placeholder
          return res.send(toCSV(parsed));
          
        case 'pdf':
          res.setHeader('Content-Type', 'application/pdf');
          res.setHeader('Content-Disposition', 'attachment; filename=experiments.pdf');
          return res.send(toPDF(parsed, 'Experiments Export'));
          
        case 'zip':
          // Would create ZIP with attachments
          res.status(501).json({ error: 'ZIP export not yet implemented' });
          return;
          
        default:
          res.json({
            exportedAt: new Date().toISOString(),
            count: parsed.length,
            data: parsed
          });
      }
    } catch (error) {
      console.error('Export error:', error);
      res.status(500).json({ error: 'Export failed' });
    }
  });
  
  // Export methods
  router.get('/export/methods', async (req: Request, res: Response) => {
    const { format = 'json', ids } = req.query;
    
    try {
      const where: any = {};
      if (ids) {
        const idList = Array.isArray(ids) ? ids : [ids];
        where.id = { in: idList };
      }
      
      const methods = await prisma.method.findMany({ where });
      
      const parsed = methods.map((m: any) => ({
        ...m,
        steps: m.steps,
        reagents: m.reagents ?? undefined,
        attachments: m.attachments ?? undefined
      }));
      
      switch (format) {
        case 'csv':
          res.setHeader('Content-Type', 'text/csv');
          res.setHeader('Content-Disposition', 'attachment; filename=methods.csv');
          return res.send(toCSV(parsed));
          
        default:
          res.json({
            exportedAt: new Date().toISOString(),
            count: parsed.length,
            data: parsed
          });
      }
    } catch (error) {
      res.status(500).json({ error: 'Export failed' });
    }
  });
  
  // Export inventory
  router.get('/export/inventory', async (req: Request, res: Response) => {
    const { format = 'json', category, includeStocks } = req.query;
    
    try {
      const where: any = {};
      if (category) where.category = category;
      
      const items = await prisma.inventoryItem.findMany({
        where,
        include: {
          stocks: includeStocks === 'true' ? {
            include: { location: true }
          } : false
        }
      });
      
      const parsed = items.map((item: any) => ({
        ...item,
        properties: item.properties ? JSON.parse(item.properties) : undefined
      }));
      
      switch (format) {
        case 'csv':
          res.setHeader('Content-Type', 'text/csv');
          res.setHeader('Content-Disposition', 'attachment; filename=inventory.csv');
          return res.send(toCSV(parsed));
          
        default:
          res.json({
            exportedAt: new Date().toISOString(),
            count: parsed.length,
            data: parsed
          });
      }
    } catch (error) {
      res.status(500).json({ error: 'Export failed' });
    }
  });
  
  // Export audit log
  router.get('/export/audit-log', async (req: Request, res: Response) => {
    const user = (req as any).user;
    
    if (user.role !== 'manager' && user.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    const { format = 'json', entityType, startDate, endDate } = req.query;
    
    try {
      const where: any = {};
      if (entityType) where.entityType = entityType;
      if (startDate || endDate) {
        where.createdAt = {};
        if (startDate) where.createdAt.gte = new Date(startDate as string);
        if (endDate) where.createdAt.lte = new Date(endDate as string);
      }
      
      const logs = await prisma.changeLog.findMany({
        where,
        orderBy: { createdAt: 'desc' }
      });
      
      const parsed = logs.map((log: any) => ({
        ...log,
        oldValue: log.oldValue ? JSON.parse(log.oldValue) : undefined,
        newValue: log.newValue ? JSON.parse(log.newValue) : undefined
      }));
      
      switch (format) {
        case 'csv':
          res.setHeader('Content-Type', 'text/csv');
          res.setHeader('Content-Disposition', 'attachment; filename=audit-log.csv');
          return res.send(toCSV(parsed));
          
        default:
          res.json({
            exportedAt: new Date().toISOString(),
            count: parsed.length,
            data: parsed
          });
      }
    } catch (error) {
      res.status(500).json({ error: 'Export failed' });
    }
  });
  
  // Bulk export (ZIP with all data)
  router.get('/export/full', async (req: Request, res: Response) => {
    const user = (req as any).user;
    
    if (user.role !== 'manager' && user.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied - full export requires manager/admin role' });
    }
    
    try {
      // Gather all data
      const [experiments, methods, inventory, locations, users] = await Promise.all([
        prisma.experiment.findMany(),
        prisma.method.findMany(),
        prisma.inventoryItem.findMany({ include: { stocks: true } }),
        prisma.location.findMany(),
        prisma.user.findMany({ select: { id: true, name: true, email: true, role: true, createdAt: true } })
      ]);
      
      // Parse JSON fields (Prisma JSON fields are already objects)
      const exportData = {
        exportedAt: new Date().toISOString(),
        exportedBy: user.id,
        version: '1.0',
        data: {
          experiments: experiments.map((e: any) => ({
            ...e,
            params: e.params ?? undefined,
            observations: e.observations ?? undefined,
            tags: e.tags ?? []
          })),
          methods: methods.map((m: any) => ({
            ...m,
            steps: m.steps,
            reagents: m.reagents ?? undefined,
            attachments: m.attachments ?? undefined
          })),
          inventory: inventory.map((item: any) => ({
            ...item,
            properties: item.properties ?? undefined
          })),
          locations,
          users
        }
      };
      
      res.json(exportData);
    } catch (error) {
      res.status(500).json({ error: 'Full export failed' });
    }
  });
  
  return router;
}

export default router;
