import React, { useState, useCallback, useRef } from 'react';
import { Attachment } from '@eln/shared';

interface FileImporterProps {
  experimentId: string;
  onAttachmentAdded?: (attachment: Attachment) => void;
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

// Allowed MIME types for images and spreadsheets
const ALLOWED_MIME_TYPES = [
  // Images
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  'image/bmp',
  'image/tiff',
  // Spreadsheets
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
  'application/vnd.oasis.opendocument.spreadsheet',
  // Documents (optional)
  'application/pdf',
  'text/plain',
  'application/json',
];

const ALLOWED_EXTENSIONS = [
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp', '.tiff', '.tif',
  '.xls', '.xlsx', '.csv', '.ods',
  '.pdf', '.txt', '.json'
];

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

export function FileImporter({
  experimentId,
  onAttachmentAdded,
  onError,
  disabled = false,
  apiBaseUrl = 'http://localhost:3001/api'
}: FileImporterProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [uploads, setUploads] = useState<UploadProgress[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const validateFile = (file: File): string | null => {
    // Check file size
    if (file.size > MAX_FILE_SIZE) {
      return `File "${file.name}" exceeds maximum size of 50MB`;
    }

    // Check MIME type
    if (!ALLOWED_MIME_TYPES.includes(file.type)) {
      const ext = '.' + file.name.split('.').pop()?.toLowerCase();
      if (!ALLOWED_EXTENSIONS.includes(ext)) {
        return `File type "${file.type || ext}" is not allowed`;
      }
    }

    return null;
  };

  const uploadFile = async (file: File): Promise<Attachment | null> => {
    const validation = validateFile(file);
    if (validation) {
      onError?.(validation);
      return null;
    }

    // Update progress state
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
          // Remove data URL prefix (e.g., "data:image/png;base64,")
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
      const response = await fetch(`${apiBaseUrl}/experiments/${experimentId}/attachments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // TODO: Add auth header when authentication is implemented
        },
        body: JSON.stringify({
          filename: file.name,
          mimeType: file.type || 'application/octet-stream',
          data: base64Data,
          description: `Uploaded ${new Date().toLocaleString()}`
        })
      });

      setUploads(prev => prev.map(u =>
        u.filename === file.name ? { ...u, progress: 75 } : u
      ));

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Upload failed');
      }

      const attachment = await response.json() as Attachment;

      setUploads(prev => prev.map(u =>
        u.filename === file.name ? { ...u, progress: 100, status: 'success' } : u
      ));

      // Clear successful upload after 2 seconds
      setTimeout(() => {
        setUploads(prev => prev.filter(u => u.filename !== file.name));
      }, 2000);

      return attachment;
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
      const attachment = await uploadFile(file);
      if (attachment) {
        onAttachmentAdded?.(attachment);
      }
    }
  }, [experimentId, onAttachmentAdded, onError, apiBaseUrl]);

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
    // Reset input so same file can be selected again
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
    <div className="file-importer">
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept={ALLOWED_EXTENSIONS.join(',')}
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
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          <p className="drop-zone-text">
            {isDragging 
              ? 'Drop files here...' 
              : 'Drag & drop images or spreadsheets here, or click to browse'}
          </p>
          <p className="drop-zone-hint">
            Supported: JPG, PNG, GIF, SVG, XLSX, CSV, PDF (max 50MB)
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
        .file-importer {
          margin: 16px 0;
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

export default FileImporter;
