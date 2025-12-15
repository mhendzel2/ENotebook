/**
 * Sample Pooling Service
 * 
 * Implements pooled sample management for buffer formulation,
 * high-throughput assays, and solution preparation.
 * Similar to Labguru's sample-pooling feature.
 * 
 * Features:
 * - Pool creation from multiple stocks
 * - Volume tracking and contribution records
 * - Parent-child relationship management
 * - Integration with inventory and experiments
 * - Traceability of pool constituents
 */

import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';

// ==================== TYPES ====================

export interface PoolContributionInput {
  stockId: string;
  volumeAdded: number;
  unit: string;
  concentration?: number;
  notes?: string;
}

export interface PoolUsageInput {
  volumeUsed: number;
  unit: string;
  purpose?: string;
  experimentId?: string;
  notes?: string;
}

export interface PoolSummary {
  id: string;
  name: string;
  description?: string;
  purpose?: string;
  totalVolume?: number;
  remainingVolume?: number;
  unit?: string;
  status: string;
  contributionCount: number;
  usageCount: number;
  createdAt: Date;
}

// ==================== POOL SERVICE ====================

export class SamplePoolService {
  constructor(private prisma: PrismaClient) {}

  /**
   * Create a new sample pool
   */
  async createPool(
    name: string,
    createdBy: string,
    options: {
      description?: string;
      purpose?: string;
      unit?: string;
    } = {}
  ): Promise<{ id: string }> {
    const pool = await this.prisma.samplePool.create({
      data: {
        name,
        description: options.description,
        purpose: options.purpose,
        unit: options.unit,
        totalVolume: 0,
        createdBy,
      },
    });

    return { id: pool.id };
  }

  /**
   * Add a contribution to a pool
   */
  async addContribution(
    poolId: string,
    contribution: PoolContributionInput,
    addedBy: string
  ): Promise<void> {
    // Validate stock exists and has sufficient quantity
    const stock = await this.prisma.stock.findUnique({
      where: { id: contribution.stockId },
    });

    if (!stock) {
      throw new Error(`Stock ${contribution.stockId} not found`);
    }

    if (stock.quantity < contribution.volumeAdded) {
      throw new Error(`Insufficient stock quantity. Available: ${stock.quantity}, Requested: ${contribution.volumeAdded}`);
    }

    // Create contribution and update stock in transaction
    await this.prisma.$transaction(async (tx: any) => {
      // Add contribution
      await tx.poolContribution.create({
        data: {
          poolId,
          stockId: contribution.stockId,
          volumeAdded: contribution.volumeAdded,
          unit: contribution.unit,
          concentration: contribution.concentration,
          notes: contribution.notes,
          addedBy,
        },
      });

      // Update stock quantity
      const newQuantity = stock.quantity - contribution.volumeAdded;
      await tx.stock.update({
        where: { id: contribution.stockId },
        data: {
          quantity: newQuantity,
          status: newQuantity <= 0 ? 'empty' : newQuantity < stock.initialQuantity * 0.1 ? 'low' : stock.status,
        },
      });

      // Update pool total volume
      const pool = await tx.samplePool.findUnique({ where: { id: poolId } });
      await tx.samplePool.update({
        where: { id: poolId },
        data: {
          totalVolume: (pool?.totalVolume || 0) + contribution.volumeAdded,
          unit: contribution.unit,
        },
      });
    });
  }

  /**
   * Add multiple contributions to a pool at once
   */
  async addBatchContributions(
    poolId: string,
    contributions: PoolContributionInput[],
    addedBy: string
  ): Promise<void> {
    for (const contribution of contributions) {
      await this.addContribution(poolId, contribution, addedBy);
    }
  }

  /**
   * Record usage of a pool
   */
  async recordUsage(
    poolId: string,
    usage: PoolUsageInput,
    usedBy: string
  ): Promise<void> {
    // Get pool and check available volume
    const pool = await this.prisma.samplePool.findUnique({
      where: { id: poolId },
    });

    if (!pool) {
      throw new Error(`Pool ${poolId} not found`);
    }

    if (pool.status === 'disposed' || pool.status === 'consumed') {
      throw new Error(`Pool is ${pool.status} and cannot be used`);
    }

    const currentVolume = await this.getRemainingVolume(poolId);
    if (currentVolume < usage.volumeUsed) {
      throw new Error(`Insufficient pool volume. Available: ${currentVolume}, Requested: ${usage.volumeUsed}`);
    }

    // Create usage record
    await this.prisma.poolUsage.create({
      data: {
        poolId,
        volumeUsed: usage.volumeUsed,
        unit: usage.unit,
        purpose: usage.purpose,
        experimentId: usage.experimentId,
        notes: usage.notes,
        usedBy,
      },
    });

    // Update pool status if necessary
    const newRemainingVolume = currentVolume - usage.volumeUsed;
    if (newRemainingVolume <= 0) {
      await this.prisma.samplePool.update({
        where: { id: poolId },
        data: { status: 'consumed' },
      });
    }
  }

