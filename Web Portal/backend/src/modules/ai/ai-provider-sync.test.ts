import { describe, it, expect, vi } from 'vitest';
import { fetchProviderModels, extractModelKeys } from './ai-provider-sync.js';
import { ValidationError } from '../../lib/http-errors.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('extractModelKeys', () => {
  it('reads the OpenAI/custom { data:[{id}] } shape', () => {
    expect(extractModelKeys('openai', { data: [{ id: 'gpt-4o' }, { id: 'o1-mini' }] })).toEqual(['gpt-4o', 'o1-mini']);
  });
  it('reads the Ollama { models:[{name}] } shape', () => {
    expect(extractModelKeys('ollama', { models: [{ name: 'llama3' }, { name: 'mistral' }] })).toEqual(['llama3', 'mistral']);
  });
  it('dedupes + drops blanks', () => {
    expect(extractModelKeys('openai', { data: [{ id: 'a' }, { id: 'a' }, { id: '' }, {}] })).toEqual(['a']);
  });
});

describe('fetchProviderModels', () => {
  it('calls the OpenAI /models endpoint with a Bearer token', async () => {
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse({ data: [{ id: 'gpt-4o' }] }));
    const keys = await fetchProviderModels({ kind: 'openai', apiBaseUrl: 'https://api.openai.com/v1/', apiKey: 'sk-1' }, fetchImpl as unknown as typeof fetch);
    expect(keys).toEqual(['gpt-4o']);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://api.openai.com/v1/models');
    expect((init!.headers as Record<string, string>).Authorization).toBe('Bearer sk-1');
  });

  it('calls Anthropic /v1/models with the x-api-key + version headers', async () => {
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse({ data: [{ id: 'claude-4' }] }));
    const keys = await fetchProviderModels({ kind: 'anthropic', apiBaseUrl: 'https://api.anthropic.com', apiKey: 'ak-1' }, fetchImpl as unknown as typeof fetch);
    expect(keys).toEqual(['claude-4']);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://api.anthropic.com/v1/models');
    expect((init!.headers as Record<string, string>)['x-api-key']).toBe('ak-1');
    expect((init!.headers as Record<string, string>)['anthropic-version']).toBeTruthy();
  });

  it('calls Ollama /api/tags', async () => {
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse({ models: [{ name: 'llama3' }] }));
    const keys = await fetchProviderModels({ kind: 'ollama', apiBaseUrl: 'http://localhost:11434', apiKey: '' }, fetchImpl as unknown as typeof fetch);
    expect(keys).toEqual(['llama3']);
    expect(fetchImpl.mock.calls[0]![0]).toBe('http://localhost:11434/api/tags');
  });

  it('throws a ValidationError on a non-2xx response', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: 'nope' }, 401));
    await expect(
      fetchProviderModels({ kind: 'openai', apiBaseUrl: 'https://api.openai.com/v1', apiKey: 'bad' }, fetchImpl as unknown as typeof fetch),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('throws a ValidationError when the provider is unreachable', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    });
    await expect(
      fetchProviderModels({ kind: 'openai', apiBaseUrl: 'https://x', apiKey: '' }, fetchImpl as unknown as typeof fetch),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});
