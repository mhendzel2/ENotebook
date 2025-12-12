import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { MODALITIES, Modality, Method, Experiment } from '@eln/shared';
import { v4 as uuid } from 'uuid';
import { LoginPage, CreateAccountPage, AuthUser } from './components/Auth';

type NavTab = 'dashboard' | 'methods' | 'experiments' | 'inventory' | 'workflows' | 'labels' | 'analytics' | 'sync' | 'settings';
type AuthState = 'login' | 'register' | 'authenticated';

const API_BASE = 'http://localhost:4000';

function App() {
  const [authState, setAuthState] = useState<AuthState>('login');
  const [user, setUser] = useState<AuthUser | null>(null);
  const [tab, setTab] = useState<NavTab>('dashboard');
  const [methods, setMethods] = useState<Method[]>([]);
  const [experiments, setExperiments] = useState<Experiment[]>([]);
  const [loading, setLoading] = useState(true);

  // Check for existing session on mount
  useEffect(() => {
    const savedUser = localStorage.getItem('eln-user');
    if (savedUser) {
      try {
        const parsed = JSON.parse(savedUser);
        setUser(parsed);
        setAuthState('authenticated');
      } catch {
        localStorage.removeItem('eln-user');
      }
    }
    setLoading(false);
  }, []);

  // Fetch data when authenticated
  useEffect(() => {
    if (authState === 'authenticated' && user) {
      fetchData();
    }
  }, [authState, user]);

  const fetchData = async () => {
    if (!user) return;
    
    try {
      const headers = { 'x-user-id': user.id };
      
      const [methodsRes, experimentsRes] = await Promise.all([
        fetch(`${API_BASE}/methods`, { headers }),
        fetch(`${API_BASE}/experiments`, { headers }),
      ]);

      if (methodsRes.ok) {
        const data = await methodsRes.json();
        setMethods(data);
      }
      if (experimentsRes.ok) {
        const data = await experimentsRes.json();
        setExperiments(data);
      }
    } catch (error) {
      console.error('Failed to fetch data:', error);
    }
  };

  const handleLogin = useCallback((loggedInUser: AuthUser) => {
    setUser(loggedInUser);
    setAuthState('authenticated');
  }, []);

  const handleLogout = useCallback(() => {
    localStorage.removeItem('eln-user');
    setUser(null);
    setAuthState('login');
    setMethods([]);
    setExperiments([]);
  }, []);

  if (loading) {
    return (
      <div style={styles.loadingContainer}>
        <div style={styles.spinner} />
        <p>Loading...</p>
      </div>
    );
  }

  // Show login/register pages if not authenticated
  if (authState === 'login') {
    return (
      <LoginPage
        onLogin={handleLogin}
        onCreateAccount={() => setAuthState('register')}
      />
    );
  }

  if (authState === 'register') {
    return (
      <CreateAccountPage
        onBack={() => setAuthState('login')}
        onAccountCreated={handleLogin}
      />
    );
  }

  // Main authenticated app
  return (
    <div style={styles.app}>
      <aside style={styles.sidebar}>
        <div style={styles.logoContainer}>
          <h1 style={styles.logo}>ELN</h1>
          <span style={styles.userBadge}>{user?.name?.charAt(0) || 'U'}</span>
        </div>
        <nav style={styles.nav}>
          <NavButton icon="📊" label="Dashboard" active={tab === 'dashboard'} onClick={() => setTab('dashboard')} />
          <NavButton icon="📋" label="Methods" active={tab === 'methods'} onClick={() => setTab('methods')} />
          <NavButton icon="🧪" label="Experiments" active={tab === 'experiments'} onClick={() => setTab('experiments')} />
          <NavButton icon="📦" label="Inventory" active={tab === 'inventory'} onClick={() => setTab('inventory')} />
          <NavButton icon="⚡" label="Workflows" active={tab === 'workflows'} onClick={() => setTab('workflows')} />
          <NavButton icon="🏷️" label="Labels" active={tab === 'labels'} onClick={() => setTab('labels')} />
          <NavButton icon="📈" label="Analytics" active={tab === 'analytics'} onClick={() => setTab('analytics')} />
          <NavButton icon="🔄" label="Sync" active={tab === 'sync'} onClick={() => setTab('sync')} />
          <div style={styles.navDivider} />
          <NavButton icon="⚙️" label="Settings" active={tab === 'settings'} onClick={() => setTab('settings')} />
        </nav>
        <div style={styles.userSection}>
          <div style={styles.userInfo}>
            <span style={styles.userName}>{user?.name}</span>
            <span style={styles.userRole}>{user?.role}</span>
          </div>
          <button onClick={handleLogout} style={styles.logoutButton}>
            Sign Out
          </button>
        </div>
      </aside>
      <main style={styles.main}>
        {tab === 'dashboard' && <DashboardPanel methods={methods} experiments={experiments} user={user!} onNavigate={setTab} />}
        {tab === 'methods' && <MethodsPanel methods={methods} onRefresh={fetchData} user={user!} />}
        {tab === 'experiments' && <ExperimentsPanel experiments={experiments} methods={methods} onRefresh={fetchData} user={user!} />}
        {tab === 'inventory' && <InventoryPanel user={user!} />}
        {tab === 'workflows' && <WorkflowsPanel user={user!} />}
        {tab === 'labels' && <LabelsPanel user={user!} />}
        {tab === 'analytics' && <AnalyticsPanel user={user!} />}
        {tab === 'sync' && <SyncPanel />}
        {tab === 'settings' && <SettingsPanel user={user!} />}
      </main>
    </div>
  );
}

