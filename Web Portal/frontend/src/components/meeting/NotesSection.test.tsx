import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NotesSection } from './NotesSection';
import { useAuthStore } from '../../stores/auth-store';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const note = (over: Record<string, unknown>) => ({
  id: 'n1', meetingId: 'm1', agendaItemId: null, authorId: 'me', type: 'DISCUSSION', body: 'Plain words', bodyFormat: 'PLAIN', highlighted: false,
  taskId: null, actionItemId: null, decisionId: null, createdAt: '2026-10-17T06:00:00.000Z', editedAt: null, ...over,
});

let notes: unknown[];
let calls: { url: string; method: string; body?: unknown }[];
let failAdd: boolean;

beforeEach(() => {
  calls = [];
  failAdd = false;
  notes = [
    note({ id: 'plain', body: 'Plain <b>as typed</b>' }),
    note({ id: 'rich', type: 'DECISION', bodyFormat: 'RICH', body: '<p><strong>Pour</strong> on Monday</p><ul><li><p>Trucks booked</p></li></ul>' }),
  ];
  useAuthStore.getState().setSession({ user: { id: 'me', email: 'me@x', username: 'me', roles: ['EMPLOYEE'] }, accessToken: 'at', refreshToken: 'rt' });
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ url: u, method, body });
    if (u.endsWith('/meetings/m1/notes') && method === 'GET') return json({ data: notes });
    if (u.endsWith('/meetings/m1/notes') && method === 'POST') {
      if (failAdd) return json({ error: { code: 'X', message: 'down' } }, 500);
      const created = note({ id: 'new', ...body, bodyFormat: body.format });
      notes = [...notes, created];
      return json({ data: created }, 201);
    }
    const patch = /\/meetings\/m1\/notes\/([^/]+)$/.exec(u);
    if (patch && method === 'PATCH') {
      const updated = { ...(notes as Array<Record<string, unknown>>).find((n) => n.id === patch[1]), ...body, bodyFormat: body.format, editedAt: '2026-10-17T07:00:00.000Z' };
      return json({ data: updated });
    }
    return json({ data: [] });
  }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  useAuthStore.setState({ user: null, accessToken: null, refreshToken: null, isAuthenticated: false });
});

function renderSection() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <NotesSection meetingId="m1" meetingProjectId={null} directory={[]} canEdit pollMs={false} timeZone="Asia/Muscat" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const composer = () => screen.getByRole('textbox', { name: 'New note' });

describe('NotesSection — formatted notes', () => {
  it('shows a formatted note with its formatting, and a plain note exactly as it was typed', async () => {
    renderSection();
    const rich = (await screen.findByText('Pour')).closest('li')!;
    expect(rich.querySelector('strong')).toHaveTextContent('Pour');
    expect(within(rich).getByText('Trucks booked').closest('ul')).not.toBeNull();
    const plain = screen.getByText('Plain <b>as typed</b>');
    expect(plain.querySelector('b')).toBeNull(); // shown as words, never as markup
  });

  it('writes a note in the formatting box and adds it formatted', async () => {
    renderSection();
    await screen.findByText('Pour');
    expect(screen.getByRole('toolbar', { name: /formatting for new note/i })).toBeInTheDocument();
    await userEvent.click(composer());
    await userEvent.type(composer(), 'Book the venue');
    await userEvent.keyboard('{Control>}a{/Control}');
    await userEvent.click(screen.getByRole('button', { name: 'Bold' }));
    await userEvent.click(screen.getByRole('button', { name: 'Add note' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    expect(calls.find((c) => c.method === 'POST')!.body).toEqual({ body: '<p><strong>Book the venue</strong></p>', format: 'RICH', type: 'DISCUSSION', highlighted: false });
    await waitFor(() => expect(composer()).toHaveTextContent(''));
  });

  it('keeps what was written when the save fails', async () => {
    failAdd = true;
    renderSection();
    await screen.findByText('Pour');
    await userEvent.click(composer());
    await userEvent.type(composer(), 'Vendor is late');
    await userEvent.click(screen.getByRole('button', { name: 'Add note' }));
    expect(await screen.findByText(/couldn’t save the note/i)).toBeInTheDocument();
    expect(composer()).toHaveTextContent('Vendor is late');
  });

  it('edits a plain note in the same box, which then keeps its formatting', async () => {
    renderSection();
    const plain = (await screen.findByText('Plain <b>as typed</b>')).closest('li')!;
    await userEvent.click(within(plain).getByRole('button', { name: 'Edit note' }));
    const box = screen.getByRole('textbox', { name: 'Edit note' });
    expect(box).toHaveTextContent('Plain <b>as typed</b>'); // its words, as words
    await userEvent.click(box);
    await userEvent.keyboard('{Control>}a{/Control}');
    await userEvent.click(within(screen.getByRole('toolbar', { name: /formatting for edit note/i })).getByRole('button', { name: 'Italic' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true));
    expect(calls.find((c) => c.method === 'PATCH')!.body).toEqual({ body: '<p><em>Plain &lt;b&gt;as typed&lt;/b&gt;</em></p>', format: 'RICH', type: 'DISCUSSION' });
  });
});
