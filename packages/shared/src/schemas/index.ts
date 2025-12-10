/**
 * JSON Schema definitions for dynamic form generation
 * Each modality can define its own parameter schema that the UI renders dynamically
 */

import { Modality } from '../types';

// JSON Schema type definitions (subset of JSON Schema Draft-07)
export interface JSONSchema {
  $schema?: string;
  $id?: string;
  title?: string;
  description?: string;
  type: JSONSchemaType | JSONSchemaType[];
  properties?: Record<string, JSONSchema>;
  items?: JSONSchema | JSONSchema[];
  required?: string[];
  enum?: (string | number | boolean | null)[];
  const?: unknown;
  default?: unknown;
  
  // Validation keywords
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  minItems?: number;
  maxItems?: number;
  uniqueItems?: boolean;
  minProperties?: number;
  maxProperties?: number;
  
  // Conditionals
  if?: JSONSchema;
  then?: JSONSchema;
  else?: JSONSchema;
  allOf?: JSONSchema[];
  anyOf?: JSONSchema[];
  oneOf?: JSONSchema[];
  not?: JSONSchema;
  
  // Format for string types
  format?: 'date' | 'time' | 'date-time' | 'uri' | 'email' | 'hostname' | 'ipv4' | 'ipv6' | 'uuid';
  
  // UI Extensions (custom properties for form rendering)
  'ui:widget'?: string;
  'ui:placeholder'?: string;
  'ui:help'?: string;
  'ui:order'?: string[];
  'ui:readonly'?: boolean;
  'ui:hidden'?: boolean;
  'ui:options'?: Record<string, unknown>;
  'ui:component'?: string; // Custom React component name
  
  // References
  $ref?: string;
  definitions?: Record<string, JSONSchema>;
}

export type JSONSchemaType = 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object' | 'null';

// ==================== MODALITY SCHEMAS ====================

export const fluorescenceSchema: JSONSchema = {
  $id: 'eln:modality:fluorescence',
  title: 'Fluorescence Imaging Parameters',
  description: 'Parameters for fluorescence microscopy experiments',
  type: 'object',
  properties: {
    microscope: {
      type: 'string',
      title: 'Microscope',
      description: 'Instrument used for imaging',
      'ui:widget': 'select',
      enum: ['confocal', 'widefield', 'spinning_disk', 'lightsheet', 'tirf', 'super_resolution']
    },
    objective: {
      type: 'string',
      title: 'Objective',
      description: 'Objective lens specification',
      pattern: '^[0-9]+x.*$',
      'ui:placeholder': '60x 1.4NA Oil'
    },
    laserLines: {
      type: 'array',
      title: 'Laser Lines (nm)',
      items: { type: 'number', minimum: 200, maximum: 1000 },
      minItems: 1,
      'ui:help': 'Wavelengths of laser lines used'
    },
    fluorophores: {
      type: 'array',
      title: 'Fluorophores',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', title: 'Name' },
          excitation: { type: 'number', title: 'Excitation (nm)' },
          emission: { type: 'number', title: 'Emission (nm)' },
          target: { type: 'string', title: 'Target Protein/Structure' }
        },
        required: ['name']
      }
    },
    exposure: {
      type: 'number',
      title: 'Exposure Time (ms)',
      minimum: 0.1,
      maximum: 60000,
      default: 100
    },
    zStack: {
      type: 'object',
      title: 'Z-Stack Settings',
      properties: {
        enabled: { type: 'boolean', title: 'Enable Z-Stack', default: false },
        slices: { type: 'integer', title: 'Number of Slices', minimum: 1 },
        stepSize: { type: 'number', title: 'Step Size (µm)', minimum: 0.01 },
        range: { type: 'number', title: 'Total Range (µm)' }
      }
    },
    timeLapse: {
      type: 'object',
      title: 'Time-Lapse Settings',
      properties: {
        enabled: { type: 'boolean', title: 'Enable Time-Lapse', default: false },
        interval: { type: 'number', title: 'Interval (seconds)', minimum: 0 },
        duration: { type: 'number', title: 'Total Duration (minutes)' },
        frames: { type: 'integer', title: 'Number of Frames' }
      }
    },
    imageSettings: {
      type: 'object',
      title: 'Image Settings',
      properties: {
        bitDepth: { 
          type: 'integer', 
          title: 'Bit Depth',
          enum: [8, 12, 16],
          default: 16
        },
        binning: {
          type: 'string',
          title: 'Binning',
          enum: ['1x1', '2x2', '4x4'],
          default: '1x1'
        },
        roi: {
          type: 'object',
          title: 'Region of Interest',
          properties: {
            x: { type: 'integer', title: 'X' },
            y: { type: 'integer', title: 'Y' },
            width: { type: 'integer', title: 'Width' },
            height: { type: 'integer', title: 'Height' }
          }
        }
      }
    }
  },
  required: ['microscope'],
  'ui:order': ['microscope', 'objective', 'laserLines', 'fluorophores', 'exposure', 'zStack', 'timeLapse', 'imageSettings']
};

