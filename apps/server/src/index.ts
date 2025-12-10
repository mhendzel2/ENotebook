import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { z } from 'zod';
import { v4 as uuid } from 'uuid';
import { Experiment, Method, User, Role, MODALITIES } from '@eln/shared';

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(cors());
app.use(helmet());
app.use(morgan('dev'));

// In-memory placeholders; replace with Postgres persistence.
const users: User[] = [
  { id: 'manager-1', name: 'Lab Manager', role: 'manager', active: true, createdAt: new Date().toISOString() }
];
const methods: Method[] = [];
const experiments: Experiment[] = [];

// Simple header-based auth stub.
app.use((req, res, next) => {
  const userId = req.header('x-user-id');
  if (!userId) {
    return res.status(401).json({ error: 'Missing x-user-id' });
  }
  const user = users.find((u) => u.id === userId);
  if (!user) {
    return res.status(403).json({ error: 'User not found' });
  }
  (req as any).user = user;
  next();
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

app.get('/methods', (_req, res) => {
  res.json(methods);
});

app.post('/methods', (req, res) => {
  const parse = methodSchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ error: parse.error.flatten() });
  }
  const user = (req as any).user as User;
  const method: Method = {
    id: uuid(),
    createdBy: user.id,
    version: 1,
    updatedAt: new Date().toISOString(),
    ...parse.data
  };
  methods.push(method);
  res.status(201).json(method);
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

app.get('/experiments', (req, res) => {
  const user = (req as any).user as User;
  if (user.role === 'manager') {
    return res.json(experiments);
  }
  res.json(experiments.filter((e) => e.userId === user.id));
});

app.post('/experiments', (req, res) => {
  const user = (req as any).user as User;
  const parse = experimentSchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ error: parse.error.flatten() });
  }
  const experiment: Experiment = {
    id: uuid(),
    userId: user.id,
    version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...parse.data
  };
  experiments.push(experiment);
  res.status(201).json(experiment);
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

app.post('/sync/push', (req, res) => {
  const parse = syncPayloadSchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ error: parse.error.flatten() });
  }
  // Placeholder: currently just echoes payload; conflict handling to be added.
  const payload = parse.data;
  res.json({ status: 'queued', received: { methods: payload.methods.length, experiments: payload.experiments.length } });
});

app.get('/sync/pull', (_req, res) => {
  res.json({ methods, experiments });
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
