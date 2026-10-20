import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { AiSettingsPage } from './AiSettingsPage';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const NOW = new Date().toISOString();
const model = (id: string, modelKey: string, over: Record<string, unknown> = {}) => ({
  id,
  providerId: 'pr1',
  modelKey,
  displayName: modelKey,
  capabilities: ['chat'],
  parameters: {},
  concurrencyLimit: 4,
  enabled: false,
  available: true,
  createdAt: '',
  updatedAt: '',
  ...over,
});
const acme = {
  id: 'pr1',
  name: 'Acme AI',
  kind: 'openai',
  preset: 'custom',
  apiBaseUrl: 'https://api.acme.test/v1',
  enabled: true,
  createdAt: '',
  updatedAt: '',
  hasApiKey: true,
  apiKeyHint: '…9f3a',
  lastSyncedAt: NOW,
  lastSyncError: null as string | null,
  recommendedModelId: 'm1',
};
const config = {
  providers: [acme],
  models: [model('m1', 'acme-large', { enabled: true })],
  defaults: {},
  automatic: { chat: 'm1', vision: null, ocr: null, document: null, embedding: null },
};
/** A provider with a long model list: one on, one recommended, the rest switched off. */
const longList = {
  ...config,
  providers: [{ ...acme, recommendedModelId: 'm2' }],
  models: [
    model('m1', 'acme-large', { enabled: true, displayName: 'Acme Large' }),
    model('m2', 'acme-mini', { displayName: 'Acme Mini' }),
    model('m3', 'acme-mini-2024', { displayName: 'Acme Mini (2024)' }),
    model('m4', 'acme-vision', { displayName: 'Acme Vision', capabilities: ['chat', 'vision', 'ocr', 'document'] }),
    model('m5', 'acme-embed', { displayName: 'Acme Embed', capabilities: ['embedding'] }),
    model('m6', 'acme-old', { displayName: 'Acme Old', available: false }),
    model('m7', 'acme-coder', { displayName: 'Acme Coder' }),
    model('m8', 'acme-tiny', { displayName: 'Acme Tiny' }),
  ],
  automatic: { chat: 'm1', vision: null, ocr: null, document: null, embedding: null },
};

/** Requests that changed something, as "METHOD path". */
let writes: Array<{ call: string; body: unknown }>;
let failWrites: boolean;
let current: typeof config;
let answers: Record<string, () => Response>;
beforeEach(() => {
  writes = [];
  failWrites = true;
  current = config;
  answers = {};
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    if (method === 'GET') return json({ data: current });
    const call = `${method} ${String(url).replace(/^.*\/api\/v1/, '')}`;
    writes.push({ call, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (answers[call]) return answers[call]!();
    return failWrites ? json({ error: { code: 'INTERNAL', message: 'Something went wrong' } }, 500) : json({ data: current });
  }));
  vi.stubGlobal('confirm', () => true);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <AiSettingsPage />
    </QueryClientProvider>,
  );
}

describe('AI Management: a change that fails says so', () => {
  it('turning a model off', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('switch', { name: 'Use acme-large' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn’t save that change/i);
  });

  it('removing a model', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Remove acme-large' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn’t remove/i);
  });

  it('deleting a provider', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Delete Acme AI' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn’t remove/i);
  });

  it('the message goes away once the change works', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('switch', { name: 'Use acme-large' }));
    await screen.findByRole('alert');
    failWrites = false;
    fireEvent.click(screen.getByRole('switch', { name: 'Use acme-large' }));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });
});

describe('AI Management: concurrency limit', () => {
  it('shows the value that is really stored: a number above the limit is brought down to 64', async () => {
    failWrites = false;
    renderPage();
    const box = await screen.findByLabelText('Concurrency limit for acme-large');
    fireEvent.change(box, { target: { value: '999' } });
    fireEvent.blur(box);
    expect(box).toHaveValue(64);
    await waitFor(() => expect(writes).toContainEqual({ call: 'PUT /ai/models/m1', body: { concurrencyLimit: 64 } }));
  });
});

