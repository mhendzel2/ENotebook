/**
 * Enhanced Sync Panel Component
 * Provides comprehensive UI for:
 * - Real-time sync status display
 * - Pending changes queue with retry/cancel
 * - Conflict resolution interface
 * - Selective sync configuration
 * - Storage quota display
 */

import React, { useState, useEffect, useCallback } from 'react';

// ==================== TYPES ====================

interface SyncStatus {
  status: 'idle' | 'syncing' | 'pending' | 'error' | 'offline' | 'conflict';
  isOnline: boolean;
  deviceId: string;
  lastSyncAt: string | null;
  lastPushAt: string | null;
  lastPullAt: string | null;
  pendingChanges: number;
  pendingUploads: number;
  conflicts: number;
  errors: SyncError[];
  syncProgress?: SyncProgress;
}

interface SyncProgress {
  phase: 'pushing' | 'pulling' | 'resolving';
  current: number;
  total: number;
  currentItem?: string;
}

interface SyncError {
  id: string;
  message: string;
  code: string;
  timestamp: string;
  retryable: boolean;
}

interface PendingChange {
  id: string;
  entityType: string;
  entityId: string;
  operation: string;
  timestamp: string;
  retryCount: number;
  lastError?: string;
  priority: string;
  uploadProgress?: {
    loaded: number;
    total: number;
    percentage: number;
  };
}

interface SyncConflict {
  id: string;
  entityType: string;
  entityId: string;
  localVersion: number;
  serverVersion: number;
  localData: unknown;
  serverData: unknown;
  fieldConflicts: FieldConflict[];
  detectedAt: string;
}

interface FieldConflict {
  field: string;
  localValue: unknown;
  serverValue: unknown;
}

interface SelectiveSyncConfig {
  enabled: boolean;
  projects: string[];
  entityTypes: string[];
  dateRange?: { start: string; end: string };
  modalities?: string[];
  maxAttachmentSize?: number;
}

interface StorageQuota {
  used: number;
  available: number;
  total: number;
  breakdown: {
    experiments: number;
    methods: number;
    attachments: number;
    cache: number;
  };
}

// ==================== STYLES ====================

