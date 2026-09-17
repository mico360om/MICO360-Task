import { describe, it, expect } from 'vitest';
import { complete, extractText, type ChatModel } from './ai-completion';

describe('extractText', () => {
  it('reads Anthropic messages content', () => {
    expect(extractText('anthropic', { content: [{ type: 'text', text: 'hello ' }, { type: 'text', text: 'world' }] })).toBe('hello world');
  });
  it('reads OpenAI chat completions', () => {
    expect(extractText('openai', { choices: [{ message: { content: ' hi ' } }] })).toBe('hi');
  });
  it('reads Ollama chat', () => {
    expect(extractText('ollama', { message: { content: 'yo' } })).toBe('yo');
  });
});

describe('complete', () => {
  it('calls the Anthropic Messages endpoint with the key + version and returns text', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ content: [{ type: 'text', text: '["a","b"]' }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const model: ChatModel = { provider: { kind: 'anthropic', apiBaseUrl: 'https://api.anthropic.com', apiKey: 'sk-ant' }, modelKey: 'claude-x' };
    const out = await complete(model, { system: 'be brief', prompt: 'hi' }, fetchImpl);
    expect(out).toBe('["a","b"]');
    expect(calls[0]!.url).toBe('https://api.anthropic.com/v1/messages');
    const headers = calls[0]!.init!.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('sk-ant');
    expect(headers['anthropic-version']).toBe('2023-06-01');
    const body = JSON.parse(String(calls[0]!.init!.body));
    expect(body.model).toBe('claude-x');
    expect(body.system).toBe('be brief');
  });

  it('throws a readable error on a non-OK provider response', async () => {
    const fetchImpl = (async () => new Response('nope', { status: 401 })) as unknown as typeof fetch;
    const model: ChatModel = { provider: { kind: 'openai', apiBaseUrl: 'https://x', apiKey: '' }, modelKey: 'gpt' };
    await expect(complete(model, { prompt: 'hi' }, fetchImpl)).rejects.toThrow(/HTTP 401/);
  });
});
