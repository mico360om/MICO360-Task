import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AiSettingsPage } from './AiSettingsPage';
import { useAuthStore } from '../stores/auth-store';
import type { AiConfig } from '../api/ai';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function withQuery(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const config: AiConfig = {
  providers: [
    { id: 'p1', name: 'OpenAI', kind: 'openai', apiBaseUrl: 'https://api.openai.com/v1', enabled: true, createdAt: 't', updatedAt: 't', hasApiKey: true, apiKeyHint: '…9999' },
  ],
  models: [
    { id: 'm1', providerId: 'p1', modelKey: 'gpt-4o', displayName: 'GPT-4o', capabilities: ['chat', 'vision'], parameters: {}, concurrencyLimit: 4, enabled: true, available: true, createdAt: 't', updatedAt: 't' },
    { id: 'm2', providerId: 'p1', modelKey: 'gpt-3.5', displayName: 'GPT-3.5', capabilities: ['chat'], parameters: {}, concurrencyLimit: 4, enabled: false, available: true, createdAt: 't', updatedAt: 't' },
  ],
  defaults: {},
};

let fetchMock: ReturnType<typeof vi.fn>;
const calls: { method: string; url: string; body: unknown }[] = [];

beforeEach(() => {
  calls.length = 0;
  useAuthStore.getState().setSession({ user: { id: 'u1', email: 'a@x.co', username: 'admin', roles: ['ADMIN'] }, accessToken: 'at', refreshToken: 'rt' });
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(init.body as string) : undefined;
    calls.push({ method, url: String(url), body });
    if (String(url).endsWith('/ai/config')) return json({ data: config });
    // every mutation returns a config for the page to re-render from
    return json({ data: config });
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.restoreAllMocks();
  useAuthStore.getState().logout();
});

describe('AiSettingsPage', () => {
  it('lists providers and models, showing only the redacted key hint', async () => {
    withQuery(<AiSettingsPage />);
    await screen.findByText('https://api.openai.com/v1');
    expect(screen.getByText('gpt-4o')).toBeInTheDocument();
    expect(screen.getByText('gpt-3.5')).toBeInTheDocument();
    // the redacted key hint is shown, never a raw key
    expect(screen.getByText(/…9999/)).toBeInTheDocument();
  });

  it('adds a provider through the API', async () => {
    const user = userEvent.setup();
    withQuery(<AiSettingsPage />);
    await screen.findByText('https://api.openai.com/v1');

    await user.type(screen.getByLabelText(/provider name/i), 'Ollama');
    await user.type(screen.getByLabelText(/api base url/i), 'http://localhost:11434');
    await user.click(screen.getByRole('button', { name: /add provider/i }));

    await waitFor(() => {
      const post = calls.find((c) => c.method === 'POST' && c.url.endsWith('/ai/providers'));
      expect(post).toBeTruthy();
      expect((post!.body as { name: string }).name).toBe('Ollama');
    });
  });

  it('toggles a model enabled state via PATCH', async () => {
    const user = userEvent.setup();
    withQuery(<AiSettingsPage />);
    await waitFor(() => expect(screen.getByText('gpt-3.5')).toBeInTheDocument());

    // gpt-3.5 (m2) is disabled — enable it
    await user.click(screen.getByRole('button', { name: /enable gpt-3\.5/i }));
    await waitFor(() => {
      const patch = calls.find((c) => c.method === 'PATCH' && c.url.endsWith('/ai/models/m2/enabled'));
      expect(patch).toBeTruthy();
      expect((patch!.body as { enabled: boolean }).enabled).toBe(true);
    });
  });

  it('sets a default model for a capability via PUT', async () => {
    const user = userEvent.setup();
    withQuery(<AiSettingsPage />);
    await screen.findByText('https://api.openai.com/v1');
    const chatDefault = screen.getByLabelText(/default chat model/i);
    await user.selectOptions(chatDefault, 'm1');
    await waitFor(() => {
      const put = calls.find((c) => c.method === 'PUT' && c.url.endsWith('/ai/defaults/chat'));
      expect(put).toBeTruthy();
      expect((put!.body as { modelId: string }).modelId).toBe('m1');
    });
  });

  it('syncs a provider and reports how many models were detected', async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({ method, url: String(url), body: undefined });
      if (String(url).endsWith('/ai/config')) return json({ data: config });
      if (String(url).endsWith('/ai/providers/p1/sync')) return json({ data: { detected: 5, added: 2, config } });
      return json({ data: config });
    });
    const user = userEvent.setup();
    withQuery(<AiSettingsPage />);
    await screen.findByText('https://api.openai.com/v1');

    // one provider → one sync button
    await user.click(screen.getByRole('button', { name: /sync models/i }));
    await waitFor(() => expect(screen.getByText(/2 added/i)).toBeInTheDocument());
  });
});
