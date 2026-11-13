// @vitest-environment jsdom
/**
 * External contacts in the task panel, as on the website: the people outside the company who are
 * responsible for the task, kept apart from its assignees. Each is shown with every detail given
 * (email and phone as links), and can be added, changed or removed (removing asks first). Typing a
 * name suggests earlier contacts on the project; picking one copies all six fields. Each change goes
 * through ctx.write (sent now or kept on this device).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TaskDetail } from '../app/screens/task-detail.js';
import { ApiError } from './errors.js';
import { EXTERNAL_CONTACT_WORDS as W } from './external-contacts.js';

const settle = async () => {
  for (let i = 0; i < 10; i += 1) await new Promise((r) => setTimeout(r, 0));
};
const waitFor = (ms) => new Promise((r) => setTimeout(r, ms));
const byText = (root, sel, text) => [...root.querySelectorAll(sel)].find((n) => n.textContent.trim() === text);
const byLabel = (root, label) => [...root.querySelectorAll('[aria-label]')].find((n) => n.getAttribute('aria-label') === label) || null;
const fieldOf = (root, label) => {
  const l = [...root.querySelectorAll('label')].find((n) => n.textContent.replace(/\s*\(required\)\s*/, '').trim() === label);
  return l ? root.ownerDocument.getElementById(l.htmlFor) : null;
};
const type = (node, value) => {
  node.value = value;
  node.dispatchEvent(new Event('input', { bubbles: true }));
};
const key = (node, k) => {
  const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true });
  node.dispatchEvent(e);
  return e;
};

const ahmed = { id: 'x1', taskId: 't1', name: 'Ahmed Al Said', company: 'Acme', designation: 'Site lead', email: 'ahmed@acme.com', phone: '+968 9912 3456', remarks: 'Call before 10', position: 0 };

function drawerCtx(over = {}) {
  const task = { id: 't1', key: 'OPS-7', title: 'Inspect the rig', priority: 'NORMAL', projectId: 'p1', dueDate: null, version: 3, tags: [], externalContacts: [ahmed], ...over.task };
  const read = (data) => vi.fn(async () => ({ data }));
  return {
    params: { taskId: 't1' },
    me: { id: 'u1', name: 'Mariam Al Hinai', roles: [] },
    timeZone: 'Asia/Muscat',
    isOnline: () => true,
    api: {
      tasks: {
        get: vi.fn(async () => ({ data: JSON.parse(JSON.stringify(task)) })),
        assignees: read([{ id: 'u2', firstName: 'Omar', lastName: 'Ahmed', username: 'omar' }]),
        checklist: read({ items: [], done: 0, total: 0 }),
        comments: read([]),
        attachments: read([]),
        activity: read([]),
        watch: read({ watching: false }),
        watchers: read([]),
        mentionable: read([]),
      },
      projects: {
        members: read([]),
        externalContacts: over.suggest ?? vi.fn(async () => []),
      },
      tags: read([]),
      directory: read([]),
      attachments: { upload: vi.fn() },
      download: vi.fn(),
    },
    write: over.write ?? vi.fn(async (kind, p) => ({ queued: false, data: kind === 'contact.add' ? { id: 'x9', taskId: 't1', ...p.contact, position: 1 } : kind === 'contact.update' ? { ...ahmed, ...p.patch } : undefined })),
    afterMutation: vi.fn(),
    saveFile: vi.fn(),
  };
}

