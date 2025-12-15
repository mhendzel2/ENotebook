/**
 * Dynamic Form Components for JSON Schema
 * Renders forms based on JSON Schema definitions with custom UI widgets
 * 
 * Features:
 * - Conditional logic (show/hide fields based on other values)
 * - Improved validation with detailed messages
 * - Attachment preview with drag-and-drop
 * - Image annotation capability
 * - Accessibility-compliant with keyboard navigation
 */

import React, { useMemo, useCallback, useState, useRef, useEffect, DragEvent } from 'react';
import type { JSONSchema } from '@eln/shared';

// ==================== TYPES ====================

export interface SchemaFormProps {
  schema: JSONSchema;
  value: Record<string, unknown>;
  onChange: (value: Record<string, unknown>) => void;
  onValidate?: (errors: FormError[]) => void;
  onAttachmentUpload?: (file: File, path: string) => Promise<string>;
  readOnly?: boolean;
  compact?: boolean;
  showValidationOnBlur?: boolean;
  enableConditionalLogic?: boolean;
}

export interface FormError {
  path: string;
  message: string;
  type: 'error' | 'warning';
}

export interface ConditionalRule {
  field: string;
  condition: 'equals' | 'notEquals' | 'contains' | 'greaterThan' | 'lessThan' | 'isEmpty' | 'isNotEmpty';
  value?: unknown;
  action: 'show' | 'hide' | 'enable' | 'disable' | 'require';
}

export interface AttachmentPreview {
  id: string;
  filename: string;
  mime: string;
  url: string;
  size: number;
  annotations?: ImageAnnotation[];
}

export interface ImageAnnotation {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
  color: string;
  author?: string;
  createdAt: Date;
}

interface FieldProps {
  schema: JSONSchema;
  path: string;
  value: unknown;
  onChange: (path: string, value: unknown) => void;
  errors: FormError[];
  readOnly?: boolean;
  compact?: boolean;
  onAttachmentUpload?: (file: File, path: string) => Promise<string>;
  formValue?: Record<string, unknown>; // Full form value for conditional logic
  parentRequired?: string[];
}

// ==================== CONDITIONAL LOGIC ====================

function evaluateCondition(rule: ConditionalRule, formValue: Record<string, unknown>): boolean {
  const fieldValue = getNestedValue(formValue, rule.field);
  
  switch (rule.condition) {
    case 'equals':
      return fieldValue === rule.value;
    case 'notEquals':
      return fieldValue !== rule.value;
    case 'contains':
      return typeof fieldValue === 'string' && fieldValue.includes(String(rule.value));
    case 'greaterThan':
      return typeof fieldValue === 'number' && typeof rule.value === 'number' && fieldValue > rule.value;
    case 'lessThan':
      return typeof fieldValue === 'number' && typeof rule.value === 'number' && fieldValue < rule.value;
    case 'isEmpty':
      return fieldValue === undefined || fieldValue === null || fieldValue === '' || (Array.isArray(fieldValue) && fieldValue.length === 0);
    case 'isNotEmpty':
      return fieldValue !== undefined && fieldValue !== null && fieldValue !== '' && !(Array.isArray(fieldValue) && fieldValue.length === 0);
    default:
      return true;
  }
}

function evaluateFieldVisibility(schema: JSONSchema, formValue: Record<string, unknown>): { visible: boolean; enabled: boolean; required: boolean } {
  let visible = !schema['ui:hidden'];
  let enabled = !schema['ui:readonly'];
  let required = false;

  const conditions = schema['ui:conditions'] as ConditionalRule[] | undefined;
  if (conditions) {
    for (const rule of conditions) {
      const result = evaluateCondition(rule, formValue);
      switch (rule.action) {
        case 'show':
          visible = result;
          break;
        case 'hide':
          visible = !result;
          break;
        case 'enable':
          enabled = result;
          break;
        case 'disable':
          enabled = !result;
          break;
        case 'require':
          required = result;
          break;
      }
    }
  }

  return { visible, enabled, required };
}

// ==================== MAIN FORM COMPONENT ====================

