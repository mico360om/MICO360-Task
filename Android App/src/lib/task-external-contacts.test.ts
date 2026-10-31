import { describe, it, expect } from 'vitest';
import { ApiError, NetworkError } from './api-client';
import {
  CONTACTS_OFFLINE,
  callLabel,
  companyChoices,
  companyFilterLabel,
  contactFailureText,
  contactFieldProblems,
  contactInputs,
  contactRowsOf,
  contactsDirty,
  draftOf,
  editContactLabel,
  emailLabel,
  emptyContact,
  externalContactRefreshes,
  filterByExternalCompany,
  newContactRow,
  planContactChanges,
  removeContactLabel,
  saveContactChanges,
  withExternalContacts,
  type SavedContact,
} from './task-external-contacts';
import type { ExternalContactFields } from './external-contacts';
import { summarizeExternalContacts } from './external-contacts';

const f = (name: string, extra: Partial<ExternalContactFields> = {}): ExternalContactFields => ({ ...emptyContact(), name, ...extra });

describe('external contacts on the phone: the rows of a form', () => {
  it('starts each contact blank, and turns the task’s contacts into rows with their ids', () => {
    expect(emptyContact()).toEqual({ name: '', company: null, designation: null, email: null, phone: null, remarks: null });
    const rows = contactRowsOf([{ id: 'x1', taskId: 't', position: 0, ...f('Ahmed', { company: 'OXY' }) }]);
    expect(rows).toEqual([{ key: 'x1', id: 'x1', fields: f('Ahmed', { company: 'OXY' }) }]);
    const fresh = newContactRow(f('Sara'));
    expect(fresh.id).toBeUndefined();
    expect(fresh.key).not.toBe(newContactRow(f('Sara')).key);
  });

  it('fills the editor’s six boxes from a contact (nothing given is an empty box)', () => {
    expect(draftOf(f('Ahmed', { company: 'OXY', remarks: 'Site lead' }))).toEqual({ name: 'Ahmed', company: 'OXY', designation: '', email: '', phone: '', remarks: 'Site lead' });
    expect(draftOf(null)).toEqual({ name: '', company: '', designation: '', email: '', phone: '', remarks: '' });
  });

  it('sends a new task’s contacts as their six fields, in order', () => {
    expect(contactInputs([newContactRow(f('Ahmed', { company: 'OXY' })), newContactRow(f('Sara'))])).toEqual([f('Ahmed', { company: 'OXY' }), f('Sara')]);
  });

  it('knows when the rows differ from what is saved', () => {
    const saved: SavedContact[] = [{ id: 'x1', fields: f('Ahmed') }];
    expect(contactsDirty(saved, [{ key: 'x1', id: 'x1', fields: f('Ahmed') }])).toBe(false);
    expect(contactsDirty(saved, [{ key: 'x1', id: 'x1', fields: f('Ahmed', { phone: '+968 1' }) }])).toBe(true);
    expect(contactsDirty(saved, [])).toBe(true);
    expect(contactsDirty([], [newContactRow(f('A'))])).toBe(true);
  });
});

describe('external contacts on the phone: saving an edit', () => {
  const saved: SavedContact[] = [
    { id: 'x1', fields: f('Ahmed', { company: 'OXY' }) },
    { id: 'x2', fields: f('Sara') },
    { id: 'x3', fields: f('Salim') },
  ];
  const rows = () => [
    { key: 'x1', id: 'x1', fields: f('Ahmed Al Said', { company: 'OXY' }) },
    { key: 'x3', id: 'x3', fields: f('Salim') },
    { key: 'n1', fields: f('Aisha', { company: 'PDO' }) },
  ];

  it('plans only what changed: removals first, then changes, then additions', () => {
    expect(planContactChanges(saved, rows())).toEqual({
      remove: ['x2'],
      update: [{ id: 'x1', fields: f('Ahmed Al Said', { company: 'OXY' }) }],
      add: [{ key: 'n1', fields: f('Aisha', { company: 'PDO' }) }],
    });
    expect(planContactChanges(saved, saved.map((s) => ({ key: s.id, id: s.id, fields: s.fields })))).toEqual({ remove: [], update: [], add: [] });
  });

  it('sends each change and keeps what went, so a retry sends only the rest', async () => {
    const calls: string[] = [];
    const deps = {
      remove: async (id: string) => {
        calls.push(`remove ${id}`);
      },
      update: async (id: string, fields: ExternalContactFields) => {
        calls.push(`update ${id} ${fields.name}`);
      },
      add: async (fields: ExternalContactFields) => {
        calls.push(`add ${fields.name}`);
        if (fields.name === 'Aisha') throw new ApiError(409, 'TOO_MANY_EXTERNAL_CONTACTS', 'A task can have at most 20 external contacts.');
        return { id: 'new' };
      },
    };
    const out = await saveContactChanges(deps, saved, rows());
    expect(calls).toEqual(['remove x2', 'update x1 Ahmed Al Said', 'add Aisha']);
    expect(out.problem).toBe('A task can have at most 20 external contacts.');
    expect(out.saved).toEqual([{ id: 'x1', fields: f('Ahmed Al Said', { company: 'OXY' }) }, { id: 'x3', fields: f('Salim') }]);
    // What is left to send: the addition only.
    expect(planContactChanges(out.saved, out.rows)).toEqual({ remove: [], update: [], add: [{ key: 'n1', fields: f('Aisha', { company: 'PDO' }) }] });

    calls.length = 0;
    const again = await saveContactChanges({ ...deps, add: async (fields) => (calls.push(`add ${fields.name}`), { id: 'x9' }) }, out.saved, out.rows);
    expect(calls).toEqual(['add Aisha']);
    expect(again.problem).toBeNull();
    expect(again.rows.find((r) => r.key === 'n1')?.id).toBe('x9');
    expect(planContactChanges(again.saved, again.rows)).toEqual({ remove: [], update: [], add: [] });
  });

  it('a contact someone else removed already counts as removed', async () => {
    const gone = new ApiError(404, 'NOT_FOUND', 'This contact isn’t on the task any more. Someone may have removed it.');
    const out = await saveContactChanges({ remove: async () => { throw gone; }, update: async () => {}, add: async () => ({ id: 'n' }) }, [{ id: 'x2', fields: f('Sara') }], []);
    expect(out).toEqual({ saved: [], rows: [], problem: null });
  });
});

