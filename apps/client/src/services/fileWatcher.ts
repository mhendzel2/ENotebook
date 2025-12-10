/**
 * File Watcher Service for Electron
 * Watches designated folders for new instrument output files
 * and automatically uploads them to the appropriate experiment
 */

import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuid } from 'uuid';
import type { WatchedFolder, FileImportEvent, FileWatcherStatus, Modality } from '@eln/shared';
import { findModalityForFileType, getAllSupportedFileTypes } from '@eln/shared';

// ==================== TYPES ====================

interface FileWatcherConfig {
  serverUrl: string;
  userId: string;
  pollingInterval?: number; // Fallback polling interval in ms
  debounceDelay?: number;
}

interface FileInfo {
  path: string;
  name: string;
  size: number;
  mtime: Date;
}

// ==================== FILE WATCHER SERVICE ====================

export class FileWatcherService extends EventEmitter {
  private config: FileWatcherConfig;
  private watchedFolders: Map<string, WatchedFolder> = new Map();
  private fsWatchers: Map<string, fs.FSWatcher> = new Map();
  private processingQueue: Map<string, FileImportEvent> = new Map();
  private processedFiles: Set<string> = new Set();
  private debounceTimers: Map<string, NodeJS.Timeout> = new Map();
  private isRunning = false;

  constructor(config: FileWatcherConfig) {
    super();
    this.config = {
      pollingInterval: 5000,
      debounceDelay: 1000,
      ...config
    };
  }

  // ==================== PUBLIC API ====================

  /**
   * Start the file watcher service
   */
  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    
    // Re-initialize all existing watchers
    for (const folder of this.watchedFolders.values()) {
      this.startWatching(folder.id);
    }
    
