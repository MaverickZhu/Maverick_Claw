import path from 'path';
import fs from 'fs';
import os from 'os';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger.js';

export interface UploadedFile {
  fileId: string;
  originalName: string;
  mimeType: string;
  size: number;
  path: string;
  createdAt: Date;
}

export interface UploadResult {
  fileId: string;
  url: string;
  name: string;
  mimeType: string;
  size: number;
}

export interface FileAttachment {
  fileId: string;
  url: string;
  name: string;
  mimeType: string;
  size: number;
}

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
const ALLOWED_MIME_TYPES = new Set([
  // Images
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml',
  // Documents
  'application/pdf', 'text/plain', 'text/markdown',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  // Code files
  'text/javascript', 'text/typescript', 'text/html', 'text/css',
  'application/json', 'application/xml',
  // Archives
  'application/zip', 'application/x-tar', 'application/gzip',
  // Audio/Video (limited)
  'audio/mpeg', 'audio/wav', 'audio/ogg',
  'video/mp4', 'video/webm',
]);

export class UploadService {
  private uploadsDir: string;

  constructor(uploadsDir?: string) {
    this.uploadsDir = uploadsDir || this.getDefaultUploadsDir();
    this.ensureUploadsDir();
  }

  private getDefaultUploadsDir(): string {
    const dataDir = process.env.MAVERICK_CLAW_DATA_DIR ||
      path.join(os.homedir(), '.maverick-claw');
    return path.join(dataDir, 'uploads');
  }

  private ensureUploadsDir(): void {
    if (!fs.existsSync(this.uploadsDir)) {
      fs.mkdirSync(this.uploadsDir, { recursive: true });
      logger.info(`Uploads directory created: ${this.uploadsDir}`);
    }
  }

  getUploadsDir(): string {
    return this.uploadsDir;
  }

  validateFile(mimeType: string, size: number): { valid: boolean; error?: string } {
    if (size > MAX_FILE_SIZE) {
      return { valid: false, error: `File size exceeds maximum limit of ${MAX_FILE_SIZE / 1024 / 1024}MB` };
    }
    if (!ALLOWED_MIME_TYPES.has(mimeType)) {
      return { valid: false, error: `File type '${mimeType}' is not allowed` };
    }
    return { valid: true };
  }

  async saveFile(
    fileBuffer: Buffer,
    originalName: string,
    mimeType: string
  ): Promise<UploadResult> {
    const fileId = uuidv4();
    const ext = path.extname(originalName) || this.getExtensionFromMimeType(mimeType);
    const fileName = `${fileId}${ext}`;
    const filePath = path.join(this.uploadsDir, fileName);

    await fs.promises.writeFile(filePath, fileBuffer);

    const size = fileBuffer.length;

    logger.info({ fileId, originalName, mimeType, size }, 'File uploaded');

    return {
      fileId,
      url: `/api/uploads/${fileId}`,
      name: originalName,
      mimeType,
      size,
    };
  }

  async getFile(fileId: string): Promise<UploadedFile | null> {
    try {
      const files = await fs.promises.readdir(this.uploadsDir);
      const matchedFile = files.find((f) => f.startsWith(fileId));

      if (!matchedFile) {
        return null;
      }

      const filePath = path.join(this.uploadsDir, matchedFile);
      const stats = await fs.promises.stat(filePath);

      return {
        fileId,
        originalName: matchedFile.replace(`${fileId}.`, '').replace(fileId, 'unknown'),
        mimeType: this.getMimeTypeFromExtension(path.extname(matchedFile)),
        size: stats.size,
        path: filePath,
        createdAt: stats.birthtime,
      };
    } catch {
      return null;
    }
  }

  async deleteFile(fileId: string): Promise<boolean> {
    try {
      const files = await fs.promises.readdir(this.uploadsDir);
      const matchedFile = files.find((f) => f.startsWith(fileId));

      if (!matchedFile) {
        return false;
      }

      const filePath = path.join(this.uploadsDir, matchedFile);
      await fs.promises.unlink(filePath);
      logger.info({ fileId }, 'File deleted');
      return true;
    } catch (error) {
      logger.warn({ err: error, fileId }, 'Failed to delete file');
      return false;
    }
  }

  private getExtensionFromMimeType(mimeType: string): string {
    const map: Record<string, string> = {
      'image/jpeg': '.jpg',
      'image/png': '.png',
      'image/gif': '.gif',
      'image/webp': '.webp',
      'image/svg+xml': '.svg',
      'application/pdf': '.pdf',
      'text/plain': '.txt',
      'text/markdown': '.md',
      'application/json': '.json',
      'application/xml': '.xml',
      'text/html': '.html',
      'text/css': '.css',
      'text/javascript': '.js',
      'text/typescript': '.ts',
      'application/zip': '.zip',
      'audio/mpeg': '.mp3',
      'audio/wav': '.wav',
      'video/mp4': '.mp4',
      'video/webm': '.webm',
    };
    return map[mimeType] || '';
  }

  private getMimeTypeFromExtension(ext: string): string {
    const map: Record<string, string> = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.svg': 'image/svg+xml',
      '.pdf': 'application/pdf',
      '.txt': 'text/plain',
      '.md': 'text/markdown',
      '.json': 'application/json',
      '.xml': 'application/xml',
      '.html': 'text/html',
      '.css': 'text/css',
      '.js': 'text/javascript',
      '.ts': 'text/typescript',
      '.zip': 'application/zip',
      '.mp3': 'audio/mpeg',
      '.wav': 'audio/wav',
      '.mp4': 'video/mp4',
      '.webm': 'video/webm',
    };
    return map[ext.toLowerCase()] || 'application/octet-stream';
  }
}

// Singleton instance
let globalUploadService: UploadService | null = null;

export function getUploadService(uploadsDir?: string): UploadService {
  if (!globalUploadService) {
    globalUploadService = new UploadService(uploadsDir);
  }
  return globalUploadService;
}

export function resetUploadService(): void {
  globalUploadService = null;
}
