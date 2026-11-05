import { describe, it, expect } from 'vitest';
import {
  checklistKey,
  combineDescriptions,
  contactFill,
  defaultMainId,
  dependencyPlan,
  descriptionHeading,
  differences,
  fileKey,
  mergedNoticeTitle,
  mergedText,
  resolveChoices,
  sameContact,
  undoDescription,
  undoValue,
  type MergeTaskFacts,
} from './merge-rules';

const TZ = 'Asia/Muscat';
const task = (id: string, extra: Partial<MergeTaskFacts> = {}): MergeTaskFacts => ({
  id,
  key: `MICO-${id}`,
  title: `Task ${id}`,
  description: null,
  projectId: 'p1',
  projectName: 'Rig Inspection',
  columnId: 'c-todo',
  columnName: 'To do',
  columnCategory: 'TODO',
  priority: 'NORMAL',
  startDate: null,
  dueDate: null,
  isMilestone: false,
  clientVisible: false,
  clientShowDescription: false,
  recurrenceRule: null,
  inspectionFormId: null,
  inspectionFormTitle: null,
  meetingId: null,
  meetingTitle: null,
  needsApproval: false,
  createdAt: new Date('2026-11-01T08:00:00Z'),
  ...extra,
});

describe('merge rules — the choices', () => {
  it('lists only the fields the tasks differ in, the main task’s value first, with each task’s number', () => {
    const tasks = [
      task('14', { priority: 'HIGH', dueDate: new Date('2026-11-03T00:00:00Z') }),
      task('12', { dueDate: new Date('2026-11-05T00:00:00Z') }),
      task('15', { priority: 'HIGH' }),
    ];
    const diff = differences(tasks, '12', TZ);
    expect(diff.map((d) => d.field)).toEqual(['title', 'priority', 'dueDate']);
    const due = diff.find((d) => d.field === 'dueDate')!;
    expect(due.options).toEqual([
      { value: '12', label: '5 Nov 2026', keys: ['MICO-12'] },
      { value: '14', label: '3 Nov 2026', keys: ['MICO-14'] },
      { value: '15', label: 'No due date', keys: ['MICO-15'] },
    ]);
    expect(diff.find((d) => d.field === 'priority')!.options).toEqual([
      { value: '12', label: 'Normal', keys: ['MICO-12'] },
      { value: '14', label: 'High', keys: ['MICO-14', 'MICO-15'] },
    ]);
  });

  it('the same values never make a row; the repeat can always be none', () => {
    const rule = { freq: 'WEEKLY' as const, interval: 1, weekdays: [1] };
    const tasks = [task('1', { title: 'Same', recurrenceRule: rule }), task('2', { title: 'Same', recurrenceRule: { ...rule, interval: 2 } })];
    const diff = differences(tasks, '1', TZ);
    expect(diff.map((d) => d.field)).toEqual(['repeat']);
    expect(diff[0]!.options.map((o) => o.value)).toEqual(['1', '2', 'none']);
    // Equal rules written in another order are the same rule.
    expect(differences([task('1', { title: 'S', recurrenceRule: { interval: 1, freq: 'DAILY' } as never }), task('2', { title: 'S', recurrenceRule: { freq: 'DAILY', interval: 1 } })], '1', TZ)).toEqual([]);
  });

  it('a project, a status and the client switch are choices too', () => {
    const tasks = [task('1', { title: 'S' }), task('2', { title: 'S', projectId: 'p2', projectName: 'Operations', columnName: 'Doing', columnCategory: 'IN_PROGRESS', clientVisible: true })];
    const diff = differences(tasks, '1', TZ);
    expect(diff.map((d) => d.field)).toEqual(['project', 'status', 'clientVisible']);
    expect(diff[1]!.options.map((o) => o.label)).toEqual(['To do', 'Doing (In progress)']);
  });

  it('resolves each field to the task chosen, the main task by default, and refuses a task not in the merge', () => {
    const tasks = [task('1'), task('2')];
    const r = resolveChoices(tasks, '1', { priority: '2', repeat: 'none' });
    expect(r.ok && r.sources.priority).toBe('2');
    expect(r.ok && r.sources.title).toBe('1');
    expect(r.ok && r.sources.repeat).toBe('none');
    expect(resolveChoices(tasks, '1', { dueDate: 'elsewhere' })).toEqual({ ok: false, field: 'dueDate' });
    expect(resolveChoices(tasks, '1', { title: 'none' })).toEqual({ ok: false, field: 'title' });
  });

  it('the main task by default is the oldest', () => {
    expect(defaultMainId([task('a', { createdAt: new Date('2026-11-03') }), task('b', { createdAt: new Date('2026-11-01') })])).toBe('b');
    expect(defaultMainId([])).toBeNull();
  });
});

