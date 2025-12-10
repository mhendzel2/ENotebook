import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { z } from 'zod';
import { v4 as uuid } from 'uuid';
import { PrismaClient } from '@prisma/client';
import { Experiment, Method, User, Role, MODALITIES } from '@eln/shared';

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
    res.json(methods);
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
    const method = await prisma.method.create({
      data: {
        createdBy: user.id,
        version: 1,
        ...parse.data
      }
    });
    res.status(201).json(method);
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
  tags: z.array(z.string()).optional()
});

// 1. Replace GET /experiments with Prisma
app.get('/experiments', async (req, res) => {
  const user = (req as any).user as User;
  try {
    const where = user.role === 'manager' ? {} : { userId: user.id };
    const data = await prisma.experiment.findMany({ where });
    res.json(data);
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
    const experiment = await prisma.experiment.create({
      data: {
        userId: user.id,
        version: 1,
        ...parse.data
      }
    });
    res.status(201).json(experiment);
  } catch (error) {
    res.status(500).json({ error: 'Failed to save experiment' });
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

        if (!existing) {
          // It's new, insert it
          await tx.experiment.create({ data: incExp });
          applied.push({ id: incExp.id, status: 'created' });
        } else {
          // Conflict Detection: simple version check
          if (incExp.version > existing.version) {
            await tx.experiment.update({
              where: { id: incExp.id },
              data: incExp
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

        if (!existing) {
          // It's new, insert it
          await tx.method.create({ data: incMethod });
          applied.push({ id: incMethod.id, status: 'created' });
        } else {
          // Conflict Detection: simple version check
          if (incMethod.version > existing.version) {
            await tx.method.update({
              where: { id: incMethod.id },
              data: incMethod
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
    res.json({ methods, experiments });
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
