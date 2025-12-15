/**
 * Dashboard & Analytics Service
 * 
 * Implements custom dashboards with SQL queries and chart visualizations,
 * similar to Labguru's Dashboards feature.
 * 
 * Features:
 * - Custom SQL queries (parameterized, safe)
 * - Multiple chart types (bar, line, pie, scatter)
 * - Dashboard layouts with widgets
 * - Query templates for common reports
 * - Export and sharing capabilities
 */

import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';

// ==================== TYPES ====================

export type ChartType = 'bar' | 'line' | 'pie' | 'scatter' | 'area' | 'doughnut' | 'table' | 'metric';

export interface ChartConfig {
  type: ChartType;
  title?: string;
  xAxis?: { label?: string; field?: string };
  yAxis?: { label?: string; field?: string };
  colors?: string[];
  legend?: boolean;
  stacked?: boolean;
}

export interface WidgetPosition {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface QueryParameter {
  name: string;
  type: 'string' | 'number' | 'date' | 'boolean' | 'select';
  label: string;
  default?: unknown;
  options?: Array<{ value: unknown; label: string }>;
}

export interface QueryResult {
  columns: string[];
  rows: Array<Record<string, unknown>>;
  rowCount: number;
  executionTime: number;
}

// ==================== DASHBOARD SERVICE ====================

export class DashboardService {
  constructor(private prisma: PrismaClient) {}

