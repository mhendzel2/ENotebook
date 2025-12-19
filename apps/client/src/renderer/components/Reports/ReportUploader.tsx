import React, { useState, useCallback, useRef } from 'react';
import { Report, REPORT_TYPES, ReportType, REPORT_ALLOWED_EXTENSIONS } from '@eln/shared';

interface ReportUploaderProps {
  experimentId: string;
  userId: string;
  onReportAdded?: (report: Report) => void;
  onError?: (error: string) => void;
  disabled?: boolean;
  apiBaseUrl?: string;
}

interface UploadProgress {
  filename: string;
  progress: number;
  status: 'pending' | 'uploading' | 'success' | 'error';
  error?: string;
}

// Max file size: 100MB for reports
const MAX_FILE_SIZE = 100 * 1024 * 1024;

export function ReportUploader({
  experimentId,
  userId,
  onReportAdded,
  onError,
  disabled = false,
  apiBaseUrl = 'http://localhost:4000'
}: ReportUploaderProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [uploads, setUploads] = useState<UploadProgress[]>([]);
  const [selectedType, setSelectedType] = useState<ReportType>('custom');
  const [notes, setNotes] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const validateFile = (file: File): string | null => {
    if (file.size > MAX_FILE_SIZE) {
      return `File "${file.name}" exceeds maximum size of 100MB`;
    }

    const ext = '.' + file.name.split('.').pop()?.toLowerCase();
    if (!REPORT_ALLOWED_EXTENSIONS.includes(ext)) {
      return `File type "${ext}" is not allowed for reports`;
    }

    return null;
  };

  const uploadFile = async (file: File): Promise<Report | null> => {
    const validation = validateFile(file);
    if (validation) {
      onError?.(validation);
      return null;
    }

    setUploads(prev => [
      ...prev,
      { filename: file.name, progress: 0, status: 'uploading' }
    ]);

    try {
      // Read file as base64
      const base64Data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result as string;
          const base64 = result.split(',')[1];
          resolve(base64);
        };
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.onprogress = (event) => {
          if (event.lengthComputable) {
            const progress = Math.round((event.loaded / event.total) * 50);
            setUploads(prev => prev.map(u =>
              u.filename === file.name ? { ...u, progress } : u
            ));
          }
        };
        reader.readAsDataURL(file);
      });

      // Upload to server
      const response = await fetch(`${apiBaseUrl}/experiments/${experimentId}/reports`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': userId,
        },
        body: JSON.stringify({
          filename: file.name,
          // Many Windows/Electron drops provide empty MIME types; let the server infer from filename.
          mime: (file.type && file.type !== 'application/octet-stream') ? file.type : undefined,
          data: base64Data,
          reportType: selectedType,
          notes: notes || undefined
        })
      });

      setUploads(prev => prev.map(u =>
        u.filename === file.name ? { ...u, progress: 75 } : u
      ));

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Upload failed');
      }

      const report = await response.json() as Report;

      setUploads(prev => prev.map(u =>
        u.filename === file.name ? { ...u, progress: 100, status: 'success' } : u
      ));

      setTimeout(() => {
        setUploads(prev => prev.filter(u => u.filename !== file.name));
      }, 2000);

      return report;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Upload failed';
      setUploads(prev => prev.map(u =>
        u.filename === file.name ? { ...u, status: 'error', error: errorMsg } : u
      ));
      onError?.(errorMsg);
      return null;
    }
  };

  const handleFiles = useCallback(async (files: FileList | File[]) => {
    const fileArray = Array.from(files);
    
    for (const file of fileArray) {
      const report = await uploadFile(file);
      if (report) {
        onReportAdded?.(report);
      }
    }
  }, [experimentId, onReportAdded, onError, apiBaseUrl, selectedType, notes]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!disabled) {
      setIsDragging(true);
    }
  }, [disabled]);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    
    if (disabled) return;
    
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleFiles(files);
    }
  }, [disabled, handleFiles]);

  const handleFileInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      handleFiles(files);
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, [handleFiles]);

  const handleClick = useCallback(() => {
    if (!disabled && fileInputRef.current) {
      fileInputRef.current.click();
    }
  }, [disabled]);

  const removeUpload = useCallback((filename: string) => {
    setUploads(prev => prev.filter(u => u.filename !== filename));
  }, []);

  return (
    <div className="report-uploader">
      <div className="report-upload-options">
        <div className="option-group">
          <label htmlFor="report-type">Report Type:</label>
          <select
            id="report-type"
            value={selectedType}
            onChange={(e) => setSelectedType(e.target.value as ReportType)}
            disabled={disabled}
          >
            {REPORT_TYPES.map(type => (
              <option key={type} value={type}>{type}</option>
            ))}
          </select>
        </div>
        <div className="option-group">
          <label htmlFor="report-notes">Notes (optional):</label>
          <input
            id="report-notes"
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="e.g., Analysis of sample A"
            disabled={disabled}
          />
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept={REPORT_ALLOWED_EXTENSIONS.join(',')}
        onChange={handleFileInputChange}
        style={{ display: 'none' }}
        disabled={disabled}
      />
      
      <div
        className={`drop-zone ${isDragging ? 'dragging' : ''} ${disabled ? 'disabled' : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={handleClick}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && handleClick()}
      >
        <div className="drop-zone-content">
          <svg
            className="upload-icon"
            width="48"
            height="48"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="12" y1="18" x2="12" y2="12" />
            <line x1="9" y1="15" x2="15" y2="15" />
          </svg>
          <p className="drop-zone-text">
            {isDragging 
              ? 'Drop report files here...' 
              : 'Drag & drop analysis reports here, or click to browse'}
          </p>
          <p className="drop-zone-hint">
            Supported: PDF, CSV, HTML, Markdown, JSON, Excel, XML (max 100MB)
          </p>
        </div>
      </div>

      {uploads.length > 0 && (
        <div className="upload-progress-list">
          {uploads.map((upload) => (
            <div 
              key={upload.filename} 
              className={`upload-item ${upload.status}`}
            >
              <div className="upload-info">
                <span className="upload-filename" title={upload.filename}>
                  {upload.filename}
                </span>
                {upload.status === 'error' && (
                  <button
                    className="remove-upload"
                    onClick={() => removeUpload(upload.filename)}
                    title="Dismiss"
                  >
                    ×
                  </button>
                )}
              </div>
              <div className="progress-bar-container">
                <div 
                  className={`progress-bar ${upload.status}`}
                  style={{ width: `${upload.progress}%` }}
                />
              </div>
              {upload.status === 'success' && (
                <span className="upload-status-icon">✓</span>
              )}
              {upload.status === 'error' && (
                <span className="upload-error" title={upload.error}>
                  ✕ {upload.error}
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      <style>{`
        .report-uploader {
          margin: 16px 0;
        }

        .report-upload-options {
          display: flex;
          gap: 16px;
          margin-bottom: 12px;
          flex-wrap: wrap;
        }

        .option-group {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .option-group label {
          font-size: 12px;
          font-weight: 500;
          color: var(--text-secondary, #666);
        }

        .option-group select,
        .option-group input {
          padding: 8px 12px;
          border: 1px solid var(--border-color, #ddd);
          border-radius: 4px;
          font-size: 14px;
          min-width: 200px;
        }

        .drop-zone {
          border: 2px dashed var(--border-color, #ccc);
          border-radius: 8px;
          padding: 32px 16px;
          text-align: center;
          cursor: pointer;
          transition: all 0.2s ease;
          background: var(--bg-secondary, #f9f9f9);
        }

        .drop-zone:hover:not(.disabled) {
          border-color: var(--primary-color, #007bff);
          background: var(--bg-hover, #f0f7ff);
        }

        .drop-zone.dragging {
          border-color: var(--primary-color, #007bff);
          background: var(--bg-active, #e3f2fd);
          border-style: solid;
        }

        .drop-zone.disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .drop-zone-content {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 8px;
        }

        .upload-icon {
          color: var(--text-secondary, #666);
        }

        .drop-zone:hover:not(.disabled) .upload-icon,
        .drop-zone.dragging .upload-icon {
          color: var(--primary-color, #007bff);
        }

        .drop-zone-text {
          margin: 0;
          font-size: 14px;
          color: var(--text-primary, #333);
        }

        .drop-zone-hint {
          margin: 0;
          font-size: 12px;
          color: var(--text-secondary, #666);
        }

        .upload-progress-list {
          margin-top: 12px;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .upload-item {
          display: flex;
          flex-direction: column;
          gap: 4px;
          padding: 8px 12px;
          background: var(--bg-secondary, #f5f5f5);
          border-radius: 4px;
          font-size: 13px;
        }

        .upload-item.error {
          background: var(--bg-error, #fff0f0);
        }

        .upload-item.success {
          background: var(--bg-success, #f0fff0);
        }

        .upload-info {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .upload-filename {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          max-width: 200px;
        }

        .remove-upload {
          background: none;
          border: none;
          font-size: 18px;
          cursor: pointer;
          color: var(--text-secondary, #666);
          padding: 0 4px;
        }

        .remove-upload:hover {
          color: var(--error-color, #dc3545);
        }

        .progress-bar-container {
          height: 4px;
          background: var(--border-color, #ddd);
          border-radius: 2px;
          overflow: hidden;
        }

        .progress-bar {
          height: 100%;
          background: var(--primary-color, #007bff);
          transition: width 0.2s ease;
        }

        .progress-bar.success {
          background: var(--success-color, #28a745);
        }

        .progress-bar.error {
          background: var(--error-color, #dc3545);
        }

        .upload-status-icon {
          color: var(--success-color, #28a745);
          font-weight: bold;
        }

        .upload-error {
          color: var(--error-color, #dc3545);
          font-size: 12px;
        }
      `}</style>
    </div>
  );
}

export default ReportUploader;
