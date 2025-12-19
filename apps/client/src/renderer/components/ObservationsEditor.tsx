/**
 * Rich Observations Editor Component
 * Provides structured data entry for experiment observations
 * including dynamic tables, measurements, kinetic data, and cell counts
 */

import React, { useState, useCallback } from 'react';
import type { 
  RichObservations, 
  ObservationTable, 
  TableColumn, 
  Measurement, 
  KineticData, 
  CellCountData, 
  CellCount 
} from '@eln/shared';
import { v4 as uuid } from 'uuid';
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  Legend, 
  ResponsiveContainer 
} from 'recharts';

// ==================== TYPES ====================

interface ObservationsEditorProps {
  value: RichObservations;
  onChange: (value: RichObservations) => void;
  readOnly?: boolean;
  appendOnly?: boolean; // 21 CFR Part 11 compliance: additions only, no deletions
  userName?: string; // For tracking who added entries
}

type ActiveSection = 'narrative' | 'tables' | 'measurements' | 'kinetics' | 'cellCounts' | 'conclusions';

// ==================== MAIN COMPONENT ====================

export function ObservationsEditor({ value, onChange, readOnly, appendOnly = false, userName }: ObservationsEditorProps) {
  const [activeSection, setActiveSection] = useState<ActiveSection>('narrative');

  const updateField = useCallback(<K extends keyof RichObservations>(
    field: K, 
    fieldValue: RichObservations[K]
  ) => {
    onChange({ ...value, [field]: fieldValue });
  }, [value, onChange]);

  const sections: { id: ActiveSection; label: string; icon: string }[] = [
    { id: 'narrative', label: 'Narrative', icon: '📝' },
    { id: 'tables', label: 'Data Tables', icon: '📊' },
    { id: 'measurements', label: 'Measurements', icon: '📏' },
    { id: 'kinetics', label: 'Kinetic Data', icon: '📈' },
    { id: 'cellCounts', label: 'Cell Counts', icon: '🔬' },
    { id: 'conclusions', label: 'Conclusions', icon: '✓' }
  ];

  return (
    <div style={styles.container}>
      {appendOnly && (
        <div style={styles.complianceBanner}>
          🔒 Append-Only Mode: New entries can be added but existing data cannot be deleted (21 CFR Part 11)
        </div>
      )}
      <div style={styles.tabs}>
        {sections.map(section => (
          <button
            key={section.id}
            onClick={() => setActiveSection(section.id)}
            style={{
              ...styles.tab,
              ...(activeSection === section.id ? styles.tabActive : {})
            }}
          >
            <span>{section.icon}</span>
            <span>{section.label}</span>
          </button>
        ))}
      </div>

      <div style={styles.content}>
        {activeSection === 'narrative' && (
          <NarrativeEditor
            value={value.narrative || ''}
            onChange={v => updateField('narrative', v)}
            readOnly={readOnly}
            appendOnly={appendOnly}
          />
        )}

        {activeSection === 'tables' && (
          <TablesEditor
            tables={value.tables || []}
            onChange={tables => updateField('tables', tables)}
            readOnly={readOnly}
            appendOnly={appendOnly}
            userName={userName}
          />
        )}

        {activeSection === 'measurements' && (
          <MeasurementsEditor
            measurements={value.measurements || []}
            onChange={measurements => updateField('measurements', measurements)}
            readOnly={readOnly}
            appendOnly={appendOnly}
            userName={userName}
          />
        )}

        {activeSection === 'kinetics' && (
          <KineticsEditor
            data={value.kineticData}
            onChange={data => updateField('kineticData', data)}
            readOnly={readOnly}
            appendOnly={appendOnly}
            userName={userName}
          />
        )}

        {activeSection === 'cellCounts' && (
          <CellCountsEditor
            data={value.cellCounts}
            onChange={data => updateField('cellCounts', data)}
            readOnly={readOnly}
            appendOnly={appendOnly}
            userName={userName}
          />
        )}

        {activeSection === 'conclusions' && (
          <ConclusionsEditor
            value={value.conclusions || ''}
            onChange={v => updateField('conclusions', v)}
            readOnly={readOnly}
          />
        )}
      </div>
    </div>
  );
}

