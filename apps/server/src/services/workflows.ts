/**
 * Workflow Automation Engine
 * 
 * Implements event-driven automation similar to Labguru's Automation module.
 * Supports:
 * - Event-based triggers (new sample, experiment signed, stock low, etc.)
 * - No-code action assembly
 * - Custom script execution (safe evaluation with limited scope)
 * - Plugin integration
 */

import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { EventEmitter } from 'events';
import { v4 as uuid } from 'uuid';
import vm from 'vm';
import nodemailer from 'nodemailer';

// ==================== TYPES ====================

export type TriggerType = 
  | 'experiment_created'
  | 'experiment_completed'
  | 'experiment_signed'
  | 'sample_added'
  | 'stock_low'
  | 'stock_expired'
  | 'inventory_updated'
  | 'method_created'
  | 'schedule'
  | 'manual'
  | 'webhook';

export type ActionType =
  | 'send_notification'
  | 'send_email'
  | 'update_status'
  | 'calculate_statistics'
  | 'export_data'
  | 'create_record'
  | 'update_inventory'
  | 'run_script'
  | 'call_webhook'
  | 'run_plugin';

export interface TriggerConfig {
  type: TriggerType;
  conditions?: Record<string, unknown>;
  entityType?: string;
  schedule?: string; // cron expression for scheduled triggers
}

export interface ActionConfig {
  id: string;
  type: ActionType;
  name: string;
  config: Record<string, unknown>;
  onError?: 'continue' | 'stop' | 'retry';
  retryCount?: number;
}

export interface WorkflowDefinition {
  id: string;
  name: string;
  description?: string;
  trigger: TriggerConfig;
  steps: ActionConfig[];
  enabled: boolean;
}

export interface ExecutionContext {
  workflowId: string;
  executionId: string;
  trigger: TriggerConfig;
  triggerData: Record<string, unknown>;
  variables: Record<string, unknown>;
  results: Record<string, unknown>;
  userId?: string;
}

// ==================== WORKFLOW ENGINE ====================

export class WorkflowEngine extends EventEmitter {
  private prisma: PrismaClient;
  private actionHandlers: Map<ActionType, ActionHandler>;
  private pluginActions: Map<string, ActionHandler>;

  constructor(prisma: PrismaClient) {
    super();
    this.prisma = prisma;
    this.actionHandlers = new Map();
    this.pluginActions = new Map();
    
    // Register built-in action handlers
    this.registerBuiltInActions();
  }

  /**
   * Register built-in action handlers
   */
  private registerBuiltInActions(): void {
    this.actionHandlers.set('send_notification', new NotificationAction(this.prisma));
    this.actionHandlers.set('send_email', new EmailAction(this.prisma));
    this.actionHandlers.set('update_status', new UpdateStatusAction(this.prisma));
    this.actionHandlers.set('calculate_statistics', new StatisticsAction(this.prisma));
    this.actionHandlers.set('export_data', new ExportAction(this.prisma));
    this.actionHandlers.set('create_record', new CreateRecordAction(this.prisma));
    this.actionHandlers.set('update_inventory', new InventoryAction(this.prisma));
    this.actionHandlers.set('run_script', new ScriptAction(this.prisma));
    this.actionHandlers.set('call_webhook', new WebhookAction(this.prisma));
    this.actionHandlers.set('run_plugin', new PluginAction(this.prisma, this.pluginActions));
  }

  /**
   * Register a plugin action handler
   */
  registerPluginAction(name: string, handler: ActionHandler): void {
    this.pluginActions.set(name, handler);
  }

  /**
   * Trigger workflows matching an event
   */
  async trigger(eventType: TriggerType, data: Record<string, unknown>): Promise<void> {
    try {
      // Find all enabled workflows with matching trigger
      const workflows = await this.prisma.workflow.findMany({
        where: {
          enabled: true,
        },
      });

      for (const workflow of workflows) {
        const trigger = JSON.parse(workflow.trigger) as TriggerConfig;
        
        if (trigger.type === eventType && this.matchesConditions(trigger.conditions, data)) {
          // Execute workflow asynchronously
          this.executeWorkflow(workflow.id, data).catch(err => {
            console.error(`Workflow ${workflow.id} failed:`, err);
          });
        }
      }
    } catch (error) {
      console.error('Failed to trigger workflows:', error);
    }
  }