  /**
   * Execute a safe SQL query (read-only)
   */
  async executeQuery(
    sql: string, 
    parameters: Record<string, unknown> = {}
  ): Promise<QueryResult> {
    const startTime = Date.now();

    // Validate query is read-only
    const normalizedSql = sql.trim().toLowerCase();
    if (!normalizedSql.startsWith('select')) {
      throw new Error('Only SELECT queries are allowed');
    }

    // Check for dangerous keywords
    const dangerousKeywords = ['insert', 'update', 'delete', 'drop', 'alter', 'create', 'truncate', 'exec', 'execute'];
    for (const keyword of dangerousKeywords) {
      if (normalizedSql.includes(keyword)) {
        throw new Error(`Query contains forbidden keyword: ${keyword}`);
      }
    }

    // Replace named parameters with positional parameters for Prisma
    let paramIndex = 1;
    const paramValues: unknown[] = [];
    const processedSql = sql.replace(/:(\w+)/g, (_, name) => {
      if (name in parameters) {
        paramValues.push(parameters[name]);
        return `$${paramIndex++}`;
      }
      throw new Error(`Missing parameter: ${name}`);
    });

    try {
      // Execute using Prisma's raw query
      const rows = await this.prisma.$queryRawUnsafe(processedSql, ...paramValues) as Record<string, unknown>[];
      
      const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
      
      return {
        columns,
        rows,
        rowCount: rows.length,
        executionTime: Date.now() - startTime,
      };
    } catch (error) {
      throw new Error(`Query execution failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Get predefined query templates
   */
  getQueryTemplates(): Array<{
    id: string;
    name: string;
    description: string;
    query: string;
    parameters: QueryParameter[];
    chartConfig?: ChartConfig;
  }> {
    return [
      {
        id: 'experiments_by_status',
        name: 'Experiments by Status',
        description: 'Count of experiments grouped by status',
        query: `
          SELECT status, COUNT(*) as count 
          FROM "Experiment" 
          GROUP BY status 
          ORDER BY count DESC
        `,
        parameters: [],
        chartConfig: { type: 'pie', title: 'Experiments by Status' },
      },
      {
        id: 'experiments_by_modality',
        name: 'Experiments by Modality',
        description: 'Count of experiments grouped by modality',
        query: `
          SELECT modality, COUNT(*) as count 
          FROM "Experiment" 
          GROUP BY modality 
          ORDER BY count DESC
        `,
        parameters: [],
        chartConfig: { type: 'bar', title: 'Experiments by Modality' },
      },
      {
        id: 'experiments_timeline',
        name: 'Experiments Over Time',
        description: 'Number of experiments created per month',
        query: `
          SELECT 
            strftime('%Y-%m', "createdAt") as month,
            COUNT(*) as count
          FROM "Experiment"
          WHERE "createdAt" >= :startDate
          GROUP BY month
          ORDER BY month
        `,
        parameters: [
          { name: 'startDate', type: 'date', label: 'Start Date', default: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0] },
        ],
        chartConfig: { type: 'line', title: 'Experiments Over Time', xAxis: { label: 'Month' }, yAxis: { label: 'Count' } },
      },
      {
        id: 'inventory_by_category',
        name: 'Inventory by Category',
        description: 'Count of inventory items grouped by category',
        query: `
          SELECT category, COUNT(*) as count 
          FROM "InventoryItem" 
          GROUP BY category 
          ORDER BY count DESC
        `,
        parameters: [],
        chartConfig: { type: 'doughnut', title: 'Inventory by Category' },
      },
      {
        id: 'stock_status',
        name: 'Stock Status Overview',
        description: 'Count of stocks by status',
        query: `
          SELECT status, COUNT(*) as count 
          FROM "Stock" 
          GROUP BY status
        `,
        parameters: [],
        chartConfig: { type: 'bar', title: 'Stock Status' },
      },
      {
        id: 'low_stock_items',
        name: 'Low Stock Items',
        description: 'Items with quantity below threshold',
        query: `
          SELECT 
            i.name as item_name,
            s.quantity,
            s."initialQuantity",
            s.status,
            l.name as location
          FROM "Stock" s
          JOIN "InventoryItem" i ON s."itemId" = i.id
          LEFT JOIN "Location" l ON s."locationId" = l.id
          WHERE s.quantity <= s."initialQuantity" * :threshold
          ORDER BY s.quantity / s."initialQuantity"
        `,
        parameters: [
          { name: 'threshold', type: 'number', label: 'Threshold (%)', default: 0.2 },
        ],
        chartConfig: { type: 'table', title: 'Low Stock Items' },
      },
      {
        id: 'expiring_stocks',
        name: 'Expiring Stocks',
        description: 'Stocks expiring within specified days',
        query: `
          SELECT 
            i.name as item_name,
            s."lotNumber",
            s."expirationDate",
            s.quantity,
            l.name as location
          FROM "Stock" s
          JOIN "InventoryItem" i ON s."itemId" = i.id
          LEFT JOIN "Location" l ON s."locationId" = l.id
          WHERE s."expirationDate" IS NOT NULL
            AND s."expirationDate" <= date('now', '+' || :days || ' days')
            AND s.status != 'disposed'
          ORDER BY s."expirationDate"
        `,
        parameters: [
          { name: 'days', type: 'number', label: 'Days Ahead', default: 30 },
        ],
        chartConfig: { type: 'table', title: 'Expiring Stocks' },
      },
      {
        id: 'user_activity',
        name: 'User Activity',
        description: 'Experiments created by user',
        query: `
          SELECT 
            u.name as user_name,
            COUNT(e.id) as experiment_count
          FROM "User" u
          LEFT JOIN "Experiment" e ON u.id = e."userId"
          GROUP BY u.id, u.name
          ORDER BY experiment_count DESC
        `,
        parameters: [],
        chartConfig: { type: 'bar', title: 'User Activity' },
      },
      {
        id: 'recent_signatures',
        name: 'Recent Signatures',
        description: 'Signatures recorded in the last N days',
        query: `
          SELECT 
            u.name as signer,
            s."signatureType",
            s.meaning,
            s.timestamp,
            COALESCE(e.title, m.title) as entity
          FROM "Signature" s
          JOIN "User" u ON s."userId" = u.id
          LEFT JOIN "Experiment" e ON s."experimentId" = e.id
          LEFT JOIN "Method" m ON s."methodId" = m.id
          WHERE s.timestamp >= date('now', '-' || :days || ' days')
          ORDER BY s.timestamp DESC
        `,
        parameters: [
          { name: 'days', type: 'number', label: 'Days', default: 7 },
        ],
        chartConfig: { type: 'table', title: 'Recent Signatures' },
      },
      {
        id: 'project_summary',
        name: 'Project Summary',
        description: 'Experiment counts by project',
        query: `
          SELECT 
            COALESCE(project, 'No Project') as project,
            COUNT(*) as total,
            SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
            SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END) as draft,
            SUM(CASE WHEN status = 'signed' THEN 1 ELSE 0 END) as signed
          FROM "Experiment"
          GROUP BY project
          ORDER BY total DESC
        `,
        parameters: [],
        chartConfig: { type: 'bar', title: 'Project Summary', stacked: true },
      },
    ];
  }

  /**
   * Format query result for chart
   */
  formatForChart(result: QueryResult, config: ChartConfig): {
    labels: string[];
    datasets: Array<{
      label: string;
      data: number[];
      backgroundColor?: string[];
    }>;
  } {
    const { columns, rows } = result;

    if (rows.length === 0) {
      return { labels: [], datasets: [] };
    }

    // Determine label and value columns
    const labelColumn = config.xAxis?.field || columns[0];
    const valueColumns = columns.filter(c => c !== labelColumn && typeof rows[0][c] === 'number');

    const labels = rows.map(row => String(row[labelColumn] ?? ''));
    
    const colors = config.colors || [
      '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
      '#06b6d4', '#84cc16', '#f97316', '#ec4899', '#6366f1',
    ];

    const datasets = valueColumns.map((col, index) => ({
      label: col,
      data: rows.map(row => Number(row[col]) || 0),
      backgroundColor: config.type === 'pie' || config.type === 'doughnut'
        ? colors
        : [colors[index % colors.length]],
    }));

    return { labels, datasets };
  }

  /**
   * Calculate summary metrics
   */
  async getMetrics(): Promise<Record<string, number>> {
    const [
      experimentCount,
      methodCount,
      inventoryCount,
      stockCount,
      userCount,
      signatureCount,
    ] = await Promise.all([
      this.prisma.experiment.count(),
      this.prisma.method.count(),
      this.prisma.inventoryItem.count(),
      this.prisma.stock.count(),
      this.prisma.user.count(),
      this.prisma.signature.count(),
    ]);

    const lowStockCount = await this.prisma.stock.count({
      where: { status: 'low' },
    });

    const draftExperiments = await this.prisma.experiment.count({
      where: { status: 'draft' },
    });

    return {
      experiments: experimentCount,
      methods: methodCount,
      inventoryItems: inventoryCount,
      stocks: stockCount,
      users: userCount,
      signatures: signatureCount,
      lowStockAlerts: lowStockCount,
      draftExperiments,
    };
  }
}

// ==================== API ROUTES ====================

const dashboardSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  layout: z.record(z.unknown()),
  isPublic: z.boolean().default(false),
});

const widgetSchema = z.object({
  name: z.string().min(1),
  type: z.enum(['chart_bar', 'chart_line', 'chart_pie', 'chart_scatter', 'chart_area', 'chart_doughnut', 'table', 'metric', 'sql']),
  config: z.record(z.unknown()),
  query: z.string().optional(),
  position: z.object({
    x: z.number(),
    y: z.number(),
    w: z.number(),
    h: z.number(),
  }),
  refreshRate: z.number().optional(),
});

const savedQuerySchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  query: z.string(),
  parameters: z.string().optional(),
  isPublic: z.boolean().default(false),
});

export function createDashboardRoutes(prisma: PrismaClient, dashboardService: DashboardService) {
  const router = Router();

  // Get metrics summary
  router.get('/api/analytics/metrics', async (_req, res) => {
    try {
      const metrics = await dashboardService.getMetrics();
      res.json(metrics);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch metrics' });
    }
  });

  // Get query templates
  router.get('/api/analytics/templates', async (_req, res) => {
    res.json(dashboardService.getQueryTemplates());
  });

  // Execute query template
  router.post('/api/analytics/templates/:templateId/execute', async (req, res) => {
    const { parameters = {} } = req.body;
    const templates = dashboardService.getQueryTemplates();
    const template = templates.find(t => t.id === req.params.templateId);

    if (!template) {
      return res.status(404).json({ error: 'Template not found' });
    }

    try {
      const result = await dashboardService.executeQuery(template.query, parameters);
      const chartData = template.chartConfig 
        ? dashboardService.formatForChart(result, template.chartConfig)
        : null;

      res.json({ result, chartData, chartConfig: template.chartConfig });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Query failed' });
    }
  });

  // Execute custom query
  router.post('/api/analytics/query', async (req, res) => {
    const { query, parameters = {}, chartConfig } = req.body;

    if (!query) {
      return res.status(400).json({ error: 'Query is required' });
    }

    try {
      const result = await dashboardService.executeQuery(query, parameters);
      const chartData = chartConfig 
        ? dashboardService.formatForChart(result, chartConfig)
        : null;

      res.json({ result, chartData });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Query failed' });
    }
  });

  // Get all dashboards
  router.get('/api/dashboards', async (req, res) => {
    const user = (req as any).user;

    try {
      const dashboards = await prisma.dashboard.findMany({
        where: {
          OR: [
            { createdBy: user.id },
            { isPublic: true },
          ],
        },
        include: { widgets: true },
        orderBy: { updatedAt: 'desc' },
      });

      const parsed = dashboards.map(d => ({
        ...d,
        layout: JSON.parse(d.layout),
        widgets: d.widgets.map(w => ({
          ...w,
          config: JSON.parse(w.config),
          position: JSON.parse(w.position),
        })),
      }));

      res.json(parsed);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch dashboards' });
    }
  });

  // Get single dashboard
  router.get('/api/dashboards/:id', async (req, res) => {
    try {
      const dashboard = await prisma.dashboard.findUnique({
        where: { id: req.params.id },
        include: { widgets: true },
      });

      if (!dashboard) {
        return res.status(404).json({ error: 'Dashboard not found' });
      }

      res.json({
        ...dashboard,
        layout: JSON.parse(dashboard.layout),
        widgets: dashboard.widgets.map(w => ({
          ...w,
          config: JSON.parse(w.config),
          position: JSON.parse(w.position),
        })),
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch dashboard' });
    }
  });

  // Create dashboard
  router.post('/api/dashboards', async (req, res) => {
    const parse = dashboardSchema.safeParse(req.body);
    if (!parse.success) {
      return res.status(400).json({ error: parse.error.flatten() });
    }

    const user = (req as any).user;

    try {
      const dashboard = await prisma.dashboard.create({
        data: {
          name: parse.data.name,
          description: parse.data.description,
          layout: JSON.stringify(parse.data.layout),
          isPublic: parse.data.isPublic,
          createdBy: user.id,
        },
      });

      res.status(201).json({
        ...dashboard,
        layout: JSON.parse(dashboard.layout),
        widgets: [],
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to create dashboard' });
    }
  });

  // Update dashboard
  router.put('/api/dashboards/:id', async (req, res) => {
    const parse = dashboardSchema.safeParse(req.body);
    if (!parse.success) {
      return res.status(400).json({ error: parse.error.flatten() });
    }

    try {
      const dashboard = await prisma.dashboard.update({
        where: { id: req.params.id },
        data: {
          name: parse.data.name,
          description: parse.data.description,
          layout: JSON.stringify(parse.data.layout),
          isPublic: parse.data.isPublic,
        },
        include: { widgets: true },
      });

      res.json({
        ...dashboard,
        layout: JSON.parse(dashboard.layout),
        widgets: dashboard.widgets.map(w => ({
          ...w,
          config: JSON.parse(w.config),
          position: JSON.parse(w.position),
        })),
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to update dashboard' });
    }
  });

  // Delete dashboard
  router.delete('/api/dashboards/:id', async (req, res) => {
    try {
      await prisma.dashboardWidget.deleteMany({
        where: { dashboardId: req.params.id },
      });
      await prisma.dashboard.delete({
        where: { id: req.params.id },
      });
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: 'Failed to delete dashboard' });
    }
  });

  // Add widget to dashboard
  router.post('/api/dashboards/:id/widgets', async (req, res) => {
    const parse = widgetSchema.safeParse(req.body);
    if (!parse.success) {
      return res.status(400).json({ error: parse.error.flatten() });
    }

    try {
      const widget = await prisma.dashboardWidget.create({
        data: {
          dashboardId: req.params.id,
          name: parse.data.name,
          type: parse.data.type,
          config: JSON.stringify(parse.data.config),
          query: parse.data.query,
          position: JSON.stringify(parse.data.position),
          refreshRate: parse.data.refreshRate,
        },
      });

      res.status(201).json({
        ...widget,
        config: JSON.parse(widget.config),
        position: JSON.parse(widget.position),
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to add widget' });
    }
  });

  // Update widget
  router.put('/api/dashboards/:dashboardId/widgets/:widgetId', async (req, res) => {
    const parse = widgetSchema.safeParse(req.body);
    if (!parse.success) {
      return res.status(400).json({ error: parse.error.flatten() });
    }

    try {
      const widget = await prisma.dashboardWidget.update({
        where: { id: req.params.widgetId },
        data: {
          name: parse.data.name,
          type: parse.data.type,
          config: JSON.stringify(parse.data.config),
          query: parse.data.query,
          position: JSON.stringify(parse.data.position),
          refreshRate: parse.data.refreshRate,
        },
      });

      res.json({
        ...widget,
        config: JSON.parse(widget.config),
        position: JSON.parse(widget.position),
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to update widget' });
    }
  });

  // Delete widget
  router.delete('/api/dashboards/:dashboardId/widgets/:widgetId', async (req, res) => {
    try {
      await prisma.dashboardWidget.delete({
        where: { id: req.params.widgetId },
      });
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: 'Failed to delete widget' });
    }
  });

  // Execute widget query
  router.post('/api/dashboards/:dashboardId/widgets/:widgetId/execute', async (req, res) => {
    const { parameters = {} } = req.body;

    try {
      const widget = await prisma.dashboardWidget.findUnique({
        where: { id: req.params.widgetId },
      });

      if (!widget || !widget.query) {
        return res.status(404).json({ error: 'Widget not found or has no query' });
      }

      const config = JSON.parse(widget.config) as ChartConfig;
      const result = await dashboardService.executeQuery(widget.query, parameters);
      const chartData = dashboardService.formatForChart(result, config);

      res.json({ result, chartData });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Query failed' });
    }
  });

  // Saved queries CRUD
  router.get('/api/analytics/queries', async (req, res) => {
    const user = (req as any).user;

    try {
      const queries = await prisma.savedQuery.findMany({
        where: {
          OR: [
            { createdBy: user.id },
            { isPublic: true },
          ],
        },
        orderBy: { updatedAt: 'desc' },
      });

      const parsed = queries.map(q => ({
        ...q,
        parameters: q.parameters ? JSON.parse(q.parameters) : [],
      }));

      res.json(parsed);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch queries' });
    }
  });

  router.post('/api/analytics/queries', async (req, res) => {
    const parse = savedQuerySchema.safeParse(req.body);
    if (!parse.success) {
      return res.status(400).json({ error: parse.error.flatten() });
    }

    const user = (req as any).user;

    try {
      const query = await prisma.savedQuery.create({
        data: {
          name: parse.data.name,
          description: parse.data.description,
          query: parse.data.query,
          parameters: parse.data.parameters,
          isPublic: parse.data.isPublic,
          createdBy: user.id,
        },
      });

      res.status(201).json({
        ...query,
        parameters: query.parameters ? JSON.parse(query.parameters) : [],
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to save query' });
    }
  });

  router.delete('/api/analytics/queries/:id', async (req, res) => {
    try {
      await prisma.savedQuery.delete({
        where: { id: req.params.id },
      });
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: 'Failed to delete query' });
    }
  });

  return router;
}

export default DashboardService;
