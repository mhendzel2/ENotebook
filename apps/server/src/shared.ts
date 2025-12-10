export type Role = 'manager' | 'member' | 'admin';
export type APIPermission =
  | 'read:experiments'
  | 'write:experiments'
  | 'read:methods'
  | 'write:methods'
  | 'read:inventory'
  | 'write:inventory'
  | 'read:attachments'
  | 'write:attachments'
  | 'read:users'
  | 'admin';

export const MODALITIES = [
  'fluorescence',
  'electron_microscopy',
  'biophysical',
  'molecular_biology',
  'biochemistry',
  'flow_cytometry'
] as const;

export const INVENTORY_CATEGORIES = [
  'reagent',
  'plasmid',
  'antibody',
  'primer',
  'cell_line',
  'sample',
  'consumable'
] as const;

export const STOCK_STATUSES = ['available', 'low', 'empty', 'expired', 'disposed'] as const;

export const EXPERIMENT_STATUSES = ['draft', 'in_progress', 'completed', 'signed'] as const;

export const SIGNATURE_TYPES = ['author', 'witness', 'reviewer', 'approver'] as const;

export const API_PERMISSIONS: APIPermission[] = [
  'read:experiments',
  'write:experiments',
  'read:methods',
  'write:methods',
  'read:inventory',
  'write:inventory',
  'read:attachments',
  'write:attachments',
  'read:users',
  'admin'
];
