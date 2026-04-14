import { Command } from 'commander';
import chalk from 'chalk';
import axios from 'axios';
import WebSocket from 'ws';
import type { RawData } from 'ws';

interface WsMessage {
  type: 'connect' | 'req' | 'res' | 'event' | 'error';
  id?: string;
  ok?: boolean;
  method?: string;
  event?: string;
  params?: unknown;
  payload?: unknown;
  error?: string | { code?: string; message?: string };
}

function createRequestId(): string {
  return Math.random().toString(36).slice(2);
}

function toWebSocketUrl(httpBase: string): string {
  const url = new URL(httpBase);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = '/ws';
  url.search = '';
  return url.toString();
}

async function ensureSessionId(host: string, sessionId?: string): Promise<string> {
  if (sessionId) return sessionId;

  const response = await axios.post(`${host}/api/sessions`, {
    title: 'CLI 会话',
  });

  return response.data.id as string;
}

async function streamChatOverWebSocket(args: {
  wsUrl: string;
  sessionId: string;
  content: string;
  modelId?: string;
  token?: string;
  timeoutSeconds: number;
}): Promise<void> {
  return await new Promise((resolve, reject) => {
    const connectRequestId = createRequestId();
    const streamRequestId = createRequestId();
    const ws = new WebSocket(args.wsUrl);
    let settled = false;

    const done = (error?: Error) => {
      if (settled) return;
      settled = true;
      ws.close();
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    };

    const timer = setTimeout(() => {
      done(new Error(`请求超时（>${args.timeoutSeconds}s）`));
    }, args.timeoutSeconds * 1000);

    ws.on('open', () => {
      const connectMessage: WsMessage = {
        type: 'connect',
        id: connectRequestId,
        params: {
          clientType: 'cli',
          clientVersion: '0.1.0',
          deviceId: `cli-${createRequestId()}`,
          token: args.token,
        },
      };
      ws.send(JSON.stringify(connectMessage));
    });

    ws.on('message', (raw: RawData) => {
      try {
        const message = JSON.parse(raw.toString()) as WsMessage;

        if (message.type === 'connect' && message.id === connectRequestId) {
          if (!message.ok) {
            const msg = typeof message.error === 'string' ? message.error : '握手失败';
            done(new Error(msg));
            return;
          }

          const streamRequest: WsMessage = {
            type: 'req',
            id: streamRequestId,
            method: 'chat.stream',
            params: {
              sessionId: args.sessionId,
              content: args.content,
              modelId: args.modelId,
            },
          };
          ws.send(JSON.stringify(streamRequest));
          return;
        }

        if (message.type === 'res' && message.id === streamRequestId && message.ok === false) {
          const msg = typeof message.error === 'string' ? message.error : '请求执行失败';
          done(new Error(msg));
          return;
        }

        if (message.type === 'event') {
          if (message.event === 'chat.chunk') {
            const payload = (message.payload || {}) as { content?: string };
            if (payload.content) {
              process.stdout.write(payload.content);
            }
            return;
          }

          if (message.event === 'chat.complete') {
            process.stdout.write('\n');
            done();
            return;
          }

          if (message.event === 'chat.error') {
            const payload = (message.payload || {}) as { error?: string };
            done(new Error(payload.error || '聊天流失败'));
          }
          return;
        }

        if (message.type === 'error') {
          const err = message.error;
          const msg = typeof err === 'string' ? err : err?.message || 'WebSocket 错误';
          done(new Error(msg));
        }
      } catch (error) {
        done(error instanceof Error ? error : new Error('解析 WebSocket 消息失败'));
      }
    });

    ws.on('error', (error: Error) => {
      done(error);
    });

    ws.on('close', () => {
      if (!settled) {
        done(new Error('连接已关闭'));
      }
    });

    const clean = () => clearTimeout(timer);
    ws.once('close', clean);
    ws.once('error', clean);
  });
}

export const sendCommand = new Command('send')
  .description('发送消息到 Gateway')
  .argument('<message>', '消息内容')
  .option('-h, --host <host>', 'Gateway 主机', 'http://127.0.0.1:31987')
  .option('-s, --session <session>', '会话 ID')
  .option('-m, --model <model>', '模型 ID')
  .option('-t, --token <token>', '访问令牌（可选）')
  .option('--timeout <seconds>', '超时时间（秒）', '120')
  .action(async (message, options) => {
    try {
      console.log(chalk.blue('📤 发送消息...'));
      console.log(chalk.gray(`内容: ${message}`));

      const sessionId = await ensureSessionId(options.host, options.session);
      const wsUrl = toWebSocketUrl(options.host);

      console.log(chalk.gray(`会话: ${sessionId}`));
      console.log(chalk.gray(`网关: ${wsUrl}`));
      process.stdout.write(chalk.cyan('\nAI 回复: '));

      await streamChatOverWebSocket({
        wsUrl,
        sessionId,
        content: message,
        modelId: options.model,
        token: options.token,
        timeoutSeconds: Number(options.timeout) || 120,
      });

      console.log(chalk.green('✅ 完成'));
    } catch (error) {
      console.error(chalk.red('❌ 发送失败'));
      if (axios.isAxiosError(error)) {
        console.error(error.response?.data?.error || error.message);
      } else {
        console.error(error instanceof Error ? error.message : error);
      }
      process.exit(1);
    }
  });