  /**
   * Get remaining volume in a pool
   */
  async getRemainingVolume(poolId: string): Promise<number> {
    const pool = await this.prisma.samplePool.findUnique({
      where: { id: poolId },
    });

    if (!pool) return 0;

    const usages = await this.prisma.poolUsage.findMany({
      where: { poolId },
    });

    const totalUsed = usages.reduce((sum: number, u: any) => sum + u.volumeUsed, 0);
    return (pool.totalVolume || 0) - totalUsed;
  }

  /**
   * Get pool with full details
   */
  async getPool(poolId: string): Promise<{
    pool: unknown;
    contributions: Array<{
      id: string;
      stock: unknown;
      volumeAdded: number;
      unit: string;
      concentration?: number;
      addedAt: Date;
      addedBy: string;
      notes?: string;
    }>;
    usages: Array<{
      id: string;
      volumeUsed: number;
      unit: string;
      purpose?: string;
      experiment?: unknown;
      usedAt: Date;
      usedBy: string;
      notes?: string;
    }>;
    remainingVolume: number;
  }> {
    const pool = await this.prisma.samplePool.findUnique({
      where: { id: poolId },
    });

    if (!pool) {
      throw new Error(`Pool ${poolId} not found`);
    }

    const contributions = await this.prisma.poolContribution.findMany({
      where: { poolId },
      include: {
        stock: {
          include: { item: true },
        },
      },
      orderBy: { addedAt: 'desc' },
    });

    const usages = await this.prisma.poolUsage.findMany({
      where: { poolId },
      include: { experiment: true },
      orderBy: { usedAt: 'desc' },
    });

    const remainingVolume = await this.getRemainingVolume(poolId);

    return {
      pool,
      contributions: contributions.map((c: any) => ({
        id: c.id,
        stock: c.stock,
        volumeAdded: c.volumeAdded,
        unit: c.unit,
        concentration: c.concentration || undefined,
        addedAt: c.addedAt,
        addedBy: c.addedBy,
        notes: c.notes || undefined,
      })),
      usages: usages.map((u: any) => ({
        id: u.id,
        volumeUsed: u.volumeUsed,
        unit: u.unit,
        purpose: u.purpose || undefined,
        experiment: u.experiment,
        usedAt: u.usedAt,
        usedBy: u.usedBy,
        notes: u.notes || undefined,
      })),
      remainingVolume,
    };
  }

