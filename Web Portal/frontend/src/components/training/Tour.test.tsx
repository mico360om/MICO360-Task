import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StaffTour, placeCard } from './Tour';
import { useTourStore } from './tour-store';

const staff = vi.hoisted(() => ({ access: vi.fn(), tourDone: vi.fn() }));
vi.mock('../../api/training', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../api/training')>()), trainingApi: () => staff }));

const ACCESS = { learner: true, manager: false, admin: false, teamReports: false, overdue: 0, assigned: 0, tour: { show: true } };

/** A part of the page the tour points at, laid out on the screen (jsdom does no layout). */
function placed(name: string, rect: DOMRect) {
  const el = document.createElement('button');
  el.dataset.tour = name;
  el.textContent = name;
  el.getBoundingClientRect = () => rect;
  el.getClientRects = () => [rect] as unknown as DOMRectList;
  document.body.appendChild(el);
  return el;
}

function renderTour() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <button type="button">On the page</button>
        <StaffTour />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  staff.access.mockReset().mockResolvedValue(ACCESS);
  staff.tourDone.mockReset().mockResolvedValue({ ok: true });
  useTourStore.setState({ open: false, autoShown: false });
});
afterEach(() => {
  document.querySelectorAll('[data-tour]').forEach((el) => el.remove());
});

describe('the first-time tour (staff)', () => {
  it('opens by itself for a new account: six steps, each pointing at its part; a part not on screen gets a card in the middle', async () => {
    placed('menu', new DOMRect(0, 0, 240, 800));
    placed('new-task', new DOMRect(900, 10, 100, 40));
    renderTour();
    const dialog = await screen.findByRole('dialog', { name: 'The side menu' });
    expect(dialog).toHaveFocus();
    expect(screen.getByText('Step 1 of 6')).toBeInTheDocument();
    expect(document.querySelector('[data-tour-spot]')).not.toBeNull();
    expect(dialog).toHaveAttribute('data-tour-card', 'beside');
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByRole('dialog', { name: 'My Tasks' })).toHaveAttribute('data-tour-card', 'centre');
    expect(screen.getByRole('heading', { name: 'My Tasks' })).toHaveFocus();
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('Step 3 of 6')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'New task' })).toHaveAttribute('data-tour-card', 'beside');
    await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByText('Step 2 of 6')).toBeInTheDocument();
  });

  it('Escape skips it; the server is told (it won’t open by itself again)', async () => {
    renderTour();
    await screen.findByRole('dialog', { name: 'The side menu' });
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(staff.tourDone).toHaveBeenCalledTimes(1));
  });

  it('Finish on the last step; Skip tour anywhere', async () => {
    renderTour();
    await screen.findByRole('dialog');
    for (let i = 0; i < 5; i++) await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByRole('dialog', { name: 'My training' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Finish' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(staff.tourDone).toHaveBeenCalledTimes(1));
  });

  it('not for an older account — until they ask for it (“Take the tour”)', async () => {
    staff.access.mockResolvedValue({ ...ACCESS, tour: { show: false } });
    renderTour();
    await waitFor(() => expect(staff.access).toHaveBeenCalled());
    expect(screen.queryByRole('dialog')).toBeNull();
    act(() => useTourStore.getState().start());
    expect(await screen.findByRole('dialog', { name: 'The side menu' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Skip tour' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('the card goes beside a menu, under a top-bar button, always inside the window', () => {
    // A menu on the left: to its right.
    expect(placeCard({ top: 100, left: 0, right: 240, bottom: 140, width: 240 }, 1280, 800, 200)).toEqual({ top: 100, left: 252 });
    // A top-bar button on the right: under it, kept inside.
    expect(placeCard({ top: 10, left: 1200, right: 1260, bottom: 50, width: 60 }, 1280, 800, 200)).toEqual({ top: 62, left: 944 });
    // On a phone (375px): the card fits the width, under the bell.
    expect(placeCard({ top: 6, left: 300, right: 344, bottom: 50, width: 44 }, 375, 700, 200)).toEqual({ top: 62, left: 39 });
    // Near the bottom: above it.
    expect(placeCard({ top: 700, left: 500, right: 600, bottom: 740, width: 100 }, 1280, 800, 200).top).toBe(488);
  });
});
