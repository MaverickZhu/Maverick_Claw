// System information tools
import os from 'os';
import path from 'path';
import { exec, execFile } from 'child_process';
import { promisify } from 'util';
import type { Tool } from '../types.js';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

// Extended whitelist of safe commands
const ALLOWED_COMMANDS = new Set([
  // File listing & viewing
  'ls', 'dir', 'cat', 'head', 'tail', 'less', 'more', 'wc', 'find', 'grep',
  'tree', 'du', 'df', 'file', 'stat', 'sort', 'uniq', 'diff', 'cmp',
  // System info
  'echo', 'date', 'whoami', 'pwd', 'uname', 'hostname', 'uptime',
  'ps', 'top', 'free', 'vmstat', 'iostat', 'netstat', 'ss',
  'ip', 'ifconfig', 'ping', 'traceroute', 'nslookup', 'dig',
  // Development
  'git', 'node', 'npm', 'npx', 'python', 'python3', 'pip', 'pip3',
  'tsc', 'eslint', 'prettier', 'jest', 'vitest', 'cargo', 'rustc', 'go',
  // Utilities
  'which', 'where', 'type', 'true', 'false', 'seq', 'printf',
  'tar', 'gzip', 'gunzip', 'zip', 'unzip', 'chmod', 'chown',
]);

// Commands that are NEVER allowed even if in whitelist (too dangerous with certain args)
const DANGEROUS_PATTERNS = [
  /rm\s+-rf\s+\//,           // rm -rf /
  /:\(\)\{\s*:\|:&\s*\};/,   // fork bomb
  />\s*\/dev\/null/,          // redirect to /dev/null (often used in exploits)
  /curl\s+.*\|\s*sh/,         // curl | sh
  /wget\s+.*\|\s*sh/,         // wget | sh
  /eval\s*\(/,                // eval(
  /exec\s*\(/,                // exec(
  /bash\s+-c/,                // bash -c
  /sh\s+-c/,                  // sh -c
];

// Shell metacharacters that are risky in string mode
const SHELL_METACHARACTERS = /[;|&$`<>{}()\\*?]/;

// Maximum output size (characters)
const MAX_OUTPUT_LENGTH = 50_000;

// Maximum output lines
const DEFAULT_MAX_OUTPUT_LINES = 500;

// Allowed working directory roots
function getAllowedCwdRoots(): string[] {
  const roots = [
    process.cwd(),
    os.homedir(),
    process.env.MAVERICK_CLAW_DATA_DIR || path.join(os.homedir(), '.maverick-claw'),
  ];
  // On Windows, also allow common drives
  if (os.platform() === 'win32') {
    roots.push('C:\\\\');
    roots.push('D:\\\\');
  }
  return roots;
}

function validateCwd(cwd: string): { valid: boolean; resolved?: string; error?: string } {
  try {
    const resolved = path.resolve(cwd);
    const allowedRoots = getAllowedCwdRoots();
    const isAllowed = allowedRoots.some((root) => {
      const normalizedRoot = path.resolve(root);
      return resolved.startsWith(normalizedRoot) || resolved === normalizedRoot;
    });
    if (!isAllowed) {
      return { valid: false, error: `Working directory '${cwd}' is not allowed` };
    }
    return { valid: true, resolved };
  } catch {
    return { valid: false, error: `Invalid working directory: ${cwd}` };
  }
}

function validateCommandName(commandName: string): { valid: boolean; error?: string } {
  const normalized = commandName.toLowerCase();

  if (!ALLOWED_COMMANDS.has(normalized)) {
    return {
      valid: false,
      error: `Command '${commandName}' is not in the whitelist. Allowed commands: ${Array.from(ALLOWED_COMMANDS).sort().join(', ')}`,
    };
  }

  return { valid: true };
}

function validateCommandString(command: string): { valid: boolean; error?: string } {
  // Check for dangerous patterns
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(command)) {
      return { valid: false, error: 'Command contains dangerous patterns and is blocked' };
    }
  }

  // Check for shell metacharacters
  if (SHELL_METACHARACTERS.test(command)) {
    return {
      valid: false,
      error: `Command contains shell metacharacters which are not allowed in string mode. Use 'args' array parameter for commands with arguments. Disallowed characters: ; | & $ \` < > { } ( ) \\ * ?`,
    };
  }

  return { valid: true };
}

