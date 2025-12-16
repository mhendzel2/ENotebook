/**
 * ELN Export Service
 * Supports multiple export formats including:
 * - .eln (eLabFTW open standard based on RO-Crate)
 * - PDF (immutable reports)
 * - ZIP (complete archives with attachments)
 * - JSON/CSV (FAIR data principles)
 * - Parquet (columnar format for large datasets)
 * - HDF5 (hierarchical data for scientific computing)
 * 
 * Enhanced with FAIR metadata support and domain-specific templates
 */

import { PrismaClient } from '@prisma/client';
import { Request, Response, Router } from 'express';
import crypto from 'crypto';
import archiver from 'archiver';
import { Writable } from 'stream';
import puppeteer from 'puppeteer';
import AdmZip from 'adm-zip';
import type {
  FAIRMetadata,
  FAIRCreator,
  FAIRIdentifier,
  MetadataTemplate,
  ControlledVocabularyTerm,
} from '@eln/shared/dist/sync.js';
import {
  METADATA_TEMPLATES,
  CONTROLLED_VOCABULARIES,
} from '@eln/shared/dist/sync.js';

// ==================== TYPES ====================

export type ExportFormat = 'eln' | 'pdf' | 'zip' | 'json' | 'csv' | 'parquet' | 'hdf5';

export interface ExportOptions {
  format: ExportFormat;
  includeAttachments: boolean;
  includeSignatures: boolean;
  includeAuditTrail: boolean;
  includeComments: boolean;
  includeFAIRMetadata: boolean;
  metadataTemplate?: string;
  dateRange?: { start: Date; end: Date };
  fairMetadata?: Partial<FAIRMetadata>;
}

export interface ROCrateMetadata {
  '@context': string;
  '@type': string;
  '@id': string;
  identifier: string;
  name: string;
  description?: string;
  dateCreated: string;
  dateModified: string;
  author: ROCratePerson[];
  hasPart: ROCrateEntity[];
  conformsTo?: { '@id': string };
}

export interface ROCratePerson {
  '@type': 'Person';
  '@id': string;
  name: string;
  email?: string;
  affiliation?: string;
}

export interface ROCrateEntity {
  '@type': string;
  '@id': string;
  name: string;
  description?: string;
  dateCreated?: string;
  dateModified?: string;
  encodingFormat?: string;
  contentSize?: number;
}

// ==================== ELN EXPORT SERVICE ====================

export class ElnExportService {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  /**
   * Export single experiment to .eln format
   */
  async exportExperimentToEln(
    experimentId: string,
    options: Partial<ExportOptions> = {}
  ): Promise<Buffer> {
    const experiment = await this.prisma.experiment.findUnique({
      where: { id: experimentId },
      include: {
        user: { select: { id: true, name: true, email: true } },
        protocol: true,
        attachments: true,
        signatures: {
          include: { user: { select: { id: true, name: true, email: true } } }
        },
        comments: {
          include: { author: { select: { id: true, name: true } } }
        },
        stockUsages: {
          include: { stock: { include: { item: true } } }
        }
      }
    });

    if (!experiment) {
      throw new Error('Experiment not found');
    }

    return this.createElnArchive([experiment], options);
  }

  /**
   * Export multiple experiments to .eln format
   */
  async exportExperimentsToEln(
    experimentIds: string[],
    options: Partial<ExportOptions> = {}
  ): Promise<Buffer> {
    const experiments = await this.prisma.experiment.findMany({
      where: { id: { in: experimentIds } },
      include: {
        user: { select: { id: true, name: true, email: true } },
        protocol: true,
        attachments: true,
        signatures: {
          include: { user: { select: { id: true, name: true, email: true } } }
        },
        comments: {
          include: { author: { select: { id: true, name: true } } }
        },
        stockUsages: {
          include: { stock: { include: { item: true } } }
        }
      }
    });

    return this.createElnArchive(experiments, options);
  }

  /**
   * Create .eln archive (ZIP with RO-Crate metadata)
   */
  private async createElnArchive(
    experiments: any[],
    options: Partial<ExportOptions>
  ): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      const output = new Writable({
        write(chunk, encoding, callback) {
          chunks.push(chunk);
          callback();
        }
      });

      const archive = archiver('zip', { zlib: { level: 9 } });
      
      archive.on('error', reject);
      archive.on('end', () => resolve(Buffer.concat(chunks)));
      
      archive.pipe(output);

      // Build RO-Crate metadata
      const roCrate = this.buildROCrateMetadata(experiments);
      archive.append(JSON.stringify(roCrate, null, 2), { name: 'ro-crate-metadata.json' });