  /**
   * Check if data matches trigger conditions
   */
  private matchesConditions(conditions: Record<string, unknown> | undefined, data: Record<string, unknown>): boolean {
    if (!conditions) return true;

    for (const [key, expected] of Object.entries(conditions)) {
      const actual = this.getNestedValue(data, key);
      
      if (typeof expected === 'object' && expected !== null) {
        // Handle complex conditions
        const condition = expected as Record<string, unknown>;
        if ('$eq' in condition && actual !== condition.$eq) return false;
        if ('$ne' in condition && actual === condition.$ne) return false;
        if ('$gt' in condition && !(actual as number > (condition.$gt as number))) return false;
        if ('$gte' in condition && !(actual as number >= (condition.$gte as number))) return false;
        if ('$lt' in condition && !(actual as number < (condition.$lt as number))) return false;
        if ('$lte' in condition && !(actual as number <= (condition.$lte as number))) return false;
        if ('$in' in condition && !(condition.$in as unknown[]).includes(actual)) return false;
        if ('$contains' in condition && !(actual as string).includes(condition.$contains as string)) return false;
      } else {
        // Simple equality
        if (actual !== expected) return false;
      }
    }

    return true;
  }

  /**
   * Get nested value from object using dot notation
   */
  private getNestedValue(obj: Record<string, unknown>, path: string): unknown {
    return path.split('.').reduce((current, key) => {
      return current && typeof current === 'object' ? (current as Record<string, unknown>)[key] : undefined;
    }, obj as unknown);
  }

  /**
   * Execute a workflow
   */
  async executeWorkflow(workflowId: string, triggerData: Record<string, unknown>): Promise<string> {
    const workflow = await this.prisma.workflow.findUnique({
      where: { id: workflowId },
    });

    if (!workflow) {
      throw new Error(`Workflow ${workflowId} not found`);
    }

    const trigger = JSON.parse(workflow.trigger) as TriggerConfig;
    const steps = JSON.parse(workflow.steps) as ActionConfig[];

    // Create execution record
    const execution = await this.prisma.workflowExecution.create({
      data: {
        workflowId,
        triggeredBy: triggerData.entityId as string || undefined,
        triggerData: JSON.stringify(triggerData),
        status: 'running',
      },
    });

    // Create execution context
    const context: ExecutionContext = {
      workflowId,
      executionId: execution.id,
      trigger,
      triggerData,
      variables: { ...triggerData },
      results: {},
    };

    const stepResults: Array<{ stepId: string; status: string; result?: unknown; error?: string }> = [];

    try {
      // Execute each step
      for (const step of steps) {
        try {
          const handler = this.actionHandlers.get(step.type);
          if (!handler) {
            throw new Error(`Unknown action type: ${step.type}`);
          }

          const result = await handler.execute(step.config, context);
          context.results[step.id] = result;
          stepResults.push({ stepId: step.id, status: 'completed', result });

          this.emit('step_completed', { workflowId, executionId: execution.id, step, result });

        } catch (stepError) {
          const errorMessage = stepError instanceof Error ? stepError.message : String(stepError);
          stepResults.push({ stepId: step.id, status: 'failed', error: errorMessage });

          if (step.onError === 'stop') {
            throw stepError;
          }
          // Otherwise continue to next step
        }
      }

      // Mark execution as completed
      await this.prisma.workflowExecution.update({
        where: { id: execution.id },
        data: {
          status: 'completed',
          completedAt: new Date(),
          stepResults: JSON.stringify(stepResults),
        },
      });

      this.emit('workflow_completed', { workflowId, executionId: execution.id });
      return execution.id;

    } catch (error) {
      // Mark execution as failed
      await this.prisma.workflowExecution.update({
        where: { id: execution.id },
        data: {
          status: 'failed',
          completedAt: new Date(),
          error: error instanceof Error ? error.message : String(error),
          stepResults: JSON.stringify(stepResults),
        },
      });

      this.emit('workflow_failed', { workflowId, executionId: execution.id, error });
      throw error;
    }
  }

