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

  it('remembers a photo’s or an unknown name for a minute, then reads it again', async () => {
    f.s.pictures.add('/uploads/photo.png');
    await access.classify('photo.png');
    await access.classify('nothing.png');
    const reads = f.s.reads;
    clock += 59_000;
    await access.classify('photo.png');
    await access.classify('nothing.png');
    expect(f.s.reads).toBe(reads);
    f.s.pictures.delete('/uploads/photo.png'); // replaced
    clock += 2_000;
    expect(await access.classify('photo.png')).toEqual({ kind: 'unknown' });
  });

  it('a task’s or chat’s file only for 10 seconds (an undone merge moves its rows back; an erase removes them)', async () => {
    f.s.taskFiles.set('a.pdf', ['main']);
    expect(await access.classify('a.pdf')).toEqual({ kind: 'protected', taskIds: ['main'], chats: [] });
    f.s.taskFiles.set('a.pdf', ['original']);
    clock += 9_000;
    expect((await access.classify('a.pdf')) as { taskIds: string[] }).toMatchObject({ taskIds: ['main'] });
    clock += 1_001;
    expect((await access.classify('a.pdf')) as { taskIds: string[] }).toMatchObject({ taskIds: ['original'] });
    f.s.taskFiles.delete('a.pdf'); // erased
    clock += 10_001;
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

  it('a removal from a project takes effect at once when the server says so (forget the person; or everyone)', async () => {
    expect(await access.mayOpen(amal, taskFile)).toBe(true);
    expect(await access.mayOpen(basim, taskFile)).toBe(true);
    canViewTask.get('t1')!.delete('amal');
    canViewTask.get('t1')!.delete('basim');
    access.forget('amal');
    expect(await access.mayOpen(amal, taskFile)).toBe(false);
    expect(await access.mayOpen(basim, taskFile)).toBe(true); // still remembered
    access.forget();
    expect(await access.mayOpen(basim, taskFile)).toBe(false);
  });

  it('a refusal is never remembered: someone added (back) to the project opens the file at once', async () => {
    canViewTask.get('t1')!.delete('amal');
    expect(await access.mayOpen(amal, taskFile)).toBe(false);
    canViewTask.get('t1')!.add('amal');
    expect(await access.mayOpen(amal, taskFile)).toBe(true);
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

// 1.23.38 Upload folders (design "Access"): the company in a file's path must be one the person may see —
// one of their active companies, or one of the companies of the project behind the file (a shared project).
// Administrators see all; `shared` and the 1.23.31 plain names carry no company. The row check still decides first.
describe('the company in the path', () => {
  const UUID = '1b4e28ba-2d11-4a2e-8c3b-0f5b2b6e9a10';
  const inCo = (co: string) => `${co}/2026/11/u1/task-files/${UUID}.pdf`;
  let companies: Map<string, string[]>;
  let co: ReturnType<typeof createFileAccess>;
  let rowCompanies: string[];
  beforeEach(() => {
    companies = new Map([['amal', ['coA']], ['basim', ['coB']]]);
    rowCompanies = ['coA'];
    const store: FileRowsStore = {
      ...f.store,
      async rowsOf(key) {
        const rows = await f.store.rowsOf(key);
        return { ...rows, companyIds: rowCompanies };
      },
    };
    co = createFileAccess({
      store,
      canViewTask: async (userId, roles, taskId) => roles.includes('ADMIN') || (canViewTask.get(taskId)?.has(userId) ?? false),
      canSeeConversation: async (cid, userId) => canSeeConversation.get(cid)?.has(userId) ?? false,
      companiesOf: async (userId) => companies.get(userId) ?? [],
      now: () => clock,
    });
  });

  it('a person of the path’s company opens it', async () => {
    f.s.taskFiles.set(inCo('coA'), ['t1']);
    expect(await co.mayOpen(amal, await co.classify(inCo('coA')), inCo('coA'))).toBe(true);
  });

  it('a team member from a second company of a shared project opens it (the project’s companies)', async () => {
    f.s.taskFiles.set(inCo('coA'), ['t1']);
    rowCompanies = ['coA', 'coB'];
    expect(await co.mayOpen(basim, await co.classify(inCo('coA')), inCo('coA'))).toBe(true);
  });

  it('a path naming a company unrelated to both the person and the file is refused, even when the row check passes', async () => {
    f.s.taskFiles.set(inCo('coX'), ['t1']);
    expect(await co.mayOpen(basim, await co.classify(inCo('coX')), inCo('coX'))).toBe(false);
    expect(await co.mayOpen(amal, await co.classify(inCo('coX')), inCo('coX'))).toBe(false);
  });

  it('administrators see every company; shared and plain names carry none', async () => {
    f.s.taskFiles.set(inCo('coX'), ['t1']);
    expect(await co.mayOpen(admin, await co.classify(inCo('coX')), inCo('coX'))).toBe(true);
    const shared = `shared/2026/11/u1/chat-files/${UUID}.png`;
    f.s.chatFiles.set(shared, [{ conversationId: 'c1', deleted: false }]);
    expect(await co.mayOpen(amal, await co.classify(shared), shared)).toBe(true);
    f.s.taskFiles.set(`${UUID}.pdf`, ['t1']);
    expect(await co.mayOpen(basim, await co.classify(`${UUID}.pdf`), `${UUID}.pdf`)).toBe(true);
  });

  it('the row check still comes first: the right company alone opens nothing', async () => {
    f.s.taskFiles.set(inCo('coB'), ['t1']);
    companies.set('carla', ['coB']);
    expect(await co.mayOpen({ id: 'carla', roles: ['EMPLOYEE'] }, await co.classify(inCo('coB')), inCo('coB'))).toBe(false);
  });
});

// 1.23.38 Upload folders (design "Old links"): an old name is found through file_key_aliases, then checked
// exactly as the file it moved to.
describe('old names through the alias table', () => {
  const OLD = '1b4e28ba-2d11-4a2e-8c3b-0f5b2b6e9a10.pdf';
  const NEW = `coA/2026/11/u1/task-files/1b4e28ba-2d11-4a2e-8c3b-0f5b2b6e9a10.pdf`;
  let aliases: Map<string, string>;
  let al: ReturnType<typeof createFileAccess>;
  beforeEach(() => {
    aliases = new Map([[OLD, NEW]]);
    al = createFileAccess({
      store: { ...f.store, aliasOf: async (key) => aliases.get(key) ?? null },
      canViewTask: async (userId, roles, taskId) => roles.includes('ADMIN') || (canViewTask.get(taskId)?.has(userId) ?? false),
      canSeeConversation: async () => false,
      now: () => clock,
    });
  });

  it('resolves an old name to the moved file, with its rows', async () => {
    f.s.taskFiles.set(NEW, ['t1']);
    const found = await al.resolve(OLD);
    expect(found.file).toBe(NEW);
    expect(found.kind).toMatchObject({ kind: 'protected', taskIds: ['t1'] });
  });

  it('a current name is itself; an unknown old name stays unknown', async () => {
    f.s.taskFiles.set(NEW, ['t1']);
    expect((await al.resolve(NEW)).file).toBe(NEW);
    expect((await al.resolve('00000000-aaaa-4bbb-8ccc-6e6f7468696e.png')).kind).toEqual({ kind: 'unknown' });
  });

  it('follows a file moved twice (re-filed after its project moved), but never loops', async () => {
    const THIRD = NEW.replace('coA/', 'coB/');
    aliases.set(NEW, THIRD);
    f.s.taskFiles.set(THIRD, ['t1']);
    expect((await al.resolve(OLD)).file).toBe(THIRD);
    aliases.set(THIRD, OLD);
    f.s.taskFiles.delete(THIRD);
    clock += 60_000; // past what was remembered
    expect((await al.resolve(OLD)).kind).toEqual({ kind: 'unknown' });
  });

  it('a public picture by its old address', async () => {
    const PIC_OLD = '0000000a-aaaa-4bbb-8ccc-6c6f676f3030.png';
    const PIC_NEW = 'coA/2026/11/system/company-logos/0000000a-aaaa-4bbb-8ccc-6c6f676f3030.png';
    aliases.set(PIC_OLD, PIC_NEW);
    f.s.pictures.add(`/uploads/${PIC_NEW}`);
    expect(await al.resolve(PIC_OLD)).toEqual({ file: PIC_NEW, kind: { kind: 'public' } });
  });
});
