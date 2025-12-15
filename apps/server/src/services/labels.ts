/**
 * Label Generation & Scanning Service
 * 
 * Implements QR code and barcode generation for inventory tracking,
 * similar to Labguru's Label Wizard.
 * 
 * Features:
 * - QR code generation
 * - Simple barcode generation (Code128 using SVG)
 * - Reusable label templates
 * - Batch label printing
 * - Scan event tracking
 */

import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import QRCode from 'qrcode';

// ==================== TYPES ====================

export type LabelFormat = 'qrcode' | 'code128' | 'code39' | 'ean13' | 'datamatrix';

export interface LabelContent {
  fields: Array<{
    name: string;
    label: string;
    x: number;
    y: number;
    fontSize?: number;
    fontWeight?: string;
  }>;
  codePosition: { x: number; y: number; width: number; height: number };
  showText?: boolean;
}

export interface GeneratedLabel {
  id: string;
  templateId: string;
  entityType: string;
  entityId: string;
  barcodeData: string;
  imageDataUrl: string;
  metadata: Record<string, unknown>;
}

// Simple Code128 implementation for server-side barcode generation
const CODE128_PATTERNS: Record<string, string> = {
  '0': '11011001100', '1': '11001101100', '2': '11001100110', '3': '10010011000',
  '4': '10010001100', '5': '10001001100', '6': '10011001000', '7': '10011000100',
  '8': '10001100100', '9': '11001001000', 'A': '11001000100', 'B': '11000100100',
  'C': '10110011100', 'D': '10011011100', 'E': '10011001110', 'F': '10111001100',
  'G': '10011101100', 'H': '10011100110', 'I': '11001110010', 'J': '11001011100',
  'K': '11001001110', 'L': '11011100100', 'M': '11001110100', 'N': '11101101110',
  'O': '11101001100', 'P': '11100101100', 'Q': '11100100110', 'R': '11101100100',
  'S': '11100110100', 'T': '11100110010', 'U': '11011011000', 'V': '11011000110',
  'W': '11000110110', 'X': '10100011000', 'Y': '10001011000', 'Z': '10001000110',
  '-': '10110001000', ' ': '11000010100', START_B: '11010010000', STOP: '1100011101011'
};

function generateCode128SVG(data: string, width: number = 200, height: number = 80): string {
  // Simplified Code128B encoding
  let pattern = CODE128_PATTERNS['START_B'];
  let checksum = 104; // Start B value
  
  for (let i = 0; i < data.length; i++) {
    const char = data[i].toUpperCase();
    const charPattern = CODE128_PATTERNS[char] || CODE128_PATTERNS[' '];
    pattern += charPattern;
    
    // Calculate checksum
    const charCode = char.charCodeAt(0);
    const value = charCode >= 32 && charCode <= 126 ? charCode - 32 : 0;
    checksum += value * (i + 1);
  }
  
  // Add checksum character
  const checksumChar = checksum % 103;
  const checksumPattern = Object.values(CODE128_PATTERNS)[checksumChar] || CODE128_PATTERNS['0'];
  pattern += checksumPattern;
  pattern += CODE128_PATTERNS['STOP'];
  
  // Generate SVG
  const barWidth = width / pattern.length;
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height + 20}">`;
  svg += `<rect width="100%" height="100%" fill="white"/>`;
  
  let x = 0;
  for (const bit of pattern) {
    if (bit === '1') {
      svg += `<rect x="${x}" y="0" width="${barWidth}" height="${height}" fill="black"/>`;
    }
    x += barWidth;
  }
  
  // Add text below barcode
  svg += `<text x="${width/2}" y="${height + 15}" text-anchor="middle" font-family="monospace" font-size="12">${data}</text>`;
  svg += '</svg>';
  
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

// ==================== LABEL SERVICE ====================

export class LabelService {
  constructor(private prisma: PrismaClient) {}

  /**
   * Generate a unique barcode string for an entity
   */
  generateBarcodeData(entityType: string, entityId: string, prefix?: string): string {
    const typeCode = entityType.substring(0, 3).toUpperCase();
    const idPart = entityId.substring(0, 8).toUpperCase();
    const timestamp = Date.now().toString(36).toUpperCase();
    return `${prefix || 'ELN'}-${typeCode}-${idPart}-${timestamp}`;
  }