export const electronMicroscopySchema: JSONSchema = {
  $id: 'eln:modality:electron_microscopy',
  title: 'Electron Microscopy Parameters',
  description: 'Parameters for electron microscopy experiments',
  type: 'object',
  properties: {
    emType: {
      type: 'string',
      title: 'EM Type',
      enum: ['TEM', 'SEM', 'STEM', 'Cryo-EM', 'Cryo-ET'],
      'ui:widget': 'select'
    },
    instrument: {
      type: 'string',
      title: 'Instrument Model',
      'ui:placeholder': 'Thermo Fisher Talos Arctica'
    },
    acceleratingVoltage: {
      type: 'number',
      title: 'Accelerating Voltage (kV)',
      minimum: 1,
      maximum: 400,
      default: 200
    },
    magnification: {
      type: 'number',
      title: 'Magnification',
      minimum: 100,
      maximum: 1000000
    },
    pixelSize: {
      type: 'number',
      title: 'Pixel Size (Å)',
      minimum: 0.1
    },
    dose: {
      type: 'number',
      title: 'Total Dose (e⁻/Å²)',
      minimum: 0
    },
    defocus: {
      type: 'object',
      title: 'Defocus Settings',
      properties: {
        min: { type: 'number', title: 'Min Defocus (µm)' },
        max: { type: 'number', title: 'Max Defocus (µm)' },
        step: { type: 'number', title: 'Step Size (µm)' }
      }
    },
    gridPreparation: {
      type: 'object',
      title: 'Grid Preparation',
      properties: {
        gridType: { 
          type: 'string', 
          title: 'Grid Type',
          enum: ['Cu/C', 'Au/Au', 'Cu-Rh/C', 'Quantifoil', 'UltrAuFoil']
        },
        blotTime: { type: 'number', title: 'Blot Time (s)' },
        blotForce: { type: 'integer', title: 'Blot Force' },
        waitTime: { type: 'number', title: 'Wait Time (s)' },
        humidity: { type: 'number', title: 'Humidity (%)', minimum: 0, maximum: 100 }
      }
    },
    dataCollection: {
      type: 'object',
      title: 'Data Collection',
      properties: {
        movieFrames: { type: 'integer', title: 'Frames per Movie' },
        exposureTime: { type: 'number', title: 'Exposure Time (s)' },
        numberOfImages: { type: 'integer', title: 'Number of Images' }
      }
    }
  },
  required: ['emType', 'acceleratingVoltage']
};