describe('merge rules — descriptions', () => {
  it('the main task’s first, then each other’s under a heading; empty ones skipped', () => {
    const r = combineDescriptions({ description: 'Main text\n' }, [
      { key: 'MICO-14', title: 'Inspect the rig ', description: 'From fourteen' },
      { key: 'MICO-15', title: 'Empty', description: '  ' },
      { key: 'MICO-16', title: 'Pump', description: 'Pump notes' },
    ]);
    expect(r.text).toBe('Main text\n\n— From MICO-14 · Inspect the rig —\nFrom fourteen\n\n— From MICO-16 · Pump —\nPump notes');
    expect(r.parts).toHaveLength(2);
    expect(descriptionHeading('MICO-14', ' Inspect ')).toBe('— From MICO-14 · Inspect —');
  });

  it('an empty main description starts with the first part; nothing to add keeps it as it is', () => {
    expect(combineDescriptions({ description: null }, [{ key: 'A-1', title: 'T', description: 'x' }]).text).toBe('— From A-1 · T —\nx');
    expect(combineDescriptions({ description: null }, [{ key: 'A-1', title: 'T', description: null }])).toEqual({ text: null, parts: [] });
  });

  it('undo: back to before when unchanged; otherwise only the merged parts come out', () => {
    const { text, parts } = combineDescriptions({ description: 'Main' }, [{ key: 'A-2', title: 'T', description: 'two' }]);
    expect(undoDescription(text, text, 'Main', parts)).toBe('Main');
    expect(undoDescription(`${text}\n\nAdded later`, text, 'Main', parts)).toBe('Main\n\nAdded later');
    expect(undoDescription('Rewritten', text, 'Main', parts)).toBe('Rewritten');
    const fromEmpty = combineDescriptions({ description: null }, [{ key: 'A-2', title: 'T', description: 'two' }]);
    expect(undoDescription(fromEmpty.text, fromEmpty.text, null, fromEmpty.parts)).toBeNull();
    expect(undoDescription(`${fromEmpty.text}\n\nmore`, fromEmpty.text, null, fromEmpty.parts)).toBe('more');
  });
});

describe('merge rules — duplicates', () => {
  it('checklist items: the same text (case and spaces aside) and the same state', () => {
    expect(checklistKey({ text: ' Check  pump ', done: false })).toBe(checklistKey({ text: 'check pump', done: false }));
    expect(checklistKey({ text: 'Check pump', done: true })).not.toBe(checklistKey({ text: 'Check pump', done: false }));
  });

  it('contacts: the same email, or the same phone number (a country code on one copy only)', () => {
    expect(sameContact({ email: 'A@x.com ', phone: null }, { email: 'a@x.com', phone: null })).toBe(true);
    expect(sameContact({ email: null, phone: '+968 9123 4567' }, { email: null, phone: '91234567' })).toBe(true);
    expect(sameContact({ email: null, phone: '1234' }, { email: null, phone: '1234' })).toBe(false);
    expect(sameContact({ email: 'a@x.com', phone: '91234567' }, { email: 'b@x.com', phone: '92223333' })).toBe(false);
  });

  it('a kept contact gets the fields it is missing from the other copy, never loses its own', () => {
    const kept = { name: 'Ahmed', company: null, designation: 'Engineer', email: 'a@x.com', phone: null, remarks: '' };
    const other = { name: 'Ahmed Al Said', company: 'OXY', designation: 'Lead', email: 'a@x.com', phone: '91234567', remarks: null };
    expect(contactFill(kept, other)).toEqual({ company: 'OXY', phone: '91234567' });
  });

  it('files: the same name (case aside) and size, before their content is compared', () => {
    expect(fileKey({ filename: 'Report.PDF', sizeBytes: 10 })).toBe(fileKey({ filename: 'report.pdf', sizeBytes: 10 }));
    expect(fileKey({ filename: 'report.pdf', sizeBytes: 11 })).not.toBe(fileKey({ filename: 'report.pdf', sizeBytes: 10 }));
  });
});

