/**
 * Shared Sync Types and Utilities
 * Provides types for offline-first synchronization with conflict resolution
 */

// ==================== SYNC STATUS TYPES ====================

export type SyncStatus = 
  | 'idle'           // No pending changes
  | 'pending'        // Changes queued, waiting for connectivity
  | 'syncing'        // Actively synchronizing
  | 'error'          // Sync failed, needs attention
  | 'conflict'       // Conflicts detected, needs resolution
  | 'offline';       // Device is offline

export type ConflictResolutionStrategy = 
  | 'client-wins'    // Local changes overwrite server
  | 'server-wins'    // Server changes overwrite local
  | 'merge'          // Attempt automatic merge
  | 'manual';        // Require user resolution

export type ChangeOperation = 'create' | 'update' | 'delete';

export type EntityType = 
  | 'experiment' 
  | 'method' 
  | 'inventoryItem' 
  | 'stock' 
  | 'attachment'
  | 'report'
  | 'comment'
  | 'signature';

// ==================== PENDING CHANGE TYPES ====================

export interface PendingChange {
  id: string;
  entityType: EntityType;
  entityId: string;
  operation: ChangeOperation;
  data: unknown;
  timestamp: string;
  synced: boolean;
  retryCount: number;
  lastError?: string;
  priority: 'high' | 'normal' | 'low';
  // For large file uploads
  uploadProgress?: number;
  totalBytes?: number;
  uploadedBytes?: number;
}

export interface SyncConflict {
  id: string;
  entityType: EntityType;
  entityId: string;
  localVersion: number;
  serverVersion: number;
  localData: unknown;
  serverData: unknown;
  fieldConflicts: FieldConflict[];
  detectedAt: string;
  resolvedAt?: string;
  resolution?: ConflictResolutionStrategy;
}

export interface FieldConflict {
  field: string;
  localValue: unknown;
  serverValue: unknown;
  mergedValue?: unknown;
}

// ==================== SYNC STATE TYPES ====================