      // Add experiments as JSON files
      for (const exp of experiments) {
        const expData = this.formatExperimentForExport(exp, options);
        archive.append(
          JSON.stringify(expData, null, 2),
          { name: `experiments/${exp.id}.json` }
        );

        // Add attachments if included
        if (options.includeAttachments && exp.attachments) {
          for (const att of exp.attachments) {
            if (att.blobPath) {
              // In production, read actual file from storage
              // For now, add placeholder
              archive.append(
                `Attachment: ${att.filename}`,
                { name: `attachments/${exp.id}/${att.filename}` }
              );
            }
          }
        }
      }

      // Add manifest
      const manifest = this.generateManifest(experiments, options);
      archive.append(JSON.stringify(manifest, null, 2), { name: 'manifest.json' });

      // Add README
      const readme = this.generateReadme(experiments);
      archive.append(readme, { name: 'README.md' });

      archive.finalize();
    });
  }

  /**
   * Build RO-Crate metadata according to .eln specification
   */
  private buildROCrateMetadata(experiments: any[]): ROCrateMetadata {
    const authors = new Map<string, ROCratePerson>();
    const parts: ROCrateEntity[] = [];

    for (const exp of experiments) {
      // Collect unique authors
      if (exp.user && !authors.has(exp.user.id)) {
        authors.set(exp.user.id, {
          '@type': 'Person',
          '@id': `#person-${exp.user.id}`,
          name: exp.user.name,
          email: exp.user.email,
        });
      }

      // Add experiment as part
      parts.push({
        '@type': 'Dataset',
        '@id': `#experiment-${exp.id}`,
        name: exp.title,
        description: exp.resultsSummary || undefined,
        dateCreated: exp.createdAt.toISOString(),
        dateModified: exp.updatedAt.toISOString(),
      });

      // Add attachments as parts
      if (exp.attachments) {
        for (const att of exp.attachments) {
          parts.push({
            '@type': 'File',
            '@id': `attachments/${exp.id}/${att.filename}`,
            name: att.filename,
            encodingFormat: att.mime || 'application/octet-stream',
            contentSize: att.size,
          });
        }
      }
    }

    return {
      '@context': 'https://w3id.org/ro/crate/1.1/context',
      '@type': 'Dataset',
      '@id': './',
      identifier: crypto.randomUUID(),
      name: `ELN Export - ${new Date().toISOString().split('T')[0]}`,
      description: `Export containing ${experiments.length} experiment(s)`,
      dateCreated: new Date().toISOString(),
      dateModified: new Date().toISOString(),
      author: Array.from(authors.values()),
      hasPart: parts,
      conformsTo: {
        '@id': 'https://github.com/TheELNConsortium/TheELNFileFormat'
      }
    };
  }

  /**
   * Format experiment data for export
   */
  private formatExperimentForExport(exp: any, options: Partial<ExportOptions>): any {
    const result: any = {
      '@type': 'Experiment',
      id: exp.id,
      title: exp.title,
      project: exp.project,
      modality: exp.modality,
      status: exp.status,
      version: exp.version,
      createdAt: exp.createdAt.toISOString(),
      updatedAt: exp.updatedAt.toISOString(),
      author: {
        id: exp.user.id,
        name: exp.user.name,
        email: exp.user.email,
      },
      params: exp.params ? JSON.parse(exp.params) : undefined,
      observations: exp.observations ? JSON.parse(exp.observations) : undefined,
      resultsSummary: exp.resultsSummary,
      tags: exp.tags ? JSON.parse(exp.tags) : [],
    };

    if (exp.protocol) {
      result.protocol = {
        id: exp.protocol.id,
        title: exp.protocol.title,
        version: exp.protocol.version,
      };
    }

    if (options.includeSignatures && exp.signatures) {
      result.signatures = exp.signatures.map((s: any) => ({
        id: s.id,
        type: s.signatureType,
        meaning: s.meaning,
        timestamp: s.timestamp.toISOString(),
        signer: {
          id: s.user.id,
          name: s.user.name,
        },
        contentHash: s.contentHash,
      }));
    }

    if (options.includeComments && exp.comments) {
      result.comments = exp.comments.map((c: any) => ({
        id: c.id,
        content: c.content,
        author: {
          id: c.author.id,
          name: c.author.name,
        },
        createdAt: c.createdAt.toISOString(),
      }));
    }

    if (exp.stockUsages) {
      result.materialsUsed = exp.stockUsages.map((su: any) => ({
        item: {
          id: su.stock.item.id,
          name: su.stock.item.name,
          category: su.stock.item.category,
        },
        lotNumber: su.stock.lotNumber,
        quantityUsed: su.quantityUsed,
        unit: su.stock.item.unit,
      }));
    }

    if (exp.attachments) {
      result.attachments = exp.attachments.map((a: any) => ({
        id: a.id,
        filename: a.filename,
        mimeType: a.mime,
        size: a.size,
        path: `attachments/${exp.id}/${a.filename}`,
      }));
    }

    return result;
  }

  /**
   * Generate manifest with checksums
   */
  private generateManifest(experiments: any[], options: Partial<ExportOptions>): any {
    const files: any[] = [];

    files.push({
      path: 'ro-crate-metadata.json',
      description: 'RO-Crate metadata',
    });

    for (const exp of experiments) {
      files.push({
        path: `experiments/${exp.id}.json`,
        description: `Experiment: ${exp.title}`,
      });

      if (options.includeAttachments && exp.attachments) {
        for (const att of exp.attachments) {
          files.push({
            path: `attachments/${exp.id}/${att.filename}`,
            description: `Attachment for ${exp.title}`,
            mimeType: att.mime,
            size: att.size,
          });
        }
      }
    }

    return {
      version: '1.0',
      format: 'eln',
      exportedAt: new Date().toISOString(),
      experimentCount: experiments.length,
      files,
    };
  }

  /**
   * Generate README for archive
   */
  private generateReadme(experiments: any[]): string {
    return `# ELN Export

## Overview
This archive was exported from ENotebook and conforms to the .eln file format specification.

## Contents
- ${experiments.length} experiment(s)
- RO-Crate metadata for FAIR compliance
- Associated attachments (if included)

## Experiments
${experiments.map(e => `- **${e.title}** (${e.id})\n  - Created: ${e.createdAt.toISOString()}\n  - Status: ${e.status}`).join('\n')}

## Format
This archive follows the ELN Consortium file format specification:
https://github.com/TheELNConsortium/TheELNFileFormat

## Import
This archive can be imported into any ELN system that supports the .eln format,
including eLabFTW, Chemotion, and other compatible systems.

## License
The data in this archive is subject to the licensing terms of the originating laboratory.

---
Generated: ${new Date().toISOString()}
`;
  }

  /**
   * Generate PDF report
   */
  async generatePdf(experimentId: string): Promise<Buffer> {
    const experiment = await this.prisma.experiment.findUnique({
      where: { id: experimentId },
      include: {
        user: { select: { id: true, name: true, email: true } },
        signatures: {
          include: { user: { select: { id: true, name: true } } }
        },
        comments: {
          include: { author: { select: { id: true, name: true } } }
        },
      }
    });

    if (!experiment) {
      throw new Error('Experiment not found');
    }

    const htmlContent = this.generateHtmlReport(experiment);

    // Launch headless browser for PDF generation
    const browser = await puppeteer.launch({ 
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'] // Security: Required for containerized environments
    });
    
    try {
      const page = await browser.newPage();
      
      // Set content and wait for network idle to ensure assets load
      await page.setContent(htmlContent, { waitUntil: 'networkidle0' });
      
      // Generate PDF buffer with compliance-friendly formatting
      const pdfBuffer = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: { top: '20mm', right: '15mm', bottom: '20mm', left: '15mm' },
        displayHeaderFooter: true,
        headerTemplate: `<div style="font-size:9px; margin-left:20mm; color:#666;">ENotebook - ${experiment.title}</div>`,
        footerTemplate: `<div style="font-size:9px; margin-left:20mm; width:100%; display:flex; justify-content:space-between; padding-right:20mm;">
          <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
          <span>Document ID: ${experiment.id}</span>
        </div>`
      });

      return Buffer.from(pdfBuffer);
    } finally {
      await browser.close();
    }
  }

  /**
   * Escape HTML to prevent XSS
   */
  private escapeHtml(str: string): string {
    if (typeof str !== 'string') return String(str);
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  /**
   * Generate HTML report for PDF conversion
   */
  private generateHtmlReport(experiment: any): string {
    const signatures = experiment.signatures || [];
    const comments = experiment.comments || [];
    const params = experiment.params ? JSON.parse(experiment.params) : {};
    const observations = experiment.observations ? JSON.parse(experiment.observations) : null;
    
    // Helper for safe output
    const esc = (s: any) => this.escapeHtml(String(s ?? ''));

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${esc(experiment.title)}</title>
  <style>
    body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
    h1 { color: #333; border-bottom: 2px solid #007bff; padding-bottom: 10px; }
    h2 { color: #555; margin-top: 30px; }
    .meta { background: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0; }
    .meta dt { font-weight: bold; }
    .meta dd { margin-left: 0; margin-bottom: 10px; }
    .signature { background: #e8f4e8; padding: 10px; margin: 10px 0; border-left: 4px solid #28a745; }
    .comment { background: #fff3cd; padding: 10px; margin: 10px 0; border-left: 4px solid #ffc107; }
    .params { background: #e7f3ff; padding: 15px; border-radius: 5px; }
    .footer { margin-top: 50px; padding-top: 20px; border-top: 1px solid #ddd; font-size: 12px; color: #666; }
    table { width: 100%; border-collapse: collapse; margin: 10px 0; }
    th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
    th { background: #f5f5f5; }
  </style>
</head>
<body>
  <h1>${esc(experiment.title)}</h1>
  
  <dl class="meta">
    <dt>ID:</dt><dd>${esc(experiment.id)}</dd>
    <dt>Project:</dt><dd>${esc(experiment.project || 'N/A')}</dd>
    <dt>Modality:</dt><dd>${esc(experiment.modality)}</dd>
    <dt>Status:</dt><dd>${esc(experiment.status)}</dd>
    <dt>Version:</dt><dd>${esc(experiment.version)}</dd>
    <dt>Author:</dt><dd>${esc(experiment.user.name)} (${esc(experiment.user.email)})</dd>
    <dt>Created:</dt><dd>${esc(experiment.createdAt.toISOString())}</dd>
    <dt>Modified:</dt><dd>${esc(experiment.updatedAt.toISOString())}</dd>
  </dl>

  ${Object.keys(params).length > 0 ? `
  <h2>Parameters</h2>
  <div class="params">
    <table>
      <tr><th>Parameter</th><th>Value</th></tr>
      ${Object.entries(params).map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(JSON.stringify(v))}</td></tr>`).join('')}
    </table>
  </div>
  ` : ''}

  ${observations ? `
  <h2>Observations</h2>
  <pre>${esc(JSON.stringify(observations, null, 2))}</pre>
  ` : ''}

  ${experiment.resultsSummary ? `
  <h2>Results Summary</h2>
  <p>${esc(experiment.resultsSummary)}</p>
  ` : ''}

  ${signatures.length > 0 ? `
  <h2>Electronic Signatures</h2>
  ${signatures.map((s: any) => `
  <div class="signature">
    <strong>${esc(s.signatureType.toUpperCase())}</strong> - ${esc(s.user.name)}<br>
    <em>${esc(s.meaning)}</em><br>
    <small>Signed: ${esc(s.timestamp.toISOString())}</small><br>
    <small>Content Hash: ${esc(s.contentHash)}</small>
  </div>
  `).join('')}
  ` : ''}

  ${comments.length > 0 ? `
  <h2>Comments</h2>
  ${comments.map((c: any) => `
  <div class="comment">
    <strong>${esc(c.author.name)}</strong> - ${esc(c.createdAt.toISOString())}<br>
    ${esc(c.content)}
  </div>
  `).join('')}
  ` : ''}

  <div class="footer">
    <p>This document was generated from ENotebook on ${new Date().toISOString()}</p>
    <p>Document Hash: ${crypto.createHash('sha256').update(experiment.id + experiment.updatedAt.toISOString()).digest('hex')}</p>
  </div>
</body>
</html>`;
  }

  // ==================== FAIR METADATA METHODS ====================

  /**
   * Generate FAIR-compliant metadata for experiments
   */
  generateFAIRMetadata(experiments: any[], options: Partial<ExportOptions> = {}): FAIRMetadata {
    const creators = new Map<string, FAIRCreator>();
    const keywords = new Set<string>();
    const subjects: ControlledVocabularyTerm[] = [];

    for (const exp of experiments) {
      // Collect creators
      if (exp.user && !creators.has(exp.user.id)) {
        creators.set(exp.user.id, {
          name: exp.user.name,
          givenName: exp.user.name.split(' ')[0],
          familyName: exp.user.name.split(' ').slice(1).join(' ') || undefined,
          orcid: exp.user.orcid || undefined,
          affiliation: exp.user.affiliation || undefined,
        });
      }

      // Collect keywords from tags
      const tags = Array.isArray(exp.tags) ? exp.tags : (exp.tags ? JSON.parse(exp.tags) : []);
      tags.forEach((tag: string) => keywords.add(tag));

      // Add modality as subject
      if (exp.modality) {
        subjects.push({
          vocabulary: 'eln:modality',
          term: exp.modality,
          label: exp.modality.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()),
        });
      }
    }

    // Merge with user-provided FAIR metadata
    const userMeta = options.fairMetadata || {};

    return {
      identifiers: userMeta.identifiers || [
        { type: 'uuid', value: crypto.randomUUID() }
      ],
      title: userMeta.title || `ELN Export - ${experiments.length} Experiment(s)`,
      description: userMeta.description || experiments.map(e => e.title).join(', '),
      creators: userMeta.creators || Array.from(creators.values()),
      keywords: userMeta.keywords || Array.from(keywords),
      subjects: userMeta.subjects || subjects,
      license: userMeta.license || 'All Rights Reserved',
      dateCreated: experiments.reduce(
        (min, exp) => exp.createdAt < min ? exp.createdAt : min,
        experiments[0]?.createdAt
      )?.toISOString() || new Date().toISOString(),
      dateModified: experiments.reduce(
        (max, exp) => exp.updatedAt > max ? exp.updatedAt : max,
        experiments[0]?.updatedAt
      )?.toISOString() || new Date().toISOString(),
      version: '1.0',
      relatedIdentifiers: userMeta.relatedIdentifiers,
      fundingReferences: userMeta.fundingReferences,
    };
  }

  /**
   * Get available metadata templates
   */
  getMetadataTemplates(): MetadataTemplate[] {
    return METADATA_TEMPLATES;
  }

  /**
   * Get template by modality or domain
   */
  getTemplateForModality(modality: string): MetadataTemplate | undefined {
    const modalityToTemplate: Record<string, string> = {
      'flow_cytometry': 'miflowcyt',
      'qPCR': 'miqe',
      'RT-qPCR': 'miqe',
      'microarray': 'miame',
      'RNAseq': 'miame',
      'microscopy': 'rembi',
      'confocal': 'rembi',
      'imaging': 'rembi',
    };

    const templateId = modalityToTemplate[modality];
    if (templateId) {
      return METADATA_TEMPLATES.find((t: MetadataTemplate) => t.id === templateId);
    }
    return undefined;
  }

  /**
   * Get controlled vocabulary terms
   */
  getControlledVocabulary(vocabulary: string): string[] {
    return CONTROLLED_VOCABULARIES[vocabulary] || [];
  }

  /**
   * Validate experiment metadata against a template
   */
  validateAgainstTemplate(experiment: any, templateId: string): { valid: boolean; errors: string[] } {
    const template = METADATA_TEMPLATES.find((t: MetadataTemplate) => t.id === templateId);
    if (!template) {
      return { valid: false, errors: [`Template '${templateId}' not found`] };
    }

    const errors: string[] = [];
    const params = experiment.params ? JSON.parse(experiment.params) : {};

    for (const field of template.fields) {
      if (field.required && !(field.name in params)) {
        errors.push(`Missing required field: ${field.label}`);
      }

      if (field.name in params) {
        const value = params[field.name];

        // Type validation
        if (field.type === 'number' && typeof value !== 'number') {
          errors.push(`Field '${field.label}' must be a number`);
        }
        if (field.type === 'boolean' && typeof value !== 'boolean') {
          errors.push(`Field '${field.label}' must be a boolean`);
        }
        if (field.type === 'array' && !Array.isArray(value)) {
          errors.push(`Field '${field.label}' must be an array`);
        }

        // Controlled vocabulary validation
        if (field.type === 'controlled' && field.vocabulary) {
          const vocab = this.getControlledVocabulary(field.vocabulary);
          if (vocab.length > 0 && !vocab.includes(value)) {
            errors.push(`Field '${field.label}' must be one of: ${vocab.slice(0, 5).join(', ')}...`);
          }
        }

        // Range validation
        if (field.validation) {
          if (field.validation.min !== undefined && typeof value === 'number' && value < field.validation.min) {
            errors.push(`Field '${field.label}' must be >= ${field.validation.min}`);
          }
          if (field.validation.max !== undefined && typeof value === 'number' && value > field.validation.max) {
            errors.push(`Field '${field.label}' must be <= ${field.validation.max}`);
          }
        }
      }
    }

    return { valid: errors.length === 0, errors };
  }

  // ==================== ADDITIONAL EXPORT FORMATS ====================

  /**
   * Export experiments to JSON format with FAIR metadata
   */
  async exportToJSON(experimentIds: string[], options: Partial<ExportOptions> = {}): Promise<Buffer> {
    const experiments = await this.prisma.experiment.findMany({
      where: { id: { in: experimentIds } },
      include: {
        user: { select: { id: true, name: true, email: true } },
        protocol: true,
        attachments: options.includeAttachments ? true : false,
        signatures: options.includeSignatures ? {
          include: { user: { select: { id: true, name: true } } }
        } : false,
        comments: options.includeComments ? {
          include: { author: { select: { id: true, name: true } } }
        } : false,
      }
    });

    const output: Record<string, unknown> = {
      '@context': 'https://schema.org',
      '@type': 'Dataset',
      exportedAt: new Date().toISOString(),
      experiments: experiments.map(exp => this.formatExperimentForExport(exp, options)),
    };

    if (options.includeFAIRMetadata) {
      output.fairMetadata = this.generateFAIRMetadata(experiments, options);
    }

    return Buffer.from(JSON.stringify(output, null, 2), 'utf-8');
  }

  /**
   * Export experiments to CSV format
   */
  async exportToCSV(experimentIds: string[]): Promise<Buffer> {
    const experiments = await this.prisma.experiment.findMany({
      where: { id: { in: experimentIds } },
      include: {
        user: { select: { id: true, name: true } },
      }
    });

    // CSV header
    const headers = [
      'id', 'title', 'project', 'modality', 'status', 'version',
      'author_name', 'created_at', 'updated_at', 'results_summary', 'tags'
    ];

    // Escape CSV value
    const escapeCSV = (val: unknown): string => {
      const str = String(val ?? '');
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    const rows = experiments.map(exp => [
      exp.id,
      exp.title,
      exp.project || '',
      exp.modality,
      exp.status,
      exp.version,
      exp.user.name,
      exp.createdAt.toISOString(),
      exp.updatedAt.toISOString(),
      exp.resultsSummary || '',
      Array.isArray(exp.tags) ? exp.tags.join(';') : '',
    ].map(escapeCSV).join(','));

    const csv = [headers.join(','), ...rows].join('\n');
    return Buffer.from(csv, 'utf-8');
  }

  /**
   * Export to Parquet format (stub - requires apache-arrow package)
   * Parquet is ideal for large tabular datasets with efficient compression
   */
  async exportToParquet(experimentIds: string[]): Promise<Buffer> {
    // NOTE: Full implementation requires @apache-arrow/ts or similar package
    // This is a placeholder that returns JSON with Parquet-compatible schema info
    
    const experiments = await this.prisma.experiment.findMany({
      where: { id: { in: experimentIds } },
      include: {
        user: { select: { id: true, name: true } },
      }
    });

    // Schema definition for Parquet
    const schema = {
      fields: [
        { name: 'id', type: 'utf8', nullable: false },
        { name: 'title', type: 'utf8', nullable: false },
        { name: 'project', type: 'utf8', nullable: true },
        { name: 'modality', type: 'utf8', nullable: false },
        { name: 'status', type: 'utf8', nullable: false },
        { name: 'version', type: 'int32', nullable: false },
        { name: 'author_name', type: 'utf8', nullable: false },
        { name: 'created_at', type: 'timestamp[ms]', nullable: false },
        { name: 'updated_at', type: 'timestamp[ms]', nullable: false },
        { name: 'params', type: 'utf8', nullable: true }, // JSON string
      ]
    };

    // Data rows
    const rows = experiments.map(exp => ({
      id: exp.id,
      title: exp.title,
      project: exp.project,
      modality: exp.modality,
      status: exp.status,
      version: exp.version,
      author_name: exp.user.name,
      created_at: exp.createdAt.getTime(),
      updated_at: exp.updatedAt.getTime(),
      params: exp.params ? String(exp.params) : null,
    }));

    // Return schema + data as JSON (actual Parquet would be binary)
    const parquetPlaceholder = {
      _format: 'parquet-schema-preview',
      _note: 'Install @apache-arrow/ts for actual Parquet output',
      schema,
      rowCount: rows.length,
      data: rows,
    };

    return Buffer.from(JSON.stringify(parquetPlaceholder, null, 2), 'utf-8');
  }

  /**
   * Export to HDF5 format (stub - requires h5wasm or similar package)
   * HDF5 is ideal for hierarchical scientific data with rich metadata
   */
  async exportToHDF5(experimentIds: string[]): Promise<Buffer> {
    // NOTE: Full implementation requires h5wasm or node-hdf5 package
    // This is a placeholder that returns JSON with HDF5-compatible structure
    
    const experiments = await this.prisma.experiment.findMany({
      where: { id: { in: experimentIds } },
      include: {
        user: { select: { id: true, name: true } },
        attachments: true,
        stockUsages: {
          include: { stock: { include: { item: true } } }
        }
      }
    });

    // HDF5-like hierarchical structure
    const hdf5Structure = {
      _format: 'hdf5-structure-preview',
      _note: 'Install h5wasm for actual HDF5 output',
      attributes: {
        created: new Date().toISOString(),
        version: '1.0',
        application: 'ENotebook',
      },
      groups: experiments.map(exp => ({
        path: `/experiments/${exp.id}`,
        attributes: {
          title: exp.title,
          modality: exp.modality,
          status: exp.status,
          version: exp.version,
          author: exp.user.name,
          created: exp.createdAt.toISOString(),
          modified: exp.updatedAt.toISOString(),
        },
        datasets: [
          {
            name: 'params',
            dtype: 'string',
            data: exp.params || '{}',
          },
          {
            name: 'observations',
            dtype: 'string',
            data: exp.observations || '{}',
          },
        ],
        subgroups: [
          {
            path: 'attachments',
            datasets: exp.attachments.map(att => ({
              name: att.filename,
              dtype: 'binary',
              attributes: {
                mime: att.mime,
                size: att.size,
              }
            }))
          },
          {
            path: 'reagents',
            datasets: exp.stockUsages.map((su: any) => ({
              name: su.stock.item.name,
              dtype: 'object',
              data: {
                quantity: su.quantityUsed,
                notes: su.notes,
                lotNumber: su.stock.lotNumber,
              }
            }))
          }
        ]
      }))
    };

    return Buffer.from(JSON.stringify(hdf5Structure, null, 2), 'utf-8');
  }

  /**
   * Import .eln archive
   */
  async importEln(
    userId: string,
    archiveBuffer: Buffer
  ): Promise<{ imported: number; errors: string[] }> {
    const errors: string[] = [];
    let importedCount = 0;

    try {
      // Parse ZIP archive
      const zip = new AdmZip(archiveBuffer);
      const zipEntries = zip.getEntries();

      // Validate RO-Crate Metadata exists
      const metadataEntry = zipEntries.find(entry => entry.entryName === 'ro-crate-metadata.json');
      if (!metadataEntry) {
        throw new Error('Invalid .eln archive: Missing ro-crate-metadata.json');
      }

      // Parse and validate metadata
      let roCrateMetadata: ROCrateMetadata;
      try {
        const metadataContent = metadataEntry.getData().toString('utf8');
        roCrateMetadata = JSON.parse(metadataContent);
      } catch {
        throw new Error('Invalid .eln archive: Malformed ro-crate-metadata.json');
      }

      // Process experiment JSON files
      const experimentEntries = zipEntries.filter(
        entry => entry.entryName.startsWith('experiments/') && entry.entryName.endsWith('.json')
      );

      if (experimentEntries.length === 0) {
        errors.push('No experiments found in archive');
        return { imported: 0, errors };
      }

      for (const entry of experimentEntries) {
        try {
          const content = entry.getData().toString('utf8');
          const expData = JSON.parse(content);

          // Validate required fields
          if (!expData.title) {
            errors.push(`Skipping ${entry.entryName}: Missing required 'title' field`);
            continue;
          }

          // Create experiment with a new ID to avoid conflicts
          // Store original ID in tags for traceability
          const originalTags = expData.tags && Array.isArray(expData.tags) ? expData.tags : [];
          const importTags = [...originalTags, `import_source:${expData.id || 'unknown'}`];

          await this.prisma.experiment.create({
            data: {
              userId: userId,
              title: `${expData.title} (Imported)`,
              project: expData.project || null,
              modality: expData.modality || 'molecular_biology',
              status: 'draft', // Reset status for imported experiments
              version: 1,
              params: expData.params ?? undefined,
              observations: expData.observations ?? undefined,
              resultsSummary: expData.resultsSummary || null,
              tags: importTags
            }
          });

          // Handle attachments if present
          if (expData.attachments && Array.isArray(expData.attachments)) {
            for (const attachment of expData.attachments) {
              const attachmentPath = attachment.path || `attachments/${expData.id}/${attachment.filename}`;
              const attachmentEntry = zipEntries.find(e => e.entryName === attachmentPath);
              
              if (attachmentEntry) {
                // In production: Save attachment to blob storage and create DB record
                // For now, we log the attachment for manual processing
                console.log(`[Import] Found attachment: ${attachment.filename} for experiment ${expData.title}`);
              } else {
                errors.push(`Attachment not found in archive: ${attachmentPath}`);
              }
            }
          }

          importedCount++;
        } catch (err: unknown) {
          const errorMessage = err instanceof Error ? err.message : String(err);
          errors.push(`Failed to import ${entry.entryName}: ${errorMessage}`);
        }
      }
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      return { imported: 0, errors: [errorMessage] };
    }

    return { imported: importedCount, errors };
  }
}

// ==================== EXPRESS ROUTES ====================

export function createElnExportRoutes(prisma: PrismaClient): Router {
  const router = Router();
  const exportService = new ElnExportService(prisma);

  // Export single experiment to .eln
  router.get('/export/eln/:experimentId', async (req: Request, res: Response) => {
    const { experimentId } = req.params;
    const { attachments, signatures, comments, audit } = req.query;

    try {
      const buffer = await exportService.exportExperimentToEln(experimentId, {
        includeAttachments: attachments === 'true',
        includeSignatures: signatures !== 'false',
        includeComments: comments !== 'false',
        includeAuditTrail: audit === 'true',
      });

      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename=experiment-${experimentId}.eln`);
      res.send(buffer);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Bulk export to .eln
  router.post('/export/eln/bulk', async (req: Request, res: Response) => {
    const { experimentIds, options } = req.body;

    if (!experimentIds || !Array.isArray(experimentIds)) {
      return res.status(400).json({ error: 'experimentIds array required' });
    }

    try {
      const buffer = await exportService.exportExperimentsToEln(experimentIds, options);

      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename=eln-export-${Date.now()}.eln`);
      res.send(buffer);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Export to JSON with FAIR metadata
  router.post('/export/json', async (req: Request, res: Response) => {
    const { experimentIds, options } = req.body;

    if (!experimentIds || !Array.isArray(experimentIds)) {
      return res.status(400).json({ error: 'experimentIds array required' });
    }

    try {
      const buffer = await exportService.exportToJSON(experimentIds, {
        ...options,
        includeFAIRMetadata: options?.includeFAIRMetadata !== false,
      });

      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename=eln-export-${Date.now()}.json`);
      res.send(buffer);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Export to CSV
  router.post('/export/csv', async (req: Request, res: Response) => {
    const { experimentIds } = req.body;

    if (!experimentIds || !Array.isArray(experimentIds)) {
      return res.status(400).json({ error: 'experimentIds array required' });
    }

    try {
      const buffer = await exportService.exportToCSV(experimentIds);

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename=eln-export-${Date.now()}.csv`);
      res.send(buffer);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Export to Parquet (columnar format)
  router.post('/export/parquet', async (req: Request, res: Response) => {
    const { experimentIds } = req.body;

    if (!experimentIds || !Array.isArray(experimentIds)) {
      return res.status(400).json({ error: 'experimentIds array required' });
    }

    try {
      const buffer = await exportService.exportToParquet(experimentIds);

      // Note: Real Parquet would use application/vnd.apache.parquet
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename=eln-export-${Date.now()}.parquet.json`);
      res.send(buffer);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Export to HDF5 (hierarchical format)
  router.post('/export/hdf5', async (req: Request, res: Response) => {
    const { experimentIds } = req.body;

    if (!experimentIds || !Array.isArray(experimentIds)) {
      return res.status(400).json({ error: 'experimentIds array required' });
    }

    try {
      const buffer = await exportService.exportToHDF5(experimentIds);

      // Note: Real HDF5 would use application/x-hdf5
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename=eln-export-${Date.now()}.h5.json`);
      res.send(buffer);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get FAIR metadata for experiments
  router.post('/export/fair-metadata', async (req: Request, res: Response) => {
    const { experimentIds, fairOptions } = req.body;

    if (!experimentIds || !Array.isArray(experimentIds)) {
      return res.status(400).json({ error: 'experimentIds array required' });
    }

    try {
      const experiments = await prisma.experiment.findMany({
        where: { id: { in: experimentIds } },
        include: {
          user: { select: { id: true, name: true, email: true } },
        }
      });

      const metadata = exportService.generateFAIRMetadata(experiments, {
        fairMetadata: fairOptions,
      });

      res.json(metadata);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get metadata templates
  router.get('/export/templates', (_req: Request, res: Response) => {
    res.json({
      templates: exportService.getMetadataTemplates(),
    });
  });

  // Get template for modality
  router.get('/export/templates/:modality', (req: Request, res: Response) => {
    const template = exportService.getTemplateForModality(req.params.modality);
    if (template) {
      res.json(template);
    } else {
      res.status(404).json({ error: 'No template found for this modality' });
    }
  });

  // Validate experiment against template
  router.post('/export/validate', async (req: Request, res: Response) => {
    const { experimentId, templateId } = req.body;

    if (!experimentId || !templateId) {
      return res.status(400).json({ error: 'experimentId and templateId required' });
    }

    try {
      const experiment = await prisma.experiment.findUnique({
        where: { id: experimentId },
      });

      if (!experiment) {
        return res.status(404).json({ error: 'Experiment not found' });
      }

      const result = exportService.validateAgainstTemplate(experiment, templateId);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get controlled vocabulary
  router.get('/export/vocabulary/:name', (req: Request, res: Response) => {
    const vocab = exportService.getControlledVocabulary(req.params.name);
    if (vocab.length > 0) {
      res.json({ vocabulary: req.params.name, terms: vocab });
    } else {
      res.status(404).json({ error: 'Vocabulary not found' });
    }
  });

  // Export to PDF
  router.get('/export/pdf/:experimentId', async (req: Request, res: Response) => {
    const { experimentId } = req.params;

    // Validate experimentId is a valid UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!experimentId || !uuidRegex.test(experimentId)) {
      return res.status(400).json({ error: 'Invalid experiment ID format' });
    }

    try {
      const buffer = await exportService.generatePdf(experimentId);

      // In production with proper PDF generation:
      // res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Type', 'text/html');
      res.setHeader('Content-Disposition', `attachment; filename=experiment-${experimentId}.html`);
      res.send(buffer);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Import .eln archive
  router.post('/import/eln', async (req: Request, res: Response) => {
    const user = (req as any).user;
    const { data, filename } = req.body;

    if (!data) {
      return res.status(400).json({ error: 'No file data provided' });
    }

    try {
      // Decode base64 data to buffer
      // Handle data URI prefix if present (e.g., "data:application/zip;base64,...")
      const base64Data = data.includes(',') ? data.split(',')[1] : data;
      const buffer = Buffer.from(base64Data, 'base64');

      const result = await exportService.importEln(user.id, buffer);

      if (result.errors.length > 0 && result.imported === 0) {
        return res.status(400).json({ 
          error: 'Import failed', 
          details: result.errors 
        });
      }

      res.json({
        success: true,
        message: `Successfully imported ${result.imported} experiments`,
        warnings: result.errors.length > 0 ? result.errors : undefined
      });
    } catch (error: any) {
      console.error('ELN Import error:', error);
      res.status(500).json({ 
        error: 'Internal server error during import',
        message: error.message
      });
    }
  });

  return router;
}

export default ElnExportService;
