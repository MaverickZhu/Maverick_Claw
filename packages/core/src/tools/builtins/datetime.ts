import type { Tool } from '../types.js';

export const datetimeTool: Tool = {
  definition: {
    name: 'datetime',
    description: '获取当前日期和时间信息，支持格式化输出和时区转换',
    parameters: {
      type: 'object',
      properties: {
        format: {
          type: 'string',
          description: '日期格式，如 "ISO", "locale", "timestamp"，默认为 "locale"',
          enum: ['ISO', 'locale', 'timestamp', 'date', 'time'],
        },
        timezone: {
          type: 'string',
          description: '时区，如 "Asia/Shanghai", "UTC"，默认为本地时区',
        },
      },
      required: [],
    },
  },

  async execute(args: Record<string, unknown>): Promise<unknown> {
    const format = (args.format as string) || 'locale';
    const timezone = args.timezone as string | undefined;

    const now = new Date();
    
    // Create date with specified timezone
    let date = now;
    if (timezone) {
      const tzDate = new Date(now.toLocaleString('en-US', { timeZone: timezone }));
      const diff = now.getTime() - tzDate.getTime();
      date = new Date(now.getTime() + diff);
    }

    switch (format) {
      case 'ISO':
        return {
          datetime: date.toISOString(),
          timezone: timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
        };
      
      case 'timestamp':
        return {
          timestamp: Math.floor(date.getTime() / 1000),
          milliseconds: date.getTime(),
          timezone: timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
        };
      
      case 'date':
        return {
          date: date.toLocaleDateString('zh-CN', { timeZone: timezone }),
          year: date.getFullYear(),
          month: date.getMonth() + 1,
          day: date.getDate(),
          weekday: date.toLocaleDateString('zh-CN', { weekday: 'long', timeZone: timezone }),
        };
      
      case 'time':
        return {
          time: date.toLocaleTimeString('zh-CN', { timeZone: timezone }),
          hour: date.getHours(),
          minute: date.getMinutes(),
          second: date.getSeconds(),
        };
      
      case 'locale':
      default:
        return {
          datetime: date.toLocaleString('zh-CN', { timeZone: timezone }),
          date: date.toLocaleDateString('zh-CN', { timeZone: timezone }),
          time: date.toLocaleTimeString('zh-CN', { timeZone: timezone }),
          timezone: timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
          iso: date.toISOString(),
        };
    }
  },
};
