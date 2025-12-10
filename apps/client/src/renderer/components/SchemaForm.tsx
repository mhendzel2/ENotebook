/**
 * Dynamic Form Components for JSON Schema
 * Renders forms based on JSON Schema definitions with custom UI widgets
 */

import React, { useMemo, useCallback, useState } from 'react';
import type { JSONSchema } from '@eln/shared';

// ==================== TYPES ====================

export interface SchemaFormProps {
  schema: JSONSchema;
  value: Record<string, unknown>;
  onChange: (value: Record<string, unknown>) => void;
  onValidate?: (errors: FormError[]) => void;
  readOnly?: boolean;
  compact?: boolean;
}

export interface FormError {
  path: string;
  message: string;
}

interface FieldProps {
  schema: JSONSchema;
  path: string;
  value: unknown;
  onChange: (path: string, value: unknown) => void;
  errors: FormError[];
  readOnly?: boolean;
  compact?: boolean;
}

// ==================== MAIN FORM COMPONENT ====================

export function SchemaForm({ schema, value, onChange, onValidate, readOnly, compact }: SchemaFormProps) {
  const [errors, setErrors] = useState<FormError[]>([]);

  const handleChange = useCallback((path: string, fieldValue: unknown) => {
    const newValue = setNestedValue({ ...value }, path, fieldValue);
    onChange(newValue);
    
    // Validate on change
    const validationErrors = validateSchema(schema, newValue);
    setErrors(validationErrors);
    onValidate?.(validationErrors);
  }, [value, onChange, schema, onValidate]);

  if (schema.type !== 'object' || !schema.properties) {
    return <div style={styles.error}>Schema must be an object with properties</div>;
  }

  const orderedKeys = schema['ui:order'] || Object.keys(schema.properties);

  return (
    <div style={compact ? styles.formCompact : styles.form}>
      {schema.title && <h3 style={styles.formTitle}>{schema.title}</h3>}
      {schema.description && <p style={styles.formDescription}>{schema.description}</p>}
      
      {orderedKeys.map(key => {
        const fieldSchema = schema.properties![key];
        if (!fieldSchema || fieldSchema['ui:hidden']) return null;
        
        return (
          <Field
            key={key}
            schema={fieldSchema}
            path={key}
            value={getNestedValue(value, key)}
            onChange={handleChange}
            errors={errors.filter(e => e.path.startsWith(key))}
            readOnly={readOnly || fieldSchema['ui:readonly']}
            compact={compact}
          />
        );
      })}
    </div>
  );
}

// ==================== FIELD RENDERER ====================

function Field({ schema, path, value, onChange, errors, readOnly, compact }: FieldProps) {
  const fieldErrors = errors.filter(e => e.path === path);
  const hasError = fieldErrors.length > 0;

  const label = schema.title || formatLabel(path);
  const widget = schema['ui:widget'];
  const isRequired = false; // Would check parent schema's required array

  // Render based on type and widget
  let input: React.ReactNode;

  if (schema.enum) {
    input = (
      <SelectField
        options={schema.enum as string[]}
        value={value as string}
        onChange={v => onChange(path, v)}
        readOnly={readOnly}
      />
    );
  } else if (widget === 'select') {
    input = (
      <SelectField
        options={schema.enum as string[] || []}
        value={value as string}
        onChange={v => onChange(path, v)}
        readOnly={readOnly}
      />
    );
  } else if (widget === 'textarea' || widget === 'richtext') {
    input = (
      <TextAreaField
        value={value as string}
        onChange={v => onChange(path, v)}
        placeholder={schema['ui:placeholder']}
        readOnly={readOnly}
        richText={widget === 'richtext'}
      />
    );
  } else if (schema.type === 'boolean') {
    input = (
      <CheckboxField
        value={value as boolean}
        onChange={v => onChange(path, v)}
        readOnly={readOnly}
      />
    );
  } else if (schema.type === 'number' || schema.type === 'integer') {
    input = (
      <NumberField
        value={value as number}
        onChange={v => onChange(path, v)}
        min={schema.minimum}
        max={schema.maximum}
        step={schema.type === 'integer' ? 1 : undefined}
        readOnly={readOnly}
        scientific={widget === 'scientific'}
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
      />
    );
  } else {
    // Default to text input
    input = (
      <TextField
        value={value as string}
        onChange={v => onChange(path, v)}
        placeholder={schema['ui:placeholder']}
        pattern={schema.pattern}
        readOnly={readOnly}
      />
    );
  }

  return (
    <div style={compact ? styles.fieldCompact : styles.field}>
      <label style={styles.label}>
        {label}
        {isRequired && <span style={styles.required}>*</span>}
      </label>
      {input}
      {schema['ui:help'] && <span style={styles.help}>{schema['ui:help']}</span>}
      {hasError && <span style={styles.errorMessage}>{fieldErrors[0].message}</span>}
    </div>
  );
}

// ==================== FIELD COMPONENTS ====================

