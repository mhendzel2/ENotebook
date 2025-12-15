/**
 * Inventory Routes Module
 * Locations, inventory items, stock, and inventory imports.
 */

import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { parse as parseCsv } from 'csv-parse/sync';
import { v4 as uuid } from 'uuid';
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

if (!fs.existsSync(IMPORTS_DIR)) {
  fs.mkdirSync(IMPORTS_DIR, { recursive: true });
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
      const parsedItems = items.map(item => ({
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

      await prisma.$transaction(async (tx) => {
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
      return res.status(403).json({ error: 'Not authorized' });
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

        const categoryRaw = (getFirstField(row, ['category', 'type']) || 'reagent').toLowerCase();
        const category = INVENTORY_CATEGORIES.includes(categoryRaw as any) ? (categoryRaw as any) : ('reagent' as any);
        if (categoryRaw && categoryRaw !== category) {
          if (summary.warnings.length < 25) summary.warnings.push(`Row ${i + 2}: unknown category '${categoryRaw}', defaulted to 'reagent'`);
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
      return res.status(403).json({ error: 'Not authorized' });
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
          await connection.query(`SELECT TOP 1 * FROM [${sanitizedTable}]`);
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
        ).toLowerCase();
        const category = INVENTORY_CATEGORIES.includes(categoryRaw as any) ? (categoryRaw as any) : ('reagent' as any);

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