export const biophysicalSchema: JSONSchema = {
  $id: 'eln:modality:biophysical',
  title: 'Biophysical Assay Parameters',
  description: 'Parameters for biophysical characterization experiments',
  type: 'object',
  properties: {
    technique: {
      type: 'string',
      title: 'Technique',
      enum: [
        'SPR', 'BLI', 'ITC', 'DSF', 'DLS', 'SEC-MALS', 
        'MST', 'AUC', 'CD', 'SAXS', 'NMR'
      ],
      'ui:widget': 'select'
    },
    instrument: {
      type: 'string',
      title: 'Instrument',
      'ui:placeholder': 'Biacore 8K+'
    },
    temperature: {
      type: 'number',
      title: 'Temperature (°C)',
      default: 25
    },
    buffer: {
      type: 'object',
      title: 'Buffer Composition',
      properties: {
        name: { type: 'string', title: 'Buffer Name' },
        pH: { type: 'number', title: 'pH', minimum: 0, maximum: 14 },
        components: {
          type: 'array',
          title: 'Components',
          items: {
            type: 'object',
            properties: {
              reagent: { type: 'string', title: 'Reagent' },
              concentration: { type: 'number', title: 'Concentration' },
              unit: { type: 'string', title: 'Unit', enum: ['mM', 'µM', 'nM', 'M', '%', 'mg/mL'] }
            }
          }
        }
      }
    },
    ligand: {
      type: 'object',
      title: 'Ligand/Target',
      properties: {
        name: { type: 'string', title: 'Name' },
        concentration: { type: 'number', title: 'Concentration' },
        unit: { type: 'string', enum: ['nM', 'µM', 'mM', 'mg/mL'] },
        immobilization: { type: 'string', title: 'Immobilization Method' }
      }
    },
    analyte: {
      type: 'object',
      title: 'Analyte',
      properties: {
        name: { type: 'string', title: 'Name' },
        concentrations: {
          type: 'array',
          title: 'Concentration Series',
          items: { type: 'number' }
        },
        unit: { type: 'string', enum: ['nM', 'µM', 'mM', 'mg/mL'] }
      }
    },
    kineticParameters: {
      type: 'object',
      title: 'Expected/Measured Kinetics',
      properties: {
        ka: { type: 'number', title: 'ka (1/Ms)', 'ui:widget': 'scientific' },
        kd: { type: 'number', title: 'kd (1/s)', 'ui:widget': 'scientific' },
        KD: { type: 'number', title: 'KD', 'ui:widget': 'scientific' },
        chi2: { type: 'number', title: 'χ²' }
      }
    }
  },
  required: ['technique']
};

export const molecularBiologySchema: JSONSchema = {
  $id: 'eln:modality:molecular_biology',
  title: 'Molecular Biology Parameters',
  description: 'Parameters for molecular biology experiments',
  type: 'object',
  properties: {
    experimentType: {
      type: 'string',
      title: 'Experiment Type',
      enum: [
        'cloning', 'pcr', 'qpcr', 'mutagenesis', 'transformation',
        'transfection', 'western_blot', 'southern_blot', 'northern_blot',
        'gel_electrophoresis', 'sequencing', 'crispr'
      ],
      'ui:widget': 'select'
    },
    vectors: {
      type: 'array',
      title: 'Vectors/Plasmids',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', title: 'Name' },
          backbone: { type: 'string', title: 'Backbone' },
          resistance: { type: 'string', title: 'Selection Marker', enum: ['Amp', 'Kan', 'Cam', 'Spec', 'Puro', 'Hygro', 'Neo'] },
          insert: { type: 'string', title: 'Insert' },
          size: { type: 'number', title: 'Size (bp)' }
        }
      }
    },
    primers: {
      type: 'array',
      title: 'Primers',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', title: 'Name' },
          sequence: { 
            type: 'string', 
            title: 'Sequence (5\' → 3\')',
            pattern: '^[ATCGatcg]+$'
          },
          tm: { type: 'number', title: 'Tm (°C)' },
          direction: { type: 'string', enum: ['forward', 'reverse'] }
        }
      }
    },
    enzymes: {
      type: 'array',
      title: 'Enzymes',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', title: 'Enzyme Name' },
          type: { type: 'string', enum: ['restriction', 'polymerase', 'ligase', 'nuclease', 'other'] },
          buffer: { type: 'string', title: 'Buffer' },
          temperature: { type: 'number', title: 'Temperature (°C)' }
        }
      }
    },
    pcrConditions: {
      type: 'object',
      title: 'PCR Conditions',
      'ui:hidden': true,
      properties: {
        initialDenaturation: { type: 'object', properties: { temp: { type: 'number' }, time: { type: 'number' } } },
        cycles: { type: 'integer', minimum: 1, maximum: 50 },
        denaturation: { type: 'object', properties: { temp: { type: 'number' }, time: { type: 'number' } } },
        annealing: { type: 'object', properties: { temp: { type: 'number' }, time: { type: 'number' } } },
        extension: { type: 'object', properties: { temp: { type: 'number' }, time: { type: 'number' } } },
        finalExtension: { type: 'object', properties: { temp: { type: 'number' }, time: { type: 'number' } } }
      }
    },
    cellLine: {
      type: 'string',
      title: 'Cell Line'
    },
    transfectionMethod: {
      type: 'string',
      title: 'Transfection Method',
      enum: ['lipofection', 'electroporation', 'calcium_phosphate', 'viral', 'nucleofection']
    }
  },
  required: ['experimentType']
};

