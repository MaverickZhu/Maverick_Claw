#!/usr/bin/env node
import { Command } from 'commander';
import chalk from 'chalk';
import figlet from 'figlet';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { gatewayCommand } from './commands/gateway.js';
import { configCommand } from './commands/config.js';
import { statusCommand } from './commands/status.js';
import { sendCommand } from './commands/send.js';
import { workflowCommand } from './commands/workflow.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GATEWAY_SCRIPT = path.resolve(__dirname, '../../core/dist/cli.js');

const program = new Command();

// Banner
console.log(
  chalk.cyan(
    figlet.textSync('Maverick_Claw', { font: 'Small' })
  )
);
console.log(chalk.gray('面向中国用户的本地/自托管多通道 AI 助手网关\n'));

program
  .name('mc')
  .description('Maverick_Claw CLI - 多通道 AI 网关管理工具')
  .version('0.1.0');

// Register commands
program.addCommand(gatewayCommand);
program.addCommand(configCommand);
program.addCommand(statusCommand);
program.addCommand(sendCommand);
program.addCommand(workflowCommand);

// Quick commands - spawn child process to avoid double execution
program
  .command('start')
  .description('快速启动 Gateway (前台模式)')
  .option('-p, --port <port>', '端口号', '31987')
  .option('-h, --host <host>', '主机地址', '127.0.0.1')
  .option('-d, --daemon', '后台运行')
  .action(async (options) => {
    if (options.daemon) {
      // Use gateway command for daemon mode
      const args = ['gateway', 'start', '--port', options.port, '--host', options.host, '--daemon'];
      const child = spawn('node', [process.argv[1], ...args], {
        stdio: 'inherit',
        detached: true,
      });
      child.unref();
      return;
    }

    // Foreground mode - directly spawn core CLI
    console.log(chalk.blue('🚀 正在启动 Maverick_Claw Gateway...'));
    console.log(chalk.gray(`  端口: ${options.port}`));
    console.log(chalk.gray(`  主机: ${options.host}`));
    console.log();

    process.env.MAVERICK_CLAW_PORT = options.port;
    process.env.MAVERICK_CLAW_HOST = options.host;

    const child = spawn('node', [GATEWAY_SCRIPT], {
      stdio: 'inherit',
      env: process.env,
    });

    child.on('error', (error) => {
      console.error(chalk.red('启动失败:'), error.message);
      process.exit(1);
    });

    child.on('exit', (code) => {
      process.exit(code ?? 0);
    });
  });

program
  .command('stop')
  .description('快速停止 Gateway')
  .action(async () => {
    const args = ['gateway', 'stop'];
    const child = spawn('node', [process.argv[1], ...args], {
      stdio: 'inherit',
    });
    child.on('exit', (code) => process.exit(code ?? 0));
  });

program
  .command('restart')
  .description('快速重启 Gateway')
  .action(async () => {
    const args = ['gateway', 'restart'];
    const child = spawn('node', [process.argv[1], ...args], {
      stdio: 'inherit',
    });
    child.on('exit', (code) => process.exit(code ?? 0));
  });

program
  .command('logs')
  .description('快速查看 Gateway 日志')
  .option('-f, --follow', '持续跟踪日志')
  .option('-n, --lines <number>', '显示行数', '50')
  .action(async (options) => {
    const args = ['gateway', 'logs'];
    if (options.follow) args.push('--follow');
    if (options.lines) args.push('--lines', options.lines);
    
    const child = spawn('node', [process.argv[1], ...args], {
      stdio: 'inherit',
    });
    child.on('exit', (code) => process.exit(code ?? 0));
  });

// Default action
program.action(() => {
  program.help();
});

// Show help on unknown commands
program.on('command:*', () => {
  console.error(chalk.red('未知命令'));
  program.help();
});

program.parse();