  /**
   * Get pools summary
   */
  async getPoolsSummary(options: {
    status?: string;
    purpose?: string;
    createdBy?: string;
  } = {}): Promise<PoolSummary[]> {
    const where: Record<string, unknown> = {};
    if (options.status) where.status = options.status;
    if (options.purpose) where.purpose = options.purpose;
    if (options.createdBy) where.createdBy = options.createdBy;

    const pools = await this.prisma.samplePool.findMany({
      where,
      include: {
        _count: {
          select: {
            contributions: true,
            usages: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const summaries: PoolSummary[] = [];

    for (const pool of pools) {
      const remainingVolume = await this.getRemainingVolume(pool.id);
      summaries.push({
        id: pool.id,
        name: pool.name,
        description: pool.description || undefined,
        purpose: pool.purpose || undefined,
        totalVolume: pool.totalVolume || undefined,
        remainingVolume,
        unit: pool.unit || undefined,
        status: pool.status,
        contributionCount: pool._count.contributions,
        usageCount: pool._count.usages,
        createdAt: pool.createdAt,
      });
    }

    return summaries;
  }

  /**
   * Get pools containing a specific stock
   */
  async getPoolsByStock(stockId: string): Promise<Array<{
    pool: unknown;
    contribution: { volumeAdded: number; addedAt: Date };
  }>> {
    const contributions = await this.prisma.poolContribution.findMany({
      where: { stockId },
      include: { pool: true },
    });

    return contributions.map(c => ({
      pool: c.pool,
      contribution: {
        volumeAdded: c.volumeAdded,
        addedAt: c.addedAt,
      },
    }));
  }

  /**
   * Get pools used in an experiment
   */
  async getPoolsByExperiment(experimentId: string): Promise<Array<{
    pool: unknown;
    usage: { volumeUsed: number; usedAt: Date; purpose?: string };
  }>> {
    const usages = await this.prisma.poolUsage.findMany({
      where: { experimentId },
      include: { pool: true },
    });

    return usages.map(u => ({
      pool: u.pool,
      usage: {
        volumeUsed: u.volumeUsed,
        usedAt: u.usedAt,
        purpose: u.purpose || undefined,
      },
    }));
  }

  /**
   * Dispose a pool
   */
  async disposePool(poolId: string): Promise<void> {
    await this.prisma.samplePool.update({
      where: { id: poolId },
      data: { status: 'disposed' },
    });
  }

  /**
   * Calculate concentration after pooling
   */
  calculateFinalConcentration(
    contributions: Array<{ volume: number; concentration: number }>
  ): number {
    const totalVolume = contributions.reduce((sum, c) => sum + c.volume, 0);
    if (totalVolume === 0) return 0;

    const totalAmount = contributions.reduce(
      (sum, c) => sum + c.volume * c.concentration,
      0
    );

    return totalAmount / totalVolume;
  }
}

// ==================== API ROUTES ====================

const createPoolSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  purpose: z.string().optional(),
  unit: z.string().optional(),
});

const contributionSchema = z.object({
  stockId: z.string(),
  volumeAdded: z.number().positive(),
  unit: z.string(),
  concentration: z.number().optional(),
  notes: z.string().optional(),
});

const usageSchema = z.object({
  volumeUsed: z.number().positive(),
  unit: z.string(),
  purpose: z.string().optional(),
  experimentId: z.string().optional(),
  notes: z.string().optional(),
});

export function createPoolRoutes(prisma: PrismaClient, poolService: SamplePoolService) {
  const router = Router();

  // Get all pools
  router.get('/api/pools', async (req, res) => {
    const { status, purpose, createdBy } = req.query;

    try {
      const pools = await poolService.getPoolsSummary({
        status: status as string,
        purpose: purpose as string,
        createdBy: createdBy as string,
      });
      res.json(pools);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch pools' });
    }
  });

  // Get single pool with details
  router.get('/api/pools/:id', async (req, res) => {
    try {
      const pool = await poolService.getPool(req.params.id);
      res.json(pool);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to fetch pool' });
    }
  });

  // Create pool
  router.post('/api/pools', async (req, res) => {
    const parse = createPoolSchema.safeParse(req.body);
    if (!parse.success) {
      return res.status(400).json({ error: parse.error.flatten() });
    }

    const user = (req as any).user;

    try {
      const result = await poolService.createPool(parse.data.name, user.id, {
        description: parse.data.description,
        purpose: parse.data.purpose,
        unit: parse.data.unit,
      });
      res.status(201).json(result);
    } catch (error) {
      res.status(500).json({ error: 'Failed to create pool' });
    }
  });

  // Add contribution to pool
  router.post('/api/pools/:id/contributions', async (req, res) => {
    const parse = contributionSchema.safeParse(req.body);
    if (!parse.success) {
      return res.status(400).json({ error: parse.error.flatten() });
    }

    const user = (req as any).user;

    try {
      await poolService.addContribution(req.params.id, parse.data, user.id);
      res.status(201).json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to add contribution' });
    }
  });

  // Add batch contributions
  router.post('/api/pools/:id/contributions/batch', async (req, res) => {
    const { contributions } = req.body;
    
    if (!Array.isArray(contributions)) {
      return res.status(400).json({ error: 'Contributions must be an array' });
    }

    for (const contrib of contributions) {
      const parse = contributionSchema.safeParse(contrib);
      if (!parse.success) {
        return res.status(400).json({ error: parse.error.flatten() });
      }
    }

    const user = (req as any).user;

    try {
      await poolService.addBatchContributions(req.params.id, contributions, user.id);
      res.status(201).json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to add contributions' });
    }
  });

  // Record pool usage
  router.post('/api/pools/:id/usages', async (req, res) => {
    const parse = usageSchema.safeParse(req.body);
    if (!parse.success) {
      return res.status(400).json({ error: parse.error.flatten() });
    }

    const user = (req as any).user;

    try {
      await poolService.recordUsage(req.params.id, parse.data, user.id);
      res.status(201).json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to record usage' });
    }
  });

  // Get remaining volume
  router.get('/api/pools/:id/volume', async (req, res) => {
    try {
      const remainingVolume = await poolService.getRemainingVolume(req.params.id);
      res.json({ remainingVolume });
    } catch (error) {
      res.status(500).json({ error: 'Failed to get volume' });
    }
  });

  // Get pools by stock
  router.get('/api/stocks/:stockId/pools', async (req, res) => {
    try {
      const pools = await poolService.getPoolsByStock(req.params.stockId);
      res.json(pools);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch pools' });
    }
  });

  // Get pools by experiment
  router.get('/api/experiments/:experimentId/pools', async (req, res) => {
    try {
      const pools = await poolService.getPoolsByExperiment(req.params.experimentId);
      res.json(pools);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch pools' });
    }
  });

  // Dispose pool
  router.post('/api/pools/:id/dispose', async (req, res) => {
    try {
      await poolService.disposePool(req.params.id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: 'Failed to dispose pool' });
    }
  });

  // Calculate final concentration
  router.post('/api/pools/calculate-concentration', async (req, res) => {
    const { contributions } = req.body;

    if (!Array.isArray(contributions)) {
      return res.status(400).json({ error: 'Contributions must be an array' });
    }

    const finalConcentration = poolService.calculateFinalConcentration(contributions);
    res.json({ finalConcentration });
  });

  return router;
}

export default SamplePoolService;
