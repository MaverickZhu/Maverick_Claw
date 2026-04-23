import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { UploadService } from './service.js';

describe('UploadService', () => {
  let tempDir: string;
  let service: UploadService;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-upload-test-'));
    service = new UploadService(tempDir);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('should validate allowed file types', () => {
    const result = service.validateFile('image/png', 1024);
    expect(result.valid).toBe(true);
  });

  it('should reject disallowed file types', () => {
    const result = service.validateFile('application/exe', 1024);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('not allowed');
  });

  it('should reject oversized files', () => {
    const result = service.validateFile('image/png', 100 * 1024 * 1024);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('exceeds');
  });

  it('should save and retrieve a file', async () => {
    const buffer = Buffer.from('test content');
    const result = await service.saveFile(buffer, 'test.txt', 'text/plain');

    expect(result.fileId).toBeDefined();
    expect(result.url).toBe(`/api/uploads/${result.fileId}`);
    expect(result.name).toBe('test.txt');
    expect(result.mimeType).toBe('text/plain');
    expect(result.size).toBe(12);

    const uploaded = await service.getFile(result.fileId);
    expect(uploaded).not.toBeNull();
    expect(uploaded!.size).toBe(12);
  });

  it('should return null for non-existent file', async () => {
    const uploaded = await service.getFile('non-existent-id');
    expect(uploaded).toBeNull();
  });

  it('should delete a file', async () => {
    const buffer = Buffer.from('test content');
    const result = await service.saveFile(buffer, 'test.txt', 'text/plain');

    const deleted = await service.deleteFile(result.fileId);
    expect(deleted).toBe(true);

    const uploaded = await service.getFile(result.fileId);
    expect(uploaded).toBeNull();
  });
});
