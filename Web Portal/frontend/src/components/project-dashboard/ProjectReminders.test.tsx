import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ProjectReminders } from './ProjectReminders';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const answer = (canEdit: boolean) => ({
  scheduleId: null,
  escalationDays: null,
  schedules: [
    { id: 's1', name: 'Standard', isDefault: true, steps: { before: [2], onDue: true, after: [1], repeatEvery: 2 } },
    { id: 's2', name: 'Critical', isDefault: false, steps: { before: [5, 2, 1], onDue: true, after: [], repeatEvery: 1 } },
  ],
  companyEscalation: { step1Days: 3, step2Days: 5 },
  canEdit,
});
let canEdit = true;
let puts: unknown[];
beforeEach(() => {
  canEdit = true;
  puts = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'PUT') {
      const body = JSON.parse(String(init.body));
      puts.push(body);
      return json({ data: { ...answer(true), ...body } });
    }
    return String(url).endsWith('/projects/p1/reminders') ? json({ data: answer(canEdit) }) : json({ data: [] });
  }));
});
afterEach(() => vi.restoreAllMocks());

const renderCard = (readOnly = false, settingsAllowed = true) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ProjectReminders projectId="p1" readOnly={readOnly} settingsAllowed={settingsAllowed} />
    </QueryClientProvider>,
  );

describe('A project’s reminders', () => {
  it('picks another schedule and its own escalation steps', async () => {
    renderCard();
    const pick = await screen.findByRole('combobox', { name: 'Reminder schedule' });
    expect(screen.getByText('2 working days before · on the due morning · 1 working day after · then every 2 working days while overdue')).toBeInTheDocument();
    fireEvent.change(pick, { target: { value: 's2' } });
    fireEvent.click(screen.getByRole('switch', { name: 'Its own escalation steps' }));
    fireEvent.change(screen.getByLabelText('Step 1 (to whoever runs it) after'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save reminders' }));
    await waitFor(() => expect(puts).toEqual([{ scheduleId: 's2', escalationDays: { step1Days: 2, step2Days: 5 } }]));
    expect(await screen.findByRole('status')).toHaveTextContent('Saved.');
  });

  it('Manager View (Release B): not shown where the page says the project’s settings are closed', async () => {
    const { container } = renderCard(false, false);
    await waitFor(() => expect((fetch as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBeGreaterThan(0));
    expect(container).toBeEmptyDOMElement();
  });

  it('is not shown to people who can’t change it', async () => {
    canEdit = false;
    const { container } = renderCard();
    await waitFor(() => expect((fetch as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBeGreaterThan(0));
    expect(container).toBeEmptyDOMElement();
  });

  it('an archived project’s are shown but can’t be saved', async () => {
    renderCard(true);
    expect(await screen.findByRole('combobox', { name: 'Reminder schedule' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Save reminders' })).toBeNull();
  });
});
