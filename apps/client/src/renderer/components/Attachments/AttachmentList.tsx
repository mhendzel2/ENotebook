import React, { useState, useEffect, useCallback } from 'react';
import { Attachment } from '@eln/shared';

interface AttachmentListProps {
  experimentId: string;
  attachments?: Attachment[];
  onRefresh?: () => void;
  onDelete?: (attachment: Attachment) => void;
  readOnly?: boolean;
  apiBaseUrl?: string;
}

interface AttachmentWithPreview extends Attachment {
  previewUrl?: string;
  isLoading?: boolean;
}

export function AttachmentList({
  experimentId,
  attachments: propAttachments,
  onRefresh,
  onDelete,
  readOnly = false,
  apiBaseUrl = 'http://localhost:3001/api'
}: AttachmentListProps) {
  const [attachments, setAttachments] = useState<AttachmentWithPreview[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedAttachment, setSelectedAttachment] = useState<AttachmentWithPreview | null>(null);

  // Fetch attachments from server
  const fetchAttachments = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      
      const response = await fetch(`${apiBaseUrl}/experiments/${experimentId}/attachments`);
      
      if (!response.ok) {
        throw new Error('Failed to fetch attachments');
      }
      
      const data = await response.json() as Attachment[];
      setAttachments(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load attachments');
    } finally {
      setLoading(false);
    }
  }, [experimentId, apiBaseUrl]);

  // Use prop attachments if provided, otherwise fetch from server
  useEffect(() => {
    if (propAttachments) {
      setAttachments(propAttachments);
      setLoading(false);
    } else {
      fetchAttachments();
    }
  }, [propAttachments, fetchAttachments]);

  // Load preview for image attachments
  const loadPreview = useCallback(async (attachment: AttachmentWithPreview) => {
    if (!attachment.mime.startsWith('image/') || attachment.previewUrl) {
      return;
    }

    try {
      setAttachments(prev => prev.map(a =>
        a.id === attachment.id ? { ...a, isLoading: true } : a
      ));

      const response = await fetch(`${apiBaseUrl}/attachments/${attachment.id}/base64`);
      
      if (response.ok) {
        const data = await response.json();
        const previewUrl = `data:${attachment.mime};base64,${data.data}`;
        
        setAttachments(prev => prev.map(a =>
          a.id === attachment.id ? { ...a, previewUrl, isLoading: false } : a
        ));
      }
    } catch (err) {
      setAttachments(prev => prev.map(a =>
        a.id === attachment.id ? { ...a, isLoading: false } : a
      ));
    }
  }, [apiBaseUrl]);

  // Handle attachment download
  const handleDownload = useCallback(async (attachment: Attachment) => {
    try {
      const response = await fetch(`${apiBaseUrl}/attachments/${attachment.id}`);
      
      if (!response.ok) {
        throw new Error('Failed to download attachment');
      }
      
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      
      const link = document.createElement('a');
      link.href = url;
      link.download = attachment.filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Download failed:', err);
    }
  }, [apiBaseUrl]);

  // Handle attachment deletion
  const handleDelete = useCallback(async (attachment: Attachment) => {
    if (readOnly) return;
    
    if (!confirm(`Are you sure you want to delete "${attachment.filename}"?`)) {
      return;
    }

    try {
      const response = await fetch(`${apiBaseUrl}/attachments/${attachment.id}`, {
        method: 'DELETE'
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to delete attachment');
      }
      
      setAttachments(prev => prev.filter(a => a.id !== attachment.id));
      onDelete?.(attachment);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Delete failed');
    }
  }, [readOnly, apiBaseUrl, onDelete]);

  // Get file icon based on MIME type
  const getFileIcon = (mime: string, filename: string): string => {
    if (mime.startsWith('image/')) return '🖼️';
    if (mime.includes('spreadsheet') || mime.includes('excel') || filename.endsWith('.csv')) return '📊';
    if (mime === 'application/pdf') return '📄';
    if (mime.startsWith('text/')) return '📝';
    return '📎';
  };

  // Format file size
  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  if (loading) {
    return (
      <div className="attachment-list loading">
        <span>Loading attachments...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="attachment-list error">
        <span>{error}</span>
        <button onClick={fetchAttachments}>Retry</button>
      </div>
    );
  }

  if (attachments.length === 0) {
    return (
      <div className="attachment-list empty">
        <span>No attachments</span>
      </div>
    );
  }

  return (
    <div className="attachment-list">
      <div className="attachment-grid">
        {attachments.map((attachment) => (
          <div
            key={attachment.id}
            className={`attachment-card ${attachment.mime.startsWith('image/') ? 'image' : 'file'}`}
            onMouseEnter={() => loadPreview(attachment)}
          >
            <div className="attachment-preview" onClick={() => setSelectedAttachment(attachment)}>
              {attachment.mime.startsWith('image/') ? (
                attachment.previewUrl ? (
                  <img src={attachment.previewUrl} alt={attachment.filename} />
                ) : attachment.isLoading ? (
                  <div className="preview-loading">Loading...</div>
                ) : (
                  <div className="preview-placeholder">
                    {getFileIcon(attachment.mime, attachment.filename)}
                  </div>
                )
              ) : (
                <div className="file-icon">
                  {getFileIcon(attachment.mime, attachment.filename)}
                </div>
              )}
            </div>
            
            <div className="attachment-info">
              <span className="attachment-name" title={attachment.filename}>
                {attachment.filename}
              </span>
              <span className="attachment-size">
                {formatSize(attachment.size)}
              </span>
            </div>
            
            <div className="attachment-actions">
              <button
                className="action-btn download"
                onClick={() => handleDownload(attachment)}
                title="Download"
              >
                ⬇️
              </button>
              {!readOnly && (
                <button
                  className="action-btn delete"
                  onClick={() => handleDelete(attachment)}
                  title="Delete"
                >
                  🗑️
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Lightbox for viewing images */}
      {selectedAttachment && (
        <div 
          className="lightbox-overlay"
          onClick={() => setSelectedAttachment(null)}
        >
          <div className="lightbox-content" onClick={e => e.stopPropagation()}>
            <button 
              className="lightbox-close"
              onClick={() => setSelectedAttachment(null)}
            >
              ×
            </button>
            {selectedAttachment.mime.startsWith('image/') && selectedAttachment.previewUrl ? (
              <img 
                src={selectedAttachment.previewUrl} 
                alt={selectedAttachment.filename}
                className="lightbox-image"
              />
            ) : (
              <div className="lightbox-file">
                <div className="file-icon large">
                  {getFileIcon(selectedAttachment.mime, selectedAttachment.filename)}
                </div>
                <p>{selectedAttachment.filename}</p>
                <button onClick={() => handleDownload(selectedAttachment)}>
                  Download
                </button>
              </div>
            )}
            <div className="lightbox-info">
              <strong>{selectedAttachment.filename}</strong>
              <span>{formatSize(selectedAttachment.size)}</span>
              <span>Uploaded: {new Date(selectedAttachment.createdAt).toLocaleString()}</span>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .attachment-list {
          margin: 16px 0;
        }

        .attachment-list.loading,
        .attachment-list.error,
        .attachment-list.empty {
          padding: 24px;
          text-align: center;
          background: var(--bg-secondary, #f5f5f5);
          border-radius: 8px;
          color: var(--text-secondary, #666);
        }

        .attachment-list.error {
          color: var(--error-color, #dc3545);
        }

        .attachment-list.error button {
          margin-left: 12px;
          padding: 4px 12px;
          background: var(--primary-color, #007bff);
          color: white;
          border: none;
          border-radius: 4px;
          cursor: pointer;
        }

        .attachment-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
          gap: 16px;
        }

        .attachment-card {
          border: 1px solid var(--border-color, #ddd);
          border-radius: 8px;
          overflow: hidden;
          background: white;
          transition: box-shadow 0.2s ease;
        }

        .attachment-card:hover {
          box-shadow: 0 4px 12px rgba(0,0,0,0.1);
        }

        .attachment-preview {
          height: 120px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: var(--bg-secondary, #f5f5f5);
          cursor: pointer;
          overflow: hidden;
        }

        .attachment-preview img {
          max-width: 100%;
          max-height: 100%;
          object-fit: contain;
        }

        .preview-loading,
        .preview-placeholder {
          color: var(--text-secondary, #999);
          font-size: 12px;
        }

        .preview-placeholder {
          font-size: 48px;
        }

        .file-icon {
          font-size: 48px;
        }

        .file-icon.large {
          font-size: 72px;
        }

        .attachment-info {
          padding: 8px 12px;
          border-top: 1px solid var(--border-color, #eee);
        }

        .attachment-name {
          display: block;
          font-size: 13px;
          font-weight: 500;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .attachment-size {
          display: block;
          font-size: 11px;
          color: var(--text-secondary, #666);
        }

        .attachment-actions {
          display: flex;
          border-top: 1px solid var(--border-color, #eee);
        }

        .action-btn {
          flex: 1;
          padding: 8px;
          border: none;
          background: transparent;
          cursor: pointer;
          font-size: 14px;
          transition: background-color 0.2s ease;
        }

        .action-btn:hover {
          background: var(--bg-hover, #f0f0f0);
        }

        .action-btn.delete:hover {
          background: var(--bg-error, #fff0f0);
        }

        .lightbox-overlay {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0,0,0,0.85);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1000;
          padding: 20px;
        }

        .lightbox-content {
          position: relative;
          max-width: 90vw;
          max-height: 90vh;
          background: white;
          border-radius: 8px;
          overflow: hidden;
        }

        .lightbox-close {
          position: absolute;
          top: 10px;
          right: 10px;
          width: 32px;
          height: 32px;
          border: none;
          background: rgba(0,0,0,0.5);
          color: white;
          font-size: 24px;
          border-radius: 50%;
          cursor: pointer;
          z-index: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          line-height: 1;
        }

        .lightbox-close:hover {
          background: rgba(0,0,0,0.7);
        }

        .lightbox-image {
          max-width: 100%;
          max-height: calc(90vh - 80px);
          display: block;
        }

        .lightbox-file {
          padding: 48px;
          text-align: center;
        }

        .lightbox-file button {
          margin-top: 16px;
          padding: 8px 24px;
          background: var(--primary-color, #007bff);
          color: white;
          border: none;
          border-radius: 4px;
          cursor: pointer;
        }

        .lightbox-info {
          padding: 12px 16px;
          background: var(--bg-secondary, #f5f5f5);
          display: flex;
          gap: 16px;
          align-items: center;
          flex-wrap: wrap;
          font-size: 13px;
        }

        .lightbox-info strong {
          flex: 1;
        }

        .lightbox-info span {
          color: var(--text-secondary, #666);
        }
      `}</style>
    </div>
  );
}

export default AttachmentList;
