/**
 * Dashboard Components Index
 * Exports configurable dashboard widgets and layout system
 */

export { Dashboard, DashboardProvider, useDashboard } from './Dashboard';
export { Widget } from './Widget';
export type { 
  DashboardConfig, 
  WidgetConfig, 
  WidgetType, 
  WidgetSize,
  DashboardLayout 
} from './types';