describe('external contacts on the phone: what goes wrong, in words', () => {
  it('reads each field’s problem from the server’s answer', () => {
    const err = new ApiError(400, 'VALIDATION', 'Enter the contact’s name.', { fields: { name: 'Enter the contact’s name.', email: 'Enter a valid email address, like name@company.com.' } });
    expect(contactFieldProblems(err)).toEqual({ name: 'Enter the contact’s name.', email: 'Enter a valid email address, like name@company.com.' });
    expect(contactFieldProblems(new Error('x'))).toEqual({});
    expect(contactFieldProblems(new ApiError(400, 'VALIDATION', 'x', { fields: { name: 3, other: 'y' } }))).toEqual({});
  });

  it('says a change needs a connection, else the server’s reason, else the fallback', () => {
    expect(contactFailureText(new NetworkError('down'), 'Couldn’t add the contact.')).toBe(CONTACTS_OFFLINE);
    expect(CONTACTS_OFFLINE).toBe('Changing external contacts needs a connection — check your connection and try again.');
    expect(contactFailureText(new ApiError(403, 'FORBIDDEN', 'You can’t change the external contacts of this task.'), 'x')).toBe('You can’t change the external contacts of this task.');
    expect(contactFailureText(null, 'Couldn’t add the contact.')).toBe('Couldn’t add the contact.');
  });

  it('names each button and link after the contact for TalkBack', () => {
    const c = f('Ahmed Al Said', { email: 'ahmed@oxy.com', phone: '+968 9912 3456' });
    expect(editContactLabel(c)).toBe('Edit Ahmed Al Said');
    expect(removeContactLabel(c)).toBe('Remove Ahmed Al Said');
    expect(emailLabel(c)).toBe('Email Ahmed Al Said at ahmed@oxy.com');
    expect(callLabel(c)).toBe('Call Ahmed Al Said on +968 9912 3456');
  });
});

describe('external contacts on the phone: where they show and what they refresh', () => {
  it('sit right after the details, apart from the assignees, on a phone and beside the work', () => {
    expect(withExternalContacts({ top: [], main: ['description', 'details', 'checklist'], side: [] })).toEqual({ top: [], main: ['description', 'details', 'external', 'checklist'], side: [] });
    expect(withExternalContacts({ top: ['approval'], main: ['description', 'checklist'], side: ['details', 'files'] })).toEqual({ top: ['approval'], main: ['description', 'checklist'], side: ['details', 'external', 'files'] });
  });

  it('a change refreshes the task, its history and the lists that show it', () => {
    expect(externalContactRefreshes('t1')).toEqual([{ queryKey: ['task', 't1'], exact: true }, { queryKey: ['task', 't1', 'activity'], exact: true }, { listsHolding: 't1' }]);
  });

  it('the company filter: its button says what is chosen, and offers Any company then each company', () => {
    expect(companyFilterLabel('')).toBe('External company: Any company');
    expect(companyFilterLabel('OXY')).toBe('External company: OXY');
    expect(companyChoices(['OXY', 'PDO'])).toEqual([{ value: '', label: 'Any company' }, { value: 'OXY', label: 'OXY' }, { value: 'PDO', label: 'PDO' }]);
  });

  it('filters a list by an external company (case and spaces aside); no company keeps them all', () => {
    const tasks = [
      { id: 'a', externalSummary: summarizeExternalContacts([{ name: 'Ahmed', company: 'OXY Oman' }]) },
      { id: 'b', externalSummary: null },
      { id: 'c' },
    ];
    expect(filterByExternalCompany(tasks, 'oxy  oman').map((t) => t.id)).toEqual(['a']);
    expect(filterByExternalCompany(tasks, '').map((t) => t.id)).toEqual(['a', 'b', 'c']);
  });
});