  /**
   * Generate QR code as data URL
   */
  async generateQRCode(data: string, options: { width?: number; margin?: number } = {}): Promise<string> {
    const { width = 200, margin = 2 } = options;
    return QRCode.toDataURL(data, {
      width,
      margin,
      errorCorrectionLevel: 'M',
    });
  }

  /**
   * Generate barcode as data URL (SVG format)
   */
  async generateBarcode(
    data: string, 
    format: Exclude<LabelFormat, 'qrcode' | 'datamatrix'> = 'code128',
    options: { width?: number; height?: number; displayValue?: boolean } = {}
  ): Promise<string> {
    const { width = 200, height = 80 } = options;
    
    // Using our simple SVG-based Code128 generator
    // For production, consider using a proper barcode library with canvas support
    return generateCode128SVG(data, width, height);
  }

  /**
   * Generate a complete label with metadata
   */
  async generateLabel(
    template: { id: string; format: string; width: number; height: number; content: LabelContent },
    entity: { type: string; id: string; data: Record<string, unknown> }
  ): Promise<GeneratedLabel> {
    const barcodeData = this.generateBarcodeData(entity.type, entity.id);
    
    let imageDataUrl: string;
    if (template.format === 'qrcode') {
      imageDataUrl = await this.generateQRCode(barcodeData, { width: template.width });
    } else {
      imageDataUrl = await this.generateBarcode(barcodeData, template.format as any, {
        height: template.height,
      });
    }

    // Create label record
    const label = await this.prisma.label.create({
      data: {
        templateId: template.id,
        entityType: entity.type,
        entityId: entity.id,
        barcodeData,
      },
    });

    return {
      id: label.id,
      templateId: template.id,
      entityType: entity.type,
      entityId: entity.id,
      barcodeData,
      imageDataUrl,
      metadata: entity.data,
    };
  }

  /**
   * Generate multiple labels at once
   */
  async generateBatchLabels(
    templateId: string,
    entities: Array<{ type: string; id: string; data: Record<string, unknown> }>
  ): Promise<GeneratedLabel[]> {
    const template = await this.prisma.labelTemplate.findUnique({
      where: { id: templateId },
    });

    if (!template) {
      throw new Error(`Template ${templateId} not found`);
    }

    const content = JSON.parse(template.content) as LabelContent;
    const labels: GeneratedLabel[] = [];

    for (const entity of entities) {
      const label = await this.generateLabel(
        { 
          id: template.id, 
          format: template.format, 
          width: template.width, 
          height: template.height,
          content,
        },
        entity
      );
      labels.push(label);
    }

    return labels;
  }

  /**
   * Look up entity by barcode scan
   */
  async lookupByBarcode(barcodeData: string): Promise<{
    label: { id: string; entityType: string; entityId: string };
    entity: unknown;
  } | null> {
    const label = await this.prisma.label.findFirst({
      where: { barcodeData },
    });

    if (!label) return null;

    let entity: unknown = null;

    // Look up the actual entity
    switch (label.entityType) {
      case 'stock':
        entity = await this.prisma.stock.findUnique({
          where: { id: label.entityId },
          include: { item: true, location: true },
        });
        break;
      case 'inventory':
        entity = await this.prisma.inventoryItem.findUnique({
          where: { id: label.entityId },
        });
        break;
      case 'experiment':
        entity = await this.prisma.experiment.findUnique({
          where: { id: label.entityId },
        });
        break;
      case 'pool':
        entity = await this.prisma.samplePool.findUnique({
          where: { id: label.entityId },
          include: { contributions: true },
        });
        break;
    }

    return {
      label: { id: label.id, entityType: label.entityType, entityId: label.entityId },
      entity,
    };
  }

  /**
   * Record a scan event
   */
  async recordScan(
    labelId: string,
    userId: string,
    action?: string,
    context?: Record<string, unknown>
  ): Promise<void> {
    await this.prisma.scanEvent.create({
      data: {
        labelId,
        scannedBy: userId,
        action,
        context: context ? JSON.stringify(context) : undefined,
      },
    });
  }

  /**
   * Get scan history for a label
   */
  async getScanHistory(labelId: string): Promise<Array<{
    id: string;
    scannedBy: string;
    scannedAt: Date;
    action: string | null;
    context: Record<string, unknown> | null;
  }>> {
    const events = await this.prisma.scanEvent.findMany({
      where: { labelId },
      orderBy: { scannedAt: 'desc' },
    });

    return events.map((e: any) => ({
      id: e.id,
      scannedBy: e.scannedBy,
      scannedAt: e.scannedAt,
      action: e.action,
      context: e.context ? JSON.parse(e.context) : null,
    }));
  }

