import { afterEach, describe, expect, it, vi } from 'vitest';
import { OllamaProvider, getOllamaProvider } from './ollama.js';

describe('OllamaProvider', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should fail validation when Ollama is not reachable', async () => {
    const provider = new OllamaProvider({ baseUrl: 'http://localhost:11434' });
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(new Error('Connection refused'));
    vi.stubGlobal('fetch', fetchMock);

    const isValid = await provider.validateConfig();
    expect(isValid).toBe(false);
  });

  it('should pass validation when Ollama is reachable', async () => {
    const provider = new OllamaProvider({ baseUrl: 'http://localhost:11434' });
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ models: [] }), { status: 200 })
    );
    vi.stubGlobal('fetch', fetchMock);

    const isValid = await provider.validateConfig();
    expect(isValid).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith('http://localhost:11434/api/tags', { method: 'GET' });
  });

  it('should list models from /api/tags', async () => {
    const provider = new OllamaProvider({ baseUrl: 'http://localhost:11434' });
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          models: [
            { name: 'llama3.2', model: 'llama3.2:latest' },
            { name: 'qwen2.5', model: 'qwen2.5:latest' },
          ],
        }),
        { status: 200 }
      )
    );
    vi.stubGlobal('fetch', fetchMock);

    const models = await provider.listModels();
    expect(models).toEqual(['llama3.2', 'qwen2.5']);
  });

  it('should fallback to default model when /api/tags fails', async () => {
    const provider = new OllamaProvider({ baseUrl: 'http://localhost:11434' });
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(new Error('Connection refused'));
    vi.stubGlobal('fetch', fetchMock);

    const models = await provider.listModels();
    expect(models).toEqual(['llama3.2']);
  });

  it('should expose standardized capability matrix', () => {
    const provider = new OllamaProvider();
    const capabilities = provider.getCapabilities();
    expect(capabilities.supportsStreaming).toBe(true);
    expect(capabilities.supportsTools).toBe(false);
    expect(capabilities.supportsVision).toBe(false);
    expect(capabilities.parameterSupport.temperature.default).toBe(0.7);
  });

  it('should not support tool calling', () => {
    const provider = new OllamaProvider();
    expect(provider.supportsTools()).toBe(false);
  });

  it('should stream chat completion from NDJSON', async () => {
    const provider = new OllamaProvider({ baseUrl: 'http://localhost:11434' });

    const ndjsonLines = [
      JSON.stringify({ message: { role: 'assistant', content: 'Hello' }, done: false }),
      JSON.stringify({ message: { role: 'assistant', content: ' world' }, done: false }),
      JSON.stringify({ message: { role: 'assistant', content: '' }, done: true, eval_count: 10, prompt_eval_count: 5 }),
    ].join('\n');

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(ndjsonLines));
        controller.close();
      },
    });

    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(stream, { status: 200 })
    );
    vi.stubGlobal('fetch', fetchMock);

    const chunks: Array<{ content: string; done: boolean }> = [];
    for await (const chunk of provider.chatCompletion({
      model: 'llama3.2',
      messages: [{ role: 'user', content: 'Hi' }],
    })) {
      chunks.push(chunk);
    }

    expect(chunks).toHaveLength(3);
    expect(chunks[0].content).toBe('Hello');
    expect(chunks[1].content).toBe(' world');
    expect(chunks[2].done).toBe(true);
    expect(chunks[2].usage).toEqual({
      promptTokens: 5,
      completionTokens: 10,
    });

    const callBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body || '{}'));
    expect(callBody.model).toBe('llama3.2');
    expect(callBody.messages).toEqual([{ role: 'user', content: 'Hi' }]);
    expect(callBody.stream).toBe(true);
    expect(callBody.options.temperature).toBe(0.7);
  });

  it('should throw on API error', async () => {
    const provider = new OllamaProvider({ baseUrl: 'http://localhost:11434' });
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('model not found', { status: 404 })
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      (async () => {
        for await (const _chunk of provider.chatCompletion({
          model: 'unknown',
          messages: [{ role: 'user', content: 'Hi' }],
        })) {
          // consume
        }
      })()
    ).rejects.toThrow('Ollama API error');
  });

  it('should use getOllamaProvider singleton', () => {
    const provider1 = getOllamaProvider();
    const provider2 = getOllamaProvider();
    expect(provider1).toBe(provider2);
  });

  it('should update config via getOllamaProvider', () => {
    const provider = getOllamaProvider({ baseUrl: 'http://custom:11434' });
    expect(provider).toBe(getOllamaProvider());
  });
});
