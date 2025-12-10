/**
 * WebSocket Service for Real-Time Collaboration
 * Enables concurrent editing, presence awareness, and live updates
 */

import { Server as HttpServer } from 'http';
import { Server as SocketIOServer, Socket } from 'socket.io';
import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';

// ==================== TYPES ====================

interface UserPresence {
  id: string;
  name: string;
  color: string;
  cursor?: CursorPosition;
  selection?: SelectionRange;
  lastActivity: Date;
}

interface CursorPosition {
  entityType: 'experiment' | 'method';
  entityId: string;
  field: string;
  position: number;
}

interface SelectionRange {
  entityType: 'experiment' | 'method';
  entityId: string;
  field: string;
  start: number;
  end: number;
}

interface DocumentRoom {
  entityType: 'experiment' | 'method';
  entityId: string;
  users: Map<string, UserPresence>;
  version: number;
  lastModified: Date;
  pendingOperations: Operation[];
}

interface Operation {
  id: string;
  userId: string;
  type: 'insert' | 'delete' | 'replace' | 'update';
  field: string;
  position?: number;
  content?: string;
  length?: number;
  value?: unknown;
  timestamp: Date;
  version: number;
}

interface EditEvent {
  entityType: 'experiment' | 'method';
  entityId: string;
  field: string;
  operation: Operation;
}

interface LockRequest {
  entityType: 'experiment' | 'method';
  entityId: string;
  field?: string;
  exclusive: boolean;
}

interface Lock {
  userId: string;
  userName: string;
  field?: string;
  exclusive: boolean;
  acquiredAt: Date;
  expiresAt: Date;
}

// ==================== COLLABORATION MANAGER ====================

export class CollaborationManager {
  private io: SocketIOServer;
  private prisma: PrismaClient;
  private rooms: Map<string, DocumentRoom> = new Map();
  private userSockets: Map<string, Set<string>> = new Map(); // userId -> socket IDs
  private socketUsers: Map<string, string> = new Map(); // socketId -> userId
  private locks: Map<string, Lock[]> = new Map(); // roomKey -> locks
  private colors: string[] = [
    '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7',
    '#DDA0DD', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E9'
  ];

  constructor(server: HttpServer, prisma: PrismaClient) {
    this.prisma = prisma;
    this.io = new SocketIOServer(server, {
      cors: {
        origin: process.env.CORS_ORIGIN || '*',
        methods: ['GET', 'POST']
      },
      pingTimeout: 60000,
      pingInterval: 25000
    });

    this.setupEventHandlers();
    this.startCleanupInterval();
  }

  private getRoomKey(entityType: string, entityId: string): string {
    return `${entityType}:${entityId}`;
  }

  private assignColor(userId: string): string {
    // Deterministic color based on user ID
    const hash = crypto.createHash('md5').update(userId).digest('hex');
    const index = parseInt(hash.substring(0, 8), 16) % this.colors.length;
    return this.colors[index];
  }