const styles: Record<string, React.CSSProperties> = {
  container: {
    padding: '16px',
    backgroundColor: '#fff',
    borderRadius: '8px',
    boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '16px',
  },
  title: {
    fontSize: '18px',
    fontWeight: 600,
    margin: 0,
  },
  statusBadge: {
    padding: '4px 12px',
    borderRadius: '12px',
    fontSize: '12px',
    fontWeight: 500,
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
  },
  section: {
    marginBottom: '20px',
    padding: '12px',
    backgroundColor: '#f9fafb',
    borderRadius: '6px',
  },
  sectionTitle: {
    fontSize: '14px',
    fontWeight: 600,
    marginBottom: '12px',
    color: '#374151',
  },
  statusGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
    gap: '12px',
  },
  statusItem: {
    textAlign: 'center' as const,
    padding: '8px',
    backgroundColor: '#fff',
    borderRadius: '6px',
    border: '1px solid #e5e7eb',
  },
  statusLabel: {
    fontSize: '11px',
    color: '#6b7280',
    marginBottom: '4px',
  },
  statusValue: {
    fontSize: '18px',
    fontWeight: 600,
    color: '#111827',
  },
  progressBar: {
    width: '100%',
    height: '8px',
    backgroundColor: '#e5e7eb',
    borderRadius: '4px',
    overflow: 'hidden',
    marginTop: '8px',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#3b82f6',
    transition: 'width 0.3s ease',
  },
  changeList: {
    maxHeight: '200px',
    overflowY: 'auto' as const,
  },
  changeItem: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '8px 12px',
    backgroundColor: '#fff',
    borderRadius: '4px',
    marginBottom: '6px',
    border: '1px solid #e5e7eb',
  },
  changeInfo: {
    flex: 1,
  },
  changeTitle: {
    fontSize: '13px',
    fontWeight: 500,
    color: '#111827',
  },
  changeMeta: {
    fontSize: '11px',
    color: '#6b7280',
    marginTop: '2px',
  },
  changeError: {
    fontSize: '11px',
    color: '#dc2626',
    marginTop: '4px',
  },
  button: {
    padding: '6px 12px',
    fontSize: '12px',
    fontWeight: 500,
    borderRadius: '4px',
    border: 'none',
    cursor: 'pointer',
    transition: 'background-color 0.2s',
  },
  primaryButton: {
    backgroundColor: '#3b82f6',
    color: '#fff',
  },
  secondaryButton: {
    backgroundColor: '#e5e7eb',
    color: '#374151',
  },
  dangerButton: {
    backgroundColor: '#fee2e2',
    color: '#dc2626',
  },
  buttonGroup: {
    display: 'flex',
    gap: '6px',
  },
  conflictCard: {
    backgroundColor: '#fef3c7',
    border: '1px solid #f59e0b',
    borderRadius: '6px',
    padding: '12px',
    marginBottom: '8px',
  },
  conflictHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '8px',
  },
  conflictTitle: {
    fontSize: '14px',
    fontWeight: 600,
    color: '#92400e',
  },
  conflictField: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '8px',
    marginTop: '8px',
    padding: '8px',
    backgroundColor: '#fff',
    borderRadius: '4px',
  },
  conflictValue: {
    fontSize: '12px',
    padding: '6px',
    backgroundColor: '#f9fafb',
    borderRadius: '4px',
    wordBreak: 'break-word' as const,
  },
  quotaBar: {
    width: '100%',
    height: '24px',
    backgroundColor: '#e5e7eb',
    borderRadius: '4px',
    overflow: 'hidden',
    display: 'flex',
  },
  quotaSegment: {
    height: '100%',
    transition: 'width 0.3s ease',
  },
  quotaLegend: {
    display: 'flex',
    flexWrap: 'wrap' as const,
    gap: '12px',
    marginTop: '8px',
    fontSize: '11px',
  },
  legendItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
  },
  legendDot: {
    width: '10px',
    height: '10px',
    borderRadius: '2px',
  },
  configForm: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '12px',
  },
  formGroup: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '4px',
  },
  label: {
    fontSize: '12px',
    fontWeight: 500,
    color: '#374151',
  },
  input: {
    padding: '8px 12px',
    fontSize: '13px',
    border: '1px solid #d1d5db',
    borderRadius: '4px',
    outline: 'none',
  },
  checkbox: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  tabs: {
    display: 'flex',
    borderBottom: '1px solid #e5e7eb',
    marginBottom: '16px',
  },
  tab: {
    padding: '8px 16px',
    fontSize: '13px',
    fontWeight: 500,
    border: 'none',
    backgroundColor: 'transparent',
    cursor: 'pointer',
    borderBottom: '2px solid transparent',
    color: '#6b7280',
    transition: 'all 0.2s',
  },
  activeTab: {
    color: '#3b82f6',
    borderBottomColor: '#3b82f6',
  },
};

// ==================== STATUS BADGE COLORS ====================

const statusColors: Record<string, { bg: string; text: string; icon: string }> = {
  idle: { bg: '#d1fae5', text: '#065f46', icon: '✓' },
  syncing: { bg: '#dbeafe', text: '#1e40af', icon: '⟳' },
  pending: { bg: '#fef3c7', text: '#92400e', icon: '○' },
  error: { bg: '#fee2e2', text: '#991b1b', icon: '✕' },
  offline: { bg: '#f3f4f6', text: '#374151', icon: '⊘' },
  conflict: { bg: '#fce7f3', text: '#9d174d', icon: '⚠' },
};