async function open(ctx = drawerCtx()) {
  const root = TaskDetail(ctx, () => {});
  document.body.append(root);
  await settle();
  return root;
}
const contacts = (root) => root.querySelector('section[aria-labelledby="td-external-h"]');

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('external contacts: shown in the task panel, apart from the assignees', () => {
  it('lists each contact with name, company · designation, email and phone as links, and remarks', async () => {
    const root = await open();
    const sec = contacts(root);
    expect(sec.querySelector('h3').textContent).toBe('External contacts');
    expect(sec.textContent).not.toContain('Omar Ahmed'); // the assignees are their own section
    const row = sec.querySelector('li');
    expect(row.querySelector('.td-contact-name').textContent).toBe('Ahmed Al Said');
    expect(row.textContent).toContain('Acme · Site lead');
    expect(row.querySelector('a[href="mailto:ahmed@acme.com"]').textContent).toBe('ahmed@acme.com');
    expect(row.querySelector('a[href="tel:+96899123456"]').textContent).toBe('+968 9912 3456');
    expect(row.textContent).toContain('Call before 10');
    // The section comes right after Assignees.
    const order = [...root.querySelectorAll('section h3')].map((h) => h.textContent);
    expect(order.indexOf('External contacts')).toBe(order.indexOf('Assignees') + 1);
  });

  it('says when there are none; an older server (no contacts in the task) shows no section', async () => {
    expect(contacts(await open(drawerCtx({ task: { externalContacts: [] } }))).textContent).toContain(W.none);
    document.body.innerHTML = '';
    expect(contacts(await open(drawerCtx({ task: { externalContacts: undefined } })))).toBeNull();
  });
});

describe('external contacts: adding one', () => {
  it('opens a form with the six fields; a missing name is said at the field, and nothing is sent', async () => {
    const ctx = drawerCtx();
    const root = await open(ctx);
    byText(root, 'button', W.add).click();
    await settle();
    const form = contacts(root).querySelector('form');
    expect(form.getAttribute('aria-label')).toBe(W.addTitle);
    for (const label of Object.values(W.labels)) expect(fieldOf(form, label), label).not.toBeNull();
    expect(document.activeElement).toBe(fieldOf(form, 'Name'));
    type(fieldOf(form, 'Email'), 'not-an-email');
    form.requestSubmit();
    await settle();
    expect(ctx.write).not.toHaveBeenCalled();
    const name = fieldOf(form, 'Name');
    expect(name.getAttribute('aria-invalid')).toBe('true');
    expect(document.getElementById(name.getAttribute('aria-describedby').split(' ').pop()).textContent).toBe('Enter the contact’s name.');
    expect(fieldOf(form, 'Email').getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(name);
  });

  it('sends the cleaned contact and shows it; the form closes', async () => {
    const ctx = drawerCtx();
    const root = await open(ctx);
    byText(root, 'button', W.add).click();
    await settle();
    const form = contacts(root).querySelector('form');
    type(fieldOf(form, 'Name'), '  Sara Nasser ');
    type(fieldOf(form, 'Company'), 'NWT');
    type(fieldOf(form, 'Phone'), '+968 2468');
    form.requestSubmit();
    await settle();
    expect(ctx.write).toHaveBeenCalledWith('contact.add', { id: 't1', contact: { name: 'Sara Nasser', company: 'NWT', designation: null, email: null, phone: '+968 2468', remarks: null } });
    const sec = contacts(root);
    expect(sec.querySelector('form')).toBeNull();
    expect([...sec.querySelectorAll('.td-contact-name')].map((n) => n.textContent)).toEqual(['Ahmed Al Said', 'Sara Nasser']);
    expect(ctx.afterMutation).toHaveBeenCalled();
  });

  it('shows the server’s reason at the field it is about, and keeps what was typed', async () => {
    const ctx = drawerCtx({
      write: vi.fn(async () => {
        throw new ApiError(400, 'Enter a valid email address, like name@company.com.', 'VALIDATION', { fields: { email: 'Enter a valid email address, like name@company.com.' } });
      }),
    });
    const root = await open(ctx);
    byText(root, 'button', W.add).click();
    await settle();
    const form = contacts(root).querySelector('form');
    type(fieldOf(form, 'Name'), 'Sara');
    type(fieldOf(form, 'Email'), 'sara@northwind.example');
    form.requestSubmit();
    await settle();
    const again = contacts(root).querySelector('form');
    expect(fieldOf(again, 'Name').value).toBe('Sara');
    expect(fieldOf(again, 'Email').getAttribute('aria-invalid')).toBe('true');
    expect(again.textContent).toContain('Enter a valid email address, like name@company.com.');
  });

  it('a refusal (no access, the limit) is said in the server’s words', async () => {
    const ctx = drawerCtx({ write: vi.fn(async () => { throw new ApiError(409, 'A task can have at most 20 external contacts.', 'TOO_MANY_EXTERNAL_CONTACTS'); }) });
    const root = await open(ctx);
    byText(root, 'button', W.add).click();
    await settle();
    const form = contacts(root).querySelector('form');
    type(fieldOf(form, 'Name'), 'Sara');
    form.requestSubmit();
    await settle();
    expect(root.querySelector('[role="alert"]').textContent).toBe('A task can have at most 20 external contacts.');
  });

  it('at 20 contacts there is no adding another, and it says why', async () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ ...ahmed, id: `x${i}`, name: `Person ${i}` }));
    const root = await open(drawerCtx({ task: { externalContacts: many } }));
    const sec = contacts(root);
    expect(byText(sec, 'button', W.add).disabled).toBe(true);
    expect(sec.textContent).toContain(W.full);
  });

  it('kept on this device: shown as waiting to sync, and it can’t be changed until it has synced', async () => {
    const ctx = drawerCtx({ write: vi.fn(async () => ({ queued: true, item: { id: 'q1' } })) });
    const root = await open(ctx);
    byText(root, 'button', W.add).click();
    await settle();
    const form = contacts(root).querySelector('form');
    type(fieldOf(form, 'Name'), 'Sara');
    form.requestSubmit();
    await settle();
    const row = [...contacts(root).querySelectorAll('li')].find((li) => li.textContent.includes('Sara'));
    expect(row.textContent).toContain('waiting to sync');
    expect(byLabel(row, 'Edit Sara').disabled).toBe(true);
    expect(byLabel(row, 'Remove Sara').disabled).toBe(true);
  });

  it('Escape in the form puts it away (the panel stays open)', async () => {
    const root = await open();
    byText(root, 'button', W.add).click();
    await settle();
    const e = key(fieldOf(contacts(root).querySelector('form'), 'Company'), 'Escape');
    await settle();
    expect(e.defaultPrevented).toBe(true);
    expect(contacts(root).querySelector('form')).toBeNull();
    expect(document.activeElement.textContent).toBe(W.add);
  });
});

