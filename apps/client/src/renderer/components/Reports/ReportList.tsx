import React, { useState, useEffect, useCallback } from 'react';
import { Report, ReportType } from '@eln/shared';

interface ReportListProps {
  experimentId: string;
  reports?: Report[];
  onRefresh?: () => void;
  onDelete?: (report: Report) => void;
  readOnly?: boolean;
  apiBaseUrl?: string;
}

// Report type display names and colors
const REPORT_TYPE_CONFIG: Record<ReportType, { label: string; color: string; icon: string }> = {
  'FRAP': { label: 'FRAP Analysis', color: '#4caf50', icon: '📊' },
  'SPT': { label: 'Single Particle Tracking', color: '#2196f3', icon: '🔬' },
  'flow_cytometry': { label: 'Flow Cytometry', color: '#9c27b0', icon: '🧫' },
  'image_analysis': { label: 'Image Analysis', color: '#ff9800', icon: '🖼️' },
  'sequencing': { label: 'Sequencing', color: '#e91e63', icon: '🧬' },
  'mass_spec': { label: 'Mass Spectrometry', color: '#00bcd4', icon: '⚗️' },
  'custom': { label: 'Custom Report', color: '#607d8b', icon: '📄' }
};

export function ReportList({
  experimentId,
  reports: propReports,
  onRefresh,
  onDelete,
  readOnly = false,
  apiBaseUrl = 'http://localhost:3001/api'
}: ReportListProps) {
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewingReport, setViewingReport] = useState<Report | null>(null);
  const [htmlContent, setHtmlContent] = useState<string | null>(null);

  // Fetch reports from server
  const fetchReports = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      
      const response = await fetch(`${apiBaseUrl}/experiments/${experimentId}/reports`);
      
      if (!response.ok) {
        throw new Error('Failed to fetch reports');
      }
      
      const data = await response.json() as Report[];
      setReports(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load reports');
    } finally {
      setLoading(false);
    }
  }, [experimentId, apiBaseUrl]);

  useEffect(() => {
    if (propReports) {
      setReports(propReports);
      setLoading(false);
    } else {
      fetchReports();
    }
  }, [propReports, fetchReports]);

  // Handle report download
  const handleDownload = useCallback(async (report: Report) => {
    try {
      const response = await fetch(`${apiBaseUrl}/reports/${report.id}/download`);
      
      if (!response.ok) {
        throw new Error('Failed to download report');
      }
      
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      
      const link = document.createElement('a');
      link.href = url;
      link.download = report.originalFilename || report.filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Download failed:', err);
    }
  }, [apiBaseUrl]);

  // View report (especially for HTML reports)
  const handleView = useCallback(async (report: Report) => {
    setViewingReport(report);
    
    if (report.mime === 'text/html') {
      try {
        const response = await fetch(`${apiBaseUrl}/reports/${report.id}/base64`);
        if (response.ok) {
          const data = await response.json();
          const decodedContent = atob(data.data);
          setHtmlContent(decodedContent);
        }
      } catch (err) {
        console.error('Failed to load HTML content:', err);
      }
    }
  }, [apiBaseUrl]);

  // Handle report deletion
  const handleDelete = useCallback(async (report: Report) => {
    if (readOnly) return;
    
    if (!confirm(`Are you sure you want to delete "${report.filename}"?`)) {
      return;
    }

    try {
      const response = await fetch(`${apiBaseUrl}/reports/${report.id}`, {
        method: 'DELETE'
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to delete report');
      }
      
      setReports(prev => prev.filter(r => r.id !== report.id));
      onDelete?.(report);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Delete failed');
    }
  }, [readOnly, apiBaseUrl, onDelete]);

  // Get file icon based on MIME type
  const getFileIcon = (report: Report): string => {
    const config = REPORT_TYPE_CONFIG[report.reportType as ReportType];
    if (config) return config.icon;
    
    const mime = report.mime || '';
    if (mime === 'application/pdf') return '📕';
    if (mime.includes('html')) return '🌐';
    if (mime.includes('csv') || mime.includes('excel')) return '📊';
    if (mime.includes('json')) return '📋';
    if (mime.includes('markdown')) return '📝';
    return '📄';
  };

  // Format file size
  const formatSize = (bytes?: number): string => {
    if (!bytes) return 'Unknown';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  // Format date
  const formatDate = (dateStr: string): string => {
    return new Date(dateStr).toLocaleString();
  };

  if (loading) {
    return (
      <div className="report-list loading">
        <span>Loading reports...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="report-list error">
        <span>{error}</span>
        <button onClick={fetchReports}>Retry</button>
      </div>
    );
  }

  if (reports.length === 0) {
    return (
      <div className="report-list empty">
        <span>No reports attached</span>
        <p className="empty-hint">
          Upload analysis reports from FRAP, SPT, or other tools
        </p>
      </div>
    );
  }

  return (
    <div className="report-list">
      <table className="report-table">
        <thead>
          <tr>
            <th>Type</th>
            <th>Filename</th>
            <th>Size</th>
            <th>Date</th>
            <th>Notes</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {reports.map((report) => {
            const typeConfig = REPORT_TYPE_CONFIG[report.reportType as ReportType] || REPORT_TYPE_CONFIG.custom;
            return (
              <tr key={report.id}>
                <td>
                  <span 
                    className="report-type-badge"
                    style={{ backgroundColor: typeConfig.color }}
                  >
                    {getFileIcon(report)} {typeConfig.label}
                  </span>
                </td>
                <td className="filename-cell" title={report.filename}>
                  {report.originalFilename || report.filename}
                </td>
                <td>{formatSize(report.size)}</td>
                <td>{formatDate(report.createdAt)}</td>
                <td className="notes-cell" title={report.notes || ''}>
                  {report.notes || '-'}
                </td>
                <td className="actions-cell">
                  {report.mime === 'text/html' && (
                    <button
                      className="action-btn view"
                      onClick={() => handleView(report)}
                      title="View"
                    >
                      👁️
                    </button>
                  )}
                  <button
                    className="action-btn download"
                    onClick={() => handleDownload(report)}
                    title="Download"
                  >
                    ⬇️
                  </button>
                  {!readOnly && (
                    <button
                      className="action-btn delete"
                      onClick={() => handleDelete(report)}
                      title="Delete"
                    >
                      🗑️
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* Report Viewer Modal (for HTML reports) */}
      {viewingReport && (
        <div className="report-viewer-overlay" onClick={() => {
          setViewingReport(null);
          setHtmlContent(null);
        }}>
          <div className="report-viewer-content" onClick={e => e.stopPropagation()}>
            <div className="viewer-header">
              <h3>{viewingReport.originalFilename || viewingReport.filename}</h3>
              <div className="viewer-actions">
                <button onClick={() => handleDownload(viewingReport)}>
                  ⬇️ Download
                </button>
                <button onClick={() => {
                  setViewingReport(null);
                  setHtmlContent(null);
                }}>
                  ✕ Close
                </button>
              </div>
            </div>
            <div className="viewer-body">
              {viewingReport.mime === 'text/html' && htmlContent ? (
                <iframe
                  srcDoc={htmlContent}
                  title={viewingReport.filename}
                  className="html-viewer"
                  sandbox="allow-scripts allow-same-origin"
                />
              ) : (
                <div className="no-preview">
                  <span className="file-icon-large">{getFileIcon(viewingReport)}</span>
                  <p>Preview not available for this file type</p>
                  <button onClick={() => handleDownload(viewingReport)}>
                    Download to view
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <style>{`
        .report-list {
          margin: 16px 0;
        }

        .report-list.loading,
        .report-list.error,
        .report-list.empty {
          padding: 24px;
          text-align: center;
          background: var(--bg-secondary, #f5f5f5);
          border-radius: 8px;
          color: var(--text-secondary, #666);
        }

        .report-list.error {
          color: var(--error-color, #dc3545);
        }

        .report-list.error button {
          margin-left: 12px;
          padding: 4px 12px;
          background: var(--primary-color, #007bff);
          color: white;
          border: none;
          border-radius: 4px;
          cursor: pointer;
        }

        .empty-hint {
          margin: 8px 0 0;
          font-size: 12px;
        }

        .report-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 14px;
        }

        .report-table th,
        .report-table td {
          padding: 12px 8px;
          text-align: left;
          border-bottom: 1px solid var(--border-color, #eee);
        }

        .report-table th {
          background: var(--bg-secondary, #f5f5f5);
          font-weight: 600;
          font-size: 12px;
          text-transform: uppercase;
          color: var(--text-secondary, #666);
        }

        .report-table tr:hover {
          background: var(--bg-hover, #f9f9f9);
        }

        .report-type-badge {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          padding: 4px 8px;
          border-radius: 4px;
          font-size: 12px;
          color: white;
          white-space: nowrap;
        }

        .filename-cell,
        .notes-cell {
          max-width: 200px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .actions-cell {
          white-space: nowrap;
        }

        .action-btn {
          padding: 4px 8px;
          border: none;
          background: transparent;
          cursor: pointer;
          font-size: 14px;
          opacity: 0.7;
          transition: opacity 0.2s ease;
        }

        .action-btn:hover {
          opacity: 1;
        }

        .action-btn.delete:hover {
          color: var(--error-color, #dc3545);
        }

        .report-viewer-overlay {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0,0,0,0.8);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1000;
          padding: 20px;
        }

        .report-viewer-content {
          width: 90vw;
          height: 90vh;
          background: white;
          border-radius: 8px;
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }

        .viewer-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 12px 16px;
          background: var(--bg-secondary, #f5f5f5);
          border-bottom: 1px solid var(--border-color, #ddd);
        }

        .viewer-header h3 {
          margin: 0;
          font-size: 16px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .viewer-actions {
          display: flex;
          gap: 8px;
        }

        .viewer-actions button {
          padding: 6px 12px;
          border: 1px solid var(--border-color, #ddd);
          background: white;
          border-radius: 4px;
          cursor: pointer;
          font-size: 13px;
        }

        .viewer-actions button:hover {
          background: var(--bg-hover, #f0f0f0);
        }

        .viewer-body {
          flex: 1;
          overflow: hidden;
        }

        .html-viewer {
          width: 100%;
          height: 100%;
          border: none;
        }

        .no-preview {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          height: 100%;
          color: var(--text-secondary, #666);
        }

        .file-icon-large {
          font-size: 64px;
          margin-bottom: 16px;
        }

        .no-preview button {
          margin-top: 16px;
          padding: 8px 24px;
          background: var(--primary-color, #007bff);
          color: white;
          border: none;
          border-radius: 4px;
          cursor: pointer;
        }
      `}</style>
    </div>
  );
}

export default ReportList;
