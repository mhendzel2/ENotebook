/**
 * Inventory Routes Module
 * Locations, inventory items, stock, and inventory imports.
 */

import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { parse as parseCsv } from 'csv-parse/sync';
import { v4 as uuid, v5 as uuidv5 } from 'uuid';
import * as fs from 'fs';
import * as path from 'path';
import { createRequire } from 'module';

import { INVENTORY_CATEGORIES } from '@eln/shared/dist/types.js';
import type { User } from '@eln/shared/dist/types.js';

const inventoryCategoryEnum = z.enum(
  INVENTORY_CATEGORIES as unknown as [string, ...string[]]
);

const locationSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  parentId: z.string().uuid().optional(),
  temperature: z.string().optional()
});

const inventoryItemSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  category: inventoryCategoryEnum,
  catalogNumber: z.string().optional(),
  manufacturer: z.string().optional(),
  supplier: z.string().optional(),
  unit: z.string().optional(),
  properties: z.any().optional(),
  safetyInfo: z.string().optional(),
  storageConditions: z.string().optional()
});

const inventoryAttachmentSchema = z.object({
  filename: z.string().min(1).max(255),
  data: z.string().min(1),
  mime: z.string().optional()
});

const inventoryItemUpdateSchema = inventoryItemSchema.partial().refine(
  (val) => Object.keys(val).length > 0,
  { message: 'At least one field must be provided for update' }
);

const importBase64FileSchema = z.object({
  filename: z.string().min(1).max(255),
  data: z.string().min(1),
  options: z.any().optional()
});

const stockSchema = z.object({
  itemId: z.string().uuid(),
  locationId: z.string().uuid().optional(),
  lotNumber: z.string().optional(),
  quantity: z.number().positive(),
  expirationDate: z.string().optional(),
  barcode: z.string().optional(),
  notes: z.string().optional()
});

const INVENTORY_IMPORT_MAX_BYTES = 50 * 1024 * 1024; // 50MB
const INVENTORY_IMPORT_MAX_ROWS = 10000;
const IMPORTS_DIR = process.env.IMPORTS_DIR || path.join(process.cwd(), 'data', 'imports');

const INVENTORY_ATTACHMENTS_DIR = process.env.INVENTORY_ATTACHMENTS_DIR || path.join(process.cwd(), 'data', 'inventory_attachments');

const INVENTORY_ATTACHMENT_ALLOWED_IMAGE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/tiff',
  'image/bmp',
  'image/svg+xml'
];

const INVENTORY_ATTACHMENT_ALLOWED_DOCUMENT_TYPES = [
  'application/pdf',
  'text/plain',
  'application/json',
  'text/html',
  'text/markdown',
  'text/x-markdown'
];

const INVENTORY_ATTACHMENT_ALLOWED_TYPES = [
  ...INVENTORY_ATTACHMENT_ALLOWED_IMAGE_TYPES,
  ...INVENTORY_ATTACHMENT_ALLOWED_DOCUMENT_TYPES
];

if (!fs.existsSync(IMPORTS_DIR)) {
  fs.mkdirSync(IMPORTS_DIR, { recursive: true });
}

if (!fs.existsSync(INVENTORY_ATTACHMENTS_DIR)) {
  fs.mkdirSync(INVENTORY_ATTACHMENTS_DIR, { recursive: true });
}

const inventoryImportLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const userId = (req as any).user?.id;
    return userId || req.ip || 'anonymous';
  }
});

const ACCESS_IMPORT_NAMESPACE = uuidv5('eln-access-import', uuidv5.DNS);

function toDateString(value: unknown): string {
  if (!value) return '';
  if (value instanceof Date && !Number.isNaN(value.valueOf())) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return '';
    const d = new Date(trimmed);
    if (!Number.isNaN(d.valueOf())) return d.toISOString().slice(0, 10);
    return trimmed;
  }
  try {
    const d = new Date(String(value));
    if (!Number.isNaN(d.valueOf())) return d.toISOString().slice(0, 10);
  } catch {
    // ignore
  }
  return String(value);
}

function normalizeHost(host: unknown): string {
  const h = String(host ?? '').trim().toLowerCase();
  if (!h) return '';
  if (h.includes('mouse')) return 'mouse';
  if (h.includes('rabbit')) return 'rabbit';
  if (h.includes('goat')) return 'goat';
  if (h.includes('rat')) return 'rat';
  if (h.includes('donkey')) return 'donkey';
  if (h.includes('human')) return 'human';
  if (h.includes('sheep')) return 'sheep';
  if (h.includes('guinea')) return 'guinea pig';
  if (h.includes('chicken')) return 'chicken';
  return h;
}

function normalizeClonality(value: unknown): string {
  const v = String(value ?? '').trim().toLowerCase();
  if (!v) return '';
  if (v.startsWith('m')) return 'monoclonal';
  if (v.startsWith('p')) return 'polyclonal';
  if (v.includes('mono')) return 'monoclonal';
  if (v.includes('poly')) return 'polyclonal';
  return v;
}

function buildChemicalHazards(row: Record<string, any>): string {
  const labels: string[] = [];
  for (let i = 1; i <= 10; i++) {
    const key = `hd${i}`;
    const val = row[key];
    if (val === true || String(val).trim().toLowerCase() === 'true' || String(val).trim() === '1') {
      labels.push(key);
    }
  }
  return labels.join(', ');
}

async function tryQueryAll(connection: any, table: string): Promise<Record<string, any>[] | null> {
  const sanitized = sanitizeBracketIdentifier(table);
  if (!sanitized) return null;
  try {
    const rows = await connection.query(`SELECT * FROM [${sanitized}]`);
    return Array.isArray(rows) ? (rows as Record<string, any>[]) : [];
  } catch {
    return null;
  }
}

function decodeBase64ToBuffer(base64: string, maxBytes: number) {
  let buf: Buffer;
  try {
    buf = Buffer.from(base64, 'base64');
  } catch {
    return { ok: false as const, error: 'Invalid base64 data' };
  }
  if (buf.length === 0) return { ok: false as const, error: 'Empty file data' };
  if (buf.length > maxBytes) {
    return { ok: false as const, error: `File too large. Maximum size is ${Math.floor(maxBytes / (1024 * 1024))}MB` };
  }
  return { ok: true as const, buffer: buf };
}

function normalizeRecordKeys(record: Record<string, any>): Record<string, any> {
  const normalized: Record<string, any> = {};
  for (const [key, value] of Object.entries(record)) {
    normalized[String(key).trim().toLowerCase()] = value;
  }
  return normalized;
}

function getFirstField(record: Record<string, any>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (value === undefined || value === null) continue;
    const str = String(value).trim();
    if (str.length === 0) continue;
    return str;
  }
  return undefined;
}

function parseOptionalNumber(raw: unknown): number | undefined {
  if (raw === undefined || raw === null) return undefined;
  const str = String(raw).trim();
  if (!str) return undefined;
  const n = Number(str);
  if (!Number.isFinite(n)) return undefined;
  return n;
}

function sanitizeBracketIdentifier(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed.length === 0 || trimmed.length > 128) return null;
  if (!/^[A-Za-z0-9_\-\s]+$/.test(trimmed)) return null;
  return trimmed;
}

