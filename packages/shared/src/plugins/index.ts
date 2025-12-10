/**
 * Modality Plugin System
 * Allows each modality to register form components and parameter schemas
 * for extensible experiment configuration
 */

import { Modality, MODALITIES } from '../types';
import { JSONSchema, getModalitySchema } from '../schemas';

// Plugin interface for each modality
export interface ModalityPlugin {
  id: Modality;
  name: string;
  description: string;
  icon?: string;
  color?: string;
  
  // JSON Schema for parameters
  parameterSchema: JSONSchema;
  
  // Optional custom validation beyond JSON Schema
  validateParams?: (params: Record<string, unknown>) => ValidationResult;
  
  // Optional data processors
  preprocessData?: (rawData: unknown) => ProcessedData;
  postprocessResults?: (results: unknown) => unknown;
  
  // File type associations for instrument imports
  supportedFileTypes?: FileTypeHandler[];
  
  // Default values
  defaultParams?: Record<string, unknown>;
  
  // Analysis templates
  analysisTemplates?: AnalysisTemplate[];
}

export interface ValidationResult {
  valid: boolean;
  errors?: ValidationError[];
  warnings?: ValidationWarning[];
}

export interface ValidationError {
  path: string;
  message: string;
  code: string;
}

export interface ValidationWarning {
  path: string;
  message: string;
  suggestion?: string;
}

export interface ProcessedData {
  data: unknown;
  metadata?: Record<string, unknown>;
  quality?: DataQuality;
}

export interface DataQuality {
  score: number;
  issues?: string[];
}

export interface FileTypeHandler {
  extension: string;
  mimeType?: string;
  description: string;
  parser: string; // Function name or module path
  icon?: string;
}

export interface AnalysisTemplate {
  id: string;
  name: string;
  description: string;
  steps: AnalysisStep[];
}

export interface AnalysisStep {
  id: string;
  name: string;
  type: 'processing' | 'analysis' | 'visualization' | 'export';
  config: Record<string, unknown>;
}

// ==================== PLUGIN REGISTRY ====================

class ModalityPluginRegistry {
  private plugins: Map<Modality, ModalityPlugin> = new Map();
  private listeners: Set<(plugins: ModalityPlugin[]) => void> = new Set();

  register(plugin: ModalityPlugin): void {
    if (!MODALITIES.includes(plugin.id)) {
      throw new Error(`Invalid modality: ${plugin.id}. Must be one of: ${MODALITIES.join(', ')}`);
    }
    this.plugins.set(plugin.id, plugin);
    this.notifyListeners();
  }

  unregister(modalityId: Modality): void {
    this.plugins.delete(modalityId);
    this.notifyListeners();
  }

  get(modalityId: Modality): ModalityPlugin | undefined {
    return this.plugins.get(modalityId);
  }

  getAll(): ModalityPlugin[] {
    return Array.from(this.plugins.values());
  }

  has(modalityId: Modality): boolean {
    return this.plugins.has(modalityId);
  }