  private setupEventHandlers(): void {
    this.io.use(async (socket, next) => {
      // Authenticate socket connection
      const token = socket.handshake.auth.token;
      const userId = socket.handshake.auth.userId;

      if (!userId) {
        return next(new Error('Authentication required'));
      }

      try {
        const user = await this.prisma.user.findUnique({
          where: { id: userId }
        });

        if (!user || !user.active) {
          return next(new Error('Invalid user'));
        }

        (socket as any).user = user;
        next();
      } catch (error) {
        next(new Error('Authentication failed'));
      }
    });

    this.io.on('connection', (socket: Socket) => {
      const user = (socket as any).user;
      console.log(`User ${user.name} (${user.id}) connected via WebSocket`);

      // Track user sockets
      if (!this.userSockets.has(user.id)) {
        this.userSockets.set(user.id, new Set());
      }
      this.userSockets.get(user.id)!.add(socket.id);
      this.socketUsers.set(socket.id, user.id);

      // ==================== PRESENCE ====================

      socket.on('join-document', async (data: { entityType: string; entityId: string }) => {
        const roomKey = this.getRoomKey(data.entityType, data.entityId);
        
        // Check permissions
        const hasAccess = await this.checkAccess(user, data.entityType, data.entityId, 'read');
        if (!hasAccess) {
          socket.emit('error', { message: 'Access denied' });
          return;
        }

        socket.join(roomKey);

        // Initialize or update room
        if (!this.rooms.has(roomKey)) {
          this.rooms.set(roomKey, {
            entityType: data.entityType as 'experiment' | 'method',
            entityId: data.entityId,
            users: new Map(),
            version: 1,
            lastModified: new Date(),
            pendingOperations: []
          });
        }

        const room = this.rooms.get(roomKey)!;
        const presence: UserPresence = {
          id: user.id,
          name: user.name,
          color: this.assignColor(user.id),
          lastActivity: new Date()
        };
        room.users.set(user.id, presence);

        // Notify others in room
        socket.to(roomKey).emit('user-joined', presence);

        // Send current room state to joining user
        socket.emit('document-state', {
          users: Array.from(room.users.values()),
          version: room.version,
          locks: this.locks.get(roomKey) || []
        });

        console.log(`User ${user.name} joined ${roomKey}`);
      });

      socket.on('leave-document', (data: { entityType: string; entityId: string }) => {
        const roomKey = this.getRoomKey(data.entityType, data.entityId);
        this.handleUserLeaveRoom(socket, user, roomKey);
      });

      // ==================== CURSOR & SELECTION ====================

      socket.on('cursor-move', (data: CursorPosition) => {
        const roomKey = this.getRoomKey(data.entityType, data.entityId);
        const room = this.rooms.get(roomKey);
        
        if (room && room.users.has(user.id)) {
          const presence = room.users.get(user.id)!;
          presence.cursor = data;
          presence.lastActivity = new Date();
          
          socket.to(roomKey).emit('cursor-update', {
            userId: user.id,
            cursor: data
          });
        }
      });

      socket.on('selection-change', (data: SelectionRange) => {
        const roomKey = this.getRoomKey(data.entityType, data.entityId);
        const room = this.rooms.get(roomKey);
        
        if (room && room.users.has(user.id)) {
          const presence = room.users.get(user.id)!;
          presence.selection = data;
          presence.lastActivity = new Date();
          
          socket.to(roomKey).emit('selection-update', {
            userId: user.id,
            selection: data
          });
        }
      });

      // ==================== COLLABORATIVE EDITING ====================

      socket.on('edit', async (data: EditEvent) => {
        const roomKey = this.getRoomKey(data.entityType, data.entityId);
        const room = this.rooms.get(roomKey);

        if (!room) {
          socket.emit('error', { message: 'Not in document room' });
          return;
        }

        // Check write permission
        const hasAccess = await this.checkAccess(user, data.entityType, data.entityId, 'write');
        if (!hasAccess) {
          socket.emit('error', { message: 'Write access denied' });
          return;
        }

        // Check for conflicting locks
        const locks = this.locks.get(roomKey) || [];
        const conflictingLock = locks.find(
          l => l.userId !== user.id && (l.exclusive || l.field === data.field)
        );
        if (conflictingLock) {
          socket.emit('error', { 
            message: `Field locked by ${conflictingLock.userName}`,
            lock: conflictingLock
          });
          return;
        }

        // Apply operation
        const operation: Operation = {
          ...data.operation,
          id: crypto.randomUUID(),
          userId: user.id,
          timestamp: new Date(),
          version: ++room.version
        };

        room.pendingOperations.push(operation);
        room.lastModified = new Date();

        // Broadcast to other clients
        socket.to(roomKey).emit('remote-edit', {
          entityType: data.entityType,
          entityId: data.entityId,
          operation
        });

        // Acknowledge to sender
        socket.emit('edit-ack', {
          operationId: operation.id,
          version: operation.version
        });

        // Persist changes (debounced in production)
        this.persistChanges(data.entityType, data.entityId, room);
      });

      // ==================== LOCKING ====================

      socket.on('request-lock', async (data: LockRequest) => {
        const roomKey = this.getRoomKey(data.entityType, data.entityId);
        
        if (!this.locks.has(roomKey)) {
          this.locks.set(roomKey, []);
        }

        const locks = this.locks.get(roomKey)!;
        
        // Check for conflicts
        const conflict = locks.find(l => {
          if (l.userId === user.id) return false;
          if (data.exclusive || l.exclusive) return true;
          if (data.field && l.field === data.field) return true;
          return false;
        });

        if (conflict) {
          socket.emit('lock-denied', {
            field: data.field,
            heldBy: conflict.userName,
            expiresAt: conflict.expiresAt
          });
          return;
        }

        // Remove existing lock by this user for same field
        const existingIndex = locks.findIndex(
          l => l.userId === user.id && l.field === data.field
        );
        if (existingIndex >= 0) {
          locks.splice(existingIndex, 1);
        }

        // Create new lock
        const lock: Lock = {
          userId: user.id,
          userName: user.name,
          field: data.field,
          exclusive: data.exclusive,
          acquiredAt: new Date(),
          expiresAt: new Date(Date.now() + 5 * 60 * 1000) // 5 minutes
        };
        locks.push(lock);

        socket.emit('lock-granted', lock);
        socket.to(roomKey).emit('lock-acquired', {
          userId: user.id,
          userName: user.name,
          lock
        });
      });

      socket.on('release-lock', (data: { entityType: string; entityId: string; field?: string }) => {
        const roomKey = this.getRoomKey(data.entityType, data.entityId);
        const locks = this.locks.get(roomKey);
        
        if (locks) {
          const index = locks.findIndex(
            l => l.userId === user.id && l.field === data.field
          );
          if (index >= 0) {
            locks.splice(index, 1);
            this.io.to(roomKey).emit('lock-released', {
              userId: user.id,
              field: data.field
            });
          }
        }
      });

      // ==================== NOTIFICATIONS ====================

      socket.on('subscribe-notifications', () => {
        socket.join(`user:${user.id}`);
      });

      // ==================== DISCONNECT ====================

      socket.on('disconnect', () => {
        console.log(`User ${user.name} disconnected`);
        
        // Remove from all rooms
        this.rooms.forEach((room, roomKey) => {
          if (room.users.has(user.id)) {
            this.handleUserLeaveRoom(socket, user, roomKey);
          }
        });

        // Clean up socket tracking
        this.socketUsers.delete(socket.id);
        const userSocketSet = this.userSockets.get(user.id);
        if (userSocketSet) {
          userSocketSet.delete(socket.id);
          if (userSocketSet.size === 0) {
            this.userSockets.delete(user.id);
          }
        }
      });
    });
  }

