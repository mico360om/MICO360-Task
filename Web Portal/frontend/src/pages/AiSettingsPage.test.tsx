import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AiSettingsPage } from './AiSettingsPage';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const config = {
  providers: [{ id: 'pr1', name: 'Acme AI', kind: 'openai', apiBaseUrl: 'https://api.acme.test/v1', enabled: true, createdAt: '', updatedAt: '', hasApiKey: true, apiKeyHint: '…9f3a' }],
  models: [{ id: 'm1', providerId: 'pr1', modelKey: 'acme-large', displayName: 'acme-large', capabilities: ['chat'], parameters: {}, concurrencyLimit: 4, enabled: true, available: true, createdAt: '', updatedAt: '' }],
  defaults: {},
};

/** Requests that changed something, as "METHOD path". */
let writes: Array<{ call: string; body: unknown }>;
let failWrites: boolean;
beforeEach(() => {
  writes = [];
  failWrites = true;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    if (method === 'GET') return json({ data: config });
    writes.push({ call: `${method} ${String(url).replace(/^.*\/api\/v1/, '')}`, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return failWrites ? json({ error: { code: 'INTERNAL', message: 'Something went wrong' } }, 500) : json({ data: config });
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
    fireEvent.click(await screen.findByRole('button', { name: 'Disable acme-large' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn’t save that change/i);
  });

  it('removing a model', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Remove acme-large' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn’t remove/i);
  });

  it('deleting a provider', async () => {
    renderPage();
    await screen.findByRole('button', { name: 'Disable acme-large' });
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn’t remove/i);
  });

  it('the message goes away once the change works', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Disable acme-large' }));
    await screen.findByRole('alert');
    failWrites = false;
    fireEvent.click(screen.getByRole('button', { name: 'Disable acme-large' }));
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