  /**
   * Get default label templates
   */
  getDefaultTemplates(): Array<{
    name: string;
    entityType: string;
    format: LabelFormat;
    width: number;
    height: number;
    content: LabelContent;
  }> {
    return [
      {
        name: 'Stock QR Label (Small)',
        entityType: 'stock',
        format: 'qrcode',
        width: 25,
        height: 25,
        content: {
          fields: [
            { name: 'name', label: 'Item', x: 0, y: 30, fontSize: 10 },
            { name: 'lotNumber', label: 'Lot', x: 0, y: 40, fontSize: 8 },
          ],
          codePosition: { x: 0, y: 0, width: 25, height: 25 },
          showText: true,
        },
      },
      {
        name: 'Stock Barcode Label (Standard)',
        entityType: 'stock',
        format: 'code128',
        width: 50,
        height: 20,
        content: {
          fields: [
            { name: 'name', label: 'Item', x: 0, y: 0, fontSize: 10, fontWeight: 'bold' },
            { name: 'lotNumber', label: 'Lot', x: 0, y: 12, fontSize: 8 },
            { name: 'expirationDate', label: 'Exp', x: 30, y: 12, fontSize: 8 },
          ],
          codePosition: { x: 0, y: 25, width: 50, height: 15 },
          showText: true,
        },
      },
      {
        name: 'Sample Pool QR Label',
        entityType: 'pool',
        format: 'qrcode',
        width: 30,
        height: 30,
        content: {
          fields: [
            { name: 'name', label: 'Pool', x: 0, y: 35, fontSize: 10 },
            { name: 'totalVolume', label: 'Vol', x: 0, y: 45, fontSize: 8 },
          ],
          codePosition: { x: 0, y: 0, width: 30, height: 30 },
          showText: true,
        },
      },
      {
        name: 'Equipment Asset Tag',
        entityType: 'equipment',
        format: 'qrcode',
        width: 40,
        height: 40,
        content: {
          fields: [
            { name: 'name', label: 'Equipment', x: 45, y: 10, fontSize: 12, fontWeight: 'bold' },
            { name: 'serialNumber', label: 'S/N', x: 45, y: 25, fontSize: 10 },
            { name: 'location', label: 'Location', x: 45, y: 38, fontSize: 9 },
          ],
          codePosition: { x: 0, y: 0, width: 40, height: 40 },
          showText: false,
        },
      },
      {
        name: 'Experiment Sample Label',
        entityType: 'experiment',
        format: 'code128',
        width: 60,
        height: 25,
        content: {
          fields: [
            { name: 'title', label: 'Experiment', x: 0, y: 0, fontSize: 11, fontWeight: 'bold' },
            { name: 'project', label: 'Project', x: 0, y: 12, fontSize: 9 },
          ],
          codePosition: { x: 0, y: 30, width: 60, height: 20 },
          showText: true,
        },
      },
    ];
  }
}

// ==================== API ROUTES ====================

const templateSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  entityType: z.string(),
  format: z.enum(['qrcode', 'code128', 'code39', 'ean13', 'datamatrix']),
  width: z.number().positive(),
  height: z.number().positive(),
  content: z.object({
    fields: z.array(z.object({
      name: z.string(),
      label: z.string(),
      x: z.number(),
      y: z.number(),
      fontSize: z.number().optional(),
      fontWeight: z.string().optional(),
    })),
    codePosition: z.object({
      x: z.number(),
      y: z.number(),
      width: z.number(),
      height: z.number(),
    }),
    showText: z.boolean().optional(),
  }),
});

