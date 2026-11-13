import { describe, it, expect, beforeEach } from 'vitest';
import { createExternalContactService, checkNewTaskContacts } from './external-contact-service';
import { createMemoryExternalContactRepository } from './memory-external-contact-repository';
import { ConflictError, NotFoundError, ValidationError } from '../../lib/http-errors';

function setup() {
  const liveTasks = new Map([
    ['t1', 'p1'],
    ['t2', 'p1'],
    ['t3', 'p2'],
  ]);
  const repo = createMemoryExternalContactRepository({ liveTasks });
  const service = createExternalContactService({ repo, taskLookup: { exists: async (id) => liveTasks.has(id) } });
  return { repo, service, liveTasks };
}

let s: ReturnType<typeof setup>;
beforeEach(() => {
  s = setup();
});

describe('external contacts: adding', () => {
  it('adds a cleaned contact at the end of the task’s list, remembering who added it', async () => {
    const a = await s.service.add('t1', { name: ' Ahmed Al Said ', company: 'Acme', email: '' }, 'u1');
    const b = await s.service.add('t1', { name: 'Sara Nasser' }, 'u2');
    expect(a).toMatchObject({ taskId: 't1', name: 'Ahmed Al Said', company: 'Acme', email: null, position: 0, createdById: 'u1' });
    expect(b.position).toBe(1);
    expect((await s.service.list('t1')).map((c) => c.name)).toEqual(['Ahmed Al Said', 'Sara Nasser']);
  });

  it('refuses a contact without a name, or with a bad email, in plain words, naming each field', async () => {
    const err = await s.service.add('t1', { name: '', email: 'nope' }, 'u1').catch((e) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.message).toBe('Enter the contact’s name.');
    expect(err.details).toEqual({ fields: { name: 'Enter the contact’s name.', email: 'Enter a valid email address, like name@company.com.' } });
  });

  it('stops at 20 contacts on a task', async () => {
    for (let i = 0; i < 20; i++) await s.service.add('t1', { name: `P${i}` }, 'u1');
    const err = await s.service.add('t1', { name: 'One more' }, 'u1').catch((e) => e);
    expect(err).toBeInstanceOf(ConflictError);
    expect(err.code).toBe('TOO_MANY_EXTERNAL_CONTACTS');
    expect(err.message).toBe('A task can have at most 20 external contacts.');
  });

  it('a task that isn’t there has none to add to or list', async () => {
    await expect(s.service.add('gone', { name: 'A' }, 'u1')).rejects.toBeInstanceOf(NotFoundError);
    await expect(s.service.list('gone')).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('external contacts: changing and removing', () => {
  it('changes only the fields sent, and says what it was before', async () => {
    const c = await s.service.add('t1', { name: 'Ahmed', company: 'Acme', phone: '+968 1234' }, 'u1');
    const { before, after, changed } = await s.service.update(c.id, { name: 'Ahmed Al Said', remarks: 'Site lead' });
    expect(before).toMatchObject({ name: 'Ahmed', company: 'Acme', remarks: null });
    expect(after).toMatchObject({ name: 'Ahmed Al Said', company: 'Acme', phone: '+968 1234', remarks: 'Site lead' });
    expect(changed).toBe(true);
    expect((await s.service.update(c.id, { name: 'Ahmed Al Said' })).changed).toBe(false);
  });

  it('clears a field sent empty, and checks the result', async () => {
    const c = await s.service.add('t1', { name: 'Ahmed', company: 'Acme' }, 'u1');
    expect((await s.service.update(c.id, { company: '' })).after.company).toBeNull();
    await expect(s.service.update(c.id, { name: ' ' })).rejects.toBeInstanceOf(ValidationError);
  });

  it('removes a contact; one that is gone says so', async () => {
    const c = await s.service.add('t1', { name: 'Ahmed' }, 'u1');
    expect(await s.service.remove(c.id)).toMatchObject({ id: c.id, name: 'Ahmed', taskId: 't1' });
    const err = await s.service.remove(c.id).catch((e) => e);
    expect(err).toBeInstanceOf(NotFoundError);
    expect(err.message).toBe('This contact isn’t on the task any more. Someone may have removed it.');
    await expect(s.service.update(c.id, { name: 'B' })).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('external contacts: suggestions from the project', () => {
  it('suggests each earlier contact once (the newest details), newest first, at most 10', async () => {
    await s.service.add('t1', { name: 'Ahmed Al Said', company: 'Acme', phone: '+968 1111' }, 'u1');
    await s.service.add('t2', { name: 'ahmed al said', company: 'acme', phone: '+968 2222' }, 'u1');
    await s.service.add('t2', { name: 'Aisha Hamed', company: 'PDO' }, 'u1');
    await s.service.add('t3', { name: 'Ahmed Elsewhere', company: 'Other' }, 'u1');
    const hits = await s.service.suggest('p1', 'a');
    expect(hits).toEqual([
      { name: 'Aisha Hamed', company: 'PDO', designation: null, email: null, phone: null, remarks: null },
      { name: 'ahmed al said', company: 'acme', designation: null, email: null, phone: '+968 2222', remarks: null },
    ]);
    for (let i = 0; i < 15; i++) await s.service.add('t1', { name: `Bader ${i}` }, 'u1');
    expect(await s.service.suggest('p1', 'bad')).toHaveLength(10);
    expect(await s.service.suggest('p1', '  ')).toEqual([]);
  });

  it('finds a contact by the start of any word of the name or company', async () => {
    await s.service.add('t1', { name: 'Salim Hinai', company: 'Al Amal Trading' }, 'u1');
    expect((await s.service.suggest('p1', 'ama')).map((c) => c.name)).toEqual(['Salim Hinai']);
    expect((await s.service.suggest('p1', 'hin')).map((c) => c.name)).toEqual(['Salim Hinai']);
    expect(await s.service.suggest('p1', 'mal')).toEqual([]);
  });
});

describe('external contacts given with a new task', () => {
  it('are checked and cleaned before the task is made', () => {
    expect(checkNewTaskContacts([{ name: ' Ahmed ', company: 'Acme' }])).toEqual([{ name: 'Ahmed', company: 'Acme', designation: null, email: null, phone: null, remarks: null }]);
    expect(checkNewTaskContacts(undefined)).toEqual([]);
    const err = (() => {
      try {
        checkNewTaskContacts([{ name: 'A' }, { name: 'B', email: 'x' }]);
      } catch (e) {
        return e as ValidationError;
      }
    })();
    expect(err).toBeInstanceOf(ValidationError);
    expect(err?.message).toBe('External contact 2: Enter a valid email address, like name@company.com.');
    expect(() => checkNewTaskContacts(Array.from({ length: 21 }, (_, i) => ({ name: `P${i}` })))).toThrow('A task can have at most 20 external contacts.');
  });
});

describe('external contacts — the task search index follows them', () => {
  it('tells onChanged about the task after a contact is added, changed or removed', async () => {
    const changed: string[] = [];
    const liveTasks = new Map([['t1', 'p1']]);
    const repo = createMemoryExternalContactRepository({ liveTasks });
    const service = createExternalContactService({ repo, taskLookup: { exists: async (id) => liveTasks.has(id) }, onChanged: (taskId) => void changed.push(taskId) });
    const c = await service.add('t1', { name: 'Ahmed Al Said' }, 'u1');
    await service.update(c.id, { name: 'Ahmed Al Said' }); // unchanged: nothing to re-index
    await service.update(c.id, { name: 'Ahmed Al Said', company: 'Acme' });
    await service.remove(c.id);
    expect(changed).toEqual(['t1', 't1', 't1']);
  });
});