  /**
   * Get available triggers
   */
  getAvailableTriggers(): Array<{ type: TriggerType; name: string; description: string; configSchema: unknown }> {
    return [
      { type: 'experiment_created', name: 'Experiment Created', description: 'Triggered when a new experiment is created', configSchema: { entityType: 'experiment' } },
      { type: 'experiment_completed', name: 'Experiment Completed', description: 'Triggered when an experiment status changes to completed', configSchema: { entityType: 'experiment' } },
      { type: 'experiment_signed', name: 'Experiment Signed', description: 'Triggered when an experiment is signed', configSchema: { entityType: 'experiment' } },
      { type: 'sample_added', name: 'Sample Added', description: 'Triggered when a new sample is added to inventory', configSchema: { entityType: 'stock' } },
      { type: 'stock_low', name: 'Stock Low', description: 'Triggered when stock quantity falls below threshold', configSchema: { threshold: 10 } },
      { type: 'stock_expired', name: 'Stock Expired', description: 'Triggered when a stock item expires', configSchema: { entityType: 'stock' } },
      { type: 'inventory_updated', name: 'Inventory Updated', description: 'Triggered when inventory is modified', configSchema: { entityType: 'inventory' } },
      { type: 'method_created', name: 'Method Created', description: 'Triggered when a new method/protocol is created', configSchema: { entityType: 'method' } },
      { type: 'schedule', name: 'Scheduled', description: 'Triggered on a schedule (cron expression)', configSchema: { schedule: '0 9 * * *' } },
      { type: 'manual', name: 'Manual', description: 'Triggered manually by user', configSchema: {} },
      { type: 'webhook', name: 'Webhook', description: 'Triggered by external webhook', configSchema: {} },
    ];
  }

  /**
   * Get available actions
   */
  getAvailableActions(): Array<{ type: ActionType; name: string; description: string; configSchema: unknown }> {
    return [
      { type: 'send_notification', name: 'Send Notification', description: 'Send an in-app notification', configSchema: { userId: '', title: '', message: '' } },
      { type: 'send_email', name: 'Send Email', description: 'Send an email notification', configSchema: { to: '', subject: '', body: '' } },
      { type: 'update_status', name: 'Update Status', description: 'Update entity status', configSchema: { entityType: '', entityId: '', status: '' } },
      { type: 'calculate_statistics', name: 'Calculate Statistics', description: 'Run statistical calculations on observations', configSchema: { experimentId: '', fields: [] } },
      { type: 'export_data', name: 'Export Data', description: 'Export data to file', configSchema: { format: 'json', entityType: '', entityId: '' } },
      { type: 'create_record', name: 'Create Record', description: 'Create a new database record', configSchema: { entityType: '', data: {} } },
      { type: 'update_inventory', name: 'Update Inventory', description: 'Update inventory quantities', configSchema: { stockId: '', quantityChange: 0 } },
      { type: 'run_script', name: 'Run Script', description: 'Execute custom TypeScript/JavaScript code', configSchema: { language: 'typescript', code: '' } },
      { type: 'call_webhook', name: 'Call Webhook', description: 'Make HTTP request to external service', configSchema: { url: '', method: 'POST', headers: {}, body: {} } },
      { type: 'run_plugin', name: 'Run Plugin', description: 'Execute a registered plugin action', configSchema: { pluginName: '', actionConfig: {} } },
    ];
  }
}

// ==================== ACTION HANDLERS ====================

export interface ActionHandler {
  execute(config: Record<string, unknown>, context: ExecutionContext): Promise<unknown>;
}

class NotificationAction implements ActionHandler {
  constructor(private prisma: PrismaClient) {}