describe('AI Management: connecting a provider', () => {
  it('fills in the name and address of a ready-made service, so only the key is needed', async () => {
    const connected = {
      ...config,
      providers: [config.providers[0], { ...acme, id: 'pr2', name: 'Anthropic', kind: 'anthropic', preset: 'anthropic', apiBaseUrl: 'https://api.anthropic.com', recommendedModelId: 'c1' }],
      models: [...config.models, model('c1', 'claude-haiku-4-5', { providerId: 'pr2', displayName: 'Claude Haiku 4.5', enabled: true }), model('c2', 'claude-sonnet-4-5', { providerId: 'pr2', displayName: 'Claude Sonnet 4.5' })],
    };
    answers['POST /ai/providers'] = () => json({ data: connected });
    renderPage();
    fireEvent.change(await screen.findByLabelText('Service'), { target: { value: 'anthropic' } });
    expect(screen.getByLabelText(/^Name/)).toHaveValue('Anthropic');
    expect(screen.getByText('https://api.anthropic.com')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/^API key/), { target: { value: 'sk-ant-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Connect & load models' }));
    await waitFor(() =>
      expect(writes).toContainEqual({
        call: 'POST /ai/providers',
        body: { name: 'Anthropic', kind: 'anthropic', preset: 'anthropic', apiBaseUrl: 'https://api.anthropic.com', apiKey: 'sk-ant-1' },
      }),
    );
    expect(await screen.findByRole('status')).toHaveTextContent('Connected to Anthropic: 2 models found. Claude Haiku 4.5 is switched on.');
  });

  it('connects MICO360 AI with only its key, at its /v1 address, and says the address is unencrypted', async () => {
    answers['POST /ai/providers'] = () => json({ data: config });
    renderPage();
    expect(screen.queryByText(/plain http/i)).not.toBeInTheDocument();
    fireEvent.change(await screen.findByLabelText('Service'), { target: { value: 'mico360' } });
    expect(screen.getByLabelText(/^Name/)).toHaveValue('MICO360 AI');
    expect(screen.getByText('http://ai.mico360.com:5310/v1')).toBeInTheDocument();
    expect(screen.getByText(/plain http/i)).toHaveTextContent('the API key and what is sent to the AI cross the network unencrypted');
    fireEvent.change(screen.getByLabelText(/^API key/), { target: { value: 'mico_abc' } });
    fireEvent.click(screen.getByRole('button', { name: 'Connect & load models' }));
    await waitFor(() =>
      expect(writes).toContainEqual({
        call: 'POST /ai/providers',
        body: { name: 'MICO360 AI', kind: 'custom', preset: 'mico360', apiBaseUrl: 'http://ai.mico360.com:5310/v1', apiKey: 'mico_abc' },
      }),
    );
  });

  it('no unencrypted note for an office or local address', async () => {
    renderPage();
    fireEvent.change(await screen.findByLabelText('Service'), { target: { value: 'ollama' } });
    expect(screen.getByLabelText(/^Address/)).toHaveValue('http://localhost:11434');
    expect(screen.queryByText(/plain http/i)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/^Address/), { target: { value: 'http://192.168.1.20:11434' } });
    expect(screen.queryByText(/plain http/i)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/^Address/), { target: { value: 'http://ai.example.com/v1' } });
    expect(screen.getByText(/plain http/i)).toBeInTheDocument();
  });

  it('asks for the key before connecting a service that needs one', async () => {
    renderPage();
    fireEvent.change(await screen.findByLabelText('Service'), { target: { value: 'openai' } });
    fireEvent.click(screen.getByRole('button', { name: 'Connect & load models' }));
    expect(await screen.findByText('Paste the API key from OpenAI.')).toBeInTheDocument();
    expect(writes).toHaveLength(0);
  });

  it('lets the address be changed, and needs one for another service', async () => {
    renderPage();
    fireEvent.change(await screen.findByLabelText('Service'), { target: { value: 'custom' } });
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'House AI' } });
    fireEvent.click(screen.getByRole('button', { name: 'Connect & load models' }));
    expect(await screen.findByText('A valid http(s) address is required.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/^Address/), { target: { value: 'https://ai.house.test/v1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Connect & load models' }));
    await waitFor(() => expect(writes[0]).toMatchObject({ call: 'POST /ai/providers', body: { name: 'House AI', kind: 'custom', preset: 'custom', apiBaseUrl: 'https://ai.house.test/v1' } }));
  });

  it('says why the provider refused', async () => {
    answers['POST /ai/providers'] = () => json({ error: { code: 'VALIDATION', message: 'The provider did not accept the API key. Check it and try again.' } }, 400);
    renderPage();
    fireEvent.change(await screen.findByLabelText('Service'), { target: { value: 'openai' } });
    fireEvent.change(screen.getByLabelText(/^API key/), { target: { value: 'sk-wrong' } });
    fireEvent.click(screen.getByRole('button', { name: 'Connect & load models' }));
    expect(await screen.findByText('The provider did not accept the API key. Check it and try again.')).toBeInTheDocument();
  });
});

