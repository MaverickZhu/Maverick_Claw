import JSZip from 'jszip';
import type { DatabaseManager } from '../storage/db.js';
import type { ConfigManager } from '../config/manager.js';
import type { UploadService } from '../upload/service.js';
import { logger } from '../utils/logger.js';

export interface ExportData {
  sessions: Array<{
    id: string;
    title: string;
    model_id: string | null;
    user_id: string | null;
    created_at: number;
    updated_at: number;
    metadata: string | null;
  }>;
  messages: Array<{
    id: string;
    session_id: string;
    role: string;
    content: string;
    created_at: number;
    metadata: string | null;
    tool_call_id: string | null;
  }>;
  config: string;
  exportedAt: string;
  version: string;
}

export class ExportService {
  constructor(
    private dbManager: DatabaseManager,
    private configManager: ConfigManager,
    private uploadService: UploadService
  ) {}

  async exportAll(): Promise<Buffer> {
    const db = this.dbManager.getDb();
    const zip = new JSZip();

    // Export sessions
    const sessions = db.prepare('SELECT * FROM sessions').all() as ExportData['sessions'];

    // Export messages
    const messages = db.prepare('SELECT * FROM messages').all() as ExportData['messages'];

    // Export config
    const config = this.configManager.get();

    const exportData: ExportData = {
      sessions,
      messages,
      config: JSON.stringify(config, null, 2),
      exportedAt: new Date().toISOString(),
      version: '0.1.0',
    };

    // Add data.json
    zip.file('data.json', JSON.stringify(exportData, null, 2));

    // Add config.json5 if exists
    try {
      const configPath = this.configManager.getConfigPath?.() || '';
      if (configPath) {
        const { readFileSync } = await import('fs');
        const configContent = readFileSync(configPath, 'utf-8');
        zip.file('config.json5', configContent);
      }
    } catch {
      // Config file may not exist in some environments
    }

    // Add uploads metadata
    const uploadsDir = this.uploadService.getUploadsDir();
    try {
      const { readdirSync, readFileSync, statSync } = await import('fs');
      const { join } = await import('path');
      const uploadsZip = zip.folder('uploads');

      if (uploadsZip) {
        const files = readdirSync(uploadsDir);
        for (const file of files) {
          const filePath = join(uploadsDir, file);
          try {
            const stat = statSync(filePath);
            if (stat.isFile()) {
              const content = readFileSync(filePath);
              uploadsZip.file(file, content);
            }
          } catch {
            // Skip unreadable files
          }
        }
      }
    } catch {
      // Uploads directory may not exist
    }

    logger.info({ sessions: sessions.length, messages: messages.length }, 'Exported data');

    const buffer = await zip.generateAsync({ type: 'nodebuffer' });
    return buffer;
  }
}

let globalExportService: ExportService | null = null;

export function getExportService(
  dbManager: DatabaseManager,
  configManager: ConfigManager,
  uploadService: UploadService
): ExportService {
  if (!globalExportService) {
    globalExportService = new ExportService(dbManager, configManager, uploadService);
  }
  return globalExportService;
}
