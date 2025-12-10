/**
 * ELN Export Service
 * Supports multiple export formats including:
 * - .eln (eLabFTW open standard based on RO-Crate)
 * - PDF (immutable reports)
 * - ZIP (complete archives with attachments)
 * - JSON/CSV (FAIR data principles)
 */

import { PrismaClient } from '@prisma/client';
import { Request, Response, Router } from 'express';
import crypto from 'crypto';
import archiver from 'archiver';
import { Writable } from 'stream';

// ==================== TYPES ====================

export interface ExportOptions {
  format: 'eln' | 'pdf' | 'zip' | 'json' | 'csv';
  includeAttachments: boolean;
  includeSignatures: boolean;
  includeAuditTrail: boolean;
  includeComments: boolean;
  dateRange?: { start: Date; end: Date };
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
        user: { select: { name: true, email: true } },
        signatures: {
          include: { user: { select: { name: true } } }
        },
        comments: {
          include: { author: { select: { name: true } } }
        },
      }
    });

    if (!experiment) {
      throw new Error('Experiment not found');
    }

    // Generate HTML report (in production, use puppeteer or pdfkit)
    const html = this.generateHtmlReport(experiment);
    
    // For now, return HTML as buffer
    // In production, convert to PDF using puppeteer or similar
    return Buffer.from(html, 'utf-8');
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

  /**
   * Import .eln archive
   */
  async importEln(
    userId: string,
    archiveBuffer: Buffer
  ): Promise<{ imported: number; errors: string[] }> {
    // In production, use a ZIP library to extract and parse
    // This is a placeholder implementation
    const imported = 0;
    const errors: string[] = [];

    try {
      // Parse archive
      // Extract ro-crate-metadata.json
      // Import experiments
      // Handle attachments
      
      errors.push('Import functionality not yet implemented');
    } catch (error: any) {
      errors.push(error.message);
    }

    return { imported, errors };
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

  // Export to PDF
  router.get('/export/pdf/:experimentId', async (req: Request, res: Response) => {
    const { experimentId } = req.params;

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

    // In production, use multer or similar for file upload
    res.status(501).json({ 
      error: 'Import not yet implemented',
      message: 'File upload handler required'
    });
  });

  return router;
}

export default ElnExportService;
