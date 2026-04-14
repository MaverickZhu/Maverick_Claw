import { Command } from 'commander';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import chalk from 'chalk';
import ora from 'ora';
import JSON5 from 'json5';
import { execSync } from 'child_process';

const CONFIG_DIR = path.join(os.homedir(), '.maverick-claw');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json5');

export const configCommand = new Command('config')
  .description('配置管理')
  .addCommand(
    new Command('path')
      .description('显示配置文件路径')
      .action(() => {
        console.log(chalk.blue('配置文件路径:'));
        console.log(chalk.gray(`  ${CONFIG_FILE}`));
      })
  )
  .addCommand(
    new Command('view')
      .description('查看当前配置')
      .action(async () => {
        try {
          const content = await fs.readFile(CONFIG_FILE, 'utf-8');
          console.log(chalk.blue('当前配置:\n'));
          console.log(content);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            console.log(chalk.yellow('配置文件不存在'));
          } else {
            console.error(chalk.red('读取配置失败:'), error);
          }
        }
      })
  )
  .addCommand(
    new Command('edit')
      .description('编辑配置文件')
      .action(async () => {
        const editor = process.env.EDITOR || 'vi';
        
        try {
          // Ensure config file exists
          await fs.mkdir(CONFIG_DIR, { recursive: true });
          try {
            await fs.access(CONFIG_FILE);
          } catch {
            // Create default config
            const defaultConfig = {
              port: 31987,
              host: '127.0.0.1',
              auth: { type: 'token' },
              models: [],
              channels: [],
              storage: { type: 'sqlite' },
            };
            await fs.writeFile(CONFIG_FILE, JSON5.stringify(defaultConfig, null, 2));
          }

          console.log(chalk.blue(`使用 ${editor} 编辑配置...`));
          execSync(`${editor} "${CONFIG_FILE}"`, { stdio: 'inherit' });
          console.log(chalk.green('配置编辑完成'));
        } catch (error) {
          console.error(chalk.red('编辑失败:'), error);
          process.exit(1);
        }
      })
  )
  .addCommand(
    new Command('import')
      .description('导入配置文件')
      .argument('<file>', '配置文件路径')
      .option('-f, --force', '覆盖现有配置')
      .action(async (file, options) => {
        const spinner = ora('正在导入配置...').start();
        
        try {
          // Check if source file exists
          const content = await fs.readFile(path.resolve(file), 'utf-8');
          const config = JSON5.parse(content);

          // Validate basic structure
          if (typeof config !== 'object') {
            throw new Error('无效的配置文件格式');
          }

          // Check if target exists
          if (!options.force) {
            try {
              await fs.access(CONFIG_FILE);
              spinner.stop();
              console.log(chalk.yellow('配置文件已存在，使用 --force 覆盖'));
              process.exit(1);
            } catch {
              // File doesn't exist, continue
            }
          }

          // Ensure directory exists
          await fs.mkdir(CONFIG_DIR, { recursive: true });

          // Write config
          await fs.writeFile(CONFIG_FILE, JSON5.stringify(config, null, 2), 'utf-8');
          
          spinner.succeed(chalk.green('配置导入成功'));
          console.log(chalk.gray(`  位置: ${CONFIG_FILE}`));
        } catch (error) {
          spinner.fail(chalk.red('导入失败'));
          console.error(error instanceof Error ? error.message : error);
          process.exit(1);
        }
      })
  )
  .addCommand(
    new Command('export')
      .description('导出配置文件')
      .argument('[file]', '导出文件路径', 'maverick-config.json')
      .action(async (file) => {
        const spinner = ora('正在导出配置...').start();
        
        try {
          // Read current config
          const content = await fs.readFile(CONFIG_FILE, 'utf-8');
          const config = JSON5.parse(content);

          // Remove sensitive data (API keys)
          const sanitized = { ...config };
          if (sanitized.models) {
            sanitized.models = sanitized.models.map((m: { apiKey?: string }) => ({
              ...m,
              apiKey: m.apiKey ? '***' : undefined,
            }));
          }

          const exportPath = path.resolve(file);
          await fs.writeFile(exportPath, JSON5.stringify(sanitized, null, 2), 'utf-8');
          
          spinner.succeed(chalk.green('配置导出成功'));
          console.log(chalk.gray(`  位置: ${exportPath}`));
          console.log(chalk.yellow('注意: API Key 已被隐藏'));
        } catch (error) {
          spinner.fail(chalk.red('导出失败'));
          console.error(error instanceof Error ? error.message : error);
          process.exit(1);
        }
      })
  )
  .addCommand(
    new Command('reset')
      .description('重置为默认配置')
      .option('-f, --force', '跳过确认')
      .action(async (options) => {
        if (!options.force) {
          console.log(chalk.yellow('警告: 这将删除所有配置！'));
          console.log(chalk.gray('使用 --force 确认'));
          process.exit(1);
        }

        const spinner = ora('正在重置配置...').start();
        
        try {
          const defaultConfig = {
            port: 31987,
            host: '127.0.0.1',
            auth: { type: 'token' },
            models: [],
            channels: [],
            storage: { type: 'sqlite' },
          };

          await fs.mkdir(CONFIG_DIR, { recursive: true });
          await fs.writeFile(CONFIG_FILE, JSON5.stringify(defaultConfig, null, 2), 'utf-8');
          
          spinner.succeed(chalk.green('配置已重置为默认值'));
        } catch (error) {
          spinner.fail(chalk.red('重置失败'));
          console.error(error instanceof Error ? error.message : error);
          process.exit(1);
        }
      })
  )
  .addCommand(
    new Command('validate')
      .description('验证配置文件')
      .action(async () => {
        const spinner = ora('正在验证配置...').start();
        
        try {
          const content = await fs.readFile(CONFIG_FILE, 'utf-8');
          const config = JSON5.parse(content);

          // Basic validation
          const issues: string[] = [];

          if (config.port && (typeof config.port !== 'number' || config.port < 1 || config.port > 65535)) {
            issues.push('port 必须是 1-65535 之间的数字');
          }

          if (config.models && !Array.isArray(config.models)) {
            issues.push('models 必须是数组');
          }

          if (config.channels && !Array.isArray(config.channels)) {
            issues.push('channels 必须是数组');
          }

          if (issues.length > 0) {
            spinner.fail(chalk.red('配置验证失败'));
            for (const issue of issues) {
              console.log(chalk.red(`  ✗ ${issue}`));
            }
            process.exit(1);
          }

          spinner.succeed(chalk.green('配置验证通过'));
          console.log(chalk.gray(`  模型数量: ${config.models?.length || 0}`));
          console.log(chalk.gray(`  渠道数量: ${config.channels?.length || 0}`));
          console.log(chalk.gray(`  端口: ${config.port || 31987}`));
        } catch (error) {
          spinner.fail(chalk.red('验证失败'));
          console.error(error instanceof Error ? error.message : error);
          process.exit(1);
        }
      })
  );
