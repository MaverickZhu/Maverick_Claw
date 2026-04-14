import { Command } from 'commander';
import path from 'path';
import { fileURLToPath } from 'url';
import chalk from 'chalk';
import ora from 'ora';
import { DaemonManager, listDaemons } from '../utils/daemon.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GATEWAY_SCRIPT = path.resolve(__dirname, '../../../core/dist/cli.js');

export const gatewayCommand = new Command('gateway')
  .description('Gateway 服务器管理')
  .addCommand(
    new Command('start')
      .description('启动 Gateway 服务器')
      .option('-p, --port <port>', '端口号', '31987')
      .option('-h, --host <host>', '主机地址', '127.0.0.1')
      .option('-d, --daemon', '后台运行')
      .action(async (options) => {
        const port = parseInt(options.port);
        const host = options.host;

        if (options.daemon) {
          const spinner = ora('正在后台启动 Gateway...').start();
          
          try {
            const daemon = new DaemonManager({
              name: 'maverick-gateway',
              script: GATEWAY_SCRIPT,
              env: {
                MAVERICK_CLAW_PORT: port.toString(),
                MAVERICK_CLAW_HOST: host,
                NODE_ENV: 'production',
              },
            });

            await daemon.start();
            spinner.succeed(chalk.green(`Gateway 已在后台启动`));
            console.log(chalk.gray(`  端口: ${port}`));
            console.log(chalk.gray(`  主机: ${host}`));
            console.log(chalk.gray(`  日志: ~/.maverick-claw/logs/maverick-gateway.log`));
            console.log(chalk.gray(`  访问: http://${host}:${port}`));
          } catch (error) {
            spinner.fail(chalk.red('启动失败'));
            console.error(error instanceof Error ? error.message : error);
            process.exit(1);
          }
        } else {
          console.log(chalk.blue('🚀 正在启动 Maverick_Claw Gateway...'));
          console.log(chalk.gray(`  端口: ${port}`));
          console.log(chalk.gray(`  主机: ${host}`));
          console.log();

          // Set environment variables
          process.env.MAVERICK_CLAW_PORT = port.toString();
          process.env.MAVERICK_CLAW_HOST = host;

          // Import and run directly
          try {
            const core = await import('../../../core/dist/cli.js');
            await core.default.main();
          } catch {
            // Fallback: spawn as child process
            const { spawn } = await import('child_process');
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
          }
        }
      })
  )
  .addCommand(
    new Command('stop')
      .description('停止 Gateway 服务器')
      .action(async () => {
        const spinner = ora('正在停止 Gateway...').start();
        
        try {
          const daemon = new DaemonManager({
            name: 'maverick-gateway',
            script: GATEWAY_SCRIPT,
          });

          await daemon.stop();
          spinner.succeed(chalk.green('Gateway 已停止'));
        } catch (error) {
          spinner.fail(chalk.red('停止失败'));
          console.error(error instanceof Error ? error.message : error);
          process.exit(1);
        }
      })
  )
  .addCommand(
    new Command('restart')
      .description('重启 Gateway 服务器')
      .action(async () => {
        const spinner = ora('正在重启 Gateway...').start();
        
        try {
          const daemon = new DaemonManager({
            name: 'maverick-gateway',
            script: GATEWAY_SCRIPT,
          });

          await daemon.restart();
          spinner.succeed(chalk.green('Gateway 已重启'));
        } catch (error) {
          spinner.fail(chalk.red('重启失败'));
          console.error(error instanceof Error ? error.message : error);
          process.exit(1);
        }
      })
  )
  .addCommand(
    new Command('status')
      .description('查看 Gateway 状态')
      .action(async () => {
        const daemon = new DaemonManager({
          name: 'maverick-gateway',
          script: GATEWAY_SCRIPT,
        });

        const status = await daemon.status();

        if (status.running) {
          console.log(chalk.green('✓ Gateway 正在运行'));
          console.log(chalk.gray(`  PID: ${status.pid}`));
          if (status.startTime) {
            const uptime = Math.floor((Date.now() - status.startTime.getTime()) / 1000);
            const hours = Math.floor(uptime / 3600);
            const minutes = Math.floor((uptime % 3600) / 60);
            console.log(chalk.gray(`  运行时间: ${hours}小时 ${minutes}分钟`));
          }
        } else {
          console.log(chalk.red('✗ Gateway 未运行'));
        }
      })
  )
  .addCommand(
    new Command('logs')
      .description('查看 Gateway 日志')
      .option('-f, --follow', '持续跟踪日志')
      .option('-n, --lines <number>', '显示行数', '50')
      .action(async (options) => {
        const daemon = new DaemonManager({
          name: 'maverick-gateway',
          script: GATEWAY_SCRIPT,
        });

        if (options.follow) {
          console.log(chalk.blue('正在跟踪日志 (按 Ctrl+C 退出)...\n'));
          
          // Print existing logs first
          const logs = await daemon.logs(20);
          for (const line of logs) {
            console.log(line);
          }

          // Then tail
          const stop = daemon.tailLogs((line) => {
            console.log(line);
          });

          // Handle Ctrl+C
          process.on('SIGINT', () => {
            stop();
            console.log(chalk.gray('\n已停止跟踪'));
            process.exit(0);
          });

          // Keep process alive
          await new Promise(() => {});
        } else {
          const lines = parseInt(options.lines);
          const logs = await daemon.logs(lines);
          
          if (logs.length === 0) {
            console.log(chalk.gray('暂无日志'));
          } else {
            for (const line of logs) {
              console.log(line);
            }
          }
        }
      })
  )
  .addCommand(
    new Command('list')
      .description('列出所有运行的服务')
      .action(async () => {
        const daemons = await listDaemons();
        
        if (daemons.length === 0) {
          console.log(chalk.gray('没有运行的服务'));
          return;
        }

        console.log(chalk.bold('运行中的服务:\n'));
        for (const { name, status } of daemons) {
          if (status.running) {
            console.log(chalk.green(`  ● ${name}`));
            console.log(chalk.gray(`    PID: ${status.pid}`));
          } else {
            console.log(chalk.red(`  ○ ${name} (已停止)`));
          }
        }
      })
  );
