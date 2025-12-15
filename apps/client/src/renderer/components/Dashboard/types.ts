/**
 * Dashboard Types
 * Type definitions for the customizable dashboard system
 */

export type WidgetType = 
  | 'experiments-summary'
  | 'recent-experiments'
  | 'experiment-status'
  | 'tasks-upcoming'
  | 'tasks-overdue'
  | 'inventory-status'
  | 'inventory-low-stock'
  | 'workflow-executions'
  | 'workflow-pending'
  | 'activity-feed'
  | 'team-presence'
  | 'quick-actions'
  | 'chart'
  | 'notifications'
  | 'custom';

export type WidgetSize = 'small' | 'medium' | 'large' | 'full';

export interface WidgetPosition {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WidgetConfig {
  id: string;
  type: WidgetType;
  title: string;
  size: WidgetSize;
  position?: WidgetPosition;
  settings?: Record<string, unknown>;
  refreshInterval?: number; // in seconds
  visible: boolean;
}

export interface DashboardLayout {
  id: string;
  name: string;
  columns: number;
  widgets: WidgetConfig[];
}

export interface DashboardConfig {
  layouts: DashboardLayout[];
  activeLayoutId: string;
  defaultLayoutId: string;
  userRole?: string;
}

// Role-based default layouts
export const DEFAULT_LAYOUTS: Record<string, DashboardLayout> = {
  pi: {
    id: 'pi-default',
    name: 'Principal Investigator',
    columns: 3,
    widgets: [
      { id: 'w1', type: 'experiments-summary', title: 'Experiments Overview', size: 'large', visible: true },
      { id: 'w2', type: 'team-presence', title: 'Team Activity', size: 'medium', visible: true },
      { id: 'w3', type: 'workflow-pending', title: 'Awaiting Approval', size: 'medium', visible: true },
      { id: 'w4', type: 'chart', title: 'Progress Chart', size: 'large', visible: true, settings: { chartType: 'line', metric: 'experiments-completed' } },
      { id: 'w5', type: 'notifications', title: 'Notifications', size: 'small', visible: true },
    ]
  },
  manager: {
    id: 'manager-default',
    name: 'Lab Manager',
    columns: 3,
    widgets: [
      { id: 'w1', type: 'inventory-status', title: 'Inventory Overview', size: 'large', visible: true },
      { id: 'w2', type: 'inventory-low-stock', title: 'Low Stock Alerts', size: 'medium', visible: true },
      { id: 'w3', type: 'workflow-executions', title: 'Workflow Status', size: 'medium', visible: true },
      { id: 'w4', type: 'tasks-upcoming', title: 'Upcoming Tasks', size: 'medium', visible: true },
      { id: 'w5', type: 'activity-feed', title: 'Recent Activity', size: 'medium', visible: true },
      { id: 'w6', type: 'quick-actions', title: 'Quick Actions', size: 'small', visible: true },
    ]
  },
  technician: {
    id: 'technician-default',
    name: 'Lab Technician',
    columns: 2,
    widgets: [
      { id: 'w1', type: 'tasks-upcoming', title: 'My Tasks', size: 'large', visible: true },
      { id: 'w2', type: 'recent-experiments', title: 'My Recent Experiments', size: 'medium', visible: true },
      { id: 'w3', type: 'inventory-low-stock', title: 'Stock Alerts', size: 'small', visible: true },
      { id: 'w4', type: 'quick-actions', title: 'Quick Actions', size: 'small', visible: true },
      { id: 'w5', type: 'notifications', title: 'Notifications', size: 'medium', visible: true },
    ]
  },
  default: {
    id: 'default',
    name: 'Default Dashboard',
    columns: 2,
    widgets: [
      { id: 'w1', type: 'experiments-summary', title: 'Experiments', size: 'medium', visible: true },
      { id: 'w2', type: 'recent-experiments', title: 'Recent Work', size: 'medium', visible: true },
      { id: 'w3', type: 'tasks-upcoming', title: 'Tasks', size: 'medium', visible: true },
      { id: 'w4', type: 'notifications', title: 'Notifications', size: 'small', visible: true },
    ]
  }
};

export interface WidgetData {
  loading: boolean;
  error?: string;
  data?: unknown;
  lastUpdated?: Date;
}

export interface DashboardContextValue {
  config: DashboardConfig;
  updateConfig: (config: Partial<DashboardConfig>) => void;
  addWidget: (widget: Omit<WidgetConfig, 'id'>) => void;
  removeWidget: (widgetId: string) => void;
  updateWidget: (widgetId: string, updates: Partial<WidgetConfig>) => void;
  moveWidget: (widgetId: string, position: WidgetPosition) => void;
  switchLayout: (layoutId: string) => void;
  createLayout: (name: string) => string;
  deleteLayout: (layoutId: string) => void;
  resetToDefault: () => void;
  isEditing: boolean;
  setIsEditing: (editing: boolean) => void;
}
