import { describe, it, expect, afterEach, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { ArchivedProjectNotice } from './ArchivedProjectNotice';
import { useArchivedNoticeStore } from '../../stores/archived-notice-store';
import { apiClient } from '../../api/client';

const SENTENCE = 'This project is archived — reopen it first.';

function Go() {
  const navigate = useNavigate();
  return <button type="button" onClick={() => navigate('/elsewhere')}>Go elsewhere</button>;
}
const renderIt = () =>
  render(
    <MemoryRouter initialEntries={['/board?project=p1']}>
      <ArchivedProjectNotice />
      <Go />
    </MemoryRouter>,
  );

afterEach(() => {
  act(() => useArchivedNoticeStore.getState().dismiss());
  vi.unstubAllGlobals();
});

describe('“This project is archived — reopen it first.” across the page (1.22)', () => {
  it('shows nothing until the server refuses a change', () => {
    renderIt();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('says the server’s sentence when the app’s client is refused, until dismissed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { code: 'PROJECT_ARCHIVED', message: SENTENCE } }), { status: 409, headers: { 'content-type': 'application/json' } })));
    renderIt();
    await act(async () => {
      await apiClient.patch('/tasks/t1/move', { columnId: 'c1' }).catch(() => undefined);
    });
    expect(screen.getByRole('alert')).toHaveTextContent(SENTENCE);
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('goes when the page changes', async () => {
    renderIt();
    act(() => useArchivedNoticeStore.getState().show(SENTENCE));
    expect(screen.getByRole('alert')).toHaveTextContent(SENTENCE);
    await userEvent.click(screen.getByRole('button', { name: 'Go elsewhere' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('other refusals are left to the part of the page that asked', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { code: 'VERSION_CONFLICT', message: 'Someone else changed it.' } }), { status: 409, headers: { 'content-type': 'application/json' } })));
    renderIt();
    await act(async () => {
      await apiClient.put('/tasks/t1', { title: 'x' }).catch(() => undefined);
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
