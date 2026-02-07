import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { MODALITIES, INVENTORY_CATEGORIES, getInventoryCategorySchema, Modality, Method, Experiment, InventoryItem, Stock, Location as InventoryLocation, Attachment, Report } from '@eln/shared';
import { v4 as uuid } from 'uuid';
import { LoginPage, CreateAccountPage, AuthUser } from './components/Auth';
import { FileImporter, AttachmentList } from './components/Attachments';
import { ReportUploader, ReportList } from './components/Reports';
import { SchemaForm } from './components/SchemaForm';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer } from 'recharts';

type NavTab = 'dashboard' | 'methods' | 'experiments' | 'projects' | 'inventory' | 'workflows' | 'labels' | 'calculators' | 'troubleshooting' | 'analytics' | 'sync' | 'settings' | 'admin';
type AuthState = 'login' | 'register' | 'authenticated';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:4000';

function isLikelyDatasetLocation(value: string): boolean {
  const location = value.trim();
  if (!location) return false;
  if (/^(https?:\/\/|s3:\/\/|smb:\/\/)/i.test(location)) return true;
  if (location.startsWith('\\\\') || location.startsWith('//')) return true;
  if (/^[a-zA-Z]:\\/.test(location)) return true;
  if (location.startsWith('/')) return true;
  return false;
}