describe('AI Management: the provider card', () => {
  it('says when the models were last loaded, or why they could not be', async () => {
    current = { ...config, providers: [{ ...acme, lastSyncError: 'Could not reach the AI provider.' }] };
    renderPage();
    expect(await screen.findByText(/Couldn’t load the models: Could not reach the AI provider\./)).toBeInTheDocument();
  });

  it('a failed refresh shows its reason once, on the card', async () => {
    answers['POST /ai/providers/pr1/sync'] = () => {
      current = { ...config, providers: [{ ...acme, lastSyncError: 'Could not reach the AI provider.' }] }; // what the next read returns
      return json({ error: { code: 'VALIDATION', message: 'Could not reach the AI provider.' } }, 400);
    };
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Refresh models' }));
    expect(await screen.findByText('Couldn’t load the models: Could not reach the AI provider.')).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByText(/Could not reach the AI provider\./)).toHaveLength(1));
  });

  it('refreshes the models and says what changed', async () => {
    answers['POST /ai/providers/pr1/sync'] = () => json({ data: { detected: 4, added: 2, config } });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Refresh models' }));
    expect(await screen.findByText('4 models offered · 2 new')).toBeInTheDocument();
  });
});

describe('AI Management: choosing models', () => {
  it('shows the switched-on and recommended models first and folds the rest away', async () => {
    current = longList;
    renderPage();
    const list = await screen.findByRole('list', { name: 'Acme AI models' });
    expect(within(list).getAllByRole('listitem').map((li) => li.querySelector('[data-model-name]')?.textContent)).toEqual(['Acme Large', 'Acme Mini']);
    expect(within(list).getByText('Recommended')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show 6 more models' }));
    expect(within(list).getAllByRole('listitem')).toHaveLength(8);
  });

  it('finds models by name and filters them by what they can do', async () => {
    current = longList;
    renderPage();
    fireEvent.change(await screen.findByRole('searchbox', { name: 'Search Acme AI models' }), { target: { value: 'mini' } });
    const list = screen.getByRole('list', { name: 'Acme AI models' });
    expect(within(list).getAllByRole('listitem').map((li) => li.querySelector('[data-model-name]')?.textContent)).toEqual(['Acme Mini', 'Acme Mini (2024)']);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search Acme AI models' }), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Embeddings' }));
    expect(within(list).getAllByRole('listitem').map((li) => li.querySelector('[data-model-name]')?.textContent)).toEqual(['Acme Embed']);
    fireEvent.click(screen.getByRole('button', { name: 'Vision' }));
    expect(within(list).getAllByRole('listitem').map((li) => li.querySelector('[data-model-name]')?.textContent)).toEqual(['Acme Vision']);
  });

  it('tests a model and shows the answer time', async () => {
    answers['POST /ai/models/m1/test'] = () => json({ data: { ok: true, ms: 912, reply: 'OK' } });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Test acme-large' }));
    expect(await screen.findByText('Works · answered in 0.9 s')).toBeInTheDocument();
  });

  it('shows why a model test failed', async () => {
    answers['POST /ai/models/m1/test'] = () => json({ data: { ok: false, message: 'HTTP 429: You exceeded your current quota.' } });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Test acme-large' }));
    expect(await screen.findByText('HTTP 429: You exceeded your current quota.')).toBeInTheDocument();
  });
});

describe('AI Management: default models', () => {
  it('offers Automatic first, saying which model it uses now', async () => {
    current = longList;
    failWrites = false;
    renderPage();
    const chat = await screen.findByRole('combobox', { name: 'Default Chat model' });
    expect(within(chat).getAllByRole('option')[0]).toHaveTextContent('Automatic — Acme Large');
    fireEvent.change(chat, { target: { value: 'm1' } });
    await waitFor(() => expect(writes).toContainEqual({ call: 'PUT /ai/defaults/chat', body: { modelId: 'm1' } }));
  });

  it('says when the chosen model is unavailable, and which model is used meanwhile', async () => {
    current = {
      ...longList,
      models: longList.models.map((m) => (m.id === 'm6' ? { ...m, enabled: true } : m)), // Acme Old: on, but no longer offered
      defaults: { chat: 'm6' },
    };
    renderPage();
    expect(await screen.findByText('Acme Old isn’t available now, so Automatic’s choice (Acme Large) is used until it’s back.')).toBeInTheDocument();
    const inUse = screen.getByText('In use for chat').closest('li')!;
    expect(inUse.querySelector('[data-model-name]')).toHaveTextContent('Acme Large');
  });

  it('says when nothing can be used yet', async () => {
    current = { ...config, automatic: { ...config.automatic, embedding: null } };
    renderPage();
    const emb = await screen.findByRole('combobox', { name: 'Default Embeddings model' });
    expect(within(emb).getAllByRole('option')[0]).toHaveTextContent('Automatic — no model switched on');
  });
});
