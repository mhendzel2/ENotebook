/**
 * Data Processing Service
 * Handles automated parsing and extraction of structured data from uploaded files.
 * Supports CSV files with automatic type conversion and data structuring.
 */

import { parse } from 'csv-parse/sync';

export interface ProcessedDataset {
  type: string;
  processedAt: string;
  recordCount: number;
  columns?: string[];
  data: Record<string, unknown>[];
  statistics?: DatasetStatistics;
}

export interface DatasetStatistics {
  numericColumns: string[];
  categoricalColumns: string[];
  summary: Record<string, ColumnSummary>;
}

export interface ColumnSummary {
  type: 'numeric' | 'categorical' | 'date' | 'mixed';
  count: number;
  uniqueCount?: number;
  min?: number;
  max?: number;
  mean?: number;
  stdDev?: number;
  topValues?: Array<{ value: string; count: number }>;
}

export class DataProcessingService {
  /**
   * Parses incoming file buffer based on MIME type and returns structured data
   */
  processFile(buffer: Buffer, mimeType: string, filename: string): ProcessedDataset | null {
    // Handle CSV Files
    if (mimeType === 'text/csv' || filename.endsWith('.csv')) {
      return this.parseCSV(buffer);
    }

    // Handle TSV Files
    if (mimeType === 'text/tab-separated-values' || filename.endsWith('.tsv')) {
      return this.parseTSV(buffer);
    }

    // Handle JSON Files
    if (mimeType === 'application/json' || filename.endsWith('.json')) {
      return this.parseJSON(buffer);
    }

    // Future: Add Excel parser here (requires xlsx package)
    // if (mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' || filename.endsWith('.xlsx')) {
    //   return this.parseExcel(buffer);
    // }

    return null;
  }