  subscribe(listener: (plugins: ModalityPlugin[]) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notifyListeners(): void {
    const plugins = this.getAll();
    this.listeners.forEach(listener => listener(plugins));
  }
}

// Singleton registry
export const modalityPluginRegistry = new ModalityPluginRegistry();

// ==================== DEFAULT PLUGIN DEFINITIONS ====================

import {
  fluorescenceSchema,
  electronMicroscopySchema,
  biophysicalSchema,
  molecularBiologySchema,
  biochemistrySchema,
  flowCytometrySchema
} from '../schemas';

export const fluorescencePlugin: ModalityPlugin = {
  id: 'fluorescence',
  name: 'Fluorescence Microscopy',
  description: 'Confocal, widefield, and super-resolution fluorescence imaging',
  icon: '🔬',
  color: '#22c55e',
  parameterSchema: fluorescenceSchema,
  supportedFileTypes: [
    { extension: '.nd2', description: 'Nikon ND2', parser: 'parseND2' },
    { extension: '.czi', description: 'Zeiss CZI', parser: 'parseCZI' },
    { extension: '.lif', description: 'Leica LIF', parser: 'parseLIF' },
    { extension: '.tif', description: 'TIFF Stack', parser: 'parseTIFF' },
    { extension: '.ome.tiff', description: 'OME-TIFF', parser: 'parseOMETIFF' }
  ],
  defaultParams: {
    microscope: 'confocal',
    exposure: 100,
    zStack: { enabled: false },
    timeLapse: { enabled: false },
    imageSettings: { bitDepth: 16, binning: '1x1' }
  },
  analysisTemplates: [
    {
      id: 'colocalization',
      name: 'Colocalization Analysis',
      description: 'Calculate Pearson, Manders coefficients between channels',
      steps: [
        { id: '1', name: 'Background Subtraction', type: 'processing', config: { method: 'rolling_ball', radius: 50 } },
        { id: '2', name: 'Colocalization', type: 'analysis', config: { method: 'pearson_manders' } },
        { id: '3', name: 'Generate Scatter Plot', type: 'visualization', config: {} }
      ]
    },
    {
      id: 'particle_tracking',
      name: 'Particle Tracking',
      description: 'Track fluorescent particles over time',
      steps: [
        { id: '1', name: 'Spot Detection', type: 'processing', config: { method: 'LoG', threshold: 'auto' } },
        { id: '2', name: 'Linking', type: 'analysis', config: { maxDistance: 5, gapClosing: 2 } },
        { id: '3', name: 'MSD Analysis', type: 'analysis', config: {} },
        { id: '4', name: 'Export Tracks', type: 'export', config: { format: 'csv' } }
      ]
    }
  ]
};

export const electronMicroscopyPlugin: ModalityPlugin = {
  id: 'electron_microscopy',
  name: 'Electron Microscopy',
  description: 'TEM, SEM, Cryo-EM, and Cryo-ET imaging',
  icon: '🔭',
  color: '#6366f1',
  parameterSchema: electronMicroscopySchema,
  supportedFileTypes: [
    { extension: '.mrc', description: 'MRC Format', parser: 'parseMRC' },
    { extension: '.mrcs', description: 'MRC Stack', parser: 'parseMRC' },
    { extension: '.dm4', description: 'Digital Micrograph', parser: 'parseDM4' },
    { extension: '.dm3', description: 'Digital Micrograph', parser: 'parseDM3' },
    { extension: '.ser', description: 'TIA SER', parser: 'parseSER' },
    { extension: '.eer', description: 'Falcon EER', parser: 'parseEER' },
    { extension: '.tiff', description: 'Falcon TIFF', parser: 'parseTIFF' }
  ],
  defaultParams: {
    emType: 'TEM',
    acceleratingVoltage: 200
  },
  analysisTemplates: [
    {
      id: 'spa_preprocessing',
      name: 'SPA Preprocessing',
      description: 'Motion correction and CTF estimation for single particle analysis',
      steps: [
        { id: '1', name: 'Motion Correction', type: 'processing', config: { software: 'MotionCor2', doseWeighting: true } },
        { id: '2', name: 'CTF Estimation', type: 'analysis', config: { software: 'CTFFIND4' } },
        { id: '3', name: 'Generate Micrographs Report', type: 'visualization', config: {} }
      ]
    }
  ]
};

export const biophysicalPlugin: ModalityPlugin = {
  id: 'biophysical',
  name: 'Biophysical Assays',
  description: 'SPR, BLI, ITC, DSF and other binding/interaction studies',
  icon: '📊',
  color: '#f59e0b',
  parameterSchema: biophysicalSchema,
  supportedFileTypes: [
    { extension: '.blr', description: 'ForteBio BLI', parser: 'parseBLI' },
    { extension: '.sensorgram', description: 'Biacore Sensorgram', parser: 'parseSPR' },
    { extension: '.itc', description: 'ITC Data', parser: 'parseITC' },
    { extension: '.dsf', description: 'DSF Data', parser: 'parseDSF' }
  ],
  defaultParams: {
    temperature: 25
  },
  validateParams: (params) => {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];

    if (params.technique === 'SPR' || params.technique === 'BLI') {
      const analyte = params.analyte as { concentrations?: number[] } | undefined;
      if (!analyte?.concentrations || analyte.concentrations.length < 3) {
        warnings.push({
          path: 'analyte.concentrations',
          message: 'At least 3-5 concentrations recommended for reliable kinetic fitting',
          suggestion: 'Add more concentration points spanning 10x above and below expected KD'
        });
      }
    }

    return { valid: errors.length === 0, errors, warnings };
  },
  analysisTemplates: [
    {
      id: 'kinetic_fit',
      name: 'Kinetic Fitting',
      description: '1:1 binding kinetic analysis',
      steps: [
        { id: '1', name: 'Reference Subtraction', type: 'processing', config: {} },
        { id: '2', name: 'Global Fit', type: 'analysis', config: { model: '1:1', fitting: 'global' } },
        { id: '3', name: 'Generate Report', type: 'visualization', config: { showResiduals: true } }
      ]
    }
  ]
};

