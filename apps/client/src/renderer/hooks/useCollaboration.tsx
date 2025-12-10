/**
 * Real-Time Collaboration Hooks and Components
 * Provides WebSocket-based presence and collaborative editing
 */

import React, { 
  createContext, 
  useContext, 
  useEffect, 
  useState, 
  useCallback, 
  useRef 
} from 'react';
import { io, Socket } from 'socket.io-client';

// ==================== TYPES ====================

export interface UserPresence {
  id: string;
  name: string;
  color: string;
  cursor?: CursorPosition;
  selection?: SelectionRange;
  lastActivity: Date;
}

export interface CursorPosition {
  entityType: 'experiment' | 'method';
  entityId: string;
  field: string;
  position: number;
}

export interface SelectionRange {
  entityType: 'experiment' | 'method';
  entityId: string;
  field: string;
  start: number;
  end: number;
}

export interface Lock {
  userId: string;
  userName: string;
  field?: string;
  exclusive: boolean;
  acquiredAt: Date;
  expiresAt: Date;
}

export interface CollaborationState {
  connected: boolean;
  users: UserPresence[];
  locks: Lock[];
  version: number;
}

// ==================== SOCKET CONTEXT ====================

interface SocketContextValue {
  socket: Socket | null;
  connected: boolean;
  userId: string | null;
}

const SocketContext = createContext<SocketContextValue>({
  socket: null,
  connected: false,
  userId: null,
});

export function SocketProvider({ 
  children, 
  serverUrl, 
  userId 
}: { 
  children: React.ReactNode; 
  serverUrl: string;
  userId: string;
}) {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const newSocket = io(serverUrl, {
      auth: { userId },
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
    });

    newSocket.on('connect', () => {
      console.log('WebSocket connected');
      setConnected(true);
    });

    newSocket.on('disconnect', () => {
      console.log('WebSocket disconnected');
      setConnected(false);
    });

    newSocket.on('connect_error', (error) => {
      console.error('WebSocket connection error:', error);
      setConnected(false);
    });

    setSocket(newSocket);

    return () => {
      newSocket.close();
    };
  }, [serverUrl, userId]);

  return (
    <SocketContext.Provider value={{ socket, connected, userId }}>
      {children}
    </SocketContext.Provider>
  );
}

export function useSocket() {
  return useContext(SocketContext);
}

// ==================== COLLABORATION HOOK ====================

