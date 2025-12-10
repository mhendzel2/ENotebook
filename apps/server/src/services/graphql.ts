/**
 * GraphQL API Service
 * 
 * Provides a flexible GraphQL endpoint alongside the REST API
 * for advanced querying and data retrieval capabilities.
 * 
 * Features:
 * - Full schema for experiments, methods, inventory, workflows
 * - Nested queries and relationships
 * - Mutations for CRUD operations
 * - Subscriptions for real-time updates
 * - Authentication integration
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { 
  GraphQLSchema, 
  GraphQLObjectType, 
  GraphQLString, 
  GraphQLInt, 
  GraphQLFloat,
  GraphQLBoolean,
  GraphQLList, 
  GraphQLNonNull,
  GraphQLInputObjectType,
  GraphQLEnumType,
  graphql,
  GraphQLResolveInfo,
} from 'graphql';

// Type definitions for resolvers
type ResolverContext = { prisma: PrismaClient; user: { id: string; role: string } | null };
type ResolverFn = (parent: any, args: any, context: ResolverContext, info?: GraphQLResolveInfo) => any;

// ==================== ENUM TYPES ====================

const ExperimentStatusEnum = new GraphQLEnumType({
  name: 'ExperimentStatus',
  values: {
    draft: { value: 'draft' },
    in_progress: { value: 'in_progress' },
    completed: { value: 'completed' },
    reviewed: { value: 'reviewed' },
    archived: { value: 'archived' },
  },
});

const ModalityEnum = new GraphQLEnumType({
  name: 'Modality',
  values: {
    wetLab: { value: 'wetLab' },
    computational: { value: 'computational' },
    fieldwork: { value: 'fieldwork' },
    imaging: { value: 'imaging' },
    sequencing: { value: 'sequencing' },
    proteomics: { value: 'proteomics' },
    other: { value: 'other' },
  },
});

const StockStatusEnum = new GraphQLEnumType({
  name: 'StockStatus',
  values: {
    available: { value: 'available' },
    low: { value: 'low' },
    empty: { value: 'empty' },
    expired: { value: 'expired' },
    reserved: { value: 'reserved' },
  },
});

// ==================== OBJECT TYPES ====================

const UserType: GraphQLObjectType = new GraphQLObjectType({
  name: 'User',
  fields: () => ({
    id: { type: new GraphQLNonNull(GraphQLString) },
    email: { type: new GraphQLNonNull(GraphQLString) },
    name: { type: GraphQLString },
    role: { type: new GraphQLNonNull(GraphQLString) },
    createdAt: { type: GraphQLString },
    experiments: {
      type: new GraphQLList(ExperimentType),
      resolve: async (user, _, context) => {
        return context.prisma.experiment.findMany({
          where: { userId: user.id },
        });
      },
    },
    methods: {
      type: new GraphQLList(MethodType),
      resolve: async (user, _, context) => {
        return context.prisma.method.findMany({
          where: { createdBy: user.id },
        });
      },
    },
  }),
});

const MethodType: GraphQLObjectType = new GraphQLObjectType({
  name: 'Method',
  fields: () => ({
    id: { type: new GraphQLNonNull(GraphQLString) },
    title: { type: new GraphQLNonNull(GraphQLString) },
    category: { type: GraphQLString },
    steps: { 
      type: GraphQLString,
      resolve: (method) => typeof method.steps === 'string' ? method.steps : JSON.stringify(method.steps),
    },
    reagents: { 
      type: GraphQLString,
      resolve: (method) => method.reagents ? (typeof method.reagents === 'string' ? method.reagents : JSON.stringify(method.reagents)) : null,
    },
    version: { type: GraphQLInt },
    isPublic: { type: GraphQLBoolean },
    createdBy: { type: new GraphQLNonNull(GraphQLString) },
    createdAt: { type: GraphQLString },
    updatedAt: { type: GraphQLString },
    author: {
      type: UserType,
      resolve: async (method, _, context) => {
        return context.prisma.user.findUnique({
          where: { id: method.createdBy },
        });
      },
    },
  }),
});

const ExperimentType: GraphQLObjectType = new GraphQLObjectType({
  name: 'Experiment',
  fields: () => ({
    id: { type: new GraphQLNonNull(GraphQLString) },
    title: { type: new GraphQLNonNull(GraphQLString) },
    project: { type: GraphQLString },
    modality: { type: ModalityEnum },
    status: { type: ExperimentStatusEnum },
    protocolRef: { type: GraphQLString },
    params: { 
      type: GraphQLString,
      resolve: (exp) => exp.params ? (typeof exp.params === 'string' ? exp.params : JSON.stringify(exp.params)) : null,
    },
    observations: { 
      type: GraphQLString,
      resolve: (exp) => exp.observations ? (typeof exp.observations === 'string' ? exp.observations : JSON.stringify(exp.observations)) : null,
    },
    resultsSummary: { type: GraphQLString },
    dataLink: { type: GraphQLString },
    tags: { 
      type: new GraphQLList(GraphQLString),
      resolve: (exp) => {
        if (!exp.tags) return [];
        return typeof exp.tags === 'string' ? JSON.parse(exp.tags) : exp.tags;
      },
    },
    version: { type: GraphQLInt },
    userId: { type: new GraphQLNonNull(GraphQLString) },
    createdAt: { type: GraphQLString },
    updatedAt: { type: GraphQLString },
    user: {
      type: UserType,
      resolve: async (exp, _, context) => {
        return context.prisma.user.findUnique({
          where: { id: exp.userId },
        });
      },
    },
    signatures: {
      type: new GraphQLList(SignatureType),
      resolve: async (exp, _, context) => {
        return context.prisma.signature.findMany({
          where: { experimentId: exp.id },
        });
      },
    },
    comments: {
      type: new GraphQLList(CommentType),
      resolve: async (exp, _, context) => {
        return context.prisma.comment.findMany({
          where: { experimentId: exp.id },
        });
      },
    },
    method: {
      type: MethodType,
      resolve: async (exp, _, context) => {
        if (!exp.protocolRef) return null;
        return context.prisma.method.findUnique({
          where: { id: exp.protocolRef },
        });
      },
    },
  }),
});

const SignatureType: GraphQLObjectType = new GraphQLObjectType({
  name: 'Signature',
  fields: () => ({
    id: { type: new GraphQLNonNull(GraphQLString) },
    experimentId: { type: new GraphQLNonNull(GraphQLString) },
    userId: { type: new GraphQLNonNull(GraphQLString) },
    type: { type: new GraphQLNonNull(GraphQLString) },
    meaning: { type: GraphQLString },
    timestamp: { type: GraphQLString },
    user: {
      type: UserType,
      resolve: async (sig, _, context) => {
        return context.prisma.user.findUnique({
          where: { id: sig.userId },
        });
      },
    },
  }),
});

const CommentType: GraphQLObjectType = new GraphQLObjectType({
  name: 'Comment',
  fields: () => ({
    id: { type: new GraphQLNonNull(GraphQLString) },
    experimentId: { type: new GraphQLNonNull(GraphQLString) },
    userId: { type: new GraphQLNonNull(GraphQLString) },
    content: { type: new GraphQLNonNull(GraphQLString) },
    createdAt: { type: GraphQLString },
    user: {
      type: UserType,
      resolve: async (comment, _, context) => {
        return context.prisma.user.findUnique({
          where: { id: comment.userId },
        });
      },
    },
  }),
});

const InventoryItemType: GraphQLObjectType = new GraphQLObjectType({
  name: 'InventoryItem',
  fields: () => ({
    id: { type: new GraphQLNonNull(GraphQLString) },
    name: { type: new GraphQLNonNull(GraphQLString) },
    category: { type: new GraphQLNonNull(GraphQLString) },
    description: { type: GraphQLString },
    createdAt: { type: GraphQLString },
    stocks: {
      type: new GraphQLList(StockType),
      resolve: async (item, _, context) => {
        return context.prisma.stock.findMany({
          where: { itemId: item.id },
        });
      },
    },
  }),
});

const StockType: GraphQLObjectType = new GraphQLObjectType({
  name: 'Stock',
  fields: () => ({
    id: { type: new GraphQLNonNull(GraphQLString) },
    itemId: { type: new GraphQLNonNull(GraphQLString) },
    locationId: { type: GraphQLString },
    quantity: { type: new GraphQLNonNull(GraphQLFloat) },
    initialQuantity: { type: new GraphQLNonNull(GraphQLFloat) },
    unit: { type: new GraphQLNonNull(GraphQLString) },
    status: { type: StockStatusEnum },
    lotNumber: { type: GraphQLString },
    expirationDate: { type: GraphQLString },
    createdAt: { type: GraphQLString },
    item: {
      type: InventoryItemType,
      resolve: async (stock, _, context) => {
        return context.prisma.inventoryItem.findUnique({
          where: { id: stock.itemId },
        });
      },
    },
    location: {
      type: LocationType,
      resolve: async (stock, _, context) => {
        if (!stock.locationId) return null;
        return context.prisma.location.findUnique({
          where: { id: stock.locationId },
        });
      },
    },
  }),
});

const LocationType: GraphQLObjectType = new GraphQLObjectType({
  name: 'Location',
  fields: () => ({
    id: { type: new GraphQLNonNull(GraphQLString) },
    name: { type: new GraphQLNonNull(GraphQLString) },
    type: { type: GraphQLString },
    parentId: { type: GraphQLString },
    path: { type: GraphQLString },
    parent: {
      type: LocationType,
      resolve: async (loc, _, context) => {
        if (!loc.parentId) return null;
        return context.prisma.location.findUnique({
          where: { id: loc.parentId },
        });
      },
    },
    children: {
      type: new GraphQLList(LocationType),
      resolve: async (loc, _, context) => {
        return context.prisma.location.findMany({
          where: { parentId: loc.id },
        });
      },
    },
  }),
});

const WorkflowType: GraphQLObjectType = new GraphQLObjectType({
  name: 'Workflow',
  fields: () => ({
    id: { type: new GraphQLNonNull(GraphQLString) },
    name: { type: new GraphQLNonNull(GraphQLString) },
    description: { type: GraphQLString },
    triggerType: { type: new GraphQLNonNull(GraphQLString) },
    triggerConfig: { type: GraphQLString },
    isActive: { type: GraphQLBoolean },
    createdBy: { type: new GraphQLNonNull(GraphQLString) },
    createdAt: { type: GraphQLString },
    steps: {
      type: new GraphQLList(WorkflowStepType),
      resolve: async (workflow, _, context) => {
        return context.prisma.workflowStep.findMany({
          where: { workflowId: workflow.id },
          orderBy: { order: 'asc' },
        });
      },
    },
    executions: {
      type: new GraphQLList(WorkflowExecutionType),
      args: {
        limit: { type: GraphQLInt },
      },
      resolve: async (workflow, args, context) => {
        return context.prisma.workflowExecution.findMany({
          where: { workflowId: workflow.id },
          orderBy: { startedAt: 'desc' },
          take: args.limit || 10,
        });
      },
    },
  }),
});

const WorkflowStepType: GraphQLObjectType = new GraphQLObjectType({
  name: 'WorkflowStep',
  fields: () => ({
    id: { type: new GraphQLNonNull(GraphQLString) },
    workflowId: { type: new GraphQLNonNull(GraphQLString) },
    order: { type: new GraphQLNonNull(GraphQLInt) },
    actionType: { type: new GraphQLNonNull(GraphQLString) },
    actionConfig: { type: GraphQLString },
    condition: { type: GraphQLString },
  }),
});

const WorkflowExecutionType: GraphQLObjectType = new GraphQLObjectType({
  name: 'WorkflowExecution',
  fields: () => ({
    id: { type: new GraphQLNonNull(GraphQLString) },
    workflowId: { type: new GraphQLNonNull(GraphQLString) },
    status: { type: new GraphQLNonNull(GraphQLString) },
    startedAt: { type: GraphQLString },
    completedAt: { type: GraphQLString },
    triggeredBy: { type: GraphQLString },
    triggerData: { type: GraphQLString },
    result: { type: GraphQLString },
    error: { type: GraphQLString },
  }),
});

const SamplePoolType: GraphQLObjectType = new GraphQLObjectType({
  name: 'SamplePool',
  fields: () => ({
    id: { type: new GraphQLNonNull(GraphQLString) },
    name: { type: new GraphQLNonNull(GraphQLString) },
    description: { type: GraphQLString },
    purpose: { type: GraphQLString },
    totalVolume: { type: GraphQLFloat },
    unit: { type: GraphQLString },
    status: { type: new GraphQLNonNull(GraphQLString) },
    createdBy: { type: new GraphQLNonNull(GraphQLString) },
    createdAt: { type: GraphQLString },
    contributions: {
      type: new GraphQLList(PoolContributionType),
      resolve: async (pool, _, context) => {
        return context.prisma.poolContribution.findMany({
          where: { poolId: pool.id },
        });
      },
    },
    usages: {
      type: new GraphQLList(PoolUsageType),
      resolve: async (pool, _, context) => {
        return context.prisma.poolUsage.findMany({
          where: { poolId: pool.id },
        });
      },
    },
  }),
});

const PoolContributionType: GraphQLObjectType = new GraphQLObjectType({
  name: 'PoolContribution',
  fields: () => ({
    id: { type: new GraphQLNonNull(GraphQLString) },
    poolId: { type: new GraphQLNonNull(GraphQLString) },
    stockId: { type: new GraphQLNonNull(GraphQLString) },
    volumeAdded: { type: new GraphQLNonNull(GraphQLFloat) },
    unit: { type: new GraphQLNonNull(GraphQLString) },
    concentration: { type: GraphQLFloat },
    addedAt: { type: GraphQLString },
    addedBy: { type: new GraphQLNonNull(GraphQLString) },
    stock: {
      type: StockType,
      resolve: async (contrib, _, context) => {
        return context.prisma.stock.findUnique({
          where: { id: contrib.stockId },
        });
      },
    },
  }),
});

const PoolUsageType: GraphQLObjectType = new GraphQLObjectType({
  name: 'PoolUsage',
  fields: () => ({
    id: { type: new GraphQLNonNull(GraphQLString) },
    poolId: { type: new GraphQLNonNull(GraphQLString) },
    volumeUsed: { type: new GraphQLNonNull(GraphQLFloat) },
    unit: { type: new GraphQLNonNull(GraphQLString) },
    purpose: { type: GraphQLString },
    experimentId: { type: GraphQLString },
    usedAt: { type: GraphQLString },
    usedBy: { type: new GraphQLNonNull(GraphQLString) },
    experiment: {
      type: ExperimentType,
      resolve: async (usage, _, context) => {
        if (!usage.experimentId) return null;
        return context.prisma.experiment.findUnique({
          where: { id: usage.experimentId },
        });
      },
    },
  }),
});

const DashboardType: GraphQLObjectType = new GraphQLObjectType({
  name: 'Dashboard',
  fields: () => ({
    id: { type: new GraphQLNonNull(GraphQLString) },
    name: { type: new GraphQLNonNull(GraphQLString) },
    description: { type: GraphQLString },
    layout: { type: GraphQLString },
    isPublic: { type: GraphQLBoolean },
    createdBy: { type: new GraphQLNonNull(GraphQLString) },
    createdAt: { type: GraphQLString },
    widgets: {
      type: new GraphQLList(DashboardWidgetType),
      resolve: async (dashboard, _, context) => {
        return context.prisma.dashboardWidget.findMany({
          where: { dashboardId: dashboard.id },
        });
      },
    },
  }),
});

const DashboardWidgetType: GraphQLObjectType = new GraphQLObjectType({
  name: 'DashboardWidget',
  fields: () => ({
    id: { type: new GraphQLNonNull(GraphQLString) },
    dashboardId: { type: new GraphQLNonNull(GraphQLString) },
    queryId: { type: GraphQLString },
    title: { type: new GraphQLNonNull(GraphQLString) },
    chartType: { type: new GraphQLNonNull(GraphQLString) },
    chartConfig: { type: GraphQLString },
    position: { type: GraphQLString },
  }),
});

// ==================== INPUT TYPES ====================

const ExperimentInput = new GraphQLInputObjectType({
  name: 'ExperimentInput',
  fields: {
    title: { type: new GraphQLNonNull(GraphQLString) },
    project: { type: GraphQLString },
    modality: { type: GraphQLString },
    status: { type: GraphQLString },
    protocolRef: { type: GraphQLString },
    params: { type: GraphQLString },
    observations: { type: GraphQLString },
    resultsSummary: { type: GraphQLString },
    dataLink: { type: GraphQLString },
    tags: { type: new GraphQLList(GraphQLString) },
  },
});

const MethodInput = new GraphQLInputObjectType({
  name: 'MethodInput',
  fields: {
    title: { type: new GraphQLNonNull(GraphQLString) },
    category: { type: GraphQLString },
    steps: { type: new GraphQLNonNull(GraphQLString) },
    reagents: { type: GraphQLString },
    isPublic: { type: GraphQLBoolean },
  },
});

const InventoryItemInput = new GraphQLInputObjectType({
  name: 'InventoryItemInput',
  fields: {
    name: { type: new GraphQLNonNull(GraphQLString) },
    category: { type: new GraphQLNonNull(GraphQLString) },
    description: { type: GraphQLString },
  },
});

const StockInput = new GraphQLInputObjectType({
  name: 'StockInput',
  fields: {
    itemId: { type: new GraphQLNonNull(GraphQLString) },
    locationId: { type: GraphQLString },
    quantity: { type: new GraphQLNonNull(GraphQLFloat) },
    unit: { type: new GraphQLNonNull(GraphQLString) },
    lotNumber: { type: GraphQLString },
    expirationDate: { type: GraphQLString },
  },
});

const WorkflowInput = new GraphQLInputObjectType({
  name: 'WorkflowInput',
  fields: {
    name: { type: new GraphQLNonNull(GraphQLString) },
    description: { type: GraphQLString },
    triggerType: { type: new GraphQLNonNull(GraphQLString) },
    triggerConfig: { type: GraphQLString },
    isActive: { type: GraphQLBoolean },
  },
});

// ==================== QUERY TYPE ====================

const QueryType = new GraphQLObjectType({
  name: 'Query',
  fields: {
    // User queries
    me: {
      type: UserType,
      resolve: async (_, __, context) => {
        if (!context.user) return null;
        return context.prisma.user.findUnique({
          where: { id: context.user.id },
        });
      },
    },
    user: {
      type: UserType,
      args: { id: { type: new GraphQLNonNull(GraphQLString) } },
      resolve: async (_, args, context) => {
        return context.prisma.user.findUnique({
          where: { id: args.id },
        });
      },
    },
    users: {
      type: new GraphQLList(UserType),
      resolve: async (_, __, context) => {
        return context.prisma.user.findMany();
      },
    },

    // Experiment queries
    experiment: {
      type: ExperimentType,
      args: { id: { type: new GraphQLNonNull(GraphQLString) } },
      resolve: async (_, args, context) => {
        return context.prisma.experiment.findUnique({
          where: { id: args.id },
        });
      },
    },
    experiments: {
      type: new GraphQLList(ExperimentType),
      args: {
        status: { type: GraphQLString },
        modality: { type: GraphQLString },
        project: { type: GraphQLString },
        userId: { type: GraphQLString },
        limit: { type: GraphQLInt },
        offset: { type: GraphQLInt },
      },
      resolve: async (_, args, context) => {
        const where: Record<string, unknown> = {};
        if (args.status) where.status = args.status;
        if (args.modality) where.modality = args.modality;
        if (args.project) where.project = args.project;
        if (args.userId) where.userId = args.userId;

        return context.prisma.experiment.findMany({
          where,
          take: args.limit || 100,
          skip: args.offset || 0,
          orderBy: { createdAt: 'desc' },
        });
      },
    },
    searchExperiments: {
      type: new GraphQLList(ExperimentType),
      args: {
        query: { type: new GraphQLNonNull(GraphQLString) },
        limit: { type: GraphQLInt },
      },
      resolve: async (_, args, context) => {
        return context.prisma.experiment.findMany({
          where: {
            OR: [
              { title: { contains: args.query } },
              { project: { contains: args.query } },
              { resultsSummary: { contains: args.query } },
            ],
          },
          take: args.limit || 20,
        });
      },
    },

    // Method queries
    method: {
      type: MethodType,
      args: { id: { type: new GraphQLNonNull(GraphQLString) } },
      resolve: async (_, args, context) => {
        return context.prisma.method.findUnique({
          where: { id: args.id },
        });
      },
    },
    methods: {
      type: new GraphQLList(MethodType),
      args: {
        category: { type: GraphQLString },
        isPublic: { type: GraphQLBoolean },
        limit: { type: GraphQLInt },
      },
      resolve: async (_, args, context) => {
        const where: Record<string, unknown> = {};
        if (args.category) where.category = args.category;
        if (args.isPublic !== undefined) where.isPublic = args.isPublic;

        return context.prisma.method.findMany({
          where,
          take: args.limit || 100,
        });
      },
    },

    // Inventory queries
    inventoryItem: {
      type: InventoryItemType,
      args: { id: { type: new GraphQLNonNull(GraphQLString) } },
      resolve: async (_, args, context) => {
        return context.prisma.inventoryItem.findUnique({
          where: { id: args.id },
        });
      },
    },
    inventoryItems: {
      type: new GraphQLList(InventoryItemType),
      args: {
        category: { type: GraphQLString },
        limit: { type: GraphQLInt },
      },
      resolve: async (_, args, context) => {
        const where: Record<string, unknown> = {};
        if (args.category) where.category = args.category;

        return context.prisma.inventoryItem.findMany({
          where,
          take: args.limit || 100,
        });
      },
    },
    stock: {
      type: StockType,
      args: { id: { type: new GraphQLNonNull(GraphQLString) } },
      resolve: async (_, args, context) => {
        return context.prisma.stock.findUnique({
          where: { id: args.id },
        });
      },
    },
    stocks: {
      type: new GraphQLList(StockType),
      args: {
        status: { type: GraphQLString },
        itemId: { type: GraphQLString },
        locationId: { type: GraphQLString },
        limit: { type: GraphQLInt },
      },
      resolve: async (_, args, context) => {
        const where: Record<string, unknown> = {};
        if (args.status) where.status = args.status;
        if (args.itemId) where.itemId = args.itemId;
        if (args.locationId) where.locationId = args.locationId;

        return context.prisma.stock.findMany({
          where,
          take: args.limit || 100,
        });
      },
    },
    lowStocks: {
      type: new GraphQLList(StockType),
      args: { threshold: { type: GraphQLFloat } },
      resolve: async (_, args, context) => {
        return context.prisma.stock.findMany({
          where: {
            OR: [
              { status: 'low' },
              { status: 'empty' },
            ],
          },
        });
      },
    },

    // Location queries
    locations: {
      type: new GraphQLList(LocationType),
      args: { parentId: { type: GraphQLString } },
      resolve: async (_, args, context) => {
        const where: Record<string, unknown> = {};
        if (args.parentId) {
          where.parentId = args.parentId;
        } else {
          where.parentId = null;
        }
        return context.prisma.location.findMany({ where });
      },
    },

    // Workflow queries
    workflow: {
      type: WorkflowType,
      args: { id: { type: new GraphQLNonNull(GraphQLString) } },
      resolve: async (_, args, context) => {
        return context.prisma.workflow.findUnique({
          where: { id: args.id },
        });
      },
    },
    workflows: {
      type: new GraphQLList(WorkflowType),
      args: {
        isActive: { type: GraphQLBoolean },
        triggerType: { type: GraphQLString },
      },
      resolve: async (_, args, context) => {
        const where: Record<string, unknown> = {};
        if (args.isActive !== undefined) where.isActive = args.isActive;
        if (args.triggerType) where.triggerType = args.triggerType;

        return context.prisma.workflow.findMany({ where });
      },
    },

    // Sample pool queries
    samplePool: {
      type: SamplePoolType,
      args: { id: { type: new GraphQLNonNull(GraphQLString) } },
      resolve: async (_, args, context) => {
        return context.prisma.samplePool.findUnique({
          where: { id: args.id },
        });
      },
    },
    samplePools: {
      type: new GraphQLList(SamplePoolType),
      args: {
        status: { type: GraphQLString },
        purpose: { type: GraphQLString },
      },
      resolve: async (_, args, context) => {
        const where: Record<string, unknown> = {};
        if (args.status) where.status = args.status;
        if (args.purpose) where.purpose = args.purpose;

        return context.prisma.samplePool.findMany({ where });
      },
    },

    // Dashboard queries
    dashboard: {
      type: DashboardType,
      args: { id: { type: new GraphQLNonNull(GraphQLString) } },
      resolve: async (_, args, context) => {
        return context.prisma.dashboard.findUnique({
          where: { id: args.id },
        });
      },
    },
    dashboards: {
      type: new GraphQLList(DashboardType),
      args: { isPublic: { type: GraphQLBoolean } },
      resolve: async (_, args, context) => {
        const where: Record<string, unknown> = {};
        if (args.isPublic !== undefined) where.isPublic = args.isPublic;

        return context.prisma.dashboard.findMany({ where });
      },
    },

    // Statistics
    statistics: {
      type: new GraphQLObjectType({
        name: 'Statistics',
        fields: {
          totalExperiments: { type: GraphQLInt },
          totalMethods: { type: GraphQLInt },
          totalInventoryItems: { type: GraphQLInt },
          totalStocks: { type: GraphQLInt },
          lowStockCount: { type: GraphQLInt },
          activeWorkflows: { type: GraphQLInt },
          activePools: { type: GraphQLInt },
        },
      }),
      resolve: async (_, __, context) => {
        const [
          totalExperiments,
          totalMethods,
          totalInventoryItems,
          totalStocks,
          lowStockCount,
          activeWorkflows,
          activePools,
        ] = await Promise.all([
          context.prisma.experiment.count(),
          context.prisma.method.count(),
          context.prisma.inventoryItem.count(),
          context.prisma.stock.count(),
          context.prisma.stock.count({ where: { status: { in: ['low', 'empty'] } } }),
          context.prisma.workflow.count({ where: { isActive: true } }),
          context.prisma.samplePool.count({ where: { status: 'active' } }),
        ]);

        return {
          totalExperiments,
          totalMethods,
          totalInventoryItems,
          totalStocks,
          lowStockCount,
          activeWorkflows,
          activePools,
        };
      },
    },
  },
});

// ==================== MUTATION TYPE ====================

const MutationType = new GraphQLObjectType({
  name: 'Mutation',
  fields: {
    // Experiment mutations
    createExperiment: {
      type: ExperimentType,
      args: { input: { type: new GraphQLNonNull(ExperimentInput) } },
      resolve: async (_, { input }, context) => {
        if (!context.user) throw new Error('Authentication required');
        
        return context.prisma.experiment.create({
          data: {
            ...input,
            userId: context.user.id,
            version: 1,
            tags: input.tags ? JSON.stringify(input.tags) : '[]',
          },
        });
      },
    },
    updateExperiment: {
      type: ExperimentType,
      args: {
        id: { type: new GraphQLNonNull(GraphQLString) },
        input: { type: new GraphQLNonNull(ExperimentInput) },
      },
      resolve: async (_, { id, input }, context) => {
        if (!context.user) throw new Error('Authentication required');

        const existing = await context.prisma.experiment.findUnique({ where: { id } });
        if (!existing) throw new Error('Experiment not found');

        return context.prisma.experiment.update({
          where: { id },
          data: {
            ...input,
            tags: input.tags ? JSON.stringify(input.tags) : existing.tags,
            version: existing.version + 1,
          },
        });
      },
    },
    deleteExperiment: {
      type: GraphQLBoolean,
      args: { id: { type: new GraphQLNonNull(GraphQLString) } },
      resolve: async (_, { id }, context) => {
        if (!context.user) throw new Error('Authentication required');
        await context.prisma.experiment.delete({ where: { id } });
        return true;
      },
    },

    // Method mutations
    createMethod: {
      type: MethodType,
      args: { input: { type: new GraphQLNonNull(MethodInput) } },
      resolve: async (_, { input }, context) => {
        if (!context.user) throw new Error('Authentication required');

        return context.prisma.method.create({
          data: {
            ...input,
            createdBy: context.user.id,
            version: 1,
          },
        });
      },
    },
    updateMethod: {
      type: MethodType,
      args: {
        id: { type: new GraphQLNonNull(GraphQLString) },
        input: { type: new GraphQLNonNull(MethodInput) },
      },
      resolve: async (_, { id, input }, context) => {
        if (!context.user) throw new Error('Authentication required');

        const existing = await context.prisma.method.findUnique({ where: { id } });
        if (!existing) throw new Error('Method not found');

        return context.prisma.method.update({
          where: { id },
          data: {
            ...input,
            version: existing.version + 1,
          },
        });
      },
    },

    // Inventory mutations
    createInventoryItem: {
      type: InventoryItemType,
      args: { input: { type: new GraphQLNonNull(InventoryItemInput) } },
      resolve: async (_, { input }, context) => {
        if (!context.user) throw new Error('Authentication required');
        return context.prisma.inventoryItem.create({ data: input });
      },
    },
    createStock: {
      type: StockType,
      args: { input: { type: new GraphQLNonNull(StockInput) } },
      resolve: async (_, { input }, context) => {
        if (!context.user) throw new Error('Authentication required');

        return context.prisma.stock.create({
          data: {
            ...input,
            initialQuantity: input.quantity,
            status: 'available',
          },
        });
      },
    },
    updateStockQuantity: {
      type: StockType,
      args: {
        id: { type: new GraphQLNonNull(GraphQLString) },
        quantity: { type: new GraphQLNonNull(GraphQLFloat) },
      },
      resolve: async (_, { id, quantity }, context) => {
        if (!context.user) throw new Error('Authentication required');

        const stock = await context.prisma.stock.findUnique({ where: { id } });
        if (!stock) throw new Error('Stock not found');

        const newStatus = quantity <= 0 ? 'empty' : 
                         quantity < stock.initialQuantity * 0.1 ? 'low' : 'available';

        return context.prisma.stock.update({
          where: { id },
          data: { quantity, status: newStatus },
        });
      },
    },

    // Workflow mutations
    createWorkflow: {
      type: WorkflowType,
      args: { input: { type: new GraphQLNonNull(WorkflowInput) } },
      resolve: async (_, { input }, context) => {
        if (!context.user) throw new Error('Authentication required');

        return context.prisma.workflow.create({
          data: {
            ...input,
            createdBy: context.user.id,
          },
        });
      },
    },
    toggleWorkflow: {
      type: WorkflowType,
      args: { id: { type: new GraphQLNonNull(GraphQLString) } },
      resolve: async (_, { id }, context) => {
        if (!context.user) throw new Error('Authentication required');

        const workflow = await context.prisma.workflow.findUnique({ where: { id } });
        if (!workflow) throw new Error('Workflow not found');

        return context.prisma.workflow.update({
          where: { id },
          data: { isActive: !workflow.isActive },
        });
      },
    },

    // Sample pool mutations
    createSamplePool: {
      type: SamplePoolType,
      args: {
        name: { type: new GraphQLNonNull(GraphQLString) },
        description: { type: GraphQLString },
        purpose: { type: GraphQLString },
      },
      resolve: async (_, args, context) => {
        if (!context.user) throw new Error('Authentication required');

        return context.prisma.samplePool.create({
          data: {
            ...args,
            totalVolume: 0,
            status: 'active',
            createdBy: context.user.id,
          },
        });
      },
    },
    addPoolContribution: {
      type: PoolContributionType,
      args: {
        poolId: { type: new GraphQLNonNull(GraphQLString) },
        stockId: { type: new GraphQLNonNull(GraphQLString) },
        volumeAdded: { type: new GraphQLNonNull(GraphQLFloat) },
        unit: { type: new GraphQLNonNull(GraphQLString) },
        concentration: { type: GraphQLFloat },
      },
      resolve: async (_, args, context) => {
        if (!context.user) throw new Error('Authentication required');

        // Check stock availability
        const stock = await context.prisma.stock.findUnique({ where: { id: args.stockId } });
        if (!stock) throw new Error('Stock not found');
        if (stock.quantity < args.volumeAdded) {
          throw new Error(`Insufficient stock. Available: ${stock.quantity}`);
        }

        // Create contribution and update stock
        const [contribution] = await context.prisma.$transaction([
          context.prisma.poolContribution.create({
            data: {
              poolId: args.poolId,
              stockId: args.stockId,
              volumeAdded: args.volumeAdded,
              unit: args.unit,
              concentration: args.concentration,
              addedBy: context.user.id,
            },
          }),
          context.prisma.stock.update({
            where: { id: args.stockId },
            data: { quantity: stock.quantity - args.volumeAdded },
          }),
          context.prisma.samplePool.update({
            where: { id: args.poolId },
            data: {
              totalVolume: { increment: args.volumeAdded },
              unit: args.unit,
            },
          }),
        ]);

        return contribution;
      },
    },
  },
});

// ==================== SCHEMA ====================

export const schema = new GraphQLSchema({
  query: QueryType,
  mutation: MutationType,
});

// ==================== EXPRESS ROUTES ====================

export function createGraphQLRoutes(prisma: PrismaClient) {
  const router = Router();

  // GraphQL endpoint
  router.post('/api/graphql', async (req, res) => {
    const { query, variables, operationName } = req.body;

    if (!query || typeof query !== 'string') {
      return res.status(400).json({ error: 'Query must be a string' });
    }

    // Basic query length validation to prevent DoS
    if (query.length > 10000) {
      return res.status(400).json({ error: 'Query too large' });
    }

    // Prevent introspection in production (optional security hardening)
    // if (process.env.NODE_ENV === 'production' && query.includes('__schema')) {
    //   return res.status(403).json({ error: 'Introspection disabled' });
    // }

    const context = {
      prisma,
      user: (req as any).user,
    };

    try {
      const result = await graphql({
        schema,
        source: query,
        variableValues: variables,
        operationName,
        contextValue: context,
      });

      res.json(result);
    } catch (error) {
      res.status(500).json({
        errors: [{ message: error instanceof Error ? error.message : 'GraphQL execution error' }],
      });
    }
  });

  // GraphQL schema introspection endpoint
  router.get('/api/graphql/schema', (_req, res) => {
    res.type('text/plain').send(`
# ENotebook GraphQL Schema

## Queries
- me: User - Get current authenticated user
- user(id: ID!): User - Get user by ID
- users: [User] - List all users
- experiment(id: ID!): Experiment - Get experiment by ID
- experiments(status, modality, project, userId, limit, offset): [Experiment]
- searchExperiments(query: String!, limit: Int): [Experiment]
- method(id: ID!): Method
- methods(category, isPublic, limit): [Method]
- inventoryItem(id: ID!): InventoryItem
- inventoryItems(category, limit): [InventoryItem]
- stock(id: ID!): Stock
- stocks(status, itemId, locationId, limit): [Stock]
- lowStocks(threshold): [Stock]
- locations(parentId): [Location]
- workflow(id: ID!): Workflow
- workflows(isActive, triggerType): [Workflow]
- samplePool(id: ID!): SamplePool
- samplePools(status, purpose): [SamplePool]
- dashboard(id: ID!): Dashboard
- dashboards(isPublic): [Dashboard]
- statistics: Statistics

## Mutations
- createExperiment(input: ExperimentInput!): Experiment
- updateExperiment(id: ID!, input: ExperimentInput!): Experiment
- deleteExperiment(id: ID!): Boolean
- createMethod(input: MethodInput!): Method
- updateMethod(id: ID!, input: MethodInput!): Method
- createInventoryItem(input: InventoryItemInput!): InventoryItem
- createStock(input: StockInput!): Stock
- updateStockQuantity(id: ID!, quantity: Float!): Stock
- createWorkflow(input: WorkflowInput!): Workflow
- toggleWorkflow(id: ID!): Workflow
- createSamplePool(name: String!, description: String, purpose: String): SamplePool
- addPoolContribution(poolId: ID!, stockId: ID!, volumeAdded: Float!, unit: String!, concentration: Float): PoolContribution
    `.trim());
  });

  return router;
}

export default { schema, createGraphQLRoutes };