// Dashboard Panel
function DashboardPanel({ methods, experiments, user, onNavigate }: { methods: Method[]; experiments: Experiment[]; user: AuthUser; onNavigate: (tab: NavTab) => void }) {
  const stats = useMemo(() => ({
    totalMethods: methods.length,
    totalExperiments: experiments.length,
    draftExperiments: experiments.filter(e => e.status === 'draft').length,
    completedExperiments: experiments.filter(e => e.status === 'completed' || e.status === 'signed').length,
  }), [methods, experiments]);

  return (
    <div style={styles.panel}>
      <div style={styles.header}>
        <h2 style={styles.pageTitle}>Welcome back, {user.name}</h2>
        <p style={styles.pageSubtitle}>Here's an overview of your lab notebook</p>
      </div>

      <div style={styles.statsGrid}>
        <StatCard title="Total Methods" value={stats.totalMethods} icon="📋" color="#3b82f6" />
        <StatCard title="Total Experiments" value={stats.totalExperiments} icon="🧪" color="#10b981" />
        <StatCard title="In Progress" value={stats.draftExperiments} icon="⏳" color="#f59e0b" />
        <StatCard title="Completed" value={stats.completedExperiments} icon="✅" color="#8b5cf6" />
      </div>

      <div style={styles.sectionsGrid}>
        <div style={styles.section}>
          <h3 style={styles.sectionTitle}>Recent Experiments</h3>
          {experiments.slice(0, 5).map(exp => (
            <div key={exp.id} style={styles.listItem}>
              <span style={styles.listItemTitle}>{exp.title}</span>
              <span style={styles.listItemMeta}>{formatModality(exp.modality)}</span>
            </div>
          ))}
          {experiments.length === 0 && (
            <p style={styles.emptyMessage}>No experiments yet. Create your first one!</p>
          )}
        </div>

        <div style={styles.section}>
          <h3 style={styles.sectionTitle}>Quick Actions</h3>
          <div style={styles.quickActions}>
            <QuickActionButton icon="➕" label="New Experiment" onClick={() => onNavigate('experiments')} />
            <QuickActionButton icon="📋" label="New Method" onClick={() => onNavigate('methods')} />
            <QuickActionButton icon="📦" label="Add Stock" onClick={() => onNavigate('inventory')} />
            <QuickActionButton icon="📊" label="Run Report" onClick={() => onNavigate('analytics')} />
          </div>
        </div>
      </div>
    </div>
  );
}

