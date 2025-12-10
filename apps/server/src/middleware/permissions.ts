/**
 * Role-Based Access Control (RBAC) System
 * Provides granular permissions for secure collaborative editing
 */

// ==================== PERMISSION DEFINITIONS ====================

export const PERMISSIONS = {
  // Experiment permissions
  'experiment:create': 'Create new experiments',
  'experiment:read': 'View experiments',
  'experiment:read:own': 'View own experiments',
  'experiment:read:all': 'View all experiments',
  'experiment:update': 'Edit experiments',
  'experiment:update:own': 'Edit own experiments',
  'experiment:update:all': 'Edit all experiments',
  'experiment:delete': 'Delete experiments',
  'experiment:delete:own': 'Delete own experiments',
  'experiment:delete:all': 'Delete all experiments',
  'experiment:sign': 'Sign experiments',
  'experiment:approve': 'Approve experiments',
  'experiment:export': 'Export experiments',

  // Method permissions
  'method:create': 'Create new methods/protocols',
  'method:read': 'View methods',
  'method:read:public': 'View public methods',
  'method:read:all': 'View all methods',
  'method:update': 'Edit methods',
  'method:update:own': 'Edit own methods',
  'method:update:all': 'Edit all methods',
  'method:delete': 'Delete methods',
  'method:publish': 'Publish methods',
  'method:version': 'Create method versions',

  // Inventory permissions
  'inventory:create': 'Create inventory items',
  'inventory:read': 'View inventory',
  'inventory:update': 'Edit inventory items',
  'inventory:delete': 'Delete inventory items',
  'inventory:order': 'Create purchase orders',
  'inventory:receive': 'Receive inventory shipments',
  'stock:use': 'Use stock in experiments',
  'stock:adjust': 'Adjust stock quantities',
  'stock:dispose': 'Dispose of stock',

  // User management
  'user:create': 'Create users',
  'user:read': 'View users',
  'user:update': 'Edit users',
  'user:delete': 'Delete/deactivate users',
  'user:assign-role': 'Assign roles to users',

  // Team/Project management
  'project:create': 'Create projects',
  'project:manage': 'Manage project membership',
  'team:create': 'Create teams',
  'team:manage': 'Manage team membership',

  // Admin permissions
  'admin:settings': 'Modify system settings',
  'admin:audit-log': 'View audit logs',
  'admin:backup': 'Create/restore backups',
  'admin:api-keys': 'Manage API keys',
  'admin:webhooks': 'Manage webhooks',

  // Compliance
  'compliance:sign': 'Apply electronic signatures',
  'compliance:witness': 'Witness signatures',
  'compliance:review': 'Review for compliance',
  'compliance:export-audit': 'Export audit trails',
} as const;

export type Permission = keyof typeof PERMISSIONS;

// ==================== ROLE DEFINITIONS ====================

export interface RoleDefinition {
  name: string;
  description: string;
  permissions: Permission[];
  inherits?: string[];
}

export const ROLES: Record<string, RoleDefinition> = {
  guest: {
    name: 'Guest',
    description: 'Read-only access to public resources',
    permissions: [
      'method:read:public',
      'inventory:read',
    ],
  },

  member: {
    name: 'Lab Member',
    description: 'Standard lab member with full access to own work',
    permissions: [
      'experiment:create',
      'experiment:read:own',
      'experiment:update:own',
      'experiment:delete:own',
      'experiment:sign',
      'experiment:export',
      'method:create',
      'method:read:public',
      'method:update:own',
      'method:version',
      'inventory:read',
      'stock:use',
      'user:read',
      'compliance:sign',
    ],
    inherits: ['guest'],
  },

  researcher: {
    name: 'Researcher',
    description: 'Senior researcher with broader access',
    permissions: [
      'experiment:read:all',
      'method:read:all',
      'method:publish',
      'inventory:create',
      'inventory:update',
      'stock:adjust',
      'project:create',
      'compliance:witness',
    ],
    inherits: ['member'],
  },

  manager: {
    name: 'Lab Manager',
    description: 'Full lab management capabilities',
    permissions: [
      'experiment:update:all',
      'experiment:delete:all',
      'experiment:approve',
      'method:update:all',
      'method:delete',
      'inventory:delete',
      'inventory:order',
      'inventory:receive',
      'stock:dispose',
      'user:create',
      'user:update',
      'user:assign-role',
      'project:manage',
      'team:create',
      'team:manage',
      'admin:audit-log',
      'admin:api-keys',
      'compliance:review',
      'compliance:export-audit',
    ],
    inherits: ['researcher'],
  },

  admin: {
    name: 'Administrator',
    description: 'Full system administration access',
    permissions: [
      'user:delete',
      'admin:settings',
      'admin:backup',
      'admin:webhooks',
    ],
    inherits: ['manager'],
  },

  compliance_officer: {
    name: 'Compliance Officer',
    description: 'Compliance and audit focused role',
    permissions: [
      'experiment:read:all',
      'method:read:all',
      'compliance:sign',
      'compliance:witness',
      'compliance:review',
      'compliance:export-audit',
      'admin:audit-log',
    ],
  },
};

// ==================== PERMISSION RESOLVER ====================

/**
 * Resolve all permissions for a role, including inherited permissions
 */