function App() {
  const [authState, setAuthState] = useState<AuthState>('login');
  const [user, setUser] = useState<AuthUser | null>(null);
  const [sessionCandidate, setSessionCandidate] = useState<AuthUser | null>(null);
  const [tab, setTab] = useState<NavTab>('dashboard');
  const [methods, setMethods] = useState<Method[]>([]);
  const [experiments, setExperiments] = useState<Experiment[]>([]);
  const [loading, setLoading] = useState(true);

  // Check for existing session on mount
  useEffect(() => {
    let cancelled = false;

    const restoreSession = async () => {
      try {
        // Validate cookie-backed session and fetch the current user.
        const res = await fetch(`${API_BASE}/api/auth/me`);

        if (!res.ok) {
          localStorage.removeItem('eln-user');
          return;
        }

        const freshUser = (await res.json()) as AuthUser;
        if (cancelled) return;

        localStorage.setItem('eln-user', JSON.stringify(freshUser));
        // Shared-PC friendly: don't immediately enter the app. Offer
        // "Continue as <user>" or "Use different account" on the login screen.
        setSessionCandidate(freshUser);
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
    setSessionCandidate(null);
    setUser(loggedInUser);
    setAuthState('authenticated');
  }, []);

  const handleLogout = useCallback(async () => {
    try {
      await fetch(`${API_BASE}/api/auth/logout`, {
        method: 'POST',
        headers: user?.id ? { 'x-user-id': user.id } : undefined,
      });
    } catch {
      // Ignore network/server errors; logout should still clear local session.
    } finally {
      localStorage.removeItem('eln-user');
      setSessionCandidate(null);
      setUser(null);
      setAuthState('login');
      setTab('dashboard');
      setMethods([]);
      setExperiments([]);
    }
  }, [user?.id]);

  const handleContinueAsCandidate = useCallback(() => {
    if (!sessionCandidate) return;
    setUser(sessionCandidate);
    setAuthState('authenticated');
  }, [sessionCandidate]);

  const handleSwitchUser = useCallback(async () => {
    try {
      await fetch(`${API_BASE}/api/auth/logout`, { method: 'POST' });
    } catch {
      // ignore
    } finally {
      localStorage.removeItem('eln-user');
      setSessionCandidate(null);
    }
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
        existingUser={sessionCandidate || undefined}
        onContinueExistingUser={handleContinueAsCandidate}
        onSwitchUser={handleSwitchUser}
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
          <NavButton icon="🧮" label="Calculators" active={tab === 'calculators'} onClick={() => setTab('calculators')} />
          <NavButton icon="�" label="Troubleshooting" active={tab === 'troubleshooting'} onClick={() => setTab('troubleshooting')} />
          <NavButton icon="�📈" label="Analytics" active={tab === 'analytics'} onClick={() => setTab('analytics')} />
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
        {tab === 'calculators' && <CalculatorsPanel />}
        {tab === 'troubleshooting' && <TroubleshootingPanel user={user!} />}
        {tab === 'analytics' && <AnalyticsPanel user={user!} />}
        {tab === 'sync' && <SyncPanel user={user!} />}
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
  const [editingMethod, setEditingMethod] = useState<Method | null>(null);
  const [selectedMethod, setSelectedMethod] = useState<Method | null>(null);
  const [viewMode, setViewMode] = useState<'list' | 'view'>('list');

  const stepsToText = (stepsValue: unknown): string => {
    if (typeof stepsValue === 'string') return stepsValue;
    if (stepsValue && typeof stepsValue === 'object') {
      const asAny = stepsValue as any;
      if (typeof asAny.text === 'string') return asAny.text;
    }
    try {
      return JSON.stringify(stepsValue, null, 2);
    } catch {
      return '';
    }
  };

  const handleView = (method: Method) => {
    setSelectedMethod(method);
    setViewMode('view');
  };

  const handleEdit = (method: Method) => {
    setEditingMethod(method);
    setShowForm(true);
  };

  const handleBack = () => {
    setSelectedMethod(null);
    setViewMode('list');
  };

  if (viewMode === 'view' && selectedMethod) {
    const stepsText = stepsToText((selectedMethod as any).steps);
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
          <div style={styles.methodSteps}>{stepsText}</div>
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
        <button
          onClick={() => {
            setEditingMethod(null);
            setShowForm(true);
          }}
          style={styles.primaryButton}
        >
          + New Method
        </button>
      </div>

      {showForm && (
        <MethodForm 
          user={user} 
          initialMethod={editingMethod}
          onClose={() => {
            setShowForm(false);
            setEditingMethod(null);
          }}
          onSaved={() => {
            setShowForm(false);
            setEditingMethod(null);
            onRefresh();
          }} 
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
function MethodForm({ user, initialMethod, onClose, onSaved }: { user: AuthUser; initialMethod: Method | null; onClose: () => void; onSaved: () => void }) {
  const stepsToText = (stepsValue: unknown): string => {
    if (typeof stepsValue === 'string') return stepsValue;
    if (stepsValue && typeof stepsValue === 'object') {
      const asAny = stepsValue as any;
      if (typeof asAny.text === 'string') return asAny.text;
    }
    return '';
  };

  const normalizeNewlines = (value: string) => value.replace(/\r\n/g, '\n');

  const [title, setTitle] = useState(initialMethod?.title || '');
  const [category, setCategory] = useState(initialMethod?.category || '');
  const [steps, setSteps] = useState(normalizeNewlines(stepsToText((initialMethod as any)?.steps)) || '');
  const [saving, setSaving] = useState(false);

  const stepsRef = useRef<HTMLTextAreaElement | null>(null);

  const autoResizeSteps = useCallback(() => {
    const el = stepsRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, []);

  useEffect(() => {
    autoResizeSteps();
  }, [steps, autoResizeSteps]);

  const isEdit = Boolean(initialMethod?.id);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);

    try {
      const url = isEdit ? `${API_BASE}/methods/${initialMethod!.id}` : `${API_BASE}/methods`;
      const response = await fetch(url, {
        method: isEdit ? 'PATCH' : 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': user.id,
        },
        body: JSON.stringify({
          title,
          category,
          steps: { text: normalizeNewlines(steps) },
        }),
      });

      if (response.ok) {
        onSaved();
      } else {
        const body = await response.text().catch(() => '');
        console.error('Failed to save method:', response.status, body);
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
          <h3>{isEdit ? 'Edit Method' : 'New Method'}</h3>
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
              ref={stepsRef}
              value={steps}
              onChange={e => setSteps(normalizeNewlines(e.target.value))}
              onInput={autoResizeSteps}
              style={styles.formTextarea}
              rows={6}
              placeholder="Describe the protocol steps..."
            />
          </div>
          <div style={styles.formActions}>
            <button type="button" onClick={onClose} style={styles.secondaryButton}>Cancel</button>
            <button type="submit" style={styles.primaryButton} disabled={saving}>
              {saving ? 'Saving...' : (isEdit ? 'Save Changes' : 'Save Method')}
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
              <h4>Additional Data Path(s):</h4>
              <div style={{ background: '#f8fafc', padding: '12px', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
                {selectedExperiment.dataLink.split('\n').map((path, idx) => (
                  <div key={idx} style={{ padding: '4px 0', fontFamily: 'monospace', fontSize: '13px', color: '#334155' }}>
                    📁 {path.trim()}
                  </div>
                ))}
              </div>
            </>
          )}
          {selectedExperiment.primaryDatasetUri && (
            <>
              <h4>Primary Dataset (Remote Source)</h4>
              <div style={{ background: '#ecfeff', padding: '12px', borderRadius: '6px', border: '1px solid #a5f3fc' }}>
                <p style={{ margin: '0 0 8px 0', fontFamily: 'monospace', fontSize: '13px', color: '#0f172a' }}>
                  {selectedExperiment.primaryDatasetUri}
                </p>
                <p style={{ margin: '0', fontSize: '12px', color: '#334155' }}>
                  Type: {(selectedExperiment.primaryDatasetType || 'unspecified').replace('_', ' ')}
                  {selectedExperiment.primaryDatasetChecksum ? ` | Checksum: ${selectedExperiment.primaryDatasetChecksum}` : ''}
                  {selectedExperiment.primaryDatasetSizeBytes ? ` | Size (bytes): ${selectedExperiment.primaryDatasetSizeBytes}` : ''}
                </p>
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
  const [customModality, setCustomModality] = useState('');
  const [protocolRef, setProtocolRef] = useState('');
  const [observations, setObservations] = useState('');
  const [troubleshootingNotes, setTroubleshootingNotes] = useState('');
  const [primaryDatasetUri, setPrimaryDatasetUri] = useState('');
  const [primaryDatasetType, setPrimaryDatasetType] = useState('');
  const [primaryDatasetChecksum, setPrimaryDatasetChecksum] = useState('');
  const [primaryDatasetSizeBytes, setPrimaryDatasetSizeBytes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaving(true);

    try {
      if (primaryDatasetUri.trim() && !isLikelyDatasetLocation(primaryDatasetUri)) {
        throw new Error('Primary dataset location must be a valid path/URI');
      }
      if (primaryDatasetUri.trim() && !primaryDatasetType) {
        throw new Error('Select a primary dataset type when providing a primary dataset location');
      }

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
          customModality: modality === 'other' ? customModality : null,
          protocolRef: protocolRef || null,
          observations: { text: observations },
          troubleshootingNotes: troubleshootingNotes || null,
          primaryDatasetUri: primaryDatasetUri.trim() || undefined,
          primaryDatasetType: primaryDatasetType || undefined,
          primaryDatasetChecksum: primaryDatasetChecksum.trim() || undefined,
          primaryDatasetSizeBytes: primaryDatasetSizeBytes.trim() || undefined,
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
              <label style={styles.formLabel}>Project</label>
              <input
                type="text"
                value={project}
                onChange={e => setProject(e.target.value)}
                style={styles.formInput}
                placeholder="Project name"
              />
            </div>
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
          </div>
          <div style={styles.formRow}>
            <div style={styles.formField}>
              <label style={styles.formLabel}>Experiment Type *</label>
              <select value={modality} onChange={e => setModality(e.target.value)} style={styles.formSelect} required>
                <option value="">Select type</option>
                {MODALITIES.map(m => (
                  <option key={m} value={m}>{formatModality(m)}</option>
                ))}
              </select>
              {modality === 'other' && (
                <input
                  type="text"
                  value={customModality}
                  onChange={e => setCustomModality(e.target.value)}
                  style={{ ...styles.formInput, marginTop: '8px' }}
                  placeholder="Enter custom experiment type..."
                  maxLength={100}
                  required
                />
              )}
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
          <div style={styles.formField}>
            <label style={styles.formLabel}>🔧 Troubleshooting Notes</label>
            <textarea
              value={troubleshootingNotes}
              onChange={e => setTroubleshootingNotes(e.target.value)}
              style={{ ...styles.formTextarea, background: '#fffbeb', borderColor: '#fcd34d' }}
              rows={3}
              placeholder="Document any issues, debugging steps, or troubleshooting notes..."
            />
            <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#92400e' }}>
              Use this section to document problems encountered and how they were resolved.
            </p>
          </div>
          <div style={styles.formField}>
            <label style={styles.formLabel}>Primary Dataset Location (Remote)</label>
            <input
              type="text"
              value={primaryDatasetUri}
              onChange={e => setPrimaryDatasetUri(e.target.value)}
              style={styles.formInput}
              placeholder="\\\\lab-server\\assays\\2026-02-07\\run_001 or s3://bucket/path"
            />
            <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#64748b' }}>
              Large/raw datasets remain in remote storage. Store only the canonical location here.
            </p>
          </div>
          <div style={styles.formRow}>
            <div style={styles.formField}>
              <label style={styles.formLabel}>Primary Dataset Type</label>
              <select
                value={primaryDatasetType}
                onChange={e => setPrimaryDatasetType(e.target.value)}
                style={styles.formSelect}
              >
                <option value="">Select type (optional)</option>
                <option value="raw">Raw</option>
                <option value="processed">Processed</option>
                <option value="analysis_bundle">Analysis Bundle</option>
              </select>
            </div>
            <div style={styles.formField}>
              <label style={styles.formLabel}>Checksum (optional)</label>
              <input
                type="text"
                value={primaryDatasetChecksum}
                onChange={e => setPrimaryDatasetChecksum(e.target.value)}
                style={styles.formInput}
                placeholder="SHA256 / MD5 / other"
              />
            </div>
          </div>
          <div style={styles.formField}>
            <label style={styles.formLabel}>Dataset Size (bytes, optional)</label>
            <input
              type="text"
              value={primaryDatasetSizeBytes}
              onChange={e => setPrimaryDatasetSizeBytes(e.target.value)}
              style={styles.formInput}
              placeholder="e.g., 18453290123"
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
  const [customModality, setCustomModality] = useState((experiment as any).customModality || '');
  const [protocolRef, setProtocolRef] = useState(experiment.protocolRef || '');
  const [observations, setObservations] = useState(() => {
    if (!experiment.observations) return '';
    if (typeof experiment.observations === 'string') return experiment.observations;
    if (typeof experiment.observations === 'object' && 'text' in (experiment.observations as any)) {
      return (experiment.observations as any).text || '';
    }
    return JSON.stringify(experiment.observations, null, 2);
  });
  const [troubleshootingNotes, setTroubleshootingNotes] = useState((experiment as any).troubleshootingNotes || '');
  const [resultsSummary, setResultsSummary] = useState(experiment.resultsSummary || '');
  const [dataLink, setDataLink] = useState(experiment.dataLink || '');
  const [primaryDatasetUri, setPrimaryDatasetUri] = useState((experiment as any).primaryDatasetUri || '');
  const [primaryDatasetType, setPrimaryDatasetType] = useState((experiment as any).primaryDatasetType || '');
  const [primaryDatasetChecksum, setPrimaryDatasetChecksum] = useState((experiment as any).primaryDatasetChecksum || '');
  const [primaryDatasetSizeBytes, setPrimaryDatasetSizeBytes] = useState((experiment as any).primaryDatasetSizeBytes || '');
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
      if (primaryDatasetUri.trim() && !isLikelyDatasetLocation(primaryDatasetUri)) {
        throw new Error('Primary dataset location must be a valid path/URI');
      }
      if ((status === 'completed' || status === 'signed') && !primaryDatasetUri.trim()) {
        throw new Error('Primary dataset location is required before marking an experiment as completed');
      }
      if ((status === 'completed' || status === 'signed') && !primaryDatasetType) {
        throw new Error('Primary dataset type is required before marking an experiment as completed');
      }
      if (primaryDatasetUri.trim() && !primaryDatasetType) {
        throw new Error('Select a primary dataset type when providing a primary dataset location');
      }

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
          customModality: modality === 'other' ? customModality : null,
          protocolRef: protocolRef || null,
          observations: { text: observations },
          troubleshootingNotes: troubleshootingNotes || null,
          resultsSummary: resultsSummary || null,
          dataLink: dataLink || null,
          primaryDatasetUri: primaryDatasetUri.trim() || undefined,
          primaryDatasetType: primaryDatasetType || undefined,
          primaryDatasetChecksum: primaryDatasetChecksum.trim() || undefined,
          primaryDatasetSizeBytes: primaryDatasetSizeBytes.trim() || undefined,
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
                <label style={styles.formLabel}>Project</label>
                <input
                  type="text"
                  value={project}
                  onChange={e => setProject(e.target.value)}
                  style={styles.formInput}
                  placeholder="Project name"
                />
              </div>
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
            </div>
            <div style={styles.formRow}>
              <div style={styles.formField}>
                <label style={styles.formLabel}>Experiment Type *</label>
                <select value={modality} onChange={e => setModality(e.target.value)} style={styles.formSelect} required>
                  <option value="">Select type</option>
                  {MODALITIES.map(m => (
                    <option key={m} value={m}>{formatModality(m)}</option>
                  ))}
                </select>
                {modality === 'other' && (
                  <input
                    type="text"
                    value={customModality}
                    onChange={e => setCustomModality(e.target.value)}
                    style={{ ...styles.formInput, marginTop: '8px' }}
                    placeholder="Enter custom experiment type..."
                    maxLength={100}
                    required
                  />
                )}
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
                  <option value="signed">Signed</option>
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
              <label style={styles.formLabel}>🔧 Troubleshooting Notes</label>
              <textarea
                value={troubleshootingNotes}
                onChange={e => setTroubleshootingNotes(e.target.value)}
                style={{ ...styles.formTextarea, background: '#fffbeb', borderColor: '#fcd34d' }}
                rows={4}
                placeholder="Document any issues, debugging steps, or troubleshooting notes..."
              />
              <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#92400e' }}>
                Use this section to document problems encountered and how they were resolved.
              </p>
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
            <div style={styles.formField}>
              <label style={styles.formLabel}>Primary Dataset Location (Remote) *</label>
              <input
                type="text"
                value={primaryDatasetUri}
                onChange={e => setPrimaryDatasetUri(e.target.value)}
                style={styles.formInput}
                placeholder="\\\\lab-server\\assays\\2026-02-07\\run_001 or s3://bucket/path"
              />
              <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#64748b' }}>
                Required for completed/signed records. Use the canonical location of the large/original dataset.
              </p>
            </div>
            <div style={styles.formRow}>
              <div style={styles.formField}>
                <label style={styles.formLabel}>Primary Dataset Type *</label>
                <select
                  value={primaryDatasetType}
                  onChange={e => setPrimaryDatasetType(e.target.value)}
                  style={styles.formSelect}
                >
                  <option value="">Select type</option>
                  <option value="raw">Raw</option>
                  <option value="processed">Processed</option>
                  <option value="analysis_bundle">Analysis Bundle</option>
                </select>
              </div>
              <div style={styles.formField}>
                <label style={styles.formLabel}>Checksum (optional)</label>
                <input
                  type="text"
                  value={primaryDatasetChecksum}
                  onChange={e => setPrimaryDatasetChecksum(e.target.value)}
                  style={styles.formInput}
                  placeholder="SHA256 / MD5 / other"
                />
              </div>
            </div>
            <div style={styles.formField}>
              <label style={styles.formLabel}>Dataset Size (bytes, optional)</label>
              <input
                type="text"
                value={primaryDatasetSizeBytes}
                onChange={e => setPrimaryDatasetSizeBytes(e.target.value)}
                style={styles.formInput}
                placeholder="e.g., 18453290123"
              />
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

// Item Detail View Component - displays all imported properties in a read-only format
type ItemDetailViewProps = {
  item: InventoryItem & { stocks?: (Stock & { location?: InventoryLocation | null })[] };
  formatCategory: (c: string) => string;
  totalQuantity: (item: InventoryItem & { stocks?: Stock[] }) => number;
  onClose: () => void;
  onEdit: () => void;
};

function ItemDetailView({ item, formatCategory, totalQuantity, onClose, onEdit }: ItemDetailViewProps) {
  const props = (item.properties || {}) as Record<string, any>;

  // Render a field row
  const Field = ({ label, value }: { label: string; value: any }) => {
    if (value === undefined || value === null || value === '') return null;
    return (
      <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
        <span style={{ fontWeight: 500, minWidth: 140, color: '#6b7280' }}>{label}:</span>
        <span style={{ wordBreak: 'break-word' }}>{String(value)}</span>
      </div>
    );
  };

  // Render dilutions table for antibodies
  const renderDilutions = () => {
    const dils = props.dilutions;
    if (!dils || typeof dils !== 'object') return null;
    const entries = Object.entries(dils).filter(([_, v]) => v);
    if (entries.length === 0) return null;
    return (
      <div style={{ marginTop: 12 }}>
        <h4 style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: '#374151' }}>Recommended Dilutions</h4>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 8 }}>
          {entries.map(([key, val]) => (
            <div key={key} style={{ background: '#f3f4f6', padding: '6px 10px', borderRadius: 6 }}>
              <span style={{ fontWeight: 600, fontSize: 11, color: '#6b7280' }}>{key}</span>
              <div style={{ fontSize: 13 }}>{String(val)}</div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  // Render modifications for primers/oligos
  const renderModifications = () => {
    const mods = props.modifications;
    if (!mods || typeof mods !== 'object') return null;
    const entries = Object.entries(mods).filter(([_, v]) => v);
    if (entries.length === 0) return null;
    return (
      <div style={{ marginTop: 8 }}>
        <span style={{ fontWeight: 500, color: '#6b7280' }}>Modifications:</span>
        {entries.map(([key, val]) => (
          <span key={key} style={{ marginLeft: 8, background: '#e5e7eb', padding: '2px 6px', borderRadius: 4, fontSize: 12 }}>
            {key}: {String(val)}
          </span>
        ))}
      </div>
    );
  };

  // Render stock information
  const renderStocks = () => {
    const stocks = item.stocks || [];
    if (stocks.length === 0) return <p style={{ opacity: 0.6, fontStyle: 'italic' }}>No stock entries</p>;
    return (
      <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
        {stocks.map((s, idx) => (
          <div key={s.id || idx} style={{ background: '#f9fafb', padding: '8px 12px', borderRadius: 6, border: '1px solid #e5e7eb' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontWeight: 600 }}>{s.quantity}{item.unit ? ` ${item.unit}` : ''}</span>
              <span style={{ fontSize: 12, color: '#6b7280' }}>{s.location?.name || 'No location'}</span>
            </div>
            {s.lotNumber && <div style={{ fontSize: 12, color: '#6b7280' }}>Lot: {s.lotNumber}</div>}
            {s.barcode && <div style={{ fontSize: 12, color: '#6b7280' }}>Barcode: {s.barcode}</div>}
          </div>
        ))}
      </div>
    );
  };

  return (
    <div style={{ ...styles.detailCard, maxHeight: '70vh', overflowY: 'auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
        <div>
          <h3 style={{ ...styles.sectionTitle, marginBottom: 4 }}>{item.name}</h3>
          <span style={{ fontSize: 13, color: '#6b7280' }}>
            {formatCategory(item.category)} • Total: {totalQuantity(item)}{item.unit ? ` ${item.unit}` : ''}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={styles.secondaryButton} onClick={onEdit}>Edit</button>
          <button style={styles.secondaryButton} onClick={onClose}>Close</button>
        </div>
      </div>

      {/* Basic Info */}
      <div style={{ marginBottom: 16 }}>
        <h4 style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: '#374151', borderBottom: '1px solid #e5e7eb', paddingBottom: 4 }}>Basic Information</h4>
        <Field label="Catalog #" value={item.catalogNumber} />
        <Field label="Manufacturer" value={item.manufacturer} />
        <Field label="Supplier" value={item.supplier} />
        <Field label="Unit" value={item.unit} />
        <Field label="Description" value={item.description} />
      </div>

      {/* Category-specific fields */}
      {item.category === 'antibody' && (
        <div style={{ marginBottom: 16 }}>
          <h4 style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: '#374151', borderBottom: '1px solid #e5e7eb', paddingBottom: 4 }}>Antibody Details</h4>
          <Field label="Target Antigen" value={props.target} />
          <Field label="Host Species" value={props.host} />
          <Field label="Clonality" value={props.clonality} />
          <Field label="Isotype" value={props.isotype} />
          <Field label="Conjugate/Label" value={props.conjugate} />
          <Field label="Concentration" value={props.concentration} />
          <Field label="Lot Number" value={props.lotNumber} />
          <Field label="Purity" value={props.purity} />
          <Field label="Cross-Reactivity" value={props.crossReactivity} />
          <Field label="Reference" value={props.reference} />
          <Field label="Investigator" value={props.investigator} />
          {renderDilutions()}
        </div>
      )}

      {item.category === 'plasmid' && (
        <div style={{ marginBottom: 16 }}>
          <h4 style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: '#374151', borderBottom: '1px solid #e5e7eb', paddingBottom: 4 }}>Plasmid Details</h4>
          <Field label="Backbone" value={props.backbone} />
          <Field label="Size" value={props.size} />
          <Field label="Insert" value={props.insert} />
          <Field label="Insert Origin" value={props.insertOrigin} />
          <Field label="Promoter" value={props.promoter} />
          <Field label="Promoter Origin" value={props.promoterOrigin} />
          <Field label="Selection Marker" value={props.selectionMarker} />
          <Field label="Coding Sequence" value={props.codingSequence} />
          <Field label="Concentration" value={props.concentration} />
          <Field label="Purity" value={props.purity} />
          <Field label="Biosafety Level" value={props.biosafety} />
          <Field label="Sequence Date" value={props.sequenceDate} />
          <Field label="Sequence File" value={props.sequenceFile} />
          <Field label="Map File" value={props.mapFile} />
          <Field label="Oligos Used" value={props.oligosUsed} />
          <Field label="Lot Number" value={props.lotNumber} />
          <Field label="Construction Method" value={props.constructionMethod} />
          <Field label="Reference" value={props.reference} />
          <Field label="Info" value={props.info} />
          <Field label="Investigator" value={props.investigator} />
          {props.sequence && (
            <div style={{ marginTop: 8 }}>
              <span style={{ fontWeight: 500, color: '#6b7280' }}>Sequence:</span>
              <pre style={{ background: '#f3f4f6', padding: 8, borderRadius: 4, fontSize: 11, whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 100, overflow: 'auto' }}>
                {props.sequence}
              </pre>
            </div>
          )}
        </div>
      )}

      {item.category === 'cell_line' && (
        <div style={{ marginBottom: 16 }}>
          <h4 style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: '#374151', borderBottom: '1px solid #e5e7eb', paddingBottom: 4 }}>Cell Line Details</h4>
          <Field label="Organism" value={props.organism} />
          <Field label="Tissue Origin" value={props.tissue} />
          <Field label="Cell Type" value={props.cellType} />
          <Field label="Morphology" value={props.morphology} />
          <Field label="Culture Medium" value={props.medium} />
          <Field label="Supplements" value={props.supplements} />
          <Field label="Serum" value={props.serumRequirement} />
          <Field label="Passage Number" value={props.passageNumber} />
          <Field label="Parental Cell" value={props.parentalCell} />
          <Field label="Growth Conditions" value={props.growthCondition} />
          <Field label="Obtained From" value={props.obtainedFrom} />
          <Field label="Accession Number" value={props.accessionNumber} />
          <Field label="Transfected Plasmids" value={props.plasmids} />
          <Field label="Selection Markers" value={props.selectionMarkers} />
          <Field label="Biosafety Level" value={props.biosafety} />
          <Field label="Reference" value={props.reference} />
          <Field label="Investigator" value={props.investigator} />
          <Field label="Notes" value={props.notes} />
        </div>
      )}

      {item.category === 'primer' && (
        <div style={{ marginBottom: 16 }}>
          <h4 style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: '#374151', borderBottom: '1px solid #e5e7eb', paddingBottom: 4 }}>Primer Details</h4>
          <Field label="Target Gene" value={props.targetGene} />
          <Field label="Length" value={props.length ? `${props.length} bp` : undefined} />
          <Field label="Tm" value={props.tm ? `${props.tm}°C` : undefined} />
          <Field label="GC Content" value={props.gcContent ? `${props.gcContent}%` : undefined} />
          <Field label="Alternate Name" value={props.alternateName} />
          <Field label="Scale" value={props.scale} />
          <Field label="Purification" value={props.purification} />
          {renderModifications()}
          {props.sequence && (
            <div style={{ marginTop: 8 }}>
              <span style={{ fontWeight: 500, color: '#6b7280' }}>Sequence (5′→3′):</span>
              <pre style={{ background: '#f3f4f6', padding: 8, borderRadius: 4, fontSize: 12, fontFamily: 'monospace', letterSpacing: 1 }}>
                {props.sequence}
              </pre>
            </div>
          )}
        </div>
      )}

      {item.category === 'reagent' && (
        <div style={{ marginBottom: 16 }}>
          <h4 style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: '#374151', borderBottom: '1px solid #e5e7eb', paddingBottom: 4 }}>Reagent Details</h4>
          <Field label="Reagent Type" value={props.itemType} />
          <Field label="Stock Concentration" value={props.stockConcentration || props.concentration} />
          <Field label="Working Concentration" value={props.workingConcentration} />
          <Field label="Molecular Weight" value={props.molecularWeight} />
          <Field label="CAS Number" value={props.casNo} />
          <Field label="Lot Number" value={props.lotNumber} />
          <Field label="Amount" value={props.amount} />
          <Field label="Activity/Function" value={props.activity} />
          <Field label="Inhibitor Type" value={props.inhibitor} />
          <Field label="Components" value={props.components} />
          <Field label="Working Buffer" value={props.workBuffer} />
          <Field label="Purchase Date" value={props.purchaseDate} />
          <Field label="Date Opened" value={props.dateOpened} />
          <Field label="Expiration Date" value={props.expirationDate} />
          <Field label="MSDS Date" value={props.msdsDate} />
          <Field label="Alternate Names" value={props.alternateNames} />
          <Field label="Reference" value={props.reference} />
          <Field label="Path / Link" value={props.path} />
          <Field label="Hazards" value={props.hazards} />
          <Field label="Safety Caution" value={props.caution} />
          <Field label="Comments" value={props.comments} />
          <Field label="Notes" value={props.notes} />
        </div>
      )}

      {item.category === 'sample' && (
        <div style={{ marginBottom: 16 }}>
          <h4 style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: '#374151', borderBottom: '1px solid #e5e7eb', paddingBottom: 4 }}>Sample Details</h4>
          <Field label="Backbone" value={props.backbone} />
          <Field label="Helper Virus" value={props.helperVirus} />
          <Field label="Promoter" value={props.promoter} />
          <Field label="Coding Sequence" value={props.codingSequence} />
          <Field label="PFU" value={props.pfu} />
          <Field label="Particles" value={props.particles} />
          <Field label="Purity" value={props.purity} />
          <Field label="Source Plaque" value={props.sourcePlaque} />
          <Field label="Oligos Used" value={props.oligosUsed} />
          <Field label="Sequence Date" value={props.sequenceDate} />
          <Field label="Sequence File" value={props.sequenceFile} />
          <Field label="Virus Map" value={props.virusMap} />
          <Field label="Reference" value={props.reference} />
          <Field label="Lot Number" value={props.lotNumber} />
          <Field label="Investigator" value={props.investigator} />
        </div>
      )}

      {/* Legacy/Import Info */}
      {props.source === 'access' && (
        <div style={{ marginBottom: 16 }}>
          <h4 style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: '#374151', borderBottom: '1px solid #e5e7eb', paddingBottom: 4 }}>Import Info</h4>
          <Field label="Source" value="Microsoft Access" />
          <Field label="Legacy ID" value={props.legacyId} />
          <Field label="Legacy Table" value={props.legacyTable} />
        </div>
      )}

      {/* Stock Information */}
      <div style={{ marginBottom: 16 }}>
        <h4 style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: '#374151', borderBottom: '1px solid #e5e7eb', paddingBottom: 4 }}>Stock ({totalQuantity(item)}{item.unit ? ` ${item.unit}` : ''})</h4>
        {renderStocks()}
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
  const [newItemManufacturer, setNewItemManufacturer] = useState('');
  const [newItemSupplier, setNewItemSupplier] = useState('');

  const [stockItemId, setStockItemId] = useState<string | null>(null);
  const [stockQuantity, setStockQuantity] = useState('');
  const [stockLocationName, setStockLocationName] = useState('');
  const [stockLot, setStockLot] = useState('');
  const [stockBarcode, setStockBarcode] = useState('');
  const [stockNotes, setStockNotes] = useState('');

  const [accessTable, setAccessTable] = useState('auto');
  const [accessMappingJson, setAccessMappingJson] = useState('');

  const headers = useMemo(() => ({ 'x-user-id': user.id, 'Content-Type': 'application/json' }), [user.id]);

  const [detailsItem, setDetailsItem] = useState<ItemWithStocks | null>(null);
  const [detailsProperties, setDetailsProperties] = useState<Record<string, unknown>>({});
  const [detailsSaving, setDetailsSaving] = useState(false);
  const [detailsCatalogNumber, setDetailsCatalogNumber] = useState('');
  const [detailsManufacturer, setDetailsManufacturer] = useState('');
  const [detailsSupplier, setDetailsSupplier] = useState('');
  const [detailsUnit, setDetailsUnit] = useState('');
  const [detailsDescription, setDetailsDescription] = useState('');
  const [viewItem, setViewItem] = useState<ItemWithStocks | null>(null);

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
        body: JSON.stringify({
          catalogNumber: detailsCatalogNumber.trim(),
          manufacturer: detailsManufacturer.trim(),
          supplier: detailsSupplier.trim(),
          unit: detailsUnit.trim(),
          description: detailsDescription,
          properties: detailsProperties
        })
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload?.error || 'Failed to update item');
      setDetailsItem(null);
      setDetailsProperties({});
      setDetailsCatalogNumber('');
      setDetailsManufacturer('');
      setDetailsSupplier('');
      setDetailsUnit('');
      setDetailsDescription('');
      await fetchInventory();
    } catch (e: any) {
      setMessage(e?.message || 'Failed to update item');
    } finally {
      setDetailsSaving(false);
    }
  }, [detailsItem, detailsCatalogNumber, detailsManufacturer, detailsSupplier, detailsUnit, detailsDescription, detailsProperties, fetchInventory, headers]);

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
        manufacturer: newItemManufacturer.trim() || undefined,
        supplier: newItemSupplier.trim() || undefined,
      };
      const res = await fetch(`${API_BASE}/inventory`, { method: 'POST', headers, body: JSON.stringify(body) });
      if (!res.ok) throw new Error('Failed to create item');
      setShowAddItem(false);
      setNewItemName('');
      setNewItemUnit('');
      setNewItemCatalog('');
      setNewItemManufacturer('');
      setNewItemSupplier('');
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
      if (!res.ok) {
        const errorText = typeof payload?.error === 'string' ? payload.error : (payload?.error ? JSON.stringify(payload.error) : 'CSV import failed');
        if (res.status === 403 && (errorText === 'Not authorized' || errorText.toLowerCase().includes('not authorized'))) {
          throw new Error('Not authorized: CSV import requires a manager or admin account.');
        }
        throw new Error(errorText || 'CSV import failed');
      }
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
      if (!res.ok) {
        const errorText = typeof payload?.error === 'string' ? payload.error : (payload?.error ? JSON.stringify(payload.error) : 'Access import failed');
        if (res.status === 403 && (errorText === 'Not authorized' || errorText.toLowerCase().includes('not authorized'))) {
          throw new Error('Not authorized: Access import requires a manager or admin account.');
        }
        throw new Error(errorText || 'Access import failed');
      }
      setMessage(`Imported Access: ${payload.itemsCreated} created, ${payload.itemsUpdated} updated, ${payload.stocksCreated} stocks`);
      await fetchInventory();
      await fetchLocations();
    } catch (e: any) {
      const msg = e?.message || 'Access import failed';
      if (msg === 'Failed to fetch' || msg === 'NetworkError when attempting to fetch resource.') {
        setMessage('Access import failed to reach the server. Make sure the server is running on http://localhost:4000 and that large uploads are allowed.');
      } else {
        setMessage(msg);
      }
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
            <div>
              <label style={styles.formLabel}>Source / Manufacturer</label>
              <input value={newItemManufacturer} onChange={(e) => setNewItemManufacturer(e.target.value)} style={styles.formInput} />
            </div>
            <div>
              <label style={styles.formLabel}>Supplier</label>
              <input value={newItemSupplier} onChange={(e) => setNewItemSupplier(e.target.value)} style={styles.formInput} />
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

      {viewItem && (
        <ItemDetailView
          item={viewItem}
          formatCategory={formatCategory}
          totalQuantity={totalQuantity}
          onClose={() => setViewItem(null)}
          onEdit={() => {
            setDetailsItem(viewItem);
            setDetailsProperties((viewItem.properties as any) || {});
            setDetailsCatalogNumber(viewItem.catalogNumber || '');
            setDetailsManufacturer(viewItem.manufacturer || '');
            setDetailsSupplier(viewItem.supplier || '');
            setDetailsUnit(viewItem.unit || '');
            setDetailsDescription(viewItem.description || '');
            setViewItem(null);
          }}
        />
      )}

      {detailsItem && (
        <div style={styles.detailCard}>
          <h3 style={styles.sectionTitle}>Item Details</h3>
          <p style={{ marginTop: 0, opacity: 0.8 }}>
            {detailsItem.name} • {formatCategory(detailsItem.category)}
          </p>

          <div style={styles.formGrid}>
            <div>
              <label style={styles.formLabel}>Catalog #</label>
              <input value={detailsCatalogNumber} onChange={(e) => setDetailsCatalogNumber(e.target.value)} style={styles.formInput} />
            </div>
            <div>
              <label style={styles.formLabel}>Source / Manufacturer</label>
              <input value={detailsManufacturer} onChange={(e) => setDetailsManufacturer(e.target.value)} style={styles.formInput} />
            </div>
            <div>
              <label style={styles.formLabel}>Supplier</label>
              <input value={detailsSupplier} onChange={(e) => setDetailsSupplier(e.target.value)} style={styles.formInput} />
            </div>
            <div>
              <label style={styles.formLabel}>Unit</label>
              <input value={detailsUnit} onChange={(e) => setDetailsUnit(e.target.value)} style={styles.formInput} placeholder="ml, mg, vials…" />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={styles.formLabel}>Description</label>
              <input value={detailsDescription} onChange={(e) => setDetailsDescription(e.target.value)} style={styles.formInput} />
            </div>
          </div>

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
                setDetailsCatalogNumber('');
                setDetailsManufacturer('');
                setDetailsSupplier('');
                setDetailsUnit('');
                setDetailsDescription('');
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
        <h3 style={styles.sectionTitle}>Items ({items.length})</h3>
        {items.length === 0 && !loading && (
          <p style={styles.emptyMessage}>No inventory items yet. Add one, or import a CSV/Access table.</p>
        )}
        {items.map(item => {
          const props = (item.properties || {}) as Record<string, any>;
          // Build extra info based on category
          const extraInfo: string[] = [];
          if (item.category === 'antibody') {
            if (props.target) extraInfo.push(`Target: ${props.target}`);
            if (props.host) extraInfo.push(`Host: ${props.host}`);
            if (props.clonality) extraInfo.push(`${props.clonality}`);
            if (props.conjugate) extraInfo.push(`Label: ${props.conjugate}`);
            // Build dilutions string
            const dils: string[] = [];
            if (props.dilutions?.WB) dils.push(`WB: ${props.dilutions.WB}`);
            if (props.dilutions?.IF) dils.push(`IF: ${props.dilutions.IF}`);
            if (props.dilutions?.FACS) dils.push(`FACS: ${props.dilutions.FACS}`);
            if (dils.length > 0) extraInfo.push(dils.join(', '));
          } else if (item.category === 'cell_line') {
            if (props.organism) extraInfo.push(`Species: ${props.organism}`);
            if (props.tissue) extraInfo.push(`Tissue: ${props.tissue}`);
            if (props.medium) extraInfo.push(`Medium: ${props.medium}`);
            if (props.passageNumber) extraInfo.push(`Passage: ${props.passageNumber}`);
          } else if (item.category === 'plasmid') {
            if (props.backbone) extraInfo.push(`Backbone: ${props.backbone}`);
            if (props.selectionMarker) extraInfo.push(`Resistance: ${props.selectionMarker}`);
            if (props.promoter) extraInfo.push(`Promoter: ${props.promoter}`);
            if (props.insert) extraInfo.push(`Insert: ${props.insert}`);
            if (props.size) extraInfo.push(`Size: ${props.size}`);
          } else if (item.category === 'primer') {
            if (props.sequence) extraInfo.push(`Seq: ${String(props.sequence).substring(0, 20)}${String(props.sequence).length > 20 ? '...' : ''}`);
            if (props.tm) extraInfo.push(`Tm: ${props.tm}`);
            if (props.length) extraInfo.push(`Length: ${props.length}bp`);
          } else if (item.category === 'reagent') {
            if (props.stockConcentration || props.concentration) extraInfo.push(`Stock: ${props.stockConcentration || props.concentration}`);
            if (props.lotNumber) extraInfo.push(`Lot: ${props.lotNumber}`);
            if (props.purchaseDate) extraInfo.push(`Purchased: ${props.purchaseDate}`);
            if (props.casNo) extraInfo.push(`CAS: ${props.casNo}`);
          } else if (item.category === 'sample') {
            // Virus or other samples
            if (props.backbone) extraInfo.push(`Backbone: ${props.backbone}`);
            if (props.promoter) extraInfo.push(`Promoter: ${props.promoter}`);
            if (props.pfu) extraInfo.push(`PFU: ${props.pfu}`);
            if (props.particles) extraInfo.push(`Particles: ${props.particles}`);
          }
          // Show legacy source if present
          if (props.source === 'access' && props.legacyId) {
            extraInfo.push(`Legacy ID: ${props.legacyId}`);
          }
          
          return (
            <div key={item.id} style={styles.listItem}>
              <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
                <span style={styles.listItemTitle}>{item.name}</span>
                <span style={styles.listItemMeta}>
                  {formatCategory(item.category)}{item.catalogNumber ? ` • Cat#: ${item.catalogNumber}` : ''}{item.manufacturer ? ` • ${item.manufacturer}` : ''}
                </span>
                {extraInfo.length > 0 && (
                  <span style={{ ...styles.listItemMeta, fontSize: 11, marginTop: 2, opacity: 0.7, wordBreak: 'break-word' }}>
                    {extraInfo.join(' | ')}
                  </span>
                )}
                {item.description && (
                  <span style={{ ...styles.listItemMeta, fontSize: 11, marginTop: 2, fontStyle: 'italic', opacity: 0.6, wordBreak: 'break-word' }}>
                    {item.description.length > 100 ? item.description.substring(0, 100) + '...' : item.description}
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
                <div style={{ 
                  display: 'flex', 
                  flexDirection: 'column', 
                  alignItems: 'center',
                  padding: '4px 12px',
                  background: totalQuantity(item) > 0 ? '#dcfce7' : '#fef2f2',
                  borderRadius: 8,
                  minWidth: 60
                }}>
                  <span style={{ 
                    fontWeight: 700, 
                    fontSize: 16,
                    color: totalQuantity(item) > 0 ? '#166534' : '#dc2626'
                  }}>
                    {totalQuantity(item)}
                  </span>
                  <span style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase' }}>
                    {item.unit || 'items'}
                  </span>
                </div>
                <button
                  style={styles.secondaryButton}
                  onClick={() => {
                    setViewItem(item);
                  }}
                >
                  View
                </button>
                <button
                  style={styles.secondaryButton}
                  onClick={() => {
                    setDetailsItem(item);
                    setDetailsProperties((item.properties as any) || {});
                    setDetailsCatalogNumber(item.catalogNumber || '');
                    setDetailsManufacturer(item.manufacturer || '');
                    setDetailsSupplier(item.supplier || '');
                    setDetailsUnit(item.unit || '');
                    setDetailsDescription(item.description || '');
                  }}
                >
                  Edit
                </button>
                <button style={styles.secondaryButton} onClick={() => setStockItemId(item.id)}>Add Stock</button>
              </div>
            </div>
          );
        })}
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
// Calculators Panel - Molarity and Dilution Calculators
function CalculatorsPanel() {
  const [activeCalc, setActiveCalc] = useState<'molarity' | 'dilution'>('molarity');
  
  // Molarity calculator state: Mass = Concentration × Volume × MW
  const [molarityMode, setMolarityMode] = useState<'mass' | 'volume' | 'concentration'>('mass');
  const [molecularWeight, setMolecularWeight] = useState('');
  const [molarityConcentration, setMolarityConcentration] = useState('');
  const [molarityConcentrationUnit, setMolarityConcentrationUnit] = useState<'M' | 'mM' | 'µM' | 'nM'>('mM');
  const [molarityVolume, setMolarityVolume] = useState('');
  const [molarityVolumeUnit, setMolarityVolumeUnit] = useState<'L' | 'mL' | 'µL'>('mL');
  const [molarityMass, setMolarityMass] = useState('');
  const [molarityMassUnit, setMolarityMassUnit] = useState<'g' | 'mg' | 'µg' | 'ng'>('mg');
  const [molarityResult, setMolarityResult] = useState<string | null>(null);
  
  // Dilution calculator state: C1V1 = C2V2
  const [dilutionMode, setDilutionMode] = useState<'V1' | 'C2' | 'V2'>('V1');
  const [c1, setC1] = useState('');
  const [c1Unit, setC1Unit] = useState<'M' | 'mM' | 'µM' | 'nM'>('mM');
  const [v1, setV1] = useState('');
  const [v1Unit, setV1Unit] = useState<'L' | 'mL' | 'µL'>('µL');
  const [c2, setC2] = useState('');
  const [c2Unit, setC2Unit] = useState<'M' | 'mM' | 'µM' | 'nM'>('µM');
  const [v2, setV2] = useState('');
  const [v2Unit, setV2Unit] = useState<'L' | 'mL' | 'µL'>('mL');
  const [dilutionResult, setDilutionResult] = useState<string | null>(null);

  // Unit conversion factors to base units (mol/L for concentration, L for volume, g for mass)
  const concentrationToMolar: Record<string, number> = { 'M': 1, 'mM': 1e-3, 'µM': 1e-6, 'nM': 1e-9 };
  const volumeToLiters: Record<string, number> = { 'L': 1, 'mL': 1e-3, 'µL': 1e-6 };
  const massToGrams: Record<string, number> = { 'g': 1, 'mg': 1e-3, 'µg': 1e-6, 'ng': 1e-9 };

  const formatNumber = (num: number, unit: string): string => {
    if (num === 0) return `0 ${unit}`;
    if (num >= 1000) return `${(num / 1000).toPrecision(4)} k${unit}`;
    if (num >= 1) return `${num.toPrecision(4)} ${unit}`;
    if (num >= 1e-3) return `${(num * 1e3).toPrecision(4)} m${unit}`;
    if (num >= 1e-6) return `${(num * 1e6).toPrecision(4)} µ${unit}`;
    if (num >= 1e-9) return `${(num * 1e9).toPrecision(4)} n${unit}`;
    return `${num.toExponential(3)} ${unit}`;
  };

  const calculateMolarity = () => {
    const mw = parseFloat(molecularWeight);
    if (!mw || mw <= 0) {
      setMolarityResult('Please enter a valid molecular weight');
      return;
    }

    if (molarityMode === 'mass') {
      // Calculate mass: Mass (g) = Concentration (mol/L) × Volume (L) × MW (g/mol)
      const conc = parseFloat(molarityConcentration);
      const vol = parseFloat(molarityVolume);
      if (!conc || !vol || conc <= 0 || vol <= 0) {
        setMolarityResult('Please enter valid concentration and volume');
        return;
      }
      const concInMolar = conc * concentrationToMolar[molarityConcentrationUnit];
      const volInLiters = vol * volumeToLiters[molarityVolumeUnit];
      const massInGrams = concInMolar * volInLiters * mw;
      setMolarityResult(`Mass needed: ${formatNumber(massInGrams, 'g')}`);
    } else if (molarityMode === 'volume') {
      // Calculate volume: Volume (L) = Mass (g) / (Concentration (mol/L) × MW (g/mol))
      const mass = parseFloat(molarityMass);
      const conc = parseFloat(molarityConcentration);
      if (!mass || !conc || mass <= 0 || conc <= 0) {
        setMolarityResult('Please enter valid mass and concentration');
        return;
      }
      const massInGrams = mass * massToGrams[molarityMassUnit];
      const concInMolar = conc * concentrationToMolar[molarityConcentrationUnit];
      const volInLiters = massInGrams / (concInMolar * mw);
      setMolarityResult(`Volume needed: ${formatNumber(volInLiters, 'L')}`);
    } else {
      // Calculate concentration: Concentration (mol/L) = Mass (g) / (Volume (L) × MW (g/mol))
      const mass = parseFloat(molarityMass);
      const vol = parseFloat(molarityVolume);
      if (!mass || !vol || mass <= 0 || vol <= 0) {
        setMolarityResult('Please enter valid mass and volume');
        return;
      }
      const massInGrams = mass * massToGrams[molarityMassUnit];
      const volInLiters = vol * volumeToLiters[molarityVolumeUnit];
      const concInMolar = massInGrams / (volInLiters * mw);
      setMolarityResult(`Concentration: ${formatNumber(concInMolar, 'M')}`);
    }
  };

  const calculateDilution = () => {
    // C1V1 = C2V2
    if (dilutionMode === 'V1') {
      // V1 = C2 × V2 / C1
      const c1Val = parseFloat(c1);
      const c2Val = parseFloat(c2);
      const v2Val = parseFloat(v2);
      if (!c1Val || !c2Val || !v2Val || c1Val <= 0 || c2Val <= 0 || v2Val <= 0) {
        setDilutionResult('Please enter valid C1, C2, and V2 values');
        return;
      }
      const c1Molar = c1Val * concentrationToMolar[c1Unit];
      const c2Molar = c2Val * concentrationToMolar[c2Unit];
      const v2Liters = v2Val * volumeToLiters[v2Unit];
      if (c2Molar > c1Molar) {
        setDilutionResult('Error: Final concentration cannot exceed stock concentration');
        return;
      }
      const v1Liters = (c2Molar * v2Liters) / c1Molar;
      setDilutionResult(`Volume of stock needed (V1): ${formatNumber(v1Liters, 'L')}`);
    } else if (dilutionMode === 'C2') {
      // C2 = C1 × V1 / V2
      const c1Val = parseFloat(c1);
      const v1Val = parseFloat(v1);
      const v2Val = parseFloat(v2);
      if (!c1Val || !v1Val || !v2Val || c1Val <= 0 || v1Val <= 0 || v2Val <= 0) {
        setDilutionResult('Please enter valid C1, V1, and V2 values');
        return;
      }
      const c1Molar = c1Val * concentrationToMolar[c1Unit];
      const v1Liters = v1Val * volumeToLiters[v1Unit];
      const v2Liters = v2Val * volumeToLiters[v2Unit];
      if (v1Liters > v2Liters) {
        setDilutionResult('Error: Stock volume cannot exceed final volume');
        return;
      }
      const c2Molar = (c1Molar * v1Liters) / v2Liters;
      setDilutionResult(`Final concentration (C2): ${formatNumber(c2Molar, 'M')}`);
    } else {
      // V2 = C1 × V1 / C2
      const c1Val = parseFloat(c1);
      const v1Val = parseFloat(v1);
      const c2Val = parseFloat(c2);
      if (!c1Val || !v1Val || !c2Val || c1Val <= 0 || v1Val <= 0 || c2Val <= 0) {
        setDilutionResult('Please enter valid C1, V1, and C2 values');
        return;
      }
      const c1Molar = c1Val * concentrationToMolar[c1Unit];
      const c2Molar = c2Val * concentrationToMolar[c2Unit];
      const v1Liters = v1Val * volumeToLiters[v1Unit];
      if (c2Molar > c1Molar) {
        setDilutionResult('Error: Final concentration cannot exceed stock concentration');
        return;
      }
      const v2Liters = (c1Molar * v1Liters) / c2Molar;
      setDilutionResult(`Final volume (V2): ${formatNumber(v2Liters, 'L')}`);
    }
  };

  const inputStyle: React.CSSProperties = {
    padding: '10px 12px',
    fontSize: '15px',
    border: '1px solid #e2e8f0',
    borderRadius: '8px',
    outline: 'none',
    width: '120px',
    textAlign: 'right'
  };

  const selectStyle: React.CSSProperties = {
    padding: '10px 8px',
    fontSize: '14px',
    border: '1px solid #e2e8f0',
    borderRadius: '8px',
    background: '#f8fafc',
    cursor: 'pointer'
  };

  const rowStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    marginBottom: '16px'
  };

  const labelStyle: React.CSSProperties = {
    width: '180px',
    fontWeight: 500,
    color: '#374151'
  };

  return (
    <div style={styles.panel}>
      <div style={styles.header}>
        <div>
          <h2 style={styles.pageTitle}>Lab Calculators</h2>
          <p style={styles.pageSubtitle}>Molarity and dilution calculations for solution preparation</p>
        </div>
      </div>

      {/* Calculator Type Tabs */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '24px' }}>
        <button
          onClick={() => { setActiveCalc('molarity'); setMolarityResult(null); }}
          style={activeCalc === 'molarity' ? styles.primaryButton : styles.secondaryButton}
        >
          🧪 Molarity Calculator
        </button>
        <button
          onClick={() => { setActiveCalc('dilution'); setDilutionResult(null); }}
          style={activeCalc === 'dilution' ? styles.primaryButton : styles.secondaryButton}
        >
          💧 Dilution Calculator
        </button>
      </div>

      {activeCalc === 'molarity' ? (
        <div style={styles.section}>
          <h3 style={styles.sectionTitle}>Molarity Calculator</h3>
          <p style={{ color: '#64748b', marginBottom: '20px', fontSize: '14px' }}>
            Calculate mass, volume, or concentration using the equation: <strong>Mass = Concentration × Volume × Molecular Weight</strong>
          </p>

          {/* Mode selector */}
          <div style={{ marginBottom: '24px' }}>
            <label style={{ fontWeight: 500, marginRight: '12px' }}>Calculate:</label>
            <select 
              value={molarityMode} 
              onChange={(e) => { setMolarityMode(e.target.value as any); setMolarityResult(null); }}
              style={{ ...selectStyle, width: '200px' }}
            >
              <option value="mass">Mass (how much compound to weigh)</option>
              <option value="volume">Volume (how much solvent to add)</option>
              <option value="concentration">Concentration (resulting molarity)</option>
            </select>
          </div>

          {/* Molecular Weight - always shown */}
          <div style={rowStyle}>
            <label style={labelStyle}>Molecular Weight (g/mol)</label>
            <input
              type="number"
              value={molecularWeight}
              onChange={(e) => setMolecularWeight(e.target.value)}
              placeholder="e.g. 197.13"
              style={inputStyle}
            />
          </div>

          {/* Conditional inputs based on mode */}
          {molarityMode === 'mass' && (
            <>
              <div style={rowStyle}>
                <label style={labelStyle}>Desired Concentration</label>
                <input
                  type="number"
                  value={molarityConcentration}
                  onChange={(e) => setMolarityConcentration(e.target.value)}
                  placeholder="e.g. 10"
                  style={inputStyle}
                />
                <select value={molarityConcentrationUnit} onChange={(e) => setMolarityConcentrationUnit(e.target.value as any)} style={selectStyle}>
                  <option value="M">M</option>
                  <option value="mM">mM</option>
                  <option value="µM">µM</option>
                  <option value="nM">nM</option>
                </select>
              </div>
              <div style={rowStyle}>
                <label style={labelStyle}>Desired Volume</label>
                <input
                  type="number"
                  value={molarityVolume}
                  onChange={(e) => setMolarityVolume(e.target.value)}
                  placeholder="e.g. 10"
                  style={inputStyle}
                />
                <select value={molarityVolumeUnit} onChange={(e) => setMolarityVolumeUnit(e.target.value as any)} style={selectStyle}>
                  <option value="L">L</option>
                  <option value="mL">mL</option>
                  <option value="µL">µL</option>
                </select>
              </div>
            </>
          )}

          {molarityMode === 'volume' && (
            <>
              <div style={rowStyle}>
                <label style={labelStyle}>Compound Mass</label>
                <input
                  type="number"
                  value={molarityMass}
                  onChange={(e) => setMolarityMass(e.target.value)}
                  placeholder="e.g. 20"
                  style={inputStyle}
                />
                <select value={molarityMassUnit} onChange={(e) => setMolarityMassUnit(e.target.value as any)} style={selectStyle}>
                  <option value="g">g</option>
                  <option value="mg">mg</option>
                  <option value="µg">µg</option>
                  <option value="ng">ng</option>
                </select>
              </div>
              <div style={rowStyle}>
                <label style={labelStyle}>Desired Concentration</label>
                <input
                  type="number"
                  value={molarityConcentration}
                  onChange={(e) => setMolarityConcentration(e.target.value)}
                  placeholder="e.g. 10"
                  style={inputStyle}
                />
                <select value={molarityConcentrationUnit} onChange={(e) => setMolarityConcentrationUnit(e.target.value as any)} style={selectStyle}>
                  <option value="M">M</option>
                  <option value="mM">mM</option>
                  <option value="µM">µM</option>
                  <option value="nM">nM</option>
                </select>
              </div>
            </>
          )}

          {molarityMode === 'concentration' && (
            <>
              <div style={rowStyle}>
                <label style={labelStyle}>Compound Mass</label>
                <input
                  type="number"
                  value={molarityMass}
                  onChange={(e) => setMolarityMass(e.target.value)}
                  placeholder="e.g. 20"
                  style={inputStyle}
                />
                <select value={molarityMassUnit} onChange={(e) => setMolarityMassUnit(e.target.value as any)} style={selectStyle}>
                  <option value="g">g</option>
                  <option value="mg">mg</option>
                  <option value="µg">µg</option>
                  <option value="ng">ng</option>
                </select>
              </div>
              <div style={rowStyle}>
                <label style={labelStyle}>Solution Volume</label>
                <input
                  type="number"
                  value={molarityVolume}
                  onChange={(e) => setMolarityVolume(e.target.value)}
                  placeholder="e.g. 10"
                  style={inputStyle}
                />
                <select value={molarityVolumeUnit} onChange={(e) => setMolarityVolumeUnit(e.target.value as any)} style={selectStyle}>
                  <option value="L">L</option>
                  <option value="mL">mL</option>
                  <option value="µL">µL</option>
                </select>
              </div>
            </>
          )}

          <div style={{ marginTop: '24px' }}>
            <button onClick={calculateMolarity} style={styles.primaryButton}>
              Calculate
            </button>
          </div>

          {molarityResult && (
            <div style={{
              marginTop: '20px',
              padding: '16px 20px',
              background: molarityResult.startsWith('Please') || molarityResult.startsWith('Error') ? '#fef2f2' : '#dcfce7',
              borderRadius: '12px',
              fontSize: '18px',
              fontWeight: 600,
              color: molarityResult.startsWith('Please') || molarityResult.startsWith('Error') ? '#dc2626' : '#166534'
            }}>
              {molarityResult}
            </div>
          )}

          {/* Formula reference */}
          <div style={{ marginTop: '32px', padding: '16px', background: '#f8fafc', borderRadius: '8px', fontSize: '13px', color: '#64748b' }}>
            <strong>Formula:</strong> Mass (g) = Concentration (mol/L) × Volume (L) × Molecular Weight (g/mol)
          </div>
        </div>
      ) : (
        <div style={styles.section}>
          <h3 style={styles.sectionTitle}>Dilution Calculator (C₁V₁ = C₂V₂)</h3>
          <p style={{ color: '#64748b', marginBottom: '20px', fontSize: '14px' }}>
            Calculate stock volume, final concentration, or final volume for dilutions
          </p>

          {/* Mode selector */}
          <div style={{ marginBottom: '24px' }}>
            <label style={{ fontWeight: 500, marginRight: '12px' }}>Calculate:</label>
            <select 
              value={dilutionMode} 
              onChange={(e) => { setDilutionMode(e.target.value as any); setDilutionResult(null); }}
              style={{ ...selectStyle, width: '280px' }}
            >
              <option value="V1">V₁ - Volume of stock solution needed</option>
              <option value="C2">C₂ - Final concentration after dilution</option>
              <option value="V2">V₂ - Final volume of diluted solution</option>
            </select>
          </div>

          {/* C1 - Stock concentration (always shown) */}
          <div style={rowStyle}>
            <label style={labelStyle}>C₁ (Stock Concentration)</label>
            <input
              type="number"
              value={c1}
              onChange={(e) => setC1(e.target.value)}
              placeholder="e.g. 10"
              style={inputStyle}
            />
            <select value={c1Unit} onChange={(e) => setC1Unit(e.target.value as any)} style={selectStyle}>
              <option value="M">M</option>
              <option value="mM">mM</option>
              <option value="µM">µM</option>
              <option value="nM">nM</option>
            </select>
          </div>

          {/* V1 - Stock volume (shown when not calculating V1) */}
          {dilutionMode !== 'V1' && (
            <div style={rowStyle}>
              <label style={labelStyle}>V₁ (Stock Volume)</label>
              <input
                type="number"
                value={v1}
                onChange={(e) => setV1(e.target.value)}
                placeholder="e.g. 100"
                style={inputStyle}
              />
              <select value={v1Unit} onChange={(e) => setV1Unit(e.target.value as any)} style={selectStyle}>
                <option value="L">L</option>
                <option value="mL">mL</option>
                <option value="µL">µL</option>
              </select>
            </div>
          )}

          {/* C2 - Final concentration (shown when not calculating C2) */}
          {dilutionMode !== 'C2' && (
            <div style={rowStyle}>
              <label style={labelStyle}>C₂ (Final Concentration)</label>
              <input
                type="number"
                value={c2}
                onChange={(e) => setC2(e.target.value)}
                placeholder="e.g. 50"
                style={inputStyle}
              />
              <select value={c2Unit} onChange={(e) => setC2Unit(e.target.value as any)} style={selectStyle}>
                <option value="M">M</option>
                <option value="mM">mM</option>
                <option value="µM">µM</option>
                <option value="nM">nM</option>
              </select>
            </div>
          )}

          {/* V2 - Final volume (shown when not calculating V2) */}
          {dilutionMode !== 'V2' && (
            <div style={rowStyle}>
              <label style={labelStyle}>V₂ (Final Volume)</label>
              <input
                type="number"
                value={v2}
                onChange={(e) => setV2(e.target.value)}
                placeholder="e.g. 20"
                style={inputStyle}
              />
              <select value={v2Unit} onChange={(e) => setV2Unit(e.target.value as any)} style={selectStyle}>
                <option value="L">L</option>
                <option value="mL">mL</option>
                <option value="µL">µL</option>
              </select>
            </div>
          )}

          <div style={{ marginTop: '24px' }}>
            <button onClick={calculateDilution} style={styles.primaryButton}>
              Calculate
            </button>
          </div>

          {dilutionResult && (
            <div style={{
              marginTop: '20px',
              padding: '16px 20px',
              background: dilutionResult.startsWith('Please') || dilutionResult.startsWith('Error') ? '#fef2f2' : '#dcfce7',
              borderRadius: '12px',
              fontSize: '18px',
              fontWeight: 600,
              color: dilutionResult.startsWith('Please') || dilutionResult.startsWith('Error') ? '#dc2626' : '#166534'
            }}>
              {dilutionResult}
            </div>
          )}

          {/* Formula reference */}
          <div style={{ marginTop: '32px', padding: '16px', background: '#f8fafc', borderRadius: '8px', fontSize: '13px', color: '#64748b' }}>
            <strong>Formula:</strong> C₁ × V₁ = C₂ × V₂
            <br />
            <span style={{ marginTop: '4px', display: 'block' }}>
              Where C₁ = stock concentration, V₁ = stock volume, C₂ = final concentration, V₂ = final volume
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// Troubleshooting Panel - Shows experiments grouped by type with troubleshooting notes
function TroubleshootingPanel({ user }: { user: AuthUser }) {
  const [experiments, setExperiments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [expandedExperiment, setExpandedExperiment] = useState<string | null>(null);

  useEffect(() => {
    loadExperiments();
  }, []);

  const loadExperiments = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/experiments`, {
        headers: { 'x-user-id': user.id }
      });
      if (res.ok) {
        const data = await res.json();
        // Filter to only show experiments with troubleshooting notes
        setExperiments(data);
      }
    } catch (error) {
      console.error('Failed to load experiments:', error);
    } finally {
      setLoading(false);
    }
  };

  // Group experiments by modality/type
  const experimentsByType = useMemo(() => {
    const grouped: Record<string, any[]> = {};
    for (const exp of experiments) {
      const type = exp.modality === 'other' && exp.customModality 
        ? exp.customModality 
        : exp.modality;
      const displayType = exp.modality === 'other' && exp.customModality 
        ? `Other: ${exp.customModality}` 
        : formatModality(exp.modality);
      
      if (!grouped[type]) {
        grouped[type] = [];
      }
      grouped[type].push({ ...exp, displayType });
    }
    return grouped;
  }, [experiments]);

  // Get experiments with troubleshooting notes
  const experimentsWithNotes = useMemo(() => {
    return experiments.filter(e => e.troubleshootingNotes && e.troubleshootingNotes.trim());
  }, [experiments]);

  // Get types that have experiments with troubleshooting notes
  const typesWithNotes = useMemo(() => {
    const types = new Set<string>();
    for (const exp of experimentsWithNotes) {
      const type = exp.modality === 'other' && exp.customModality 
        ? exp.customModality 
        : exp.modality;
      types.add(type);
    }
    return Array.from(types);
  }, [experimentsWithNotes]);

  const selectedExperiments = selectedType 
    ? experimentsByType[selectedType]?.filter(e => e.troubleshootingNotes && e.troubleshootingNotes.trim()) || []
    : experimentsWithNotes;

  return (
    <div style={styles.panel}>
      <div style={styles.header}>
        <div>
          <h2 style={styles.pageTitle}>🔧 Troubleshooting Documentation</h2>
          <p style={styles.pageSubtitle}>Browse troubleshooting notes organized by experiment type</p>
        </div>
      </div>

      {loading ? (
        <div style={styles.emptyState}><p>Loading...</p></div>
      ) : experimentsWithNotes.length === 0 ? (
        <div style={styles.emptyState}>
          <p>No troubleshooting notes found.</p>
          <p style={{ fontSize: '14px', color: '#64748b', marginTop: '8px' }}>
            Add troubleshooting notes to your experiments to document issues and solutions.
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: '24px' }}>
          {/* Left sidebar - Experiment types */}
          <div style={{ 
            width: '250px', 
            flexShrink: 0, 
            background: '#f8fafc', 
            borderRadius: '12px', 
            padding: '16px',
            height: 'fit-content'
          }}>
            <h3 style={{ margin: '0 0 16px 0', fontSize: '14px', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Experiment Types
            </h3>
            <button
              onClick={() => setSelectedType(null)}
              style={{
                width: '100%',
                padding: '10px 12px',
                textAlign: 'left',
                background: selectedType === null ? '#3b82f6' : 'transparent',
                color: selectedType === null ? 'white' : '#1e293b',
                border: 'none',
                borderRadius: '8px',
                cursor: 'pointer',
                marginBottom: '4px',
                fontWeight: selectedType === null ? 600 : 400,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
              }}
            >
              <span>All Types</span>
              <span style={{ 
                background: selectedType === null ? 'rgba(255,255,255,0.2)' : '#e2e8f0',
                padding: '2px 8px',
                borderRadius: '12px',
                fontSize: '12px'
              }}>
                {experimentsWithNotes.length}
              </span>
            </button>
            
            {typesWithNotes.map(type => {
              const count = experimentsByType[type]?.filter(e => e.troubleshootingNotes && e.troubleshootingNotes.trim()).length || 0;
              const displayName = MODALITIES.includes(type as any) ? formatModality(type) : `Other: ${type}`;
              return (
                <button
                  key={type}
                  onClick={() => setSelectedType(type)}
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    textAlign: 'left',
                    background: selectedType === type ? '#3b82f6' : 'transparent',
                    color: selectedType === type ? 'white' : '#1e293b',
                    border: 'none',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    marginBottom: '4px',
                    fontWeight: selectedType === type ? 600 : 400,
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center'
                  }}
                >
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {displayName}
                  </span>
                  <span style={{ 
                    background: selectedType === type ? 'rgba(255,255,255,0.2)' : '#e2e8f0',
                    padding: '2px 8px',
                    borderRadius: '12px',
                    fontSize: '12px',
                    flexShrink: 0
                  }}>
                    {count}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Main content - Troubleshooting notes list */}
          <div style={{ flex: 1 }}>
            <div style={{ marginBottom: '16px', color: '#64748b', fontSize: '14px' }}>
              Showing {selectedExperiments.length} experiment{selectedExperiments.length !== 1 ? 's' : ''} with troubleshooting notes
              {selectedType && ` in ${MODALITIES.includes(selectedType as any) ? formatModality(selectedType) : selectedType}`}
            </div>
            
            {selectedExperiments.map((exp: any) => (
              <div 
                key={exp.id} 
                style={{ 
                  background: 'white', 
                  borderRadius: '12px', 
                  border: '1px solid #e2e8f0',
                  marginBottom: '16px',
                  overflow: 'hidden'
                }}
              >
                <div 
                  onClick={() => setExpandedExperiment(expandedExperiment === exp.id ? null : exp.id)}
                  style={{ 
                    padding: '16px', 
                    cursor: 'pointer',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    background: expandedExperiment === exp.id ? '#f0f9ff' : 'white',
                    transition: 'background 0.2s'
                  }}
                >
                  <div>
                    <h4 style={{ margin: '0 0 4px 0', color: '#1e293b' }}>{exp.title}</h4>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                      <span style={{ 
                        ...styles.badge, 
                        background: '#dbeafe', 
                        color: '#1e40af',
                        fontSize: '11px'
                      }}>
                        {exp.displayType || formatModality(exp.modality)}
                      </span>
                      {exp.project && (
                        <span style={{ fontSize: '13px', color: '#64748b' }}>
                          {exp.project}
                        </span>
                      )}
                      <span style={{ fontSize: '12px', color: '#94a3b8' }}>
                        {new Date(exp.updatedAt).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                  <span style={{ fontSize: '20px', color: '#94a3b8' }}>
                    {expandedExperiment === exp.id ? '−' : '+'}
                  </span>
                </div>
                
                {expandedExperiment === exp.id && (
                  <div style={{ 
                    padding: '16px', 
                    borderTop: '1px solid #e2e8f0',
                    background: '#fffbeb'
                  }}>
                    <h5 style={{ margin: '0 0 8px 0', color: '#92400e', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      🔧 Troubleshooting Notes
                    </h5>
                    <pre style={{ 
                      margin: 0, 
                      whiteSpace: 'pre-wrap', 
                      fontFamily: 'inherit',
                      fontSize: '14px',
                      lineHeight: '1.6',
                      color: '#78350f'
                    }}>
                      {exp.troubleshootingNotes}
                    </pre>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

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
function SyncPanel({ user }: { user: AuthUser }) {
  const [exporting, setExporting] = useState(false);
  const [exportMessage, setExportMessage] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importMessage, setImportMessage] = useState<string | null>(null);

  const arrayBufferToBase64 = (buffer: ArrayBuffer) => {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
  };

  const handleExportUsb = useCallback(async () => {
    setExportMessage(null);
    setExporting(true);
    try {
      const res = await fetch(`${API_BASE}/sync/export`, {
        headers: { 'x-user-id': user.id },
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(text || `Export failed (${res.status})`);
      }

      const data = await res.arrayBuffer();
      const safeTimestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const defaultName = `eln-usb-sync-${safeTimestamp}.zip`;

      const elnApi = (window as any).eln as undefined | { saveZip?: (defaultPath: string, data: ArrayBuffer) => Promise<any> };
      if (elnApi?.saveZip) {
        const result = await elnApi.saveZip(defaultName, data);
        if (result?.canceled) {
          setExportMessage('Export cancelled.');
        } else {
          setExportMessage(`Exported to: ${result?.filePath || defaultName}`);
        }
        return;
      }

      // Fallback for non-Electron environments: trigger a browser download.
      const blob = new Blob([data], { type: 'application/zip' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = defaultName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setExportMessage('Export downloaded.');
    } catch (error: any) {
      setExportMessage(error?.message || 'Export failed.');
    } finally {
      setExporting(false);
    }
  }, [user.id]);

  const handleImportUsb = useCallback(async () => {
    setImportMessage(null);
    setImporting(true);
    try {
      const elnApi = (window as any).eln as undefined | {
        openZip?: () => Promise<{ canceled: true } | { canceled: false; filePath: string; data: ArrayBuffer }>;
      };
      if (!elnApi?.openZip) {
        throw new Error('Import is only available in the desktop app.');
      }

      const pick = await elnApi.openZip();
      if ((pick as any)?.canceled) {
        setImportMessage('Import cancelled.');
        return;
      }

      const bundleBase64 = arrayBufferToBase64((pick as any).data);
      const res = await fetch(`${API_BASE}/sync/import`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': user.id,
        },
        body: JSON.stringify({ bundleBase64 }),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(text || `Import failed (${res.status})`);
      }
      const result = await res.json().catch(() => null);
      if (result?.status === 'imported') {
        setImportMessage(`Imported. Created: ${result.created}, Updated: ${result.updated}, Files: ${result.filesWritten}`);
      } else {
        setImportMessage('Import completed.');
      }
    } catch (error: any) {
      setImportMessage(error?.message || 'Import failed.');
    } finally {
      setImporting(false);
    }
  }, [user.id]);

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

        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginTop: '12px', flexWrap: 'wrap' }}>
          <button style={styles.secondaryButton} onClick={handleExportUsb} disabled={exporting}>
            {exporting ? 'Exporting…' : 'Export database (USB)'}
          </button>
          {exportMessage && <span style={{ fontSize: '12px', color: '#374151' }}>{exportMessage}</span>}
        </div>

        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginTop: '10px', flexWrap: 'wrap' }}>
          <button style={styles.secondaryButton} onClick={handleImportUsb} disabled={importing}>
            {importing ? 'Importing…' : 'Import bundle (USB)'}
          </button>
          {importMessage && <span style={{ fontSize: '12px', color: '#374151' }}>{importMessage}</span>}
        </div>
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
  if (modality === 'other') return 'Other';
  return modality.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// Admin Panel - For viewing all lab members' notebooks
function AdminPanel({ user }: { user: AuthUser }) {
  const [activeTab, setActiveTab] = useState<'users' | 'experiments' | 'methods'>('users');
  const [users, setUsers] = useState<any[]>([]);
  const [allExperiments, setAllExperiments] = useState<any[]>([]);
  const [allMethods, setAllMethods] = useState<any[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [actionMessage, setActionMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

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

  const updateUserRole = async (userId: string, newRole: string) => {
    setActionMessage(null);
    try {
      const res = await fetch(`${API_BASE}/admin/users/${userId}/role`, {
        method: 'PATCH',
        headers: { 'x-user-id': user.id, 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: newRole })
      });
      if (res.ok) {
        const updatedUser = await res.json();
        setUsers(users.map(u => u.id === userId ? { ...u, role: updatedUser.role } : u));
        setActionMessage({ type: 'success', text: `Role updated to ${newRole}` });
      } else {
        const err = await res.json();
        setActionMessage({ type: 'error', text: err.error || 'Failed to update role' });
      }
    } catch (error) {
      setActionMessage({ type: 'error', text: 'Failed to update role' });
    }
  };

  const toggleUserStatus = async (userId: string, currentActive: boolean) => {
    setActionMessage(null);
    try {
      const res = await fetch(`${API_BASE}/admin/users/${userId}/status`, {
        method: 'PATCH',
        headers: { 'x-user-id': user.id, 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: !currentActive })
      });
      if (res.ok) {
        const updatedUser = await res.json();
        setUsers(users.map(u => u.id === userId ? { ...u, active: updatedUser.active } : u));
        setActionMessage({ type: 'success', text: `User ${updatedUser.active ? 'activated' : 'deactivated'}` });
      } else {
        const err = await res.json();
        setActionMessage({ type: 'error', text: err.error || 'Failed to update status' });
      }
    } catch (error) {
      setActionMessage({ type: 'error', text: 'Failed to update status' });
    }
  };

  const resetUserPassword = async (userId: string, userName: string) => {
    if (!window.confirm(`Are you sure you want to reset the password for ${userName}?\n\nA temporary password will be generated that must be securely communicated to the user.`)) {
      return;
    }
    
    setActionMessage(null);
    try {
      const res = await fetch(`${API_BASE}/admin/users/${userId}/reset-password`, {
        method: 'POST',
        headers: { 'x-user-id': user.id, 'Content-Type': 'application/json' }
      });
      
      if (res.ok) {
        const data = await res.json();
        // Show the temporary password in a clear way
        setActionMessage({ 
          type: 'success', 
          text: `Password reset for ${userName}. Temporary password: ${data.temporaryPassword} — Please securely communicate this to the user.`
        });
      } else {
        const err = await res.json();
        setActionMessage({ type: 'error', text: err.error || 'Failed to reset password' });
      }
    } catch (error) {
      setActionMessage({ type: 'error', text: 'Failed to reset password' });
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
        <div>
          {actionMessage && (
            <div style={{
              padding: '12px 16px',
              marginBottom: '16px',
              borderRadius: '8px',
              background: actionMessage.type === 'success' ? '#dcfce7' : '#fef2f2',
              color: actionMessage.type === 'success' ? '#166534' : '#dc2626',
              fontSize: '14px'
            }}>
              {actionMessage.text}
            </div>
          )}
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
                    <td style={styles.td}>
                      {u.name}
                      {u.id === user.id && <span style={{ marginLeft: 6, fontSize: 11, color: '#64748b' }}>(you)</span>}
                    </td>
                    <td style={styles.td}>{u.email || '—'}</td>
                    <td style={styles.td}>
                      {user.role === 'admin' && u.id !== user.id ? (
                        <select
                          value={u.role}
                          onChange={(e) => updateUserRole(u.id, e.target.value)}
                          style={{
                            padding: '4px 8px',
                            borderRadius: '6px',
                            border: '1px solid #e2e8f0',
                            background: u.role === 'admin' ? '#fef2f2' : u.role === 'manager' ? '#fffbeb' : '#eff6ff',
                            color: u.role === 'admin' ? '#dc2626' : u.role === 'manager' ? '#d97706' : '#2563eb',
                            fontWeight: 600,
                            fontSize: '13px',
                            cursor: 'pointer'
                          }}
                        >
                          <option value="member">Member</option>
                          <option value="manager">Manager</option>
                          <option value="admin">Admin</option>
                        </select>
                      ) : (
                        <span style={{
                          ...styles.badge,
                          background: u.role === 'admin' ? '#ef444420' : u.role === 'manager' ? '#f59e0b20' : '#3b82f620',
                          color: u.role === 'admin' ? '#ef4444' : u.role === 'manager' ? '#f59e0b' : '#3b82f6'
                        }}>
                          {u.role}
                        </span>
                      )}
                    </td>
                    <td style={styles.td}>{u._count?.experiments || 0}</td>
                    <td style={styles.td}>{u._count?.methods || 0}</td>
                    <td style={styles.td}>
                      {user.role === 'admin' && u.id !== user.id ? (
                        <button
                          onClick={() => toggleUserStatus(u.id, u.active)}
                          style={{
                            padding: '4px 10px',
                            borderRadius: '6px',
                            border: 'none',
                            background: u.active ? '#dcfce7' : '#fef2f2',
                            color: u.active ? '#166534' : '#dc2626',
                            fontSize: '12px',
                            cursor: 'pointer',
                            fontWeight: 500
                          }}
                          title={u.active ? 'Click to deactivate' : 'Click to activate'}
                        >
                          {u.active ? '● Active' : '○ Inactive'}
                        </button>
                      ) : (
                        <span style={{ color: u.active ? '#10b981' : '#ef4444' }}>
                          {u.active ? '● Active' : '○ Inactive'}
                        </span>
                      )}
                    </td>
                    <td style={styles.td}>
                      <button 
                        style={styles.iconButton} 
                        onClick={() => loadUserExperiments(u.id)}
                        title="View Experiments"
                      >
                        📂
                      </button>
                      {u.id !== user.id && (user.role === 'admin' || (user.role === 'manager' && u.role !== 'admin')) && (
                        <button 
                          style={{ ...styles.iconButton, marginLeft: '4px' }}
                          onClick={() => resetUserPassword(u.id, u.name)}
                          title="Reset Password"
                        >
                          🔑
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {users.length === 0 && (
              <div style={styles.emptyState}><p>No lab members found.</p></div>
            )}
          </div>
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
  methodSteps: {
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    lineHeight: 1.5,
    fontSize: 14,
    color: '#0f172a',
  },
};

export default App;