  async execute(config: Record<string, unknown>, context: ExecutionContext): Promise<unknown> {
    const { userId, title, message, type = 'workflow' } = config as {
      userId: string;
      title: string;
      message: string;
      type?: string;
    };

    // Interpolate variables in message
    const interpolatedMessage = this.interpolate(message, context.variables);
    const interpolatedTitle = this.interpolate(title, context.variables);

    const notification = await this.prisma.notification.create({
      data: {
        userId: userId || context.userId || '',
        type,
        title: interpolatedTitle,
        message: interpolatedMessage,
      },
    });

    return notification;
  }

  private interpolate(template: string, variables: Record<string, unknown>): string {
    return template.replace(/\{\{(\w+(?:\.\w+)*)\}\}/g, (_, path) => {
      const value = path.split('.').reduce((obj: unknown, key: string) => {
        return obj && typeof obj === 'object' ? (obj as Record<string, unknown>)[key] : undefined;
      }, variables);
      return value !== undefined ? String(value) : '';
    });
  }
}

class EmailAction implements ActionHandler {
  private transporter: nodemailer.Transporter | null = null;

  constructor(private prisma: PrismaClient) {
    // Initialize email transporter if SMTP settings are configured
    if (process.env.SMTP_HOST) {
      this.transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT) || 587,
        secure: process.env.SMTP_SECURE === 'true',
        auth: process.env.SMTP_USER ? {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        } : undefined,
      });
    }
  }

  async execute(config: Record<string, unknown>, context: ExecutionContext): Promise<unknown> {
    const { to, subject, body } = config as { to: string; subject: string; body: string };
    
    // Validate email address format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!to || !emailRegex.test(to)) {
      throw new Error(`Invalid email address: ${to}`);
    }

    // Interpolate variables in message content
    const interpolatedBody = this.interpolate(body, context.variables);
    const interpolatedSubject = this.interpolate(subject, context.variables);

    if (!this.transporter) {
      // Fallback: Log email and create notification when SMTP is not configured
      console.log(`[Workflow Email] To: ${to}, Subject: ${interpolatedSubject}`);
      console.log(`[Workflow Email] Body: ${interpolatedBody}`);
      
      return { 
        sent: false, 
        to, 
        subject: interpolatedSubject, 
        timestamp: new Date().toISOString(),
        warning: 'SMTP not configured - email logged but not sent'
      };
    }

    try {
      const info = await this.transporter.sendMail({
        from: process.env.SMTP_FROM || '"ENotebook System" <no-reply@enotebook.lab>',
        to,
        subject: interpolatedSubject,
        text: interpolatedBody,
        html: this.formatHtmlEmail(interpolatedSubject, interpolatedBody),
      });

      return { 
        sent: true, 
        messageId: info.messageId, 
        to, 
        subject: interpolatedSubject,
        timestamp: new Date().toISOString() 
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`Email delivery failed: ${errorMessage}`);
    }
  }

  private interpolate(template: string, variables: Record<string, unknown>): string {
    return template.replace(/\{\{(\w+(?:\.\w+)*)\}\}/g, (_, path) => {
      const value = path.split('.').reduce((obj: unknown, key: string) => {
        return obj && typeof obj === 'object' ? (obj as Record<string, unknown>)[key] : undefined;
      }, variables);
      return value !== undefined ? String(value) : '';
    });
  }

  private formatHtmlEmail(subject: string, body: string): string {
    // Escape HTML in user content to prevent injection
    const escapeHtml = (str: string) => str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${escapeHtml(subject)}</title>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { border-bottom: 2px solid #007bff; padding-bottom: 10px; margin-bottom: 20px; }
    .content { white-space: pre-wrap; }
    .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd; font-size: 12px; color: #666; }
  </style>
</head>
<body>
  <div class="header">
    <h2 style="margin: 0; color: #007bff;">ENotebook Notification</h2>
  </div>
  <div class="content">${escapeHtml(body).replace(/\n/g, '<br>')}</div>
  <div class="footer">
    <p>This is an automated message from ENotebook.</p>
    <p>Generated at ${new Date().toISOString()}</p>
  </div>
</body>
</html>`;
  }
}

class UpdateStatusAction implements ActionHandler {
  constructor(private prisma: PrismaClient) {}

  async execute(config: Record<string, unknown>, context: ExecutionContext): Promise<unknown> {
    const { entityType, entityId, status } = config as {
      entityType: string;
      entityId: string;
      status: string;
    };

    const resolvedId = entityId || context.triggerData.entityId as string;

    if (entityType === 'experiment') {
      const updated = await this.prisma.experiment.update({
        where: { id: resolvedId },
        data: { status },
      });
      return updated;
    }

    if (entityType === 'stock') {
      const updated = await this.prisma.stock.update({
        where: { id: resolvedId },
        data: { status },
      });
      return updated;
    }

    throw new Error(`Unknown entity type: ${entityType}`);
  }
}

class StatisticsAction implements ActionHandler {
  constructor(private prisma: PrismaClient) {}

  async execute(config: Record<string, unknown>, context: ExecutionContext): Promise<unknown> {
    const { experimentId, fields } = config as {
      experimentId?: string;
      fields?: string[];
    };

    const expId = experimentId || context.triggerData.entityId as string;
    
    const experiment = await this.prisma.experiment.findUnique({
      where: { id: expId },
    });

    if (!experiment || !experiment.observations) {
      return { error: 'No observations found' };
    }

    const observations = JSON.parse(experiment.observations);
    const results: Record<string, unknown> = {};

    // Calculate basic statistics on numeric fields
    const numericData: Record<string, number[]> = {};
    
    if (Array.isArray(observations.data)) {
      for (const entry of observations.data) {
        for (const [key, value] of Object.entries(entry)) {
          if (typeof value === 'number') {
            if (!fields || fields.includes(key)) {
              if (!numericData[key]) numericData[key] = [];
              numericData[key].push(value);
            }
          }
        }
      }
    }

    for (const [field, values] of Object.entries(numericData)) {
      const sorted = [...values].sort((a, b) => a - b);
      const sum = values.reduce((a, b) => a + b, 0);
      const mean = sum / values.length;
      const variance = values.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / values.length;
      
      results[field] = {
        count: values.length,
        sum,
        mean,
        min: sorted[0],
        max: sorted[sorted.length - 1],
        median: sorted.length % 2 === 0 
          ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2 
          : sorted[Math.floor(sorted.length / 2)],
        stdDev: Math.sqrt(variance),
      };
    }

    return results;
  }
}

class ExportAction implements ActionHandler {
  constructor(private prisma: PrismaClient) {}

  async execute(config: Record<string, unknown>, context: ExecutionContext): Promise<unknown> {
    const { format, entityType, entityId } = config as {
      format: string;
      entityType: string;
      entityId?: string;
    };

    const id = entityId || context.triggerData.entityId as string;

    let data: unknown;
    if (entityType === 'experiment') {
      data = await this.prisma.experiment.findUnique({
        where: { id },
        include: { signatures: true, comments: true },
      });
    } else if (entityType === 'method') {
      data = await this.prisma.method.findUnique({ where: { id } });
    }

    // In production, this would save to file system or cloud storage
    return { format, entityType, entityId: id, exported: true, data };
  }
}

class CreateRecordAction implements ActionHandler {
  constructor(private prisma: PrismaClient) {}

  async execute(config: Record<string, unknown>, context: ExecutionContext): Promise<unknown> {
    const { entityType, data } = config as {
      entityType: string;
      data: Record<string, unknown>;
    };

    // Interpolate variables in data
    const resolvedData = this.resolveData(data, context.variables);

    if (entityType === 'notification') {
      return this.prisma.notification.create({ data: resolvedData as any });
    }

    throw new Error(`Cannot create entity type: ${entityType}`);
  }

  private resolveData(data: Record<string, unknown>, variables: Record<string, unknown>): Record<string, unknown> {
    const resolved: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      if (typeof value === 'string' && value.startsWith('{{') && value.endsWith('}}')) {
        const path = value.slice(2, -2);
        resolved[key] = path.split('.').reduce((obj: unknown, k: string) => {
          return obj && typeof obj === 'object' ? (obj as Record<string, unknown>)[k] : undefined;
        }, variables);
      } else {
        resolved[key] = value;
      }
    }
    return resolved;
  }
}

class InventoryAction implements ActionHandler {
  constructor(private prisma: PrismaClient) {}

  async execute(config: Record<string, unknown>, context: ExecutionContext): Promise<unknown> {
    const { stockId, quantityChange, notes } = config as {
      stockId: string;
      quantityChange: number;
      notes?: string;
    };

    const id = stockId || context.triggerData.stockId as string;

    const stock = await this.prisma.stock.findUnique({ where: { id } });
    if (!stock) throw new Error(`Stock ${id} not found`);

    const newQuantity = stock.quantity + quantityChange;
    
    const updated = await this.prisma.stock.update({
      where: { id },
      data: { 
        quantity: Math.max(0, newQuantity),
        status: newQuantity <= 0 ? 'empty' : newQuantity < stock.initialQuantity * 0.1 ? 'low' : 'available',
      },
    });

    return updated;
  }
}

class ScriptAction implements ActionHandler {
  constructor(private prisma: PrismaClient) {}

  async execute(config: Record<string, unknown>, context: ExecutionContext): Promise<unknown> {
    const { language, code, timeout = 5000 } = config as {
      language: string;
      code: string;
      timeout?: number;
    };

    if (language !== 'javascript' && language !== 'typescript') {
      throw new Error(`Unsupported script language: ${language}`);
    }

    // Create sandboxed environment using Node's vm module
    // Note: This provides limited isolation - for production, consider a proper sandbox
    const sandbox = {
      context: { ...context },
      result: undefined as unknown,
      console: {
        log: (...args: unknown[]) => console.log('[Script]', ...args),
      },
      // Add safe utilities only
      JSON,
      Math,
      Date,
      Array,
      Object,
      String,
      Number,
      Boolean,
    };

    try {
      // Create a new context with the sandbox
      const vmContext = vm.createContext(sandbox);
      
      // Wrap code to capture result
      const wrappedCode = `result = (function() { ${code} })();`;
      
      // Execute with timeout
      vm.runInContext(wrappedCode, vmContext, { timeout });
      
      return sandbox.result;
    } catch (error) {
      throw new Error(`Script execution failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

class WebhookAction implements ActionHandler {
  constructor(private prisma: PrismaClient) {}

  async execute(config: Record<string, unknown>, context: ExecutionContext): Promise<unknown> {
    const { url, method = 'POST', headers = {}, body } = config as {
      url: string;
      method?: string;
      headers?: Record<string, string>;
      body?: unknown;
    };

    // Interpolate variables in body
    const resolvedBody = typeof body === 'string' 
      ? this.interpolate(body, context.variables)
      : body;

    const response = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      body: resolvedBody ? JSON.stringify(resolvedBody) : undefined,
    });

    return {
      status: response.status,
      statusText: response.statusText,
      body: await response.text(),
    };
  }

  private interpolate(template: string, variables: Record<string, unknown>): string {
    return template.replace(/\{\{(\w+(?:\.\w+)*)\}\}/g, (_, path) => {
      const value = path.split('.').reduce((obj: unknown, key: string) => {
        return obj && typeof obj === 'object' ? (obj as Record<string, unknown>)[key] : undefined;
      }, variables);
      return value !== undefined ? String(value) : '';
    });
  }
}

