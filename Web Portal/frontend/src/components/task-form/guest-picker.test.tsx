import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useState } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AssignModeSwitch, GuestPicker, NewGuestForm, type AssignMode } from './guest-picker';
import { GUEST_WORDS } from '../../lib/guest-contacts';

// 1.24 Guests: the Assign box's "Internal user | Guest" switch, the guest list search and the New guest form
// (with the duplicate check), shared by the task form and the task panel.

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
const guest = (id: string, name: string, company: string | null, extra: Record<string, unknown> = {}) => ({
  id, companyId: 'co1', name, company, designation: null, email: null, phone: null, notes: null, retiredAt: null, mergedIntoId: null, createdById: 'u1', createdAt: '', updatedAt: '', ...extra,
});
const AHMED = guest('g1', 'Ahmed Al Harthy', 'Acme', { email: 'ahmed@acme.com', phone: '+968 9912 3456' });
const SARA = guest('g2', 'Sara Nasser', 'PDO');

type Call = { url: string; method: string; body: Record<string, unknown> | null };
let calls: Call[];
let checkReply: (body: Record<string, unknown>) => unknown;
let createReply: (body: Record<string, unknown>) => Response;
beforeEach(() => {
  calls = [];
  checkReply = () => ({ same: [], similar: [] });
  createReply = (body) => json({ data: guest('g9', String(body.name), (body.company as string) ?? null) }, 201);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      const method = init?.method ?? 'GET';
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
      calls.push({ url: u, method, body });
      if (u.includes('/projects/p1/guests/check')) return json({ data: checkReply(body ?? {}) });
      if (u.includes('/projects/p1/guests') && method === 'POST') return createReply(body ?? {});
      if (u.includes('/projects/p1/guests')) {
        const q = new URL(u).searchParams.get('q')?.toLowerCase() ?? '';
        return json({ data: [AHMED, SARA].filter((g) => !q || `${g.name} ${g.company} ${g.email ?? ''}`.toLowerCase().includes(q)) });
      }
      return json({ data: [] });
    }),
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('AssignModeSwitch', () => {
  function Switch() {
    const [mode, setMode] = useState<AssignMode>('internal');
    return (
      <>
        <AssignModeSwitch mode={mode} onChange={setMode} />
        <p>mode: {mode}</p>
      </>
    );
  }
  it('is a two-way switch, "Internal user | Guest", by click and by arrow keys', async () => {
    render(<Switch />);
    const group = screen.getByRole('radiogroup', { name: GUEST_WORDS.modeLabel });
    const internal = within(group).getByRole('radio', { name: 'Internal user' });
    const guestMode = within(group).getByRole('radio', { name: 'Guest' });
    expect(internal).toHaveAttribute('aria-checked', 'true');
    expect(guestMode).toHaveAttribute('aria-checked', 'false');
    // Only the chosen one is a Tab stop (the radio group pattern).
    expect(internal).toHaveAttribute('tabindex', '0');
    expect(guestMode).toHaveAttribute('tabindex', '-1');
    await userEvent.click(guestMode);
    expect(screen.getByText('mode: guest')).toBeInTheDocument();
    expect(guestMode).toHaveAttribute('aria-checked', 'true');
    guestMode.focus();
    await userEvent.keyboard('{ArrowLeft}');
    expect(screen.getByText('mode: internal')).toBeInTheDocument();
    expect(internal).toHaveFocus();
  });
});