export interface SyncState {
  status: SyncStatus;
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

export interface SyncProgress {
  phase: 'pushing' | 'pulling' | 'resolving' | 'uploading';
  current: number;
  total: number;
  currentItem?: string;
  bytesTransferred?: number;
  totalBytes?: number;
}

export interface SyncError {
  id: string;
  entityType?: EntityType;
  entityId?: string;
  message: string;
  code: string;
  timestamp: string;
  retryable: boolean;
}

// ==================== SELECTIVE SYNC TYPES ====================

export interface SelectiveSyncConfig {
  enabled: boolean;
  // Filter by projects
  projects: string[];
  // Filter by date range
  dateRange?: {
    start: string;
    end: string;
  };
  // Include specific entity types
  entityTypes: EntityType[];
  // Exclude large attachments over this size (bytes)
  maxAttachmentSize?: number;
  // Only sync experiments with these modalities
  modalities?: string[];
  // Only sync experiments by these users
  userIds?: string[];
}

export interface StorageQuota {
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

// ==================== FAIR METADATA TYPES ====================

export interface FAIRIdentifier {
  type: 'uuid' | 'doi' | 'handle' | 'orcid' | 'ror';
  value: string;
  url?: string;
}

export interface FAIRMetadata {
  identifiers: FAIRIdentifier[];
  title: string;
  description?: string;
  creators: FAIRCreator[];
  contributors?: FAIRContributor[];
  keywords: string[];
  subjects: ControlledVocabularyTerm[];
  license?: string;
  rights?: string;
  dateCreated: string;
  dateModified: string;
  datePublished?: string;
  version: string;
  relatedIdentifiers?: FAIRRelatedIdentifier[];
  fundingReferences?: FAIRFundingReference[];
}

export interface FAIRCreator {
  name: string;
  givenName?: string;
  familyName?: string;
  orcid?: string;
  affiliation?: string;
  affiliationRor?: string;
}

export interface FAIRContributor extends FAIRCreator {
  contributorType: 'Editor' | 'DataCollector' | 'DataCurator' | 'Researcher' | 'Other';
}

export interface FAIRRelatedIdentifier {
  identifier: string;
  identifierType: 'DOI' | 'URL' | 'URN' | 'Handle';
  relationType: 'IsCitedBy' | 'Cites' | 'IsSupplementTo' | 'IsSupplementedBy' | 
                'IsContinuedBy' | 'Continues' | 'IsNewVersionOf' | 'IsPreviousVersionOf' |
                'IsPartOf' | 'HasPart' | 'IsReferencedBy' | 'References' | 'IsDocumentedBy' |
                'Documents' | 'IsCompiledBy' | 'Compiles' | 'IsVariantFormOf' | 'IsOriginalFormOf' |
                'IsIdenticalTo' | 'IsReviewedBy' | 'Reviews' | 'IsDerivedFrom' | 'IsSourceOf';
}

export interface FAIRFundingReference {
  funderName: string;
  funderIdentifier?: string;
  funderIdentifierType?: 'Crossref Funder ID' | 'ROR' | 'GRID' | 'ISNI' | 'Other';
  awardNumber?: string;
  awardTitle?: string;
}

// ==================== CONTROLLED VOCABULARY TYPES ====================

export interface ControlledVocabularyTerm {
  vocabulary: string;
  term: string;
  uri?: string;
  label?: string;
}

export interface MetadataTemplate {
  id: string;
  name: string;
  description: string;
  domain: string;
  standard?: string; // e.g., 'MIAME', 'MIFlowCyt', 'MIQE'
  version: string;
  fields: MetadataField[];
}

export interface MetadataField {
  id: string;
  name: string;
  label: string;
  description?: string;
  type: 'string' | 'number' | 'boolean' | 'date' | 'array' | 'object' | 'controlled';
  required: boolean;
  vocabulary?: string;
  vocabularyTerms?: string[];
  unit?: string;
  allowedUnits?: string[];
  validation?: {
    pattern?: string;
    min?: number;
    max?: number;
    minLength?: number;
    maxLength?: number;
  };
  defaultValue?: unknown;
}

// ==================== DOMAIN-SPECIFIC TEMPLATES ====================

export const METADATA_TEMPLATES: MetadataTemplate[] = [
  {
    id: 'miame',
    name: 'MIAME',
    description: 'Minimum Information About a Microarray Experiment',
    domain: 'genomics',
    standard: 'MIAME',
    version: '2.0',
    fields: [
      { id: 'experimentDesign', name: 'experiment_design', label: 'Experiment Design', type: 'string', required: true },
      { id: 'samples', name: 'samples', label: 'Samples Used', type: 'array', required: true },
      { id: 'hybridizations', name: 'hybridizations', label: 'Hybridization Information', type: 'object', required: true },
      { id: 'measurements', name: 'measurements', label: 'Measurement Data', type: 'object', required: true },
      { id: 'normalization', name: 'normalization', label: 'Normalization Controls', type: 'string', required: false },
    ]
  },
  {
    id: 'miflowcyt',
    name: 'MIFlowCyt',
    description: 'Minimum Information about a Flow Cytometry Experiment',
    domain: 'flow_cytometry',
    standard: 'MIFlowCyt',
    version: '1.0',
    fields: [
      { id: 'experimentOverview', name: 'experiment_overview', label: 'Experiment Overview', type: 'string', required: true },
      { id: 'flowCytometer', name: 'flow_cytometer', label: 'Flow Cytometer', type: 'string', required: true, vocabulary: 'instruments' },
      { id: 'sampleDetails', name: 'sample_details', label: 'Sample Details', type: 'object', required: true },
      { id: 'instrumentSettings', name: 'instrument_settings', label: 'Instrument Settings', type: 'object', required: true },
      { id: 'compensationDescription', name: 'compensation_description', label: 'Compensation Description', type: 'string', required: false },
      { id: 'gatingDescription', name: 'gating_description', label: 'Gating Description', type: 'string', required: false },
    ]
  },
  {
    id: 'miqe',
    name: 'MIQE',
    description: 'Minimum Information for Publication of Quantitative Real-Time PCR Experiments',
    domain: 'molecular_biology',
    standard: 'MIQE',
    version: '2.0',
    fields: [
      { id: 'experimentalDesign', name: 'experimental_design', label: 'Experimental Design', type: 'string', required: true },
      { id: 'sampleDetails', name: 'sample_details', label: 'Sample Details', type: 'object', required: true },
      { id: 'nucleicAcidExtraction', name: 'nucleic_acid_extraction', label: 'Nucleic Acid Extraction', type: 'object', required: true },
      { id: 'reverseTranscription', name: 'reverse_transcription', label: 'Reverse Transcription', type: 'object', required: false },
      { id: 'qpcrTargetInfo', name: 'qpcr_target_info', label: 'qPCR Target Information', type: 'object', required: true },
      { id: 'qpcrProtocol', name: 'qpcr_protocol', label: 'qPCR Protocol', type: 'object', required: true },
      { id: 'dataAnalysis', name: 'data_analysis', label: 'Data Analysis', type: 'object', required: true },
    ]
  },
  {
    id: 'rembi',
    name: 'REMBI',
    description: 'Recommended Metadata for Biological Images',
    domain: 'imaging',
    standard: 'REMBI',
    version: '1.0',
    fields: [
      { id: 'studyComponent', name: 'study_component', label: 'Study Component', type: 'object', required: true },
      { id: 'biosample', name: 'biosample', label: 'Biosample', type: 'object', required: true },
      { id: 'specimen', name: 'specimen', label: 'Specimen', type: 'object', required: true },
      { id: 'imageAcquisition', name: 'image_acquisition', label: 'Image Acquisition', type: 'object', required: true },
      { id: 'imageData', name: 'image_data', label: 'Image Data', type: 'object', required: true },
    ]
  }
];

// ==================== CONTROLLED VOCABULARIES ====================

export const CONTROLLED_VOCABULARIES: Record<string, string[]> = {
  // Units
  units_volume: ['L', 'mL', 'µL', 'nL', 'pL'],
  units_mass: ['kg', 'g', 'mg', 'µg', 'ng', 'pg'],
  units_concentration: ['M', 'mM', 'µM', 'nM', 'pM', 'mg/mL', 'µg/mL', 'ng/mL', '%', 'v/v', 'w/v'],
  units_temperature: ['°C', '°F', 'K'],
  units_time: ['s', 'min', 'h', 'd', 'wk'],
  
  // Organisms
  organisms: [
    'Homo sapiens', 'Mus musculus', 'Rattus norvegicus', 
    'Drosophila melanogaster', 'Caenorhabditis elegans',
    'Danio rerio', 'Xenopus laevis', 'Saccharomyces cerevisiae',
    'Escherichia coli', 'Arabidopsis thaliana'
  ],
  
  // Cell lines
  cell_lines: [
    'HeLa', 'HEK293', 'HEK293T', 'U2OS', 'NIH 3T3', 'CHO',
    'Jurkat', 'K562', 'MCF7', 'A549', 'SH-SY5Y', 'PC12',
    'Raw 264.7', 'THP-1', 'MDCK', 'Vero', 'BHK-21'
  ],
  
  // Microscopy modalities
  microscopy_modalities: [
    'Brightfield', 'Phase contrast', 'DIC', 'Fluorescence widefield',
    'Confocal laser scanning', 'Spinning disk confocal', 'Two-photon',
    'TIRF', 'Light sheet', 'Super-resolution (STORM)', 'Super-resolution (PALM)',
    'Super-resolution (SIM)', 'Super-resolution (STED)', 'Electron microscopy (TEM)',
    'Electron microscopy (SEM)', 'Cryo-EM'
  ],
  
  // Fluorophores
  fluorophores: [
    'DAPI', 'Hoechst 33342', 'Hoechst 33258',
    'FITC', 'Alexa Fluor 488', 'GFP', 'EGFP', 'mNeonGreen',
    'Cy3', 'Alexa Fluor 546', 'Alexa Fluor 555', 'TRITC', 'mCherry', 'tdTomato',
    'Cy5', 'Alexa Fluor 647', 'Alexa Fluor 680',
    'Alexa Fluor 750', 'Cy7', 'IRDye 800CW'
  ],
  
  // Antibody applications
  antibody_applications: ['WB', 'IHC', 'IHC-P', 'IHC-F', 'IF', 'ICC', 'IP', 'ChIP', 'FACS', 'ELISA', 'Neutralization'],
  
  // Plasmid selection markers
  selection_markers: ['Ampicillin', 'Kanamycin', 'Chloramphenicol', 'Spectinomycin', 'Tetracycline', 
                      'Puromycin', 'Hygromycin', 'Neomycin/G418', 'Blasticidin', 'Zeocin'],
  
  // Expression hosts
  expression_hosts: ['E. coli BL21(DE3)', 'E. coli DH5α', 'E. coli TOP10', 'E. coli Rosetta',
                     'HEK293', 'HEK293T', 'CHO', 'Sf9', 'Sf21', 'High Five',
                     'S. cerevisiae', 'P. pastoris'],
  
  // Buffer components
  buffer_components: ['Tris', 'HEPES', 'PBS', 'TBS', 'MOPS', 'MES', 'Bicine', 'Tricine',
                      'NaCl', 'KCl', 'MgCl2', 'CaCl2', 'EDTA', 'EGTA', 'DTT', 'β-mercaptoethanol',
                      'Glycerol', 'Triton X-100', 'Tween-20', 'SDS', 'NP-40', 'CHAPS'],
  
  // Instruments (flow cytometry)
  instruments_flow_cytometry: [
    'BD FACSAria', 'BD FACSCanto', 'BD LSRFortessa', 'BD Accuri C6',
    'Beckman Coulter CytoFLEX', 'Beckman Coulter MoFlo',
    'Sony SH800', 'Sony MA900', 'Bio-Rad ZE5',
    'Miltenyi MACSQuant', 'Thermo Attune NxT', 'Cytek Aurora'
  ],
};

// ==================== EXPORT FORMAT TYPES ====================

export type ExportFormat = 
  | 'eln'       // RO-Crate based .eln format
  | 'json'      // Raw JSON
  | 'csv'       // Comma-separated values
  | 'pdf'       // PDF report
  | 'zip'       // ZIP archive with attachments
  | 'parquet'   // Apache Parquet (columnar)
  | 'hdf5';     // HDF5 (hierarchical data)

export interface ExportOptions {
  format: ExportFormat;
  includeAttachments: boolean;
  includeSignatures: boolean;
  includeAuditTrail: boolean;
  includeComments: boolean;
  includeFAIRMetadata: boolean;
  metadataTemplate?: string;
  dateRange?: { start: string; end: string };
  compression?: 'none' | 'gzip' | 'lz4';
}

// ==================== UTILITY FUNCTIONS ====================

export function generateUUID(): string {
  return crypto.randomUUID?.() || 
    'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
}

export function isOnline(): boolean {
  if (typeof navigator !== 'undefined') {
    return navigator.onLine;
  }
  return true;
}

export function formatBytes(bytes: number, decimals = 2): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

export function getVocabularyTerms(vocabulary: string): string[] {
  return CONTROLLED_VOCABULARIES[vocabulary] || [];
}

export function getMetadataTemplate(id: string): MetadataTemplate | undefined {
  return METADATA_TEMPLATES.find(t => t.id === id);
}

export function getTemplatesForDomain(domain: string): MetadataTemplate[] {
  return METADATA_TEMPLATES.filter(t => t.domain === domain);
}