function truncateOutput(output: string, maxLines: number): string {
  const lines = output.split('\n');
  if (lines.length <= maxLines) {
    return output.slice(0, MAX_OUTPUT_LENGTH);
  }
  const kept = lines.slice(0, maxLines);
  const truncated = lines.length - maxLines;
  kept.push(`\n... (${truncated} more lines truncated) ...`);
  return kept.join('\n').slice(0, MAX_OUTPUT_LENGTH);
}

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
    description:
      '执行安全的系统命令（受限白名单）。推荐用法：提供 command 和 args 数组（更安全）。向后兼容：也可只提供 command 字符串。',
    parameters: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: '要执行的命令名（仅支持白名单内的安全命令）',
        },
        args: {
          type: 'array',
          items: { type: 'string', description: '命令参数' },
          description: '命令参数数组（推荐，可防止 shell 注入）',
        },
        cwd: {
          type: 'string',
          description: '工作目录（会被限制在允许的根目录内）',
        },
        timeout: {
          type: 'number',
          description: '命令执行超时时间（秒），默认 30 秒，最大 300 秒',
        },
        maxOutputLines: {
          type: 'number',
          description: '最大输出行数，默认 500 行',
        },
      },
      required: ['command'],
    },
  },

  async execute(args: Record<string, unknown>): Promise<unknown> {
    const command = String(args.command).trim();
    const commandName = command.split(' ')[0].toLowerCase();
    const rawArgs = args.args;
    const hasArgsArray = Array.isArray(rawArgs) && rawArgs.length > 0;
    const cwd = args.cwd ? String(args.cwd) : undefined;
    const timeout = Math.min((args.timeout ? Number(args.timeout) : 30) * 1000, 300_000);
    const maxOutputLines = args.maxOutputLines ? Number(args.maxOutputLines) : DEFAULT_MAX_OUTPUT_LINES;

    // Validate command name
    const nameValidation = validateCommandName(commandName);
    if (!nameValidation.valid) {
      return { error: nameValidation.error, success: false };
    }

    // Validate cwd if provided
    let resolvedCwd: string | undefined;
    if (cwd) {
      const cwdValidation = validateCwd(cwd);
      if (!cwdValidation.valid) {
        return { error: cwdValidation.error, success: false };
      }
      resolvedCwd = cwdValidation.resolved;
    }

    const execOptions: { timeout: number; cwd?: string; maxBuffer?: number } = {
      timeout,
      maxBuffer: 1024 * 1024, // 1MB buffer
    };
    if (resolvedCwd) {
      execOptions.cwd = resolvedCwd;
    }

    try {
      let stdout: string;
      let stderr: string;

      if (hasArgsArray) {
        // Safe mode: use execFile with args array (no shell)
        const cmdArgs = rawArgs.map((a) => String(a));
        const result = await execFileAsync(commandName, cmdArgs, execOptions);
        stdout = result.stdout;
        stderr = result.stderr;
      } else {
        // Legacy string mode: extra validation required
        const stringValidation = validateCommandString(command);
        if (!stringValidation.valid) {
          return { error: stringValidation.error, success: false };
        }
        const result = await execAsync(command, execOptions);
        stdout = result.stdout;
        stderr = result.stderr;
      }

      return {
        command: hasArgsArray ? `${commandName} ${(rawArgs as string[]).join(' ')}` : command,
        stdout: truncateOutput(stdout.trim(), maxOutputLines),
        stderr: stderr.trim() ? truncateOutput(stderr.trim(), maxOutputLines) : undefined,
        success: true,
        truncated: stdout.length > MAX_OUTPUT_LENGTH || stdout.split('\n').length > maxOutputLines,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Command execution failed';
      return {
        command: hasArgsArray ? `${commandName} ${(rawArgs as string[]).join(' ')}` : command,
        error: message,
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