export function SchemaForm({ 
  schema, 
  value, 
  onChange, 
  onValidate, 
  onAttachmentUpload,
  readOnly, 
  compact,
  showValidationOnBlur = true,
  enableConditionalLogic = true
}: SchemaFormProps) {
  const [errors, setErrors] = useState<FormError[]>([]);
  const [touched, setTouched] = useState<Set<string>>(new Set());

  const handleChange = useCallback((path: string, fieldValue: unknown) => {
    const newValue = setNestedValue({ ...value }, path, fieldValue);
    onChange(newValue);
    
    // Validate on change
    const validationErrors = validateSchema(schema, newValue, enableConditionalLogic);
    setErrors(validationErrors);
    onValidate?.(validationErrors);
  }, [value, onChange, schema, onValidate, enableConditionalLogic]);

  const handleBlur = useCallback((path: string) => {
    if (showValidationOnBlur) {
      setTouched(prev => new Set(prev).add(path));
    }
  }, [showValidationOnBlur]);

  // Filter errors to only show touched fields
  const visibleErrors = useMemo(() => {
    if (!showValidationOnBlur) return errors;
    return errors.filter(e => touched.has(e.path));
  }, [errors, touched, showValidationOnBlur]);

  if (schema.type !== 'object' || !schema.properties) {
    return <div style={styles.error} role="alert">Schema must be an object with properties</div>;
  }

  const orderedKeys = schema['ui:order'] || Object.keys(schema.properties);

  return (
    <div 
      style={compact ? styles.formCompact : styles.form}
      role="form"
      aria-label={schema.title || 'Form'}
    >
      {schema.title && <h3 style={styles.formTitle}>{schema.title}</h3>}
      {schema.description && <p style={styles.formDescription}>{schema.description}</p>}
      
      {/* Form-level error summary for accessibility */}
      {visibleErrors.length > 0 && (
        <div style={styles.errorSummary} role="alert" aria-live="polite">
          <strong>Please fix the following errors:</strong>
          <ul style={styles.errorList}>
            {visibleErrors.map((e, i) => (
              <li key={i}>
                <a href={`#field-${e.path}`} style={styles.errorLink}>{e.message}</a>
              </li>
            ))}
          </ul>
        </div>
      )}
      
      {orderedKeys.map(key => {
        const fieldSchema = schema.properties![key];
        if (!fieldSchema) return null;
        
        const { visible, enabled, required } = enableConditionalLogic 
          ? evaluateFieldVisibility(fieldSchema, value)
          : { visible: !fieldSchema['ui:hidden'], enabled: !fieldSchema['ui:readonly'], required: false };
        
        if (!visible) return null;
        
        return (
          <Field
            key={key}
            schema={fieldSchema}
            path={key}
            value={getNestedValue(value, key)}
            onChange={handleChange}
            errors={visibleErrors.filter(e => e.path.startsWith(key))}
            readOnly={readOnly || !enabled}
            compact={compact}
            onAttachmentUpload={onAttachmentUpload}
            formValue={value}
            parentRequired={required ? [key] : schema.required}
          />
        );
      })}
    </div>
  );
}

// ==================== FIELD RENDERER ====================

function Field({ schema, path, value, onChange, errors, readOnly, compact, onAttachmentUpload, formValue, parentRequired }: FieldProps) {
  const fieldErrors = errors.filter(e => e.path === path);
  const hasError = fieldErrors.length > 0;

  const label = schema.title || formatLabel(path);
  const widget = schema['ui:widget'];
  const isRequired = parentRequired?.includes(path.split('.').pop() || '');
  const fieldId = `field-${path}`;

  // Render based on type and widget
  let input: React.ReactNode;

  if (widget === 'attachment' || widget === 'file') {
    input = (
      <AttachmentField
        value={value as AttachmentPreview[] | undefined}
        onChange={v => onChange(path, v)}
        onUpload={onAttachmentUpload ? (f) => onAttachmentUpload(f, path) : undefined}
        readOnly={readOnly}
        accept={schema['ui:accept'] as string}
        multiple={schema['ui:multiple'] as boolean}
      />
    );
  } else if (widget === 'image-annotator') {
    input = (
      <ImageAnnotatorField
        value={value as AttachmentPreview | undefined}
        onChange={v => onChange(path, v)}
        onUpload={onAttachmentUpload ? (f) => onAttachmentUpload(f, path) : undefined}
        readOnly={readOnly}
      />
    );
  } else if (schema.enum) {
    input = (
      <SelectField
        id={fieldId}
        options={schema.enum as string[]}
        value={value as string}
        onChange={v => onChange(path, v)}
        readOnly={readOnly}
        hasError={hasError}
        required={isRequired}
      />
    );
  } else if (widget === 'select') {
    input = (
      <SelectField
        id={fieldId}
        options={schema.enum as string[] || []}
        value={value as string}
        onChange={v => onChange(path, v)}
        readOnly={readOnly}
        hasError={hasError}
        required={isRequired}
      />
    );
  } else if (widget === 'textarea' || widget === 'richtext') {
    input = (
      <TextAreaField
        id={fieldId}
        value={value as string}
        onChange={v => onChange(path, v)}
        placeholder={schema['ui:placeholder']}
        readOnly={readOnly}
        richText={widget === 'richtext'}
        hasError={hasError}
        required={isRequired}
      />
    );
  } else if (schema.type === 'boolean') {
    input = (
      <CheckboxField
        id={fieldId}
        value={value as boolean}
        onChange={v => onChange(path, v)}
        readOnly={readOnly}
      />
    );
  } else if (schema.type === 'number' || schema.type === 'integer') {
    input = (
      <NumberField
        id={fieldId}
        value={value as number}
        onChange={v => onChange(path, v)}
        min={schema.minimum}
        max={schema.maximum}
        step={schema.type === 'integer' ? 1 : undefined}
        readOnly={readOnly}
        scientific={widget === 'scientific'}
        hasError={hasError}
        required={isRequired}
      />
    );
  } else if (schema.type === 'array') {
    input = (
      <ArrayField
        schema={schema}
        path={path}
        value={value as unknown[]}
        onChange={onChange}
        errors={errors}
        readOnly={readOnly}
        compact={compact}
        onAttachmentUpload={onAttachmentUpload}
        formValue={formValue}
      />
    );
  } else if (schema.type === 'object' && schema.properties) {
    input = (
      <ObjectField
        schema={schema}
        path={path}
        value={value as Record<string, unknown>}
        onChange={onChange}
        errors={errors}
        readOnly={readOnly}
        compact={compact}
        onAttachmentUpload={onAttachmentUpload}
        formValue={formValue}
      />
    );
  } else {
    // Default to text input
    input = (
      <TextField
        id={fieldId}
        value={value as string}
        onChange={v => onChange(path, v)}
        placeholder={schema['ui:placeholder']}
        pattern={schema.pattern}
        readOnly={readOnly}
        hasError={hasError}
        required={isRequired}
      />
    );
  }

  return (
    <div style={compact ? styles.fieldCompact : styles.field} id={fieldId}>
      <label htmlFor={fieldId} style={styles.label}>
        {label}
        {isRequired && <span style={styles.required} aria-label="required">*</span>}
      </label>
      {input}
      {schema['ui:help'] && (
        <span style={styles.help} id={`${fieldId}-help`}>{schema['ui:help']}</span>
      )}
      {hasError && (
        <span 
          style={styles.errorMessage} 
          role="alert" 
          id={`${fieldId}-error`}
        >
          {fieldErrors[0].message}
        </span>
      )}
    </div>
  );
}