    this.emit('started');
  }

  /**
   * Stop the file watcher service
   */
  stop(): void {
    if (!this.isRunning) return;
    this.isRunning = false;
    
    // Stop all watchers
    for (const watcher of this.fsWatchers.values()) {
      watcher.close();
    }
    this.fsWatchers.clear();
    
    // Clear timers
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
    
    this.emit('stopped');
  }

  /**
   * Add a folder to watch
   */
  addWatchedFolder(config: {
    path: string;
    experimentId?: string;
    modality?: Modality;
    pattern?: string;
    autoUpload?: boolean;
    deleteAfterUpload?: boolean;
  }): WatchedFolder {
    // Validate path exists
    if (!fs.existsSync(config.path)) {
      throw new Error(`Folder does not exist: ${config.path}`);
    }

    const folder: WatchedFolder = {
      id: uuid(),
      path: config.path,
      experimentId: config.experimentId,
      modality: config.modality,
      pattern: config.pattern || '*',
      autoUpload: config.autoUpload ?? true,
      deleteAfterUpload: config.deleteAfterUpload ?? false,
      status: 'idle',
      filesProcessed: 0,
      createdAt: new Date().toISOString()
    };

    this.watchedFolders.set(folder.id, folder);
    this.persistWatchedFolders();
    
    if (this.isRunning) {
      this.startWatching(folder.id);
    }
    
    this.emit('folderAdded', folder);
    return folder;
  }

  /**
   * Remove a watched folder
   */
  removeWatchedFolder(folderId: string): void {
    const folder = this.watchedFolders.get(folderId);
    if (!folder) return;

    this.stopWatching(folderId);
    this.watchedFolders.delete(folderId);
    this.persistWatchedFolders();
    
    this.emit('folderRemoved', folder);
  }

  /**
   * Update watched folder configuration
   */
  updateWatchedFolder(folderId: string, updates: Partial<WatchedFolder>): WatchedFolder | null {
    const folder = this.watchedFolders.get(folderId);
    if (!folder) return null;

    const updated = { ...folder, ...updates };
    this.watchedFolders.set(folderId, updated);
    this.persistWatchedFolders();
    
    // Restart watcher if path changed
    if (updates.path && updates.path !== folder.path) {
      this.stopWatching(folderId);
      if (this.isRunning) {
        this.startWatching(folderId);
      }
    }
    
    this.emit('folderUpdated', updated);
    return updated;
  }

  /**
   * Get all watched folders
   */
  getWatchedFolders(): WatchedFolder[] {
    return Array.from(this.watchedFolders.values());
  }

  /**
   * Get a specific watched folder
   */
  getWatchedFolder(folderId: string): WatchedFolder | undefined {
    return this.watchedFolders.get(folderId);
  }

  /**
   * Manually scan a folder for new files
   */
  async scanFolder(folderId: string): Promise<FileInfo[]> {
    const folder = this.watchedFolders.get(folderId);
    if (!folder) throw new Error(`Folder not found: ${folderId}`);

    const files = await this.listFiles(folder.path, folder.pattern);
    const newFiles = files.filter(f => !this.processedFiles.has(f.path));
    
    return newFiles;
  }

  /**
   * Manually trigger file import
   */
  async importFile(filePath: string, experimentId: string): Promise<FileImportEvent> {
    return this.processFile(filePath, experimentId);
  }

  /**
   * Get processing queue
   */
  getProcessingQueue(): FileImportEvent[] {
    return Array.from(this.processingQueue.values());
  }

  /**
   * Get supported file types
   */
  getSupportedFileTypes(): string[] {
    return getAllSupportedFileTypes().map(ft => ft.extension);
  }

  // ==================== PRIVATE METHODS ====================

  private startWatching(folderId: string): void {
    const folder = this.watchedFolders.get(folderId);
    if (!folder) return;

    // Update status
    this.updateFolderStatus(folderId, 'watching');

    try {
      // Use native fs.watch for real-time monitoring
      const watcher = fs.watch(
        folder.path,
        { persistent: true, recursive: false },
        (eventType, filename) => {
          if (eventType === 'rename' && filename) {
            this.handleFileEvent(folder, filename);
          }
        }
      );

      watcher.on('error', (error) => {
        console.error(`Watcher error for ${folder.path}:`, error);
        this.updateFolderStatus(folderId, 'error');
        this.emit('error', { folderId, error });
      });

      this.fsWatchers.set(folderId, watcher);

      // Initial scan for existing files
      this.scanExistingFiles(folder);

    } catch (error) {
      console.error(`Failed to start watching ${folder.path}:`, error);
      this.updateFolderStatus(folderId, 'error');
      this.emit('error', { folderId, error });
    }
  }

  private stopWatching(folderId: string): void {
    const watcher = this.fsWatchers.get(folderId);
    if (watcher) {
      watcher.close();
      this.fsWatchers.delete(folderId);
    }
    
    // Clear any pending debounce timers for this folder
    const timer = this.debounceTimers.get(folderId);
    if (timer) {
      clearTimeout(timer);
      this.debounceTimers.delete(folderId);
    }

    this.updateFolderStatus(folderId, 'idle');
  }

  private handleFileEvent(folder: WatchedFolder, filename: string): void {
    const filePath = path.join(folder.path, filename);
    
    // Debounce to avoid processing same file multiple times
    const debounceKey = `${folder.id}:${filename}`;
    const existingTimer = this.debounceTimers.get(debounceKey);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(async () => {
      this.debounceTimers.delete(debounceKey);
      
      // Check if file exists (might be a deletion event)
      if (!fs.existsSync(filePath)) return;
      
      // Check if file matches pattern
      if (!this.matchesPattern(filename, folder.pattern)) return;
      
      // Check if already processed
      if (this.processedFiles.has(filePath)) return;
      
      // Check file extension against supported types
      const ext = path.extname(filename).toLowerCase();
      const supportedTypes = this.getSupportedFileTypes();
      const isSupported = supportedTypes.some(t => t.toLowerCase() === ext);
      
      if (!isSupported && !folder.pattern?.includes('*')) {
        // Skip unsupported file types unless pattern explicitly allows
        return;
      }

      this.emit('fileDetected', { folder, filename, filePath });

      // Auto-upload if configured
      if (folder.autoUpload && folder.experimentId) {
        try {
          this.updateFolderStatus(folder.id, 'processing');
          const event = await this.processFile(filePath, folder.experimentId, folder.id);
          
          folder.filesProcessed++;
          folder.lastActivity = new Date().toISOString();
          this.watchedFolders.set(folder.id, folder);
          
          this.emit('fileProcessed', event);
          
          // Delete after upload if configured
          if (folder.deleteAfterUpload && event.status === 'completed') {
            fs.unlinkSync(filePath);
            this.emit('fileDeleted', { filePath });
          }
        } catch (error) {
          this.emit('error', { folder, filename, error });
        } finally {
          this.updateFolderStatus(folder.id, 'watching');
        }
      }
    }, this.config.debounceDelay);

    this.debounceTimers.set(debounceKey, timer);
  }

  private async scanExistingFiles(folder: WatchedFolder): Promise<void> {
    try {
      const files = await this.listFiles(folder.path, folder.pattern);
      
      for (const file of files) {
        if (this.processedFiles.has(file.path)) continue;
        
        this.emit('existingFileFound', { folder, file });
        
        // Don't auto-process existing files on startup
        // Just mark them as known
        this.processedFiles.add(file.path);
      }
    } catch (error) {
      console.error(`Error scanning ${folder.path}:`, error);
    }
  }

  private async processFile(
    filePath: string, 
    experimentId: string,
    watchedFolderId?: string
  ): Promise<FileImportEvent> {
    const filename = path.basename(filePath);
    const stats = fs.statSync(filePath);
    const ext = path.extname(filename).toLowerCase();
    
    // Determine MIME type
    const mimeType = this.getMimeType(ext);
    
    const event: FileImportEvent = {
      id: uuid(),
      watchedFolderId: watchedFolderId || '',
      filePath,
      fileName: filename,
      fileSize: stats.size,
      mimeType,
      experimentId,
      status: 'processing',
      createdAt: new Date().toISOString()
    };

    this.processingQueue.set(event.id, event);
    this.emit('processingStarted', event);

    try {
      // Read file
      const fileBuffer = fs.readFileSync(filePath);
      const base64Data = fileBuffer.toString('base64');

      // Upload to server
      const response = await fetch(`${this.config.serverUrl}/attachments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': this.config.userId
        },
        body: JSON.stringify({
          experimentId,
          filename,
          mime: mimeType,
          size: stats.size,
          data: base64Data
        })
      });

      if (!response.ok) {
        throw new Error(`Upload failed: ${response.statusText}`);
      }

      const attachment = await response.json();
      
      event.status = 'completed';
      event.attachmentId = attachment.id;
      event.processedAt = new Date().toISOString();
      
      this.processedFiles.add(filePath);
      
    } catch (error) {
      event.status = 'failed';
      event.error = error instanceof Error ? error.message : 'Unknown error';
    }

    this.processingQueue.set(event.id, event);
    return event;
  }

  private async listFiles(folderPath: string, pattern?: string): Promise<FileInfo[]> {
    const entries = fs.readdirSync(folderPath, { withFileTypes: true });
    const files: FileInfo[] = [];

    for (const entry of entries) {
      if (!entry.isFile()) continue;
      
      if (pattern && !this.matchesPattern(entry.name, pattern)) continue;
      
      const fullPath = path.join(folderPath, entry.name);
      const stats = fs.statSync(fullPath);
      
      files.push({
        path: fullPath,
        name: entry.name,
        size: stats.size,
        mtime: stats.mtime
      });
    }

    return files.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
  }

  private matchesPattern(filename: string, pattern?: string): boolean {
    if (!pattern || pattern === '*') return true;
    
    // Simple glob matching
    const regex = new RegExp(
      '^' + pattern
        .replace(/\./g, '\\.')
        .replace(/\*/g, '.*')
        .replace(/\?/g, '.') + '$',
      'i'
    );
    
    return regex.test(filename);
  }

  private getMimeType(ext: string): string {
    const mimeTypes: Record<string, string> = {
      '.nd2': 'application/x-nikon-nd2',
      '.czi': 'application/x-zeiss-czi',
      '.lif': 'application/x-leica-lif',
      '.tif': 'image/tiff',
      '.tiff': 'image/tiff',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.mrc': 'application/x-mrc',
      '.dm4': 'application/x-gatan-dm4',
      '.fcs': 'application/vnd.isac.fcs',
      '.csv': 'text/csv',
      '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      '.pdf': 'application/pdf',
      '.gb': 'application/x-genbank',
      '.fasta': 'application/x-fasta',
      '.fa': 'application/x-fasta',
      '.ab1': 'application/x-abi'
    };
    
    return mimeTypes[ext] || 'application/octet-stream';
  }

  private updateFolderStatus(folderId: string, status: FileWatcherStatus): void {
    const folder = this.watchedFolders.get(folderId);
    if (folder) {
      folder.status = status;
      this.watchedFolders.set(folderId, folder);
      this.emit('statusChanged', { folderId, status });
    }
  }

  private persistWatchedFolders(): void {
    // In a real implementation, this would save to a config file or IndexedDB
    const data = Array.from(this.watchedFolders.values());
    this.emit('persist', data);
  }

  /**
   * Load persisted watched folders
   */
  loadWatchedFolders(folders: WatchedFolder[]): void {
    for (const folder of folders) {
      this.watchedFolders.set(folder.id, {
        ...folder,
        status: 'idle',
        filesProcessed: folder.filesProcessed || 0
      });
    }
  }
}

// ==================== SINGLETON INSTANCE ====================

let instance: FileWatcherService | null = null;

export function getFileWatcherService(config?: FileWatcherConfig): FileWatcherService {
  if (!instance && config) {
    instance = new FileWatcherService(config);
  }
  if (!instance) {
    throw new Error('FileWatcherService not initialized. Call with config first.');
  }
  return instance;
}

export function initFileWatcherService(config: FileWatcherConfig): FileWatcherService {
  instance = new FileWatcherService(config);
  return instance;
}

export default FileWatcherService;