describe('external contacts: suggestions from the project', () => {
  const earlier = [
    { name: 'Ahmed Al Said', company: 'Acme', designation: 'Site lead', email: 'ahmed@acme.com', phone: '+968 9912 3456', remarks: 'Call before 10' },
    { name: 'Ahmed Hinai', company: 'NWT', designation: null, email: null, phone: null, remarks: null },
  ];

  it('typing a name suggests earlier contacts; picking one (keyboard) copies all six fields', async () => {
    const suggest = vi.fn(async () => earlier);
    const ctx = drawerCtx({ task: { externalContacts: [] }, suggest });
    const root = await open(ctx);
    byText(root, 'button', W.add).click();
    await settle();
    const form = contacts(root).querySelector('form');
    const name = fieldOf(form, 'Name');
    expect(name.getAttribute('role')).toBe('combobox');
    type(name, 'Ahm');
    await waitFor(300);
    await settle();
    expect(suggest).toHaveBeenCalledWith('p1', 'Ahm');
    const list = form.querySelector('[role="listbox"]');
    expect(list.getAttribute('aria-label')).toBe(W.suggestions);
    expect([...list.querySelectorAll('[role="option"]')].map((o) => o.textContent)).toEqual(['Ahmed Al Said · Acme · Site lead', 'Ahmed Hinai · NWT']);
    expect(name.getAttribute('aria-expanded')).toBe('true');
    key(name, 'ArrowDown');
    expect(name.getAttribute('aria-activedescendant')).toBe(list.querySelector('[role="option"]').id);
    expect(key(name, 'Enter').defaultPrevented).toBe(true);
    await settle();
    expect(name.value).toBe('Ahmed Al Said');
    expect(fieldOf(form, 'Company').value).toBe('Acme');
    expect(fieldOf(form, 'Designation').value).toBe('Site lead');
    expect(fieldOf(form, 'Email').value).toBe('ahmed@acme.com');
    expect(fieldOf(form, 'Phone').value).toBe('+968 9912 3456');
    expect(fieldOf(form, 'Remarks').value).toBe('Call before 10');
    expect(form.querySelector('[role="listbox"]')).toBeNull();
    form.requestSubmit();
    await settle();
    expect(ctx.write).toHaveBeenCalledWith('contact.add', { id: 't1', contact: earlier[0] });
  });

  it('a press on a suggestion picks it too; Escape closes the list first, not the form', async () => {
    const root = await open(drawerCtx({ task: { externalContacts: [] }, suggest: vi.fn(async () => earlier) }));
    byText(root, 'button', W.add).click();
    await settle();
    const form = contacts(root).querySelector('form');
    const name = fieldOf(form, 'Name');
    type(name, 'Ahm');
    await waitFor(300);
    await settle();
    expect(key(name, 'Escape').defaultPrevented).toBe(true);
    expect(form.querySelector('[role="listbox"]')).toBeNull();
    expect(contacts(root).querySelector('form')).toBe(form);
    type(name, 'Ahme');
    await waitFor(300);
    await settle();
    const option = [...form.querySelectorAll('[role="option"]')][1];
    option.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    await settle();
    expect(name.value).toBe('Ahmed Hinai');
    expect(fieldOf(form, 'Company').value).toBe('NWT');
    expect(fieldOf(form, 'Email').value).toBe('');
  });

  it('offline, no suggestions are asked for (the name is typed in full)', async () => {
    const suggest = vi.fn(async () => earlier);
    const ctx = drawerCtx({ task: { externalContacts: [] }, suggest });
    ctx.isOnline = () => false;
    const root = await open(ctx);
    byText(root, 'button', W.add).click();
    await settle();
    const form = contacts(root).querySelector('form');
    type(fieldOf(form, 'Name'), 'Ahm');
    await waitFor(300);
    expect(suggest).not.toHaveBeenCalled();
    expect(form.querySelector('[role="listbox"]')).toBeNull();
  });
});