// ==================== FIELD COMPONENTS ====================

function TextField({ 
  id,
  value, 
  onChange, 
  placeholder, 
  pattern, 
  readOnly,
  hasError,
  required
}: { 
  id?: string;
  value: string; 
  onChange: (v: string) => void; 
  placeholder?: string; 
  pattern?: string; 
  readOnly?: boolean;
  hasError?: boolean;
  required?: boolean;
}) {
  return (
    <input
      id={id}
      type="text"
      value={value || ''}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      pattern={pattern}
      readOnly={readOnly}
      required={required}
      aria-invalid={hasError}
      aria-describedby={hasError ? `${id}-error` : undefined}
      style={{
        ...styles.input,
        ...(hasError ? styles.inputError : {}),
        ...(readOnly ? styles.inputReadOnly : {})
      }}
    />
  );
}

function NumberField({ 
  id,
  value, 
  onChange, 
  min, 
  max, 
  step, 
  readOnly, 
  scientific,
  hasError,
  required
}: { 
  id?: string;
  value: number; 
  onChange: (v: number) => void; 
  min?: number; 
  max?: number; 
  step?: number; 
  readOnly?: boolean; 
  scientific?: boolean;
  hasError?: boolean;
  required?: boolean;
}) {
  const displayValue = scientific && value ? value.toExponential(2) : value;
  
  return (
    <input
      id={id}
      type="number"
      value={displayValue ?? ''}
      onChange={e => onChange(parseFloat(e.target.value))}
      min={min}
      max={max}
      step={step}
      readOnly={readOnly}
      required={required}
      aria-invalid={hasError}
      aria-describedby={hasError ? `${id}-error` : undefined}
      style={{
        ...styles.input,
        ...(hasError ? styles.inputError : {}),
        ...(readOnly ? styles.inputReadOnly : {})
      }}
    />
  );
}

function SelectField({ 
  id,
  options, 
  value, 
  onChange, 
  readOnly,
  hasError,
  required
}: { 
  id?: string;
  options: string[]; 
  value: string; 
  onChange: (v: string) => void; 
  readOnly?: boolean;
  hasError?: boolean;
  required?: boolean;
}) {
  return (
    <select
      id={id}
      value={value || ''}
      onChange={e => onChange(e.target.value)}
      disabled={readOnly}
      required={required}
      aria-invalid={hasError}
      aria-describedby={hasError ? `${id}-error` : undefined}
      style={{
        ...styles.select,
        ...(hasError ? styles.inputError : {}),
        ...(readOnly ? styles.inputReadOnly : {})
      }}
    >
      <option value="">— Select —</option>
      {options.map(opt => (
        <option key={opt} value={opt}>{formatLabel(opt)}</option>
      ))}
    </select>
  );
}

function CheckboxField({ 
  id,
  value, 
  onChange, 
  readOnly 
}: { 
  id?: string;
  value: boolean; 
  onChange: (v: boolean) => void; 
  readOnly?: boolean;
}) {
  return (
    <input
      id={id}
      type="checkbox"
      checked={value || false}
      onChange={e => onChange(e.target.checked)}
      disabled={readOnly}
      style={styles.checkbox}
    />
  );
}

function TextAreaField({ 
  id,
  value, 
  onChange, 
  placeholder, 
  readOnly, 
  richText,
  hasError,
  required
}: { 
  id?: string;
  value: string; 
  onChange: (v: string) => void; 
  placeholder?: string; 
  readOnly?: boolean;
  richText?: boolean;
  hasError?: boolean;
  required?: boolean;
}) {
  // For richText, we'd integrate a rich text editor like TipTap or Slate
  // For now, use a simple textarea with basic formatting hints
  return (
    <textarea
      id={id}
      value={value || ''}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      readOnly={readOnly}
      required={required}
      aria-invalid={hasError}
      aria-describedby={hasError ? `${id}-error` : undefined}
      style={{
        ...styles.textarea,
        ...(hasError ? styles.inputError : {}),
        ...(readOnly ? styles.inputReadOnly : {})
      }}
      rows={richText ? 8 : 4}
    />
  );
}