export function createLabelRoutes(prisma: PrismaClient, labelService: LabelService) {
  const router = Router();

  // Get all label templates
  router.get('/api/labels/templates', async (req, res) => {
    try {
      const templates = await prisma.labelTemplate.findMany({
        orderBy: { createdAt: 'desc' },
      });

      const parsed = templates.map((t: any) => ({
        ...t,
        content: JSON.parse(t.content),
      }));

      res.json(parsed);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch templates' });
    }
  });

  // Get default templates
  router.get('/api/labels/templates/defaults', async (_req, res) => {
    res.json(labelService.getDefaultTemplates());
  });

  // Create template
  router.post('/api/labels/templates', async (req, res) => {
    const parse = templateSchema.safeParse(req.body);
    if (!parse.success) {
      return res.status(400).json({ error: parse.error.flatten() });
    }

    const user = (req as any).user;

    try {
      const template = await prisma.labelTemplate.create({
        data: {
          name: parse.data.name,
          description: parse.data.description,
          entityType: parse.data.entityType,
          format: parse.data.format,
          width: parse.data.width,
          height: parse.data.height,
          content: JSON.stringify(parse.data.content),
          createdBy: user.id,
        },
      });

      res.status(201).json({
        ...template,
        content: JSON.parse(template.content),
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to create template' });
    }
  });

  // Generate single label
  router.post('/api/labels/generate', async (req, res) => {
    const { templateId, entityType, entityId, data } = req.body;

    if (!templateId || !entityType || !entityId) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    try {
      const template = await prisma.labelTemplate.findUnique({
        where: { id: templateId },
      });

      if (!template) {
        return res.status(404).json({ error: 'Template not found' });
      }

      const label = await labelService.generateLabel(
        {
          id: template.id,
          format: template.format,
          width: template.width,
          height: template.height,
          content: JSON.parse(template.content),
        },
        { type: entityType, id: entityId, data: data || {} }
      );

      res.json(label);
    } catch (error) {
      res.status(500).json({ error: 'Failed to generate label' });
    }
  });

  // Generate batch labels
  router.post('/api/labels/generate/batch', async (req, res) => {
    const { templateId, entities } = req.body;

    if (!templateId || !entities || !Array.isArray(entities)) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    try {
      const labels = await labelService.generateBatchLabels(templateId, entities);
      res.json(labels);
    } catch (error) {
      res.status(500).json({ error: 'Failed to generate labels' });
    }
  });

  // Scan/lookup barcode
  router.get('/api/labels/scan/:barcodeData', async (req, res) => {
    try {
      const result = await labelService.lookupByBarcode(req.params.barcodeData);
      
      if (!result) {
        return res.status(404).json({ error: 'Barcode not found' });
      }

      // Record scan
      const user = (req as any).user;
      await labelService.recordScan(result.label.id, user.id, 'lookup');

      res.json(result);
    } catch (error) {
      res.status(500).json({ error: 'Failed to lookup barcode' });
    }
  });

  // Record scan action
  router.post('/api/labels/scan', async (req, res) => {
    const { barcodeData, action, context } = req.body;

    if (!barcodeData) {
      return res.status(400).json({ error: 'Missing barcode data' });
    }

    try {
      const result = await labelService.lookupByBarcode(barcodeData);
      
      if (!result) {
        return res.status(404).json({ error: 'Barcode not found' });
      }

      const user = (req as any).user;
      await labelService.recordScan(result.label.id, user.id, action, context);

      res.json({ success: true, ...result });
    } catch (error) {
      res.status(500).json({ error: 'Failed to record scan' });
    }
  });

  // Get scan history
  router.get('/api/labels/:labelId/scans', async (req, res) => {
    try {
      const history = await labelService.getScanHistory(req.params.labelId);
      res.json(history);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch scan history' });
    }
  });

  // Get labels for entity
  router.get('/api/labels/entity/:entityType/:entityId', async (req, res) => {
    try {
      const labels = await prisma.label.findMany({
        where: {
          entityType: req.params.entityType,
          entityId: req.params.entityId,
        },
        include: { template: true },
      });

      res.json(labels);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch labels' });
    }
  });

  // Quick generate QR code (no template)
  router.post('/api/labels/qr', async (req, res) => {
    const { data, width = 200 } = req.body;

    if (!data) {
      return res.status(400).json({ error: 'Missing data' });
    }

    try {
      const imageDataUrl = await labelService.generateQRCode(data, { width });
      res.json({ imageDataUrl, data });
    } catch (error) {
      res.status(500).json({ error: 'Failed to generate QR code' });
    }
  });

  // Quick generate barcode (no template)
  router.post('/api/labels/barcode', async (req, res) => {
    const { data, format = 'code128', height = 100 } = req.body;

    if (!data) {
      return res.status(400).json({ error: 'Missing data' });
    }

    try {
      const imageDataUrl = await labelService.generateBarcode(data, format, { height });
      res.json({ imageDataUrl, data, format });
    } catch (error) {
      res.status(500).json({ error: 'Failed to generate barcode' });
    }
  });

  return router;
}

export default LabelService;