export const biochemistrySchema: JSONSchema = {
  $id: 'eln:modality:biochemistry',
  title: 'Biochemistry Parameters',
  description: 'Parameters for biochemistry experiments',
  type: 'object',
  properties: {
    experimentType: {
      type: 'string',
      title: 'Experiment Type',
      enum: [
        'protein_purification', 'enzyme_assay', 'binding_assay',
        'activity_assay', 'stability_study', 'formulation',
        'mass_spec', 'crystallization', 'hplc'
      ]
    },
    protein: {
      type: 'object',
      title: 'Protein',
      properties: {
        name: { type: 'string', title: 'Name' },
        construct: { type: 'string', title: 'Construct' },
        tag: { type: 'string', title: 'Tag', enum: ['His6', 'GST', 'MBP', 'SUMO', 'FLAG', 'HA', 'None'] },
        mw: { type: 'number', title: 'MW (kDa)' },
        pI: { type: 'number', title: 'pI' },
        extinction: { type: 'number', title: 'ε280 (M⁻¹cm⁻¹)' }
      }
    },
    purificationSteps: {
      type: 'array',
      title: 'Purification Steps',
      items: {
        type: 'object',
        properties: {
          step: { type: 'integer', title: 'Step #' },
          method: { 
            type: 'string', 
            title: 'Method',
            enum: ['IMAC', 'IEX', 'SEC', 'HIC', 'Affinity', 'Dialysis', 'Concentration']
          },
          column: { type: 'string', title: 'Column/Media' },
          bufferA: { type: 'string', title: 'Buffer A' },
          bufferB: { type: 'string', title: 'Buffer B' },
          gradient: { type: 'string', title: 'Gradient' },
          yield: { type: 'number', title: 'Yield (mg)' },
          purity: { type: 'number', title: 'Purity (%)', minimum: 0, maximum: 100 }
        }
      }
    },
    enzymeKinetics: {
      type: 'object',
      title: 'Enzyme Kinetics',
      properties: {
        substrate: { type: 'string', title: 'Substrate' },
        Km: { type: 'number', title: 'Km' },
        Vmax: { type: 'number', title: 'Vmax' },
        kcat: { type: 'number', title: 'kcat (s⁻¹)' },
        Ki: { type: 'number', title: 'Ki (inhibitor)' }
      }
    },
    assayConditions: {
      type: 'object',
      title: 'Assay Conditions',
      properties: {
        temperature: { type: 'number', title: 'Temperature (°C)' },
        pH: { type: 'number', title: 'pH' },
        buffer: { type: 'string', title: 'Buffer' },
        incubationTime: { type: 'number', title: 'Incubation Time (min)' },
        replicates: { type: 'integer', title: 'Replicates' }
      }
    }
  }
};

