import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useAuthStore } from '../../stores/auth-store';
import { forgetLocalAppreciations } from './useMyAppreciations';
import { AppreciationsPage } from '../../pages/AppreciationsPage';
import { ConfettiBurst } from './AppreciationArt';
import { dayShort } from '../../lib/appreciation';
import type { ApiAppreciationPerson, ApiAppreciationTemplate } from '../../api/appreciations';

// 1.24.2 Appreciations → Send: three numbered steps (People, Template, Message & day), the popup's live preview and
// the bottom action bar ("Schedule for N people on Thu 20 Nov", disabled with a reason).
const api = vi.hoisted(() => ({ me: vi.fn(), people: vi.fn(), companies: vi.fn(), templates: vi.fn(), schedule: vi.fn(), list: vi.fn() }));
vi.mock('../../api/appreciations', async (orig) => ({ ...(await orig<typeof import('../../api/appreciations')>()), appreciationsApi: () => api }));

const P = (id: string, name: string, companies: string[]): ApiAppreciationPerson => ({ id, name, avatarUrl: null, companies: companies.map((c) => ({ id: `c-${c}`, name: c })) });
const PEOPLE = [P('u-sara', 'Sara Khan', ['Contoso', 'Fabrikam', 'Northwind Traders']), P('u-ali', 'Ali Noor', ['Contoso']), P('u-zara', 'Zara Malik', ['Fabrikam'])];
const T = (id: string, name: string, over: Partial<ApiAppreciationTemplate> = {}): ApiAppreciationTemplate => ({
  id, name, title: name, message: 'Thank you, {name}, from all of {company}.', theme: 'ocean', icon: 'team', animation: 'none', builtIn: true, archived: false, updatedAt: '2026-11-01T00:00:00.000Z', ...over,
});
const TEMPLATES = [T('t1', 'Great Teamwork'), T('t2', 'Outstanding Performance', { theme: 'ruby', icon: 'trophy', message: 'Well done, {name}!' })];

function Where() {
  const l = useLocation();
  return <p data-testid="where">{l.pathname + l.search}</p>;
}
const show = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/admin/appreciations?tab=send']}>
        <Routes>
          <Route path="/admin/appreciations" element={<><AppreciationsPage /><Where /></>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
};
/** Wide (two columns) or narrow (one column, Preview folded) — and whether motion is reduced. */
function screenIs({ wide, reduce = false }: { wide: boolean; reduce?: boolean }) {
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: q.includes('min-width') ? wide : q.includes('reduce') ? reduce : false,
    media: q,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}
const row = (id: string) => document.querySelector(`[data-person="${id}"]`) as HTMLElement;
const bar = () => document.querySelector('[data-send-bar]') as HTMLElement;
const scheduleButton = () => bar().querySelector('button[data-schedule]') as HTMLButtonElement;

beforeEach(() => {
  forgetLocalAppreciations();
  for (const f of Object.values(api)) f.mockReset();
  api.me.mockResolvedValue({ canManage: true, today: '2026-11-20', serverNow: '2026-11-20T05:00:00.000Z', live: [] });
  api.people.mockResolvedValue(PEOPLE);
  api.companies.mockResolvedValue([{ id: 'c-Contoso', name: 'Contoso' }, { id: 'c-Fabrikam', name: 'Fabrikam' }]);
  api.templates.mockResolvedValue(TEMPLATES);
  api.list.mockResolvedValue({ total: 0, page: 1, pageSize: 50, rows: [] });
  useAuthStore.setState({ user: { id: 'u-omar', username: 'omar', firstName: 'Omar', lastName: 'Said', email: 'omar@contoso.test', roles: ['ADMIN'] } as never, isAuthenticated: true });
  screenIs({ wide: true });
});
afterEach(() => {
  vi.unstubAllGlobals();
  useAuthStore.setState({ user: null, isAuthenticated: false } as never);
});

describe('dayShort', () => {
  it('says the day as "Thu 20 Nov"', () => {
    expect(dayShort('2026-11-19')).toBe('Thu 19 Nov');
    expect(dayShort('2026-11-20')).toBe('Fri 20 Nov');
    expect(dayShort('2027-01-03')).toBe('Sun 3 Jan');
  });
});