describe('merge rules — blocker links', () => {
  const e = (id: string, taskId: string, dependsOnTaskId: string) => ({ id, taskId, dependsOnTaskId });

  it('moves a merged task’s links to the main task; drops links between the merged tasks', () => {
    const edges = [e('1', 'T', 'X'), e('2', 'Y', 'T'), e('3', 'T', 'M'), e('4', 'T', 'U')];
    const plan = dependencyPlan(edges, 'M', ['T', 'U']);
    expect(plan.move.map((m) => [m.edge.id, m.side])).toEqual([
      ['1', 'blocked'],
      ['2', 'blocking'],
    ]);
    expect(plan.dropped.map((d) => [d.edge.id, d.reason])).toEqual([
      ['3', 'between'],
      ['4', 'between'],
    ]);
  });

  it('a link the main task already has is kept once', () => {
    const plan = dependencyPlan([e('1', 'M', 'X'), e('2', 'T', 'X'), e('3', 'U', 'X')], 'M', ['T', 'U']);
    expect(plan.move).toEqual([]);
    expect(plan.dropped.map((d) => [d.edge.id, d.reason])).toEqual([
      ['2', 'duplicate'],
      ['3', 'duplicate'],
    ]);
  });

  it('a link that would make a loop is dropped and named', () => {
    // M blocked by X; T blocks X (X blocked by T) → after the merge X blocked by M, and M blocked by X: a loop.
    const plan = dependencyPlan([e('1', 'M', 'X'), e('2', 'X', 'T')], 'M', ['T']);
    expect(plan.dropped.map((d) => [d.edge.id, d.reason])).toEqual([['2', 'loop']]);
    // Indirect: M ← Y ← X (M blocked by Y, Y blocked by X); T blocked... X blocked by T → X ← M: loop.
    const indirect = dependencyPlan([e('2', 'X', 'T')], 'M', ['T'], [e('1', 'M', 'Y'), e('3', 'Y', 'X'), e('2', 'X', 'T')]);
    expect(indirect.dropped.map((d) => d.reason)).toEqual(['loop']);
  });
});

describe('merge rules — undo and words', () => {
  it('a field goes back only when nobody changed it since', () => {
    expect(undoValue({ before: 'NORMAL', after: 'HIGH' }, 'HIGH')).toEqual({ restore: true, value: 'NORMAL' });
    expect(undoValue({ before: 'NORMAL', after: 'HIGH' }, 'URGENT')).toEqual({ restore: false, value: 'URGENT' });
    expect(undoValue({ before: null, after: { freq: 'DAILY' } }, { freq: 'DAILY' })).toEqual({ restore: true, value: null });
  });

  it('says what happened', () => {
    expect(mergedText(['MICO-14', 'MICO-15'], 'MICO-12')).toBe('Merged MICO-14 and MICO-15 into MICO-12');
    expect(mergedNoticeTitle(['MICO-14'], 'MICO-12')).toBe('MICO-14 was merged into MICO-12');
    expect(mergedNoticeTitle(['A-1', 'A-2', 'A-3'], 'A-0')).toBe('A-1, A-2 and A-3 were merged into A-0');
  });
});