export const flowCytometrySchema: JSONSchema = {
  $id: 'eln:modality:flow_cytometry',
  title: 'Flow Cytometry Parameters',
  description: 'Parameters for flow cytometry experiments',
  type: 'object',
  properties: {
    instrument: {
      type: 'string',
      title: 'Instrument',
      'ui:placeholder': 'BD FACSAria III'
    },
    experimentType: {
      type: 'string',
      title: 'Experiment Type',
      enum: ['immunophenotyping', 'cell_cycle', 'apoptosis', 'sorting', 'functional_assay', 'bead_assay']
    },
    lasers: {
      type: 'array',
      title: 'Lasers',
      items: {
        type: 'object',
        properties: {
          wavelength: { type: 'number', title: 'Wavelength (nm)' },
          power: { type: 'number', title: 'Power (mW)' }
        }
      }
    },
    channels: {
      type: 'array',
      title: 'Detection Channels',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', title: 'Channel Name' },
          detector: { type: 'string', title: 'Detector' },
          filter: { type: 'string', title: 'Filter' },
          marker: { type: 'string', title: 'Marker/Fluorochrome' },
          voltage: { type: 'number', title: 'PMT Voltage' }
        }
      }
    },
    panel: {
      type: 'array',
      title: 'Antibody Panel',
      items: {
        type: 'object',
        properties: {
          marker: { type: 'string', title: 'Marker' },
          clone: { type: 'string', title: 'Clone' },
          fluorochrome: { type: 'string', title: 'Fluorochrome' },
          dilution: { type: 'string', title: 'Dilution' },
          vendor: { type: 'string', title: 'Vendor' },
          catalogNumber: { type: 'string', title: 'Catalog #' }
        }
      }
    },
    compensation: {
      type: 'object',
      title: 'Compensation',
      properties: {
        method: { type: 'string', enum: ['single_stain', 'beads', 'auto'] },
        matrix: { type: 'string', title: 'Compensation Matrix', 'ui:widget': 'textarea' }
      }
    },
    gating: {
      type: 'object',
      title: 'Gating Strategy',
      properties: {
        description: { type: 'string', title: 'Description', 'ui:widget': 'textarea' },
        populations: {
          type: 'array',
          title: 'Populations',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', title: 'Population Name' },
              parent: { type: 'string', title: 'Parent Gate' },
              markers: { type: 'string', title: 'Marker Expression' }
            }
          }
        }
      }
    },
    acquisition: {
      type: 'object',
      title: 'Acquisition Settings',
      properties: {
        eventsToAcquire: { type: 'integer', title: 'Events to Acquire' },
        flowRate: { type: 'string', title: 'Flow Rate', enum: ['low', 'medium', 'high'] },
        threshold: { type: 'string', title: 'Threshold Parameter' }
      }
    },
    sortSettings: {
      type: 'object',
      title: 'Sort Settings',
      'ui:hidden': true,
      properties: {
        nozzleSize: { type: 'number', title: 'Nozzle Size (µm)', enum: [70, 85, 100, 130] },
        pressure: { type: 'number', title: 'Sheath Pressure (psi)' },
        dropDelay: { type: 'number', title: 'Drop Delay' },
        sortMode: { type: 'string', enum: ['purity', 'yield', 'single_cell', '4-way'] }
      }
    }
  },
  required: ['instrument']
};

// ==================== SCHEMA REGISTRY ====================

export const modalitySchemas: Record<Modality, JSONSchema> = {
  fluorescence: fluorescenceSchema,
  electron_microscopy: electronMicroscopySchema,
  biophysical: biophysicalSchema,
  molecular_biology: molecularBiologySchema,
  biochemistry: biochemistrySchema,
  flow_cytometry: flowCytometrySchema
};

export function getModalitySchema(modality: Modality): JSONSchema {
  return modalitySchemas[modality];
}

// ==================== OBSERVATIONS SCHEMA ====================