describe('1. People', () => {
  it('each row: initials, the name and ONE company chip with "+N" naming all the others', async () => {
    show();
    await waitFor(() => expect(row('u-sara')).toBeTruthy());
    const sara = row('u-sara');
    expect(within(sara).getByText('Sara Khan')).toBeInTheDocument();
    expect(within(sara).getByText('Contoso')).toBeInTheDocument();
    expect(within(sara).queryByText(/Fabrikam/, { ignore: '.sr-only, script, style' })).not.toBeInTheDocument();
    expect(sara.querySelector('[data-company-chip]')).toHaveTextContent(/^Contoso$/);
    const more = sara.querySelector('[data-more-companies]')!;
    expect(more).toHaveTextContent('+2');
    expect(more.getAttribute('title')).toBe('Contoso, Fabrikam, Northwind Traders');
    expect(sara.textContent).toContain('SK'); // initials (no photo)
    expect(row('u-ali').querySelector('[data-more-companies]')).toBeNull();
  });

  it('picked people show as removable chips at the top with a count', async () => {
    show();
    await waitFor(() => expect(row('u-sara')).toBeTruthy());
    fireEvent.click(within(row('u-sara')).getByRole('checkbox'));
    fireEvent.click(within(row('u-zara')).getByRole('checkbox'));
    const chips = screen.getByRole('list', { name: 'Picked people' });
    expect(within(chips).getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByText('2 picked')).toBeInTheDocument();
    fireEvent.click(within(chips).getByRole('button', { name: 'Remove Sara Khan' }));
    expect(within(screen.getByRole('list', { name: 'Picked people' })).getAllByRole('listitem')).toHaveLength(1);
    expect(within(row('u-sara')).getByRole('checkbox')).not.toBeChecked();
    expect(screen.getByText('1 picked')).toBeInTheDocument();
  });

  it('"Select all shown" picks every listed person; "Clear" empties the list', async () => {
    show();
    await waitFor(() => expect(row('u-sara')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Select all shown' }));
    expect(screen.getByText('3 picked')).toBeInTheDocument();
    for (const id of ['u-sara', 'u-ali', 'u-zara']) expect(within(row(id)).getByRole('checkbox')).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(screen.queryByRole('list', { name: 'Picked people' })).not.toBeInTheDocument();
    expect(screen.getByText('0 picked')).toBeInTheDocument();
  });
});

describe('2. Template', () => {
  it('cards with the colour band, icon and title; the first is chosen; another fills the words', async () => {
    show();
    const group = await screen.findByRole('radiogroup', { name: 'Template' });
    const cards = within(group).getAllByRole('radio');
    expect(cards).toHaveLength(2);
    await waitFor(() => expect(within(group).getByRole('radio', { name: /Great Teamwork/ })).toBeChecked());
    expect(group.querySelectorAll('[data-template-band]')).toHaveLength(2);
    fireEvent.click(within(group).getByRole('radio', { name: /Outstanding Performance/ }));
    expect(within(group).getByRole('radio', { name: /Outstanding Performance/ })).toBeChecked();
    expect(screen.getByLabelText(/^Title/)).toHaveValue('Outstanding Performance');
    expect(screen.getByLabelText(/^Message/)).toHaveValue('Well done, {name}!');
  });

  it('"Manage templates" opens the Templates tab', async () => {
    show();
    fireEvent.click(await screen.findByRole('link', { name: 'Manage templates' }));
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('tab=templates'));
  });
});

describe('3. Message & day and the preview', () => {
  it('shows the placeholder hint and the day as "Fri 20 Nov"', async () => {
    show();
    await screen.findByRole('radiogroup', { name: 'Template' });
    expect(screen.getByText(/Use \{name\}, \{company\} and \{date\}/)).toBeInTheDocument();
    expect(screen.getByText('Fri 20 Nov')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/^Day/), { target: { value: '2026-11-26' } });
    expect(screen.getByText('Thu 26 Nov')).toBeInTheDocument();
  });

  it('previews the popup with "Name" first, then the first picked person’s name and company', async () => {
    show();
    const preview = await waitFor(() => {
      const p = document.querySelector('[data-appreciation-preview]') as HTMLElement;
      expect(p).toHaveTextContent('Great Teamwork');
      return p;
    });
    expect(preview).toHaveTextContent('Thank you, Name, from all of');
    expect(preview).toHaveTextContent('You’ve been appreciated');
    expect(preview).toHaveTextContent('From Omar Said');
    expect(within(preview).queryByRole('dialog')).toBeNull();
    fireEvent.click(within(row('u-zara')).getByRole('checkbox'));
    fireEvent.click(within(row('u-sara')).getByRole('checkbox'));
    expect(preview).toHaveTextContent('Thank you, Zara Malik, from all of Fabrikam.');
    fireEvent.change(screen.getByLabelText(/^Title/), { target: { value: 'Brilliant week' } });
    expect(preview).toHaveTextContent('Brilliant week');
    // Its buttons can't be pressed or reached: it is only a picture of the popup.
    for (const b of within(preview).queryAllByRole('button', { hidden: true })) expect(b.tabIndex).toBe(-1);
  });
});

