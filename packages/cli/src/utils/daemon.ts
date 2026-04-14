import { spawn, type ChildProcess } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

export interface DaemonOptions {
  name: string;
  script: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  logFile?: string;
  pidFile?: string;
}

export interface DaemonStatus {
  running: boolean;
  pid?: number;
  startTime?: Date;
}

const PID_DIR = path.join(os.homedir(), '.maverick-claw', 'pids');
const LOG_DIR = path.join(os.homedir(), '.maverick-claw', 'logs');

/**
 * Daemon manager for background process management
 */
export class DaemonManager {
  private name: string;
  private options: DaemonOptions;
  private pidFile: string;
  private logFile: string;

  constructor(options: DaemonOptions) {
    this.name = options.name;
    this.options = options;
    this.pidFile = options.pidFile || path.join(PID_DIR, `${options.name}.pid`);
    this.logFile = options.logFile || path.join(LOG_DIR, `${options.name}.log`);
  }

  /**
   * Start the daemon
   */
  async start(): Promise<void> {
    // Check if already running
    const status = await this.status();
    if (status.running) {
      throw new Error(`Daemon '${this.name}' is already running (PID: ${status.pid})`);
    }

    // Ensure directories exist
    await fs.mkdir(PID_DIR, { recursive: true });
    await fs.mkdir(LOG_DIR, { recursive: true });

    // Open log file for writing
    const logFd = await fs.open(this.logFile, 'a');

    try {
      // Spawn detached process
      const child = spawn('node', [this.options.script, ...(this.options.args || [])], {
        detached: true,
        stdio: ['ignore', logFd.fd, logFd.fd],
        env: { ...process.env, ...this.options.env, MAVERICK_CLAW_DAEMON: '1' },
        cwd: this.options.cwd,
      });

      // Unref so parent can exit
      child.unref();

      // Write PID file
      await fs.writeFile(this.pidFile, child.pid!.toString(), 'utf-8');

      // Wait a moment to ensure process started
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Check if process is actually running
      if (!(await this.isProcessRunning(child.pid!))) {
        throw new Error('Daemon failed to start');
      }
    } catch (error) {
      logFd.close();
      throw error;
    }
  }

  /**
   * Stop the daemon
   */
  async stop(): Promise<void> {
    const status = await this.status();
    if (!status.running) {
      throw new Error(`Daemon '${this.name}' is not running`);
    }

    // Send SIGTERM
    try {
      process.kill(status.pid!, 'SIGTERM');
    } catch (error) {
      throw new Error(`Failed to stop daemon: ${error}`);
    }

    // Wait for process to exit
    let attempts = 0;
    while (attempts < 30) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      if (!(await this.isProcessRunning(status.pid!))) {
        break;
      }
      attempts++;
    }

    // Force kill if still running
    if (await this.isProcessRunning(status.pid!)) {
      try {
        process.kill(status.pid!, 'SIGKILL');
      } catch {
        // Process might have exited between check and kill
      }
    }

    // Remove PID file
    try {
      await fs.unlink(this.pidFile);
    } catch {
      // File might not exist
    }
  }

  /**
   * Restart the daemon
   */
  async restart(): Promise<void> {
    try {
      await this.stop();
    } catch {
      // Ignore stop errors (might not be running)
    }
    await this.start();
  }

  /**
   * Get daemon status
   */
  async status(): Promise<DaemonStatus> {
    try {
      const pidStr = await fs.readFile(this.pidFile, 'utf-8');
      const pid = parseInt(pidStr.trim());

      if (await this.isProcessRunning(pid)) {
        return {
          running: true,
          pid,
          startTime: await this.getStartTime(pid),
        };
      } else {
        // Clean up stale PID file
        await fs.unlink(this.pidFile).catch(() => {});
        return { running: false };
      }
    } catch {
      return { running: false };
    }
  }

  /**
   * Read daemon logs
   */
  async logs(lines: number = 50): Promise<string[]> {
    try {
      const content = await fs.readFile(this.logFile, 'utf-8');
      return content.split('\n').filter(Boolean).slice(-lines);
    } catch {
      return [];
    }
  }

  /**
   * Stream daemon logs
   */
  async *streamLogs(): AsyncGenerator<string> {
    try {
      const content = await fs.readFile(this.logFile, 'utf-8');
      const lines = content.split('\n').filter(Boolean);
      for (const line of lines) {
        yield line;
      }
    } catch {
      // File might not exist
    }
  }

  /**
   * Tail daemon logs (follow mode)
   */
  tailLogs(callback: (line: string) => void): () => void {
    let running = true;
    let position = 0;

    const check = async () => {
      while (running) {
        try {
          const stats = await fs.stat(this.logFile);
          if (stats.size > position) {
            const fd = await fs.open(this.logFile, 'r');
            const buffer = Buffer.alloc(stats.size - position);
            await fd.read(buffer, 0, stats.size - position, position);
            await fd.close();

            const lines = buffer.toString().split('\n').filter(Boolean);
            for (const line of lines) {
              callback(line);
            }
            position = stats.size;
          }
        } catch {
          // File might not exist yet
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    };

    check();

    // Return stop function
    return () => {
      running = false;
    };
  }

  /**
   * Check if a process is running
   */
  private async isProcessRunning(pid: number): Promise<boolean> {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get process start time
   */
  private async getStartTime(pid: number): Promise<Date | undefined> {
    try {
      // On Linux/Mac, we can read /proc/PID/stat
      if (process.platform !== 'win32') {
        const stat = await fs.readFile(`/proc/${pid}/stat`, 'utf-8');
        const startTimeTicks = parseInt(stat.split(' ')[21]);
        const systemUptime = parseInt((await fs.readFile('/proc/uptime', 'utf-8')).split(' ')[0]);
        const clockTicks = 100; // Usually 100 on Linux
        const startTimeSeconds = systemUptime - (startTimeTicks / clockTicks);
        return new Date(Date.now() - startTimeSeconds * 1000);
      }
    } catch {
      // Ignore errors
    }
    return undefined;
  }
}

/**
 * List all managed daemons
 */
export async function listDaemons(): Promise<Array<{ name: string; status: DaemonStatus }>> {
  const daemons: Array<{ name: string; status: DaemonStatus }> = [];

  try {
    const files = await fs.readdir(PID_DIR);
    for (const file of files) {
      if (file.endsWith('.pid')) {
        const name = file.slice(0, -4);
        const manager = new DaemonManager({ name, script: '' });
        const status = await manager.status();
        daemons.push({ name, status });
      }
    }
  } catch {
    // Directory might not exist
  }

  return daemons;
}