export function useCollaboration(
  entityType: 'experiment' | 'method',
  entityId: string
) {
  const { socket, connected, userId } = useSocket();
  const [state, setState] = useState<CollaborationState>({
    connected: false,
    users: [],
    locks: [],
    version: 0,
  });

  // Join document room
  useEffect(() => {
    if (!socket || !connected || !entityId) return;

    socket.emit('join-document', { entityType, entityId });

    // Handle room state
    socket.on('document-state', (data: { users: UserPresence[]; version: number; locks: Lock[] }) => {
      setState(prev => ({
        ...prev,
        connected: true,
        users: data.users,
        version: data.version,
        locks: data.locks,
      }));
    });

    // Handle user events
    socket.on('user-joined', (user: UserPresence) => {
      setState(prev => ({
        ...prev,
        users: [...prev.users.filter(u => u.id !== user.id), user],
      }));
    });

    socket.on('user-left', (data: { odifiedUserId: string }) => {
      setState(prev => ({
        ...prev,
        users: prev.users.filter(u => u.id !== data.odifiedUserId),
      }));
    });

    // Handle cursor/selection updates
    socket.on('cursor-update', (data: { odifiedUserId: string; cursor: CursorPosition }) => {
      setState(prev => ({
        ...prev,
        users: prev.users.map(u => 
          u.id === data.odifiedUserId ? { ...u, cursor: data.cursor } : u
        ),
      }));
    });

    socket.on('selection-update', (data: { odifiedUserId: string; selection: SelectionRange }) => {
      setState(prev => ({
        ...prev,
        users: prev.users.map(u => 
          u.id === data.odifiedUserId ? { ...u, selection: data.selection } : u
        ),
      }));
    });

    // Handle lock events
    socket.on('lock-acquired', (data: { odifiedUserId: string; userName: string; lock: Lock }) => {
      setState(prev => ({
        ...prev,
        locks: [...prev.locks, data.lock],
      }));
    });

    socket.on('lock-released', (data: { odifiedUserId: string; field?: string }) => {
      setState(prev => ({
        ...prev,
        locks: prev.locks.filter(l => !(l.userId === data.odifiedUserId && l.field === data.field)),
      }));
    });

    socket.on('lock-expired', (data: { odifiedUserId: string; field?: string }) => {
      setState(prev => ({
        ...prev,
        locks: prev.locks.filter(l => !(l.userId === data.odifiedUserId && l.field === data.field)),
      }));
    });

    // Handle errors
    socket.on('error', (error: { message: string }) => {
      console.error('Collaboration error:', error.message);
    });

    // Handle force refresh
    socket.on('force-refresh', () => {
      window.location.reload();
    });

    return () => {
      socket.emit('leave-document', { entityType, entityId });
      socket.off('document-state');
      socket.off('user-joined');
      socket.off('user-left');
      socket.off('cursor-update');
      socket.off('selection-update');
      socket.off('lock-acquired');
      socket.off('lock-released');
      socket.off('lock-expired');
      socket.off('error');
      socket.off('force-refresh');
    };
  }, [socket, connected, entityType, entityId]);

  // Update cursor position
  const updateCursor = useCallback((field: string, position: number) => {
    if (!socket || !connected) return;
    
    socket.emit('cursor-move', {
      entityType,
      entityId,
      field,
      position,
    });
  }, [socket, connected, entityType, entityId]);

  // Update selection
  const updateSelection = useCallback((field: string, start: number, end: number) => {
    if (!socket || !connected) return;
    
    socket.emit('selection-change', {
      entityType,
      entityId,
      field,
      start,
      end,
    });
  }, [socket, connected, entityType, entityId]);

  // Request lock
  const requestLock = useCallback((field?: string, exclusive = false): Promise<boolean> => {
    return new Promise((resolve) => {
      if (!socket || !connected) {
        resolve(false);
        return;
      }

      const handleGranted = () => {
        socket.off('lock-granted', handleGranted);
        socket.off('lock-denied', handleDenied);
        resolve(true);
      };

      const handleDenied = () => {
        socket.off('lock-granted', handleGranted);
        socket.off('lock-denied', handleDenied);
        resolve(false);
      };

      socket.on('lock-granted', handleGranted);
      socket.on('lock-denied', handleDenied);

      socket.emit('request-lock', {
        entityType,
        entityId,
        field,
        exclusive,
      });

      // Timeout after 5 seconds
      setTimeout(() => {
        socket.off('lock-granted', handleGranted);
        socket.off('lock-denied', handleDenied);
        resolve(false);
      }, 5000);
    });
  }, [socket, connected, entityType, entityId]);

  // Release lock
  const releaseLock = useCallback((field?: string) => {
    if (!socket || !connected) return;
    
    socket.emit('release-lock', {
      entityType,
      entityId,
      field,
    });
  }, [socket, connected, entityType, entityId]);

  // Send edit operation
  const sendEdit = useCallback((field: string, operation: any) => {
    if (!socket || !connected) return;
    
    socket.emit('edit', {
      entityType,
      entityId,
      field,
      operation,
    });
  }, [socket, connected, entityType, entityId]);

  // Check if field is locked by another user
  const isFieldLocked = useCallback((field: string): Lock | null => {
    const lock = state.locks.find(l => l.field === field && l.userId !== userId);
    return lock || null;
  }, [state.locks, userId]);

  // Get other users' cursors for a field
  const getFieldCursors = useCallback((field: string): UserPresence[] => {
    return state.users.filter(u => u.id !== userId && u.cursor?.field === field);
  }, [state.users, userId]);

  return {
    ...state,
    updateCursor,
    updateSelection,
    requestLock,
    releaseLock,
    sendEdit,
    isFieldLocked,
    getFieldCursors,
  };
}

// ==================== COMPONENTS ====================

/**
 * Presence indicator showing online collaborators
 */
