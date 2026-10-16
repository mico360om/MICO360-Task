import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
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

/** The provider card (its address also appears in the Connect form, for the OpenAI preset). */
const card = async () => within((await screen.findByText('…9999')).closest('[data-provider]') as HTMLElement);
/** Unfold the switched-off models. */
const showAll = async (user: ReturnType<typeof userEvent.setup>) => user.click(await screen.findByRole('button', { name: /show 1 more model/i }));

describe('AiSettingsPage', () => {
  it('lists providers and models, showing only the redacted key hint', async () => {
    const user = userEvent.setup();
    withQuery(<AiSettingsPage />);
    expect((await card()).getByText('https://api.openai.com/v1')).toBeInTheDocument();
    expect(screen.getByText('gpt-4o')).toBeInTheDocument();
    await showAll(user);
    expect(screen.getByText('gpt-3.5')).toBeInTheDocument();
    // the redacted key hint is shown, never a raw key
    expect(screen.getByText(/…9999/)).toBeInTheDocument();
  });

  it('adds a provider through the API', async () => {
    const user = userEvent.setup();
    withQuery(<AiSettingsPage />);
    await card();

    await user.selectOptions(screen.getByLabelText('Service'), 'ollama'); // the name and address fill in
    await user.click(screen.getByRole('button', { name: /connect & load models/i }));

    await waitFor(() => {
      const post = calls.find((c) => c.method === 'POST' && c.url.endsWith('/ai/providers'));
      expect(post).toBeTruthy();
      expect(post!.body).toMatchObject({ name: 'Ollama', kind: 'ollama', apiBaseUrl: 'http://localhost:11434' });
    });
  });

  it('toggles a model enabled state via PATCH', async () => {
    const user = userEvent.setup();
    withQuery(<AiSettingsPage />);
    await showAll(user);

    // gpt-3.5 (m2) is disabled — enable it
    await user.click(screen.getByRole('switch', { name: /use gpt-3\.5/i }));
    await waitFor(() => {
      const patch = calls.find((c) => c.method === 'PATCH' && c.url.endsWith('/ai/models/m2/enabled'));
      expect(patch).toBeTruthy();
      expect((patch!.body as { enabled: boolean }).enabled).toBe(true);
    });
  });

  it('sets a default model for a capability via PUT', async () => {
    const user = userEvent.setup();
    withQuery(<AiSettingsPage />);
    await card();
    const chatDefault = screen.getByLabelText(/default chat model/i);
    await user.selectOptions(chatDefault, 'm1');
    await waitFor(() => {
      const put = calls.find((c) => c.method === 'PUT' && c.url.endsWith('/ai/defaults/chat'));
      expect(put).toBeTruthy();
      expect((put!.body as { modelId: string }).modelId).toBe('m1');
    });
  });

  it('refreshes a provider and reports how many models it offers', async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({ method, url: String(url), body: undefined });
      if (String(url).endsWith('/ai/config')) return json({ data: config });
      if (String(url).endsWith('/ai/providers/p1/sync')) return json({ data: { detected: 5, added: 2, config } });
      return json({ data: config });
    });
    const user = userEvent.setup();
    withQuery(<AiSettingsPage />);
    await card();

    // one provider → one refresh button
    await user.click(screen.getByRole('button', { name: /refresh models/i }));
    await waitFor(() => expect(screen.getByText('5 models offered · 2 new')).toBeInTheDocument());
  });
});
