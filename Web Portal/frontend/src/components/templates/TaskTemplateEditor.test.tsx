import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TaskTemplateEditor } from './TaskTemplateEditor';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
let requests: { url: string; method: string; body?: unknown }[];

beforeEach(() => {
  requests = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    requests.push({ url: String(url), method, body });
    if (method === 'POST') return json({ data: { id: 'tkNew', ...(body as object) } }, 201);
    return json({ data: [] });
  }));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function renderEditor() {
  const onClose = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <TaskTemplateEditor template={null} onClose={onClose} />
    </QueryClientProvider>,
  );
  return { onClose, dialog: screen.getByRole('dialog', { name: 'New task template' }) };
}

describe('Task template editor', () => {
  it('Enter in the name or the title neither saves nor closes it', async () => {
    const { onClose, dialog } = renderEditor();
    await userEvent.type(within(dialog).getByLabelText(/^Template name/), 'Site check{Enter}');
    await userEvent.type(within(dialog).getByLabelText(/^Task title/), 'Check the site{Enter}');
    expect(requests.filter((r) => r.method === 'POST')).toHaveLength(0);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('checklist text typed but not added is saved, and counts as a change', async () => {
    const { onClose, dialog } = renderEditor();
    await userEvent.type(within(dialog).getByLabelText(/^Template name/), 'Site check');
    await userEvent.type(within(dialog).getByLabelText(/^Task title/), 'Check the site');
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Add a checklist item' }), 'Gate{Enter}Fence');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create template' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(requests.find((r) => r.method === 'POST')!.body).toMatchObject({ name: 'Site check', title: 'Check the site', checklist: ['Gate', 'Fence'] });
  });

  it('closing with only half-typed checklist text asks first', async () => {
    const { onClose, dialog } = renderEditor();
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Add a checklist item' }), 'Gate');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('alertdialog', { name: 'Discard your changes?' })).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});