describe('GuestPicker', () => {
  it('searches the project’s company guest list and picks one (those already picked aren’t offered)', async () => {
    const onPick = vi.fn();
    render(<GuestPicker projectId="p1" exclude={['g2']} onPick={onPick} />);
    const box = screen.getByRole('combobox', { name: GUEST_WORDS.search });
    await userEvent.click(box);
    expect(await screen.findByRole('option', { name: /^Ahmed Al Harthy \(Acme\)/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Sara Nasser/ })).toBeNull();
    await userEvent.type(box, 'acme');
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/projects/p1/guests?q=acme'))).toBe(true));
    // Its email and phone help tell people apart.
    expect(await screen.findByRole('option', { name: /ahmed@acme\.com/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('option', { name: /^Ahmed Al Harthy/ }));
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ id: 'g1', name: 'Ahmed Al Harthy', company: 'Acme' }));
  });

  it('says when nobody on the list matches', async () => {
    render(<GuestPicker projectId="p1" exclude={[]} onPick={vi.fn()} />);
    const box = screen.getByRole('combobox', { name: GUEST_WORDS.search });
    await userEvent.click(box);
    await userEvent.type(box, 'zzz');
    expect(await screen.findByText(GUEST_WORDS.noMatch)).toBeInTheDocument();
  });

  it('“+ New guest” opens the New guest form with what was typed as the name; adding it picks them', async () => {
    const onPick = vi.fn();
    render(<GuestPicker projectId="p1" exclude={[]} onPick={onPick} />);
    await userEvent.type(screen.getByRole('combobox', { name: GUEST_WORDS.search }), 'Huda');
    await userEvent.click(screen.getByRole('button', { name: GUEST_WORDS.newGuest }));
    const form = screen.getByRole('group', { name: GUEST_WORDS.newGuest });
    expect(within(form).getByRole('textbox', { name: /^Name/ })).toHaveValue('Huda');
    await userEvent.type(within(form).getByRole('textbox', { name: 'Company' }), 'Daleel');
    await userEvent.click(within(form).getByRole('button', { name: 'Add guest' }));
    await waitFor(() => expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ id: 'g9', name: 'Huda', company: 'Daleel' })));
    const create = calls.find((c) => c.method === 'POST' && c.url.endsWith('/projects/p1/guests'))!;
    expect(create.body).toEqual({ name: 'Huda', company: 'Daleel', designation: null, email: null, phone: null });
    // Back to the search.
    expect(screen.queryByRole('group', { name: GUEST_WORDS.newGuest })).toBeNull();
  });

  it('a task with the most guests offers no more', () => {
    render(<GuestPicker projectId="p1" exclude={Array.from({ length: 20 }, (_, i) => `x${i}`)} onPick={vi.fn()} />);
    expect(screen.getByText(GUEST_WORDS.full)).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: GUEST_WORDS.search })).toBeNull();
  });
});

