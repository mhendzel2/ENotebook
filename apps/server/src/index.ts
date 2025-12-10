import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import crypto from 'crypto';
import { z } from 'zod';
import { v4 as uuid } from 'uuid';
import { PrismaClient } from '@prisma/client';
import { 
  Experiment, Method, User, Role, 
  MODALITIES, INVENTORY_CATEGORIES, STOCK_STATUSES, EXPERIMENT_STATUSES, SIGNATURE_TYPES 
} from '@eln/shared';

const prisma = new PrismaClient();

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(cors());
app.use(helmet());
app.use(morgan('dev'));

// Simple header-based auth stub.
app.use(async (req, res, next) => {
  const userId = req.header('x-user-id');
  if (!userId) {
    return res.status(401).json({ error: 'Missing x-user-id' });
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
  res.json({ status: 'ok', time: new Date().toISOString() });
});

const methodSchema = z.object({
  title: z.string().min(1),
  category: z.string().optional(),
  steps: z.any(),
  reagents: z.any().optional(),
  attachments: z.any().optional(),
  isPublic: z.boolean().default(true)
});

app.get('/methods', async (_req, res) => {
  try {
    const methods = await prisma.method.findMany();
    // Parse JSON fields
    const parsedMethods = methods.map(m => ({
      ...m,
      steps: JSON.parse(m.steps),
      reagents: m.reagents ? JSON.parse(m.reagents) : undefined,
      attachments: m.attachments ? JSON.parse(m.attachments) : undefined
    }));
    res.json(parsedMethods);
  } catch (error) {
    res.status(500).json({ error: 'Database error' });
  }
});

app.post('/methods', async (req, res) => {
  const parse = methodSchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ error: parse.error.flatten() });
  }
  const user = (req as any).user as User;
  
  try {
    const { steps, reagents, attachments, ...rest } = parse.data;
    const method = await prisma.method.create({
      data: {
        createdBy: user.id,
        version: 1,
        ...rest,
        steps: JSON.stringify(steps),
        reagents: reagents ? JSON.stringify(reagents) : undefined,
        attachments: attachments ? JSON.stringify(attachments) : undefined
      }
    });
    res.status(201).json({
      ...method,
      steps: JSON.parse(method.steps),
      reagents: method.reagents ? JSON.parse(method.reagents) : undefined,
      attachments: method.attachments ? JSON.parse(method.attachments) : undefined
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to save method' });
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
  dataLink: z.string().url().optional(),
  tags: z.array(z.string()).optional(),
  status: z.enum(EXPERIMENT_STATUSES).default('draft')
});

// 1. Replace GET /experiments with Prisma
app.get('/experiments', async (req, res) => {
  const user = (req as any).user as User;
  try {
    const where = user.role === 'manager' ? {} : { userId: user.id };
    const data = await prisma.experiment.findMany({ where });
    // Parse JSON fields
    const parsedData = data.map(e => ({
      ...e,
      params: e.params ? JSON.parse(e.params) : undefined,
      observations: e.observations ? JSON.parse(e.observations) : undefined,
      tags: e.tags ? JSON.parse(e.tags) : []
    }));
    res.json(parsedData);
  } catch (error) {
    res.status(500).json({ error: 'Database error' });
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
    const { params, observations, tags, ...rest } = parse.data;
    const experiment = await prisma.experiment.create({
      data: {
        userId: user.id,
        version: 1,
        ...rest,
        params: params ? JSON.stringify(params) : undefined,
        observations: observations ? JSON.stringify(observations) : undefined,
        tags: tags ? JSON.stringify(tags) : JSON.stringify([])
      }
    });
    res.status(201).json({
      ...experiment,
      params: experiment.params ? JSON.parse(experiment.params) : undefined,
      observations: experiment.observations ? JSON.parse(experiment.observations) : undefined,
      tags: experiment.tags ? JSON.parse(experiment.tags) : []
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to save experiment' });
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
        observations: method.steps, // Copy steps as initial observations/checklist
        tags: JSON.stringify([])
      }
    });

    res.status(201).json({
      ...experiment,
      observations: experiment.observations ? JSON.parse(experiment.observations) : undefined,
      tags: experiment.tags ? JSON.parse(experiment.tags) : []
    });
  } catch (error) {
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
          params: params ? JSON.stringify(params) : undefined,
          observations: observations ? JSON.stringify(observations) : undefined,
          tags: tags ? JSON.stringify(tags) : JSON.stringify([])
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
          steps: JSON.stringify(steps),
          reagents: reagents ? JSON.stringify(reagents) : undefined,
          attachments: attachments ? JSON.stringify(attachments) : undefined
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
    
    const parsedMethods = methods.map(m => ({
      ...m,
      steps: JSON.parse(m.steps),
      reagents: m.reagents ? JSON.parse(m.reagents) : undefined,
      attachments: m.attachments ? JSON.parse(m.attachments) : undefined
    }));

    const parsedExperiments = experiments.map(e => ({
      ...e,
      params: e.params ? JSON.parse(e.params) : undefined,
      observations: e.observations ? JSON.parse(e.observations) : undefined,
      tags: e.tags ? JSON.parse(e.tags) : []
    }));

    res.json({ methods: parsedMethods, experiments: parsedExperiments });
  } catch (error) {
    res.status(500).json({ error: 'Database error' });
  }
});

const port = process.env.PORT || 4000;
app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`ELN server listening on http://localhost:${port}`);
});

// Small helper for role checks if needed later.
function requireRole(user: User, roles: Role[]) {
  if (!roles.includes(user.role)) {
    throw new Error('forbidden');
  }
}

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

    res.status(201).json({
      ...newVersion,
      steps: JSON.parse(newVersion.steps),
      reagents: newVersion.reagents ? JSON.parse(newVersion.reagents) : undefined,
      attachments: newVersion.attachments ? JSON.parse(newVersion.attachments) : undefined
    });
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

    res.json(versions.map(m => ({
      ...m,
      steps: JSON.parse(m.steps),
      reagents: m.reagents ? JSON.parse(m.reagents) : undefined,
      attachments: m.attachments ? JSON.parse(m.attachments) : undefined
    })));
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