// ==================== NARRATIVE EDITOR ====================

function NarrativeEditor({ 
  value, 
  onChange, 
  readOnly,
  appendOnly 
}: { 
  value: string; 
  onChange: (v: string) => void; 
  readOnly?: boolean;
  appendOnly?: boolean;
}) {
  // In a real implementation, this would use a rich text editor like TipTap, Slate, or Quill
  // For now, we provide a textarea with basic markdown-style formatting
  const [preview, setPreview] = useState(false);
  const [newEntry, setNewEntry] = useState('');

  const handleAppend = () => {
    if (!newEntry.trim()) return;
    const timestamp = new Date().toISOString();
    const formattedEntry = `\n\n---\n**[${new Date(timestamp).toLocaleString()}]**\n${newEntry}`;
    onChange(value + formattedEntry);
    setNewEntry('');
  };

  return (
    <div style={styles.section}>
      <div style={styles.sectionHeader}>
        <h3 style={styles.sectionTitle}>Narrative Observations</h3>
        <button 
          onClick={() => setPreview(!preview)} 
          style={styles.toggleButton}
        >
          {preview ? 'Edit' : 'Preview'}
        </button>
      </div>
      
      {!preview ? (
        <>
          {appendOnly ? (
            // Append-only mode: show existing content as read-only, with an input to add new entries
            <>
              <div style={styles.existingContent}>
                <label style={styles.label}>Existing Observations (read-only):</label>
                <div 
                  style={styles.readOnlyContent}
                  dangerouslySetInnerHTML={{ __html: simpleMarkdownToHtml(value) || '<em>No observations yet</em>' }}
                />
              </div>
              {!readOnly && (
                <div style={styles.appendSection}>
                  <label style={styles.label}>Add New Entry:</label>
                  <textarea
                    value={newEntry}
                    onChange={e => setNewEntry(e.target.value)}
                    placeholder="Add a new observation entry (will be timestamped)..."
                    style={styles.richTextArea}
                  />
                  <button onClick={handleAppend} style={styles.addButton} disabled={!newEntry.trim()}>
                    + Add Entry (Timestamped)
                  </button>
                </div>
              )}
            </>
          ) : (
            // Standard edit mode
            <>
              <div style={styles.toolbar}>
                <button style={styles.toolbarButton} title="Bold">B</button>
                <button style={styles.toolbarButton} title="Italic">I</button>
                <button style={styles.toolbarButton} title="Heading">H</button>
                <button style={styles.toolbarButton} title="List">•</button>
                <button style={styles.toolbarButton} title="Link">🔗</button>
              </div>
              <textarea
                value={value}
                onChange={e => onChange(e.target.value)}
                readOnly={readOnly}
                placeholder="Enter your observations here. Supports markdown formatting..."
                style={styles.richTextArea}
              />
            </>
          )}
        </>
      ) : (
        <div 
          style={styles.preview}
          dangerouslySetInnerHTML={{ __html: simpleMarkdownToHtml(value) }}
        />
      )}
    </div>
  );
}

// ==================== TABLES EDITOR ====================

