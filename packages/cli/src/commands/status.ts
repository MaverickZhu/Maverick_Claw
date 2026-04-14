import { Command } from 'commander';
import chalk from 'chalk';
import axios from 'axios';

export const statusCommand = new Command('status')
  .description('查看 Gateway 状态')
  .option('-h, --host <host>', 'Gateway 主机', 'http://127.0.0.1:31987')
  .action(async (options) => {
    try {
      const response = await axios.get(`${options.host}/api/status`);
      const data = response.data;

      console.log(chalk.blue('┌─────────────────────────────────────┐'));
      console.log(chalk.blue('│  Maverick_Claw Status               │'));
      console.log(chalk.blue('├─────────────────────────────────────┤'));
      console.log(chalk.blue(`│  状态:      ${getStatusEmoji(data.status)} ${data.status.padEnd(18)}│`));
      console.log(chalk.blue(`│  版本:      📝 ${data.version.padEnd(18)}│`));
      console.log(chalk.blue(`│  运行时间:  ⏱️  ${formatUptime(data.uptime).padEnd(16)}│`));
      console.log(chalk.blue('├─────────────────────────────────────┤'));
      console.log(chalk.blue('│  配置模型:                           │'));
      
      if (data.config?.models?.length > 0) {
        data.config.models.forEach((m: {id: string, name: string, enabled: boolean}) => {
          const emoji = m.enabled ? '🟢' : '⚪';
          console.log(chalk.blue(`│    ${emoji} ${m.name.padEnd(28)}│`));
        });
      } else {
        console.log(chalk.blue(`│    ${chalk.gray('(未配置)').padEnd(30)}│`));
      }
      
      console.log(chalk.blue('├─────────────────────────────────────┤'));
      console.log(chalk.blue('│  通道:                               │'));
      
      if (data.config?.channels?.length > 0) {
        data.config.channels.forEach((c: {id: string, type: string, enabled: boolean}) => {
          const emoji = c.enabled ? '🟢' : '⚪';
          console.log(chalk.blue(`│    ${emoji} ${c.type.padEnd(28)}│`));
        });
      }
      
      console.log(chalk.blue('└─────────────────────────────────────┘'));
      
    } catch (error) {
      console.log(chalk.red('❌ 无法连接到 Gateway'));
      console.log(chalk.gray(`请确保 Gateway 正在运行: mc gateway`));
    }
  });

function getStatusEmoji(status: string): string {
  switch (status) {
    case 'healthy': return '🟢';
    case 'degraded': return '🟡';
    case 'unhealthy': return '🔴';
    default: return '⚪';
  }
}

function formatUptime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  } else if (minutes > 0) {
    return `${minutes}m ${secs}s`;
  } else {
    return `${secs}s`;
  }
}
