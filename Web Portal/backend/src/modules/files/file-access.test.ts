import { describe, it, expect, beforeEach } from 'vitest';
import { createFileAccess, type FileRowsStore } from './file-access';

// 1.23.29 Private file links (design §7.2 steps 2 and 4.5): which stored files are protected (a task's or a
// chat's), which are public (a current photo, project picture or company logo) and which are nothing; and
// whether a person may open a protected one right now.

function fakeStore() {
  const s = {
    taskFiles: new Map<string, string[]>(), // key → task ids
    chatFiles: new Map<string, { conversationId: string; deleted: boolean }[]>(),
    pictures: new Set<string>(), // '/uploads/<key>' values of avatars, project pictures and logos
    deadTasks: new Set<string>(),
    reads: 0,
  };
  const store: FileRowsStore = {
    async rowsOf(key) {
      s.reads++;
      return { taskIds: [...(s.taskFiles.get(key) ?? [])], chats: [...(s.chatFiles.get(key) ?? [])] };
    },
    async isPublicPicture(url) {
      s.reads++;
      return s.pictures.has(url);
    },
    async taskIsLive(taskId) {
      s.reads++;
      return !s.deadTasks.has(taskId);
    },
  };
  return { s, store };
}

let clock = 0;
let f: ReturnType<typeof fakeStore>;
let canViewTask: Map<string, Set<string>>; // task → people
let canSeeConversation: Map<string, Set<string>>; // conversation → people
let access: ReturnType<typeof createFileAccess>;
let viewChecks = 0;

beforeEach(() => {
  clock = 1_000_000;
  viewChecks = 0;
  f = fakeStore();
  canViewTask = new Map([['t1', new Set(['amal', 'basim'])], ['t2', new Set(['basim'])]]);
  canSeeConversation = new Map([['c1', new Set(['amal'])], ['c2', new Set(['basim'])]]);
  access = createFileAccess({
    store: f.store,
    canViewTask: async (userId, roles, taskId) => {
      viewChecks++;
      return roles.includes('ADMIN') || (canViewTask.get(taskId)?.has(userId) ?? false);
    },
    canSeeConversation: async (conversationId, userId) => {
      viewChecks++;
      return canSeeConversation.get(conversationId)?.has(userId) ?? false;
    },
    now: () => clock,
  });
});

const amal = { id: 'amal', roles: ['EMPLOYEE'] };
const basim = { id: 'basim', roles: ['EMPLOYEE'] };
const admin = { id: 'root', roles: ['ADMIN'] };

describe('which stored file is which', () => {
  it('a task file or a chat file is protected, with the rows that keep it', async () => {
    f.s.taskFiles.set('a.pdf', ['t1']);
    f.s.chatFiles.set('b.png', [{ conversationId: 'c1', deleted: false }]);
    expect(await access.classify('a.pdf')).toEqual({ kind: 'protected', taskIds: ['t1'], chats: [] });
    expect(await access.classify('b.png')).toEqual({ kind: 'protected', taskIds: [], chats: [{ conversationId: 'c1', deleted: false }] });
  });

  it('a current photo, project picture or company logo is public — by each of the three', async () => {
    f.s.pictures.add('/uploads/photo.png');
    expect(await access.classify('photo.png')).toEqual({ kind: 'public' });
  });

  it('protected wins when a name is both a file and a picture', async () => {
    f.s.taskFiles.set('both.png', ['t1']);
    f.s.pictures.add('/uploads/both.png');
    expect((await access.classify('both.png')).kind).toBe('protected');
  });

  it('anything else (a replaced photo, an erased file, an orphan) is nothing', async () => {
    expect(await access.classify('old-photo.png')).toEqual({ kind: 'unknown' });
  });

  it('remembers a name for a minute, then reads it again', async () => {
    f.s.taskFiles.set('a.pdf', ['t1']);
    await access.classify('a.pdf');
    const reads = f.s.reads;
    clock += 59_000;
    await access.classify('a.pdf');
    expect(f.s.reads).toBe(reads);
    f.s.taskFiles.delete('a.pdf'); // erased
    clock += 2_000;
    expect(await access.classify('a.pdf')).toEqual({ kind: 'unknown' });
  });

  it('keeps at most 10,000 names (the oldest go first)', async () => {
    const small = createFileAccess({ store: f.store, canViewTask: async () => true, canSeeConversation: async () => true, now: () => clock, maxEntries: 3 });
    for (const k of ['k1', 'k2', 'k3', 'k4']) await small.classify(k);
    const reads = f.s.reads;
    await small.classify('k4');
    expect(f.s.reads).toBe(reads);
    await small.classify('k1');
    expect(f.s.reads).toBeGreaterThan(reads);
  });
});

describe('who may open a protected file now', () => {
  const taskFile = { kind: 'protected' as const, taskIds: ['t1'], chats: [] };
  const chatFile = { kind: 'protected' as const, taskIds: [], chats: [{ conversationId: 'c1', deleted: false }] };

  it('someone who can see its task', async () => {
    expect(await access.mayOpen(amal, taskFile)).toBe(true);
    expect(await access.mayOpen({ id: 'carim', roles: ['EMPLOYEE'] }, taskFile)).toBe(false);
  });

  it('someone who can see its conversation', async () => {
    expect(await access.mayOpen(amal, chatFile)).toBe(true);
    expect(await access.mayOpen(basim, chatFile)).toBe(false);
  });

  it('nobody, administrators included, while its task is in the Recycle Bin or its project is deleted', async () => {
    f.s.deadTasks.add('t1');
    expect(await access.mayOpen(amal, taskFile)).toBe(false);
    expect(await access.mayOpen(admin, taskFile)).toBe(false);
  });

  it('nobody once its message is deleted', async () => {
    expect(await access.mayOpen(amal, { kind: 'protected', taskIds: [], chats: [{ conversationId: 'c1', deleted: true }] })).toBe(false);
  });

  it('any row that lets the person in is enough (a file kept by two tasks)', async () => {
    expect(await access.mayOpen(basim, { kind: 'protected', taskIds: ['t9', 't2'], chats: [] })).toBe(true);
  });

  it('a removal takes effect within 10 seconds (the decision is remembered that long, per person and task)', async () => {
    expect(await access.mayOpen(amal, taskFile)).toBe(true);
    canViewTask.get('t1')!.delete('amal');
    clock += 9_000;
    expect(await access.mayOpen(amal, taskFile)).toBe(true);
    clock += 1_001;
    expect(await access.mayOpen(amal, taskFile)).toBe(false);
  });

  it('a page of pictures from one task costs one check', async () => {
    for (let i = 0; i < 50; i++) await access.mayOpen(amal, taskFile);
    expect(viewChecks).toBe(1);
  });

  it('a public or unknown file is never "opened" through this check', async () => {
    expect(await access.mayOpen(amal, { kind: 'public' })).toBe(false);
    expect(await access.mayOpen(amal, { kind: 'unknown' })).toBe(false);
  });
});
