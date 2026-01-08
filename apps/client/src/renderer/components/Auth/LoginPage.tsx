import React, { useState } from 'react';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:4000';

interface LoginPageProps {
  onLogin: (user: AuthUser) => void;
  onCreateAccount: () => void;
  existingUser?: AuthUser;
  onContinueExistingUser?: () => void;
  onSwitchUser?: () => void;
}

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: string;
  token?: string;
}

const ROLE_LABELS: Record<string, { label: string; color: string; bgColor: string }> = {
  admin: { label: 'Administrator', color: '#dc2626', bgColor: '#fef2f2' },
  manager: { label: 'Lab Manager', color: '#d97706', bgColor: '#fffbeb' },
  member: { label: 'Lab Member', color: '#2563eb', bgColor: '#eff6ff' },
};

export function LoginPage({ onLogin, onCreateAccount, existingUser, onContinueExistingUser, onSwitchUser }: LoginPageProps) {
  const [email, setEmail] = useState('');
  const [isAdminLogin, setIsAdminLogin] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [hintLoading, setHintLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setHint(null);
    setLoading(true);

    try {
      const response = await fetch(`${API_BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Login failed');
      }

      const user = await response.json();
      
      // If admin login mode, verify user is admin or manager
      if (isAdminLogin && user.role !== 'admin' && user.role !== 'manager') {
        throw new Error('Access denied. Administrator or Manager credentials required.');
      }
      
      localStorage.setItem('eln-user', JSON.stringify(user));
      onLogin(user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const handleGetHint = async () => {
    setError(null);
    setHint(null);

    if (!email || !email.includes('@')) {
      setError('Enter your email first to get your hint');
      return;
    }

    setHintLoading(true);
    try {
      const response = await fetch(`${API_BASE}/api/auth/password-hint`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to retrieve hint');
      }

      const data = await response.json();
      setHint(typeof data?.hint === 'string' ? data.hint : null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to retrieve hint');
    } finally {
      setHintLoading(false);
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <div style={styles.logo}>
          <h1 style={styles.logoText}>ELN</h1>
          <p style={styles.subtitle}>Electronic Lab Notebook</p>
        </div>

        <form onSubmit={handleSubmit} style={styles.form}>
          <h2 style={styles.title}>{isAdminLogin ? '🔐 Admin / Manager Sign In' : 'Sign In'}</h2>

          {isAdminLogin && (
            <div style={styles.adminBanner}>
              <span style={styles.adminBannerIcon}>⚠️</span>
              <span>Administrative access requires Manager or Administrator credentials</span>
            </div>
          )}

          {existingUser && (
            <div style={styles.sessionBanner}>
              <div style={styles.sessionText}>
                Signed in as <strong>{existingUser.name}</strong>
                {existingUser.email ? ` (${existingUser.email})` : ''}
                {existingUser.role && (
                  <span style={{
                    ...styles.roleBadge,
                    marginLeft: 8,
                    background: ROLE_LABELS[existingUser.role]?.bgColor || '#f1f5f9',
                    color: ROLE_LABELS[existingUser.role]?.color || '#64748b',
                  }}>
                    {ROLE_LABELS[existingUser.role]?.label || existingUser.role}
                  </span>
                )}
              </div>
              <div style={styles.sessionActions}>
                <button
                  type="button"
                  onClick={onContinueExistingUser}
                  style={styles.sessionPrimaryButton}
                >
                  Continue
                </button>
                <button
                  type="button"
                  onClick={onSwitchUser}
                  style={styles.sessionSecondaryButton}
                >
                  Use different account
                </button>
              </div>
            </div>
          )}
          
          {error && <div style={styles.error}>{error}</div>}

          <div style={styles.field}>
            <label style={styles.label}>Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={styles.input}
              placeholder="Enter your email"
              required
              autoFocus
            />
          </div>

          <div style={styles.field}>
            <label style={styles.label}>Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={styles.input}
              placeholder="Enter your password"
              required
            />
          </div>

          <button
            type="button"
            onClick={handleGetHint}
            style={styles.secondaryButton}
            disabled={hintLoading}
          >
            {hintLoading ? 'Getting hint...' : 'Get password hint'}
          </button>

          {hint !== null && (
            <div style={styles.sessionBanner}>
              <div style={styles.sessionText}>
                <strong>Password hint:</strong> {hint || 'No hint set for this account.'}
              </div>
            </div>
          )}

          <button type="submit" style={styles.button} disabled={loading}>
            {loading ? 'Signing in...' : 'Sign In'}
          </button>

          <div style={styles.divider}>
            <span>or</span>
          </div>

          <button
            type="button"
            onClick={onCreateAccount}
            style={styles.secondaryButton}
          >
            Create New Account
          </button>

          <button
            type="button"
            onClick={() => setIsAdminLogin(!isAdminLogin)}
            style={styles.adminToggleButton}
          >
            {isAdminLogin ? '← Back to Regular Sign In' : '🔐 Administrator Login'}
          </button>
        </form>

        <p style={styles.footer}>
          Secure, compliant, and offline-first lab notebook
        </p>
      </div>
    </div>
  );
}

export function CreateAccountPage({ onBack, onAccountCreated }: {
  onBack: () => void;
  onAccountCreated: (user: AuthUser) => void;
}) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordHint, setPasswordHint] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (password.length < 12) {
      setError('Password must be at least 12 characters');
      return;
    }

    setLoading(true);

    try {
      const response = await fetch(`${API_BASE}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password, passwordHint: passwordHint.trim() ? passwordHint.trim() : undefined }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Registration failed');
      }

      const user = await response.json();
      localStorage.setItem('eln-user', JSON.stringify(user));
      onAccountCreated(user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <div style={styles.logo}>
          <h1 style={styles.logoText}>ELN</h1>
          <p style={styles.subtitle}>Electronic Lab Notebook</p>
        </div>

        <form onSubmit={handleSubmit} style={styles.form}>
          <h2 style={styles.title}>Create Account</h2>
          
          {error && <div style={styles.error}>{error}</div>}

          <div style={styles.field}>
            <label style={styles.label}>Full Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={styles.input}
              placeholder="Enter your full name"
              required
              autoFocus
            />
          </div>

          <div style={styles.field}>
            <label style={styles.label}>Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={styles.input}
              placeholder="Enter your email"
              required
            />
          </div>

          <div style={styles.field}>
            <label style={styles.label}>Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={styles.input}
              placeholder="At least 12 characters"
              required
            />
          </div>

          <div style={styles.field}>
            <label style={styles.label}>Password Hint (optional)</label>
            <input
              type="text"
              value={passwordHint}
              onChange={(e) => setPasswordHint(e.target.value)}
              style={styles.input}
              placeholder="A clue to help you remember"
            />
          </div>

          <div style={styles.field}>
            <label style={styles.label}>Confirm Password</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              style={styles.input}
              placeholder="Confirm your password"
              required
            />
          </div>

          <button type="submit" style={styles.button} disabled={loading}>
            {loading ? 'Creating account...' : 'Create Account'}
          </button>

          <button
            type="button"
            onClick={onBack}
            style={styles.linkButton}
          >
            ← Back to Sign In
          </button>
        </form>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    minHeight: '100vh',
    background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
    padding: 20,
  },
  card: {
    background: '#fff',
    borderRadius: 16,
    padding: 40,
    width: '100%',
    maxWidth: 400,
    boxShadow: '0 25px 50px rgba(0, 0, 0, 0.25)',
  },
  logo: {
    textAlign: 'center',
    marginBottom: 32,
  },
  logoText: {
    fontSize: 42,
    fontWeight: 700,
    color: '#0f172a',
    margin: 0,
    letterSpacing: 4,
  },
  subtitle: {
    color: '#64748b',
    margin: '8px 0 0',
    fontSize: 14,
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
  },
  title: {
    fontSize: 20,
    fontWeight: 600,
    color: '#0f172a',
    margin: '0 0 8px',
    textAlign: 'center',
  },
  sessionBanner: {
    border: '1px solid #e2e8f0',
    background: '#f8fafc',
    borderRadius: 12,
    padding: 12,
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  sessionText: {
    fontSize: 13,
    color: '#0f172a',
    textAlign: 'center',
  },
  sessionActions: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  sessionPrimaryButton: {
    padding: '10px 12px',
    fontSize: 14,
    fontWeight: 600,
    color: '#fff',
    background: '#0f172a',
    border: 'none',
    borderRadius: 8,
    cursor: 'pointer',
  },
  sessionSecondaryButton: {
    padding: '10px 12px',
    fontSize: 14,
    fontWeight: 600,
    color: '#0f172a',
    background: '#fff',
    border: '1px solid #e2e8f0',
    borderRadius: 8,
    cursor: 'pointer',
  },
  field: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  label: {
    fontSize: 14,
    fontWeight: 500,
    color: '#334155',
  },
  input: {
    padding: '12px 14px',
    fontSize: 15,
    border: '1px solid #e2e8f0',
    borderRadius: 8,
    outline: 'none',
    transition: 'border-color 0.2s, box-shadow 0.2s',
  },
  button: {
    padding: '14px 20px',
    fontSize: 16,
    fontWeight: 600,
    color: '#fff',
    background: '#0f172a',
    border: 'none',
    borderRadius: 8,
    cursor: 'pointer',
    marginTop: 8,
    transition: 'background 0.2s',
  },
  secondaryButton: {
    padding: '12px 20px',
    fontSize: 15,
    fontWeight: 500,
    color: '#0f172a',
    background: '#f1f5f9',
    border: '1px solid #e2e8f0',
    borderRadius: 8,
    cursor: 'pointer',
  },
  linkButton: {
    padding: '8px',
    fontSize: 14,
    color: '#64748b',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    textAlign: 'center',
  },
  divider: {
    display: 'flex',
    alignItems: 'center',
    gap: 16,
    color: '#94a3b8',
    fontSize: 13,
  },
  error: {
    padding: '12px 14px',
    background: '#fef2f2',
    color: '#dc2626',
    borderRadius: 8,
    fontSize: 14,
  },
  footer: {
    textAlign: 'center',
    color: '#94a3b8',
    fontSize: 12,
    marginTop: 24,
  },
  adminBanner: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '12px 14px',
    background: '#fef3c7',
    color: '#92400e',
    borderRadius: 8,
    fontSize: 13,
    border: '1px solid #fcd34d',
  },
  adminBannerIcon: {
    fontSize: 16,
  },
  adminToggleButton: {
    padding: '10px 16px',
    fontSize: 14,
    fontWeight: 500,
    color: '#64748b',
    background: 'transparent',
    border: '1px dashed #cbd5e1',
    borderRadius: 8,
    cursor: 'pointer',
    marginTop: 8,
    transition: 'all 0.2s',
  },
  roleBadge: {
    display: 'inline-block',
    padding: '4px 10px',
    borderRadius: 12,
    fontSize: 12,
    fontWeight: 600,
  },
};

export default LoginPage;