describe('NewGuestForm', () => {
  const renderForm = (props: Partial<React.ComponentProps<typeof NewGuestForm>> = {}) => {
    const onDone = vi.fn();
    const onCancel = vi.fn();
    render(<NewGuestForm projectId="p1" onDone={onDone} onCancel={onCancel} {...props} />);
    return { onDone, onCancel, form: screen.getByRole('group', { name: GUEST_WORDS.newGuest }) };
  };

  it('checks the fields first and shows each problem at its field (nothing is sent)', async () => {
    const { form, onDone } = renderForm();
    await userEvent.type(within(form).getByRole('textbox', { name: 'Email' }), 'not-an-email');
    await userEvent.click(within(form).getByRole('button', { name: 'Add guest' }));
    const name = within(form).getByRole('textbox', { name: /^Name/ });
    expect(name).toHaveAttribute('aria-invalid', 'true');
    expect(within(form).getByText('Enter the guest’s name.')).toBeInTheDocument();
    expect(within(form).getByRole('textbox', { name: 'Email' })).toHaveAttribute('aria-invalid', 'true');
    expect(name).toHaveFocus();
    expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/projects/p1/guests'))).toBe(false);
    expect(onDone).not.toHaveBeenCalled();
  });

  it('the same person already on the list: “… is already on the list — use them?”, and Use them picks the one on the list', async () => {
    checkReply = (body) => (String(body.name).toLowerCase().startsWith('ahmed') ? { same: [AHMED], similar: [] } : { same: [], similar: [] });
    const { form, onDone } = renderForm();
    await userEvent.type(within(form).getByRole('textbox', { name: /^Name/ }), 'Ahmed Al Harthy');
    await userEvent.type(within(form).getByRole('textbox', { name: 'Company' }), 'acme');
    expect(await within(form).findByText(GUEST_WORDS.useExisting('Ahmed Al Harthy (Acme)'))).toBeInTheDocument();
    const check = calls.filter((c) => c.url.endsWith('/projects/p1/guests/check')).at(-1)!;
    expect(check.body).toMatchObject({ name: 'Ahmed Al Harthy', company: 'acme' });
    await userEvent.click(within(form).getByRole('button', { name: GUEST_WORDS.useThem }));
    expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ id: 'g1' }));
    expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/projects/p1/guests'))).toBe(false);
  });

  it('“No, add a new guest” adds them anyway (confirmNew)', async () => {
    checkReply = () => ({ same: [AHMED], similar: [] });
    const { form, onDone } = renderForm({ initialName: 'Ahmed Al Harthy' });
    await userEvent.type(within(form).getByRole('textbox', { name: 'Company' }), 'Acme');
    await userEvent.click(await within(form).findByRole('button', { name: GUEST_WORDS.addAnyway }));
    expect(within(form).queryByText(GUEST_WORDS.useExisting('Ahmed Al Harthy (Acme)'))).toBeNull();
    await userEvent.click(within(form).getByRole('button', { name: 'Add guest' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    const create = calls.find((c) => c.method === 'POST' && c.url.endsWith('/projects/p1/guests'))!;
    expect(create.body).toMatchObject({ name: 'Ahmed Al Harthy', company: 'Acme', confirmNew: true });
  });

  it('guests with the same name but other details are listed softly, each can be used', async () => {
    checkReply = () => ({ same: [], similar: [SARA] });
    const { form, onDone } = renderForm({ initialName: 'Sara Nasser' });
    await userEvent.type(within(form).getByRole('textbox', { name: 'Company' }), 'Shell');
    expect(await within(form).findByText(GUEST_WORDS.similar)).toBeInTheDocument();
    await userEvent.click(within(form).getByRole('button', { name: 'Use Sara Nasser (PDO)' }));
    expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ id: 'g2' }));
  });

  it('the server finds the same person (409 GUEST_DUPLICATE): offers them, and “add anyway” resends with confirmNew', async () => {
    let refused = false;
    createReply = (body) => {
      if (!body.confirmNew) {
        refused = true;
        return json({ error: { code: 'GUEST_DUPLICATE', message: GUEST_WORDS.useExisting('Ahmed Al Harthy (Acme)'), details: { matches: [AHMED] } } }, 409);
      }
      return json({ data: guest('g10', 'Ahmed Al Harthy', 'Acme') }, 201);
    };
    const { form, onDone } = renderForm({ initialName: 'Ahmed Al Harthy' });
    await userEvent.type(within(form).getByRole('textbox', { name: 'Company' }), 'Acme{Enter}');
    await waitFor(() => expect(refused).toBe(true));
    expect(await within(form).findByText(GUEST_WORDS.useExisting('Ahmed Al Harthy (Acme)'))).toBeInTheDocument();
    expect(onDone).not.toHaveBeenCalled();
    await userEvent.click(within(form).getByRole('button', { name: GUEST_WORDS.addAnyway }));
    await userEvent.click(within(form).getByRole('button', { name: 'Add guest' }));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ id: 'g10' })));
    expect(calls.filter((c) => c.method === 'POST' && c.url.endsWith('/projects/p1/guests')).at(-1)!.body).toMatchObject({ confirmNew: true });
  });

  it('Enter in a box adds the guest (never submits a form around it); Cancel closes', async () => {
    const outer = vi.fn((e: React.FormEvent) => e.preventDefault());
    const onDone = vi.fn();
    const onCancel = vi.fn();
    render(
      <form onSubmit={outer}>
        <NewGuestForm projectId="p1" initialName="Huda" onDone={onDone} onCancel={onCancel} />
      </form>,
    );
    await userEvent.type(screen.getByRole('textbox', { name: 'Phone' }), '+968 2222{Enter}');
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(outer).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalled();
  });

  it('marks itself unsaved once something is typed (the task panel asks before stepping away)', async () => {
    const { form } = renderForm();
    expect(form).not.toHaveAttribute('data-unsaved');
    await userEvent.type(within(form).getByRole('textbox', { name: 'Company' }), 'Acme');
    expect(form).toHaveAttribute('data-unsaved', 'true');
  });
});