export const observationsSchema: JSONSchema = {
  $id: 'eln:observations',
  title: 'Experiment Observations',
  description: 'Rich observations with structured data components',
  type: 'object',
  properties: {
    narrative: {
      type: 'string',
      title: 'Narrative',
      description: 'Rich text description of observations',
      'ui:widget': 'richtext'
    },
    tables: {
      type: 'array',
      title: 'Data Tables',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          title: { type: 'string', title: 'Table Title' },
          columns: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                key: { type: 'string' },
                header: { type: 'string' },
                type: { type: 'string', enum: ['text', 'number', 'date', 'boolean'] }
              }
            }
          },
          rows: {
            type: 'array',
            items: { type: 'object' }
          }
        }
      },
      'ui:component': 'DynamicTable'
    },
    measurements: {
      type: 'array',
      title: 'Measurements',
      items: {
        type: 'object',
        properties: {
          timestamp: { type: 'string', format: 'date-time' },
          parameter: { type: 'string' },
          value: { type: 'number' },
          unit: { type: 'string' },
          notes: { type: 'string' }
        }
      },
      'ui:component': 'MeasurementList'
    },
    kineticData: {
      type: 'object',
      title: 'Kinetic Data',
      properties: {
        timePoints: { type: 'array', items: { type: 'number' } },
        datasets: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              label: { type: 'string' },
              values: { type: 'array', items: { type: 'number' } },
              color: { type: 'string' }
            }
          }
        },
        xLabel: { type: 'string' },
        yLabel: { type: 'string' }
      },
      'ui:component': 'KineticChart'
    },
    cellCounts: {
      type: 'object',
      title: 'Cell Counts',
      properties: {
        method: { type: 'string', enum: ['hemocytometer', 'automated', 'flow_cytometry'] },
        counts: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              sample: { type: 'string' },
              totalCells: { type: 'number' },
              viableCells: { type: 'number' },
              viability: { type: 'number' },
              dilutionFactor: { type: 'number' }
            }
          }
        }
      },
      'ui:component': 'CellCountTable'
    },
    images: {
      type: 'array',
      title: 'Embedded Images',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          caption: { type: 'string' },
          attachmentId: { type: 'string' },
          annotations: { type: 'array', items: { type: 'object' } }
        }
      },
      'ui:component': 'ImageGallery'
    },
    conclusions: {
      type: 'string',
      title: 'Conclusions',
      'ui:widget': 'textarea'
    }
  }
};

// ==================== INVENTORY ITEM SCHEMAS ====================

export const reagentPropertiesSchema: JSONSchema = {
  $id: 'eln:inventory:reagent',
  title: 'Reagent Properties',
  type: 'object',
  properties: {
    concentration: { type: 'number', title: 'Concentration' },
    concentrationUnit: { type: 'string', title: 'Unit', enum: ['M', 'mM', 'µM', 'nM', 'mg/mL', '%'] },
    molecularWeight: { type: 'number', title: 'Molecular Weight (g/mol)' },
    purity: { type: 'number', title: 'Purity (%)', minimum: 0, maximum: 100 },
    grade: { type: 'string', title: 'Grade', enum: ['ACS', 'reagent', 'analytical', 'HPLC', 'molecular_biology'] },
    cas: { type: 'string', title: 'CAS Number', pattern: '^[0-9]+-[0-9]+-[0-9]+$' },
    hazards: { 
      type: 'array', 
      title: 'GHS Hazards',
      items: { type: 'string', enum: ['flammable', 'oxidizer', 'toxic', 'corrosive', 'irritant', 'health_hazard', 'environmental'] }
    }
  }
};

export const antibodyPropertiesSchema: JSONSchema = {
  $id: 'eln:inventory:antibody',
  title: 'Antibody Properties',
  type: 'object',
  properties: {
    target: { type: 'string', title: 'Target Antigen' },
    host: { type: 'string', title: 'Host Species', enum: ['mouse', 'rabbit', 'goat', 'rat', 'donkey', 'human'] },
    clonality: { type: 'string', title: 'Clonality', enum: ['monoclonal', 'polyclonal'] },
    clone: { type: 'string', title: 'Clone ID' },
    isotype: { type: 'string', title: 'Isotype' },
    conjugate: { type: 'string', title: 'Conjugate/Label' },
    applications: {
      type: 'array',
      title: 'Validated Applications',
      items: { type: 'string', enum: ['WB', 'IHC', 'IF', 'IP', 'FACS', 'ELISA', 'ChIP'] }
    },
    dilutions: {
      type: 'object',
      title: 'Recommended Dilutions',
      properties: {
        WB: { type: 'string' },
        IF: { type: 'string' },
        FACS: { type: 'string' },
        IHC: { type: 'string' }
      }
    }
  }
};

