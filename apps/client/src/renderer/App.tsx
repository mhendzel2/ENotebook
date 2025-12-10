import React, { useMemo } from 'react';
import { MODALITIES, Modality, Method, Experiment } from '@eln/shared';
import { v4 as uuid } from 'uuid';

type NavTab = 'dashboard' | 'methods' | 'experiments' | 'sync';

const sampleMethods: Method[] = [
  {
    id: uuid(),
    title: 'Fluorescence imaging baseline',
    category: 'fluorescence',
    steps: { text: 'Configure laser lines, set exposure, acquire 10 fields.' },
    reagents: { fluorophores: ['GFP'], buffer: 'PBS' },
    attachments: [],
    createdBy: 'manager',
    version: 1,
    updatedAt: new Date().toISOString(),
    isPublic: true
  }
];

const sampleExperiments: Experiment[] = [
  {
    id: uuid(),
    userId: 'user-1',
    title: 'Cell dynamics tracking',
    project: 'Live cell imaging',
    modality: 'biophysical',
    protocolRef: sampleMethods[0].id,
    params: { frame_rate: 30, roi_definition: 'manual', tracking: 'optical_flow' },
    observations: { text: 'Stable signal over 10 min.' },
    resultsSummary: 'Tracking successful; exporting trajectories.',
    dataLink: 'file:///data/exp1',
    tags: ['tracking', 'fluorescence'],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    version: 1
  }
];

function App() {
  const [tab, setTab] = React.useState<NavTab>('dashboard');
  const methods = useMemo(() => sampleMethods, []);
  const experiments = useMemo(() => sampleExperiments, []);

  return (
    <div style={styles.app}>
      <aside style={styles.sidebar}>
        <h1 style={styles.logo}>ELN</h1>
        <nav>
          <NavButton label="Dashboard" active={tab === 'dashboard'} onClick={() => setTab('dashboard')} />
          <NavButton label="Methods" active={tab === 'methods'} onClick={() => setTab('methods')} />
          <NavButton label="Experiments" active={tab === 'experiments'} onClick={() => setTab('experiments')} />
          <NavButton label="Sync" active={tab === 'sync'} onClick={() => setTab('sync')} />
        </nav>
      </aside>
      <main style={styles.main}>
        {tab === 'dashboard' && <Dashboard methods={methods} experiments={experiments} />}
        {tab === 'methods' && <Methods methods={methods} />}
        {tab === 'experiments' && <Experiments experiments={experiments} methods={methods} />}
        {tab === 'sync' && <SyncPanel />}
      </main>
    </div>
  );
}

function Dashboard({ methods, experiments }: { methods: Method[]; experiments: Experiment[] }) {
  return (
    <div style={styles.section}>
      <h2>Overview</h2>
      <div style={styles.grid}>
        <Card title="Methods" value={`${methods.length} saved`} />
        <Card title="Experiments" value={`${experiments.length} entries`} />
        <Card title="Sync" value="Offline-first; pending 0 changes" />
      </div>
    </div>
  );
}

function Methods({ methods }: { methods: Method[] }) {
  return (
    <div style={styles.section}>
      <h2>Methods library</h2>
      <table style={styles.table}>
        <thead>
          <tr>
            <th>Title</th>
            <th>Category</th>
            <th>Updated</th>
          </tr>
        </thead>
        <tbody>
          {methods.map((m) => (
            <tr key={m.id}>
              <td>{m.title}</td>
              <td>{m.category}</td>
              <td>{new Date(m.updatedAt).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Experiments({ experiments, methods }: { experiments: Experiment[]; methods: Method[] }) {
  const methodsMap = useMemo(() => new Map(methods.map((m) => [m.id, m])), [methods]);
  return (
    <div style={styles.section}>
      <h2>Experiments</h2>
      <table style={styles.table}>
        <thead>
          <tr>
            <th>Title</th>
            <th>Modality</th>
            <th>Protocol</th>
            <th>Data link</th>
            <th>Updated</th>
          </tr>
        </thead>
        <tbody>
          {experiments.map((e) => (
            <tr key={e.id}>
              <td>{e.title}</td>
              <td>{formatModality(e.modality)}</td>
              <td>{methodsMap.get(e.protocolRef || '')?.title ?? '—'}</td>
              <td>{e.dataLink}</td>
              <td>{new Date(e.updatedAt).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SyncPanel() {
  return (
    <div style={styles.section}>
      <h2>Sync status</h2>
      <ul>
        <li>Device ID: pending</li>
        <li>Last pulled: pending</li>
        <li>Last pushed: pending</li>
        <li>Pending changes: 0</li>
      </ul>
    </div>
  );
}

function NavButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{ ...styles.navButton, ...(active ? styles.navButtonActive : {}) }}>
      {label}
    </button>
  );
}

function Card({ title, value }: { title: string; value: string }) {
  return (
    <div style={styles.card}>
      <div style={{ fontSize: 12, color: '#666' }}>{title}</div>
      <div style={{ fontSize: 22, fontWeight: 600 }}>{value}</div>
    </div>
  );
}

function formatModality(modality: Modality) {
  return modality.replace('_', ' ');
}

const styles: Record<string, React.CSSProperties> = {
  app: {
    display: 'flex',
    minHeight: '100vh',
    fontFamily: 'Segoe UI, sans-serif',
    background: '#f6f8fb',
    color: '#0f172a'
  },
  sidebar: {
    width: 220,
    padding: '16px',
    background: '#0f172a',
    color: '#e2e8f0',
    display: 'flex',
    flexDirection: 'column',
    gap: 12
  },
  logo: { margin: 0, fontSize: 18, letterSpacing: 1.2 },
  navButton: {
    width: '100%',
    padding: '10px 12px',
    textAlign: 'left',
    background: 'transparent',
    border: '1px solid rgba(226,232,240,0.15)',
    color: '#e2e8f0',
    borderRadius: 8,
    cursor: 'pointer',
    fontWeight: 500
  },
  navButtonActive: {
    background: '#1e293b'
  },
  main: {
    flex: 1,
    padding: '24px'
  },
  section: {
    background: '#fff',
    borderRadius: 12,
    padding: '20px',
    boxShadow: '0 10px 30px rgba(15,23,42,0.08)',
    height: 'fit-content'
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
    gap: 16
  },
  card: {
    background: '#f8fafc',
    border: '1px solid #e2e8f0',
    borderRadius: 10,
    padding: 14
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse'
  }
};

export default App;
