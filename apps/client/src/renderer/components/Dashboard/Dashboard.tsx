/**
 * Dashboard Component
 * Customizable dashboard with configurable widgets
 * 
 * Features:
 * - Role-based default layouts (PI, Manager, Technician)
 * - Drag-and-drop widget arrangement
 * - Resizable widgets
 * - Persistent user preferences
 * - Real-time data refresh
 */

import React, { createContext, useContext, useState, useCallback, useEffect, useMemo } from 'react';
import { Widget } from './Widget';
import type { 
  DashboardConfig, 
  DashboardLayout, 
  WidgetConfig, 
  WidgetPosition,
  DashboardContextValue,
  WidgetType,
  WidgetSize
} from './types';
import { DEFAULT_LAYOUTS } from './types';

// ==================== CONTEXT ====================

const DashboardContext = createContext<DashboardContextValue | null>(null);

export function useDashboard() {
  const context = useContext(DashboardContext);
  if (!context) {
    throw new Error('useDashboard must be used within a DashboardProvider');
  }
  return context;
}

// ==================== PROVIDER ====================

interface DashboardProviderProps {
  children: React.ReactNode;
  userId: string;
  userRole?: string;
  storageKey?: string;
}

export function DashboardProvider({ 
  children, 
  userId, 
  userRole = 'default',
  storageKey = 'eln-dashboard-config'
}: DashboardProviderProps) {
  const [config, setConfig] = useState<DashboardConfig>(() => {
    // Try to load saved config
    try {
      const saved = localStorage.getItem(`${storageKey}-${userId}`);
      if (saved) {
        return JSON.parse(saved);
      }
    } catch (e) {
      console.error('Failed to load dashboard config:', e);
    }
    
    // Use role-based default
    const defaultLayout = DEFAULT_LAYOUTS[userRole] || DEFAULT_LAYOUTS.default;
    return {
      layouts: [defaultLayout],
      activeLayoutId: defaultLayout.id,
      defaultLayoutId: defaultLayout.id,
      userRole
    };
  });
  
  const [isEditing, setIsEditing] = useState(false);

  // Save config on changes
  useEffect(() => {
    try {
      localStorage.setItem(`${storageKey}-${userId}`, JSON.stringify(config));
    } catch (e) {
      console.error('Failed to save dashboard config:', e);
    }
  }, [config, storageKey, userId]);

  const updateConfig = useCallback((updates: Partial<DashboardConfig>) => {
    setConfig(prev => ({ ...prev, ...updates }));
  }, []);

  const currentLayout = useMemo(() => {
    return config.layouts.find(l => l.id === config.activeLayoutId) || config.layouts[0];
  }, [config.layouts, config.activeLayoutId]);

  const addWidget = useCallback((widget: Omit<WidgetConfig, 'id'>) => {
    const newWidget: WidgetConfig = {
      ...widget,
      id: `widget-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    };
    
    setConfig(prev => ({
      ...prev,
      layouts: prev.layouts.map(layout => 
        layout.id === prev.activeLayoutId
          ? { ...layout, widgets: [...layout.widgets, newWidget] }
          : layout
      )
    }));
  }, []);

  const removeWidget = useCallback((widgetId: string) => {
    setConfig(prev => ({
      ...prev,
      layouts: prev.layouts.map(layout => 
        layout.id === prev.activeLayoutId
          ? { ...layout, widgets: layout.widgets.filter(w => w.id !== widgetId) }
          : layout
      )
    }));
  }, []);

  const updateWidget = useCallback((widgetId: string, updates: Partial<WidgetConfig>) => {
    setConfig(prev => ({
      ...prev,
      layouts: prev.layouts.map(layout => 
        layout.id === prev.activeLayoutId
          ? { 
              ...layout, 
              widgets: layout.widgets.map(w => 
                w.id === widgetId ? { ...w, ...updates } : w
              ) 
            }
          : layout
      )
    }));
  }, []);

  const moveWidget = useCallback((widgetId: string, position: WidgetPosition) => {
    updateWidget(widgetId, { position });
  }, [updateWidget]);

  const switchLayout = useCallback((layoutId: string) => {
    setConfig(prev => ({ ...prev, activeLayoutId: layoutId }));
  }, []);

  const createLayout = useCallback((name: string): string => {
    const newId = `layout-${Date.now()}`;
    const newLayout: DashboardLayout = {
      id: newId,
      name,
      columns: currentLayout.columns,
      widgets: [...currentLayout.widgets.map(w => ({ ...w, id: `${w.id}-copy` }))]
    };
    
    setConfig(prev => ({
      ...prev,
      layouts: [...prev.layouts, newLayout],
      activeLayoutId: newId
    }));
    
    return newId;
  }, [currentLayout]);

  const deleteLayout = useCallback((layoutId: string) => {
    if (config.layouts.length <= 1) return; // Can't delete last layout
    
    setConfig(prev => ({
      ...prev,
      layouts: prev.layouts.filter(l => l.id !== layoutId),
      activeLayoutId: prev.activeLayoutId === layoutId 
        ? prev.layouts[0].id 
        : prev.activeLayoutId
    }));
  }, [config.layouts.length]);

  const resetToDefault = useCallback(() => {
    const defaultLayout = DEFAULT_LAYOUTS[userRole] || DEFAULT_LAYOUTS.default;
    setConfig({
      layouts: [defaultLayout],
      activeLayoutId: defaultLayout.id,
      defaultLayoutId: defaultLayout.id,
      userRole
    });
  }, [userRole]);

  const contextValue: DashboardContextValue = {
    config,
    updateConfig,
    addWidget,
    removeWidget,
    updateWidget,
    moveWidget,
    switchLayout,
    createLayout,
    deleteLayout,
    resetToDefault,
    isEditing,
    setIsEditing
  };

  return (
    <DashboardContext.Provider value={contextValue}>
      {children}
    </DashboardContext.Provider>
  );
}

// ==================== MAIN DASHBOARD COMPONENT ====================

interface DashboardProps {
  userId: string;
  onNavigate?: (tab: string, params?: Record<string, unknown>) => void;
}

export function Dashboard({ userId, onNavigate }: DashboardProps) {
  const { 
    config, 
    isEditing, 
    setIsEditing, 
    addWidget,
    removeWidget,
    updateWidget,
    switchLayout,
    createLayout,
    deleteLayout,
    resetToDefault
  } = useDashboard();
  
  const [showAddWidget, setShowAddWidget] = useState(false);
  const [showLayoutMenu, setShowLayoutMenu] = useState(false);
  const [newLayoutName, setNewLayoutName] = useState('');

  const currentLayout = useMemo(() => {
    return config.layouts.find(l => l.id === config.activeLayoutId) || config.layouts[0];
  }, [config.layouts, config.activeLayoutId]);

  const handleAddWidget = (type: WidgetType, title: string, size: WidgetSize = 'medium') => {
    addWidget({ type, title, size, visible: true });
    setShowAddWidget(false);
  };

  const handleCreateLayout = () => {
    if (newLayoutName.trim()) {
      createLayout(newLayoutName.trim());
      setNewLayoutName('');
      setShowLayoutMenu(false);
    }
  };

  // Widget type options for the add menu
  const widgetOptions: { type: WidgetType; title: string; description: string }[] = [
    { type: 'experiments-summary', title: 'Experiments Summary', description: 'Overview of experiment counts by status' },
    { type: 'recent-experiments', title: 'Recent Experiments', description: 'Your most recent experiments' },
    { type: 'experiment-status', title: 'Experiment Status', description: 'Visual breakdown of experiment statuses' },
    { type: 'tasks-upcoming', title: 'Upcoming Tasks', description: 'Tasks due soon' },
    { type: 'tasks-overdue', title: 'Overdue Tasks', description: 'Tasks past their due date' },
    { type: 'inventory-status', title: 'Inventory Overview', description: 'Summary of inventory items' },
    { type: 'inventory-low-stock', title: 'Low Stock Alerts', description: 'Items running low' },
    { type: 'workflow-executions', title: 'Workflow Status', description: 'Recent workflow executions' },
    { type: 'workflow-pending', title: 'Pending Approvals', description: 'Workflows awaiting action' },
    { type: 'activity-feed', title: 'Activity Feed', description: 'Recent lab activity' },
    { type: 'team-presence', title: 'Team Presence', description: 'Who is online' },
    { type: 'quick-actions', title: 'Quick Actions', description: 'Common actions' },
    { type: 'notifications', title: 'Notifications', description: 'Your notifications' },
  ];

  return (
    <div style={styles.dashboard}>
      {/* Dashboard Header */}
      <div style={styles.header}>
        <div style={styles.headerLeft}>
          <h2 style={styles.title}>Dashboard</h2>
          
          {/* Layout Selector */}
          <div style={styles.layoutSelector}>
            <button 
              onClick={() => setShowLayoutMenu(!showLayoutMenu)}
              style={styles.layoutButton}
              aria-haspopup="true"
              aria-expanded={showLayoutMenu}
            >
              {currentLayout.name} ▾
            </button>
            
            {showLayoutMenu && (
              <div style={styles.layoutMenu} role="menu">
                {config.layouts.map(layout => (
                  <button
                    key={layout.id}
                    onClick={() => {
                      switchLayout(layout.id);
                      setShowLayoutMenu(false);
                    }}
                    style={{
                      ...styles.layoutMenuItem,
                      ...(layout.id === config.activeLayoutId ? styles.layoutMenuItemActive : {})
                    }}
                    role="menuitem"
                  >
                    {layout.name}
                    {config.layouts.length > 1 && layout.id !== config.defaultLayoutId && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteLayout(layout.id);
                        }}
                        style={styles.deleteLayoutButton}
                        aria-label={`Delete ${layout.name}`}
                      >
                        ×
                      </button>
                    )}
                  </button>
                ))}
                
                <div style={styles.layoutMenuDivider} />
                
                <div style={styles.newLayoutRow}>
                  <input
                    type="text"
                    placeholder="New layout name..."
                    value={newLayoutName}
                    onChange={e => setNewLayoutName(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleCreateLayout()}
                    style={styles.newLayoutInput}
                  />
                  <button 
                    onClick={handleCreateLayout}
                    style={styles.newLayoutButton}
                    disabled={!newLayoutName.trim()}
                  >
                    +
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
        
        <div style={styles.headerRight}>
          <button
            onClick={() => setIsEditing(!isEditing)}
            style={{
              ...styles.editButton,
              ...(isEditing ? styles.editButtonActive : {})
            }}
            aria-pressed={isEditing}
          >
            {isEditing ? '✓ Done' : '⚙️ Customize'}
          </button>
          
          {isEditing && (
            <>
              <button
                onClick={() => setShowAddWidget(!showAddWidget)}
                style={styles.addWidgetButton}
              >
                + Add Widget
              </button>
              <button
                onClick={resetToDefault}
                style={styles.resetButton}
              >
                Reset
              </button>
            </>
          )}
        </div>
      </div>

      {/* Add Widget Menu */}
      {showAddWidget && (
        <div style={styles.addWidgetMenu}>
          <h4 style={styles.addWidgetTitle}>Add a Widget</h4>
          <div style={styles.addWidgetGrid}>
            {widgetOptions.map(option => (
              <button
                key={option.type}
                onClick={() => handleAddWidget(option.type, option.title)}
                style={styles.addWidgetOption}
              >
                <span style={styles.addWidgetOptionTitle}>{option.title}</span>
                <span style={styles.addWidgetOptionDesc}>{option.description}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Widget Grid */}
      <div 
        style={{
          ...styles.widgetGrid,
          gridTemplateColumns: `repeat(${currentLayout.columns}, 1fr)`
        }}
      >
        {currentLayout.widgets
          .filter(w => w.visible)
          .map(widget => (
            <Widget
              key={widget.id}
              config={widget}
              userId={userId}
              isEditing={isEditing}
              onRemove={() => removeWidget(widget.id)}
              onUpdate={(updates) => updateWidget(widget.id, updates)}
              onNavigate={onNavigate}
            />
          ))}
      </div>

      {/* Empty State */}
      {currentLayout.widgets.filter(w => w.visible).length === 0 && (
        <div style={styles.emptyState}>
          <span style={styles.emptyIcon}>📊</span>
          <p style={styles.emptyText}>Your dashboard is empty</p>
          <button
            onClick={() => setShowAddWidget(true)}
            style={styles.emptyButton}
          >
            Add Your First Widget
          </button>
        </div>
      )}
    </div>
  );
}

// ==================== STYLES ====================

const styles: Record<string, React.CSSProperties> = {
  dashboard: {
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
    padding: 24,
    minHeight: '100%'
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: 16
  },
  headerRight: {
    display: 'flex',
    gap: 8
  },
  title: {
    margin: 0,
    fontSize: 24,
    fontWeight: 600,
    color: '#1e293b'
  },
  layoutSelector: {
    position: 'relative'
  },
  layoutButton: {
    padding: '6px 12px',
    backgroundColor: '#f1f5f9',
    border: '1px solid #e2e8f0',
    borderRadius: 6,
    cursor: 'pointer',
    fontSize: 14,
    color: '#475569'
  },
  layoutMenu: {
    position: 'absolute',
    top: '100%',
    left: 0,
    marginTop: 4,
    minWidth: 200,
    backgroundColor: '#fff',
    border: '1px solid #e2e8f0',
    borderRadius: 8,
    boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
    zIndex: 100,
    overflow: 'hidden'
  },
  layoutMenuItem: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
    padding: '10px 12px',
    backgroundColor: 'transparent',
    border: 'none',
    cursor: 'pointer',
    fontSize: 14,
    color: '#334155',
    textAlign: 'left'
  },
  layoutMenuItemActive: {
    backgroundColor: '#eff6ff',
    color: '#2563eb'
  },
  deleteLayoutButton: {
    width: 20,
    height: 20,
    padding: 0,
    backgroundColor: 'transparent',
    border: 'none',
    borderRadius: 4,
    cursor: 'pointer',
    color: '#94a3b8',
    fontSize: 16
  },
  layoutMenuDivider: {
    height: 1,
    backgroundColor: '#e2e8f0',
    margin: '4px 0'
  },
  newLayoutRow: {
    display: 'flex',
    padding: 8,
    gap: 4
  },
  newLayoutInput: {
    flex: 1,
    padding: '6px 8px',
    border: '1px solid #e2e8f0',
    borderRadius: 4,
    fontSize: 13
  },
  newLayoutButton: {
    width: 28,
    padding: 0,
    backgroundColor: '#2563eb',
    border: 'none',
    borderRadius: 4,
    cursor: 'pointer',
    color: '#fff',
    fontSize: 16
  },
  editButton: {
    padding: '8px 16px',
    backgroundColor: '#f1f5f9',
    border: '1px solid #e2e8f0',
    borderRadius: 6,
    cursor: 'pointer',
    fontSize: 14,
    color: '#475569',
    transition: 'all 0.2s'
  },
  editButtonActive: {
    backgroundColor: '#2563eb',
    borderColor: '#2563eb',
    color: '#fff'
  },
  addWidgetButton: {
    padding: '8px 16px',
    backgroundColor: '#10b981',
    border: 'none',
    borderRadius: 6,
    cursor: 'pointer',
    fontSize: 14,
    color: '#fff'
  },
  resetButton: {
    padding: '8px 16px',
    backgroundColor: 'transparent',
    border: '1px solid #e2e8f0',
    borderRadius: 6,
    cursor: 'pointer',
    fontSize: 14,
    color: '#64748b'
  },
  addWidgetMenu: {
    backgroundColor: '#f8fafc',
    border: '1px solid #e2e8f0',
    borderRadius: 8,
    padding: 16
  },
  addWidgetTitle: {
    margin: '0 0 12px 0',
    fontSize: 16,
    fontWeight: 600,
    color: '#1e293b'
  },
  addWidgetGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
    gap: 8
  },
  addWidgetOption: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    padding: 12,
    backgroundColor: '#fff',
    border: '1px solid #e2e8f0',
    borderRadius: 6,
    cursor: 'pointer',
    textAlign: 'left',
    transition: 'border-color 0.2s'
  },
  addWidgetOptionTitle: {
    fontSize: 14,
    fontWeight: 500,
    color: '#1e293b',
    marginBottom: 4
  },
  addWidgetOptionDesc: {
    fontSize: 12,
    color: '#64748b'
  },
  widgetGrid: {
    display: 'grid',
    gap: 16
  },
  emptyState: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 64,
    backgroundColor: '#f8fafc',
    borderRadius: 12,
    border: '2px dashed #e2e8f0'
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: 16
  },
  emptyText: {
    fontSize: 16,
    color: '#64748b',
    marginBottom: 16
  },
  emptyButton: {
    padding: '10px 20px',
    backgroundColor: '#2563eb',
    border: 'none',
    borderRadius: 6,
    cursor: 'pointer',
    fontSize: 14,
    color: '#fff'
  }
};

export default Dashboard;
