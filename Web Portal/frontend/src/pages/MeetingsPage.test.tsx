import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { MeetingsPage } from './MeetingsPage';
import { useAuthStore } from '../stores/auth-store';
import { shiftDayKey, todayKey } from '../lib/due-date';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const TZ = 'Asia/Muscat';
const today = todayKey(TZ);
/** A Muscat wall-clock time on a day relative to today, as an ISO instant. */
const at = (days: number, hhmm: string) => new Date(`${shiftDayKey(today, days)}T${hhmm}:00+04:00`).toISOString();

const meeting = (over: Record<string, unknown>) => ({
  id: 'm', title: 'Meeting', description: null, category: null, status: 'SCHEDULED', projectId: null, organizerId: 'u1',
  location: null, onlineLink: null, startAt: at(0, '10:00'), endAt: at(0, '11:00'), timeZone: TZ, recurrenceRule: null,
  recurrenceParentId: null, templateId: null, transcript: null, invitesSentAt: null, reminderSentAt: null, createdById: 'u1',
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', canEdit: true, attendeeCount: 0, openActionItemCount: 0, ...over,
});

let calls: { url: string; method: string }[];
let meetings: unknown[];
let failList: boolean;

beforeEach(() => {
  calls = [];
  failList = false;
  meetings = [
    meeting({ id: 'budget', title: 'Budget review', projectId: 'p1', attendeeCount: 6, openActionItemCount: 2, attendees: ['Aisha Khan', 'Omar Said', 'Sara Ali', 'Bilal Aziz'], minutes: 'FINAL', decisionCount: 3 }),
    meeting({ id: 'arabic', title: 'اجتماع الميزانية', startAt: at(2, '09:00'), endAt: at(2, '10:00'), organizerId: 'u2' }),
    meeting({ id: 'draft', title: 'Hiring plan', status: 'DRAFT', startAt: at(5, '09:00'), endAt: null }),
    meeting({ id: 'retro', title: 'Sprint retro', status: 'COMPLETED', startAt: at(-3, '09:00'), endAt: at(-3, '10:00') }),
  ];
  useAuthStore.getState().setSession({ user: { id: 'u1', email: 'a@x', username: 'aisha', roles: ['EMPLOYEE'] }, accessToken: 'at', refreshToken: 'rt' });
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? 'GET';
    calls.push({ url: u, method });
    if (u.endsWith('/config')) return json({ data: { timeZone: TZ, productName: '', companyName: '', serverTime: new Date().toISOString() } });
    if (/\/meetings(\?.*)?$/.test(u) && method === 'GET') return failList ? json({ error: { code: 'X', message: 'down' } }, 500) : json({ data: meetings });
    if (u.endsWith('/projects')) return json({ data: [{ id: 'p1', name: 'Falcon CRM', code: 'FAL', color: '#0F766E', icon: 'chart' }] });
    if (u.endsWith('/users/directory')) return json({ data: [{ id: 'u1', username: 'aisha', firstName: 'Aisha', lastName: 'Khan' }, { id: 'u2', username: 'omar', firstName: 'Omar', lastName: 'Said' }] });
    if (u.endsWith('/cancel') && method === 'POST') return json({ data: meeting({ status: 'CANCELLED' }) });
    return json({ data: [] });
  }));
});
afterEach(() => {
  vi.restoreAllMocks();
  useAuthStore.setState({ user: null, accessToken: null, refreshToken: null, isAuthenticated: false });
});

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={['/meetings']}>
      <QueryClientProvider client={qc}>
        <Routes>
          <Route path="/meetings" element={<MeetingsPage />} />
          <Route path="/meetings/:id" element={<p>Opened meeting</p>} />
        </Routes>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

// The card's own link (with nothing coming up, the panel on top links to the last meeting too).
const rowOf = async (title: string) => (await screen.findAllByRole('link', { name: title })).map((l) => l.closest('[data-meeting-card]')).find(Boolean) as HTMLElement;