export const molecularBiologyPlugin: ModalityPlugin = {
  id: 'molecular_biology',
  name: 'Molecular Biology',
  description: 'Cloning, PCR, transfection, and genetic engineering',
  icon: '🧬',
  color: '#ec4899',
  parameterSchema: molecularBiologySchema,
  supportedFileTypes: [
    { extension: '.gb', description: 'GenBank', parser: 'parseGenBank' },
    { extension: '.gbk', description: 'GenBank', parser: 'parseGenBank' },
    { extension: '.fasta', description: 'FASTA', parser: 'parseFASTA' },
    { extension: '.fa', description: 'FASTA', parser: 'parseFASTA' },
    { extension: '.ab1', description: 'Sanger Sequencing', parser: 'parseABI' },
    { extension: '.seq', description: 'Sequence File', parser: 'parseSeq' },
    { extension: '.dna', description: 'SnapGene DNA', parser: 'parseSnapGene' }
  ],
  defaultParams: {
    experimentType: 'cloning'
  },
  validateParams: (params) => {
    const errors: ValidationError[] = [];
    
    if (params.experimentType === 'pcr') {
      const primers = params.primers as Array<{ tm?: number }> | undefined;
      if (primers && primers.length >= 2) {
        const tms = primers.map(p => p.tm).filter(Boolean) as number[];
        if (tms.length >= 2) {
          const tmDiff = Math.abs(tms[0] - tms[1]);
          if (tmDiff > 5) {
            errors.push({
              path: 'primers',
              message: `Primer Tm difference (${tmDiff.toFixed(1)}°C) exceeds 5°C`,
              code: 'TM_MISMATCH'
            });
          }
        }
      }
    }
    
    return { valid: errors.length === 0, errors };
  }
};

export const biochemistryPlugin: ModalityPlugin = {
  id: 'biochemistry',
  name: 'Biochemistry',
  description: 'Protein purification, enzyme assays, and characterization',
  icon: '⚗️',
  color: '#8b5cf6',
  parameterSchema: biochemistrySchema,
  supportedFileTypes: [
    { extension: '.asc', description: 'AKTA Chromatogram', parser: 'parseAKTA' },
    { extension: '.arw', description: 'AKTA Raw', parser: 'parseAKTA' },
    { extension: '.csv', description: 'CSV Data', parser: 'parseCSV' }
  ],
  defaultParams: {
    experimentType: 'protein_purification'
  }
};

export const flowCytometryPlugin: ModalityPlugin = {
  id: 'flow_cytometry',
  name: 'Flow Cytometry',
  description: 'Flow cytometry analysis and cell sorting',
  icon: '🔵',
  color: '#0ea5e9',
  parameterSchema: flowCytometrySchema,
  supportedFileTypes: [
    { extension: '.fcs', description: 'FCS 3.0/3.1', parser: 'parseFCS' },
    { extension: '.lmd', description: 'BD FACSDiva', parser: 'parseLMD' },
    { extension: '.wsp', description: 'FlowJo Workspace', parser: 'parseWSP' }
  ],
  defaultParams: {
    experimentType: 'immunophenotyping',
    acquisition: {
      eventsToAcquire: 10000,
      flowRate: 'medium'
    }
  },
  analysisTemplates: [
    {
      id: 'standard_analysis',
      name: 'Standard Gating Analysis',
      description: 'Basic gating and population statistics',
      steps: [
        { id: '1', name: 'Compensation', type: 'processing', config: {} },
        { id: '2', name: 'Doublet Exclusion', type: 'processing', config: { params: ['FSC-A', 'FSC-H'] } },
        { id: '3', name: 'Live/Dead Gate', type: 'processing', config: {} },
        { id: '4', name: 'Population Statistics', type: 'analysis', config: {} },
        { id: '5', name: 'Generate Report', type: 'export', config: { format: 'pdf' } }
      ]
    }
  ]
};

// Register all default plugins
export function registerDefaultPlugins(): void {
  modalityPluginRegistry.register(fluorescencePlugin);
  modalityPluginRegistry.register(electronMicroscopyPlugin);
  modalityPluginRegistry.register(biophysicalPlugin);
  modalityPluginRegistry.register(molecularBiologyPlugin);
  modalityPluginRegistry.register(biochemistryPlugin);
  modalityPluginRegistry.register(flowCytometryPlugin);
}

// Helper to create a custom plugin
export function createModalityPlugin(
  config: Partial<ModalityPlugin> & { id: Modality; name: string; parameterSchema: JSONSchema }
): ModalityPlugin {
  return {
    description: '',
    ...config
  };
}

// Get all supported file types across all registered plugins
export function getAllSupportedFileTypes(): FileTypeHandler[] {
  const allTypes: FileTypeHandler[] = [];
  for (const plugin of modalityPluginRegistry.getAll()) {
    if (plugin.supportedFileTypes) {
      allTypes.push(...plugin.supportedFileTypes);
    }
  }
  // Remove duplicates by extension
  return allTypes.filter((type, index, self) => 
    index === self.findIndex(t => t.extension === type.extension)
  );
}

// Find which modality can handle a given file type
export function findModalityForFileType(extension: string): Modality | undefined {
  for (const plugin of modalityPluginRegistry.getAll()) {
    if (plugin.supportedFileTypes?.some(ft => ft.extension === extension)) {
      return plugin.id;
    }
  }
  return undefined;
}
