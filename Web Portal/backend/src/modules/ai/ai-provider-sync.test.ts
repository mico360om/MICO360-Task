import { describe, it, expect, vi } from 'vitest';
import { fetchProviderModels, extractModels, ProviderHttpError } from './ai-provider-sync.js';
import { ValidationError } from '../../lib/http-errors.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
const keys = (models: Array<{ key: string }>) => models.map((m) => m.key);

describe('extractModels', () => {
  it('reads the OpenAI/custom { data:[{id}] } shape, with what each model can do and a readable name', () => {
    const models = extractModels('openai', { data: [{ id: 'gpt-4o', created: 1715367049 }, { id: 'text-embedding-3-small' }, { id: 'o3-mini' }] });
    expect(models).toEqual([
      { key: 'gpt-4o', displayName: 'GPT-4o', capabilities: ['chat', 'vision', 'ocr', 'document'], created: 1715367049 },
      { key: 'text-embedding-3-small', displayName: 'Text embedding 3 small', capabilities: ['embedding'] },
      { key: 'o3-mini', displayName: 'o3-mini', capabilities: ['chat'] },
    ]);
  });

  it('leaves out image, speech and moderation models', () => {
    const list = ['gpt-4o-mini', 'dall-e-3', 'whisper-1', 'tts-1', 'omni-moderation-latest', 'gpt-image-1', 'gpt-4o-realtime-preview'];
    expect(keys(extractModels('openai', { data: list.map((id) => ({ id })) }))).toEqual(['gpt-4o-mini']);
  });

  it('uses the name and release date Anthropic sends', () => {
    const [m] = extractModels('anthropic', { data: [{ type: 'model', id: 'claude-haiku-4-5-20251001', display_name: 'Claude Haiku 4.5', created_at: '2025-10-01T00:00:00Z' }] });
    expect(m).toEqual({ key: 'claude-haiku-4-5-20251001', displayName: 'Claude Haiku 4.5', capabilities: ['chat', 'vision', 'ocr', 'document'], created: Date.parse('2025-10-01T00:00:00Z') / 1000 });
  });

  it('drops the "models/" prefix Gemini puts on its ids', () => {
    expect(keys(extractModels('custom', { data: [{ id: 'models/gemini-2.5-flash' }, { id: 'models/gemini-embedding-001' }] }))).toEqual(['gemini-2.5-flash', 'gemini-embedding-001']);
  });

  it('trusts what OpenRouter says a model reads and writes', () => {
    const models = extractModels('custom', {
      data: [
        { id: 'openai/gpt-4o-mini', name: 'OpenAI: GPT-4o-mini', created: 1721260800, architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] } },
        { id: 'acme/text-only', name: 'Acme: Text', architecture: { input_modalities: ['text'], output_modalities: ['text'] } },
        { id: 'acme/painter', name: 'Acme: Painter', architecture: { input_modalities: ['text'], output_modalities: ['image'] } },
      ],
    });
    expect(models).toEqual([
      { key: 'openai/gpt-4o-mini', displayName: 'OpenAI: GPT-4o-mini', capabilities: ['chat', 'vision', 'ocr', 'document'], created: 1721260800 },
      { key: 'acme/text-only', displayName: 'Acme: Text', capabilities: ['chat'] },
    ]);
  });

  it('trusts what Mistral says a model can do', () => {
    const models = extractModels('custom', {
      data: [
        { id: 'mistral-small-latest', capabilities: { completion_chat: true, vision: true } },
        { id: 'mistral-ocr-latest', capabilities: { completion_chat: false, vision: false } },
        { id: 'mistral-embed', capabilities: { completion_chat: false } },
      ],
    });
    expect(models.map((m) => [m.key, m.capabilities])).toEqual([
      ['mistral-small-latest', ['chat', 'vision', 'ocr', 'document']],
      ['mistral-embed', ['embedding']],
    ]);
  });

  it('reads the Ollama { models:[{name}] } shape', () => {
    const models = extractModels('ollama', { models: [{ name: 'llama3.1:latest', modified_at: '2025-01-02T03:04:05Z' }, { name: 'nomic-embed-text:latest' }] });
    expect(models).toEqual([
      { key: 'llama3.1:latest', displayName: 'Llama3.1', capabilities: ['chat'], created: Date.parse('2025-01-02T03:04:05Z') / 1000 },
      { key: 'nomic-embed-text:latest', displayName: 'Nomic embed text', capabilities: ['embedding'] },
    ]);
  });

  it('dedupes + drops blanks', () => {
    expect(keys(extractModels('openai', { data: [{ id: 'a' }, { id: 'a' }, { id: '' }, {}] }))).toEqual(['a']);
  });

  it('keeps only plausible ids and caps the list (the answer comes from an external server)', () => {
    const many = Array.from({ length: 800 }, (_, i) => ({ id: `m${i}` }));
    expect(extractModels('openai', { data: many })).toHaveLength(500);
    expect(keys(extractModels('openai', { data: [{ id: 'x'.repeat(201) }, { id: 'bad\u0000id' }, { id: 42 }, null, { id: 'ok' }] }))).toEqual(['ok']);
    expect(extractModels('openai', { data: [{ id: 'ok', name: 'n'.repeat(500) }] })[0]!.displayName).toHaveLength(200);
    expect(extractModels('openai', { data: 'nope' })).toEqual([]);
    expect(extractModels('openai', null)).toEqual([]);
  });
});

