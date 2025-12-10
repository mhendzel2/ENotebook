export type Role = 'manager' | 'member' | 'admin';

export type Modality =
  | 'fluorescence'
  | 'electron_microscopy'
  | 'biophysical'
  | 'molecular_biology'
  | 'biochemistry'
  | 'flow_cytometry';

export type ExperimentStatus = 'draft' | 'in_progress' | 'completed' | 'signed';

export type InventoryCategory = 
  | 'reagent' 
  | 'plasmid' 
  | 'antibody' 
  | 'primer' 
  | 'cell_line' 
  | 'sample' 
  | 'consumable';

export type StockStatus = 'available' | 'low' | 'empty' | 'expired' | 'disposed';

export type SignatureType = 'author' | 'witness' | 'reviewer' | 'approver';

export type NotificationType = 
  | 'comment' 
  | 'mention' 
  | 'assignment' 
  | 'signature_request' 
  | 'stock_low';

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
  parentMethodId?: string; // For versioning
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
  status: ExperimentStatus;
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
  entityType: 'users' | 'methods' | 'experiments' | 'attachments' | 'inventory' | 'stock';
  entityId: string;
  operation: 'insert' | 'update' | 'delete';
  version?: number;
  oldValue?: unknown;
  newValue?: unknown;
  fieldName?: string;
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

// ==================== INVENTORY TYPES ====================

export interface Location {
  id: string;
  name: string;
  description?: string;
  parentId?: string;
  temperature?: string;
  createdAt: string;
  updatedAt: string;
}

export interface InventoryItem {
  id: string;
  name: string;
  description?: string;
  category: InventoryCategory;
  catalogNumber?: string;
  manufacturer?: string;
  supplier?: string;
  unit?: string;
  properties?: Record<string, unknown>;
  safetyInfo?: string;
  storageConditions?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Stock {
  id: string;
  itemId: string;
  locationId?: string;
  lotNumber?: string;
  quantity: number;
  initialQuantity: number;
  expirationDate?: string;
  receivedDate: string;
  barcode?: string;
  status: StockStatus;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ExperimentStock {
  id: string;
  experimentId: string;
  stockId: string;
  quantityUsed: number;
  usedAt: string;
  notes?: string;
}

// ==================== COMPLIANCE TYPES ====================

export interface Signature {
  id: string;
  userId: string;
  signatureType: SignatureType;
  meaning?: string;
  timestamp: string;
  ipAddress?: string;
  experimentId?: string;
  methodId?: string;
  contentHash: string;
}

// ==================== COLLABORATION TYPES ====================

export interface Comment {
  id: string;
  content: string;
  authorId: string;
  createdAt: string;
  updatedAt: string;
  experimentId?: string;
  methodId?: string;
  parentId?: string;
}

export interface Notification {
  id: string;
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  entityType?: string;
  entityId?: string;
  read: boolean;
  createdAt: string;
}

export const MODALITIES: Modality[] = [
  'fluorescence',
  'electron_microscopy',
  'biophysical',
  'molecular_biology',
  'biochemistry',
  'flow_cytometry'
];

export const INVENTORY_CATEGORIES: InventoryCategory[] = [
  'reagent',
  'plasmid',
  'antibody',
  'primer',
  'cell_line',
  'sample',
  'consumable'
];

export const STOCK_STATUSES: StockStatus[] = [
  'available',
  'low',
  'empty',
  'expired',
  'disposed'
];

export const EXPERIMENT_STATUSES: ExperimentStatus[] = [
  'draft',
  'in_progress',
  'completed',
  'signed'
];

export const SIGNATURE_TYPES: SignatureType[] = [
  'author',
  'witness',
  'reviewer',
  'approver'
];
