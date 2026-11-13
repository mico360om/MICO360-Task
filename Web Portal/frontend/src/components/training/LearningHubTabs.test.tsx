import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LearningHubTabs, type HubTab } from './LearningHubTabs';

const staff = vi.hoisted(() => ({ access: vi.fn() }));
vi.mock('../../api/training', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../api/training')>()), trainingApi: () => staff }));

const ACCESS = { learner: true, manager: false, admin: false, teamReports: false, overdue: 0, assigned: 0, tour: { show: false } };

function renderTabs(current: HubTab, dir?: 'rtl') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <div dir={dir}>
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <LearningHubTabs current={current} />
        </MemoryRouter>
      </QueryClientProvider>
    </div>,
  );
}
const bar = () => screen.getByRole('navigation', { name: 'Learning Hub' });
const names = () => within(bar()).getAllByRole('link').map((l) => l.textContent);

beforeEach(() => {
  staff.access.mockReset();
});

describe('the Learning Hub’s tabs', () => {
  it('everyone: My learning and All courses — real links, the open one marked', async () => {
    staff.access.mockResolvedValue(ACCESS);
    renderTabs('mine');
    await waitFor(() => expect(staff.access).toHaveBeenCalled());
    expect(names()).toEqual(['My learning', 'All courses']);
    expect(within(bar()).getByRole('link', { name: 'My learning' })).toHaveAttribute('href', '/training');
    expect(within(bar()).getByRole('link', { name: 'My learning' })).toHaveAttribute('aria-current', 'page');
    expect(within(bar()).getByRole('link', { name: 'All courses' })).toHaveAttribute('href', '/training?tab=catalogue');
    expect(within(bar()).getByRole('link', { name: 'All courses' })).not.toHaveAttribute('aria-current');
    // A finger's size on a touch screen; the row scrolls inside itself, never the page.
    expect(within(bar()).getByRole('link', { name: 'All courses' }).className).toContain('!min-h-[44px]');
    expect(bar().className).toContain('overflow-x-auto');
  });

  it('administrators and Training managers: Manage and Reports too', async () => {
    staff.access.mockResolvedValue({ ...ACCESS, manager: true });
    renderTabs('reports');
    await waitFor(() => expect(names()).toEqual(['My learning', 'All courses', 'Manage', 'Reports']));
    expect(within(bar()).getByRole('link', { name: 'Manage' })).toHaveAttribute('href', '/training/manage');
    expect(within(bar()).getByRole('link', { name: 'Reports' })).toHaveAttribute('href', '/training/manage?tab=reports');
    expect(within(bar()).getByRole('link', { name: 'Reports' })).toHaveAttribute('aria-current', 'page');
  });

  it('a project manager with team reports: Reports (their team), not Manage', async () => {
    staff.access.mockResolvedValue({ ...ACCESS, teamReports: true });
    renderTabs('catalogue');
    await waitFor(() => expect(names()).toEqual(['My learning', 'All courses', 'Reports']));
  });

  it('arrow keys, Home and End move along the tabs', async () => {
    staff.access.mockResolvedValue({ ...ACCESS, manager: true });
    renderTabs('mine');
    await waitFor(() => expect(names()).toHaveLength(4));
    within(bar()).getByRole('link', { name: 'My learning' }).focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(within(bar()).getByRole('link', { name: 'All courses' })).toHaveFocus();
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

// jsdom has no layout: a tiny model. The strip is a 300 px window at x 0..300; each tab has a natural box; scrolling by n
// moves every tab n px to the left (what a positive scrollLeft change does in either direction).
describe('the open tab is always in view', () => {
  const scroll = new WeakMap<Element, number>();
  const VIEW = { left: 0, right: 300 };
  let natural: Record<string, [number, number]> = {};
  const rectOf = (l: number, r: number) => ({ left: l, right: r, top: 0, bottom: 44, width: r - l, height: 44, x: l, y: 0, toJSON: () => ({}) }) as DOMRect;

  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.tagName === 'NAV') return rectOf(VIEW.left, VIEW.right);
      const box = natural[this.getAttribute('data-hub-tab') ?? ''] ?? [0, 0];
      const nav = this.closest('nav')!;
      const s = scroll.get(nav) ?? 0;
      return rectOf(box[0] - s, box[1] - s);
    });
    Object.defineProperty(HTMLElement.prototype, 'scrollLeft', {
      configurable: true,
      get(this: HTMLElement) {
        return scroll.get(this) ?? 0;
      },
      set(this: HTMLElement, v: number) {
        scroll.set(this, v);
      },
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    delete (HTMLElement.prototype as { scrollLeft?: number }).scrollLeft;
  });

  const FOUR = ['mine', 'catalogue', 'manage', 'reports'] as const;
  async function open(current: HubTab, dir?: 'rtl') {
    staff.access.mockResolvedValue({ ...ACCESS, manager: true });
    renderTabs(current, dir);
    await waitFor(() => expect(names()).toHaveLength(4));
  }
  const left = (k: string) => within(bar()).getByRole('link', { name: k }).getBoundingClientRect().left;
  void FOUR;

  it('the first tab open: the row sits at its start edge', async () => {
    natural = { mine: [0, 100], catalogue: [100, 200], manage: [200, 300], reports: [300, 400] };
    await open('mine');
    expect(bar().scrollLeft).toBe(0);
  });

  it('the last tab partly off the right: scrolls by exactly the overflow', async () => {
    natural = { mine: [0, 110], catalogue: [110, 220], manage: [220, 330], reports: [330, 440] };
    await open('reports');
    expect(bar().scrollLeft).toBe(140);
    expect(within(bar()).getByRole('link', { name: 'Reports' }).getBoundingClientRect().right).toBe(300);
  });

  it('a tab partly off the left: scrolls back by exactly the overflow', async () => {
    // Pretend the strip starts further along (a custom viewport) so the tab begins left of it.
    VIEW.left = 50;
    VIEW.right = 350;
    natural = { mine: [0, 100], catalogue: [100, 200], manage: [200, 300], reports: [300, 400] };
    await open('mine');
    expect(bar().scrollLeft).toBe(-50);
    expect(left('My learning')).toBe(50);
    VIEW.left = 0;
    VIEW.right = 300;
  });

  it('a fully visible open tab: no scroll at all', async () => {
    natural = { mine: [0, 100], catalogue: [100, 200], manage: [200, 300], reports: [300, 400] };
    await open('manage');
    expect(bar().scrollLeft).toBe(0);
  });

  it('starts from the start edge even when the row was scrolled before', async () => {
    natural = { mine: [0, 100], catalogue: [100, 200], manage: [200, 300], reports: [300, 400] };
    staff.access.mockResolvedValue({ ...ACCESS, manager: true });
    const { rerender } = renderTabs('catalogue');
    bar().scrollLeft = 80;
    rerender(<div />);
    await open('catalogue');
    expect(bar().scrollLeft).toBe(0);
  });

  it('right to left: the mirrored minimal move (the tab off the left edge)', async () => {
    // RTL: the first tab is at the right; the last one overflows past the left edge (negative direction).
    natural = { mine: [200, 300], catalogue: [100, 200], manage: [0, 100], reports: [-110, 0] };
    await open('reports', 'rtl');
    expect(bar().scrollLeft).toBe(-110);
    expect(left('Reports')).toBe(0);
  });

  it('right to left, first tab open: stays at the start edge', async () => {
    natural = { mine: [200, 300], catalogue: [100, 200], manage: [0, 100], reports: [-110, 0] };
    await open('mine', 'rtl');
    expect(bar().scrollLeft).toBe(0);
  });
});