describe('external contacts: changing and removing one', () => {
  it('Edit fills the form; Save sends only what changed (a cleared field is cleared)', async () => {
    const ctx = drawerCtx();
    const root = await open(ctx);
    byLabel(root, 'Edit Ahmed Al Said').click();
    await settle();
    const form = contacts(root).querySelector('form');
    expect(form.getAttribute('aria-label')).toBe(W.editTitle);
    expect(fieldOf(form, 'Name').value).toBe('Ahmed Al Said');
    expect(fieldOf(form, 'Remarks').value).toBe('Call before 10');
    type(fieldOf(form, 'Phone'), '+968 1111 2222');
    type(fieldOf(form, 'Remarks'), '');
    form.requestSubmit();
    await settle();
    expect(ctx.write).toHaveBeenCalledWith('contact.update', { id: 't1', contactId: 'x1', name: 'Ahmed Al Said', patch: { phone: '+968 1111 2222', remarks: null } });
    const row = contacts(root).querySelector('li');
    expect(row.querySelector('a[href="tel:+96811112222"]')).not.toBeNull();
    expect(row.textContent).not.toContain('Call before 10');
  });

  it('saving with no change sends nothing', async () => {
    const ctx = drawerCtx();
    const root = await open(ctx);
    byLabel(root, 'Edit Ahmed Al Said').click();
    await settle();
    contacts(root).querySelector('form').requestSubmit();
    await settle();
    expect(ctx.write).not.toHaveBeenCalled();
    expect(contacts(root).querySelector('form')).toBeNull();
  });

  it('Remove asks first, Keep focused; Keep leaves it, Remove takes it off', async () => {
    const ctx = drawerCtx();
    const root = await open(ctx);
    byLabel(root, 'Remove Ahmed Al Said').click();
    await settle();
    const box = contacts(root).querySelector('[role="group"]');
    expect(box.textContent).toContain(W.confirmRemove);
    expect(document.activeElement.textContent).toBe('Keep');
    document.activeElement.click();
    await settle();
    expect(ctx.write).not.toHaveBeenCalled();
    byLabel(root, 'Remove Ahmed Al Said').click();
    await settle();
    byText(contacts(root), 'button', 'Remove').click();
    await settle();
    expect(ctx.write).toHaveBeenCalledWith('contact.delete', { id: 't1', contactId: 'x1', name: 'Ahmed Al Said' });
    expect(contacts(root).querySelectorAll('li')).toHaveLength(0);
    expect(contacts(root).textContent).toContain(W.none);
  });

  it('a removal that fails puts the contact back, with the reason', async () => {
    const ctx = drawerCtx({ write: vi.fn(async () => { throw new ApiError(403, 'You can’t change the external contacts of this task.', 'FORBIDDEN'); }) });
    const root = await open(ctx);
    byLabel(root, 'Remove Ahmed Al Said').click();
    await settle();
    byText(contacts(root), 'button', 'Remove').click();
    await settle();
    expect(contacts(root).querySelectorAll('li')).toHaveLength(1);
    expect(root.querySelector('[role="alert"]').textContent).toBe('You can’t change the external contacts of this task.');
  });
});