function TextField({ 
  value, 
  onChange, 
  placeholder, 
  pattern, 
  readOnly 
}: { 
  value: string; 
  onChange: (v: string) => void; 
  placeholder?: string; 
  pattern?: string; 
  readOnly?: boolean; 
}) {
  return (
    <input
      type="text"
      value={value || ''}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      pattern={pattern}
      readOnly={readOnly}
      style={styles.input}
    />
  );
}

function NumberField({ 
  value, 
  onChange, 
  min, 
  max, 
  step, 
  readOnly, 
  scientific 
}: { 
  value: number; 
  onChange: (v: number) => void; 
  min?: number; 
  max?: number; 
  step?: number; 
  readOnly?: boolean; 
  scientific?: boolean;
}) {
  const displayValue = scientific && value ? value.toExponential(2) : value;
  
  return (
    <input
      type="number"
      value={displayValue ?? ''}
      onChange={e => onChange(parseFloat(e.target.value))}
      min={min}
      max={max}
      step={step}
      readOnly={readOnly}
      style={styles.input}
    />
  );
}

function SelectField({ 
  options, 
  value, 
  onChange, 
  readOnly 
}: { 
  options: string[]; 
  value: string; 
  onChange: (v: string) => void; 
  readOnly?: boolean;
}) {
  return (
    <select
      value={value || ''}
      onChange={e => onChange(e.target.value)}
      disabled={readOnly}
      style={styles.select}
    >
      <option value="">— Select —</option>
      {options.map(opt => (
        <option key={opt} value={opt}>{formatLabel(opt)}</option>
      ))}
    </select>
  );
}

function CheckboxField({ 
  value, 
  onChange, 
  readOnly 
}: { 
  value: boolean; 
  onChange: (v: boolean) => void; 
  readOnly?: boolean;
}) {
  return (
    <input
      type="checkbox"
      checked={value || false}
      onChange={e => onChange(e.target.checked)}
      disabled={readOnly}
      style={styles.checkbox}
    />
  );
}

function TextAreaField({ 
  value, 
  onChange, 
  placeholder, 
  readOnly, 
  richText 
}: { 
  value: string; 
  onChange: (v: string) => void; 
  placeholder?: string; 
  readOnly?: boolean;
  richText?: boolean;
}) {
  // For richText, we'd integrate a rich text editor like TipTap or Slate
  // For now, use a simple textarea with basic formatting hints
  return (
    <textarea
      value={value || ''}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      readOnly={readOnly}
      style={styles.textarea}
      rows={richText ? 8 : 4}
    />
  );
}

function ArrayField({ 
  schema, 
  path, 
  value, 
  onChange, 
  errors, 
  readOnly, 
  compact 
}: {
  schema: JSONSchema;
  path: string;
  value: unknown[];
  onChange: (path: string, value: unknown) => void;
  errors: FormError[];
  readOnly?: boolean;
  compact?: boolean;
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
      <div style={styles.arrayContainer}>
        {items.map((item, index) => (
          <div key={index} style={styles.arrayItem}>
            <input
              type={itemSchema.type === 'number' ? 'number' : 'text'}
              value={item as string | number || ''}
              onChange={e => updateItem(index, itemSchema.type === 'number' ? parseFloat(e.target.value) : e.target.value)}
              readOnly={readOnly}
              style={{ ...styles.input, flex: 1 }}
            />
            {!readOnly && (
              <button onClick={() => removeItem(index)} style={styles.removeButton}>×</button>
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
    <div style={styles.arrayContainer}>
      {items.map((item, index) => (
        <div key={index} style={styles.arrayObjectItem}>
          <div style={styles.arrayItemHeader}>
            <span style={styles.arrayItemIndex}>#{index + 1}</span>
            {!readOnly && (
              <button onClick={() => removeItem(index)} style={styles.removeButton}>×</button>
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
  compact 
}: {
  schema: JSONSchema;
  path: string;
  value: Record<string, unknown>;
  onChange: (path: string, value: unknown) => void;
  errors: FormError[];
  readOnly?: boolean;
  compact?: boolean;
}) {
  const obj = value || {};
  
  const handleNestedChange = (nestedPath: string, newValue: unknown) => {
    const key = nestedPath.split('.').pop()!;
    onChange(path, { ...obj, [key]: newValue });
  };

  if (!schema.properties) return null;

  return (
    <div style={styles.nestedObject}>
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

function validateSchema(schema: JSONSchema, value: Record<string, unknown>): FormError[] {
  const errors: FormError[] = [];
  
  if (schema.required && schema.properties) {
    for (const requiredKey of schema.required) {
      const fieldValue = value[requiredKey];
      if (fieldValue === undefined || fieldValue === null || fieldValue === '') {
        errors.push({
          path: requiredKey,
          message: `${schema.properties[requiredKey]?.title || requiredKey} is required`
        });
      }
    }
  }
  
  // Add more validation logic for patterns, min/max, etc.
  
  return errors;
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
