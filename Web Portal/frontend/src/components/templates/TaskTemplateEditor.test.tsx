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
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Add an item to “Checklist”' }), 'Gate{Enter}Fence');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create template' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    // 1.23.3: the checklists with titles and nesting, and the old flat list beside them.
    expect(requests.find((r) => r.method === 'POST')!.body).toMatchObject({
      name: 'Site check',
      title: 'Check the site',
      checklist: ['Gate', 'Fence'],
      checklists: [{ title: 'Checklist', items: [{ text: 'Gate' }, { text: 'Fence' }] }],
    });
  });

  it('closing with only half-typed checklist text asks first', async () => {
    const { onClose, dialog } = renderEditor();
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Add an item to “Checklist”' }), 'Gate');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('alertdialog', { name: 'Discard your changes?' })).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('Task template editor: nested checklists (1.23.3)', () => {
  it('shows a template’s checklists with their titles and nesting, and saves them as they are', async () => {
    const template = {
      id: 'tk3',
      name: 'Fit-out',
      title: 'Fit-out check',
      description: null,
      priority: 'NORMAL' as const,
      checklist: ['Wiring', 'Label circuits', 'Pipes'],
      checklists: [
        { title: 'Electrical', items: [{ text: 'Wiring', children: [{ text: 'Label circuits' }] }] },
        { title: 'Plumbing', items: [{ text: 'Pipes' }] },
      ],
      createdById: 'a',
      createdByName: 'A',
      canManage: true,
      createdAt: '',
      updatedAt: '',
    };
    const onClose = vi.fn();
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <TaskTemplateEditor template={template} onClose={onClose} />
      </QueryClientProvider>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Edit task template' });
    expect(within(dialog).getAllByTestId('checklist-card')).toHaveLength(2);
    const label = within(dialog).getAllByTestId('checklist-item').find((li) => li.querySelector(':scope > [data-row]')?.textContent?.includes('Label circuits'))!;
    expect(label).toHaveAttribute('data-depth', '1');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save template' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(requests.find((r) => r.method === 'PUT')!.body).toMatchObject({ checklists: template.checklists, checklist: ['Wiring', 'Label circuits', 'Pipes'] });
  });
});