// ==================== HELPER FUNCTIONS ====================

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function formatRelativeTime(dateString: string | null): string {
  if (!dateString) return 'Never';
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${diffDays}d ago`;
}

function formatEntityType(type: string): string {
  return type.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase()).trim();
}

// ==================== COMPONENT ====================

interface SyncPanelProps {
  serverUrl?: string;
}

export const SyncPanel: React.FC<SyncPanelProps> = ({ serverUrl = '' }) => {
  const [activeTab, setActiveTab] = useState<'status' | 'pending' | 'conflicts' | 'config'>('status');
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [pendingChanges, setPendingChanges] = useState<PendingChange[]>([]);
  const [conflicts, setConflicts] = useState<SyncConflict[]>([]);
  const [quota, setQuota] = useState<StorageQuota | null>(null);
  const [config, setConfig] = useState<SelectiveSyncConfig | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);

  const baseUrl = serverUrl || window.location.origin;

  // Fetch all sync data
  const fetchSyncData = useCallback(async () => {
    try {
      const [statusRes, pendingRes, conflictsRes, quotaRes, configRes] = await Promise.all([
        fetch(`${baseUrl}/sync/status`),
        fetch(`${baseUrl}/sync/pending`),
        fetch(`${baseUrl}/sync/conflicts`),
        fetch(`${baseUrl}/sync/quota`),
        fetch(`${baseUrl}/sync/config`),
      ]);

      if (statusRes.ok) setStatus(await statusRes.json());
      if (pendingRes.ok) {
        const data = await pendingRes.json();
        setPendingChanges(data.pending || []);
      }
      if (conflictsRes.ok) {
        const data = await conflictsRes.json();
        setConflicts(data.conflicts || []);
      }
      if (quotaRes.ok) setQuota(await quotaRes.json());
      if (configRes.ok) setConfig(await configRes.json());
    } catch (error) {
      console.error('Failed to fetch sync data:', error);
    } finally {
      setIsLoading(false);
    }
  }, [baseUrl]);

  // Initial fetch and polling
  useEffect(() => {
    fetchSyncData();
    const interval = setInterval(fetchSyncData, 5000);
    return () => clearInterval(interval);
  }, [fetchSyncData]);

  // Trigger sync
  const handleSyncNow = async () => {
    setIsSyncing(true);
    try {
      const res = await fetch(`${baseUrl}/sync/now`, { method: 'POST' });
      if (res.ok) {
        await fetchSyncData();
      }
    } catch (error) {
      console.error('Sync failed:', error);
    } finally {
      setIsSyncing(false);
    }
  };

  // Retry pending change
  const handleRetry = async (changeId: string) => {
    try {
      await fetch(`${baseUrl}/sync/retry/${changeId}`, { method: 'POST' });
      await fetchSyncData();
    } catch (error) {
      console.error('Retry failed:', error);
    }
  };

  // Cancel pending change
  const handleCancel = async (changeId: string) => {
    if (!confirm('Are you sure you want to cancel this change?')) return;
    try {
      await fetch(`${baseUrl}/sync/pending/${changeId}`, { method: 'DELETE' });
      await fetchSyncData();
    } catch (error) {
      console.error('Cancel failed:', error);
    }
  };

  // Resolve conflict
  const handleResolveConflict = async (
    conflictId: string,
    resolution: 'client-wins' | 'server-wins' | 'merge'
  ) => {
    try {
      await fetch(`${baseUrl}/sync/conflicts/${conflictId}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resolution }),
      });
      await fetchSyncData();
    } catch (error) {
      console.error('Resolve failed:', error);
    }
  };

  // Update config
  const handleConfigUpdate = async (updates: Partial<SelectiveSyncConfig>) => {
    try {
      const res = await fetch(`${baseUrl}/sync/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...config, ...updates }),
      });
      if (res.ok) {
        const data = await res.json();
        setConfig(data.config);
      }
    } catch (error) {
      console.error('Config update failed:', error);
    }
  };

  if (isLoading) {
    return (
      <div style={styles.container}>
        <p>Loading sync status...</p>
      </div>
    );
  }

  const statusInfo = status ? statusColors[status.status] : statusColors.offline;

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <h3 style={styles.title}>Synchronization</h3>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <span
            style={{
              ...styles.statusBadge,
              backgroundColor: statusInfo.bg,
              color: statusInfo.text,
            }}
          >
            <span>{statusInfo.icon}</span>
            {status?.status.charAt(0).toUpperCase() + (status?.status.slice(1) || '')}
          </span>
          <button
            style={{ ...styles.button, ...styles.primaryButton }}
            onClick={handleSyncNow}
            disabled={isSyncing || status?.status === 'syncing'}
          >
            {isSyncing ? 'Syncing...' : 'Sync Now'}
          </button>
        </div>
      </div>

      {/* Sync Progress */}
      {status?.syncProgress && (
        <div style={styles.section}>
          <div style={styles.sectionTitle}>
            {status.syncProgress.phase === 'pushing' ? 'Uploading changes...' : 'Downloading updates...'}
          </div>
          <div style={styles.progressBar}>
            <div
              style={{
                ...styles.progressFill,
                width: `${(status.syncProgress.current / Math.max(status.syncProgress.total, 1)) * 100}%`,
              }}
            />
          </div>
          <div style={{ fontSize: '11px', color: '#6b7280', marginTop: '4px' }}>
            {status.syncProgress.current} / {status.syncProgress.total}
          </div>
        </div>
      )}

      {/* Tabs */}
      <div style={styles.tabs}>
        <button
          style={{ ...styles.tab, ...(activeTab === 'status' ? styles.activeTab : {}) }}
          onClick={() => setActiveTab('status')}
        >
          Status
        </button>
        <button
          style={{ ...styles.tab, ...(activeTab === 'pending' ? styles.activeTab : {}) }}
          onClick={() => setActiveTab('pending')}
        >
          Pending ({pendingChanges.length})
        </button>
        <button
          style={{ ...styles.tab, ...(activeTab === 'conflicts' ? styles.activeTab : {}) }}
          onClick={() => setActiveTab('conflicts')}
        >
          Conflicts ({conflicts.length})
        </button>
        <button
          style={{ ...styles.tab, ...(activeTab === 'config' ? styles.activeTab : {}) }}
          onClick={() => setActiveTab('config')}
        >
          Settings
        </button>
      </div>

      {/* Status Tab */}
      {activeTab === 'status' && status && (
        <>
          <div style={styles.section}>
            <div style={styles.statusGrid}>
              <div style={styles.statusItem}>
                <div style={styles.statusLabel}>Connection</div>
                <div style={{ ...styles.statusValue, color: status.isOnline ? '#059669' : '#dc2626' }}>
                  {status.isOnline ? 'Online' : 'Offline'}
                </div>
              </div>
              <div style={styles.statusItem}>
                <div style={styles.statusLabel}>Last Sync</div>
                <div style={styles.statusValue}>{formatRelativeTime(status.lastSyncAt)}</div>
              </div>
              <div style={styles.statusItem}>
                <div style={styles.statusLabel}>Pending</div>
                <div style={{ ...styles.statusValue, color: status.pendingChanges > 0 ? '#d97706' : '#059669' }}>
                  {status.pendingChanges}
                </div>
              </div>
              <div style={styles.statusItem}>
                <div style={styles.statusLabel}>Conflicts</div>
                <div style={{ ...styles.statusValue, color: status.conflicts > 0 ? '#dc2626' : '#059669' }}>
                  {status.conflicts}
                </div>
              </div>
            </div>
          </div>

          {/* Storage Quota */}
          {quota && (
            <div style={styles.section}>
              <div style={styles.sectionTitle}>Storage Usage</div>
              <div style={styles.quotaBar}>
                <div
                  style={{
                    ...styles.quotaSegment,
                    backgroundColor: '#3b82f6',
                    width: `${(quota.breakdown.experiments / quota.total) * 100}%`,
                  }}
                />
                <div
                  style={{
                    ...styles.quotaSegment,
                    backgroundColor: '#8b5cf6',
                    width: `${(quota.breakdown.methods / quota.total) * 100}%`,
                  }}
                />
                <div
                  style={{
                    ...styles.quotaSegment,
                    backgroundColor: '#10b981',
                    width: `${(quota.breakdown.attachments / quota.total) * 100}%`,
                  }}
                />
                <div
                  style={{
                    ...styles.quotaSegment,
                    backgroundColor: '#f59e0b',
                    width: `${(quota.breakdown.cache / quota.total) * 100}%`,
                  }}
                />
              </div>
              <div style={styles.quotaLegend}>
                <span style={styles.legendItem}>
                  <span style={{ ...styles.legendDot, backgroundColor: '#3b82f6' }} />
                  Experiments ({formatBytes(quota.breakdown.experiments)})
                </span>
                <span style={styles.legendItem}>
                  <span style={{ ...styles.legendDot, backgroundColor: '#8b5cf6' }} />
                  Methods ({formatBytes(quota.breakdown.methods)})
                </span>
                <span style={styles.legendItem}>
                  <span style={{ ...styles.legendDot, backgroundColor: '#10b981' }} />
                  Attachments ({formatBytes(quota.breakdown.attachments)})
                </span>
                <span style={styles.legendItem}>
                  <span style={{ ...styles.legendDot, backgroundColor: '#f59e0b' }} />
                  Cache ({formatBytes(quota.breakdown.cache)})
                </span>
              </div>
              <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '8px' }}>
                {formatBytes(quota.used)} used of {formatBytes(quota.total)} ({formatBytes(quota.available)} available)
              </div>
            </div>
          )}

          {/* Recent Errors */}
          {status.errors.length > 0 && (
            <div style={styles.section}>
              <div style={styles.sectionTitle}>Recent Errors</div>
              {status.errors.slice(-3).map((err) => (
                <div
                  key={err.id}
                  style={{
                    padding: '8px',
                    backgroundColor: '#fee2e2',
                    borderRadius: '4px',
                    marginBottom: '6px',
                    fontSize: '12px',
                    color: '#991b1b',
                  }}
                >
                  <strong>{err.code}</strong>: {err.message}
                  <div style={{ fontSize: '10px', color: '#b91c1c', marginTop: '2px' }}>
                    {formatRelativeTime(err.timestamp)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Pending Tab */}
      {activeTab === 'pending' && (
        <div style={styles.section}>
          {pendingChanges.length === 0 ? (
            <p style={{ color: '#6b7280', fontSize: '13px', textAlign: 'center' }}>
              No pending changes
            </p>
          ) : (
            <div style={styles.changeList}>
              {pendingChanges.map((change) => (
                <div key={change.id} style={styles.changeItem}>
                  <div style={styles.changeInfo}>
                    <div style={styles.changeTitle}>
                      {change.operation.toUpperCase()} {formatEntityType(change.entityType)}
                    </div>
                    <div style={styles.changeMeta}>
                      ID: {change.entityId.slice(0, 8)}... • {formatRelativeTime(change.timestamp)}
                      {change.retryCount > 0 && ` • Retries: ${change.retryCount}`}
                    </div>
                    {change.lastError && (
                      <div style={styles.changeError}>Error: {change.lastError}</div>
                    )}
                    {change.uploadProgress && (
                      <div style={{ ...styles.progressBar, marginTop: '6px', height: '4px' }}>
                        <div
                          style={{
                            ...styles.progressFill,
                            width: `${change.uploadProgress.percentage}%`,
                          }}
                        />
                      </div>
                    )}
                  </div>
                  <div style={styles.buttonGroup}>
                    {change.lastError && (
                      <button
                        style={{ ...styles.button, ...styles.secondaryButton }}
                        onClick={() => handleRetry(change.id)}
                      >
                        Retry
                      </button>
                    )}
                    <button
                      style={{ ...styles.button, ...styles.dangerButton }}
                      onClick={() => handleCancel(change.id)}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Conflicts Tab */}
      {activeTab === 'conflicts' && (
        <div style={styles.section}>
          {conflicts.length === 0 ? (
            <p style={{ color: '#6b7280', fontSize: '13px', textAlign: 'center' }}>
              No conflicts to resolve
            </p>
          ) : (
            conflicts.map((conflict) => (
              <div key={conflict.id} style={styles.conflictCard}>
                <div style={styles.conflictHeader}>
                  <div style={styles.conflictTitle}>
                    {formatEntityType(conflict.entityType)}: {conflict.entityId.slice(0, 8)}...
                  </div>
                  <div style={{ fontSize: '11px', color: '#92400e' }}>
                    Local v{conflict.localVersion} vs Server v{conflict.serverVersion}
                  </div>
                </div>

                {conflict.fieldConflicts.length > 0 && (
                  <div>
                    <div style={{ fontSize: '12px', fontWeight: 500, marginBottom: '4px' }}>
                      Conflicting Fields:
                    </div>
                    {conflict.fieldConflicts.map((field) => (
                      <div key={field.field} style={styles.conflictField}>
                        <div>
                          <div style={{ fontSize: '11px', color: '#6b7280' }}>Local ({field.field})</div>
                          <div style={styles.conflictValue}>
                            {JSON.stringify(field.localValue, null, 2)}
                          </div>
                        </div>
                        <div>
                          <div style={{ fontSize: '11px', color: '#6b7280' }}>Server ({field.field})</div>
                          <div style={styles.conflictValue}>
                            {JSON.stringify(field.serverValue, null, 2)}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <div style={{ ...styles.buttonGroup, marginTop: '12px', justifyContent: 'flex-end' }}>
                  <button
                    style={{ ...styles.button, ...styles.secondaryButton }}
                    onClick={() => handleResolveConflict(conflict.id, 'server-wins')}
                  >
                    Use Server
                  </button>
                  <button
                    style={{ ...styles.button, ...styles.primaryButton }}
                    onClick={() => handleResolveConflict(conflict.id, 'client-wins')}
                  >
                    Use Local
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Config Tab */}
      {activeTab === 'config' && config && (
        <div style={styles.section}>
          <div style={styles.configForm}>
            <div style={styles.checkbox}>
              <input
                type="checkbox"
                id="selective-enabled"
                checked={config.enabled}
                onChange={(e) => handleConfigUpdate({ enabled: e.target.checked })}
              />
              <label htmlFor="selective-enabled" style={styles.label}>
                Enable Selective Sync
              </label>
            </div>

            {config.enabled && (
              <>
                <div style={styles.formGroup}>
                  <label style={styles.label}>Projects (comma-separated)</label>
                  <input
                    type="text"
                    style={styles.input}
                    value={config.projects.join(', ')}
                    onChange={(e) =>
                      handleConfigUpdate({
                        projects: e.target.value
                          .split(',')
                          .map((p) => p.trim())
                          .filter(Boolean),
                      })
                    }
                    placeholder="Leave empty for all projects"
                  />
                </div>

                <div style={styles.formGroup}>
                  <label style={styles.label}>Modalities (comma-separated)</label>
                  <input
                    type="text"
                    style={styles.input}
                    value={config.modalities?.join(', ') || ''}
                    onChange={(e) =>
                      handleConfigUpdate({
                        modalities: e.target.value
                          .split(',')
                          .map((m) => m.trim())
                          .filter(Boolean),
                      })
                    }
                    placeholder="e.g., flow_cytometry, microscopy, qPCR"
                  />
                </div>

                <div style={styles.formGroup}>
                  <label style={styles.label}>Max Attachment Size (MB)</label>
                  <input
                    type="number"
                    style={styles.input}
                    value={(config.maxAttachmentSize || 0) / (1024 * 1024)}
                    onChange={(e) =>
                      handleConfigUpdate({
                        maxAttachmentSize: parseFloat(e.target.value) * 1024 * 1024,
                      })
                    }
                    placeholder="0 = no limit"
                    min="0"
                  />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                  <div style={styles.formGroup}>
                    <label style={styles.label}>Date From</label>
                    <input
                      type="date"
                      style={styles.input}
                      value={config.dateRange?.start?.split('T')[0] || ''}
                      onChange={(e) =>
                        handleConfigUpdate({
                          dateRange: {
                            start: e.target.value || new Date(0).toISOString(),
                            end: config.dateRange?.end || new Date().toISOString(),
                          },
                        })
                      }
                    />
                  </div>
                  <div style={styles.formGroup}>
                    <label style={styles.label}>Date To</label>
                    <input
                      type="date"
                      style={styles.input}
                      value={config.dateRange?.end?.split('T')[0] || ''}
                      onChange={(e) =>
                        handleConfigUpdate({
                          dateRange: {
                            start: config.dateRange?.start || new Date(0).toISOString(),
                            end: e.target.value || new Date().toISOString(),
                          },
                        })
                      }
                    />
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Device ID */}
      <div style={{ fontSize: '10px', color: '#9ca3af', marginTop: '12px' }}>
        Device: {status?.deviceId?.slice(0, 8)}...
      </div>
    </div>
  );
};

export default SyncPanel;
