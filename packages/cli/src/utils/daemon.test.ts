import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { DaemonManager, listDaemons } from './daemon.js';

describe('DaemonManager', () => {
  let tempDir: string;
  let scriptPath: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'daemon-test-'));
    scriptPath = path.join(tempDir, 'test-script.js');
    
    // Create a simple test script that stays running
    await fs.writeFile(scriptPath, `
      console.log('Daemon started');
      setInterval(() => {}, 1000);
    `, 'utf-8');
  });

  afterEach(async () => {
    // Cleanup
    try {
      const manager = new DaemonManager({
        name: 'test-daemon',
        script: scriptPath,
        pidFile: path.join(tempDir, 'test-daemon.pid'),
        logFile: path.join(tempDir, 'test-daemon.log'),
      });
      const status = await manager.status();
      if (status.running) {
        await manager.stop();
      }
    } catch {
      // Ignore cleanup errors
    }
    
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('should start and stop daemon', async () => {
    const manager = new DaemonManager({
      name: 'test-daemon',
      script: scriptPath,
      pidFile: path.join(tempDir, 'test-daemon.pid'),
      logFile: path.join(tempDir, 'test-daemon.log'),
    });

    // Start
    await manager.start();
    
    let status = await manager.status();
    expect(status.running).toBe(true);
    expect(status.pid).toBeDefined();

    // Stop
    await manager.stop();
    
    status = await manager.status();
    expect(status.running).toBe(false);
  });

  it('should throw when starting already running daemon', async () => {
    const manager = new DaemonManager({
      name: 'test-daemon',
      script: scriptPath,
      pidFile: path.join(tempDir, 'test-daemon.pid'),
      logFile: path.join(tempDir, 'test-daemon.log'),
    });

    await manager.start();

    await expect(manager.start()).rejects.toThrow('already running');
  });

  it('should throw when stopping non-running daemon', async () => {
    const manager = new DaemonManager({
      name: 'test-daemon',
      script: scriptPath,
      pidFile: path.join(tempDir, 'test-daemon.pid'),
      logFile: path.join(tempDir, 'test-daemon.log'),
    });

    await expect(manager.stop()).rejects.toThrow('not running');
  });

  it('should restart daemon', async () => {
    const manager = new DaemonManager({
      name: 'test-daemon',
      script: scriptPath,
      pidFile: path.join(tempDir, 'test-daemon.pid'),
      logFile: path.join(tempDir, 'test-daemon.log'),
    });

    await manager.start();
    const status1 = await manager.status();
    
    await manager.restart();
    const status2 = await manager.status();

    expect(status2.running).toBe(true);
    // PID might be different after restart
  });

  it('should read logs', async () => {
    const logFile = path.join(tempDir, 'test-daemon.log');
    const manager = new DaemonManager({
      name: 'test-daemon',
      script: scriptPath,
      pidFile: path.join(tempDir, 'test-daemon.pid'),
      logFile,
    });

    // Write some test logs
    await fs.writeFile(logFile, 'Line 1\nLine 2\nLine 3\n', 'utf-8');

    const logs = await manager.logs(2);
    
    expect(logs).toHaveLength(2);
    expect(logs[0]).toBe('Line 2');
    expect(logs[1]).toBe('Line 3');
  });

  it('should return empty logs when file does not exist', async () => {
    const manager = new DaemonManager({
      name: 'test-daemon',
      script: scriptPath,
      pidFile: path.join(tempDir, 'test-daemon.pid'),
      logFile: path.join(tempDir, 'non-existent.log'),
    });

    const logs = await manager.logs();
    expect(logs).toEqual([]);
  });
});

describe('listDaemons', () => {
  it('should return empty array when no daemons exist', async () => {
    const daemons = await listDaemons();
    // Should not throw even if pid directory doesn't exist
    expect(Array.isArray(daemons)).toBe(true);
  });
});
