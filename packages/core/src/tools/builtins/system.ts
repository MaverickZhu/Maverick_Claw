// System information tools
import os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import type { Tool } from '../types.js';

const execAsync = promisify(exec);

export const systemInfoTool: Tool = {
  definition: {
    name: 'system_info',
    description: '获取系统基本信息，包括操作系统、CPU、内存等',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },

  async execute(): Promise<unknown> {
    return {
      platform: os.platform(),
      arch: os.arch(),
      hostname: os.hostname(),
      release: os.release(),
      cpus: {
        count: os.cpus().length,
        model: os.cpus()[0]?.model || 'Unknown',
      },
      memory: {
        total: formatBytes(os.totalmem()),
        free: formatBytes(os.freemem()),
        used: formatBytes(os.totalmem() - os.freemem()),
        usagePercent: Math.round(((os.totalmem() - os.freemem()) / os.totalmem()) * 100),
      },
      uptime: formatDuration(os.uptime()),
      loadavg: os.loadavg(),
    };
  },
};

export const runCommandTool: Tool = {
  definition: {
    name: 'run_command',
    description: '执行安全的系统命令（受限白名单），如 ping、echo、date 等',
    parameters: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: '要执行的命令（仅支持白名单内的安全命令）',
        },
        timeout: {
          type: 'number',
          description: '命令执行超时时间（秒），默认10秒',
        },
      },
      required: ['command'],
    },
  },

  async execute(args: Record<string, unknown>): Promise<unknown> {
    const command = String(args.command);
    const timeout = (args.timeout ? Number(args.timeout) : 10) * 1000;

    // Security: Whitelist of safe commands
    const allowedCommands = ['ping', 'echo', 'date', 'whoami', 'pwd', 'ls', 'dir', 'cat', 'head', 'tail', 'grep', 'find', 'wc'];
    const commandName = command.split(' ')[0].toLowerCase();

    if (!allowedCommands.includes(commandName)) {
      return {
        error: `Command not allowed: ${commandName}. Allowed: ${allowedCommands.join(', ')}`,
      };
    }

    try {
      const { stdout, stderr } = await execAsync(command, { timeout });
      return {
        command,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        success: true,
      };
    } catch (error) {
      return {
        command,
        error: error instanceof Error ? error.message : 'Command execution failed',
        success: false,
      };
    }
  },
};

function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = bytes;
  let unitIndex = 0;
  
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }
  
  return `${size.toFixed(2)} ${units[unitIndex]}`;
}

function formatDuration(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  
  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  parts.push(`${secs}s`);
  
  return parts.join(' ');
}
