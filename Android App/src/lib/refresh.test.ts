import { describe, it, expect, vi, afterEach } from 'vitest';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { refresh } from './refresh';

const tick = () => new Promise((r) => setTimeout(r, 0));
const clients: QueryClient[] = [];
function client(): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { staleTime: 60_000, retry: false } } });
  clients.push(qc);
  return qc;
}
afterEach(() => {
  for (const qc of clients.splice(0)) qc.clear();
});

const refreshed = (qc: QueryClient, key: unknown[]) => qc.getQueryState(key)?.isInvalidated ?? false;
const task = (id: string, projectId = 'p1') => ({ id, projectId, key: `K-${id}`, title: id });

describe('refresh (one pass over the cache, each query at most once)', () => {
  it('refreshes a key and everything under it, or only that key when exact', () => {
    const qc = client();
    qc.setQueryData(['task', 't1'], task('t1'));
    qc.setQueryData(['task', 't1', 'comments'], []);
    qc.setQueryData(['task', 't2'], task('t2'));
    refresh(qc, [{ queryKey: ['task', 't1'], exact: true }]);
    expect(refreshed(qc, ['task', 't1'])).toBe(true);
    expect(refreshed(qc, ['task', 't1', 'comments'])).toBe(false);
    refresh(qc, [{ queryKey: ['task', 't1'] }]);
    expect(refreshed(qc, ['task', 't1', 'comments'])).toBe(true);
    expect(refreshed(qc, ['task', 't2'])).toBe(false);
  });

  it('refreshes only the task lists that hold the task', () => {
    const qc = client();
    qc.setQueryData(['tasks', 'project', 'p1', '2026-10-21'], [task('t1'), task('t2')]);
    qc.setQueryData(['tasks', 'project', 'p1', '2026-10-20'], [task('t3')]);
    qc.setQueryData(['tasks', 'mine'], [task('t1')]);
    qc.setQueryData(['tasks', 'project', 'p2', 'all'], [task('t9', 'p2')]);
    refresh(qc, [{ listsHolding: 't1' }]);
    expect(refreshed(qc, ['tasks', 'project', 'p1', '2026-10-21'])).toBe(true);
    expect(refreshed(qc, ['tasks', 'mine'])).toBe(true);
    expect(refreshed(qc, ['tasks', 'project', 'p1', '2026-10-20'])).toBe(false);
    expect(refreshed(qc, ['tasks', 'project', 'p2', 'all'])).toBe(false);
  });

  it('counts a calendar range as a list: it holds a task due in it or one whose repeats it shows (5a)', () => {
    const qc = client();
    const range = (tasks: unknown[], series: unknown[] = []) => ({ from: '2026-10-01', to: '2026-10-31', timeZone: 'Asia/Muscat', tasks, occurrences: [], series });
    qc.setQueryData(['tasks', 'calendar', '2026-09-27', '2026-10-31'], range([task('t1')]));
    qc.setQueryData(['tasks', 'calendar', '2026-11-01', '2026-11-30'], range([], [task('t1')]));
    qc.setQueryData(['tasks', 'calendar', '2026-12-01', '2026-12-31'], range([task('t2')]));
    refresh(qc, [{ listsHolding: 't1' }]);
    expect(refreshed(qc, ['tasks', 'calendar', '2026-09-27', '2026-10-31'])).toBe(true);
    expect(refreshed(qc, ['tasks', 'calendar', '2026-11-01', '2026-11-30'])).toBe(true);
    expect(refreshed(qc, ['tasks', 'calendar', '2026-12-01', '2026-12-31'])).toBe(false);
  });

  it('refreshes the progress of the task’s own project', () => {
    const qc = client();
    qc.setQueryData(['task', 't1'], task('t1', 'p1'));
    qc.setQueryData(['project', 'p1', 'progress'], {});
    qc.setQueryData(['project', 'p1', 'members'], []);
    qc.setQueryData(['project', 'p2', 'progress'], {});
    refresh(qc, [{ progressFor: 't1' }]);
    expect(refreshed(qc, ['project', 'p1', 'progress'])).toBe(true);
    expect(refreshed(qc, ['project', 'p1', 'members'])).toBe(false);
    expect(refreshed(qc, ['project', 'p2', 'progress'])).toBe(false);
  });

  it('finds the task’s project from a list when its details aren’t loaded', () => {
    const qc = client();
    qc.setQueryData(['tasks', 'mine'], [task('t1', 'p2')]);
    qc.setQueryData(['project', 'p1', 'progress'], {});
    qc.setQueryData(['project', 'p2', 'progress'], {});
    refresh(qc, [{ progressFor: 't1' }]);
    expect(refreshed(qc, ['project', 'p2', 'progress'])).toBe(true);
    expect(refreshed(qc, ['project', 'p1', 'progress'])).toBe(false);
  });

  it('refreshes every project’s progress when the task’s project is unknown', () => {
    const qc = client();
    qc.setQueryData(['project', 'p1', 'progress'], {});
    qc.setQueryData(['project', 'p2', 'progress'], {});
    qc.setQueryData(['project', 'p2', 'details'], {});
    refresh(qc, [{ progressFor: 'gone' }]);
    expect(refreshed(qc, ['project', 'p1', 'progress'])).toBe(true);
    expect(refreshed(qc, ['project', 'p2', 'progress'])).toBe(true);
    expect(refreshed(qc, ['project', 'p2', 'details'])).toBe(false);
  });

  it('refreshes the meetings overview of the meeting’s own project (found in its details or a list)', () => {
    const qc = client();
    qc.setQueryData(['project', 'p1', 'meetings'], { meetings: [] });
    qc.setQueryData(['project', 'p2', 'meetings'], { meetings: [] });
    qc.setQueryData(['project', 'p1', 'progress'], {});
    qc.setQueryData(['meeting', 'm1'], { id: 'm1', projectId: 'p2' });
    refresh(qc, [{ projectMeetingsOf: 'm1' }]);
    expect(refreshed(qc, ['project', 'p2', 'meetings'])).toBe(true);
    expect(refreshed(qc, ['project', 'p1', 'meetings'])).toBe(false);
    expect(refreshed(qc, ['project', 'p1', 'progress'])).toBe(false);

    const qc2 = client();
    qc2.setQueryData(['project', 'p1', 'meetings'], { meetings: [] });
    qc2.setQueryData(['project', 'p2', 'meetings'], { meetings: [{ id: 'm7' }] });
    qc2.setQueryData(['meetings', 'list', 'all'], [{ id: 'm3', projectId: 'p1' }]);
    refresh(qc2, [{ projectMeetingsOf: 'm3' }, { projectMeetingsOf: 'm7' }]);
    expect(refreshed(qc2, ['project', 'p1', 'meetings'])).toBe(true);
    expect(refreshed(qc2, ['project', 'p2', 'meetings'])).toBe(true);
  });

  it('refreshes no project’s meetings for a standalone meeting, and every project’s when the meeting is unknown', () => {
    const qc = client();
    qc.setQueryData(['project', 'p1', 'meetings'], { meetings: [] });
    qc.setQueryData(['project', 'p2', 'meetings'], null);
    qc.setQueryData(['meeting', 'solo'], { id: 'solo', projectId: null });
    refresh(qc, [{ projectMeetingsOf: 'solo' }]);
    expect(refreshed(qc, ['project', 'p1', 'meetings'])).toBe(false);
    refresh(qc, [{ projectMeetingsOf: 'new' }]);
    expect(refreshed(qc, ['project', 'p1', 'meetings'])).toBe(true);
    expect(refreshed(qc, ['project', 'p2', 'meetings'])).toBe(true);
  });

  it('can refresh every task’s own details without their parts', () => {
    const qc = client();
    qc.setQueryData(['task', 't1'], task('t1'));
    qc.setQueryData(['task', 't2'], task('t2'));
    qc.setQueryData(['task', 't2', 'checklist'], { items: [] });
    refresh(qc, [{ taskDetails: 'all' }]);
    expect(refreshed(qc, ['task', 't1'])).toBe(true);
    expect(refreshed(qc, ['task', 't2'])).toBe(true);
    expect(refreshed(qc, ['task', 't2', 'checklist'])).toBe(false);
  });

  it('refetches a query on screen once, however many targets name it', async () => {
    const qc = client();
    const queryFn = vi.fn(async () => [task('t1')]);
    const observer = new QueryObserver(qc, { queryKey: ['tasks', 'project', 'p1', '2026-10-21'], queryFn });
    const stop = observer.subscribe(() => {});
    await tick();
    expect(queryFn).toHaveBeenCalledTimes(1);
    refresh(qc, [{ queryKey: ['tasks', 'project', 'p1'] }, { listsHolding: 't1' }, { queryKey: ['tasks'] }]);
    await tick();
    expect(queryFn).toHaveBeenCalledTimes(2);
    stop();
  });

  it('does nothing for no targets', () => {
    const qc = client();
    qc.setQueryData(['projects'], []);
    refresh(qc, []);
    expect(refreshed(qc, ['projects'])).toBe(false);
  });

  it('only marks a `later` target out of date: it is fetched when next shown, not now', async () => {
    const qc = client();
    const queryFn = vi.fn(async () => []);
    const observer = new QueryObserver(qc, { queryKey: ['meetings', 'list', 'all'], queryFn });
    const stop = observer.subscribe(() => {});
    await tick();
    refresh(qc, [{ queryKey: ['meetings'], later: true }]);
    await tick();
    expect(queryFn).toHaveBeenCalledTimes(1);
    expect(refreshed(qc, ['meetings', 'list', 'all'])).toBe(true);
    stop();
  });

  it('fetches a query named both now and `later` now', async () => {
    const qc = client();
    const queryFn = vi.fn(async () => []);
    const observer = new QueryObserver(qc, { queryKey: ['meetings', 'list', 'all'], queryFn });
    const stop = observer.subscribe(() => {});
    await tick();
    refresh(qc, [{ queryKey: ['meetings'], later: true }, { queryKey: ['meetings', 'list'] }]);
    await tick();
    expect(queryFn).toHaveBeenCalledTimes(2);
    stop();
  });

  it('fetches the meeting lists now for a meeting none of them holds yet (you were just invited), else leaves them', async () => {
    const qc = client();
    const queryFn = vi.fn(async () => [{ id: 'm1', projectId: null }]);
    const observer = new QueryObserver(qc, { queryKey: ['meetings', 'list', 'all'], queryFn });
    const stop = observer.subscribe(() => {});
    await tick();
    expect(queryFn).toHaveBeenCalledTimes(1);
    refresh(qc, [{ queryKey: ['meetings'], later: true }, { meetingListsIfNew: 'm1' }]);
    await tick();
    expect(queryFn).toHaveBeenCalledTimes(1);
    refresh(qc, [{ queryKey: ['meetings'], later: true }, { meetingListsIfNew: 'new' }]);
    await tick();
    expect(queryFn).toHaveBeenCalledTimes(2);
    // A meeting open on its own screen isn't new either.
    qc.setQueryData(['meeting', 'open'], { id: 'open', projectId: null });
    refresh(qc, [{ meetingListsIfNew: 'open' }]);
    await tick();
    expect(queryFn).toHaveBeenCalledTimes(2);
    stop();
  });
});