describe('external contacts on board cards and task rows', () => {
  const summary = { count: 3, name: 'Ahmed Al Said', company: 'Acme', names: ['Ahmed Al Said', 'B', 'C'], companies: ['Acme'] };

  it('a board card shows “External: …” under its title', async () => {
    const { BoardScreen } = await import('../app/screens/board.js');
    const { fakeStorage } = await import('./test-helpers.js');
    const columns = [{ id: 'c1', name: 'To do', category: 'TODO', enabled: true, position: 0 }];
    const tasks = [
      { id: 't1', key: 'OPS-7', title: 'Inspect the rig', priority: 'NORMAL', projectId: 'p1', columnId: 'c1', dueDate: null, progress: 0, externalSummary: summary },
      { id: 't2', key: 'OPS-8', title: 'Internal only', priority: 'NORMAL', projectId: 'p1', columnId: 'c1', dueDate: null, progress: 0, externalSummary: null },
    ];
    const ctx = {
      params: { projectId: 'p1' }, query: {}, timeZone: 'Asia/Muscat', isOnline: () => true, storage: fakeStorage(),
      api: {
        projects: { get: vi.fn(async () => ({ data: { id: 'p1', code: 'OPS', name: 'Operations' } })), list: vi.fn(async () => ({ data: [{ id: 'p1', code: 'OPS', name: 'Operations' }] })), columns: vi.fn(async () => ({ data: columns })), progress: vi.fn(async () => ({ data: { done: 0, total: 2, percent: 0 } })), members: vi.fn(async () => ({ data: [] })) },
        tasks: { list: vi.fn(async () => ({ data: tasks })) },
      },
      openTask: vi.fn(), write: vi.fn(), afterMutation: vi.fn(),
    };
    const root = BoardScreen(ctx);
    document.body.append(root);
    await settle();
    const card = (id) => [...root.querySelectorAll('.tcard')].find((c) => c.dataset.taskId === id);
    expect(card('t1').querySelector('.texternal').textContent).toBe('External: Ahmed Al Said (Acme) and 2 more');
    expect(card('t1').getAttribute('aria-label')).toContain('External: Ahmed Al Said (Acme) and 2 more');
    expect(card('t2').querySelector('.texternal')).toBeNull();
  });

  it('a task row (My Tasks, Dashboard, Calendar) shows it too', async () => {
    const { taskRow } = await import('../app/components.js');
    const row = taskRow({ id: 't1', key: 'OPS-7', title: 'Inspect the rig', priority: 'NORMAL', dueDate: null, progress: 0, externalSummary: summary }, () => {});
    expect(row.querySelector('.texternal').textContent).toBe('External: Ahmed Al Said (Acme) and 2 more');
    expect(row.getAttribute('aria-label')).toContain('External: Ahmed Al Said (Acme) and 2 more');
    expect(taskRow({ id: 't2', key: 'OPS-8', title: 'x', priority: 'NORMAL', dueDate: null, progress: 0 }, () => {}).querySelector('.texternal')).toBeNull();
  });
});

