import JSZip from 'jszip';
import type { DatabaseManager } from '../storage/db.js';
import { logger } from '../utils/logger.js';

export interface ImportResult {
  success: boolean;
  sessionsImported: number;
  messagesImported: number;
  errors: string[];
}

export class ImportService {
  constructor(private dbManager: DatabaseManager) {}

  async importFromBuffer(buffer: Buffer): Promise<ImportResult> {
    const db = this.dbManager.getDb();
    const result: ImportResult = {
      success: false,
      sessionsImported: 0,
      messagesImported: 0,
      errors: [],
    };

    try {
      const zip = await JSZip.loadAsync(buffer);
      const dataFile = zip.file('data.json');

      if (!dataFile) {
        result.errors.push('Invalid backup: data.json not found');
        return result;
      }

      const dataContent = await dataFile.async('string');
      const data = JSON.parse(dataContent) as {
        sessions?: Array<{
          id: string;
          title: string;
          model_id: string | null;
          user_id: string | null;
          created_at: number;
          updated_at: number;
          metadata: string | null;
        }>;
        messages?: Array<{
          id: string;
          session_id: string;
          role: string;
          content: string;
          created_at: number;
          metadata: string | null;
          tool_call_id: string | null;
        }>;
      };

      // Import sessions
      if (data.sessions && Array.isArray(data.sessions)) {
        const insertSession = db.prepare(
          `INSERT OR IGNORE INTO sessions (id, title, model_id, user_id, created_at, updated_at, metadata)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        );

        for (const session of data.sessions) {
          try {
            insertSession.run(
              session.id,
              session.title,
              session.model_id,
              session.user_id,
              session.created_at,
              session.updated_at,
              session.metadata
            );
            result.sessionsImported++;
          } catch (err) {
            result.errors.push(`Failed to import session ${session.id}: ${(err as Error).message}`);
          }
        }
      }

      // Import messages
      if (data.messages && Array.isArray(data.messages)) {
        const insertMessage = db.prepare(
          `INSERT OR IGNORE INTO messages (id, session_id, role, content, created_at, metadata, tool_call_id)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        );

        for (const message of data.messages) {
          try {
            insertMessage.run(
              message.id,
              message.session_id,
              message.role,
              message.content,
              message.created_at,
              message.metadata,
              message.tool_call_id
            );
            result.messagesImported++;
          } catch (err) {
            result.errors.push(`Failed to import message ${message.id}: ${(err as Error).message}`);
          }
        }
      }

      result.success = result.errors.length === 0;
      logger.info(
        { sessions: result.sessionsImported, messages: result.messagesImported },
        'Import completed'
      );

      return result;
    } catch (error) {
      result.errors.push(`Import failed: ${(error as Error).message}`);
      return result;
    }
  }
}

let globalImportService: ImportService | null = null;

export function getImportService(dbManager: DatabaseManager): ImportService {
  if (!globalImportService) {
    globalImportService = new ImportService(dbManager);
  }
  return globalImportService;
}
