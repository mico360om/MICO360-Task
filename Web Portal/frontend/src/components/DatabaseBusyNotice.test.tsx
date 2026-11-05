import { describe, it, expect, afterEach, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { DatabaseBusyNotice } from './DatabaseBusyNotice';
import { useDatabaseBusyStore } from '../stores/database-busy-store';
import { apiClient } from '../api/client';

// 1.23.1 — a database blip on the server (a deploy restart) answers 503 DATABASE_BUSY: the page says the
// server's words across the top, whatever part of the page asked ("Couldn’t load …" says no more).
const WORDS = 'The database is busy — please try again in a moment.';
function Go() {
  const navigate = useNavigate();
  return <button type="button" onClick={() => navigate('/elsewhere')}>Go elsewhere</button>;
}
const renderIt = () =>
  render(
    <MemoryRouter initialEntries={['/board']}>
      <DatabaseBusyNotice />
      <Go />
    </MemoryRouter>,
  );
afterEach(() => {
  act(() => useDatabaseBusyStore.getState().dismiss());
  vi.unstubAllGlobals();
});

describe('“The database is busy — please try again in a moment.” across the page', () => {
  it('shows nothing until the server says so', () => {
    renderIt();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('says the server’s words when a read gets DATABASE_BUSY, until dismissed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { code: 'DATABASE_BUSY', message: WORDS } }), { status: 503, headers: { 'content-type': 'application/json' } })));
    renderIt();
    await act(async () => {
      await apiClient.get('/tasks').catch(() => undefined);
    });
    expect(screen.getByRole('status')).toHaveTextContent(WORDS);
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('goes when the page changes', async () => {
    renderIt();
    act(() => useDatabaseBusyStore.getState().show(WORDS));
    expect(screen.getByRole('status')).toHaveTextContent(WORDS);
    await userEvent.click(screen.getByRole('button', { name: 'Go elsewhere' }));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