describe('MeetingsPage', () => {
  it('shows each meeting as a card: day, time, project, organizer, people, minutes, decisions and open action items', async () => {
    renderPage();
    const card = await rowOf('Budget review');
    await waitFor(() => expect(card).toHaveTextContent('Falcon CRM'));
    const time = (iso: string) => new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', timeZone: TZ }).format(new Date(iso));
    expect(card).toHaveTextContent(`${time(at(0, '10:00'))} – ${time(at(0, '11:00'))}`);
    await waitFor(() => expect(card).toHaveTextContent('Aisha Khan'));
    // The first faces, and how many more.
    for (const name of ['Aisha Khan', 'Omar Said', 'Sara Ali']) expect(within(card).getByLabelText(name)).toBeInTheDocument();
    expect(card).toHaveTextContent('+3');
    expect(card).toHaveTextContent('6 people');
    expect(card).toHaveTextContent('Final minutes');
    expect(card).toHaveTextContent('3 decisions');
    expect(card).toHaveTextContent(/2 open/);
    expect(card.querySelector('[data-project-avatar="icon"]')).not.toBeNull(); // the project's own picture
    expect(await rowOf('Hiring plan')).toHaveTextContent('Standalone');
    // A plain scheduled meeting needs no badge; any other status says so.
    expect(card).not.toHaveTextContent('Scheduled');
    expect(await rowOf('Sprint retro')).toHaveTextContent('Completed');
  });

  it('keeps stacked faces readable: each sits on a solid backing, so the one behind never shows through', async () => {
    renderPage();
    const card = await rowOf('Budget review');
    for (const name of ['Aisha Khan', 'Omar Said', 'Sara Ali']) expect(within(card).getByLabelText(name).parentElement!.className).toMatch(/(^|\s)bg-surface(\s|$)/);
  });

  it('lets the organizer move under the project instead of shrinking to a letter', async () => {
    renderPage();
    const card = await rowOf('Budget review');
    await waitFor(() => expect(card).toHaveTextContent('Aisha Khan'));
    const organizer = within(card).getByTitle('Organizer');
    expect(organizer.parentElement!.className).toMatch(/flex-wrap/);
  });

  it('groups meetings into Today, Next 7 days, Drafts and Past', async () => {
    renderPage();
    await rowOf('Budget review');
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual([expect.stringMatching(/^Today/), expect.stringMatching(/^Next 7 days/), expect.stringMatching(/^Drafts/), expect.stringMatching(/^Past/)]);
  });

  it('features the next meeting on top, with Join for an online one — and steps aside while you filter', async () => {
    const start = Date.now() + 25.5 * 60_000;
    meetings = [
      meeting({ id: 'call', title: 'Client call', projectId: 'p1', startAt: new Date(start).toISOString(), endAt: new Date(start + 3_600_000).toISOString(), onlineLink: 'https://meet.example.com/abc' }),
      meeting({ id: 'retro', title: 'Sprint retro', status: 'COMPLETED', startAt: at(-3, '09:00'), endAt: at(-3, '10:00') }),
    ];
    renderPage();
    const next = await screen.findByRole('region', { name: /up next/i });
    expect(next).toHaveTextContent('Client call');
    expect(next).toHaveTextContent('in 25 min');
    expect(within(next).getByRole('link', { name: /join/i })).toHaveAttribute('href', 'https://meet.example.com/abc');
    expect(within(next).getByRole('link', { name: /open/i })).toHaveAttribute('href', '/meetings/call');
    await userEvent.type(screen.getByRole('searchbox', { name: /search meetings/i }), 'retro');
    expect(screen.queryByRole('region', { name: /up next/i })).not.toBeInTheDocument();
  });

  it('says until when a meeting under way runs', async () => {
    const end = Date.now() + 50 * 60_000;
    meetings = [meeting({ id: 'live', title: 'Site walk', startAt: new Date(Date.now() - 10 * 60_000).toISOString(), endAt: new Date(end).toISOString() })];
    renderPage();
    const next = await screen.findByRole('region', { name: /up next/i });
    // The website's 24-hour clock ("08:50", "00:04"): an hour-numeric expectation ("8:50") failed every
    // run before 10:00 in Muscat.
    const clock = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: TZ }).format(new Date(end));
    expect(next).toHaveTextContent('Under way');
    expect(next).toHaveTextContent(`until ${clock}`);
    expect(next).not.toHaveTextContent('Happening now');
  });

  it('keeps an Arabic title inline beside its details instead of pushing it to the other side', async () => {
    renderPage();
    const link = await screen.findByRole('link', { name: 'اجتماع الميزانية' });
    expect(link.querySelector('bdi')).not.toBeNull();
    expect(link.closest('[dir="auto"]')).toBeNull();
  });

  it('searches, and offers to clear filters when nothing matches', async () => {
    renderPage();
    await rowOf('Budget review');
    await userEvent.type(screen.getByRole('searchbox', { name: /search meetings/i }), 'retro');
    expect(screen.queryByRole('link', { name: 'Budget review' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sprint retro' })).toBeInTheDocument();
    await userEvent.type(screen.getByRole('searchbox', { name: /search meetings/i }), 'zzz');
    expect(await screen.findByText(/no meetings match/i)).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole('button', { name: /clear filters/i })[0]!);
    expect(await screen.findByRole('link', { name: 'Budget review' })).toBeInTheDocument();
  });

  it('keeps "All meetings / Organized by me" apart from the status and project filters', async () => {
    renderPage();
    await rowOf('Budget review');
    const scope = screen.getByRole('group', { name: /whose meetings/i });
    await userEvent.click(within(scope).getByRole('button', { name: /organized by me/i }));
    await waitFor(() => expect(calls.some((c) => c.url.includes('/meetings?mine=true'))).toBe(true));
    // The filters sit behind one button.
    expect(screen.queryByLabelText(/^status$/i)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /^filters/i }));
    await userEvent.selectOptions(screen.getByLabelText(/^status$/i), 'COMPLETED');
    expect(await screen.findByRole('link', { name: 'Sprint retro' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Budget review' })).not.toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText(/^status$/i), 'ALL');
    await userEvent.selectOptions(screen.getByLabelText(/^project$/i), 'p1');
    expect(screen.getByRole('link', { name: 'Budget review' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Sprint retro' })).not.toBeInTheDocument();
  });

  it('shows the filters in use as chips, each removable, with Clear all', async () => {
    renderPage();
    await rowOf('Budget review');
    await userEvent.click(screen.getByRole('button', { name: /^filters/i }));
    await userEvent.selectOptions(screen.getByLabelText(/^status$/i), 'COMPLETED');
    await userEvent.selectOptions(screen.getByLabelText(/^date$/i), 'last7');
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByLabelText(/^status$/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^filters/i })).toHaveTextContent('Filters (2)');
    const chips = screen.getByRole('list', { name: /filters in use/i });
    expect(within(chips).getAllByRole('listitem').map((li) => li.textContent)).toEqual([expect.stringMatching(/Date: Last 7 days/), expect.stringMatching(/Status: Completed/)]);
    expect(screen.getByText('1 meeting matches')).toBeInTheDocument();
    await userEvent.click(within(chips).getByRole('button', { name: /remove status: completed/i }));
    expect(within(screen.getByRole('list', { name: /filters in use/i })).getAllByRole('listitem')).toHaveLength(1);
    await userEvent.click(screen.getByRole('button', { name: /clear all/i }));
    expect(screen.queryByRole('list', { name: /filters in use/i })).not.toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'Budget review' })).toBeInTheDocument();
  });

  it('opens drafts in one click', async () => {
    renderPage();
    await rowOf('Budget review');
    await userEvent.click(screen.getByRole('button', { name: /drafts \(1\)/i }));
    expect(screen.getByRole('link', { name: 'Hiring plan' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Budget review' })).not.toBeInTheDocument();
  });

  it('shows past meetings twelve at a time with "Show more"', async () => {
    meetings = Array.from({ length: 15 }, (_, i) => meeting({ id: `p${i}`, title: `Old meeting ${i + 1}`, status: 'COMPLETED', startAt: at(-1 - i, '09:00'), endAt: null }));
    renderPage();
    // Old meeting 1 is also the last meeting named in "Nothing coming up" on top.
    await rowOf('Old meeting 1');
    expect(screen.getByRole('link', { name: 'Old meeting 12' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Old meeting 13' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /show 3 more/i }));
    expect(screen.getByRole('link', { name: 'Old meeting 15' })).toBeInTheDocument();
  });

  it('says so, with a retry, when the list can’t be loaded', async () => {
    failList = true;
    renderPage();
    expect(await screen.findByText(/couldn’t load meetings/i)).toBeInTheDocument();
    failList = false;
    await userEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(await screen.findByRole('link', { name: 'Budget review' })).toBeInTheDocument();
  });

  it('has a friendly empty state with New meeting when there are none at all', async () => {
    meetings = [];
    renderPage();
    expect(await screen.findByText(/no meetings yet/i)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /new meeting/i }).length).toBeGreaterThan(0);
  });

  it('asks before cancelling from a row’s menu', async () => {
    renderPage();
    const row = await rowOf('Budget review');
    await userEvent.click(within(row).getByRole('button', { name: /more actions for budget review/i }));
    await userEvent.click(screen.getByRole('menuitem', { name: /cancel meeting/i }));
    const dialog = screen.getByRole('alertdialog', { name: /cancel this meeting/i });
    expect(calls.some((c) => c.url.endsWith('/cancel'))).toBe(false);
    await userEvent.click(within(dialog).getByRole('button', { name: /^cancel meeting$/i }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/meetings/budget/cancel'))).toBe(true));
  });
});

describe('MeetingsPage — the numbers on top, and "Nothing coming up"', () => {
  // Wed 14 Oct 2026, 12:00 in Muscat.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-14T08:00:00.000Z') });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const iso = () => meeting({ id: 'iso', title: 'ISO audit', status: 'COMPLETED', startAt: '2026-10-13T05:00:00.000Z', endAt: '2026-10-13T13:00:00.000Z', minutes: 'DRAFT', openActionItemCount: 0, attendees: ['Mohammed (OXY)'], attendeeCount: 1 });
  const itMeeting = () => meeting({ id: 'it', title: 'IT project meeting', status: 'COMPLETED', startAt: '2026-10-06T09:00:00.000Z', endAt: null, minutes: 'FINAL', openActionItemCount: 2 });
  const september = () => meeting({ id: 'sep', title: 'September review', status: 'COMPLETED', startAt: '2026-09-20T06:00:00.000Z', endAt: null, minutes: 'NOTES', openActionItemCount: 1 });
  const siteVisit = () => meeting({ id: 'soon', title: 'Site visit', startAt: '2026-10-16T06:00:00.000Z', endAt: '2026-10-16T07:00:00.000Z' });
  const strip = () => screen.findByRole('group', { name: /meetings at a glance/i });
  const tile = (s: HTMLElement, name: RegExp) => within(s).getByRole('button', { name });

  it('sums the list up in four numbers, from the meetings it already has', async () => {
    meetings = [siteVisit(), iso(), itMeeting(), september()];
    renderPage();
    const s = await strip();
    await waitFor(() => expect(tile(s, /next 7 days/i)).toHaveTextContent('1'));
    expect(tile(s, /open action items/i)).toHaveTextContent('3');
    expect(tile(s, /open action items/i)).toHaveTextContent('in 2 meetings');
    expect(tile(s, /minutes to finish/i)).toHaveTextContent('2'); // ISO (drafted) and September (notes); IT's are final
    expect(tile(s, /held this month/i)).toHaveTextContent('2'); // ISO and IT; September was last month
    // Only the meetings list is asked for: the numbers cost no extra request.
    expect(calls.filter((c) => /action-items|summary|stats/.test(c.url))).toEqual([]);
  });

  it('shows just the meetings behind a number, named as a chip, and everything again on a second press', async () => {
    meetings = [siteVisit(), iso(), itMeeting(), september()];
    renderPage();
    const s = await strip();
    await userEvent.click(tile(s, /minutes to finish/i));
    expect(tile(s, /minutes to finish/i)).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('link', { name: 'ISO audit' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'September review' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'IT project meeting' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Site visit' })).not.toBeInTheDocument();
    expect(within(screen.getByRole('list', { name: /filters in use/i })).getByText('Minutes to finish')).toBeInTheDocument();
    expect(screen.getByText('2 meetings match')).toBeInTheDocument();
    // The Filters button counts only what its own panel sets.
    expect(screen.getByRole('button', { name: /^filters/i })).toHaveTextContent(/^Filters$/);
    // The numbers stay put while the list is narrowed.
    expect(tile(s, /held this month/i)).toHaveTextContent('2');

    // Another number swaps the view; the chip's ✕ clears it.
    await userEvent.click(tile(s, /open action items/i));
    expect(tile(s, /minutes to finish/i)).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('link', { name: 'IT project meeting' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'September review' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'ISO audit' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /remove with open action items/i }));
    expect(screen.getByRole('link', { name: 'ISO audit' })).toBeInTheDocument();

    await userEvent.click(tile(s, /next 7 days/i));
    expect(screen.getByRole('link', { name: 'Site visit' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'ISO audit' })).not.toBeInTheDocument();
    await userEvent.click(tile(s, /next 7 days/i));
    expect(tile(s, /next 7 days/i)).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('link', { name: 'ISO audit' })).toBeInTheDocument();
  });

  it('reads 0 plainly, and a 0 is not something to press', async () => {
    meetings = [iso(), itMeeting()];
    renderPage();
    const s = await strip();
    await within(s).findByText('Held this month');
    const week = within(s).getByText('Next 7 days').closest('[data-summary-tile]') as HTMLElement;
    expect(week).toHaveTextContent('0');
    expect(week.tagName).not.toBe('BUTTON');
    expect(within(s).queryByRole('button', { name: /next 7 days/i })).not.toBeInTheDocument();
  });

  it('says "Nothing coming up" where Up next would be — the last meeting, and Schedule a meeting', async () => {
    meetings = [iso(), itMeeting()];
    renderPage();
    const panel = await screen.findByRole('region', { name: /nothing coming up/i });
    expect(screen.queryByRole('region', { name: /up next/i })).not.toBeInTheDocument();
    expect(panel).toHaveTextContent('Last meeting: ISO audit, yesterday');
    expect(within(panel).getByRole('link', { name: 'ISO audit' })).toHaveAttribute('href', '/meetings/iso');
    // It sits above the list, under the numbers.
    const past = screen.getByRole('heading', { name: /^past/i });
    expect(panel.compareDocumentPosition(past) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect((await strip()).compareDocumentPosition(panel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await userEvent.click(within(panel).getByRole('button', { name: /schedule a meeting/i }));
    expect(screen.getByRole('dialog', { name: 'New meeting' })).toBeInTheDocument();
  });

  it('leaves the panel out when something is coming up, while you search or filter, and when there are no meetings at all', async () => {
    meetings = [siteVisit(), iso()];
    const first = renderPage();
    expect(await screen.findByRole('region', { name: /up next/i })).toHaveTextContent('Site visit');
    expect(screen.queryByRole('region', { name: /nothing coming up/i })).not.toBeInTheDocument();
    first.unmount();

    meetings = [iso()];
    const second = renderPage();
    await screen.findByRole('region', { name: /nothing coming up/i });
    await userEvent.type(screen.getByRole('searchbox', { name: /search meetings/i }), 'iso');
    expect(screen.queryByRole('region', { name: /nothing coming up/i })).not.toBeInTheDocument();
    second.unmount();

    meetings = [];
    renderPage();
    expect(await screen.findByText(/no meetings yet/i)).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /nothing coming up/i })).not.toBeInTheDocument();
    // Four zeros over an empty page say nothing: the numbers wait for the first meeting.
    expect(screen.queryByRole('group', { name: /meetings at a glance/i })).not.toBeInTheDocument();
  });

  it('when nothing has been held yet either, says so instead of naming a last meeting', async () => {
    meetings = [meeting({ id: 'draft', title: 'Hiring plan', status: 'DRAFT', startAt: '2026-10-20T06:00:00.000Z', endAt: null })];
    renderPage();
    const panel = await screen.findByRole('region', { name: /nothing coming up/i });
    expect(panel).toHaveTextContent('No meeting has been held yet');
    expect(panel).not.toHaveTextContent('Last meeting');
  });

  it('lines every card up the same way: details on top, then a footer row with the people first and the status chips in their own column', async () => {
    meetings = [iso(), itMeeting()];
    renderPage();
    for (const title of ['ISO audit', 'IT project meeting']) {
      const card = await rowOf(title);
      // The card takes two rows of the grid and shares them with its neighbours (CSS subgrid), so
      // each row's footers start at the same height however much a title or the chips wrap.
      expect(card.className).toMatch(/(^|\s)row-span-2(\s|$)/);
      expect(card.className).toMatch(/(^|\s)grid-rows-subgrid(\s|$)/);
      const footer = card.querySelector('[data-card-footer]') as HTMLElement;
      expect(footer).not.toBeNull();
      expect(footer.firstElementChild).toHaveTextContent(/person|people|No attendees/);
      expect(within(footer).getByText('Completed').closest('[data-card-chips]')).not.toBeNull();
    }
  });
});
