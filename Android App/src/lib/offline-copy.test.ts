import { describe, it, expect } from 'vitest';
import { BOARD_DAYS_KEPT, allTasksCopyKey, isBoardDayCopy, projectTasksCopyKey, withoutOldDone } from './offline-copy';
import type { ApiTask } from './types';

const t = (id: string, over: Partial<ApiTask> = {}): ApiTask => ({
  id,
  key: `T-${id}`,
  title: id,
  description: null,
  projectId: 'p1',
  columnId: 'c1',
  position: 0,
  priority: 'NORMAL',
  startDate: null,
  dueDate: null,
  estimatedHours: null,
  progress: 0,
  completedAt: null,
  ...over,
});

describe('offline copy names', () => {
  it('names a project’s board day, or all of its tasks', () => {
    expect(projectTasksCopyKey('p1', '2026-10-21')).toBe('tasks.p1.2026-10-21');
    expect(projectTasksCopyKey('p1')).toBe('tasks.p1.all');
  });

  it('tells a board day from the other copies', () => {
    expect(isBoardDayCopy('tasks.p1.2026-10-21')).toBe(true);
    expect(isBoardDayCopy('tasks.p1.all')).toBe(false);
    expect(isBoardDayCopy('tasks.mine')).toBe(false);
    expect(isBoardDayCopy('columns.p1')).toBe(false);
  });

  it('keeps two weeks of board days', () => {
    expect(BOARD_DAYS_KEPT).toBe(14);
  });
});

describe('withoutOldDone (a slimmer copy of a long task list)', () => {
  const now = Date.parse('2026-10-21T12:00:00Z');

  it('leaves out tasks finished more than 30 days ago, keeping every open one', () => {
    const tasks = [
      t('open'),
      t('done-last-week', { completedAt: '2026-10-14T09:00:00Z' }),
      t('done-in-august', { completedAt: '2026-08-01T09:00:00Z' }),
      t('done-column-no-date', { columnCategory: 'DONE' }),
    ];
    expect(withoutOldDone(now)(tasks).map((x) => x.id)).toEqual(['open', 'done-last-week', 'done-column-no-date']);
  });
});

describe('chat copies (3a)', () => {
  it('names the inbox, the people, a thread’s newest messages and a channel’s members', async () => {
    const { CHAT_INBOX_COPY, CHAT_DIRECTORY_COPY, chatThreadCopyKey, chatMembersCopyKey } = await import('./offline-copy');
    expect(CHAT_INBOX_COPY).toBe('chat.conversations');
    expect(CHAT_DIRECTORY_COPY).toBe('chat.directory');
    expect(chatThreadCopyKey('c1')).toBe('chat.thread.c1');
    expect(chatMembersCopyKey('c1')).toBe('chat.members.c1');
  });

  it('keeps the most recently opened conversations only, apart from the board days', async () => {
    const { offlineCopyCaps, CHAT_THREADS_KEPT } = await import('./offline-copy');
    const caps = offlineCopyCaps();
    const capOf = (key: string) => caps.find((g) => g.matches(key));
    expect(capOf('tasks.p1.2026-10-21')?.keep).toBe(BOARD_DAYS_KEPT);
    expect(capOf('chat.thread.c1')?.keep).toBe(CHAT_THREADS_KEPT);
    expect(capOf('chat.members.c1')?.keep).toBe(CHAT_THREADS_KEPT);
    expect(capOf('chat.thread.c1')).not.toBe(capOf('chat.members.c1'));
    expect(capOf('chat.conversations')).toBeUndefined();
    expect(capOf('tasks.p1.all')).toBeUndefined();
    // The board days keep the order they always had (no name: "~rolling").
    expect(capOf('tasks.p1.2026-10-21')?.name).toBeUndefined();
    expect(CHAT_THREADS_KEPT).toBe(20);
  });
});

describe('the projects’ progress kept offline (5b review #2)', () => {
  it('is capped: only the boards most recently opened keep their figures', async () => {
    const { offlineCopyCaps, PROGRESS_KEPT } = await import('./offline-copy');
    const capOf = (key: string) => offlineCopyCaps().find((g) => g.matches(key));
    expect(capOf('progress.p1')?.keep).toBe(PROGRESS_KEPT);
    expect(capOf('progress.p1')?.name).toBe('progress');
    expect(capOf('projects.figures')).toBeUndefined();
    expect(PROGRESS_KEPT).toBe(20);
  });
});

describe('the All projects board kept offline (4c)', () => {
  it('is kept per board day, among the board days (and capped with them)', () => {
    expect(allTasksCopyKey('2026-10-21')).toBe('tasks.all.2026-10-21');
    expect(isBoardDayCopy(allTasksCopyKey('2026-10-21'))).toBe(true);
  });
});
