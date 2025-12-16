import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { MODALITIES, INVENTORY_CATEGORIES, getInventoryCategorySchema, Modality, Method, Experiment, InventoryItem, Stock, Location as InventoryLocation, Attachment, Report } from '@eln/shared';
import { v4 as uuid } from 'uuid';
import { LoginPage, CreateAccountPage, AuthUser } from './components/Auth';
import { FileImporter, AttachmentList } from './components/Attachments';
import { ReportUploader, ReportList } from './components/Reports';
import { SchemaForm } from './components/SchemaForm';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer } from 'recharts';

type NavTab = 'dashboard' | 'methods' | 'experiments' | 'projects' | 'inventory' | 'workflows' | 'labels' | 'analytics' | 'sync' | 'settings' | 'admin';
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
    let cancelled = false;

    const restoreSession = async () => {
      const savedUser = localStorage.getItem('eln-user');
      if (!savedUser) return;

      try {
        const parsed = JSON.parse(savedUser) as AuthUser;
        if (!parsed?.id) {
          localStorage.removeItem('eln-user');
          return;
        }

        // Validate the stored user against the server. This prevents "silent failures"
        // after resetting/initializing the database (stale localStorage user IDs).
        const res = await fetch(`${API_BASE}/api/auth/me`, {
          headers: { 'x-user-id': parsed.id }
        });

        if (!res.ok) {
          localStorage.removeItem('eln-user');
          return;
        }

        const freshUser = (await res.json()) as AuthUser;
        if (cancelled) return;

        localStorage.setItem('eln-user', JSON.stringify(freshUser));
        setUser(freshUser);
        setAuthState('authenticated');
      } catch {
        localStorage.removeItem('eln-user');
      }
    };

    restoreSession().finally(() => {
      if (!cancelled) setLoading(false);
    });

    return () => {
      cancelled = true;
    };
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

      if ([methodsRes, experimentsRes].some(r => r.status === 401 || r.status === 403)) {
        localStorage.removeItem('eln-user');
        setUser(null);
        setAuthState('login');
        setMethods([]);
        setExperiments([]);
        return;
      }

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
          <NavButton icon="📁" label="Projects" active={tab === 'projects'} onClick={() => setTab('projects')} />
          <NavButton icon="📦" label="Inventory" active={tab === 'inventory'} onClick={() => setTab('inventory')} />
          <NavButton icon="⚡" label="Workflows" active={tab === 'workflows'} onClick={() => setTab('workflows')} />
          <NavButton icon="🏷️" label="Labels" active={tab === 'labels'} onClick={() => setTab('labels')} />
          <NavButton icon="📈" label="Analytics" active={tab === 'analytics'} onClick={() => setTab('analytics')} />
          <NavButton icon="🔄" label="Sync" active={tab === 'sync'} onClick={() => setTab('sync')} />
          <div style={styles.navDivider} />
          {(user?.role === 'admin' || user?.role === 'manager') && (
            <NavButton icon="👥" label="Admin" active={tab === 'admin'} onClick={() => setTab('admin')} />
          )}
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
        {tab === 'projects' && <ProjectsPanel user={user!} methods={methods} />}
        {tab === 'inventory' && <InventoryPanel user={user!} />}
        {tab === 'workflows' && <WorkflowsPanel user={user!} />}
        {tab === 'labels' && <LabelsPanel user={user!} />}
        {tab === 'analytics' && <AnalyticsPanel user={user!} />}
        {tab === 'sync' && <SyncPanel />}
        {tab === 'settings' && <SettingsPanel user={user!} />}
        {tab === 'admin' && <AdminPanel user={user!} />}
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
          {selectedExperiment.dataLink && (
            <>
              <h4>Original Data Path(s):</h4>
              <div style={{ background: '#f8fafc', padding: '12px', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
                {selectedExperiment.dataLink.split('\n').map((path, idx) => (
                  <div key={idx} style={{ padding: '4px 0', fontFamily: 'monospace', fontSize: '13px', color: '#334155' }}>
                    📁 {path.trim()}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  if (viewMode === 'edit' && selectedExperiment) {
    return (
      <ExperimentEditForm
        user={user}
        methods={methods}
        experiment={selectedExperiment}
        onClose={handleBack}
        onSaved={() => { handleBack(); onRefresh(); }}
      />
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
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
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

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.error || 'Failed to save experiment');
      }

      onSaved();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save experiment';
      setError(message);
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
        {error && (
          <div style={{ ...styles.alert, ...styles.alertError }}>
            {error}
          </div>
        )}
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

// Experiment Edit Form
function ExperimentEditForm({ user, methods, experiment, onClose, onSaved }: { 
  user: AuthUser; 
  methods: Method[];
  experiment: Experiment;
  onClose: () => void; 
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(experiment.title);
  const [project, setProject] = useState(experiment.project || '');
  const [modality, setModality] = useState<string>(experiment.modality);
  const [protocolRef, setProtocolRef] = useState(experiment.protocolRef || '');
  const [observations, setObservations] = useState(() => {
    if (!experiment.observations) return '';
    if (typeof experiment.observations === 'string') return experiment.observations;
    if (typeof experiment.observations === 'object' && 'text' in (experiment.observations as any)) {
      return (experiment.observations as any).text || '';
    }
    return JSON.stringify(experiment.observations, null, 2);
  });
  const [resultsSummary, setResultsSummary] = useState(experiment.resultsSummary || '');
  const [dataLink, setDataLink] = useState(experiment.dataLink || '');
  const [status, setStatus] = useState<string>(experiment.status || 'draft');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'details' | 'attachments' | 'reports'>('details');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [reports, setReports] = useState<Report[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE}/experiments/${experiment.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': user.id,
        },
        body: JSON.stringify({
          title,
          project: project || null,
          modality: modality || 'molecular_biology',
          protocolRef: protocolRef || null,
          observations: { text: observations },
          resultsSummary: resultsSummary || null,
          dataLink: dataLink || null,
          status,
        }),
      });

      if (response.ok) {
        onSaved();
      } else {
        const data = await response.json();
        setError(data.error || 'Failed to update experiment');
      }
    } catch (err) {
      console.error('Failed to update experiment:', err);
      setError('Failed to update experiment');
    } finally {
      setSaving(false);
    }
  };

  const handleAttachmentAdded = (attachment: Attachment) => {
    setAttachments(prev => [...prev, attachment]);
    setRefreshKey(k => k + 1);
  };

  const handleReportAdded = (report: Report) => {
    setReports(prev => [...prev, report]);
    setRefreshKey(k => k + 1);
  };

  const tabButtonStyle = (isActive: boolean) => ({
    padding: '10px 20px',
    border: 'none',
    borderBottom: isActive ? '3px solid #3b82f6' : '3px solid transparent',
    background: isActive ? '#f0f9ff' : 'transparent',
    color: isActive ? '#1e40af' : '#64748b',
    fontWeight: isActive ? 600 : 400,
    cursor: 'pointer',
    fontSize: '14px',
    transition: 'all 0.2s ease',
  });

  return (
    <div style={styles.panel}>
      <div style={styles.header}>
        <button onClick={onClose} style={styles.secondaryButton}>← Back</button>
        <h2 style={styles.pageTitle}>Edit Experiment: {experiment.title}</h2>
      </div>
      
      {/* Tab Navigation */}
      <div style={{ display: 'flex', borderBottom: '1px solid #e2e8f0', marginBottom: '16px' }}>
        <button 
          style={tabButtonStyle(activeTab === 'details')} 
          onClick={() => setActiveTab('details')}
        >
          📝 Details
        </button>
        <button 
          style={tabButtonStyle(activeTab === 'attachments')} 
          onClick={() => setActiveTab('attachments')}
        >
          📎 Attachments
        </button>
        <button 
          style={tabButtonStyle(activeTab === 'reports')} 
          onClick={() => setActiveTab('reports')}
        >
          📊 Reports & Results
        </button>
      </div>

      <div style={styles.detailCard}>
        {error && (
          <div style={{ padding: '12px', marginBottom: '16px', background: '#fee2e2', color: '#dc2626', borderRadius: '6px' }}>
            {error}
          </div>
        )}

        {/* Details Tab */}
        {activeTab === 'details' && (
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
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
            <div style={styles.formRow}>
              <div style={styles.formField}>
                <label style={styles.formLabel}>Status</label>
                <select value={status} onChange={e => setStatus(e.target.value)} style={styles.formSelect}>
                  <option value="draft">Draft</option>
                  <option value="in_progress">In Progress</option>
                  <option value="completed">Completed</option>
                </select>
              </div>
            </div>
            <div style={styles.formField}>
              <label style={styles.formLabel}>Observations</label>
              <textarea
                value={observations}
                onChange={e => setObservations(e.target.value)}
                style={styles.formTextarea}
                rows={6}
                placeholder="Record your observations..."
              />
            </div>
            <div style={styles.formField}>
              <label style={styles.formLabel}>Results Summary</label>
              <textarea
                value={resultsSummary}
                onChange={e => setResultsSummary(e.target.value)}
                style={styles.formTextarea}
                rows={4}
                placeholder="Summarize your results..."
              />
            </div>
            <div style={styles.formField}>
              <label style={styles.formLabel}>Original Data Path(s)</label>
              <textarea
                value={dataLink}
                onChange={e => setDataLink(e.target.value)}
                style={styles.formTextarea}
                rows={3}
                placeholder="Enter file paths or URLs to original data (one per line)&#10;e.g., //server/share/experiment_data/run001&#10;     C:\Data\FRAP\2025-01-15"
              />
              <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#64748b' }}>
                Enter paths to raw data files, network shares, or URLs. Use one path per line for multiple locations.
              </p>
            </div>
            <div style={styles.formActions}>
              <button type="button" onClick={onClose} style={styles.secondaryButton}>Cancel</button>
              <button type="submit" style={styles.primaryButton} disabled={saving}>
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </form>
        )}

        {/* Attachments Tab */}
        {activeTab === 'attachments' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            <div>
              <h3 style={{ margin: '0 0 12px 0', color: '#1e293b', fontSize: '16px' }}>
                Upload Attachments
              </h3>
              <p style={{ margin: '0 0 16px 0', color: '#64748b', fontSize: '14px' }}>
                Add images, spreadsheets, documents, or other files to this experiment.
              </p>
              <FileImporter
                experimentId={experiment.id}
                userId={user.id}
                onAttachmentAdded={handleAttachmentAdded}
                onError={(err) => setError(err)}
                apiBaseUrl={API_BASE}
              />
            </div>
            <div>
              <h3 style={{ margin: '0 0 12px 0', color: '#1e293b', fontSize: '16px' }}>
                Existing Attachments
              </h3>
              <AttachmentList
                key={`attachments-${refreshKey}`}
                experimentId={experiment.id}
                userId={user.id}
                apiBaseUrl={API_BASE}
              />
            </div>
          </div>
        )}

        {/* Reports Tab */}
        {activeTab === 'reports' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            <div>
              <h3 style={{ margin: '0 0 12px 0', color: '#1e293b', fontSize: '16px' }}>
                Upload Analysis Reports
              </h3>
              <p style={{ margin: '0 0 16px 0', color: '#64748b', fontSize: '14px' }}>
                Add analytical program outputs like FRAP analysis, SPT tracking reports, flow cytometry data, and other results.
              </p>
              <ReportUploader
                experimentId={experiment.id}
                userId={user.id}
                onReportAdded={handleReportAdded}
                onError={(err) => setError(err)}
                apiBaseUrl={API_BASE}
              />
            </div>
            <div>
              <h3 style={{ margin: '0 0 12px 0', color: '#1e293b', fontSize: '16px' }}>
                Existing Reports
              </h3>
              <ReportList
                key={`reports-${refreshKey}`}
                experimentId={experiment.id}
                userId={user.id}
                apiBaseUrl={API_BASE}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Inventory Panel (Placeholder)
function InventoryPanel({ user }: { user: AuthUser }) {
  type StockWithLocation = Stock & { location?: InventoryLocation | null };
  type ItemWithStocks = InventoryItem & { stocks?: StockWithLocation[] };

  const CATEGORY_LABELS: Record<string, string> = {
    reagent: 'Reagents',
    plasmid: 'Plasmids',
    antibody: 'Antibodies',
    primer: 'Primers',
    cell_line: 'Cell lines',
    sample: 'Samples',
    consumable: 'Consumables'
  };

  const formatCategory = useCallback((c: string) => {
    return CATEGORY_LABELS[c] || c;
  }, []);

  const [items, setItems] = useState<ItemWithStocks[]>([]);
  const [locations, setLocations] = useState<InventoryLocation[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<string>('');
  const [message, setMessage] = useState<string | null>(null);

  const [showAddItem, setShowAddItem] = useState(false);
  const [newItemName, setNewItemName] = useState('');
  const [newItemCategory, setNewItemCategory] = useState<string>(INVENTORY_CATEGORIES[0] || 'reagent');
  const [newItemUnit, setNewItemUnit] = useState('');
  const [newItemCatalog, setNewItemCatalog] = useState('');

  const [stockItemId, setStockItemId] = useState<string | null>(null);
  const [stockQuantity, setStockQuantity] = useState('');
  const [stockLocationName, setStockLocationName] = useState('');
  const [stockLot, setStockLot] = useState('');
  const [stockBarcode, setStockBarcode] = useState('');
  const [stockNotes, setStockNotes] = useState('');

  const [accessTable, setAccessTable] = useState('Inventory');
  const [accessMappingJson, setAccessMappingJson] = useState('');

  const headers = useMemo(() => ({ 'x-user-id': user.id, 'Content-Type': 'application/json' }), [user.id]);

  const [detailsItem, setDetailsItem] = useState<ItemWithStocks | null>(null);
  const [detailsProperties, setDetailsProperties] = useState<Record<string, unknown>>({});
  const [detailsSaving, setDetailsSaving] = useState(false);

  const fetchInventory = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    try {
      const params = new URLSearchParams();
      if (category) params.set('category', category);
      if (search.trim()) params.set('search', search.trim());
      const res = await fetch(`${API_BASE}/inventory?${params.toString()}`, { headers: { 'x-user-id': user.id } });
      if (!res.ok) throw new Error('Failed to load inventory');
      const data = await res.json();
      setItems(Array.isArray(data) ? data : []);
    } catch (e: any) {
      setMessage(e?.message || 'Failed to load inventory');
    } finally {
      setLoading(false);
    }
  }, [category, search, headers, user.id]);

  const fetchLocations = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/locations`, { headers: { 'x-user-id': user.id } });
      if (!res.ok) return;
      const data = await res.json();
      setLocations(Array.isArray(data) ? data : []);
    } catch {
      // ignore
    }
  }, [user.id]);

  useEffect(() => {
    fetchInventory();
    fetchLocations();
  }, [fetchInventory, fetchLocations]);

  const totalQuantity = useCallback((item: ItemWithStocks) => {
    const stocks = item.stocks || [];
    return stocks.reduce((sum, s) => sum + (typeof s.quantity === 'number' ? s.quantity : 0), 0);
  }, []);

  const readFileAsBase64 = async (file: File) => {
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.onload = () => {
        const result = String(reader.result || '');
        const comma = result.indexOf(',');
        if (comma === -1) return reject(new Error('Invalid file encoding'));
        resolve(result.slice(comma + 1));
      };
      reader.readAsDataURL(file);
    });
  };

  const uploadInventoryAttachment = useCallback(async (itemId: string, file: File): Promise<string> => {
    const base64 = await readFileAsBase64(file);
    const res = await fetch(`${API_BASE}/inventory/${itemId}/attachments`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        filename: file.name,
        mime: file.type || undefined,
        data: base64
      })
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(payload?.error || 'Attachment upload failed');
    return String(payload?.url || '');
  }, [headers]);

  const saveDetails = useCallback(async () => {
    if (!detailsItem) return;
    setDetailsSaving(true);
    setMessage(null);
    try {
      const res = await fetch(`${API_BASE}/inventory/${detailsItem.id}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ properties: detailsProperties })
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload?.error || 'Failed to update item');
      setDetailsItem(null);
      setDetailsProperties({});
      await fetchInventory();
    } catch (e: any) {
      setMessage(e?.message || 'Failed to update item');
    } finally {
      setDetailsSaving(false);
    }
  }, [detailsItem, detailsProperties, fetchInventory, headers]);

  const handleCreateItem = async () => {
    setMessage(null);
    if (!newItemName.trim()) {
      setMessage('Item name is required');
      return;
    }
    try {
      const body = {
        name: newItemName.trim(),
        category: newItemCategory,
        unit: newItemUnit.trim() || undefined,
        catalogNumber: newItemCatalog.trim() || undefined,
      };
      const res = await fetch(`${API_BASE}/inventory`, { method: 'POST', headers, body: JSON.stringify(body) });
      if (!res.ok) throw new Error('Failed to create item');
      setShowAddItem(false);
      setNewItemName('');
      setNewItemUnit('');
      setNewItemCatalog('');
      await fetchInventory();
    } catch (e: any) {
      setMessage(e?.message || 'Failed to create item');
    }
  };

  const ensureLocationId = async (name: string): Promise<string | undefined> => {
    const trimmed = name.trim();
    if (!trimmed) return undefined;
    const existing = locations.find(l => l.name.toLowerCase() === trimmed.toLowerCase());
    if (existing) return existing.id;
    const res = await fetch(`${API_BASE}/locations`, { method: 'POST', headers, body: JSON.stringify({ name: trimmed }) });
    if (!res.ok) return undefined;
    const created = await res.json();
    await fetchLocations();
    return created?.id;
  };

  const handleAddStock = async () => {
    setMessage(null);
    if (!stockItemId) return;
    const qty = Number(stockQuantity);
    if (!Number.isFinite(qty) || qty <= 0) {
      setMessage('Quantity must be a positive number');
      return;
    }

    try {
      const locationId = await ensureLocationId(stockLocationName);
      const body = {
        itemId: stockItemId,
        quantity: qty,
        locationId,
        lotNumber: stockLot.trim() || undefined,
        barcode: stockBarcode.trim() || undefined,
        notes: stockNotes.trim() || undefined,
      };
      const res = await fetch(`${API_BASE}/stock`, { method: 'POST', headers, body: JSON.stringify(body) });
      if (!res.ok) throw new Error('Failed to create stock');
      setStockItemId(null);
      setStockQuantity('');
      setStockLocationName('');
      setStockLot('');
      setStockBarcode('');
      setStockNotes('');
      await fetchInventory();
    } catch (e: any) {
      setMessage(e?.message || 'Failed to create stock');
    }
  };

  const importCsv = async (file: File) => {
    setMessage(null);
    try {
      const base64 = await readFileAsBase64(file);
      const res = await fetch(`${API_BASE}/inventory/import/csv`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ filename: file.name, data: base64 })
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload?.error || 'CSV import failed');
      setMessage(`Imported CSV: ${payload.itemsCreated} created, ${payload.itemsUpdated} updated, ${payload.stocksCreated} stocks`);
      await fetchInventory();
      await fetchLocations();
    } catch (e: any) {
      setMessage(e?.message || 'CSV import failed');
    }
  };

  const importAccess = async (file: File) => {
    setMessage(null);
    let mapping: any = undefined;
    if (accessMappingJson.trim()) {
      try {
        mapping = JSON.parse(accessMappingJson);
      } catch {
        setMessage('Access mapping JSON is invalid');
        return;
      }
    }
    try {
      const base64 = await readFileAsBase64(file);
      const res = await fetch(`${API_BASE}/inventory/import/access`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ filename: file.name, data: base64, options: { table: accessTable || 'Inventory', mapping } })
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload?.error || 'Access import failed');
      setMessage(`Imported Access: ${payload.itemsCreated} created, ${payload.itemsUpdated} updated, ${payload.stocksCreated} stocks`);
      await fetchInventory();
      await fetchLocations();
    } catch (e: any) {
      setMessage(e?.message || 'Access import failed');
    }
  };

  return (
    <div style={styles.panel}>
      <div style={styles.header}>
        <div>
          <h2 style={styles.pageTitle}>Inventory</h2>
          <p style={styles.pageSubtitle}>Manage items and stock, and import from CSV/Access</p>
          {message && <p style={{ marginTop: 8, color: message.includes('Imported') ? '#10b981' : '#ef4444' }}>{message}</p>}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <label style={{ ...styles.secondaryButton, cursor: 'pointer' }}>
            Import CSV
            <input
              type="file"
              accept=".csv,.tsv,text/csv"
              style={{ display: 'none' }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) importCsv(f);
                e.currentTarget.value = '';
              }}
            />
          </label>
          <label style={{ ...styles.secondaryButton, cursor: 'pointer' }}>
            Import Access
            <input
              type="file"
              accept=".mdb,.accdb"
              style={{ display: 'none' }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) importAccess(f);
                e.currentTarget.value = '';
              }}
            />
          </label>
          <button style={styles.primaryButton} onClick={() => setShowAddItem(v => !v)}>+ Add Item</button>
        </div>
      </div>

      <div style={{ ...styles.section, marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, catalog, manufacturer"
            style={{ ...styles.formInput, width: 320 }}
          />
          <select value={category} onChange={(e) => setCategory(e.target.value)} style={{ ...styles.formSelect, width: 200 }}>
            <option value="">All categories</option>
            {INVENTORY_CATEGORIES.map(c => (
              <option key={c} value={c}>{formatCategory(c)}</option>
            ))}
          </select>
          <button style={styles.secondaryButton} onClick={fetchInventory} disabled={loading}>{loading ? 'Loading…' : 'Refresh'}</button>
        </div>

        <div style={{ marginTop: 12, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ opacity: 0.8 }}>Access table:</span>
            <input value={accessTable} onChange={(e) => setAccessTable(e.target.value)} style={{ ...styles.formInput, width: 220 }} />
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flex: 1, minWidth: 320 }}>
            <span style={{ opacity: 0.8 }}>Mapping (optional JSON):</span>
            <input
              value={accessMappingJson}
              onChange={(e) => setAccessMappingJson(e.target.value)}
              placeholder='{"name":"ItemName","quantity":"Qty","location":"Freezer"}'
              style={{ ...styles.formInput, flex: 1 }}
            />
          </div>
        </div>
      </div>

      {showAddItem && (
        <div style={styles.detailCard}>
          <h3 style={styles.sectionTitle}>New Item</h3>
          <div style={styles.formGrid}>
            <div>
              <label style={styles.formLabel}>Name</label>
              <input value={newItemName} onChange={(e) => setNewItemName(e.target.value)} style={styles.formInput} />
            </div>
            <div>
              <label style={styles.formLabel}>Category</label>
              <select value={newItemCategory} onChange={(e) => setNewItemCategory(e.target.value)} style={styles.formSelect}>
                {INVENTORY_CATEGORIES.map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={styles.formLabel}>Unit</label>
              <input value={newItemUnit} onChange={(e) => setNewItemUnit(e.target.value)} style={styles.formInput} placeholder="ml, mg, vials…" />
            </div>
            <div>
              <label style={styles.formLabel}>Catalog #</label>
              <input value={newItemCatalog} onChange={(e) => setNewItemCatalog(e.target.value)} style={styles.formInput} />
            </div>
          </div>
          <div style={styles.formActions}>
            <button style={styles.secondaryButton} onClick={() => setShowAddItem(false)}>Cancel</button>
            <button style={styles.primaryButton} onClick={handleCreateItem}>Create</button>
          </div>
        </div>
      )}

      {stockItemId && (
        <div style={styles.detailCard}>
          <h3 style={styles.sectionTitle}>Add Stock</h3>
          <div style={styles.formGrid}>
            <div>
              <label style={styles.formLabel}>Quantity</label>
              <input value={stockQuantity} onChange={(e) => setStockQuantity(e.target.value)} style={styles.formInput} placeholder="e.g. 10" />
            </div>
            <div>
              <label style={styles.formLabel}>Location</label>
              <input value={stockLocationName} onChange={(e) => setStockLocationName(e.target.value)} style={styles.formInput} placeholder="Freezer -80 / Shelf A" />
            </div>
            <div>
              <label style={styles.formLabel}>Lot #</label>
              <input value={stockLot} onChange={(e) => setStockLot(e.target.value)} style={styles.formInput} />
            </div>
            <div>
              <label style={styles.formLabel}>Barcode</label>
              <input value={stockBarcode} onChange={(e) => setStockBarcode(e.target.value)} style={styles.formInput} />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={styles.formLabel}>Notes</label>
              <input value={stockNotes} onChange={(e) => setStockNotes(e.target.value)} style={styles.formInput} />
            </div>
          </div>
          <div style={styles.formActions}>
            <button style={styles.secondaryButton} onClick={() => setStockItemId(null)}>Cancel</button>
            <button style={styles.primaryButton} onClick={handleAddStock}>Add</button>
          </div>
        </div>
      )}

      {detailsItem && (
        <div style={styles.detailCard}>
          <h3 style={styles.sectionTitle}>Item Details</h3>
          <p style={{ marginTop: 0, opacity: 0.8 }}>
            {detailsItem.name} • {formatCategory(detailsItem.category)}
          </p>

          <SchemaForm
            schema={getInventoryCategorySchema(detailsItem.category)}
            value={detailsProperties}
            onChange={setDetailsProperties}
            onAttachmentUpload={async (file) => uploadInventoryAttachment(detailsItem.id, file)}
            compact
          />

          <div style={styles.formActions}>
            <button
              style={styles.secondaryButton}
              onClick={() => {
                setDetailsItem(null);
                setDetailsProperties({});
              }}
              disabled={detailsSaving}
            >
              Cancel
            </button>
            <button style={styles.primaryButton} onClick={saveDetails} disabled={detailsSaving}>
              {detailsSaving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      )}

      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>Items</h3>
        {items.length === 0 && !loading && (
          <p style={styles.emptyMessage}>No inventory items yet. Add one, or import a CSV/Access table.</p>
        )}
        {items.map(item => (
          <div key={item.id} style={styles.listItem}>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={styles.listItemTitle}>{item.name}</span>
              <span style={styles.listItemMeta}>
                {formatCategory(item.category)}{item.catalogNumber ? ` • ${item.catalogNumber}` : ''}{item.manufacturer ? ` • ${item.manufacturer}` : ''}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ fontWeight: 600 }}>
                {totalQuantity(item)}{item.unit ? ` ${item.unit}` : ''}
              </span>
              <button
                style={styles.secondaryButton}
                onClick={() => {
                  setDetailsItem(item);
                  setDetailsProperties((item.properties as any) || {});
                }}
              >
                Edit Details
              </button>
              <button style={styles.secondaryButton} onClick={() => setStockItemId(item.id)}>Add Stock</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Workflows Panel
function WorkflowsPanel({ user }: { user: AuthUser }) {
  const [workflows, setWorkflows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState<string | null>(null);

  useEffect(() => {
    fetchWorkflows();
  }, []);

  const fetchWorkflows = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/workflows`, {
        headers: { 'x-user-id': user.id }
      });
      if (res.ok) setWorkflows(await res.json());
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleTrigger = async (id: string) => {
    setProcessing(id);
    try {
      const res = await fetch(`${API_BASE}/api/workflows/${id}/execute`, {
        method: 'POST',
        headers: { 'x-user-id': user.id, 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: { manual: true, triggeredBy: user.id } })
      });
      if (res.ok) {
        alert('Workflow triggered successfully');
      }
    } catch (err) {
      console.error(err);
      alert('Failed to trigger workflow');
    } finally {
      setProcessing(null);
    }
  };

  return (
    <div style={styles.panel}>
      <div style={styles.header}>
        <div>
          <h2 style={styles.pageTitle}>Automation Workflows</h2>
          <p style={styles.pageSubtitle}>Manage event-driven automation sequences</p>
        </div>
        <button style={styles.primaryButton} onClick={() => alert('Workflow Builder coming in v2')}>+ New Workflow</button>
      </div>

      {loading ? (
        <div style={styles.emptyState}><p>Loading workflows...</p></div>
      ) : (
        <div style={{ display: 'grid', gap: '16px' }}>
          {workflows.length === 0 && (
            <div style={styles.emptyState}>
              <p>No workflows defined. Create one to automate your lab tasks.</p>
            </div>
          )}
          {workflows.map(wf => (
            <div key={wf.id} style={{
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: '8px',
              padding: '16px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center'
            }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600 }}>{wf.name}</h3>
                  <span style={{ 
                    fontSize: '11px', 
                    padding: '2px 8px', 
                    borderRadius: '12px',
                    background: wf.enabled ? '#dcfce7' : '#f1f5f9',
                    color: wf.enabled ? '#166534' : '#64748b'
                  }}>
                    {wf.enabled ? 'Active' : 'Disabled'}
                  </span>
                </div>
                <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#64748b' }}>
                  Trigger: <strong>{wf.trigger?.type || 'manual'}</strong> • Steps: {wf.steps?.length || 0}
                </p>
                {wf.description && (
                  <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#475569' }}>{wf.description}</p>
                )}
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button 
                  onClick={() => handleTrigger(wf.id)}
                  disabled={!!processing}
                  style={styles.secondaryButton}
                >
                  {processing === wf.id ? 'Running...' : '▶ Run Now'}
                </button>
                <button style={styles.iconButton}>⚙️</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Labels Panel
function LabelsPanel({ user }: { user: AuthUser }) {
  const [templates, setTemplates] = useState<any[]>([]);
  const [inputText, setInputText] = useState('');
  const [generatedQR, setGeneratedQR] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API_BASE}/api/labels/templates`, { headers: { 'x-user-id': user.id } })
      .then(res => res.json())
      .then(data => setTemplates(Array.isArray(data) ? data : []))
      .catch(console.error);
  }, [user.id]);

  const handleGenerate = async () => {
    if (!inputText) return;
    try {
      const res = await fetch(`${API_BASE}/api/labels/qr`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-id': user.id },
        body: JSON.stringify({ data: inputText, width: 300 })
      });
      if (res.ok) {
        const result = await res.json();
        setGeneratedQR(result.imageDataUrl);
      }
    } catch (error) {
      console.error('Failed to generate QR', error);
    }
  };

  return (
    <div style={styles.panel}>
      <div style={styles.header}>
        <h2 style={styles.pageTitle}>Label Generator</h2>
      </div>

      <div style={{ display: 'flex', gap: '24px' }}>
        <div style={{ flex: 1, maxWidth: '400px' }}>
          <div style={styles.section}>
            <h3 style={styles.sectionTitle}>Quick Generate</h3>
            <div style={styles.formField}>
              <label style={styles.formLabel}>Text / ID to Encode</label>
              <input 
                type="text" 
                value={inputText}
                onChange={e => setInputText(e.target.value)}
                placeholder="e.g. EXP-2025-001"
                style={styles.formInput}
              />
            </div>
            <div style={{ marginTop: '16px' }}>
              <button 
                onClick={handleGenerate} 
                style={styles.primaryButton}
                disabled={!inputText}
              >
                Generate QR Code
              </button>
            </div>
          </div>
          
          <div style={{ ...styles.section, marginTop: '24px' }}>
            <h3 style={styles.sectionTitle}>Templates</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {templates.length === 0 ? (
                 <p style={{ color: '#64748b', fontSize: '13px' }}>No templates found.</p>
              ) : (
                templates.map(t => (
                  <div key={t.id} style={{ 
                    padding: '8px', 
                    border: '1px solid #e2e8f0', 
                    borderRadius: '6px',
                    fontSize: '13px',
                    cursor: 'pointer'
                  }}>
                    <strong>{t.name}</strong> ({t.format})
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        <div style={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'flex-start' }}>
          {generatedQR ? (
            <div style={{ 
              background: 'white', 
              padding: '24px', 
              borderRadius: '12px', 
              boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
              textAlign: 'center'
            }}>
              <img src={generatedQR} alt="Generated QR" style={{ maxWidth: '100%' }} />
              <p style={{ marginTop: '16px', fontWeight: 600, color: '#334155' }}>{inputText}</p>
              <button 
                style={{ ...styles.secondaryButton, marginTop: '16px' }}
                onClick={() => {
                  const link = document.createElement('a');
                  link.download = `qr-${inputText}.png`;
                  link.href = generatedQR;
                  link.click();
                }}
              >
                Download PNG
              </button>
            </div>
          ) : (
            <div style={styles.emptyState}>
              <p>Enter text to generate a preview</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Analytics Panel
function AnalyticsPanel({ user }: { user: AuthUser }) {
  const [metrics, setMetrics] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchMetrics();
  }, []);

  const fetchMetrics = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/analytics/metrics`, {
        headers: { 'x-user-id': user.id }
      });
      if (res.ok) setMetrics(await res.json());
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const chartData = metrics ? [
    { name: 'Experiments', count: metrics.experiments || 0 },
    { name: 'Methods', count: metrics.methods || 0 },
    { name: 'Inventory', count: metrics.inventoryItems || 0 },
    { name: 'Stocks', count: metrics.stocks || 0 }
  ] : [];

  return (
    <div style={styles.panel}>
      <div style={styles.header}>
        <h2 style={styles.pageTitle}>Lab Analytics</h2>
        <button style={styles.secondaryButton} onClick={fetchMetrics}>Refresh</button>
      </div>

      {loading ? (
        <div style={styles.emptyState}><p>Loading analytics...</p></div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          
          {/* Summary Cards */}
          <div style={styles.statsGrid}>
            <StatCard title="Total Experiments" value={metrics?.experiments || 0} icon="🧪" color="#3b82f6" />
            <StatCard title="Inventory Items" value={metrics?.inventoryItems || 0} icon="📦" color="#10b981" />
            <StatCard title="Low Stock Alerts" value={metrics?.lowStockAlerts || 0} icon="⚠️" color="#ef4444" />
            <StatCard title="Signatures" value={metrics?.signatures || 0} icon="✍️" color="#8b5cf6" />
          </div>

          {/* Charts Row */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
            <div style={styles.section}>
              <h3 style={styles.sectionTitle}>Data Overview</h3>
              <div style={{ height: '300px', width: '100%' }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="name" />
                    <YAxis />
                    <RechartsTooltip 
                      contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)' }}
                    />
                    <Bar dataKey="count" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div style={styles.section}>
              <h3 style={styles.sectionTitle}>System Status</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div style={styles.listItem}>
                  <span>Draft Experiments</span>
                  <strong>{metrics?.draftExperiments || 0}</strong>
                </div>
                <div style={styles.listItem}>
                  <span>Active Pools</span>
                  <strong>0</strong>
                </div>
                <div style={styles.listItem}>
                  <span>Users</span>
                  <strong>{metrics?.users || 0}</strong>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
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

// Admin Panel - For viewing all lab members' notebooks
function AdminPanel({ user }: { user: AuthUser }) {
  const [activeTab, setActiveTab] = useState<'users' | 'experiments' | 'methods'>('users');
  const [users, setUsers] = useState<any[]>([]);
  const [allExperiments, setAllExperiments] = useState<any[]>([]);
  const [allMethods, setAllMethods] = useState<any[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadAdminData();
  }, [activeTab]);

  const loadAdminData = async () => {
    setLoading(true);
    try {
      const headers = { 'x-user-id': user.id };
      
      if (activeTab === 'users') {
        const res = await fetch(`${API_BASE}/admin/users`, { headers });
        if (res.ok) setUsers(await res.json());
      } else if (activeTab === 'experiments') {
        const res = await fetch(`${API_BASE}/admin/experiments`, { headers });
        if (res.ok) setAllExperiments(await res.json());
      } else if (activeTab === 'methods') {
        const res = await fetch(`${API_BASE}/admin/methods`, { headers });
        if (res.ok) setAllMethods(await res.json());
      }
    } catch (error) {
      console.error('Failed to load admin data:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadUserExperiments = async (userId: string) => {
    setSelectedUserId(userId);
    try {
      const res = await fetch(`${API_BASE}/admin/users/${userId}/experiments`, {
        headers: { 'x-user-id': user.id }
      });
      if (res.ok) {
        const data = await res.json();
        setAllExperiments(data);
        setActiveTab('experiments');
      }
    } catch (error) {
      console.error('Failed to load user experiments:', error);
    }
  };

  return (
    <div style={styles.panel}>
      <div style={styles.header}>
        <div>
          <h2 style={styles.pageTitle}>Lab Administration</h2>
          <p style={styles.pageSubtitle}>View and manage all lab members' notebooks</p>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '8px', marginBottom: '24px' }}>
        <button
          onClick={() => { setActiveTab('users'); setSelectedUserId(null); }}
          style={activeTab === 'users' ? styles.primaryButton : styles.secondaryButton}
        >
          👥 Lab Members
        </button>
        <button
          onClick={() => { setActiveTab('experiments'); setSelectedUserId(null); }}
          style={activeTab === 'experiments' ? styles.primaryButton : styles.secondaryButton}
        >
          🧪 All Experiments
        </button>
        <button
          onClick={() => { setActiveTab('methods'); setSelectedUserId(null); }}
          style={activeTab === 'methods' ? styles.primaryButton : styles.secondaryButton}
        >
          📋 All Methods
        </button>
      </div>

      {loading ? (
        <div style={styles.emptyState}><p>Loading...</p></div>
      ) : activeTab === 'users' ? (
        <div style={styles.tableContainer}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Name</th>
                <th style={styles.th}>Email</th>
                <th style={styles.th}>Role</th>
                <th style={styles.th}>Experiments</th>
                <th style={styles.th}>Methods</th>
                <th style={styles.th}>Status</th>
                <th style={styles.th}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u: any) => (
                <tr key={u.id} style={styles.tr}>
                  <td style={styles.td}>{u.name}</td>
                  <td style={styles.td}>{u.email || '—'}</td>
                  <td style={styles.td}>
                    <span style={{
                      ...styles.badge,
                      background: u.role === 'admin' ? '#ef444420' : u.role === 'manager' ? '#f59e0b20' : '#3b82f620',
                      color: u.role === 'admin' ? '#ef4444' : u.role === 'manager' ? '#f59e0b' : '#3b82f6'
                    }}>
                      {u.role}
                    </span>
                  </td>
                  <td style={styles.td}>{u._count?.experiments || 0}</td>
                  <td style={styles.td}>{u._count?.methods || 0}</td>
                  <td style={styles.td}>
                    <span style={{ color: u.active ? '#10b981' : '#ef4444' }}>
                      {u.active ? '● Active' : '○ Inactive'}
                    </span>
                  </td>
                  <td style={styles.td}>
                    <button 
                      style={styles.iconButton} 
                      onClick={() => loadUserExperiments(u.id)}
                      title="View Experiments"
                    >
                      📂
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {users.length === 0 && (
            <div style={styles.emptyState}><p>No lab members found.</p></div>
          )}
        </div>
      ) : activeTab === 'experiments' ? (
        <div>
          {selectedUserId && (
            <div style={{ marginBottom: '16px', padding: '12px', background: '#1e293b', borderRadius: '8px' }}>
              <span>Showing experiments for: </span>
              <strong>{users.find(u => u.id === selectedUserId)?.name || selectedUserId}</strong>
              <button 
                onClick={() => { setSelectedUserId(null); loadAdminData(); }} 
                style={{ ...styles.secondaryButton, marginLeft: '16px', padding: '4px 12px' }}
              >
                Show All
              </button>
            </div>
          )}
          <div style={styles.tableContainer}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Title</th>
                  <th style={styles.th}>Owner</th>
                  <th style={styles.th}>Project</th>
                  <th style={styles.th}>Modality</th>
                  <th style={styles.th}>Status</th>
                  <th style={styles.th}>Signatures</th>
                  <th style={styles.th}>Updated</th>
                </tr>
              </thead>
              <tbody>
                {allExperiments.map((e: any) => (
                  <tr key={e.id} style={styles.tr}>
                    <td style={styles.td}>{e.title}</td>
                    <td style={styles.td}>{e.user?.name || '—'}</td>
                    <td style={styles.td}>{e.project || '—'}</td>
                    <td style={styles.td}><span style={styles.badge}>{formatModality(e.modality)}</span></td>
                    <td style={styles.td}><StatusBadge status={e.status || 'draft'} /></td>
                    <td style={styles.td}>{e.signatures?.length || 0}</td>
                    <td style={styles.td}>{new Date(e.updatedAt).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {allExperiments.length === 0 && (
              <div style={styles.emptyState}><p>No experiments found.</p></div>
            )}
          </div>
        </div>
      ) : (
        <div style={styles.tableContainer}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Title</th>
                <th style={styles.th}>Creator</th>
                <th style={styles.th}>Category</th>
                <th style={styles.th}>Version</th>
                <th style={styles.th}>Public</th>
                <th style={styles.th}>Updated</th>
              </tr>
            </thead>
            <tbody>
              {allMethods.map((m: any) => (
                <tr key={m.id} style={styles.tr}>
                  <td style={styles.td}>{m.title}</td>
                  <td style={styles.td}>{m.creator?.name || '—'}</td>
                  <td style={styles.td}>{m.category ? formatModality(m.category) : '—'}</td>
                  <td style={styles.td}>v{m.version}</td>
                  <td style={styles.td}>{m.isPublic ? '✓ Yes' : '✗ No'}</td>
                  <td style={styles.td}>{new Date(m.updatedAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {allMethods.length === 0 && (
            <div style={styles.emptyState}><p>No methods found.</p></div>
          )}
        </div>
      )}
    </div>
  );
}

// Projects Panel - Organize experiments by project
function ProjectsPanel({ user, methods }: { user: AuthUser; methods: Method[] }) {
  const [projects, setProjects] = useState<any[]>([]);
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [projectExperiments, setProjectExperiments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadProjects();
  }, []);

  const loadProjects = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/projects`, {
        headers: { 'x-user-id': user.id }
      });
      if (res.ok) {
        setProjects(await res.json());
      }
    } catch (error) {
      console.error('Failed to load projects:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadProjectExperiments = async (projectName: string) => {
    setSelectedProject(projectName);
    try {
      const res = await fetch(`${API_BASE}/projects/${encodeURIComponent(projectName)}/experiments`, {
        headers: { 'x-user-id': user.id }
      });
      if (res.ok) {
        setProjectExperiments(await res.json());
      }
    } catch (error) {
      console.error('Failed to load project experiments:', error);
    }
  };

  if (loading) {
    return (
      <div style={styles.panel}>
        <div style={styles.emptyState}><p>Loading projects...</p></div>
      </div>
    );
  }

  if (selectedProject) {
    return (
      <div style={styles.panel}>
        <div style={styles.header}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <button onClick={() => setSelectedProject(null)} style={styles.secondaryButton}>
              ← Back to Projects
            </button>
            <div>
              <h2 style={styles.pageTitle}>{selectedProject}</h2>
              <p style={styles.pageSubtitle}>{projectExperiments.length} experiment(s)</p>
            </div>
          </div>
        </div>

        <div style={styles.tableContainer}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Title</th>
                <th style={styles.th}>Owner</th>
                <th style={styles.th}>Modality</th>
                <th style={styles.th}>Status</th>
                <th style={styles.th}>Signatures</th>
                <th style={styles.th}>Updated</th>
              </tr>
            </thead>
            <tbody>
              {projectExperiments.map((e: any) => (
                <tr key={e.id} style={styles.tr}>
                  <td style={styles.td}>{e.title}</td>
                  <td style={styles.td}>{e.user?.name || '—'}</td>
                  <td style={styles.td}><span style={styles.badge}>{formatModality(e.modality)}</span></td>
                  <td style={styles.td}><StatusBadge status={e.status || 'draft'} /></td>
                  <td style={styles.td}>{e.signatures?.length || 0}</td>
                  <td style={styles.td}>{new Date(e.updatedAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {projectExperiments.length === 0 && (
            <div style={styles.emptyState}><p>No experiments in this project.</p></div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div style={styles.panel}>
      <div style={styles.header}>
        <div>
          <h2 style={styles.pageTitle}>Projects</h2>
          <p style={styles.pageSubtitle}>Organize experiments by project</p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '16px' }}>
        {projects.map((project: any) => (
          <div
            key={project.name}
            onClick={() => loadProjectExperiments(project.name)}
            style={{
              background: '#1e293b',
              borderRadius: '12px',
              padding: '20px',
              cursor: 'pointer',
              border: '1px solid #334155',
              transition: 'all 0.2s',
            }}
            onMouseOver={(e) => { e.currentTarget.style.borderColor = '#3b82f6'; e.currentTarget.style.transform = 'translateY(-2px)'; }}
            onMouseOut={(e) => { e.currentTarget.style.borderColor = '#334155'; e.currentTarget.style.transform = 'translateY(0)'; }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
              <h3 style={{ margin: 0, fontSize: '18px', color: '#f8fafc' }}>
                {project.name === 'Unassigned' ? '📥 Unassigned' : `📁 ${project.name}`}
              </h3>
              <span style={{ 
                background: '#3b82f620', 
                color: '#3b82f6', 
                padding: '4px 8px', 
                borderRadius: '12px', 
                fontSize: '12px',
                fontWeight: 600
              }}>
                {project.experimentCount} experiments
              </span>
            </div>
            
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '12px' }}>
              {Object.entries(project.statuses || {}).map(([status, count]) => (
                <span key={status} style={{ fontSize: '11px', color: '#94a3b8' }}>
                  {status}: {count as number}
                </span>
              ))}
            </div>
            
            <div style={{ fontSize: '12px', color: '#64748b' }}>
              Last updated: {new Date(project.lastUpdated).toLocaleDateString()}
            </div>
          </div>
        ))}
      </div>

      {projects.length === 0 && (
        <div style={styles.emptyState}>
          <p>No projects yet. Create experiments with project names to organize them!</p>
        </div>
      )}
    </div>
  );
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
  alert: {
    margin: '16px 24px 0',
    padding: '10px 12px',
    borderRadius: 10,
    fontSize: 13,
    lineHeight: 1.4,
  },
  alertError: {
    background: '#fef2f2',
    border: '1px solid #fecaca',
    color: '#991b1b',
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
  formGrid: {
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