export const primerPropertiesSchema: JSONSchema = {
  $id: 'eln:inventory:primer',
  title: 'Primer Properties',
  type: 'object',
  properties: {
    sequence: { 
      type: 'string', 
      title: 'Sequence (5\' → 3\')',
      pattern: '^[ATCGatcgNn]+$'
    },
    length: { type: 'integer', title: 'Length (bp)' },
    tm: { type: 'number', title: 'Melting Temperature (°C)' },
    gcContent: { type: 'number', title: 'GC Content (%)', minimum: 0, maximum: 100 },
    modifications: {
      type: 'object',
      title: 'Modifications',
      properties: {
        fivePrime: { type: 'string', title: '5\' Modification' },
        threePrime: { type: 'string', title: '3\' Modification' }
      }
    },
    scale: { type: 'string', title: 'Synthesis Scale', enum: ['25nmol', '100nmol', '250nmol', '1µmol'] },
    purification: { type: 'string', title: 'Purification', enum: ['desalt', 'cartridge', 'HPLC', 'PAGE'] },
    targetGene: { type: 'string', title: 'Target Gene' }
  }
};

export const plasmidPropertiesSchema: JSONSchema = {
  $id: 'eln:inventory:plasmid',
  title: 'Plasmid Properties',
  type: 'object',
  properties: {
    backbone: { type: 'string', title: 'Backbone Vector' },
    size: { type: 'number', title: 'Size (bp)' },
    insert: { type: 'string', title: 'Insert Gene/Sequence' },
    insertSize: { type: 'number', title: 'Insert Size (bp)' },
    promoter: { type: 'string', title: 'Promoter' },
    selectionMarker: { 
      type: 'array',
      title: 'Selection Markers',
      items: { type: 'string', enum: ['Amp', 'Kan', 'Cam', 'Spec', 'Tet', 'Puro', 'Hygro', 'Neo', 'Blast'] }
    },
    copyNumber: { type: 'string', title: 'Copy Number', enum: ['low', 'medium', 'high'] },
    expressionHost: { type: 'string', title: 'Expression Host', enum: ['E.coli', 'mammalian', 'insect', 'yeast'] },
    fusionTag: { type: 'string', title: 'Fusion Tag' },
    sequenceVerified: { type: 'boolean', title: 'Sequence Verified' },
    mapFile: { type: 'string', title: 'Map File (attachment ID)' }
  }
};

export const cellLinePropertiesSchema: JSONSchema = {
  $id: 'eln:inventory:cell_line',
  title: 'Cell Line Properties',
  type: 'object',
  properties: {
    organism: { type: 'string', title: 'Organism' },
    tissue: { type: 'string', title: 'Tissue Origin' },
    cellType: { type: 'string', title: 'Cell Type' },
    morphology: { type: 'string', title: 'Morphology', enum: ['adherent', 'suspension', 'mixed'] },
    medium: { type: 'string', title: 'Culture Medium' },
    supplements: { type: 'array', title: 'Supplements', items: { type: 'string' } },
    serumRequirement: { type: 'string', title: 'Serum' },
    passageNumber: { type: 'integer', title: 'Passage Number' },
    doublingTime: { type: 'number', title: 'Doubling Time (hours)' },
    mycoplasmaStatus: { type: 'string', title: 'Mycoplasma Status', enum: ['negative', 'positive', 'unknown', 'not_tested'] },
    authentication: { type: 'string', title: 'Authentication Method' },
    biosafety: { type: 'string', title: 'Biosafety Level', enum: ['BSL-1', 'BSL-2', 'BSL-3'] },
    geneticModifications: { type: 'array', title: 'Genetic Modifications', items: { type: 'string' } }
  }
};

export const inventoryCategorySchemas: Record<string, JSONSchema> = {
  reagent: reagentPropertiesSchema,
  antibody: antibodyPropertiesSchema,
  primer: primerPropertiesSchema,
  plasmid: plasmidPropertiesSchema,
  cell_line: cellLinePropertiesSchema,
  sample: { type: 'object', properties: {} },
  consumable: { type: 'object', properties: {} }
};

export function getInventoryCategorySchema(category: string): JSONSchema {
  return inventoryCategorySchemas[category] || { type: 'object', properties: {} };
}