export function resolveRolePermissions(roleName: string): Set<Permission> {
  const permissions = new Set<Permission>();
  const visited = new Set<string>();

  function resolve(role: string): void {
    if (visited.has(role)) return;
    visited.add(role);

    const definition = ROLES[role];
    if (!definition) return;

    // Add direct permissions
    definition.permissions.forEach(p => permissions.add(p));

    // Resolve inherited permissions
    if (definition.inherits) {
      definition.inherits.forEach(resolve);
    }
  }

  resolve(roleName);
  return permissions;
}

/**
 * Check if a role has a specific permission
 */
export function hasPermission(role: string, permission: Permission): boolean {
  const permissions = resolveRolePermissions(role);
  return permissions.has(permission);
}

/**
 * Check if a role has any of the specified permissions
 */
export function hasAnyPermission(role: string, requiredPermissions: Permission[]): boolean {
  const permissions = resolveRolePermissions(role);
  return requiredPermissions.some(p => permissions.has(p));
}

/**
 * Check if a role has all of the specified permissions
 */
export function hasAllPermissions(role: string, requiredPermissions: Permission[]): boolean {
  const permissions = resolveRolePermissions(role);
  return requiredPermissions.every(p => permissions.has(p));
}

// ==================== EXPRESS MIDDLEWARE ====================

import { Request, Response, NextFunction } from 'express';

interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    role: string;
    name: string;
    email?: string;
  };
}

/**
 * Middleware to require specific permission(s)
 */
export function requirePermission(...permissions: Permission[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const user = req.user;
    
    if (!user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    if (!hasAnyPermission(user.role, permissions)) {
      return res.status(403).json({ 
        error: 'Insufficient permissions',
        required: permissions,
        userRole: user.role
      });
    }

    next();
  };
}

/**
 * Middleware to require all specified permissions
 */
export function requireAllPermissions(...permissions: Permission[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const user = req.user;
    
    if (!user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    if (!hasAllPermissions(user.role, permissions)) {
      const userPermissions = resolveRolePermissions(user.role);
      const missing = permissions.filter(p => !userPermissions.has(p));
      
      return res.status(403).json({ 
        error: 'Insufficient permissions',
        missing,
        userRole: user.role
      });
    }

    next();
  };
}

/**
 * Middleware for resource ownership check
 */
export function requireOwnershipOrPermission(
  getResourceUserId: (req: Request) => Promise<string | null>,
  fallbackPermission: Permission
) {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const user = req.user;
    
    if (!user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    try {
      const resourceUserId = await getResourceUserId(req);
      
      // Owner can access
      if (resourceUserId === user.id) {
        return next();
      }

      // Check fallback permission
      if (hasPermission(user.role, fallbackPermission)) {
        return next();
      }

      return res.status(403).json({ error: 'Access denied' });
    } catch (error) {
      return res.status(500).json({ error: 'Permission check failed' });
    }
  };
}

// ==================== RESOURCE-LEVEL PERMISSIONS ====================

export interface ResourcePermission {
  userId: string;
  resourceType: 'experiment' | 'method' | 'project';
  resourceId: string;
  permissions: Permission[];
  grantedBy: string;
  grantedAt: Date;
  expiresAt?: Date;
}

/**
 * Check resource-level permission (for sharing)
 */
export async function checkResourcePermission(
  prisma: any,
  userId: string,
  resourceType: string,
  resourceId: string,
  permission: Permission
): Promise<boolean> {
  // This would check a ResourcePermission table
  // For now, return false (fall back to role-based)
  return false;
}

// ==================== PERMISSION CONTEXT ====================

export interface PermissionContext {
  user: {
    id: string;
    role: string;
  };
  resource?: {
    type: string;
    id: string;
    ownerId?: string;
  };
  action: string;
}

/**
 * Comprehensive permission check with context
 */
export async function checkPermission(
  prisma: any,
  context: PermissionContext
): Promise<{ allowed: boolean; reason?: string }> {
  const { user, resource, action } = context;

  // Admin always allowed
  if (user.role === 'admin') {
    return { allowed: true };
  }

  // Map action to permission
  const permission = `${resource?.type}:${action}` as Permission;
  const ownPermission = `${resource?.type}:${action}:own` as Permission;
  const allPermission = `${resource?.type}:${action}:all` as Permission;

  // Check ownership first
  if (resource?.ownerId === user.id) {
    if (hasPermission(user.role, ownPermission) || hasPermission(user.role, permission)) {
      return { allowed: true };
    }
  }

  // Check general permission
  if (hasPermission(user.role, allPermission) || hasPermission(user.role, permission)) {
    return { allowed: true };
  }

  // Check resource-level permission
  if (resource) {
    const hasResourcePerm = await checkResourcePermission(
      prisma,
      user.id,
      resource.type,
      resource.id,
      permission
    );
    if (hasResourcePerm) {
      return { allowed: true };
    }
  }

  return { 
    allowed: false, 
    reason: `Missing permission: ${permission}` 
  };
}

export default {
  PERMISSIONS,
  ROLES,
  resolveRolePermissions,
  hasPermission,
  hasAnyPermission,
  hasAllPermissions,
  requirePermission,
  requireAllPermissions,
  requireOwnershipOrPermission,
  checkPermission,
};