// Methods Panel
function MethodsPanel({ methods, onRefresh, user }: { methods: Method[]; onRefresh: () => void; user: AuthUser }) {
  const [showForm, setShowForm] = useState(false);
  const [selectedMethod, setSelectedMethod] = useState<Method | null>(null);
  const [viewMode, setViewMode] = useState<'list' | 'view' | 'edit'>('list');

  const handleView = (method: Method) => {
    setSelectedMethod(method);
    setViewMode('view');
  };

  const handleEdit = (method: Method) => {
    setSelectedMethod(method);
    setViewMode('edit');
  };

  const handleBack = () => {
    setSelectedMethod(null);
    setViewMode('list');
  };

  if (viewMode === 'view' && selectedMethod) {
    return (
      <div style={styles.panel}>
        <div style={styles.header}>
          <button onClick={handleBack} style={styles.secondaryButton}>← Back</button>
          <h2 style={styles.pageTitle}>{selectedMethod.title}</h2>
        </div>
        <div style={styles.detailCard}>
          <p><strong>Category:</strong> {selectedMethod.category || 'N/A'}</p>
          <p><strong>Version:</strong> v{selectedMethod.version}</p>
          <p><strong>Last Updated:</strong> {new Date(selectedMethod.updatedAt).toLocaleString()}</p>
          <h4>Steps:</h4>
          <pre style={styles.codeBlock}>{typeof selectedMethod.steps === 'string' ? selectedMethod.steps : JSON.stringify(selectedMethod.steps, null, 2)}</pre>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.panel}>
      <div style={styles.header}>
        <div>
          <h2 style={styles.pageTitle}>Methods Library</h2>
          <p style={styles.pageSubtitle}>Reusable protocols and procedures</p>
        </div>
        <button onClick={() => setShowForm(true)} style={styles.primaryButton}>
          + New Method
        </button>
      </div>

      {showForm && (
        <MethodForm 
          user={user} 
          onClose={() => setShowForm(false)} 
          onSaved={() => { setShowForm(false); onRefresh(); }} 
        />
      )}

      <div style={styles.tableContainer}>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>Title</th>
              <th style={styles.th}>Category</th>
              <th style={styles.th}>Version</th>
              <th style={styles.th}>Updated</th>
              <th style={styles.th}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {methods.map(m => (
              <tr key={m.id} style={styles.tr}>
                <td style={styles.td}>{m.title}</td>
                <td style={styles.td}><span style={styles.badge}>{m.category}</span></td>
                <td style={styles.td}>v{m.version}</td>
                <td style={styles.td}>{new Date(m.updatedAt).toLocaleDateString()}</td>
                <td style={styles.td}>
                  <button style={styles.iconButton} onClick={() => handleView(m)} title="View">👁️</button>
                  <button style={styles.iconButton} onClick={() => handleEdit(m)} title="Edit">✏️</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {methods.length === 0 && (
          <div style={styles.emptyState}>
            <p>No methods yet. Create your first reusable protocol!</p>
          </div>
        )}
      </div>
    </div>
  );
}

// Method Form
function MethodForm({ user, onClose, onSaved }: { user: AuthUser; onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('');
  const [steps, setSteps] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);

    try {
      const response = await fetch(`${API_BASE}/methods`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': user.id,
        },
        body: JSON.stringify({
          title,
          category,
          steps: { text: steps },
        }),
      });

      if (response.ok) {
        onSaved();
      }
    } catch (error) {
      console.error('Failed to save method:', error);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={styles.formOverlay}>
      <div style={styles.formCard}>
        <div style={styles.formHeader}>
          <h3>New Method</h3>
          <button onClick={onClose} style={styles.closeButton}>×</button>
        </div>
        <form onSubmit={handleSubmit} style={styles.form}>
          <div style={styles.formField}>
            <label style={styles.formLabel}>Title</label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              style={styles.formInput}
              required
            />
          </div>
          <div style={styles.formField}>
            <label style={styles.formLabel}>Category</label>
            <select value={category} onChange={e => setCategory(e.target.value)} style={styles.formSelect}>
              <option value="">Select category</option>
              {MODALITIES.map(m => (
                <option key={m} value={m}>{formatModality(m)}</option>
              ))}
            </select>
          </div>
          <div style={styles.formField}>
            <label style={styles.formLabel}>Steps</label>
            <textarea
              value={steps}
              onChange={e => setSteps(e.target.value)}
              style={styles.formTextarea}
              rows={6}
              placeholder="Describe the protocol steps..."
            />
          </div>
          <div style={styles.formActions}>
            <button type="button" onClick={onClose} style={styles.secondaryButton}>Cancel</button>
            <button type="submit" style={styles.primaryButton} disabled={saving}>
              {saving ? 'Saving...' : 'Save Method'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// Experiments Panel
function ExperimentsPanel({ experiments, methods, onRefresh, user }: { 
  experiments: Experiment[]; 
  methods: Method[];
  onRefresh: () => void;
  user: AuthUser;
}) {
  const [showForm, setShowForm] = useState(false);
  const [selectedExperiment, setSelectedExperiment] = useState<Experiment | null>(null);
  const [viewMode, setViewMode] = useState<'list' | 'view' | 'edit'>('list');
  const methodsMap = useMemo(() => new Map(methods.map(m => [m.id, m])), [methods]);

  const handleView = (experiment: Experiment) => {
    setSelectedExperiment(experiment);
    setViewMode('view');
  };

  const handleEdit = (experiment: Experiment) => {
    setSelectedExperiment(experiment);
    setViewMode('edit');
  };

  const handleBack = () => {
    setSelectedExperiment(null);
    setViewMode('list');
  };

  if (viewMode === 'view' && selectedExperiment) {
    return (
      <div style={styles.panel}>
        <div style={styles.header}>
          <button onClick={handleBack} style={styles.secondaryButton}>← Back</button>
          <h2 style={styles.pageTitle}>{selectedExperiment.title}</h2>
        </div>
        <div style={styles.detailCard}>
          <p><strong>Project:</strong> {selectedExperiment.project || 'N/A'}</p>
          <p><strong>Modality:</strong> {formatModality(selectedExperiment.modality)}</p>
          <p><strong>Status:</strong> {selectedExperiment.status || 'draft'}</p>
          <p><strong>Protocol:</strong> {methodsMap.get(selectedExperiment.protocolRef || '')?.title || 'None'}</p>
          <p><strong>Created:</strong> {new Date(selectedExperiment.createdAt).toLocaleString()}</p>
          <p><strong>Last Updated:</strong> {new Date(selectedExperiment.updatedAt).toLocaleString()}</p>
          <h4>Observations:</h4>
          <pre style={styles.codeBlock}>{typeof selectedExperiment.observations === 'string' ? selectedExperiment.observations : JSON.stringify(selectedExperiment.observations, null, 2)}</pre>
          {selectedExperiment.resultsSummary && (
            <>
              <h4>Results Summary:</h4>
              <p>{selectedExperiment.resultsSummary}</p>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div style={styles.panel}>
      <div style={styles.header}>
        <div>
          <h2 style={styles.pageTitle}>Experiments</h2>
          <p style={styles.pageSubtitle}>Track your research activities</p>
        </div>
        <button onClick={() => setShowForm(true)} style={styles.primaryButton}>
          + New Experiment
        </button>
      </div>

      {showForm && (
        <ExperimentForm 
          user={user}
          methods={methods}
          onClose={() => setShowForm(false)} 
          onSaved={() => { setShowForm(false); onRefresh(); }} 
        />
      )}

      <div style={styles.tableContainer}>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>Title</th>
              <th style={styles.th}>Project</th>
              <th style={styles.th}>Modality</th>
              <th style={styles.th}>Status</th>
              <th style={styles.th}>Protocol</th>
              <th style={styles.th}>Updated</th>
              <th style={styles.th}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {experiments.map(e => (
              <tr key={e.id} style={styles.tr}>
                <td style={styles.td}>{e.title}</td>
                <td style={styles.td}>{e.project || '—'}</td>
                <td style={styles.td}><span style={styles.badge}>{formatModality(e.modality)}</span></td>
                <td style={styles.td}><StatusBadge status={e.status || 'draft'} /></td>
                <td style={styles.td}>{methodsMap.get(e.protocolRef || '')?.title ?? '—'}</td>
                <td style={styles.td}>{new Date(e.updatedAt).toLocaleDateString()}</td>
                <td style={styles.td}>
                  <button style={styles.iconButton} onClick={() => handleView(e)} title="View">👁️</button>
                  <button style={styles.iconButton} onClick={() => handleEdit(e)} title="Edit">✏️</button>
                  <button style={styles.iconButton} onClick={() => alert('Sign feature coming soon!')} title="Sign">✍️</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {experiments.length === 0 && (
          <div style={styles.emptyState}>
            <p>No experiments yet. Start your first experiment!</p>
          </div>
        )}
      </div>
    </div>
  );
}

// Experiment Form
function ExperimentForm({ user, methods, onClose, onSaved }: { 
  user: AuthUser; 
  methods: Method[];
  onClose: () => void; 
  onSaved: () => void;
}) {
  const [title, setTitle] = useState('');
  const [project, setProject] = useState('');
  const [modality, setModality] = useState<string>('');
  const [protocolRef, setProtocolRef] = useState('');
  const [observations, setObservations] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);

    try {
      const response = await fetch(`${API_BASE}/experiments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': user.id,
        },
        body: JSON.stringify({
          title,
          project,
          modality: modality || 'molecular_biology',
          protocolRef: protocolRef || null,
          observations: { text: observations },
          tags: [],
        }),
      });

      if (response.ok) {
        onSaved();
      }
    } catch (error) {
      console.error('Failed to save experiment:', error);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={styles.formOverlay}>
      <div style={styles.formCard}>
        <div style={styles.formHeader}>
          <h3>New Experiment</h3>
          <button onClick={onClose} style={styles.closeButton}>×</button>
        </div>
        <form onSubmit={handleSubmit} style={styles.form}>
          <div style={styles.formRow}>
            <div style={styles.formField}>
              <label style={styles.formLabel}>Title *</label>
              <input
                type="text"
                value={title}
                onChange={e => setTitle(e.target.value)}
                style={styles.formInput}
                required
                placeholder="Experiment title"
              />
            </div>
            <div style={styles.formField}>
              <label style={styles.formLabel}>Project</label>
              <input
                type="text"
                value={project}
                onChange={e => setProject(e.target.value)}
                style={styles.formInput}
                placeholder="Project name"
              />
            </div>
          </div>
          <div style={styles.formRow}>
            <div style={styles.formField}>
              <label style={styles.formLabel}>Modality *</label>
              <select value={modality} onChange={e => setModality(e.target.value)} style={styles.formSelect} required>
                <option value="">Select modality</option>
                {MODALITIES.map(m => (
                  <option key={m} value={m}>{formatModality(m)}</option>
                ))}
              </select>
            </div>
            <div style={styles.formField}>
              <label style={styles.formLabel}>Protocol</label>
              <select value={protocolRef} onChange={e => setProtocolRef(e.target.value)} style={styles.formSelect}>
                <option value="">Select protocol (optional)</option>
                {methods.map(m => (
                  <option key={m.id} value={m.id}>{m.title}</option>
                ))}
              </select>
            </div>
          </div>
          <div style={styles.formField}>
            <label style={styles.formLabel}>Initial Observations</label>
            <textarea
              value={observations}
              onChange={e => setObservations(e.target.value)}
              style={styles.formTextarea}
              rows={4}
              placeholder="Record your initial observations..."
            />
          </div>
          <div style={styles.formActions}>
            <button type="button" onClick={onClose} style={styles.secondaryButton}>Cancel</button>
            <button type="submit" style={styles.primaryButton} disabled={saving}>
              {saving ? 'Creating...' : 'Create Experiment'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// Inventory Panel (Placeholder)
function InventoryPanel({ user }: { user: AuthUser }) {
  return (
    <div style={styles.panel}>
      <div style={styles.header}>
        <div>
          <h2 style={styles.pageTitle}>Inventory</h2>
          <p style={styles.pageSubtitle}>Manage reagents, samples, and equipment</p>
        </div>
        <button style={styles.primaryButton}>+ Add Item</button>
      </div>
      <div style={styles.tabsContainer}>
        <button style={{...styles.tabButton, ...styles.tabButtonActive}}>All Items</button>
        <button style={styles.tabButton}>Reagents</button>
        <button style={styles.tabButton}>Samples</button>
        <button style={styles.tabButton}>Equipment</button>
        <button style={styles.tabButton}>Pools</button>
      </div>
      <div style={styles.emptyState}>
        <p>Inventory management coming soon. Track stocks, locations, and usage.</p>
      </div>
    </div>
  );
}

// Workflows Panel (Placeholder)
function WorkflowsPanel({ user }: { user: AuthUser }) {
  return (
    <div style={styles.panel}>
      <div style={styles.header}>
        <div>
          <h2 style={styles.pageTitle}>Automation Workflows</h2>
          <p style={styles.pageSubtitle}>Create event-driven automation sequences</p>
        </div>
        <button style={styles.primaryButton}>+ New Workflow</button>
      </div>
      <div style={styles.emptyState}>
        <p>Workflow automation engine coming soon. Define triggers and actions.</p>
      </div>
    </div>
  );
}

// Labels Panel (Placeholder)
function LabelsPanel({ user }: { user: AuthUser }) {
  return (
    <div style={styles.panel}>
      <div style={styles.header}>
        <div>
          <h2 style={styles.pageTitle}>Label Generator</h2>
          <p style={styles.pageSubtitle}>Create and print QR codes and barcodes</p>
        </div>
        <button style={styles.primaryButton}>+ New Label</button>
      </div>
      <div style={styles.emptyState}>
        <p>Label generation coming soon. Create barcodes, QR codes, and print labels.</p>
      </div>
    </div>
  );
}

// Analytics Panel (Placeholder)
function AnalyticsPanel({ user }: { user: AuthUser }) {
  return (
    <div style={styles.panel}>
      <div style={styles.header}>
        <div>
          <h2 style={styles.pageTitle}>Analytics Dashboard</h2>
          <p style={styles.pageSubtitle}>Visualize data and run custom queries</p>
        </div>
        <button style={styles.primaryButton}>+ New Chart</button>
      </div>
      <div style={styles.emptyState}>
        <p>Analytics dashboard coming soon. Create charts and run SQL queries.</p>
      </div>
    </div>
  );
}

// Sync Panel
function SyncPanel() {
  return (
    <div style={styles.panel}>
      <div style={styles.header}>
        <h2 style={styles.pageTitle}>Sync Status</h2>
        <p style={styles.pageSubtitle}>Offline-first synchronization</p>
      </div>
      <div style={styles.section}>
        <div style={styles.syncStatus}>
          <span style={styles.syncIcon}>🟢</span>
          <span>All changes synced</span>
        </div>
        <ul style={styles.syncList}>
          <li>Device ID: Local</li>
          <li>Last synced: Just now</li>
          <li>Pending changes: 0</li>
        </ul>
      </div>
    </div>
  );
}

// Settings Panel
function SettingsPanel({ user }: { user: AuthUser }) {
  return (
    <div style={styles.panel}>
      <div style={styles.header}>
        <h2 style={styles.pageTitle}>Settings</h2>
        <p style={styles.pageSubtitle}>Configure your preferences</p>
      </div>
      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>Account</h3>
        <div style={styles.settingRow}>
          <span>Name:</span>
          <span>{user.name}</span>
        </div>
        <div style={styles.settingRow}>
          <span>Email:</span>
          <span>{user.email}</span>
        </div>
        <div style={styles.settingRow}>
          <span>Role:</span>
          <span style={styles.badge}>{user.role}</span>
        </div>
      </div>
    </div>
  );
}

// Helper Components
function NavButton({ icon, label, active, onClick }: { icon: string; label: string; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{ ...styles.navButton, ...(active ? styles.navButtonActive : {}) }}>
      <span style={styles.navIcon}>{icon}</span>
      {label}
    </button>
  );
}

function StatCard({ title, value, icon, color }: { title: string; value: number; icon: string; color: string }) {
  return (
    <div style={styles.statCard}>
      <div style={{ ...styles.statIcon, background: `${color}15`, color }}>{icon}</div>
      <div style={styles.statContent}>
        <div style={styles.statValue}>{value}</div>
        <div style={styles.statLabel}>{title}</div>
      </div>
    </div>
  );
}

function QuickActionButton({ icon, label, onClick }: { icon: string; label: string; onClick?: () => void }) {
  return (
    <button style={styles.quickActionButton} onClick={onClick}>
      <span>{icon}</span>
      <span>{label}</span>
    </button>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    draft: '#f59e0b',
    in_progress: '#3b82f6',
    completed: '#10b981',
    signed: '#8b5cf6',
  };
  return (
    <span style={{ ...styles.statusBadge, background: `${colors[status] || '#94a3b8'}20`, color: colors[status] || '#94a3b8' }}>
      {status.replace('_', ' ')}
    </span>
  );
}

function formatModality(modality: Modality | string) {
  return modality.replace(/_/g, ' ');
}

// Styles
const styles: Record<string, React.CSSProperties> = {
  loadingContainer: {
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    alignItems: 'center',
    minHeight: '100vh',
    background: '#0f172a',
    color: '#fff',
  },
  spinner: {
    width: 40,
    height: 40,
    border: '4px solid rgba(255,255,255,0.3)',
    borderTopColor: '#fff',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite',
  },
  app: {
    display: 'flex',
    minHeight: '100vh',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    background: '#f1f5f9',
    color: '#0f172a',
  },
  sidebar: {
    width: 240,
    padding: '16px 12px',
    background: '#0f172a',
    color: '#e2e8f0',
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  logoContainer: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px 8px 16px',
    borderBottom: '1px solid rgba(255,255,255,0.1)',
    marginBottom: 8,
  },
  logo: {
    margin: 0,
    fontSize: 22,
    fontWeight: 700,
    letterSpacing: 2,
  },
  userBadge: {
    width: 32,
    height: 32,
    borderRadius: '50%',
    background: '#3b82f6',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontWeight: 600,
    fontSize: 14,
  },
  nav: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    flex: 1,
  },
  navButton: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    width: '100%',
    padding: '10px 12px',
    textAlign: 'left',
    background: 'transparent',
    border: 'none',
    color: '#94a3b8',
    borderRadius: 8,
    cursor: 'pointer',
    fontSize: 14,
    fontWeight: 500,
    transition: 'all 0.2s',
  },
  navButtonActive: {
    background: 'rgba(59, 130, 246, 0.2)',
    color: '#fff',
  },
  navIcon: {
    fontSize: 16,
  },
  navDivider: {
    height: 1,
    background: 'rgba(255,255,255,0.1)',
    margin: '8px 0',
  },
  userSection: {
    padding: '12px 8px',
    borderTop: '1px solid rgba(255,255,255,0.1)',
  },
  userInfo: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    marginBottom: 12,
  },
  userName: {
    fontWeight: 600,
    fontSize: 14,
  },
  userRole: {
    fontSize: 12,
    color: '#64748b',
    textTransform: 'capitalize',
  },
  logoutButton: {
    width: '100%',
    padding: '8px 12px',
    background: 'rgba(239, 68, 68, 0.2)',
    border: 'none',
    borderRadius: 6,
    color: '#fca5a5',
    fontSize: 13,
    cursor: 'pointer',
  },
  main: {
    flex: 1,
    padding: 24,
    overflowY: 'auto',
  },
  panel: {
    background: '#fff',
    borderRadius: 12,
    padding: 24,
    boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
    minHeight: 'calc(100vh - 48px)',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 24,
  },
  pageTitle: {
    margin: 0,
    fontSize: 24,
    fontWeight: 600,
    color: '#0f172a',
  },
  pageSubtitle: {
    margin: '4px 0 0',
    fontSize: 14,
    color: '#64748b',
  },
  primaryButton: {
    padding: '10px 20px',
    fontSize: 14,
    fontWeight: 600,
    color: '#fff',
    background: '#3b82f6',
    border: 'none',
    borderRadius: 8,
    cursor: 'pointer',
  },
  secondaryButton: {
    padding: '10px 20px',
    fontSize: 14,
    fontWeight: 500,
    color: '#64748b',
    background: '#f1f5f9',
    border: '1px solid #e2e8f0',
    borderRadius: 8,
    cursor: 'pointer',
  },
  statsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
    gap: 16,
    marginBottom: 24,
  },
  statCard: {
    display: 'flex',
    alignItems: 'center',
    gap: 16,
    padding: 20,
    background: '#f8fafc',
    borderRadius: 12,
    border: '1px solid #e2e8f0',
  },
  statIcon: {
    width: 48,
    height: 48,
    borderRadius: 12,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 20,
  },
  statContent: {},
  statValue: {
    fontSize: 28,
    fontWeight: 700,
    color: '#0f172a',
  },
  statLabel: {
    fontSize: 13,
    color: '#64748b',
  },
  sectionsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
    gap: 24,
  },
  section: {
    background: '#f8fafc',
    borderRadius: 12,
    padding: 20,
    border: '1px solid #e2e8f0',
  },
  sectionTitle: {
    margin: '0 0 16px',
    fontSize: 16,
    fontWeight: 600,
    color: '#0f172a',
  },
  listItem: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '12px 0',
    borderBottom: '1px solid #e2e8f0',
  },
  listItemTitle: {
    fontWeight: 500,
    fontSize: 14,
  },
  listItemMeta: {
    fontSize: 12,
    color: '#64748b',
  },
  quickActions: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, 1fr)',
    gap: 12,
  },
  quickActionButton: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 8,
    padding: 16,
    background: '#fff',
    border: '1px solid #e2e8f0',
    borderRadius: 8,
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: 500,
  },
  emptyMessage: {
    color: '#64748b',
    fontSize: 14,
    fontStyle: 'italic',
  },
  tableContainer: {
    overflowX: 'auto',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
  },
  th: {
    textAlign: 'left',
    padding: '12px 16px',
    borderBottom: '2px solid #e2e8f0',
    fontSize: 13,
    fontWeight: 600,
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  tr: {
    borderBottom: '1px solid #f1f5f9',
  },
  td: {
    padding: '14px 16px',
    fontSize: 14,
  },
  badge: {
    display: 'inline-block',
    padding: '4px 10px',
    background: '#e2e8f0',
    borderRadius: 20,
    fontSize: 12,
    fontWeight: 500,
    textTransform: 'capitalize',
  },
  statusBadge: {
    display: 'inline-block',
    padding: '4px 10px',
    borderRadius: 20,
    fontSize: 12,
    fontWeight: 500,
    textTransform: 'capitalize',
  },
  iconButton: {
    padding: '6px 8px',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontSize: 14,
    opacity: 0.7,
  },
  emptyState: {
    padding: 40,
    textAlign: 'center',
    color: '#64748b',
  },
  formOverlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: 'rgba(0,0,0,0.5)',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000,
  },
  formCard: {
    background: '#fff',
    borderRadius: 16,
    width: '100%',
    maxWidth: 560,
    maxHeight: '90vh',
    overflow: 'auto',
    boxShadow: '0 25px 50px rgba(0,0,0,0.25)',
  },
  formHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '20px 24px',
    borderBottom: '1px solid #e2e8f0',
  },
  closeButton: {
    width: 32,
    height: 32,
    background: '#f1f5f9',
    border: 'none',
    borderRadius: '50%',
    cursor: 'pointer',
    fontSize: 20,
    lineHeight: 1,
  },
  form: {
    padding: 24,
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
  },
  formRow: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 16,
  },
  formField: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  formLabel: {
    fontSize: 14,
    fontWeight: 500,
    color: '#374151',
  },
  formInput: {
    padding: '10px 14px',
    fontSize: 14,
    border: '1px solid #e2e8f0',
    borderRadius: 8,
    outline: 'none',
  },
  formSelect: {
    padding: '10px 14px',
    fontSize: 14,
    border: '1px solid #e2e8f0',
    borderRadius: 8,
    outline: 'none',
    background: '#fff',
  },
  formTextarea: {
    padding: '10px 14px',
    fontSize: 14,
    border: '1px solid #e2e8f0',
    borderRadius: 8,
    outline: 'none',
    resize: 'vertical',
    fontFamily: 'inherit',
  },
  formActions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: 12,
    marginTop: 8,
  },
  tabsContainer: {
    display: 'flex',
    gap: 4,
    marginBottom: 24,
    borderBottom: '1px solid #e2e8f0',
    paddingBottom: 4,
  },
  tabButton: {
    padding: '8px 16px',
    background: 'none',
    border: 'none',
    borderRadius: '8px 8px 0 0',
    cursor: 'pointer',
    fontSize: 14,
    color: '#64748b',
  },
  tabButtonActive: {
    background: '#f1f5f9',
    color: '#0f172a',
    fontWeight: 500,
  },
  syncStatus: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginBottom: 16,
    fontSize: 16,
    fontWeight: 500,
  },
  syncIcon: {
    fontSize: 12,
  },
  syncList: {
    listStyle: 'none',
    padding: 0,
    margin: 0,
  },
  settingRow: {
    display: 'flex',
    justifyContent: 'space-between',
    padding: '12px 0',
    borderBottom: '1px solid #e2e8f0',
  },
  detailCard: {
    background: '#fff',
    padding: 24,
    borderRadius: 12,
    boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
  },
  codeBlock: {
    background: '#f8fafc',
    padding: 16,
    borderRadius: 8,
    overflow: 'auto',
    fontSize: 13,
    fontFamily: 'monospace',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
  },
};

export default App;