  /**
   * Parse CSV file and extract structured data
   */
  private parseCSV(buffer: Buffer): ProcessedDataset | null {
    try {
      const content = buffer.toString('utf-8');
      
      // Parse CSV into array of objects
      const records = parse(content, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
        cast: true, // Auto-convert numbers
        cast_date: false, // Keep dates as strings for now
        relax_column_count: true, // Handle inconsistent column counts
      }) as Record<string, unknown>[];

      if (records.length === 0) {
        return null;
      }

      // Extract column names from first record
      const columns = Object.keys(records[0]);

      // Calculate basic statistics
      const statistics = this.calculateStatistics(records, columns);

      return {
        type: 'csv_data',
        processedAt: new Date().toISOString(),
        recordCount: records.length,
        columns,
        data: records,
        statistics,
      };
    } catch (error) {
      console.error('[DataProcessing] CSV parsing failed:', error);
      return null;
    }
  }

  /**
   * Parse TSV (Tab-Separated Values) file
   */
  private parseTSV(buffer: Buffer): ProcessedDataset | null {
    try {
      const content = buffer.toString('utf-8');
      
      const records = parse(content, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
        cast: true,
        delimiter: '\t',
        relax_column_count: true,
      }) as Record<string, unknown>[];

      if (records.length === 0) {
        return null;
      }

      const columns = Object.keys(records[0]);
      const statistics = this.calculateStatistics(records, columns);

      return {
        type: 'tsv_data',
        processedAt: new Date().toISOString(),
        recordCount: records.length,
        columns,
        data: records,
        statistics,
      };
    } catch (error) {
      console.error('[DataProcessing] TSV parsing failed:', error);
      return null;
    }
  }

  /**
   * Parse JSON file containing array data
   */
  private parseJSON(buffer: Buffer): ProcessedDataset | null {
    try {
      const content = buffer.toString('utf-8');
      const parsed = JSON.parse(content);

      // Handle array of objects
      if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === 'object') {
        const records = parsed as Record<string, unknown>[];
        const columns = Object.keys(records[0]);
        const statistics = this.calculateStatistics(records, columns);

        return {
          type: 'json_array',
          processedAt: new Date().toISOString(),
          recordCount: records.length,
          columns,
          data: records,
          statistics,
        };
      }

      // Handle object with data array property
      if (parsed && typeof parsed === 'object' && Array.isArray(parsed.data)) {
        const records = parsed.data as Record<string, unknown>[];
        if (records.length > 0 && typeof records[0] === 'object') {
          const columns = Object.keys(records[0]);
          const statistics = this.calculateStatistics(records, columns);

          return {
            type: 'json_structured',
            processedAt: new Date().toISOString(),
            recordCount: records.length,
            columns,
            data: records,
            statistics,
          };
        }
      }

      return null;
    } catch (error) {
      console.error('[DataProcessing] JSON parsing failed:', error);
      return null;
    }
  }

  /**
   * Calculate basic statistics for parsed data
   */
  private calculateStatistics(
    records: Record<string, unknown>[],
    columns: string[]
  ): DatasetStatistics {
    const numericColumns: string[] = [];
    const categoricalColumns: string[] = [];
    const summary: Record<string, ColumnSummary> = {};

    for (const col of columns) {
      const values = records.map(r => r[col]).filter(v => v !== null && v !== undefined && v !== '');
      
      if (values.length === 0) {
        summary[col] = { type: 'mixed', count: 0 };
        continue;
      }

      // Check if column is numeric
      const numericValues = values.filter(v => typeof v === 'number' && !isNaN(v as number)) as number[];
      const isNumeric = numericValues.length > values.length * 0.8; // 80% threshold

      if (isNumeric && numericValues.length > 0) {
        numericColumns.push(col);
        
        const min = Math.min(...numericValues);
        const max = Math.max(...numericValues);
        const mean = numericValues.reduce((a, b) => a + b, 0) / numericValues.length;
        const variance = numericValues.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / numericValues.length;
        const stdDev = Math.sqrt(variance);

        summary[col] = {
          type: 'numeric',
          count: values.length,
          min,
          max,
          mean: Math.round(mean * 1000) / 1000,
          stdDev: Math.round(stdDev * 1000) / 1000,
        };
      } else {
        categoricalColumns.push(col);
        
        // Count unique values
        const valueCounts = new Map<string, number>();
        for (const v of values) {
          const key = String(v);
          valueCounts.set(key, (valueCounts.get(key) || 0) + 1);
        }

        // Get top 5 values
        const topValues = Array.from(valueCounts.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([value, count]) => ({ value, count }));

        summary[col] = {
          type: 'categorical',
          count: values.length,
          uniqueCount: valueCounts.size,
          topValues,
        };
      }
    }

    return {
      numericColumns,
      categoricalColumns,
      summary,
    };
  }

  /**
   * Detect if the data represents plate-based assay data (96-well, 384-well, etc.)
   */
  detectPlateFormat(records: Record<string, unknown>[]): { isPlate: boolean; format?: string; wellColumn?: string } {
    if (records.length === 0) {
      return { isPlate: false };
    }

    const columns = Object.keys(records[0]);
    
    // Look for well identifiers (A1, B2, etc.)
    const wellPattern = /^[A-P][0-9]{1,2}$/i;
    
    for (const col of columns) {
      const values = records.map(r => String(r[col] || '')).filter(Boolean);
      const wellMatches = values.filter(v => wellPattern.test(v));
      
      if (wellMatches.length > values.length * 0.8) {
        // Determine plate format based on well identifiers
        const maxRow = Math.max(...wellMatches.map(w => w.charCodeAt(0) - 64));
        const maxCol = Math.max(...wellMatches.map(w => parseInt(w.slice(1))));
        
        let format = 'unknown';
        if (maxRow <= 8 && maxCol <= 12) format = '96-well';
        else if (maxRow <= 16 && maxCol <= 24) format = '384-well';
        else if (maxRow <= 32 && maxCol <= 48) format = '1536-well';

        return {
          isPlate: true,
          format,
          wellColumn: col,
        };
      }
    }

    return { isPlate: false };
  }

  /**
   * Extract time-series data if timestamps are detected
   */
  detectTimeSeries(records: Record<string, unknown>[]): { isTimeSeries: boolean; timeColumn?: string } {
    if (records.length === 0) {
      return { isTimeSeries: false };
    }

    const columns = Object.keys(records[0]);
    const timePatterns = [
      /time/i, /date/i, /timestamp/i, /datetime/i,
      /^t$/i, /^dt$/i, /elapsed/i, /hour/i, /minute/i, /second/i
    ];

    for (const col of columns) {
      // Check column name
      if (timePatterns.some(p => p.test(col))) {
        return { isTimeSeries: true, timeColumn: col };
      }

      // Check if values look like timestamps or sequential times
      const values = records.map(r => r[col]);
      const numericValues = values.filter(v => typeof v === 'number') as number[];
      
      if (numericValues.length === values.length && numericValues.length > 2) {
        // Check if monotonically increasing (typical for time series)
        let isMonotonic = true;
        for (let i = 1; i < numericValues.length; i++) {
          if (numericValues[i] < numericValues[i - 1]) {
            isMonotonic = false;
            break;
          }
        }
        if (isMonotonic) {
          return { isTimeSeries: true, timeColumn: col };
        }
      }
    }

    return { isTimeSeries: false };
  }
}

export default DataProcessingService;