function normalizeInventoryCategory(raw: string | undefined): string {
  if (!raw) return 'reagent';
  const lowered = raw.trim().toLowerCase();
  if (!lowered) return 'reagent';

  const normalized = lowered
    .replace(/\//g, '_')
    .replace(/[\s\-]+/g, '_')
    .replace(/_+$/g, '')
    .replace(/^_+/g, '');

  const mapped = (() => {
    switch (normalized) {
      case 'reagents':
      case 'reagent':
        return 'reagent';
      case 'plasmids':
      case 'plasmid':
        return 'plasmid';
      case 'antibodies':
      case 'antibody':
        return 'antibody';
      case 'primers':
      case 'primer':
        return 'primer';
      case 'cellline':
      case 'cell_lines':
      case 'cell_line':
      case 'cellline(s)':
      case 'cell_lines(s)':
      case 'celllines':
      case 'cell_line(s)':
      case 'cell':
      case 'cellline_stock':
      case 'cell_line_stock':
        return 'cell_line';
      case 'samples':
      case 'sample':
        return 'sample';
      case 'consumables':
      case 'consumable':
        return 'consumable';
      default:
        return normalized;
    }
  })();

  return INVENTORY_CATEGORIES.includes(mapped as any) ? mapped : 'reagent';
}

function safeJoinPath(baseDir: string, ...segments: string[]): string | null {
  const joinedPath = path.join(baseDir, ...segments);
  const resolvedBase = path.resolve(baseDir);
  const resolvedPath = path.resolve(joinedPath);
  if (!resolvedPath.startsWith(resolvedBase + path.sep) && resolvedPath !== resolvedBase) {
    return null;
  }
  return resolvedPath;
}

function sanitizeFilename(filename: string): string {
  return filename
    .replace(/[/\\:*?"<>|]/g, '_')
    .replace(/\.{2,}/g, '.')
    .substring(0, 255);
}

function guessMimeType(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  const mimeMap: Record<string, string> = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.tiff': 'image/tiff',
    '.tif': 'image/tiff',
    '.bmp': 'image/bmp',
    '.svg': 'image/svg+xml',
    '.pdf': 'application/pdf',
    '.txt': 'text/plain',
    '.json': 'application/json',
    '.html': 'text/html',
    '.htm': 'text/html',
    '.md': 'text/markdown',
    '.markdown': 'text/markdown'
  };
  return mimeMap[ext] || 'application/octet-stream';
}

function getExtensionFromMime(mime: string): string {
  const extMap: Record<string, string> = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'image/tiff': '.tiff',
    'image/bmp': '.bmp',
    'image/svg+xml': '.svg',
    'application/pdf': '.pdf',
    'text/plain': '.txt',
    'application/json': '.json',
    'text/html': '.html',
    'text/markdown': '.md',
    'text/x-markdown': '.md'
  };
  return extMap[mime] || '';
}

export function createInventoryRoutes(prisma: PrismaClient): Router {
  const router = Router();

  // ==================== LOCATIONS ====================

  router.get('/locations', async (_req, res) => {
    try {
      const locations = await prisma.location.findMany({
        include: { children: true, stocks: { select: { id: true } } }
      });
      res.json(locations);
    } catch (error) {
      res.status(500).json({ error: 'Database error' });
    }
  });

  router.post('/locations', async (req, res) => {
    const parse = locationSchema.safeParse(req.body);
    if (!parse.success) {
      return res.status(400).json({ error: parse.error.flatten() });
    }
    try {
      const location = await prisma.location.create({ data: parse.data });
      res.status(201).json(location);
    } catch (error) {
      res.status(500).json({ error: 'Failed to create location' });
    }
  });

  // ==================== INVENTORY ITEMS ====================

  router.get('/inventory', async (req, res) => {
    try {
      const categoryQuery = req.query.category;
      const searchQuery = req.query.search;
      const category = typeof categoryQuery === 'string' ? categoryQuery : undefined;
      const search = typeof searchQuery === 'string' ? searchQuery : undefined;
      const where: any = {};
      if (category && INVENTORY_CATEGORIES.includes(category as any)) {
        where.category = category;
      }
      if (search && typeof search === 'string') {
        const sanitizedSearch = String(search).slice(0, 200);
        where.OR = [
          { name: { contains: sanitizedSearch } },
          { catalogNumber: { contains: sanitizedSearch } },
          { manufacturer: { contains: sanitizedSearch } }
        ];
      }
      const items = await prisma.inventoryItem.findMany({
        where,
        include: { stocks: { include: { location: true } } }
      });
      const parsedItems = items.map((item: any) => ({
        ...item,
        properties: item.properties ? JSON.parse(item.properties) : undefined
      }));
      res.json(parsedItems);
    } catch (error) {
      res.status(500).json({ error: 'Database error' });
    }
  });

  router.post('/inventory', async (req, res) => {
    const parse = inventoryItemSchema.safeParse(req.body);
    if (!parse.success) {
      return res.status(400).json({ error: parse.error.flatten() });
    }
    try {
      const { properties, ...rest } = parse.data;
      const item = await prisma.inventoryItem.create({
        data: {
          ...rest,
          properties: properties ? JSON.stringify(properties) : undefined
        }
      });
      res.status(201).json({
        ...item,
        properties: item.properties ? JSON.parse(item.properties) : undefined
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to create inventory item' });
    }
  });

  router.patch('/inventory/:id', async (req, res) => {
    const parse = inventoryItemUpdateSchema.safeParse(req.body);
    if (!parse.success) {
      return res.status(400).json({ error: parse.error.flatten() });
    }
    try {
      const existing = await prisma.inventoryItem.findUnique({ where: { id: req.params.id } });
      if (!existing) return res.status(404).json({ error: 'Item not found' });

      const { properties, ...rest } = parse.data;
      const updated = await prisma.inventoryItem.update({
        where: { id: req.params.id },
        data: {
          ...rest,
          properties: properties !== undefined ? (properties ? JSON.stringify(properties) : null) : undefined
        }
      });

      res.json({
        ...updated,
        properties: updated.properties ? JSON.parse(updated.properties) : undefined
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to update inventory item' });
    }
  });

  router.delete('/inventory/:id', async (req, res) => {
    const user = (req as any).user as User;
    try {
      if (user?.role !== 'admin' && user?.role !== 'manager') {
        return res.status(403).json({ error: 'Not authorized' });
      }

      const existing = await prisma.inventoryItem.findUnique({ where: { id: req.params.id } });
      if (!existing) return res.status(404).json({ error: 'Item not found' });

      await prisma.$transaction(async (tx: any) => {
        await tx.stock.deleteMany({ where: { itemId: req.params.id } });
        await tx.inventoryItem.delete({ where: { id: req.params.id } });
      });

      res.json({ status: 'deleted' });
    } catch (error) {
      res.status(500).json({ error: 'Failed to delete inventory item' });
    }
  });

  router.get('/inventory/:id', async (req, res) => {
    try {
      const item = await prisma.inventoryItem.findUnique({
        where: { id: req.params.id },
        include: { stocks: { include: { location: true } } }
      });
      if (!item) return res.status(404).json({ error: 'Item not found' });
      res.json({
        ...item,
        properties: item.properties ? JSON.parse(item.properties) : undefined
      });
    } catch (error) {
      res.status(500).json({ error: 'Database error' });
    }
  });

  // ==================== IMPORT: CSV ====================

  router.post('/inventory/import/csv', inventoryImportLimiter, async (req, res) => {
    const user = (req as any).user as User;
    const parse = importBase64FileSchema.safeParse(req.body);
    if (!parse.success) return res.status(400).json({ error: parse.error.flatten() });

    if (user?.role !== 'admin' && user?.role !== 'manager') {
      return res.status(403).json({
        error: 'Not authorized',
        requiredRoles: ['admin', 'manager'],
        hint: 'Log in as an admin or manager to import inventory.'
      });
    }

    const { filename, data } = parse.data;
    const ext = path.extname(filename).toLowerCase();
    if (ext !== '.csv' && ext !== '.tsv') {
      return res.status(400).json({ error: 'Only .csv or .tsv files are supported' });
    }

    const decoded = decodeBase64ToBuffer(data, INVENTORY_IMPORT_MAX_BYTES);
    if (!decoded.ok) return res.status(400).json({ error: decoded.error });

    try {
      const text = decoded.buffer.toString('utf8');
      const records = parseCsv(text, {
        columns: true,
        skip_empty_lines: true,
        relax_column_count: true,
        trim: true
      }) as Record<string, any>[];

      if (records.length > INVENTORY_IMPORT_MAX_ROWS) {
        return res.status(400).json({ error: `CSV has too many rows (${records.length}). Maximum is ${INVENTORY_IMPORT_MAX_ROWS}.` });
      }

      const summary = {
        rows: records.length,
        itemsCreated: 0,
        itemsUpdated: 0,
        stocksCreated: 0,
        warnings: [] as string[],
        errors: [] as string[]
      };

      for (let i = 0; i < records.length; i++) {
        const row = normalizeRecordKeys(records[i]);
        const name = getFirstField(row, ['name', 'item', 'itemname', 'reagent', 'material']);
        if (!name) {
          if (summary.errors.length < 25) summary.errors.push(`Row ${i + 2}: missing item name`);
          continue;
        }

        const categoryRaw = getFirstField(row, ['category', 'type']) || 'reagent';
        const category = normalizeInventoryCategory(categoryRaw);
        if (categoryRaw && category !== categoryRaw.trim().toLowerCase()) {
          const rawNormalized = categoryRaw.trim().toLowerCase();
          if (rawNormalized && rawNormalized !== category) {
            if (summary.warnings.length < 25) summary.warnings.push(`Row ${i + 2}: normalized category '${categoryRaw}' -> '${category}'`);
          }
        }

        const catalogNumber = getFirstField(row, ['catalognumber', 'catalog', 'sku', 'partnumber']);
        const manufacturer = getFirstField(row, ['manufacturer', 'mfg']);
        const supplier = getFirstField(row, ['supplier', 'vendor']);
        const unit = getFirstField(row, ['unit', 'uom']);
        const description = getFirstField(row, ['description', 'desc']);
        const safetyInfo = getFirstField(row, ['safetyinfo', 'safety', 'hazard']);
        const storageConditions = getFirstField(row, ['storageconditions', 'storage']);

        const quantity = parseOptionalNumber(getFirstField(row, ['quantity', 'qty', 'amount']));
        const lotNumber = getFirstField(row, ['lotnumber', 'lot']);
        const barcode = getFirstField(row, ['barcode']);
        const notes = getFirstField(row, ['notes', 'note']);
        const expirationDateRaw = getFirstField(row, ['expirationdate', 'expiry', 'expires']);
        const locationName = getFirstField(row, ['location', 'freezer', 'room', 'shelf']);

        const itemMatchWhere = catalogNumber
          ? { name, catalogNumber }
          : { name };

        const existing = await prisma.inventoryItem.findFirst({ where: itemMatchWhere });
        const item = existing
          ? await prisma.inventoryItem.update({
              where: { id: existing.id },
              data: {
                category,
                description: description ?? existing.description,
                catalogNumber: catalogNumber ?? existing.catalogNumber,
                manufacturer: manufacturer ?? existing.manufacturer,
                supplier: supplier ?? existing.supplier,
                unit: unit ?? existing.unit,
                safetyInfo: safetyInfo ?? existing.safetyInfo,
                storageConditions: storageConditions ?? existing.storageConditions
              }
            })
          : await prisma.inventoryItem.create({
              data: {
                name,
                category,
                description,
                catalogNumber,
                manufacturer,
                supplier,
                unit,
                safetyInfo,
                storageConditions
              }
            });

        if (existing) summary.itemsUpdated++;
        else summary.itemsCreated++;

        if (quantity !== undefined && quantity > 0) {
          let locationId: string | undefined;
          if (locationName) {
            const existingLocation = await prisma.location.findFirst({ where: { name: locationName } });
            const loc = existingLocation || (await prisma.location.create({ data: { name: locationName } }));
            locationId = loc.id;
          }

          let expirationDate: Date | undefined;
          if (expirationDateRaw) {
            const d = new Date(expirationDateRaw);
            if (!Number.isNaN(d.valueOf())) expirationDate = d;
            else if (summary.warnings.length < 25) summary.warnings.push(`Row ${i + 2}: invalid expirationDate '${expirationDateRaw}' ignored`);
          }

          try {
            await prisma.stock.create({
              data: {
                itemId: item.id,
                locationId,
                lotNumber,
                quantity,
                initialQuantity: quantity,
                expirationDate,
                barcode,
                notes
              }
            });
            summary.stocksCreated++;
          } catch (e: any) {
            if (summary.errors.length < 25) summary.errors.push(`Row ${i + 2}: failed to create stock (${e?.code || 'error'})`);
          }
        }
      }

      res.json(summary);
    } catch (error) {
      console.error('CSV import error:', error);
      res.status(500).json({ error: 'Failed to import CSV' });
    }
  });

  // ==================== IMPORT: ACCESS ====================

  router.post('/inventory/import/access', inventoryImportLimiter, async (req, res) => {
    const user = (req as any).user as User;
    const parse = importBase64FileSchema.safeParse(req.body);
    if (!parse.success) return res.status(400).json({ error: parse.error.flatten() });

    if (user?.role !== 'admin' && user?.role !== 'manager') {
      return res.status(403).json({
        error: 'Not authorized',
        requiredRoles: ['admin', 'manager'],
        hint: 'Log in as an admin or manager to import inventory.'
      });
    }

    const { filename, data, options } = parse.data;
    const ext = path.extname(filename).toLowerCase();
    if (ext !== '.mdb' && ext !== '.accdb') {
      return res.status(400).json({ error: 'Only .mdb or .accdb files are supported' });
    }

    const decoded = decodeBase64ToBuffer(data, INVENTORY_IMPORT_MAX_BYTES);
    if (!decoded.ok) return res.status(400).json({ error: decoded.error });

    const tableRequested = typeof options?.table === 'string' ? options.table : 'Inventory';
    const sanitizedTable = sanitizeBracketIdentifier(tableRequested);
    if (!sanitizedTable) return res.status(400).json({ error: 'Invalid table name' });

    const mapping = (options?.mapping && typeof options.mapping === 'object') ? options.mapping : {};
    const mappingKeys = mapping && typeof mapping === 'object' ? Object.keys(mapping as any) : [];
    // If user didn't provide a mapping and chose the default table, attempt the known ELN legacy import.
    // NOTE: this mode must NOT require a table named "Inventory" to exist.
    const shouldTryLegacyImport = (mappingKeys.length === 0) && (tableRequested.toLowerCase() === 'inventory' || tableRequested.toLowerCase() === 'auto');
    const require = createRequire(import.meta.url);

    let ADODB: any;
    try {
      ADODB = require('node-adodb');
    } catch (e) {
      return res.status(500).json({
        error: 'Access import dependency not available (node-adodb)',
        hint: 'Run server install (pnpm/npm install) and ensure dependencies are built.'
      });
    }

    const fileId = uuid();
    const importPath = path.join(IMPORTS_DIR, `${fileId}${ext}`);

    try {
      fs.writeFileSync(importPath, decoded.buffer);

      const providers: string[] = ext === '.accdb'
        ? ['Microsoft.ACE.OLEDB.12.0']
        : ['Microsoft.ACE.OLEDB.12.0', 'Microsoft.Jet.OLEDB.4.0'];

      let connection: any;
      let lastError: any;
      for (const provider of providers) {
        try {
          const connectionString = `Provider=${provider};Data Source=${importPath};Persist Security Info=False;`;
          connection = ADODB.open(connectionString);
          // Validate that the provider works. For legacy/auto mode we avoid referencing a specific table.
          if (shouldTryLegacyImport) {
            await connection.query('SELECT 1');
          } else {
            await connection.query(`SELECT TOP 1 * FROM [${sanitizedTable}]`);
          }
          lastError = null;
          break;
        } catch (e) {
          lastError = e;
        }
      }

      if (!connection) {
        return res.status(400).json({
          error: 'Unable to open Access database with available OLEDB providers',
          hint: 'Install Microsoft Access Database Engine (ACE OLEDB 12.0+) on this machine, or export your tables to CSV.',
          details: String(lastError?.message || lastError || 'unknown')
        });
      }

      if (shouldTryLegacyImport) {
        const legacyTables = {
          antibody: 'tblantibody',
          dna: 'tbldna',
          cell: 'tblcellline',
          chemical: 'tblchemical',
          mr: 'tblmr',
          oligo: 'tbloligo',
          virus: 'tblvirus',
          cmStorage: 'tblcmstorage',
          clStorage: 'tblclstorage',
          dnaStorage: 'tbldnastorage',
          antibodyStorage: 'tblstorage',
          oligoStorage: 'tbloligostorage',
          mrStorage: 'tblmrstorage',
          miscStorage: 'tblmitemsstorage'
        };

        const [abRows, dnaRows, cellRows, chemRows, mrRows, oligoRows, virusRows, cmStorageRows, clStorageRows, dnaStorageRows, abStorageRows, oligoStorageRows, mrStorageRows, miscStorageRows] = await Promise.all([
          tryQueryAll(connection, legacyTables.antibody),
          tryQueryAll(connection, legacyTables.dna),
          tryQueryAll(connection, legacyTables.cell),
          tryQueryAll(connection, legacyTables.chemical),
          tryQueryAll(connection, legacyTables.mr),
          tryQueryAll(connection, legacyTables.oligo),
          tryQueryAll(connection, legacyTables.virus),
          tryQueryAll(connection, legacyTables.cmStorage),
          tryQueryAll(connection, legacyTables.clStorage),
          tryQueryAll(connection, legacyTables.dnaStorage),
          tryQueryAll(connection, legacyTables.antibodyStorage),
          tryQueryAll(connection, legacyTables.oligoStorage),
          tryQueryAll(connection, legacyTables.mrStorage),
          tryQueryAll(connection, legacyTables.miscStorage)
        ]);

        const anyLegacyFound = [abRows, dnaRows, cellRows, chemRows, mrRows, oligoRows, virusRows, miscStorageRows].some(r => Array.isArray(r));

        if (anyLegacyFound) {
          const summary = {
            rows: 0,
            itemsCreated: 0,
            itemsUpdated: 0,
            stocksCreated: 0,
            warnings: [] as string[],
            errors: [] as string[]
          };

          const locationId = uuidv5('location:legacy-storage', ACCESS_IMPORT_NAMESPACE);
          await prisma.location.upsert({
            where: { id: locationId },
            update: { name: 'legacy-storage' },
            create: { id: locationId, name: 'legacy-storage', description: 'Imported legacy storage (from Access)' }
          });

          const createdStockForItem = new Set<string>();

          const upsertItem = async (id: string, data: any) => {
            const existing = await prisma.inventoryItem.findUnique({ where: { id } });
            await prisma.inventoryItem.upsert({
              where: { id },
              update: data,
              create: { id, ...data }
            });
            if (existing) summary.itemsUpdated++;
            else summary.itemsCreated++;
          };

          const upsertStock = async (itemId: string, qty: number) => {
            if (!Number.isFinite(qty) || qty <= 0) return;
            const stockId = uuidv5(`stock:${itemId}:${locationId}`, ACCESS_IMPORT_NAMESPACE);
            await prisma.stock.upsert({
              where: { id: stockId },
              update: { quantity: qty },
              create: {
                id: stockId,
                itemId,
                locationId,
                quantity: qty,
                initialQuantity: qty
              }
            });
            if (!createdStockForItem.has(itemId)) summary.stocksCreated++;
            createdStockForItem.add(itemId);
          };

          const normalizeLegacyRow = (r: Record<string, any>) => normalizeRecordKeys(r || {});

          // Misc items (present as storage-only rows)
          if (Array.isArray(miscStorageRows)) {
            // Each row represents one stored unit; create a single inventory item per ItemID and let stock counts handle quantities.
            summary.rows += miscStorageRows.length;
            const seen = new Set<string>();
            for (const raw of miscStorageRows) {
              const row = normalizeLegacyRow(raw);
              const legacyId = String(row.itemid ?? '').trim();
              const name = String(row.itemname ?? row.name ?? '').trim();
              if (!legacyId || !name) continue;
              if (seen.has(legacyId)) continue;
              seen.add(legacyId);

              const id = uuidv5(`tblmitems:${legacyId}`, ACCESS_IMPORT_NAMESPACE);
              const properties = {
                source: 'access',
                legacyId,
                legacyTable: 'tblmitemsstorage'
              };
              await upsertItem(id, {
                name,
                category: 'reagent',
                properties: JSON.stringify(properties)
              });
            }
          }

          // Antibodies
          if (Array.isArray(abRows)) {
            summary.rows += abRows.length;
            for (const raw of abRows) {
              const row = normalizeLegacyRow(raw);
              const legacyId = String(row.antibodyid ?? '').trim();
              const name = String(row.antibodyname ?? '').trim();
              if (!legacyId || !name) continue;

              const id = uuidv5(`tblantibody:${legacyId}`, ACCESS_IMPORT_NAMESPACE);
              const properties = {
                source: 'access',
                legacyId,
                target: String(row.antigen ?? '').trim(),
                host: normalizeHost(row.host),
                clonality: normalizeClonality(row.pm),
                isotype: String(row.class ?? '').trim(),
                conjugate: String(row.label ?? '').trim(),
                concentration: String(row.concentration ?? '').trim(),
                lotNumber: String(row.lotnumber ?? '').trim(),
                purity: String(row.purity ?? '').trim(),
                crossReactivity: String(row.crossactivity ?? '').trim(),
                reference: String(row.reference ?? '').trim(),
                investigator: String(row.investigator ?? '').trim(),
                dilutions: {
                  WB: String(row.westernc ?? '').trim(),
                  IF: String(row.confocalc ?? '').trim(),
                  FACS: String(row.facsc ?? '').trim(),
                  IHC: String(row.histoic ?? '').trim(),
                  ELISA: String(row.elisa ?? '').trim(),
                  IP: String(row.ipc ?? '').trim()
                }
              };

              await upsertItem(id, {
                name,
                category: 'antibody',
                description: String(row.note ?? '').trim() || undefined,
                catalogNumber: String(row.catalogno ?? '').trim() || undefined,
                manufacturer: String(row.company ?? '').trim() || undefined,
                properties: JSON.stringify(properties)
              });

              const tubes = parseOptionalNumber(String(row.tubes ?? '').replace(/[^0-9.]/g, ''));
              if (tubes && tubes > 0) await upsertStock(id, tubes);
            }
          }

          // Plasmids (DNA)
          if (Array.isArray(dnaRows)) {
            summary.rows += dnaRows.length;
            for (const raw of dnaRows) {
              const row = normalizeLegacyRow(raw);
              const legacyId = String(row.dnaid ?? '').trim();
              const name = String(row.dnaname ?? '').trim();
              if (!legacyId || !name) continue;
              const id = uuidv5(`tbldna:${legacyId}`, ACCESS_IMPORT_NAMESPACE);
              const properties = {
                source: 'access',
                legacyId,
                backbone: String(row.backbone ?? '').trim(),
                size: String(row.sizevector ?? '').trim(),
                insert: String(row.insert ?? '').trim(),
                insertOrigin: String(row.orginsert ?? '').trim(),
                promoter: String(row.promoter ?? '').trim(),
                promoterOrigin: String(row.originofpromoter ?? '').trim(),
                selectionMarker: String(row.drugresistance ?? '').trim(),
                codingSequence: String(row.codingseq ?? '').trim(),
                codingSequenceOrigin: String(row.originofcodingseq ?? '').trim(),
                concentration: String(row.dnaconcent ?? '').trim(),
                purity: String(row.purity ?? '').trim(),
                biosafety: String(row.biosafety ?? '').trim(),
                sequenceDate: toDateString(row.sequencedate),
                sequenceFile: String(row.seqfilename ?? '').trim(),
                mapFile: String(row.plasmidmap ?? '').trim(),
                oligosUsed: String(row.oligoused ?? '').trim(),
                lotNumber: String(row.lotno ?? '').trim(),
                constructionMethod: String(row.constructioonmethod ?? '').trim(),
                reference: String(row.reference ?? '').trim(),
                info: String(row.info ?? '').trim(),
                investigator: String(row.investigtor ?? '').trim()
              };

              await upsertItem(id, {
                name,
                category: 'plasmid',
                properties: JSON.stringify(properties)
              });
            }
          }

          // Cell lines
          if (Array.isArray(cellRows)) {
            summary.rows += cellRows.length;
            for (const raw of cellRows) {
              const row = normalizeLegacyRow(raw);
              const legacyId = String(row.celllineid ?? '').trim();
              const name = String(row.celllinename ?? row.cellname ?? row.name ?? '').trim();
              if (!legacyId || !name) continue;
              const id = uuidv5(`tblcellline:${legacyId}`, ACCESS_IMPORT_NAMESPACE);
              const properties = {
                source: 'access',
                legacyId,
                organism: String(row.species ?? '').trim(),
                cellType: String(row.celltype ?? '').trim(),
                medium: String(row.medium ?? '').trim(),
                supplements: String(row.mediumspecial ?? '').trim(),
                passageNumber: String(row.passageno ?? '').trim(),
                parentalCell: String(row.parentalcell ?? '').trim(),
                growthCondition: String(row.growthcondition ?? '').trim(),
                obtainedFrom: String(row.obtainfrom ?? '').trim(),
                accessionNumber: String(row.acctno ?? '').trim(),
                plasmids: [row.plasmid1, row.plasmid2, row.plasmid3].map(v => String(v ?? '').trim()).filter(Boolean).join(', '),
                selectionMarkers: [row.selection1, row.selection2, row.selection3].map(v => String(v ?? '').trim()).filter(Boolean).join(', '),
                reference: String(row.reference ?? '').trim(),
                notes: String(row.note ?? '').trim(),
                investigator: String(row.investigator ?? '').trim(),
                createdBy: String(row.createdby ?? '').trim(),
                modifiedBy: String(row.modifyby ?? '').trim()
              };
              await upsertItem(id, {
                name,
                category: 'cell_line',
                properties: JSON.stringify(properties)
              });
            }
          }

          // Chemicals (reagents)
          if (Array.isArray(chemRows)) {
            summary.rows += chemRows.length;
            for (const raw of chemRows) {
              const row = normalizeLegacyRow(raw);
              const legacyId = String(row.cmid ?? '').trim();
              const name = String(row.cmname ?? '').trim();
              if (!legacyId || !name) continue;
              const id = uuidv5(`tblchemical:${legacyId}`, ACCESS_IMPORT_NAMESPACE);
              const properties = {
                source: 'access',
                legacyId,
                itemType: 'chemical',
                stockConcentration: String(row.stockconcentration ?? '').trim(),
                workingConcentration: String(row.workconcentration ?? '').trim(),
                molecularWeight: String(row.fw ?? '').trim(),
                casNo: String(row.casno ?? '').trim(),
                lotNumber: String(row.lotnumber ?? '').trim(),
                caution: String(row.caution ?? '').trim(),
                activity: String(row.activity ?? '').trim(),
                inhibitor: String(row.inhibitor ?? '').trim(),
                purchaseDate: toDateString(row.purchasedate),
                dateOpened: toDateString(row.dateopen),
                msdsDate: toDateString(row.msdsdate),
                alternateNames: String(row.altname ?? '').trim(),
                amount: String(row.amount ?? '').trim(),
                comments: String(row.comments ?? '').trim(),
                hazards: buildChemicalHazards(row),
                path: String(row.path ?? '').trim()
              };
              await upsertItem(id, {
                name,
                category: 'reagent',
                catalogNumber: String(row.catalogno ?? '').trim() || undefined,
                manufacturer: String(row.company ?? '').trim() || undefined,
                properties: JSON.stringify(properties)
              });
            }
          }

          // Molecular reagents (reagents)
          if (Array.isArray(mrRows)) {
            summary.rows += mrRows.length;
            for (const raw of mrRows) {
              const row = normalizeLegacyRow(raw);
              const legacyId = String(row.mrid ?? '').trim();
              const name = String(row.mrname ?? '').trim();
              if (!legacyId || !name) continue;
              const id = uuidv5(`tblmr:${legacyId}`, ACCESS_IMPORT_NAMESPACE);
              const properties = {
                source: 'access',
                legacyId,
                itemType: 'molecular_reagent',
                components: String(row.components ?? '').trim(),
                concentration: String(row.concentration ?? '').trim(),
                workBuffer: String(row.workbuffer ?? '').trim(),
                amount: String(row.amount ?? '').trim(),
                expirationDate: toDateString(row.expdate),
                lotNumber: String(row.lotno ?? '').trim(),
                reference: String(row.reference ?? '').trim(),
                notes: String(row.notes ?? '').trim()
              };
              await upsertItem(id, {
                name,
                category: 'reagent',
                description: String(row.description ?? '').trim() || undefined,
                catalogNumber: String(row.catalogno ?? '').trim() || undefined,
                manufacturer: String(row.company ?? '').trim() || undefined,
                properties: JSON.stringify(properties)
              });
            }
          }

          // Primers
          if (Array.isArray(oligoRows)) {
            summary.rows += oligoRows.length;
            for (const raw of oligoRows) {
              const row = normalizeLegacyRow(raw);
              const legacyId = String(row.oligoid ?? '').trim();
              const name = String(row.oligoname ?? row.name ?? '').trim();
              if (!legacyId || !name) continue;
              const id = uuidv5(`tbloligo:${legacyId}`, ACCESS_IMPORT_NAMESPACE);
              const properties = {
                source: 'access',
                legacyId,
                sequence: String(row.sequence ?? '').trim(),
                length: row.length,
                tm: row.tm,
                alternateName: String(row.alternatename ?? '').trim(),
                modifications: {
                  threePrime: String(row.modifications ?? '').trim()
                }
              };
              await upsertItem(id, {
                name,
                category: 'primer',
                properties: JSON.stringify(properties)
              });
            }
          }

          // Virus samples
          if (Array.isArray(virusRows)) {
            summary.rows += virusRows.length;
            for (const raw of virusRows) {
              const row = normalizeLegacyRow(raw);
              const legacyId = String(row.virusid ?? '').trim();
              const name = String(row.virusname ?? row.name ?? '').trim();
              if (!legacyId || !name) continue;
              const id = uuidv5(`tblvirus:${legacyId}`, ACCESS_IMPORT_NAMESPACE);
              const properties = {
                source: 'access',
                legacyId,
                backbone: String(row.backbone ?? '').trim(),
                helperVirus: String(row.helpervirus ?? '').trim(),
                promoter: String(row.promoter ?? '').trim(),
                codingSequence: String(row.codingseq ?? '').trim(),
                pfu: String(row.pfu ?? '').trim(),
                particles: String(row.particles ?? '').trim(),
                purity: String(row.purity ?? '').trim(),
                sourcePlaque: String(row.sourceplaque ?? '').trim(),
                oligosUsed: String(row.oligoused ?? '').trim(),
                sequenceDate: toDateString(row.sequencedate),
                sequenceFile: String(row.seqfilename ?? '').trim(),
                virusMap: String(row.virusmap ?? '').trim(),
                reference: String(row.reference ?? '').trim(),
                lotNumber: String(row.lotno ?? '').trim(),
                investigator: String(row.investigator ?? '').trim()
              };
              await upsertItem(id, {
                name,
                category: 'sample',
                properties: JSON.stringify(properties)
              });
            }
          }

          // Storage-derived stock counts
          const countBy = (rows: Record<string, any>[] | null, key: string): Map<string, number> => {
            const m = new Map<string, number>();
            if (!Array.isArray(rows)) return m;
            for (const raw of rows) {
              const row = normalizeLegacyRow(raw);
              const id = String((row as any)[key] ?? '').trim();
              if (!id) continue;
              m.set(id, (m.get(id) || 0) + 1);
            }
            return m;
          };

          const cmCounts = countBy(cmStorageRows, 'cmid');
          const clCounts = countBy(clStorageRows, 'celllineid');
          const dnaCounts = countBy(dnaStorageRows, 'dnaid');
          const abCounts = countBy(abStorageRows, 'antibodyid');
          const oligoCounts = countBy(oligoStorageRows, 'oligoid');
          const mrCounts = countBy(mrStorageRows, 'mrid');
          const miscCounts = countBy(miscStorageRows, 'itemid');

          for (const [legacyId, qty] of cmCounts.entries()) {
            const itemId = uuidv5(`tblchemical:${legacyId}`, ACCESS_IMPORT_NAMESPACE);
            await upsertStock(itemId, qty);
          }
          for (const [legacyId, qty] of clCounts.entries()) {
            const itemId = uuidv5(`tblcellline:${legacyId}`, ACCESS_IMPORT_NAMESPACE);
            await upsertStock(itemId, qty);
          }
          for (const [legacyId, qty] of dnaCounts.entries()) {
            const itemId = uuidv5(`tbldna:${legacyId}`, ACCESS_IMPORT_NAMESPACE);
            await upsertStock(itemId, qty);
          }

          for (const [legacyId, qty] of abCounts.entries()) {
            const itemId = uuidv5(`tblantibody:${legacyId}`, ACCESS_IMPORT_NAMESPACE);
            await upsertStock(itemId, qty);
          }
          for (const [legacyId, qty] of oligoCounts.entries()) {
            const itemId = uuidv5(`tbloligo:${legacyId}`, ACCESS_IMPORT_NAMESPACE);
            await upsertStock(itemId, qty);
          }
          for (const [legacyId, qty] of mrCounts.entries()) {
            const itemId = uuidv5(`tblmr:${legacyId}`, ACCESS_IMPORT_NAMESPACE);
            await upsertStock(itemId, qty);
          }
          for (const [legacyId, qty] of miscCounts.entries()) {
            const itemId = uuidv5(`tblmitems:${legacyId}`, ACCESS_IMPORT_NAMESPACE);
            await upsertStock(itemId, qty);
          }

          // Default stock = 1 for imported legacy items with no storage-derived stock.
          const allImportedItemIds = new Set<string>();
          if (Array.isArray(chemRows)) for (const raw of chemRows) { const row = normalizeLegacyRow(raw); const legacyId = String(row.cmid ?? '').trim(); if (legacyId) allImportedItemIds.add(uuidv5(`tblchemical:${legacyId}`, ACCESS_IMPORT_NAMESPACE)); }
          if (Array.isArray(mrRows)) for (const raw of mrRows) { const row = normalizeLegacyRow(raw); const legacyId = String(row.mrid ?? '').trim(); if (legacyId) allImportedItemIds.add(uuidv5(`tblmr:${legacyId}`, ACCESS_IMPORT_NAMESPACE)); }
          if (Array.isArray(abRows)) for (const raw of abRows) { const row = normalizeLegacyRow(raw); const legacyId = String(row.antibodyid ?? '').trim(); if (legacyId) allImportedItemIds.add(uuidv5(`tblantibody:${legacyId}`, ACCESS_IMPORT_NAMESPACE)); }
          if (Array.isArray(dnaRows)) for (const raw of dnaRows) { const row = normalizeLegacyRow(raw); const legacyId = String(row.dnaid ?? '').trim(); if (legacyId) allImportedItemIds.add(uuidv5(`tbldna:${legacyId}`, ACCESS_IMPORT_NAMESPACE)); }
          if (Array.isArray(cellRows)) for (const raw of cellRows) { const row = normalizeLegacyRow(raw); const legacyId = String(row.celllineid ?? '').trim(); if (legacyId) allImportedItemIds.add(uuidv5(`tblcellline:${legacyId}`, ACCESS_IMPORT_NAMESPACE)); }
          if (Array.isArray(oligoRows)) for (const raw of oligoRows) { const row = normalizeLegacyRow(raw); const legacyId = String(row.oligoid ?? '').trim(); if (legacyId) allImportedItemIds.add(uuidv5(`tbloligo:${legacyId}`, ACCESS_IMPORT_NAMESPACE)); }
          if (Array.isArray(virusRows)) for (const raw of virusRows) { const row = normalizeLegacyRow(raw); const legacyId = String(row.virusid ?? '').trim(); if (legacyId) allImportedItemIds.add(uuidv5(`tblvirus:${legacyId}`, ACCESS_IMPORT_NAMESPACE)); }

          for (const itemId of allImportedItemIds) {
            if (!createdStockForItem.has(itemId)) {
              await upsertStock(itemId, 1);
            }
          }

          return res.json(summary);
        }
      }

      if (shouldTryLegacyImport) {
        return res.status(400).json({
          error: 'No supported legacy inventory tables found in this Access database',
          hint: 'If this is not an ELN legacy inventory database, specify a table name and mapping, or export to CSV.'
        });
      }

      const rows = (await connection.query(`SELECT * FROM [${sanitizedTable}]`)) as Record<string, any>[];
      if (rows.length > INVENTORY_IMPORT_MAX_ROWS) {
        return res.status(400).json({ error: `Access table has too many rows (${rows.length}). Maximum is ${INVENTORY_IMPORT_MAX_ROWS}.` });
      }

      const summary = {
        rows: rows.length,
        itemsCreated: 0,
        itemsUpdated: 0,
        stocksCreated: 0,
        warnings: [] as string[],
        errors: [] as string[]
      };

      for (let i = 0; i < rows.length; i++) {
        const rowRaw = rows[i] || {};
        const row = normalizeRecordKeys(rowRaw);

        const nameKey = typeof (mapping as any)?.name === 'string' ? (mapping as any).name : undefined;
        const categoryKey = typeof (mapping as any)?.category === 'string' ? (mapping as any).category : undefined;
        const quantityKey = typeof (mapping as any)?.quantity === 'string' ? (mapping as any).quantity : undefined;
        const unitKey = typeof (mapping as any)?.unit === 'string' ? (mapping as any).unit : undefined;
        const locationKey = typeof (mapping as any)?.location === 'string' ? (mapping as any).location : undefined;
        const catalogKey = typeof (mapping as any)?.catalogNumber === 'string' ? (mapping as any).catalogNumber : undefined;
        const manufacturerKey = typeof (mapping as any)?.manufacturer === 'string' ? (mapping as any).manufacturer : undefined;
        const supplierKey = typeof (mapping as any)?.supplier === 'string' ? (mapping as any).supplier : undefined;
        const lotKey = typeof (mapping as any)?.lotNumber === 'string' ? (mapping as any).lotNumber : undefined;
        const barcodeKey = typeof (mapping as any)?.barcode === 'string' ? (mapping as any).barcode : undefined;
        const expiryKey = typeof (mapping as any)?.expirationDate === 'string' ? (mapping as any).expirationDate : undefined;
        const notesKey = typeof (mapping as any)?.notes === 'string' ? (mapping as any).notes : undefined;
        const descKey = typeof (mapping as any)?.description === 'string' ? (mapping as any).description : undefined;

        const name = nameKey ? getFirstField(row, [String(nameKey).toLowerCase()]) : getFirstField(row, ['name', 'item', 'itemname']);
        if (!name) {
          if (summary.errors.length < 25) summary.errors.push(`Row ${i + 2}: missing item name`);
          continue;
        }

        const categoryRaw = (categoryKey
          ? (getFirstField(row, [String(categoryKey).toLowerCase()]) || 'reagent')
          : (getFirstField(row, ['category', 'type']) || 'reagent')
        );
        const category = normalizeInventoryCategory(categoryRaw);

        const catalogNumber = catalogKey ? getFirstField(row, [String(catalogKey).toLowerCase()]) : getFirstField(row, ['catalognumber', 'catalog', 'sku']);
        const manufacturer = manufacturerKey ? getFirstField(row, [String(manufacturerKey).toLowerCase()]) : getFirstField(row, ['manufacturer', 'mfg']);
        const supplier = supplierKey ? getFirstField(row, [String(supplierKey).toLowerCase()]) : getFirstField(row, ['supplier', 'vendor']);
        const unit = unitKey ? getFirstField(row, [String(unitKey).toLowerCase()]) : getFirstField(row, ['unit', 'uom']);
        const description = descKey ? getFirstField(row, [String(descKey).toLowerCase()]) : getFirstField(row, ['description', 'desc']);

        const quantityRaw = quantityKey ? getFirstField(row, [String(quantityKey).toLowerCase()]) : getFirstField(row, ['quantity', 'qty', 'amount']);
        const quantity = parseOptionalNumber(quantityRaw);

        const locationName = locationKey ? getFirstField(row, [String(locationKey).toLowerCase()]) : getFirstField(row, ['location', 'freezer', 'room', 'shelf']);
        const lotNumber = lotKey ? getFirstField(row, [String(lotKey).toLowerCase()]) : getFirstField(row, ['lotnumber', 'lot']);
        const barcode = barcodeKey ? getFirstField(row, [String(barcodeKey).toLowerCase()]) : getFirstField(row, ['barcode']);
        const notes = notesKey ? getFirstField(row, [String(notesKey).toLowerCase()]) : getFirstField(row, ['notes', 'note']);
        const expirationDateRaw = expiryKey ? getFirstField(row, [String(expiryKey).toLowerCase()]) : getFirstField(row, ['expirationdate', 'expiry', 'expires']);

        const itemMatchWhere = catalogNumber
          ? { name, catalogNumber }
          : { name };

        const existing = await prisma.inventoryItem.findFirst({ where: itemMatchWhere });
        const item = existing
          ? await prisma.inventoryItem.update({
              where: { id: existing.id },
              data: {
                category,
                description: description ?? existing.description,
                catalogNumber: catalogNumber ?? existing.catalogNumber,
                manufacturer: manufacturer ?? existing.manufacturer,
                supplier: supplier ?? existing.supplier,
                unit: unit ?? existing.unit
              }
            })
          : await prisma.inventoryItem.create({
              data: {
                name,
                category,
                description,
                catalogNumber,
                manufacturer,
                supplier,
                unit
              }
            });

        if (existing) summary.itemsUpdated++;
        else summary.itemsCreated++;

        if (quantity !== undefined && quantity > 0) {
          let locationId: string | undefined;
          if (locationName) {
            const existingLocation = await prisma.location.findFirst({ where: { name: locationName } });
            const loc = existingLocation || (await prisma.location.create({ data: { name: locationName } }));
            locationId = loc.id;
          }

          let expirationDate: Date | undefined;
          if (expirationDateRaw) {
            const d = new Date(expirationDateRaw);
            if (!Number.isNaN(d.valueOf())) expirationDate = d;
            else if (summary.warnings.length < 25) summary.warnings.push(`Row ${i + 2}: invalid expirationDate '${expirationDateRaw}' ignored`);
          }

          try {
            await prisma.stock.create({
              data: {
                itemId: item.id,
                locationId,
                lotNumber,
                quantity,
                initialQuantity: quantity,
                expirationDate,
                barcode,
                notes
              }
            });
            summary.stocksCreated++;
          } catch (e: any) {
            if (summary.errors.length < 25) summary.errors.push(`Row ${i + 2}: failed to create stock (${e?.code || 'error'})`);
          }
        }
      }

      res.json(summary);
    } catch (error) {
      console.error('Access import error:', error);
      res.status(500).json({ error: 'Failed to import Access database' });
    } finally {
      try {
        if (fs.existsSync(importPath)) fs.unlinkSync(importPath);
      } catch {
        // ignore cleanup errors
      }
    }
  });

  // ==================== STOCK ====================

  // ==================== INVENTORY ATTACHMENTS ====================

  router.post('/inventory/:itemId/attachments', async (req, res) => {
    const user = (req as any).user as User;
    const itemId = req.params.itemId;
    const parse = inventoryAttachmentSchema.safeParse(req.body);
    if (!parse.success) {
      return res.status(400).json({ error: parse.error.flatten() });
    }

    if (!z.string().uuid().safeParse(itemId).success) {
      return res.status(400).json({ error: 'Invalid item ID' });
    }

    try {
      const item = await prisma.inventoryItem.findUnique({ where: { id: itemId } });
      if (!item) return res.status(404).json({ error: 'Item not found' });

      const safeFilename = sanitizeFilename(parse.data.filename);
      const mimeType = parse.data.mime || guessMimeType(safeFilename);

      if (!INVENTORY_ATTACHMENT_ALLOWED_TYPES.includes(mimeType)) {
        return res.status(400).json({
          error: `File type not allowed: ${mimeType}`,
          allowedTypes: INVENTORY_ATTACHMENT_ALLOWED_TYPES
        });
      }

      const decoded = decodeBase64ToBuffer(parse.data.data, INVENTORY_IMPORT_MAX_BYTES);
      if (!decoded.ok) return res.status(400).json({ error: decoded.error });

      const attachmentId = uuid();
      const ext = path.extname(safeFilename) || getExtensionFromMime(mimeType);

      const itemDir = safeJoinPath(INVENTORY_ATTACHMENTS_DIR, itemId);
      if (!itemDir) return res.status(400).json({ error: 'Invalid item attachment path' });
      if (!fs.existsSync(itemDir)) fs.mkdirSync(itemDir, { recursive: true });

      const filePath = safeJoinPath(itemDir, `${attachmentId}${ext}`);
      const metaPath = safeJoinPath(itemDir, `${attachmentId}.json`);
      if (!filePath || !metaPath) return res.status(400).json({ error: 'Invalid attachment path' });

      fs.writeFileSync(filePath, decoded.buffer);
      fs.writeFileSync(metaPath, JSON.stringify({
        id: attachmentId,
        filename: safeFilename,
        mime: mimeType,
        size: decoded.buffer.length,
        ext,
        uploadedAt: new Date().toISOString(),
        uploadedBy: user?.id
      }));

      res.status(201).json({
        id: attachmentId,
        filename: safeFilename,
        mime: mimeType,
        size: decoded.buffer.length,
        url: `/inventory/${itemId}/attachments/${attachmentId}`
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to upload inventory attachment' });
    }
  });

  router.get('/inventory/:itemId/attachments/:attachmentId', async (req, res) => {
    const itemId = req.params.itemId;
    const attachmentId = req.params.attachmentId;

    if (!z.string().uuid().safeParse(itemId).success || !z.string().uuid().safeParse(attachmentId).success) {
      return res.status(400).json({ error: 'Invalid attachment ID' });
    }

    try {
      const itemDir = safeJoinPath(INVENTORY_ATTACHMENTS_DIR, itemId);
      if (!itemDir) return res.status(400).json({ error: 'Invalid attachment path' });

      const metaPath = safeJoinPath(itemDir, `${attachmentId}.json`);
      if (!metaPath || !fs.existsSync(metaPath)) {
        return res.status(404).json({ error: 'Attachment not found' });
      }

      const metaRaw = fs.readFileSync(metaPath, 'utf8');
      const meta = JSON.parse(metaRaw || '{}') as { filename?: string; mime?: string; ext?: string };
      const ext = typeof meta.ext === 'string' ? meta.ext : '';
      const filePath = safeJoinPath(itemDir, `${attachmentId}${ext}`);
      if (!filePath || !fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'Attachment file not found' });
      }

      const filename = typeof meta.filename === 'string' ? meta.filename : `${attachmentId}${ext}`;
      const mime = typeof meta.mime === 'string' ? meta.mime : guessMimeType(filename);
      res.setHeader('Content-Type', mime);
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      fs.createReadStream(filePath).pipe(res);
    } catch (error) {
      res.status(500).json({ error: 'Failed to download attachment' });
    }
  });

  router.get('/stock', async (req, res) => {
    try {
      const { itemId, locationId, status } = req.query;
      const where: any = {};
      if (itemId) where.itemId = itemId;
      if (locationId) where.locationId = locationId;
      if (status) where.status = status;

      const stocks = await prisma.stock.findMany({
        where,
        include: { item: true, location: true }
      });
      res.json(stocks);
    } catch (error) {
      res.status(500).json({ error: 'Database error' });
    }
  });

  router.post('/stock', async (req, res) => {
    const parse = stockSchema.safeParse(req.body);
    if (!parse.success) {
      return res.status(400).json({ error: parse.error.flatten() });
    }
    try {
      const { expirationDate, ...rest } = parse.data;
      const stock = await prisma.stock.create({
        data: {
          ...rest,
          initialQuantity: rest.quantity,
          expirationDate: expirationDate ? new Date(expirationDate) : undefined
        },
        include: { item: true, location: true }
      });
      res.status(201).json(stock);
    } catch (error) {
      res.status(500).json({ error: 'Failed to create stock' });
    }
  });

  router.patch('/stock/:id', async (req, res) => {
    const { quantity, status, locationId, notes } = req.body;
    try {
      const stock = await prisma.stock.update({
        where: { id: req.params.id },
        data: { quantity, status, locationId, notes },
        include: { item: true, location: true }
      });

      if (stock.quantity === 0 && stock.status !== 'empty') {
        await prisma.stock.update({
          where: { id: req.params.id },
          data: { status: 'empty' }
        });
      } else if (stock.quantity < stock.initialQuantity * 0.1 && stock.status === 'available') {
        await prisma.stock.update({
          where: { id: req.params.id },
          data: { status: 'low' }
        });
        const managers = await prisma.user.findMany({ where: { role: 'manager' } });
        for (const manager of managers) {
          await prisma.notification.create({
            data: {
              userId: manager.id,
              type: 'stock_low',
              title: 'Low Stock Alert',
              message: `Stock for ${stock.item.name} is running low`,
              entityType: 'stock',
              entityId: stock.id
            }
          });
        }
      }

      res.json(stock);
    } catch (error) {
      res.status(500).json({ error: 'Failed to update stock' });
    }
  });

  return router;
}