export function PresenceIndicator({ users }: { users: UserPresence[] }) {
  if (users.length === 0) return null;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
      <span style={{ fontSize: '12px', color: '#666' }}>
        {users.length} online:
      </span>
      <div style={{ display: 'flex', marginLeft: '8px' }}>
        {users.slice(0, 5).map((user, index) => (
          <div
            key={user.id}
            style={{
              width: '28px',
              height: '28px',
              borderRadius: '50%',
              backgroundColor: user.color,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#fff',
              fontSize: '12px',
              fontWeight: 'bold',
              marginLeft: index > 0 ? '-8px' : '0',
              border: '2px solid #fff',
              cursor: 'pointer',
            }}
            title={user.name}
          >
            {user.name.charAt(0).toUpperCase()}
          </div>
        ))}
        {users.length > 5 && (
          <div
            style={{
              width: '28px',
              height: '28px',
              borderRadius: '50%',
              backgroundColor: '#999',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#fff',
              fontSize: '10px',
              marginLeft: '-8px',
              border: '2px solid #fff',
            }}
          >
            +{users.length - 5}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Cursor overlay showing other users' positions
 */
export function RemoteCursors({ 
  users, 
  containerRef 
}: { 
  users: UserPresence[];
  containerRef: React.RefObject<HTMLElement>;
}) {
  return (
    <>
      {users.map(user => user.cursor && (
        <div
          key={user.id}
          style={{
            position: 'absolute',
            pointerEvents: 'none',
            zIndex: 1000,
          }}
        >
          <div
            style={{
              width: '2px',
              height: '20px',
              backgroundColor: user.color,
            }}
          />
          <div
            style={{
              backgroundColor: user.color,
              color: '#fff',
              fontSize: '10px',
              padding: '2px 4px',
              borderRadius: '2px',
              whiteSpace: 'nowrap',
            }}
          >
            {user.name}
          </div>
        </div>
      ))}
    </>
  );
}

/**
 * Lock indicator for fields
 */
export function LockIndicator({ lock }: { lock: Lock | null }) {
  if (!lock) return null;

  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        padding: '2px 8px',
        backgroundColor: '#fff3cd',
        border: '1px solid #ffc107',
        borderRadius: '4px',
        fontSize: '12px',
      }}
    >
      <span>🔒</span>
      <span>Editing: {lock.userName}</span>
    </div>
  );
}

/**
 * Connection status indicator
 */
export function ConnectionStatus({ connected }: { connected: boolean }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        padding: '4px 8px',
        backgroundColor: connected ? '#d4edda' : '#f8d7da',
        borderRadius: '4px',
        fontSize: '12px',
      }}
    >
      <div
        style={{
          width: '8px',
          height: '8px',
          borderRadius: '50%',
          backgroundColor: connected ? '#28a745' : '#dc3545',
        }}
      />
      <span>{connected ? 'Connected' : 'Offline'}</span>
    </div>
  );
}

/**
 * Collaborative text input with presence awareness
 */
export function CollaborativeInput({
  value,
  onChange,
  field,
  entityType,
  entityId,
  ...props
}: {
  value: string;
  onChange: (value: string) => void;
  field: string;
  entityType: 'experiment' | 'method';
  entityId: string;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'>) {
  const inputRef = useRef<HTMLInputElement>(null);
  const {
    users,
    locks,
    updateCursor,
    requestLock,
    releaseLock,
    isFieldLocked,
    getFieldCursors,
  } = useCollaboration(entityType, entityId);

  const lock = isFieldLocked(field);
  const cursors = getFieldCursors(field);

  const handleFocus = async () => {
    await requestLock(field);
  };

  const handleBlur = () => {
    releaseLock(field);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (lock) return;
    onChange(e.target.value);
  };

  const handleSelect = () => {
    if (inputRef.current) {
      updateCursor(field, inputRef.current.selectionStart || 0);
    }
  };

  return (
    <div style={{ position: 'relative' }}>
      <input
        ref={inputRef}
        value={value}
        onChange={handleChange}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onSelect={handleSelect}
        disabled={!!lock}
        style={{
          borderColor: lock ? '#ffc107' : undefined,
          backgroundColor: lock ? '#fffbea' : undefined,
        }}
        {...props}
      />
      {lock && (
        <div style={{ position: 'absolute', top: '-20px', right: '0' }}>
          <LockIndicator lock={lock} />
        </div>
      )}
      {cursors.map(user => (
        <div
          key={user.id}
          style={{
            position: 'absolute',
            top: '100%',
            left: '0',
            fontSize: '10px',
            backgroundColor: user.color,
            color: '#fff',
            padding: '1px 4px',
            borderRadius: '2px',
          }}
        >
          {user.name}
        </div>
      ))}
    </div>
  );
}

// ==================== NOTIFICATIONS HOOK ====================

export function useNotifications() {
  const { socket, connected, userId } = useSocket();
  const [notifications, setNotifications] = useState<any[]>([]);

  useEffect(() => {
    if (!socket || !connected) return;

    socket.emit('subscribe-notifications');

    socket.on('notification', (notification: any) => {
      setNotifications(prev => [notification, ...prev]);
    });

    return () => {
      socket.off('notification');
    };
  }, [socket, connected]);

  const clearNotification = useCallback((id: string) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
  }, []);

  return { notifications, clearNotification };
}

export default {
  SocketProvider,
  useSocket,
  useCollaboration,
  useNotifications,
  PresenceIndicator,
  RemoteCursors,
  LockIndicator,
  ConnectionStatus,
  CollaborativeInput,
};