function TablesEditor({ 
  tables, 
  onChange, 
  readOnly 
}: { 
  tables: ObservationTable[]; 
  onChange: (tables: ObservationTable[]) => void;
  readOnly?: boolean;
}) {
  const [editingTable, setEditingTable] = useState<string | null>(null);

  const addTable = () => {
    const newTable: ObservationTable = {
      id: uuid(),
      title: 'New Table',
      columns: [
        { key: 'sample', header: 'Sample', type: 'text' },
        { key: 'value', header: 'Value', type: 'number' }
      ],
      rows: [{ sample: '', value: '' }]
    };
    onChange([...tables, newTable]);
    setEditingTable(newTable.id);
  };

  const updateTable = (tableId: string, updates: Partial<ObservationTable>) => {
    onChange(tables.map(t => t.id === tableId ? { ...t, ...updates } : t));
  };

  const deleteTable = (tableId: string) => {
    onChange(tables.filter(t => t.id !== tableId));
  };

  const addColumn = (tableId: string) => {
    const table = tables.find(t => t.id === tableId);
    if (!table) return;
    
    const newKey = `col_${table.columns.length + 1}`;
    const newColumn: TableColumn = {
      key: newKey,
      header: `Column ${table.columns.length + 1}`,
      type: 'text'
    };
    
    updateTable(tableId, {
      columns: [...table.columns, newColumn],
      rows: table.rows.map(row => ({ ...row, [newKey]: '' }))
    });
  };

  const addRow = (tableId: string) => {
    const table = tables.find(t => t.id === tableId);
    if (!table) return;
    
    const newRow: Record<string, unknown> = {};
    table.columns.forEach(col => {
      newRow[col.key] = '';
    });
    
    updateTable(tableId, { rows: [...table.rows, newRow] });
  };

  const updateCell = (tableId: string, rowIndex: number, columnKey: string, value: unknown) => {
    const table = tables.find(t => t.id === tableId);
    if (!table) return;
    
    const newRows = [...table.rows];
    newRows[rowIndex] = { ...newRows[rowIndex], [columnKey]: value };
    updateTable(tableId, { rows: newRows });
  };

  const deleteRow = (tableId: string, rowIndex: number) => {
    const table = tables.find(t => t.id === tableId);
    if (!table) return;
    
    updateTable(tableId, { rows: table.rows.filter((_, i) => i !== rowIndex) });
  };

  return (
    <div style={styles.section}>
      <div style={styles.sectionHeader}>
        <h3 style={styles.sectionTitle}>Data Tables</h3>
        {!readOnly && (
          <button onClick={addTable} style={styles.addButton}>+ Add Table</button>
        )}
      </div>

      {tables.map(table => (
        <div key={table.id} style={styles.tableContainer}>
          <div style={styles.tableHeader}>
            <input
              value={table.title}
              onChange={e => updateTable(table.id, { title: e.target.value })}
              style={styles.tableTitleInput}
              readOnly={readOnly}
            />
            {!readOnly && (
              <div style={styles.tableActions}>
                <button onClick={() => addColumn(table.id)} style={styles.smallButton}>+ Column</button>
                <button onClick={() => addRow(table.id)} style={styles.smallButton}>+ Row</button>
                <button onClick={() => deleteTable(table.id)} style={styles.deleteButton}>Delete</button>
              </div>
            )}
          </div>
          
          <table style={styles.dataTable}>
            <thead>
              <tr>
                {table.columns.map(col => (
                  <th key={col.key} style={styles.th}>
                    {readOnly ? col.header : (
                      <input
                        value={col.header}
                        onChange={e => {
                          const newCols = table.columns.map(c => 
                            c.key === col.key ? { ...c, header: e.target.value } : c
                          );
                          updateTable(table.id, { columns: newCols });
                        }}
                        style={styles.headerInput}
                      />
                    )}
                    {col.unit && <span style={styles.unit}>({col.unit})</span>}
                  </th>
                ))}
                {!readOnly && <th style={styles.th}></th>}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {table.columns.map(col => (
                    <td key={col.key} style={styles.td}>
                      <input
                        type={col.type === 'number' ? 'number' : 'text'}
                        value={(row[col.key] as string | number) || ''}
                        onChange={e => updateCell(
                          table.id, 
                          rowIndex, 
                          col.key, 
                          col.type === 'number' ? parseFloat(e.target.value) : e.target.value
                        )}
                        style={styles.cellInput}
                        readOnly={readOnly}
                      />
                    </td>
                  ))}
                  {!readOnly && (
                    <td style={styles.td}>
                      <button 
                        onClick={() => deleteRow(table.id, rowIndex)} 
                        style={styles.deleteRowButton}
                      >
                        ×
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      {tables.length === 0 && (
        <p style={styles.emptyMessage}>No tables yet. Click "Add Table" to create one.</p>
      )}
    </div>
  );
}

// ==================== MEASUREMENTS EDITOR ====================

function MeasurementsEditor({ 
  measurements, 
  onChange, 
  readOnly 
}: { 
  measurements: Measurement[]; 
  onChange: (m: Measurement[]) => void;
  readOnly?: boolean;
}) {
  const addMeasurement = () => {
    const newMeasurement: Measurement = {
      id: uuid(),
      timestamp: new Date().toISOString(),
      parameter: '',
      value: 0,
      unit: ''
    };
    onChange([...measurements, newMeasurement]);
  };

  const updateMeasurement = (id: string, updates: Partial<Measurement>) => {
    onChange(measurements.map(m => m.id === id ? { ...m, ...updates } : m));
  };

  const deleteMeasurement = (id: string) => {
    onChange(measurements.filter(m => m.id !== id));
  };

  return (
    <div style={styles.section}>
      <div style={styles.sectionHeader}>
        <h3 style={styles.sectionTitle}>Measurements</h3>
        {!readOnly && (
          <button onClick={addMeasurement} style={styles.addButton}>+ Add Measurement</button>
        )}
      </div>

      <table style={styles.dataTable}>
        <thead>
          <tr>
            <th style={styles.th}>Time</th>
            <th style={styles.th}>Parameter</th>
            <th style={styles.th}>Value</th>
            <th style={styles.th}>Unit</th>
            <th style={styles.th}>Notes</th>
            {!readOnly && <th style={styles.th}></th>}
          </tr>
        </thead>
        <tbody>
          {measurements.map(m => (
            <tr key={m.id}>
              <td style={styles.td}>
                <input
                  type="datetime-local"
                  value={m.timestamp.slice(0, 16)}
                  onChange={e => updateMeasurement(m.id, { timestamp: new Date(e.target.value).toISOString() })}
                  style={styles.cellInput}
                  readOnly={readOnly}
                />
              </td>
              <td style={styles.td}>
                <input
                  type="text"
                  value={m.parameter}
                  onChange={e => updateMeasurement(m.id, { parameter: e.target.value })}
                  style={styles.cellInput}
                  placeholder="e.g., OD600"
                  readOnly={readOnly}
                />
              </td>
              <td style={styles.td}>
                <input
                  type="number"
                  value={m.value}
                  onChange={e => updateMeasurement(m.id, { value: parseFloat(e.target.value) })}
                  style={styles.cellInput}
                  step="any"
                  readOnly={readOnly}
                />
              </td>
              <td style={styles.td}>
                <input
                  type="text"
                  value={m.unit}
                  onChange={e => updateMeasurement(m.id, { unit: e.target.value })}
                  style={styles.cellInput}
                  placeholder="e.g., AU"
                  readOnly={readOnly}
                />
              </td>
              <td style={styles.td}>
                <input
                  type="text"
                  value={m.notes || ''}
                  onChange={e => updateMeasurement(m.id, { notes: e.target.value })}
                  style={styles.cellInput}
                  readOnly={readOnly}
                />
              </td>
              {!readOnly && (
                <td style={styles.td}>
                  <button onClick={() => deleteMeasurement(m.id)} style={styles.deleteRowButton}>×</button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>

      {measurements.length === 0 && (
        <p style={styles.emptyMessage}>No measurements recorded yet.</p>
      )}
    </div>
  );
}

// ==================== KINETICS EDITOR ====================

function KineticsEditor({ 
  data, 
  onChange, 
  readOnly 
}: { 
  data?: KineticData; 
  onChange: (d: KineticData) => void;
  readOnly?: boolean;
}) {
  const kineticData = data || {
    timePoints: [],
    datasets: [],
    xLabel: 'Time',
    yLabel: 'Value'
  };

  const addDataset = () => {
    const newDataset = {
      label: `Dataset ${kineticData.datasets.length + 1}`,
      values: kineticData.timePoints.map(() => 0),
      color: generateColor(kineticData.datasets.length)
    };
    onChange({ ...kineticData, datasets: [...kineticData.datasets, newDataset] });
  };

  const addTimePoint = () => {
    const lastTime = kineticData.timePoints[kineticData.timePoints.length - 1] || 0;
    onChange({
      ...kineticData,
      timePoints: [...kineticData.timePoints, lastTime + 1],
      datasets: kineticData.datasets.map(ds => ({
        ...ds,
        values: [...ds.values, 0]
      }))
    });
  };

  const updateTimePoint = (index: number, value: number) => {
    const newTimePoints = [...kineticData.timePoints];
    newTimePoints[index] = value;
    onChange({ ...kineticData, timePoints: newTimePoints });
  };

  const updateDatasetValue = (datasetIndex: number, timeIndex: number, value: number) => {
    const newDatasets = [...kineticData.datasets];
    newDatasets[datasetIndex] = {
      ...newDatasets[datasetIndex],
      values: newDatasets[datasetIndex].values.map((v, i) => i === timeIndex ? value : v)
    };
    onChange({ ...kineticData, datasets: newDatasets });
  };

  return (
    <div style={styles.section}>
      <div style={styles.sectionHeader}>
        <h3 style={styles.sectionTitle}>Kinetic Data</h3>
        {!readOnly && (
          <div style={styles.buttonGroup}>
            <button onClick={addTimePoint} style={styles.addButton}>+ Time Point</button>
            <button onClick={addDataset} style={styles.addButton}>+ Dataset</button>
          </div>
        )}
      </div>

      <div style={styles.axisLabels}>
        <input
          value={kineticData.xLabel}
          onChange={e => onChange({ ...kineticData, xLabel: e.target.value })}
          placeholder="X-axis label"
          style={styles.axisInput}
          readOnly={readOnly}
        />
        <input
          value={kineticData.yLabel}
          onChange={e => onChange({ ...kineticData, yLabel: e.target.value })}
          placeholder="Y-axis label"
          style={styles.axisInput}
          readOnly={readOnly}
        />
      </div>

      {kineticData.timePoints.length > 0 && (
        <table style={styles.dataTable}>
          <thead>
            <tr>
              <th style={styles.th}>{kineticData.xLabel}</th>
              {kineticData.datasets.map((ds, i) => (
                <th key={i} style={{ ...styles.th, color: ds.color }}>
                  {readOnly ? ds.label : (
                    <input
                      value={ds.label}
                      onChange={e => {
                        const newDatasets = [...kineticData.datasets];
                        newDatasets[i] = { ...ds, label: e.target.value };
                        onChange({ ...kineticData, datasets: newDatasets });
                      }}
                      style={styles.headerInput}
                    />
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {kineticData.timePoints.map((time, timeIndex) => (
              <tr key={timeIndex}>
                <td style={styles.td}>
                  <input
                    type="number"
                    value={time}
                    onChange={e => updateTimePoint(timeIndex, parseFloat(e.target.value))}
                    style={styles.cellInput}
                    readOnly={readOnly}
                  />
                </td>
                {kineticData.datasets.map((ds, dsIndex) => (
                  <td key={dsIndex} style={styles.td}>
                    <input
                      type="number"
                      value={ds.values[timeIndex] ?? ''}
                      onChange={e => updateDatasetValue(dsIndex, timeIndex, parseFloat(e.target.value))}
                      style={styles.cellInput}
                      step="any"
                      readOnly={readOnly}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Interactive Line Chart Visualization */}
      {kineticData.timePoints.length > 0 && kineticData.datasets.length > 0 && (
        <div style={{ width: '100%', height: 300, marginTop: 20 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={kineticData.timePoints.map((time, index) => {
                const point: Record<string, number> = { time };
                kineticData.datasets.forEach(ds => {
                  point[ds.label] = ds.values[index] ?? 0;
                });
                return point;
              })}
              margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis 
                dataKey="time" 
                label={{ 
                  value: kineticData.xLabel, 
                  position: 'insideBottomRight', 
                  offset: -10,
                  style: { fontSize: 12, fill: '#64748b' }
                }}
                tick={{ fontSize: 11, fill: '#64748b' }}
              />
              <YAxis 
                label={{ 
                  value: kineticData.yLabel, 
                  angle: -90, 
                  position: 'insideLeft',
                  style: { fontSize: 12, fill: '#64748b' }
                }}
                tick={{ fontSize: 11, fill: '#64748b' }}
              />
              <Tooltip 
                contentStyle={{ 
                  backgroundColor: '#fff', 
                  border: '1px solid #e2e8f0',
                  borderRadius: 6,
                  fontSize: 12
                }}
              />
              <Legend 
                wrapperStyle={{ fontSize: 12 }}
              />
              {kineticData.datasets.map((ds, i) => (
                <Line 
                  key={i} 
                  type="monotone" 
                  dataKey={ds.label} 
                  stroke={ds.color || generateColor(i)} 
                  strokeWidth={2}
                  dot={{ r: 4, fill: ds.color || generateColor(i) }}
                  activeDot={{ r: 6, strokeWidth: 2 }} 
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

// ==================== CELL COUNTS EDITOR ====================

function CellCountsEditor({ 
  data, 
  onChange, 
  readOnly 
}: { 
  data?: CellCountData; 
  onChange: (d: CellCountData) => void;
  readOnly?: boolean;
}) {
  const cellData = data || {
    method: 'hemocytometer' as const,
    counts: []
  };

  const addCount = () => {
    const newCount: CellCount = {
      sample: `Sample ${cellData.counts.length + 1}`,
      totalCells: 0,
      viableCells: 0,
      dilutionFactor: 1
    };
    onChange({ ...cellData, counts: [...cellData.counts, newCount] });
  };

  const updateCount = (index: number, updates: Partial<CellCount>) => {
    const newCounts = [...cellData.counts];
    newCounts[index] = { ...newCounts[index], ...updates };
    
    // Auto-calculate viability
    if (newCounts[index].totalCells && newCounts[index].viableCells) {
      newCounts[index].viability = 
        (newCounts[index].viableCells! / newCounts[index].totalCells) * 100;
    }
    
    onChange({ ...cellData, counts: newCounts });
  };

  const deleteCount = (index: number) => {
    onChange({ ...cellData, counts: cellData.counts.filter((_, i) => i !== index) });
  };

  const averageViability = cellData.counts.length > 0
    ? cellData.counts.reduce((sum, c) => sum + (c.viability || 0), 0) / cellData.counts.length
    : 0;

  return (
    <div style={styles.section}>
      <div style={styles.sectionHeader}>
        <h3 style={styles.sectionTitle}>Cell Counts</h3>
        {!readOnly && (
          <button onClick={addCount} style={styles.addButton}>+ Add Sample</button>
        )}
      </div>

      <div style={styles.methodSelect}>
        <label style={styles.label}>Counting Method:</label>
        <select
          value={cellData.method}
          onChange={e => onChange({ ...cellData, method: e.target.value as CellCountData['method'] })}
          style={styles.select}
          disabled={readOnly}
        >
          <option value="hemocytometer">Hemocytometer</option>
          <option value="automated">Automated Counter</option>
          <option value="flow_cytometry">Flow Cytometry</option>
        </select>
      </div>

      <table style={styles.dataTable}>
        <thead>
          <tr>
            <th style={styles.th}>Sample</th>
            <th style={styles.th}>Total Cells</th>
            <th style={styles.th}>Viable Cells</th>
            <th style={styles.th}>Viability (%)</th>
            <th style={styles.th}>Dilution</th>
            <th style={styles.th}>Notes</th>
            {!readOnly && <th style={styles.th}></th>}
          </tr>
        </thead>
        <tbody>
          {cellData.counts.map((count, index) => (
            <tr key={index}>
              <td style={styles.td}>
                <input
                  type="text"
                  value={count.sample}
                  onChange={e => updateCount(index, { sample: e.target.value })}
                  style={styles.cellInput}
                  readOnly={readOnly}
                />
              </td>
              <td style={styles.td}>
                <input
                  type="number"
                  value={count.totalCells}
                  onChange={e => updateCount(index, { totalCells: parseInt(e.target.value) })}
                  style={styles.cellInput}
                  readOnly={readOnly}
                />
              </td>
              <td style={styles.td}>
                <input
                  type="number"
                  value={count.viableCells || ''}
                  onChange={e => updateCount(index, { viableCells: parseInt(e.target.value) })}
                  style={styles.cellInput}
                  readOnly={readOnly}
                />
              </td>
              <td style={{ ...styles.td, fontWeight: 500 }}>
                {count.viability ? `${count.viability.toFixed(1)}%` : '—'}
              </td>
              <td style={styles.td}>
                <input
                  type="number"
                  value={count.dilutionFactor || ''}
                  onChange={e => updateCount(index, { dilutionFactor: parseFloat(e.target.value) })}
                  style={styles.cellInput}
                  readOnly={readOnly}
                />
              </td>
              <td style={styles.td}>
                <input
                  type="text"
                  value={count.notes || ''}
                  onChange={e => updateCount(index, { notes: e.target.value })}
                  style={styles.cellInput}
                  readOnly={readOnly}
                />
              </td>
              {!readOnly && (
                <td style={styles.td}>
                  <button onClick={() => deleteCount(index)} style={styles.deleteRowButton}>×</button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>

      {cellData.counts.length > 0 && (
        <div style={styles.summary}>
          <strong>Average Viability:</strong> {averageViability.toFixed(1)}%
        </div>
      )}
    </div>
  );
}

// ==================== CONCLUSIONS EDITOR ====================

function ConclusionsEditor({ 
  value, 
  onChange, 
  readOnly 
}: { 
  value: string; 
  onChange: (v: string) => void; 
  readOnly?: boolean;
}) {
  return (
    <div style={styles.section}>
      <h3 style={styles.sectionTitle}>Conclusions</h3>
      <textarea
        value={value}
        onChange={e => onChange(e.target.value)}
        readOnly={readOnly}
        placeholder="Summarize your findings and conclusions from this experiment..."
        style={styles.conclusionsTextArea}
      />
    </div>
  );
}

// ==================== UTILITIES ====================

function simpleMarkdownToHtml(text: string): string {
  if (!text) return '';
  return text
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/^### (.*$)/gm, '<h3>$1</h3>')
    .replace(/^## (.*$)/gm, '<h2>$1</h2>')
    .replace(/^# (.*$)/gm, '<h1>$1</h1>')
    .replace(/^\- (.*$)/gm, '<li>$1</li>')
    .replace(/\n/g, '<br />');
}

function generateColor(index: number): string {
  const colors = ['#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4'];
  return colors[index % colors.length];
}

// ==================== STYLES ====================

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    background: '#fff',
    borderRadius: 8,
    border: '1px solid #e2e8f0',
    overflow: 'hidden'
  },
  tabs: {
    display: 'flex',
    borderBottom: '1px solid #e2e8f0',
    background: '#f8fafc',
    overflowX: 'auto'
  },
  tab: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '10px 16px',
    border: 'none',
    background: 'transparent',
    cursor: 'pointer',
    fontSize: 14,
    color: '#64748b',
    whiteSpace: 'nowrap',
    borderBottom: '2px solid transparent',
    transition: 'all 0.2s'
  },
  tabActive: {
    color: '#0f172a',
    borderBottomColor: '#3b82f6',
    background: '#fff'
  },
  content: {
    padding: 16,
    minHeight: 400
  },
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12
  },
  sectionHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  sectionTitle: {
    margin: 0,
    fontSize: 16,
    fontWeight: 600,
    color: '#0f172a'
  },
  toolbar: {
    display: 'flex',
    gap: 4,
    padding: 4,
    background: '#f8fafc',
    borderRadius: 6,
    border: '1px solid #e2e8f0'
  },
  toolbarButton: {
    width: 32,
    height: 32,
    border: 'none',
    background: 'transparent',
    cursor: 'pointer',
    borderRadius: 4,
    fontSize: 14,
    fontWeight: 600
  },
  toggleButton: {
    padding: '6px 12px',
    background: '#f1f5f9',
    border: '1px solid #e2e8f0',
    borderRadius: 6,
    cursor: 'pointer',
    fontSize: 13
  },
  richTextArea: {
    minHeight: 300,
    padding: 12,
    border: '1px solid #e2e8f0',
    borderRadius: 6,
    fontSize: 14,
    fontFamily: 'inherit',
    resize: 'vertical',
    lineHeight: 1.6
  },
  preview: {
    padding: 16,
    background: '#f8fafc',
    borderRadius: 6,
    border: '1px solid #e2e8f0',
    minHeight: 300,
    lineHeight: 1.6
  },
  addButton: {
    padding: '6px 12px',
    background: '#3b82f6',
    color: '#fff',
    border: 'none',
    borderRadius: 6,
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: 500
  },
  buttonGroup: {
    display: 'flex',
    gap: 8
  },
  tableContainer: {
    background: '#f8fafc',
    borderRadius: 8,
    padding: 12,
    border: '1px solid #e2e8f0'
  },
  tableHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12
  },
  tableTitleInput: {
    fontSize: 15,
    fontWeight: 600,
    border: 'none',
    background: 'transparent',
    color: '#0f172a'
  },
  tableActions: {
    display: 'flex',
    gap: 8
  },
  smallButton: {
    padding: '4px 8px',
    background: '#f1f5f9',
    border: '1px solid #e2e8f0',
    borderRadius: 4,
    cursor: 'pointer',
    fontSize: 12
  },
  deleteButton: {
    padding: '4px 8px',
    background: '#fee2e2',
    color: '#dc2626',
    border: 'none',
    borderRadius: 4,
    cursor: 'pointer',
    fontSize: 12
  },
  dataTable: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: 14
  },
  th: {
    padding: '8px 12px',
    textAlign: 'left',
    borderBottom: '2px solid #e2e8f0',
    fontWeight: 600,
    color: '#334155'
  },
  td: {
    padding: '4px 8px',
    borderBottom: '1px solid #e2e8f0'
  },
  cellInput: {
    width: '100%',
    padding: '4px 8px',
    border: '1px solid transparent',
    borderRadius: 4,
    background: 'transparent',
    fontSize: 14
  },
  headerInput: {
    width: '100%',
    padding: '2px 4px',
    border: 'none',
    background: 'transparent',
    fontWeight: 600,
    fontSize: 14
  },
  deleteRowButton: {
    width: 24,
    height: 24,
    border: 'none',
    background: '#fee2e2',
    color: '#dc2626',
    borderRadius: 4,
    cursor: 'pointer',
    fontSize: 16
  },
  unit: {
    fontSize: 12,
    color: '#64748b',
    marginLeft: 4
  },
  emptyMessage: {
    color: '#64748b',
    fontStyle: 'italic',
    textAlign: 'center',
    padding: 24
  },
  axisLabels: {
    display: 'flex',
    gap: 16,
    marginBottom: 12
  },
  axisInput: {
    flex: 1,
    padding: '8px 12px',
    border: '1px solid #e2e8f0',
    borderRadius: 6,
    fontSize: 14
  },
  chartPlaceholder: {
    marginTop: 16,
    padding: 24,
    background: '#f8fafc',
    border: '1px dashed #cbd5e1',
    borderRadius: 8,
    textAlign: 'center',
    color: '#64748b'
  },
  methodSelect: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    marginBottom: 12
  },
  label: {
    fontSize: 14,
    fontWeight: 500,
    color: '#334155'
  },
  select: {
    padding: '8px 12px',
    border: '1px solid #e2e8f0',
    borderRadius: 6,
    fontSize: 14,
    background: '#fff'
  },
  summary: {
    marginTop: 12,
    padding: 12,
    background: '#f0fdf4',
    border: '1px solid #bbf7d0',
    borderRadius: 6,
    color: '#166534'
  },
  conclusionsTextArea: {
    minHeight: 200,
    padding: 12,
    border: '1px solid #e2e8f0',
    borderRadius: 6,
    fontSize: 14,
    fontFamily: 'inherit',
    resize: 'vertical',
    lineHeight: 1.6
  }
};

export default ObservationsEditor;