describe('external contacts: focus and timing (review)', () => {
  it('after a rename, focus goes back to that contact’s Edit button (by its new name)', async () => {
    const root = await open();
    byLabel(root, 'Edit Ahmed Al Said').click();
    await settle();
    const form = contacts(root).querySelector('form');
    type(fieldOf(form, 'Name'), 'Ahmed Said');
    form.requestSubmit();
    await settle();
    expect(document.activeElement).toBe(byLabel(root, 'Edit Ahmed Said'));
  });

  it('after adding the 20th contact (Add is off now), focus goes to the section’s heading', async () => {
    const many = Array.from({ length: 19 }, (_, i) => ({ ...ahmed, id: `x${i}`, name: `Person ${i}` }));
    const root = await open(drawerCtx({ task: { externalContacts: many } }));
    byText(root, 'button', W.add).click();
    await settle();
    const form = contacts(root).querySelector('form');
    type(fieldOf(form, 'Name'), 'Sara');
    form.requestSubmit();
    await settle();
    expect(byText(contacts(root), 'button', W.add).disabled).toBe(true);
    expect(document.activeElement).toBe(contacts(root).querySelector('h3'));
  });

  it('suggestions that arrive after the Name box was left are not shown', async () => {
    const suggest = vi.fn(async () => [{ name: 'Ahmed Al Said', company: 'Acme', designation: null, email: null, phone: null, remarks: null }]);
    const root = await open(drawerCtx({ task: { externalContacts: [] }, suggest }));
    byText(root, 'button', W.add).click();
    await settle();
    const form = contacts(root).querySelector('form');
    type(fieldOf(form, 'Name'), 'Ahm');
    fieldOf(form, 'Company').focus();
    await waitFor(300);
    await settle();
    expect(form.querySelector('[role="listbox"]')).toBeNull();
    expect(fieldOf(form, 'Name').getAttribute('aria-expanded')).toBe('false');
  });

  it('typing again puts the old suggestions away at once, so they can’t be picked meanwhile', async () => {
    const suggest = vi.fn(async (_p, q) => (q === 'Ahm' ? [{ name: 'Ahmed Al Said', company: 'Acme', designation: null, email: null, phone: null, remarks: null }] : []));
    const root = await open(drawerCtx({ task: { externalContacts: [] }, suggest }));
    byText(root, 'button', W.add).click();
    await settle();
    const form = contacts(root).querySelector('form');
    const name = fieldOf(form, 'Name');
    name.focus();
    type(name, 'Ahm');
    await waitFor(300);
    await settle();
    expect(form.querySelector('[role="listbox"]')).not.toBeNull();
    type(name, 'Ahmx');
    expect(form.querySelector('[role="listbox"]')).toBeNull();
    key(name, 'ArrowDown');
    key(name, 'Enter');
    expect(name.value).toBe('Ahmx');
    expect(fieldOf(form, 'Company').value).toBe('');
  });

  it('an add that lands after the task was read again without contacts (an older server) is not called a failure', async () => {
    let release;
    const ctx = drawerCtx();
    ctx.write = vi.fn(async (kind) => {
      if (kind === 'task.update') throw new ApiError(409, 'Task t1 was changed by someone else.', 'VERSION_CONFLICT');
      await new Promise((r) => { release = r; });
      return { queued: false, data: { id: 'x9', taskId: 't1', name: 'Sara', company: null, designation: null, email: null, phone: null, remarks: null, position: 1 } };
    });
    const root = await open(ctx);
    byText(root, 'button', W.add).click();
    await settle();
    const form = contacts(root).querySelector('form');
    type(fieldOf(form, 'Name'), 'Sara');
    form.requestSubmit();
    await settle();
    // Meanwhile the task is read again (a refused edit) from a server without external contacts.
    ctx.api.tasks.get.mockResolvedValue({ data: { id: 't1', key: 'OPS-7', title: 'Inspect the rig', priority: 'NORMAL', projectId: 'p1', version: 4, tags: [] } });
    byLabel(root, 'Milestone').click();
    await settle();
    release();
    await settle();
    expect(root.querySelector('[role="alert"]').textContent).not.toContain(W.addFailed);
    expect(contacts(root)).toBeNull();
  });
});