class PluginAction implements ActionHandler {
  constructor(
    private prisma: PrismaClient,
    private pluginActions: Map<string, ActionHandler>
  ) {}

  async execute(config: Record<string, unknown>, context: ExecutionContext): Promise<unknown> {
    const { pluginName, actionConfig } = config as {
      pluginName: string;
      actionConfig: Record<string, unknown>;
    };

    const handler = this.pluginActions.get(pluginName);
    if (!handler) {
      throw new Error(`Plugin action not found: ${pluginName}`);
    }

    return handler.execute(actionConfig, context);
  }
}

// ==================== API ROUTES ====================

const workflowSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  trigger: z.object({
    type: z.string(),
    conditions: z.record(z.unknown()).optional(),
    entityType: z.string().optional(),
    schedule: z.string().optional(),
  }),
  steps: z.array(z.object({
    id: z.string(),
    type: z.string(),
    name: z.string(),
    config: z.record(z.unknown()),
    onError: z.enum(['continue', 'stop', 'retry']).optional(),
    retryCount: z.number().optional(),
  })),
  enabled: z.boolean().default(true),
});

export function createWorkflowRoutes(prisma: PrismaClient, engine: WorkflowEngine) {
  const router = Router();

  // Get all workflows
  router.get('/api/workflows', async (req, res) => {
    try {
      const workflows = await prisma.workflow.findMany({
        orderBy: { createdAt: 'desc' },
      });
      
      const parsed = workflows.map(w => ({
        ...w,
        trigger: JSON.parse(w.trigger),
        steps: JSON.parse(w.steps),
      }));
      
      res.json(parsed);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch workflows' });
    }
  });

  // Get single workflow
  router.get('/api/workflows/:id', async (req, res) => {
    try {
      const workflow = await prisma.workflow.findUnique({
        where: { id: req.params.id },
      });
      
      if (!workflow) {
        return res.status(404).json({ error: 'Workflow not found' });
      }
      
      res.json({
        ...workflow,
        trigger: JSON.parse(workflow.trigger),
        steps: JSON.parse(workflow.steps),
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch workflow' });
    }
  });

  // Create workflow
  router.post('/api/workflows', async (req, res) => {
    const parse = workflowSchema.safeParse(req.body);
    if (!parse.success) {
      return res.status(400).json({ error: parse.error.flatten() });
    }

    const user = (req as any).user;

    try {
      const workflow = await prisma.workflow.create({
        data: {
          name: parse.data.name,
          description: parse.data.description,
          trigger: JSON.stringify(parse.data.trigger),
          steps: JSON.stringify(parse.data.steps),
          enabled: parse.data.enabled,
          createdBy: user.id,
        },
      });

      res.status(201).json({
        ...workflow,
        trigger: JSON.parse(workflow.trigger),
        steps: JSON.parse(workflow.steps),
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to create workflow' });
    }
  });

  // Update workflow
  router.put('/api/workflows/:id', async (req, res) => {
    const parse = workflowSchema.safeParse(req.body);
    if (!parse.success) {
      return res.status(400).json({ error: parse.error.flatten() });
    }

    try {
      const workflow = await prisma.workflow.update({
        where: { id: req.params.id },
        data: {
          name: parse.data.name,
          description: parse.data.description,
          trigger: JSON.stringify(parse.data.trigger),
          steps: JSON.stringify(parse.data.steps),
          enabled: parse.data.enabled,
        },
      });

      res.json({
        ...workflow,
        trigger: JSON.parse(workflow.trigger),
        steps: JSON.parse(workflow.steps),
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to update workflow' });
    }
  });

  // Delete workflow
  router.delete('/api/workflows/:id', async (req, res) => {
    try {
      await prisma.workflow.delete({
        where: { id: req.params.id },
      });
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: 'Failed to delete workflow' });
    }
  });

  // Execute workflow manually
  router.post('/api/workflows/:id/execute', async (req, res) => {
    const { data = {} } = req.body;
    
    try {
      const executionId = await engine.executeWorkflow(req.params.id, data);
      res.json({ executionId });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to execute workflow' });
    }
  });

  // Get workflow executions
  router.get('/api/workflows/:id/executions', async (req, res) => {
    try {
      const executions = await prisma.workflowExecution.findMany({
        where: { workflowId: req.params.id },
        orderBy: { startedAt: 'desc' },
        take: 50,
      });

      const parsed = executions.map(e => ({
        ...e,
        triggerData: e.triggerData ? JSON.parse(e.triggerData) : null,
        stepResults: e.stepResults ? JSON.parse(e.stepResults) : null,
      }));

      res.json(parsed);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch executions' });
    }
  });

  // Get available triggers and actions
  router.get('/api/workflows/schema/triggers', async (_req, res) => {
    res.json(engine.getAvailableTriggers());
  });

  router.get('/api/workflows/schema/actions', async (_req, res) => {
    res.json(engine.getAvailableActions());
  });

  return router;
}

export default WorkflowEngine;
