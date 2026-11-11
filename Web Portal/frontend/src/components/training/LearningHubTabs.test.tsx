import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LearningHubTabs, type HubTab } from './LearningHubTabs';

const staff = vi.hoisted(() => ({ access: vi.fn() }));
vi.mock('../../api/training', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../api/training')>()), trainingApi: () => staff }));

const ACCESS = { learner: true, manager: false, admin: false, teamReports: false, overdue: 0, assigned: 0, tour: { show: false } };

function renderTabs(current: HubTab) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <LearningHubTabs current={current} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const bar = () => screen.getByRole('navigation', { name: 'Learning Hub' });
const names = () => within(bar()).getAllByRole('link').map((l) => l.textContent);

beforeEach(() => {
  staff.access.mockReset();
});

describe('the Learning Hub’s tabs', () => {
  it('everyone: My learning and Catalogue — real links, the open one marked', async () => {
    staff.access.mockResolvedValue(ACCESS);
    renderTabs('mine');
    await waitFor(() => expect(staff.access).toHaveBeenCalled());
    expect(names()).toEqual(['My learning', 'Catalogue']);
    expect(within(bar()).getByRole('link', { name: 'My learning' })).toHaveAttribute('href', '/training');
    expect(within(bar()).getByRole('link', { name: 'My learning' })).toHaveAttribute('aria-current', 'page');
    expect(within(bar()).getByRole('link', { name: 'Catalogue' })).toHaveAttribute('href', '/training?tab=catalogue');
    expect(within(bar()).getByRole('link', { name: 'Catalogue' })).not.toHaveAttribute('aria-current');
    // A finger's size on a touch screen; the row scrolls inside itself, never the page.
    expect(within(bar()).getByRole('link', { name: 'Catalogue' }).className).toContain('!min-h-[44px]');
    expect(bar().className).toContain('overflow-x-auto');
  });

  it('administrators and Training managers: Manage and Reports too', async () => {
    staff.access.mockResolvedValue({ ...ACCESS, manager: true });
    renderTabs('reports');
    await waitFor(() => expect(names()).toEqual(['My learning', 'Catalogue', 'Manage', 'Reports']));
    expect(within(bar()).getByRole('link', { name: 'Manage' })).toHaveAttribute('href', '/training/manage');
    expect(within(bar()).getByRole('link', { name: 'Reports' })).toHaveAttribute('href', '/training/manage?tab=reports');
    expect(within(bar()).getByRole('link', { name: 'Reports' })).toHaveAttribute('aria-current', 'page');
  });

  it('a project manager with team reports: Reports (their team), not Manage', async () => {
    staff.access.mockResolvedValue({ ...ACCESS, teamReports: true });
    renderTabs('catalogue');
    await waitFor(() => expect(names()).toEqual(['My learning', 'Catalogue', 'Reports']));
  });

  it('arrow keys, Home and End move along the tabs', async () => {
    staff.access.mockResolvedValue({ ...ACCESS, manager: true });
    renderTabs('mine');
    await waitFor(() => expect(names()).toHaveLength(4));
    within(bar()).getByRole('link', { name: 'My learning' }).focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(within(bar()).getByRole('link', { name: 'Catalogue' })).toHaveFocus();
    await userEvent.keyboard('{End}');
    expect(within(bar()).getByRole('link', { name: 'Reports' })).toHaveFocus();
    await userEvent.keyboard('{ArrowRight}');
    expect(within(bar()).getByRole('link', { name: 'My learning' })).toHaveFocus();
    await userEvent.keyboard('{ArrowLeft}');
    expect(within(bar()).getByRole('link', { name: 'Reports' })).toHaveFocus();
    await userEvent.keyboard('{Home}');
    expect(within(bar()).getByRole('link', { name: 'My learning' })).toHaveFocus();
  });
});