describe('the action bar', () => {
  it('is disabled with the reason until people, a template and a message are set', async () => {
    show();
    await screen.findByRole('radiogroup', { name: 'Template' });
    await waitFor(() => expect(screen.getByLabelText(/^Message/)).not.toHaveValue(''));
    expect(scheduleButton()).toHaveAttribute('aria-disabled', 'true');
    expect(scheduleButton()).toHaveTextContent('Schedule on Fri 20 Nov');
    expect(bar()).toHaveTextContent('Pick at least one person.');
    fireEvent.click(within(row('u-sara')).getByRole('checkbox'));
    fireEvent.click(within(row('u-ali')).getByRole('checkbox'));
    expect(scheduleButton()).not.toHaveAttribute('aria-disabled');
    expect(scheduleButton()).toHaveTextContent('Schedule for 2 people on Fri 20 Nov');
    fireEvent.change(screen.getByLabelText(/^Message/), { target: { value: '  ' } });
    expect(scheduleButton()).toHaveAttribute('aria-disabled', 'true');
    expect(bar()).toHaveTextContent('Write a message.');
    const reason = bar().querySelector('[data-send-reason]')!;
    expect(scheduleButton().getAttribute('aria-describedby')).toBe(reason.id);
  });

  it('schedules for the picked people and says so (the result line is unchanged)', async () => {
    api.schedule.mockResolvedValue({ batchId: 'b1', ids: ['a1', 'a2'] });
    show();
    await screen.findByRole('radiogroup', { name: 'Template' });
    await waitFor(() => expect(screen.getByLabelText(/^Message/)).not.toHaveValue(''));
    fireEvent.click(within(row('u-sara')).getByRole('checkbox'));
    fireEvent.click(within(row('u-ali')).getByRole('checkbox'));
    expect(scheduleButton()).toHaveTextContent('Schedule for 2 people on Fri 20 Nov');
    await act(async () => fireEvent.click(scheduleButton()));
    expect(api.schedule).toHaveBeenCalledWith(expect.objectContaining({ recipientIds: ['u-sara', 'u-ali'], templateId: 't1', day: '2026-11-20', title: 'Great Teamwork' }));
    expect(await screen.findByText(/Scheduled for 2 people on 20 Nov 2026\./)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'See the history' })).toBeInTheDocument();
    expect(screen.getByText('0 picked')).toBeInTheDocument();
    // Review fix: the button stays focusable (not natively disabled), so focus isn't lost and the reason is read out.
    expect(scheduleButton()).not.toBeDisabled();
    expect(scheduleButton()).toHaveAttribute('aria-disabled', 'true');
    // Review fix: starting the next one clears the old result, so the reason shows again.
    fireEvent.click(within(row('u-zara')).getByRole('checkbox'));
    expect(screen.queryByText(/Scheduled for 2 people/)).not.toBeInTheDocument();
  });

  it('a press while blocked does nothing', async () => {
    show();
    await screen.findByRole('radiogroup', { name: 'Template' });
    fireEvent.click(scheduleButton());
    expect(api.schedule).not.toHaveBeenCalled();
  });

  it('1 person: "Schedule for 1 person on …"', async () => {
    show();
    await screen.findByRole('radiogroup', { name: 'Template' });
    await waitFor(() => expect(screen.getByLabelText(/^Message/)).not.toHaveValue(''));
    fireEvent.click(within(row('u-ali')).getByRole('checkbox'));
    expect(scheduleButton()).toHaveTextContent('Schedule for 1 person on Fri 20 Nov');
  });
});

describe('narrow screens', () => {
  it('wide: the preview sits in its own column, with no Preview toggle', async () => {
    show();
    await waitFor(() => expect(document.querySelector('[data-appreciation-preview]')).toBeTruthy());
    expect(screen.queryByRole('button', { name: 'Preview' })).not.toBeInTheDocument();
  });

  it('narrow: the preview is a folded "Preview" section above the action bar', async () => {
    screenIs({ wide: false });
    show();
    const toggle = await screen.findByRole('button', { name: 'Preview' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(document.querySelector('[data-appreciation-preview]')).toBeNull();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(document.querySelector('[data-appreciation-preview]')).toBeTruthy();
    // Above the action bar.
    expect(toggle.compareDocumentPosition(bar()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe('the preview’s confetti', () => {
  it('never plays when the person asks for less motion', () => {
    screenIs({ wide: true, reduce: true });
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext');
    render(<ConfettiBurst id="preview" animation="confetti" replay />);
    expect(getContext).not.toHaveBeenCalled();
    getContext.mockRestore();
  });

  it('replays in the preview (never marked as played on this device)', () => {
    screenIs({ wide: true, reduce: false });
    localStorage.setItem('mico360.appreciation.played.other', '1');
    localStorage.setItem('mico360.appreciation.played.preview', '1'); // a real popup would stop here
    const ctx = { scale: () => {}, clearRect: () => {} } as unknown as CanvasRenderingContext2D;
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as never);
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(1);
    render(<ConfettiBurst id="preview" animation="confetti" replay />);
    expect(getContext).toHaveBeenCalledTimes(1);
    expect(raf).toHaveBeenCalled();
    localStorage.removeItem('mico360.appreciation.played.preview');
    render(<ConfettiBurst id="preview2" animation="confetti" replay />);
    expect(localStorage.getItem('mico360.appreciation.played.preview2')).toBeNull();
    raf.mockRestore();
    getContext.mockRestore();
  });
});
