/**
 * Attachment Upload Routes
 * Handles file uploads for experiments including images and spreadsheets
 */

import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { v4 as uuid, validate as uuidValidate } from 'uuid';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

// Rate limiting configuration (simple in-memory implementation)
interface RateLimitEntry {
  count: number;
  resetTime: number;
}
const rateLimitMap = new Map<string, RateLimitEntry>();
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 30; // 30 requests per minute per user

function checkRateLimit(userId: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(userId);
  
  if (!entry || now > entry.resetTime) {
    rateLimitMap.set(userId, { count: 1, resetTime: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  
  if (entry.count >= RATE_LIMIT_MAX_REQUESTS) {
    return false;
  }
  
  entry.count++;
  return true;
}

/**
 * Validates that a path segment is safe (no path traversal)
 */
function isValidPathSegment(segment: string): boolean {
  if (!segment) return false;
  // Must be a valid UUID to prevent path traversal
  if (!uuidValidate(segment)) return false;
  // Double-check: no path separators or traversal patterns
  if (segment.includes('/') || segment.includes('\\') || segment.includes('..')) return false;
  return true;
}

/**
 * Safely joins paths and validates the result stays within DATA_DIR
 */
function safeJoinPath(baseDir: string, ...segments: string[]): string | null {
  const joinedPath = path.join(baseDir, ...segments);
  const resolvedBase = path.resolve(baseDir);
  const resolvedPath = path.resolve(joinedPath);
  
  // Ensure resolved path is within base directory
  if (!resolvedPath.startsWith(resolvedBase + path.sep) && resolvedPath !== resolvedBase) {
    return null;
  }
  
  return resolvedPath;
}

// Allowed MIME types for images and spreadsheets
const ALLOWED_IMAGE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/tiff',
  'image/bmp',
  'image/svg+xml'
];

const ALLOWED_SPREADSHEET_TYPES = [
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
  'application/csv',
  'text/tab-separated-values',
  'application/vnd.oasis.opendocument.spreadsheet'
];

const ALLOWED_DOCUMENT_TYPES = [
  'application/pdf',
  'text/plain',
  'application/json'
];

const ALL_ALLOWED_TYPES = [
  ...ALLOWED_IMAGE_TYPES,
  ...ALLOWED_SPREADSHEET_TYPES,
  ...ALLOWED_DOCUMENT_TYPES
];

// Max file size: 50MB
const MAX_FILE_SIZE = 50 * 1024 * 1024;

// Data directory for attachments
const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data', 'attachments');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

export function createAttachmentRoutes(prisma: PrismaClient): Router {
  const router = Router();

  /**
   * Upload attachment to experiment
   * Accepts base64 encoded file data or multipart form data
   */
  router.post('/experiments/:experimentId/attachments', async (req: Request, res: Response) => {
    const user = (req as any).user;
    const { experimentId } = req.params;
    const { filename, mime, data, description } = req.body;

    try {
      // Rate limiting check
      if (!checkRateLimit(user?.id || req.ip || 'anonymous')) {
        return res.status(429).json({ error: 'Too many requests. Please try again later.' });
      }

      // Validate experimentId format to prevent path traversal
      if (!isValidPathSegment(experimentId)) {
        return res.status(400).json({ error: 'Invalid experiment ID format' });
      }

      // Validate experiment exists and user has access
      const experiment = await prisma.experiment.findUnique({
        where: { id: experimentId }
      });

      if (!experiment) {
        return res.status(404).json({ error: 'Experiment not found' });
      }

      // Check authorization
      const canEdit = user.role === 'manager' || user.role === 'admin' || experiment.userId === user.id;
      if (!canEdit) {
        return res.status(403).json({ error: 'Not authorized to add attachments to this experiment' });
      }

      // Validate required fields
      if (!filename || !data) {
        return res.status(400).json({ error: 'filename and data are required' });
      }

      // Validate MIME type
      const mimeType = mime || guessMimeType(filename);
      if (!ALL_ALLOWED_TYPES.includes(mimeType)) {
        return res.status(400).json({ 
          error: `File type not allowed: ${mimeType}`,
          allowedTypes: ALL_ALLOWED_TYPES
        });
      }

      // Decode base64 data
      let fileBuffer: Buffer;
      try {
        fileBuffer = Buffer.from(data, 'base64');
      } catch {
        return res.status(400).json({ error: 'Invalid base64 data' });
      }

      // Validate file size
      if (fileBuffer.length > MAX_FILE_SIZE) {
        return res.status(400).json({ 
          error: `File too large. Maximum size is ${MAX_FILE_SIZE / (1024 * 1024)}MB` 
        });
      }

      // Generate unique filename and path
      const attachmentId = uuid();
      const ext = path.extname(filename) || getExtensionFromMime(mimeType);
      const safeFilename = sanitizeFilename(filename);
      // Use UUID for storage path (no user-controlled content in path)
      const storagePath = `${experimentId}/${attachmentId}${ext}`;
      
      // Safely construct full path with validation
      const fullPath = safeJoinPath(DATA_DIR, experimentId, `${attachmentId}${ext}`);
      if (!fullPath) {
        return res.status(400).json({ error: 'Invalid path construction' });
      }

      // Ensure experiment directory exists (using safe path)
      const expDir = safeJoinPath(DATA_DIR, experimentId);
      if (!expDir) {
        return res.status(400).json({ error: 'Invalid directory path' });
      }
      if (!fs.existsSync(expDir)) {
        fs.mkdirSync(expDir, { recursive: true });
      }

      // Write file to disk
      fs.writeFileSync(fullPath, fileBuffer);

      // Calculate checksum for integrity
      const checksum = crypto.createHash('sha256').update(fileBuffer).digest('hex');

      // Create database record
      const attachment = await prisma.attachment.create({
        data: {
          id: attachmentId,
          experimentId,
          filename: safeFilename,
          mime: mimeType,
          size: fileBuffer.length,
          blobPath: storagePath
        }
      });

      // Log the attachment addition
      await prisma.changeLog.create({
        data: {
          entityType: 'attachment',
          entityId: attachmentId,
          operation: 'create',
          newValue: JSON.stringify({
            experimentId,
            filename: safeFilename,
            mime: mimeType,
            size: fileBuffer.length,
            checksum,
            uploadedBy: user.id,
            uploadedAt: new Date().toISOString()
          })
        }
      });

      res.status(201).json({
        ...attachment,
        checksum,
        uploadedBy: user.id
      });

    } catch (error: any) {
      console.error('Attachment upload error:', error);
      res.status(500).json({ error: 'Failed to upload attachment' });
    }
  });

  /**
   * List attachments for an experiment
   */
  router.get('/experiments/:experimentId/attachments', async (req: Request, res: Response) => {
    const user = (req as any).user;
    const { experimentId } = req.params;

    try {
      // Rate limiting check
      if (!checkRateLimit(user?.id || req.ip || 'anonymous')) {
        return res.status(429).json({ error: 'Too many requests. Please try again later.' });
      }

      // Validate experimentId format
      if (!isValidPathSegment(experimentId)) {
        return res.status(400).json({ error: 'Invalid experiment ID format' });
      }

      const attachments = await prisma.attachment.findMany({
        where: { experimentId },
        orderBy: { createdAt: 'desc' }
      });

      res.json(attachments);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch attachments' });
    }
  });

  /**
   * Get/download a specific attachment
   */
  router.get('/attachments/:id', async (req: Request, res: Response) => {
    const user = (req as any).user;
    const { id } = req.params;

    try {
      // Rate limiting check
      if (!checkRateLimit(user?.id || req.ip || 'anonymous')) {
        return res.status(429).json({ error: 'Too many requests. Please try again later.' });
      }

      // Validate ID format
      if (!uuidValidate(id)) {
        return res.status(400).json({ error: 'Invalid attachment ID format' });
      }

      const attachment = await prisma.attachment.findUnique({
        where: { id }
      });

      if (!attachment) {
        return res.status(404).json({ error: 'Attachment not found' });
      }

      if (!attachment.blobPath) {
        return res.status(404).json({ error: 'Attachment file not found' });
      }

      // Safely construct path from database-stored blobPath (already validated on upload)
      const pathParts = attachment.blobPath.split(/[/\\]/);
      const fullPath = safeJoinPath(DATA_DIR, ...pathParts);
      
      if (!fullPath) {
        return res.status(500).json({ error: 'Invalid storage path' });
      }

      if (!fs.existsSync(fullPath)) {
        return res.status(404).json({ error: 'Attachment file missing from storage' });
      }

      res.setHeader('Content-Type', attachment.mime || 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${attachment.filename}"`);
      res.sendFile(fullPath);

    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch attachment' });
    }
  });

  /**
   * Get attachment as base64 (for inline display)
   */
  router.get('/attachments/:id/base64', async (req: Request, res: Response) => {
    const user = (req as any).user;
    const { id } = req.params;

    try {
      // Rate limiting check
      if (!checkRateLimit(user?.id || req.ip || 'anonymous')) {
        return res.status(429).json({ error: 'Too many requests. Please try again later.' });
      }

      // Validate ID format
      if (!uuidValidate(id)) {
        return res.status(400).json({ error: 'Invalid attachment ID format' });
      }

      const attachment = await prisma.attachment.findUnique({
        where: { id }
      });

      if (!attachment || !attachment.blobPath) {
        return res.status(404).json({ error: 'Attachment not found' });
      }

      // Safely construct path from database-stored blobPath
      const pathParts = attachment.blobPath.split(/[/\\]/);
      const fullPath = safeJoinPath(DATA_DIR, ...pathParts);
      
      if (!fullPath) {
        return res.status(500).json({ error: 'Invalid storage path' });
      }

      if (!fs.existsSync(fullPath)) {
        return res.status(404).json({ error: 'Attachment file missing' });
      }

      const fileBuffer = fs.readFileSync(fullPath);
      const base64 = fileBuffer.toString('base64');

      res.json({
        ...attachment,
        data: base64,
        dataUrl: `data:${attachment.mime};base64,${base64}`
      });

    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch attachment' });
    }
  });

  /**
   * Delete attachment (soft delete - keeps file but removes DB record)
   * Note: In append-only/compliance mode, deletions should be restricted
   */
  router.delete('/attachments/:id', async (req: Request, res: Response) => {
    const user = (req as any).user;
    const { id } = req.params;

    try {
      // Validate ID format
      if (!uuidValidate(id)) {
        return res.status(400).json({ error: 'Invalid attachment ID format' });
      }
      const attachment = await prisma.attachment.findUnique({
        where: { id },
        include: { experiment: true }
      });

      if (!attachment) {
        return res.status(404).json({ error: 'Attachment not found' });
      }

      // Check authorization
      const canDelete = user.role === 'admin' || 
        (attachment.experiment && attachment.experiment.userId === user.id);
      
      if (!canDelete) {
        return res.status(403).json({ error: 'Not authorized to delete this attachment' });
      }

      // Check if experiment is signed (cannot delete from signed experiments)
      if (attachment.experiment?.status === 'signed') {
        return res.status(400).json({ 
          error: 'Cannot delete attachments from signed experiments (21 CFR Part 11 compliance)' 
        });
      }

      // Log deletion
      await prisma.changeLog.create({
        data: {
          entityType: 'attachment',
          entityId: id,
          operation: 'delete',
          oldValue: JSON.stringify(attachment),
          newValue: JSON.stringify({ deletedBy: user.id, deletedAt: new Date().toISOString() })
        }
      });

      // Delete database record (keep file for audit trail)
      await prisma.attachment.delete({
        where: { id }
      });

      res.status(204).send();

    } catch (error) {
      res.status(500).json({ error: 'Failed to delete attachment' });
    }
  });

  /**
   * Bulk upload attachments
   */
  router.post('/experiments/:experimentId/attachments/bulk', async (req: Request, res: Response) => {
    const user = (req as any).user;
    const { experimentId } = req.params;
    const { files } = req.body;

    if (!Array.isArray(files) || files.length === 0) {
      return res.status(400).json({ error: 'files array is required' });
    }

    try {
      const experiment = await prisma.experiment.findUnique({
        where: { id: experimentId }
      });

      if (!experiment) {
        return res.status(404).json({ error: 'Experiment not found' });
      }

      const canEdit = user.role === 'manager' || user.role === 'admin' || experiment.userId === user.id;
      if (!canEdit) {
        return res.status(403).json({ error: 'Not authorized' });
      }

      const results: { success: any[]; errors: any[] } = { success: [], errors: [] };

      for (const file of files) {
        try {
          const { filename, mime, data } = file;
          
          if (!filename || !data) {
            results.errors.push({ filename, error: 'Missing filename or data' });
            continue;
          }

          const mimeType = mime || guessMimeType(filename);
          if (!ALL_ALLOWED_TYPES.includes(mimeType)) {
            results.errors.push({ filename, error: `File type not allowed: ${mimeType}` });
            continue;
          }

          const fileBuffer = Buffer.from(data, 'base64');
          if (fileBuffer.length > MAX_FILE_SIZE) {
            results.errors.push({ filename, error: 'File too large' });
            continue;
          }

          const attachmentId = uuid();
          const ext = path.extname(filename) || getExtensionFromMime(mimeType);
          const safeFilename = sanitizeFilename(filename);
          const storagePath = path.join(experimentId, `${attachmentId}${ext}`);
          const fullPath = path.join(DATA_DIR, storagePath);

          const expDir = path.join(DATA_DIR, experimentId);
          if (!fs.existsSync(expDir)) {
            fs.mkdirSync(expDir, { recursive: true });
          }

          fs.writeFileSync(fullPath, fileBuffer);

          const attachment = await prisma.attachment.create({
            data: {
              id: attachmentId,
              experimentId,
              filename: safeFilename,
              mime: mimeType,
              size: fileBuffer.length,
              blobPath: storagePath
            }
          });

          results.success.push(attachment);

        } catch (err: any) {
          results.errors.push({ filename: file.filename, error: err.message });
        }
      }

      res.status(201).json(results);

    } catch (error) {
      res.status(500).json({ error: 'Failed to process bulk upload' });
    }
  });

  return router;
}

// ==================== HELPER FUNCTIONS ====================

function sanitizeFilename(filename: string): string {
  // Remove path separators and dangerous characters
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
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.xls': 'application/vnd.ms-excel',
    '.csv': 'text/csv',
    '.tsv': 'text/tab-separated-values',
    '.ods': 'application/vnd.oasis.opendocument.spreadsheet',
    '.pdf': 'application/pdf',
    '.txt': 'text/plain',
    '.json': 'application/json'
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
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
    'application/vnd.ms-excel': '.xls',
    'text/csv': '.csv',
    'application/csv': '.csv',
    'text/tab-separated-values': '.tsv',
    'application/vnd.oasis.opendocument.spreadsheet': '.ods',
    'application/pdf': '.pdf',
    'text/plain': '.txt',
    'application/json': '.json'
  };
  return extMap[mime] || '';
}

export default createAttachmentRoutes;