// ==================== ATTACHMENT FIELD WITH DRAG-AND-DROP ====================

function AttachmentField({
  value,
  onChange,
  onUpload,
  readOnly,
  accept,
  multiple = true
}: {
  value?: AttachmentPreview[];
  onChange: (v: AttachmentPreview[]) => void;
  onUpload?: (file: File) => Promise<string>;
  readOnly?: boolean;
  accept?: string;
  multiple?: boolean;
}) {
  const [isDragging, setIsDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const attachments = value || [];

  const handleDragEnter = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!readOnly) setIsDragging(true);
  }, [readOnly]);

  const handleDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback(async (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    
    if (readOnly || !e.dataTransfer?.files) return;
    
    const files = Array.from(e.dataTransfer.files);
    await handleFiles(files);
  }, [readOnly]);

  const handleFiles = async (files: File[]) => {
    if (files.length === 0) return;
    
    setUploading(true);
    const newAttachments: AttachmentPreview[] = [];
    
    for (const file of files) {
      try {
        const url = onUpload 
          ? await onUpload(file)
          : URL.createObjectURL(file);
        
        newAttachments.push({
          id: crypto.randomUUID(),
          filename: file.name,
          mime: file.type,
          url,
          size: file.size
        });
      } catch (error) {
        console.error('Upload failed:', error);
      }
    }
    
    onChange(multiple ? [...attachments, ...newAttachments] : newAttachments);
    setUploading(false);
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files ? Array.from(e.target.files) : [];
    await handleFiles(files);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleRemove = (id: string) => {
    onChange(attachments.filter(a => a.id !== id));
  };

  const isImageFile = (mime: string) => mime.startsWith('image/');
  const isPreviewable = (mime: string) => isImageFile(mime) || mime === 'application/pdf';

  return (
    <div style={styles.attachmentContainer}>
      {/* Drop Zone */}
      {!readOnly && (
        <div
          style={{
            ...styles.dropZone,
            ...(isDragging ? styles.dropZoneActive : {})
          }}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => e.key === 'Enter' && fileInputRef.current?.click()}
          aria-label="Drop files here or click to upload"
        >
          <input
            ref={fileInputRef}
            type="file"
            accept={accept}
            multiple={multiple}
            onChange={handleFileSelect}
            style={{ display: 'none' }}
          />
          {uploading ? (
            <span>Uploading...</span>
          ) : (
            <>
              <span style={styles.dropZoneIcon}>📎</span>
              <span style={styles.dropZoneText}>
                Drag & drop files here, or click to browse
              </span>
              {accept && (
                <span style={styles.dropZoneHint}>
                  Accepted: {accept}
                </span>
              )}
            </>
          )}
        </div>
      )}
      
      {/* Attachment List with Previews */}
      {attachments.length > 0 && (
        <div style={styles.attachmentList}>
          {attachments.map(attachment => (
            <div key={attachment.id} style={styles.attachmentItem}>
              {/* Preview thumbnail */}
              {isImageFile(attachment.mime) ? (
                <img
                  src={attachment.url}
                  alt={attachment.filename}
                  style={styles.attachmentThumbnail}
                  onClick={() => setPreviewUrl(attachment.url)}
                />
              ) : (
                <div style={styles.attachmentIcon}>
                  {getFileIcon(attachment.mime)}
                </div>
              )}
              
              <div style={styles.attachmentInfo}>
                <span style={styles.attachmentName}>{attachment.filename}</span>
                <span style={styles.attachmentSize}>{formatFileSize(attachment.size)}</span>
              </div>
              
              <div style={styles.attachmentActions}>
                {isPreviewable(attachment.mime) && (
                  <button
                    onClick={() => setPreviewUrl(attachment.url)}
                    style={styles.attachmentAction}
                    title="Preview"
                    aria-label={`Preview ${attachment.filename}`}
                  >
                    👁️
                  </button>
                )}
                <a
                  href={attachment.url}
                  download={attachment.filename}
                  style={styles.attachmentAction}
                  title="Download"
                  aria-label={`Download ${attachment.filename}`}
                >
                  ⬇️
                </a>
                {!readOnly && (
                  <button
                    onClick={() => handleRemove(attachment.id)}
                    style={styles.attachmentAction}
                    title="Remove"
                    aria-label={`Remove ${attachment.filename}`}
                  >
                    ❌
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      
      {/* Full Preview Modal */}
      {previewUrl && (
        <div 
          style={styles.previewModal}
          onClick={() => setPreviewUrl(null)}
          role="dialog"
          aria-label="File preview"
        >
          <div style={styles.previewContent} onClick={e => e.stopPropagation()}>
            <button 
              onClick={() => setPreviewUrl(null)}
              style={styles.previewClose}
              aria-label="Close preview"
            >
              ✕
            </button>
            <img src={previewUrl} alt="Preview" style={styles.previewImage} />
          </div>
        </div>
      )}
    </div>
  );
}

// ==================== IMAGE ANNOTATOR FIELD ====================

function ImageAnnotatorField({
  value,
  onChange,
  onUpload,
  readOnly
}: {
  value?: AttachmentPreview;
  onChange: (v: AttachmentPreview) => void;
  onUpload?: (file: File) => Promise<string>;
  readOnly?: boolean;
}) {
  const [isDrawing, setIsDrawing] = useState(false);
  const [startPos, setStartPos] = useState<{ x: number; y: number } | null>(null);
  const [currentAnnotation, setCurrentAnnotation] = useState<Partial<ImageAnnotation> | null>(null);
  const [selectedAnnotation, setSelectedAnnotation] = useState<string | null>(null);
  const [annotationLabel, setAnnotationLabel] = useState('');
  const canvasRef = useRef<HTMLDivElement>(null);
  
  const annotations = value?.annotations || [];
  const annotationColors = ['#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899'];

  const handleImageUpload = async (files: File[]) => {
    if (files.length === 0 || !onUpload) return;
    
    const file = files[0];
    const url = await onUpload(file);
    
    onChange({
      id: crypto.randomUUID(),
      filename: file.name,
      mime: file.type,
      url,
      size: file.size,
      annotations: []
    });
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (readOnly || !value) return;
    
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    
    setIsDrawing(true);
    setStartPos({ x, y });
    setCurrentAnnotation({
      x,
      y,
      width: 0,
      height: 0,
      color: annotationColors[annotations.length % annotationColors.length]
    });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDrawing || !startPos || !canvasRef.current) return;
    
    const rect = canvasRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    
    setCurrentAnnotation(prev => ({
      ...prev,
      x: Math.min(startPos.x, x),
      y: Math.min(startPos.y, y),
      width: Math.abs(x - startPos.x),
      height: Math.abs(y - startPos.y)
    }));
  };

  const handleMouseUp = () => {
    if (!isDrawing || !currentAnnotation) return;
    
    setIsDrawing(false);
    
    // Only save if the box is large enough
    if ((currentAnnotation.width || 0) > 2 && (currentAnnotation.height || 0) > 2) {
      setSelectedAnnotation('new');
    } else {
      setCurrentAnnotation(null);
    }
    
    setStartPos(null);
  };

  const saveAnnotation = () => {
    if (!currentAnnotation || !value) return;
    
    const newAnnotation: ImageAnnotation = {
      id: crypto.randomUUID(),
      x: currentAnnotation.x || 0,
      y: currentAnnotation.y || 0,
      width: currentAnnotation.width || 0,
      height: currentAnnotation.height || 0,
      label: annotationLabel || 'Unlabeled',
      color: currentAnnotation.color || annotationColors[0],
      createdAt: new Date()
    };
    
    onChange({
      ...value,
      annotations: [...annotations, newAnnotation]
    });
    
    setCurrentAnnotation(null);
    setSelectedAnnotation(null);
    setAnnotationLabel('');
  };

  const deleteAnnotation = (id: string) => {
    if (!value) return;
    
    onChange({
      ...value,
      annotations: annotations.filter(a => a.id !== id)
    });
    setSelectedAnnotation(null);
  };

  if (!value) {
    return (
      <AttachmentField
        value={[]}
        onChange={() => {}}
        onUpload={onUpload ? async (file) => {
          await handleImageUpload([file]);
          return '';
        } : undefined}
        readOnly={readOnly}
        accept="image/*"
        multiple={false}
      />
    );
  }

  return (
    <div style={styles.annotatorContainer}>
      <div
        ref={canvasRef}
        style={styles.annotatorCanvas}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={() => setIsDrawing(false)}
      >
        <img
          src={value.url}
          alt={value.filename}
          style={styles.annotatorImage}
          draggable={false}
        />
        
        {/* Existing annotations */}
        {annotations.map(ann => (
          <div
            key={ann.id}
            style={{
              ...styles.annotation,
              left: `${ann.x}%`,
              top: `${ann.y}%`,
              width: `${ann.width}%`,
              height: `${ann.height}%`,
              borderColor: ann.color,
              backgroundColor: selectedAnnotation === ann.id 
                ? `${ann.color}33` 
                : `${ann.color}11`
            }}
            onClick={(e) => {
              e.stopPropagation();
              setSelectedAnnotation(ann.id);
            }}
          >
            <span
              style={{
                ...styles.annotationLabel,
                backgroundColor: ann.color
              }}
            >
              {ann.label}
            </span>
          </div>
        ))}
        
        {/* Current drawing */}
        {currentAnnotation && (currentAnnotation.width || 0) > 0 && (
          <div
            style={{
              ...styles.annotation,
              left: `${currentAnnotation.x}%`,
              top: `${currentAnnotation.y}%`,
              width: `${currentAnnotation.width}%`,
              height: `${currentAnnotation.height}%`,
              borderColor: currentAnnotation.color,
              borderStyle: 'dashed'
            }}
          />
        )}
      </div>
      
      {/* Annotation Label Input */}
      {selectedAnnotation === 'new' && currentAnnotation && (
        <div style={styles.annotationInput}>
          <input
            type="text"
            placeholder="Enter annotation label..."
            value={annotationLabel}
            onChange={e => setAnnotationLabel(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && saveAnnotation()}
            style={styles.input}
            autoFocus
          />
          <button onClick={saveAnnotation} style={styles.addButton}>Save</button>
          <button 
            onClick={() => {
              setCurrentAnnotation(null);
              setSelectedAnnotation(null);
              setAnnotationLabel('');
            }} 
            style={styles.removeButton}
          >
            Cancel
          </button>
        </div>
      )}
      
      {/* Annotation List */}
      {annotations.length > 0 && (
        <div style={styles.annotationList}>
          <strong>Annotations:</strong>
          {annotations.map(ann => (
            <div key={ann.id} style={styles.annotationListItem}>
              <span style={{ color: ann.color }}>●</span>
              <span>{ann.label}</span>
              {!readOnly && (
                <button
                  onClick={() => deleteAnnotation(ann.id)}
                  style={styles.removeButton}
                  aria-label={`Delete annotation ${ann.label}`}
                >
                  ×
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      
      {!readOnly && (
        <p style={styles.help}>
          Click and drag on the image to create annotation regions
        </p>
      )}
    </div>
  );
}

function ArrayField({ 
  schema, 
  path, 
  value, 
  onChange, 
  errors, 
  readOnly, 
  compact,
  onAttachmentUpload,
  formValue
}: {
  schema: JSONSchema;
  path: string;
  value: unknown[];
  onChange: (path: string, value: unknown) => void;
  errors: FormError[];
  readOnly?: boolean;
  compact?: boolean;
  onAttachmentUpload?: (file: File, path: string) => Promise<string>;
  formValue?: Record<string, unknown>;
}) {
  const items = value || [];
  const itemSchema = schema.items as JSONSchema;

  const addItem = () => {
    const newItem = itemSchema?.type === 'object' ? {} : 
                    itemSchema?.type === 'number' ? 0 : '';
    onChange(path, [...items, newItem]);
  };

  const removeItem = (index: number) => {
    onChange(path, items.filter((_, i) => i !== index));
  };

  const updateItem = (index: number, newValue: unknown) => {
    const newItems = [...items];
    newItems[index] = newValue;
    onChange(path, newItems);
  };

  // Simple array of primitives
  if (itemSchema && (itemSchema.type === 'string' || itemSchema.type === 'number')) {
    return (
      <div style={styles.arrayContainer} role="list" aria-label={schema.title || 'List'}>
        {items.map((item, index) => (
          <div key={index} style={styles.arrayItem} role="listitem">
            <input
              type={itemSchema.type === 'number' ? 'number' : 'text'}
              value={item as string | number || ''}
              onChange={e => updateItem(index, itemSchema.type === 'number' ? parseFloat(e.target.value) : e.target.value)}
              readOnly={readOnly}
              aria-label={`Item ${index + 1}`}
              style={{ ...styles.input, flex: 1 }}
            />
            {!readOnly && (
              <button 
                onClick={() => removeItem(index)} 
                style={styles.removeButton}
                aria-label={`Remove item ${index + 1}`}
              >
                ×
              </button>
            )}
          </div>
        ))}
        {!readOnly && (
          <button onClick={addItem} style={styles.addButton}>+ Add Item</button>
        )}
      </div>
    );
  }

  // Array of objects
  return (
    <div style={styles.arrayContainer} role="list" aria-label={schema.title || 'List'}>
      {items.map((item, index) => (
        <div key={index} style={styles.arrayObjectItem} role="listitem">
          <div style={styles.arrayItemHeader}>
            <span style={styles.arrayItemIndex}>#{index + 1}</span>
            {!readOnly && (
              <button 
                onClick={() => removeItem(index)} 
                style={styles.removeButton}
                aria-label={`Remove item ${index + 1}`}
              >
                ×
              </button>
            )}
          </div>
          {itemSchema?.type === 'object' && itemSchema.properties && (
            <div style={styles.nestedObject}>
              {Object.keys(itemSchema.properties).map(key => {
                const fieldSchema = itemSchema.properties![key];
                return (
                  <Field
                    key={key}
                    schema={fieldSchema}
                    path={`${path}.${index}.${key}`}
                    value={(item as Record<string, unknown>)?.[key]}
                    onChange={(_, v) => updateItem(index, { ...(item as object), [key]: v })}
                    errors={errors}
                    readOnly={readOnly}
                    compact={true}
                  />
                );
              })}
            </div>
          )}
        </div>
      ))}
      {!readOnly && (
        <button onClick={addItem} style={styles.addButton}>+ Add {schema.title || 'Item'}</button>
      )}
    </div>
  );
}

function ObjectField({ 
  schema, 
  path, 
  value, 
  onChange, 
  errors, 
  readOnly, 
  compact,
  onAttachmentUpload,
  formValue
}: {
  schema: JSONSchema;
  path: string;
  value: Record<string, unknown>;
  onChange: (path: string, value: unknown) => void;
  errors: FormError[];
  readOnly?: boolean;
  compact?: boolean;
  onAttachmentUpload?: (file: File, path: string) => Promise<string>;
  formValue?: Record<string, unknown>;
}) {
  const obj = value || {};
  
  const handleNestedChange = (nestedPath: string, newValue: unknown) => {
    const key = nestedPath.split('.').pop()!;
    onChange(path, { ...obj, [key]: newValue });
  };

  if (!schema.properties) return null;

  return (
    <div style={styles.nestedObject} role="group" aria-label={schema.title}>
      {Object.keys(schema.properties).map(key => {
        const fieldSchema = schema.properties![key];
        if (fieldSchema['ui:hidden']) return null;
        
        return (
          <Field
            key={key}
            schema={fieldSchema}
            path={`${path}.${key}`}
            value={obj[key]}
            onChange={handleNestedChange}
            errors={errors}
            readOnly={readOnly}
            compact={true}
            onAttachmentUpload={onAttachmentUpload}
            formValue={formValue}
          />
        );
      })}
    </div>
  );
}

// ==================== UTILITIES ====================

function formatLabel(key: string): string {
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/_/g, ' ')
    .replace(/^\w/, c => c.toUpperCase())
    .trim();
}

function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce((acc: unknown, key) => {
    if (acc && typeof acc === 'object') {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
}

function setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): Record<string, unknown> {
  const keys = path.split('.');
  const lastKey = keys.pop()!;
  
  let current = obj;
  for (const key of keys) {
    if (!(key in current) || typeof current[key] !== 'object') {
      current[key] = {};
    }
    current = current[key] as Record<string, unknown>;
  }
  
  current[lastKey] = value;
  return obj;
}

function validateSchema(schema: JSONSchema, value: Record<string, unknown>, useConditionalLogic = true): FormError[] {
  const errors: FormError[] = [];
  
  if (schema.properties) {
    // Check required fields
    const requiredFields = schema.required || [];
    
    for (const key of Object.keys(schema.properties)) {
      const fieldSchema = schema.properties[key];
      const fieldValue = value[key];
      
      // Check visibility with conditional logic
      if (useConditionalLogic) {
        const { visible, required } = evaluateFieldVisibility(fieldSchema, value);
        if (!visible) continue;
        
        // Dynamically required field
        if (required && (fieldValue === undefined || fieldValue === null || fieldValue === '')) {
          errors.push({
            path: key,
            message: `${fieldSchema.title || formatLabel(key)} is required`,
            type: 'error'
          });
          continue;
        }
      }
      
      // Static required check
      if (requiredFields.includes(key)) {
        if (fieldValue === undefined || fieldValue === null || fieldValue === '') {
          errors.push({
            path: key,
            message: `${fieldSchema.title || formatLabel(key)} is required`,
            type: 'error'
          });
          continue;
        }
      }
      
      // Skip further validation if no value
      if (fieldValue === undefined || fieldValue === null) continue;
      
      // Type validation
      if (fieldSchema.type === 'string' && typeof fieldValue !== 'string') {
        errors.push({
          path: key,
          message: `${fieldSchema.title || formatLabel(key)} must be text`,
          type: 'error'
        });
      }
      
      if ((fieldSchema.type === 'number' || fieldSchema.type === 'integer') && typeof fieldValue !== 'number') {
        errors.push({
          path: key,
          message: `${fieldSchema.title || formatLabel(key)} must be a number`,
          type: 'error'
        });
      }
      
      // String validations
      if (typeof fieldValue === 'string') {
        if (fieldSchema.minLength && fieldValue.length < fieldSchema.minLength) {
          errors.push({
            path: key,
            message: `${fieldSchema.title || formatLabel(key)} must be at least ${fieldSchema.minLength} characters`,
            type: 'error'
          });
        }
        
        if (fieldSchema.maxLength && fieldValue.length > fieldSchema.maxLength) {
          errors.push({
            path: key,
            message: `${fieldSchema.title || formatLabel(key)} must be no more than ${fieldSchema.maxLength} characters`,
            type: 'error'
          });
        }
        
        if (fieldSchema.pattern) {
          const regex = new RegExp(fieldSchema.pattern);
          if (!regex.test(fieldValue)) {
            errors.push({
              path: key,
              message: fieldSchema['ui:patternMessage'] as string || `${fieldSchema.title || formatLabel(key)} has an invalid format`,
              type: 'error'
            });
          }
        }
        
        // Email validation
        if (fieldSchema.format === 'email') {
          const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
          if (!emailRegex.test(fieldValue)) {
            errors.push({
              path: key,
              message: `${fieldSchema.title || formatLabel(key)} must be a valid email address`,
              type: 'error'
            });
          }
        }
      }
      
      // Number validations
      if (typeof fieldValue === 'number') {
        if (fieldSchema.minimum !== undefined && fieldValue < fieldSchema.minimum) {
          errors.push({
            path: key,
            message: `${fieldSchema.title || formatLabel(key)} must be at least ${fieldSchema.minimum}`,
            type: 'error'
          });
        }
        
        if (fieldSchema.maximum !== undefined && fieldValue > fieldSchema.maximum) {
          errors.push({
            path: key,
            message: `${fieldSchema.title || formatLabel(key)} must be no more than ${fieldSchema.maximum}`,
            type: 'error'
          });
        }
        
        if (fieldSchema.type === 'integer' && !Number.isInteger(fieldValue)) {
          errors.push({
            path: key,
            message: `${fieldSchema.title || formatLabel(key)} must be a whole number`,
            type: 'error'
          });
        }
      }
      
      // Enum validation
      if (fieldSchema.enum && !fieldSchema.enum.includes(fieldValue)) {
        errors.push({
          path: key,
          message: `${fieldSchema.title || formatLabel(key)} must be one of: ${fieldSchema.enum.join(', ')}`,
          type: 'error'
        });
      }
      
      // Array validations
      if (Array.isArray(fieldValue)) {
        if (fieldSchema.minItems !== undefined && fieldValue.length < fieldSchema.minItems) {
          errors.push({
            path: key,
            message: `${fieldSchema.title || formatLabel(key)} must have at least ${fieldSchema.minItems} items`,
            type: 'error'
          });
        }
        
        if (fieldSchema.maxItems !== undefined && fieldValue.length > fieldSchema.maxItems) {
          errors.push({
            path: key,
            message: `${fieldSchema.title || formatLabel(key)} must have no more than ${fieldSchema.maxItems} items`,
            type: 'error'
          });
        }
      }
    }
  }
  
  return errors;
}

function getFileIcon(mime: string): string {
  if (mime.startsWith('image/')) return '🖼️';
  if (mime.startsWith('video/')) return '🎬';
  if (mime.startsWith('audio/')) return '🎵';
  if (mime === 'application/pdf') return '📄';
  if (mime.includes('spreadsheet') || mime.includes('excel')) return '📊';
  if (mime.includes('document') || mime.includes('word')) return '📝';
  if (mime.includes('zip') || mime.includes('compressed')) return '📦';
  return '📎';
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

// ==================== STYLES ====================

const styles: Record<string, React.CSSProperties> = {
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
    padding: 16
  },
  formCompact: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    padding: 8
  },
  formTitle: {
    margin: 0,
    fontSize: 18,
    fontWeight: 600,
    color: '#0f172a'
  },
  formDescription: {
    margin: 0,
    fontSize: 14,
    color: '#64748b'
  },
  field: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4
  },
  fieldCompact: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    fontSize: 13
  },
  label: {
    fontSize: 14,
    fontWeight: 500,
    color: '#334155'
  },
  required: {
    color: '#ef4444',
    marginLeft: 4
  },
  input: {
    padding: '8px 12px',
    border: '1px solid #e2e8f0',
    borderRadius: 6,
    fontSize: 14,
    outline: 'none',
    transition: 'border-color 0.2s',
    backgroundColor: '#fff'
  },
  select: {
    padding: '8px 12px',
    border: '1px solid #e2e8f0',
    borderRadius: 6,
    fontSize: 14,
    backgroundColor: '#fff',
    cursor: 'pointer'
  },
  checkbox: {
    width: 18,
    height: 18,
    cursor: 'pointer'
  },
  textarea: {
    padding: '8px 12px',
    border: '1px solid #e2e8f0',
    borderRadius: 6,
    fontSize: 14,
    resize: 'vertical',
    fontFamily: 'inherit',
    minHeight: 80
  },
  help: {
    fontSize: 12,
    color: '#64748b',
    fontStyle: 'italic'
  },
  error: {
    padding: 12,
    background: '#fef2f2',
    border: '1px solid #fecaca',
    borderRadius: 6,
    color: '#dc2626'
  },
  errorMessage: {
    fontSize: 12,
    color: '#dc2626'
  },
  arrayContainer: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    paddingLeft: 12,
    borderLeft: '2px solid #e2e8f0'
  },
  arrayItem: {
    display: 'flex',
    gap: 8,
    alignItems: 'center'
  },
  arrayObjectItem: {
    background: '#f8fafc',
    border: '1px solid #e2e8f0',
    borderRadius: 6,
    padding: 12
  },
  arrayItemHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8
  },
  arrayItemIndex: {
    fontSize: 12,
    color: '#64748b',
    fontWeight: 500
  },
  addButton: {
    padding: '6px 12px',
    background: '#f1f5f9',
    border: '1px dashed #cbd5e1',
    borderRadius: 6,
    cursor: 'pointer',
    fontSize: 13,
    color: '#475569'
  },
  removeButton: {
    width: 24,
    height: 24,
    padding: 0,
    background: '#fee2e2',
    border: 'none',
    borderRadius: 4,
    cursor: 'pointer',
    color: '#dc2626',
    fontSize: 16,
    fontWeight: 'bold'
  },
  nestedObject: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    paddingLeft: 12,
    borderLeft: '2px solid #e2e8f0'
  }
};

export default SchemaForm;
