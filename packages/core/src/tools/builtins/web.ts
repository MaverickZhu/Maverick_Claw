// Web and search tools
import type { Tool } from '../types.js';

export const fetchUrlTool: Tool = {
  definition: {
    name: 'fetch_url',
    description: '获取网页内容，支持 HTML 转文本',
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: '要获取的 URL',
        },
        maxLength: {
          type: 'number',
          description: '最大返回字符数，默认5000',
        },
      },
      required: ['url'],
    },
  },

  async execute(args: Record<string, unknown>): Promise<unknown> {
    const url = String(args.url);
    const maxLength = args.maxLength ? Number(args.maxLength) : 5000;

    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'MaverickClaw/0.1.0',
        },
      });

      if (!response.ok) {
        return {
          error: `HTTP ${response.status}: ${response.statusText}`,
          url,
        };
      }

      const contentType = response.headers.get('content-type') || '';
      
      if (contentType.includes('application/json')) {
        const data = await response.json();
        return {
          url,
          type: 'json',
          content: JSON.stringify(data, null, 2).slice(0, maxLength),
        };
      }

      // For HTML and text
      let text = await response.text();
      
      // Basic HTML to text conversion
      if (contentType.includes('text/html')) {
        text = htmlToText(text);
      }

      return {
        url,
        type: contentType.includes('text/html') ? 'html' : 'text',
        title: extractTitle(text),
        content: text.slice(0, maxLength),
        truncated: text.length > maxLength,
        length: text.length,
      };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : 'Failed to fetch URL',
        url,
      };
    }
  },
};

export const searchTool: Tool = {
  definition: {
    name: 'web_search',
    description: '执行网络搜索（模拟/示例实现，实际部署需要接入搜索引擎API）',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: '搜索关键词',
        },
        numResults: {
          type: 'number',
          description: '返回结果数量，默认5',
        },
      },
      required: ['query'],
    },
  },

  async execute(args: Record<string, unknown>): Promise<unknown> {
    const query = String(args.query);
    const numResults = args.numResults ? Number(args.numResults) : 5;

    // This is a placeholder implementation
    // In production, you would integrate with:
    // - Google Custom Search API
    // - Bing Search API
    // - DuckDuckGo API
    // - SerpAPI
    // etc.

    return {
      query,
      note: 'This is a placeholder. To enable real search, configure a search API provider.',
      results: [
        {
          title: 'Example Search Result',
          url: 'https://example.com',
          snippet: 'This is a placeholder search result. Configure a real search API for actual functionality.',
        },
      ],
    };
  },
};

function htmlToText(html: string): string {
  // Simple HTML to text conversion
  return html
    // Remove script and style tags
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    // Replace common tags with newlines or spaces
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<li>/gi, '• ')
    .replace(/<\/li>/gi, '\n')
    // Remove remaining HTML tags
    .replace(/<[^>]+>/g, ' ')
    // Clean up whitespace
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function extractTitle(text: string): string | null {
  // Try to extract title from HTML
  const match = text.match(/<title[^>]*>([^<]*)<\/title>/i);
  return match ? match[1].trim() : null;
}
