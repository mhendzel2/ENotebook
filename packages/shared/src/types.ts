export type Role = 'manager' | 'member' | 'admin';

export type Modality =
  | 'fluorescence'
  | 'electron_microscopy'
  | 'biophysical'
  | 'molecular_biology'
  | 'biochemistry'
  | 'flow_cytometry';

export interface User {
  id: string;
  name: string;
  email?: string;
  role: Role;
  active: boolean;
  createdAt: string;
}

export interface Device {
  id: string;
  userId: string;
  name?: string;
  lastSeenAt?: string;
}

export interface Method {
  id: string;
  title: string;
  category?: string;
  steps: unknown;
  reagents?: unknown;
  attachments?: unknown;
  createdBy?: string;
  version: number;
  updatedAt: string;
  isPublic: boolean;
}

export interface Experiment {
  id: string;
  userId: string;
  title: string;
  project?: string;
  modality: Modality;
  protocolRef?: string;
  params?: Record<string, unknown>;
  observations?: unknown;
  resultsSummary?: string;
  dataLink?: string;
  tags?: string[];
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface Attachment {
  id: string;
  experimentId?: string;
  methodId?: string;
  filename: string;
  mime?: string;
  size?: number;
  blobPath?: string;
  dataLink?: string;
  createdAt: string;
}

export interface SyncState {
  deviceId: string;
  lastPulledAt?: string;
  lastPushedAt?: string;
  status?: string;
  error?: string;
}

export interface ChangeLogEntry {
  id: string;
  deviceId?: string;
  entityType: 'users' | 'methods' | 'experiments' | 'attachments';
  entityId: string;
  operation: 'insert' | 'update' | 'delete';
  version?: number;
  createdAt: string;
}

export interface AuthToken {
  token: string;
  user: User;
}

export interface SyncPayload<T> {
  changes: T[];
  lastSyncedAt?: string;
}

export interface Conflict<T> {
  id: string;
  local: T;
  remote: T;
  fieldConflicts?: string[];
}

export const MODALITIES: Modality[] = [
  'fluorescence',
  'electron_microscopy',
  'biophysical',
  'molecular_biology',
  'biochemistry',
  'flow_cytometry'
];