  private handleUserLeaveRoom(socket: Socket, user: any, roomKey: string): void {
    socket.leave(roomKey);
    
    const room = this.rooms.get(roomKey);
    if (room) {
      room.users.delete(user.id);
      socket.to(roomKey).emit('user-left', { userId: user.id });

      // Release user's locks
      const locks = this.locks.get(roomKey);
      if (locks) {
        const userLocks = locks.filter(l => l.userId === user.id);
        userLocks.forEach(lock => {
          const index = locks.indexOf(lock);
          if (index >= 0) {
            locks.splice(index, 1);
            this.io.to(roomKey).emit('lock-released', {
              userId: user.id,
              field: lock.field
            });
          }
        });
      }

      // Clean up empty rooms
      if (room.users.size === 0) {
        this.rooms.delete(roomKey);
        this.locks.delete(roomKey);
      }
    }
  }

  private async checkAccess(
    user: any,
    entityType: string,
    entityId: string,
    action: 'read' | 'write'
  ): Promise<boolean> {
    // Manager can access everything
    if (user.role === 'manager' || user.role === 'admin') {
      return true;
    }

    if (entityType === 'experiment') {
      const experiment = await this.prisma.experiment.findUnique({
        where: { id: entityId }
      });
      if (!experiment) return false;
      return experiment.userId === user.id;
    }

    if (entityType === 'method') {
      const method = await this.prisma.method.findUnique({
        where: { id: entityId }
      });
      if (!method) return false;
      if (action === 'read' && method.isPublic) return true;
      return method.createdBy === user.id;
    }

    return false;
  }

  private async persistChanges(
    entityType: string,
    entityId: string,
    room: DocumentRoom
  ): Promise<void> {
    // In production, this would be debounced and use OT/CRDT
    // For now, we just log that changes need persistence
    console.log(`Changes pending for ${entityType}:${entityId}, version ${room.version}`);
  }

  private startCleanupInterval(): void {
    // Clean up stale presence and expired locks every minute
    setInterval(() => {
      const now = new Date();
      const staleThreshold = new Date(now.getTime() - 5 * 60 * 1000);

      this.rooms.forEach((room, roomKey) => {
        room.users.forEach((presence, odifiedUserId) => {
          if (presence.lastActivity < staleThreshold) {
            room.users.delete(odifiedUserId);
            this.io.to(roomKey).emit('user-left', { odifiedUserId });
          }
        });
      });

      this.locks.forEach((locks, roomKey) => {
        const expiredLocks = locks.filter(l => l.expiresAt < now);
        expiredLocks.forEach(lock => {
          const index = locks.indexOf(lock);
          if (index >= 0) {
            locks.splice(index, 1);
            this.io.to(roomKey).emit('lock-expired', {
              odifiedUserId: lock.userId,
              field: lock.field
            });
          }
        });
      });
    }, 60000);
  }

  // ==================== PUBLIC API ====================

  /**
   * Send notification to specific user(s)
   */
  sendNotification(userId: string, notification: any): void {
    this.io.to(`user:${userId}`).emit('notification', notification);
  }

  /**
   * Broadcast event to all users in a document room
   */
  broadcastToDocument(
    entityType: string,
    entityId: string,
    event: string,
    data: any
  ): void {
    const roomKey = this.getRoomKey(entityType, entityId);
    this.io.to(roomKey).emit(event, data);
  }

  /**
   * Get online users for a document
   */
  getOnlineUsers(entityType: string, entityId: string): UserPresence[] {
    const roomKey = this.getRoomKey(entityType, entityId);
    const room = this.rooms.get(roomKey);
    return room ? Array.from(room.users.values()) : [];
  }

  /**
   * Force refresh for all clients viewing a document
   */
  forceRefresh(entityType: string, entityId: string): void {
    const roomKey = this.getRoomKey(entityType, entityId);
    this.io.to(roomKey).emit('force-refresh', { entityType, entityId });
  }
}

export default CollaborationManager;
