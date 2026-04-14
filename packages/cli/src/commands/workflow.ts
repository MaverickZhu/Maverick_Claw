import { Command } from 'commander';
import chalk from 'chalk';
import axios from 'axios';

function parseParams(params: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(params);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('参数必须是 JSON 对象');
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    throw new Error(
      error instanceof Error
        ? `参数解析失败: ${error.message}`
        : '参数解析失败，请传入合法 JSON'
    );
  }
}

export const workflowCommand = new Command('workflow')
  .description('工作流管理与执行')
  .addCommand(
    new Command('list')
      .description('列出可用工作流')
      .option('-h, --host <host>', 'Gateway 主机', 'http://127.0.0.1:31987')
      .action(async (options) => {
        try {
          const response = await axios.get(`${options.host}/api/workflows`);
          const workflows = response.data.workflows || [];

          if (workflows.length === 0) {
            console.log(chalk.yellow('未找到可用工作流'));
            return;
          }

          console.log(chalk.cyan('可用工作流:\n'));
          for (const workflow of workflows) {
            console.log(chalk.green(`- ${workflow.name}`));
            if (workflow.description) {
              console.log(chalk.gray(`  ${workflow.description}`));
            }
          }
        } catch (error) {
          console.error(chalk.red('获取工作流列表失败'));
          console.error(error instanceof Error ? error.message : error);
          process.exit(1);
        }
      })
  )
  .addCommand(
    new Command('run')
      .description('执行指定工作流')
      .argument('<name>', '工作流名称')
      .option('-h, --host <host>', 'Gateway 主机', 'http://127.0.0.1:31987')
      .option('-p, --params <json>', 'JSON 参数对象', '{}')
      .option('-s, --session <id>', '会话 ID（可选）')
      .action(async (name, options) => {
        try {
          const params = parseParams(options.params);

          const response = await axios.post(`${options.host}/api/workflows/run`, {
            name,
            params,
            sessionId: options.session,
          });

          const data = response.data;
          console.log(chalk.green(`✅ 工作流执行完成: ${name}`));
          console.log(chalk.gray(`Session: ${data.sessionId}`));
          console.log(chalk.gray(`Success: ${data.success ? 'true' : 'false'}`));

          if (data.summary) {
            console.log();
            console.log(chalk.cyan('执行摘要:'));
            console.log(data.summary);
          }
        } catch (error) {
          console.error(chalk.red(`执行工作流失败: ${name}`));
          if (axios.isAxiosError(error)) {
            const errorMessage = error.response?.data?.error || error.message;
            console.error(errorMessage);
          } else {
            console.error(error instanceof Error ? error.message : error);
          }
          process.exit(1);
        }
      })
  );