describe('fetchProviderModels', () => {
  it('calls the OpenAI /models endpoint with a Bearer token', async () => {
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse({ data: [{ id: 'gpt-4o' }] }));
    const models = await fetchProviderModels({ kind: 'openai', apiBaseUrl: 'https://api.openai.com/v1/', apiKey: 'sk-1' }, fetchImpl as unknown as typeof fetch);
    expect(keys(models)).toEqual(['gpt-4o']);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://api.openai.com/v1/models');
    expect((init!.headers as Record<string, string>).Authorization).toBe('Bearer sk-1');
  });

  it('asks Anthropic for its whole list (it sends 20 by default) with the x-api-key + version headers', async () => {
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse({ data: [{ id: 'claude-4' }] }));
    const models = await fetchProviderModels({ kind: 'anthropic', apiBaseUrl: 'https://api.anthropic.com', apiKey: 'ak-1' }, fetchImpl as unknown as typeof fetch);
    expect(keys(models)).toEqual(['claude-4']);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://api.anthropic.com/v1/models?limit=1000');
    expect((init!.headers as Record<string, string>)['x-api-key']).toBe('ak-1');
    expect((init!.headers as Record<string, string>)['anthropic-version']).toBeTruthy();
  });

  it('calls Ollama /api/tags (a local server needs private hosts allowed)', async () => {
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse({ models: [{ name: 'llama3' }] }));
    const models = await fetchProviderModels({ kind: 'ollama', apiBaseUrl: 'http://localhost:11434', apiKey: '' }, fetchImpl as unknown as typeof fetch, { allowPrivateHosts: true });
    expect(keys(models)).toEqual(['llama3']);
    expect(fetchImpl.mock.calls[0]![0]).toBe('http://localhost:11434/api/tags');
  });

  it('refuses an internal address by default', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ models: [] }));
    await expect(
      fetchProviderModels({ kind: 'ollama', apiBaseUrl: 'http://localhost:11434', apiKey: '' }, fetchImpl as unknown as typeof fetch),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('reports a non-JSON answer as a ValidationError', async () => {
    const fetchImpl = vi.fn(async () => new Response('<html>login page</html>', { status: 200 }));
    await expect(
      fetchProviderModels({ kind: 'openai', apiBaseUrl: 'https://api.example.com', apiKey: '' }, fetchImpl as unknown as typeof fetch),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('says when the key was not accepted, and keeps the HTTP status for the caller', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: 'nope' }, 401));
    const err = await fetchProviderModels({ kind: 'openai', apiBaseUrl: 'https://api.openai.com/v1', apiKey: 'bad' }, fetchImpl as unknown as typeof fetch).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderHttpError);
    expect(err).toBeInstanceOf(ValidationError);
    expect((err as ProviderHttpError).providerStatus).toBe(401);
    expect((err as ProviderHttpError).status).toBe(400); // our answer to the browser: not a sign-in problem of ours
    expect((err as Error).message).toMatch(/did not accept the API key/i);
  });

  it('reports another refusal with its HTTP status', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: 'gone' }, 404));
    await expect(
      fetchProviderModels({ kind: 'custom', apiBaseUrl: 'https://api.example.com/v1', apiKey: 'k' }, fetchImpl as unknown as typeof fetch),
    ).rejects.toThrow(/HTTP 404/);
  });

  it('throws a ValidationError when the provider is unreachable', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    });
    await expect(
      fetchProviderModels({ kind: 'openai', apiBaseUrl: 'https://api.example.com', apiKey: '' }, fetchImpl as unknown as typeof fetch),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});
