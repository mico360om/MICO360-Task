/**
 * MICO AI fixtures shared by the app's tests and the drift tests (Stage 3 Lane AI). Test-only —
 * nothing in the app imports this folder.
 */
import type {
  CreateTaskChange,
  MeetingChange,
  MicoAiChat,
  MicoAiMessage,
  MicoAiProposal,
  MinutesChange,
  ProposalChange,
  ProposalStatus,
  UpdateTaskChange,
} from '../lib/mico-ai-api';

/** 30 Oct 2026, 12:00 in Muscat — the "now" the chat groups are read against. */
export const NOW = new Date('2026-10-30T08:00:00Z');

const chat = (id: string, title: string, lastMessageAt: string, match: string | null = null): MicoAiChat => ({
  id,
  title,
  createdAt: '2026-09-01T06:00:00.000Z',
  updatedAt: lastMessageAt,
  lastMessageAt,
  match,
});

/** Titled and untitled chats: today, yesterday, 3 days ago and 40 days ago (Muscat time). */
export const CHATS: MicoAiChat[] = [
  chat('c-old', 'Rig 3 handover', '2026-09-20T07:00:00.000Z'),
  chat('c-today', 'Overdue tasks', '2026-10-30T06:30:00.000Z', '…which of my tasks are **overdue**…'),
  chat('c-yesterday', '', '2026-10-29T15:00:00.000Z'),
  chat('c-3days', 'Workload report', '2026-10-27T05:00:00.000Z'),
  // 00:30 in Muscat on the 30th, though still the 29th in UTC — today, by the person's day.
  chat('c-late', '  ', '2026-10-29T20:30:00.000Z'),
];

export const QUESTION: MicoAiMessage = {
  id: 'm-q1',
  role: 'user',
  status: 'done',
  text: 'Which of my tasks are overdue?',
  createdAt: '2026-10-30T06:30:00.000Z',
  step: null,
};

/** A done answer: paragraphs, "- " bullets and **bold**; a table with every cell kind; every source type. */
export const ANSWER: MicoAiMessage = {
  id: 'm-a1',
  role: 'assistant',
  status: 'done',
  text: 'You have **3 overdue** tasks.\nTwo are in Rig 3.\n\n- **RIG-3** Pump check\n* RIG-7 <b>Valve</b> swap\n• Site walk\n\nAsk me to move them if you like.',
  createdAt: '2026-10-30T06:30:05.000Z',
  step: null,
  answer: {
    kind: 'answer',
    unavailable: false,
    tables: [
      {
        title: 'Overdue tasks',
        fromResult: 'r1',
        columns: [
          { key: 'key', label: 'Task', kind: 'key' },
          { key: 'title', label: 'Title', kind: 'text' },
          { key: 'due', label: 'Due', kind: 'date' },
          { key: 'updated', label: 'Updated', kind: 'datetime' },
          { key: 'hours', label: 'Hours', kind: 'number' },
          { key: 'done', label: 'Done', kind: 'percent' },
          { key: 'late', label: 'Late', kind: 'days' },
          { key: 'note', label: 'Note' },
        ],
        rows: [
          { ref: { type: 'task', id: 't3', label: 'RIG-3', url: '?task=t3' }, cells: ['RIG-3', 'Pump check', '2026-10-19', '2026-10-28T09:05:00', 4.5, 40, 11, 'Waiting on parts'] },
          { ref: null, cells: ['RIG-7', 'Valve swap', '2026-10-29', '2026-10-29', 0, 0, 1, null] },
          { ref: null, cells: ['SITE-1', '', null, null, null, null, null, ''] },
        ],
        total: 12,
      },
    ],
    sources: [
      { type: 'task', id: 't3', label: 'RIG-3', url: '?task=t3' },
      { type: 'project', id: 'p1', label: 'Rig 3', url: '/projects/p1' },
      { type: 'meeting', id: 'mt1', label: 'Site walk', url: '/meetings/mt1' },
      { type: 'chat', id: 'msg9', label: 'Team chat', url: '/chat?conversation=cv4' },
      { type: 'person', id: 'u-omar', label: 'Omar Said', url: null },
    ],
    followUps: ['Move them to next week', 'Who else is late?'],
    options: [],
  },
};

/** MICO AI asks which one was meant. */
export const CLARIFY: MicoAiMessage = {
  id: 'm-a2',
  role: 'assistant',
  status: 'done',
  text: 'Which Omar do you mean?',
  createdAt: '2026-10-30T06:31:00.000Z',
  step: null,
  answer: { kind: 'clarify', unavailable: false, tables: [], sources: [], followUps: [], options: ['Omar Said', 'Omar Haddad'] },
};

/** An answer still being written, with what MICO AI is doing. */
export const PENDING: MicoAiMessage = {
  id: 'm-a3',
  role: 'assistant',
  status: 'pending',
  text: '',
  createdAt: '2026-10-30T06:32:00.000Z',
  step: 'Reading your tasks…',
};

const base = { needs: [], problem: null, locked: false, warning: null, result: null, undo: null };

const create = (id: string, extra: Partial<CreateTaskChange> = {}): CreateTaskChange => ({
  ...base,
  id,
  type: 'create_task',
  fields: { title: `Task ${id}`, projectId: 'p-rig', assigneeIds: ['u-sara'], due: '2026-10-27', priority: 'NORMAL', description: '' },
  labels: { project: 'Rig Inspection Portal', assignees: [{ id: 'u-sara', name: 'Sara Ahmed' }] },
  ...extra,
});
const update = (id: string, extra: Partial<UpdateTaskChange> = {}): UpdateTaskChange => ({
  ...base,
  id,
  type: 'update_task',
  task: { id: 't14', key: 'RIG-14', title: 'Pressure test report', projectId: 'p-rig', project: 'Rig Inspection Portal', url: '?task=t14' },
  base: { version: 3, assigneeIds: ['u-omar'], activity: 4 },
  before: { due: '2026-10-19', priority: 'NORMAL', columnId: 'c-doing', column: 'In progress', assignees: [{ id: 'u-omar', name: 'Omar Said' }] },
  fields: { due: '2026-10-25', priority: 'HIGH' },
  labels: {},
  ...extra,
});
const minutes = (id: string, extra: Partial<MinutesChange> = {}): MinutesChange => ({
  ...base,
  id,
  type: 'draft_minutes',
  meeting: { id: 'm1', title: 'Site visit', startAt: '2026-10-22T06:00:00.000Z', url: '/meetings/m1' },
  fields: { content: { summary: 'S', discussion: [{ topic: 'Safety', text: 'All clear.' }], decisions: ['Go ahead'], risks: [], nextSteps: ['Order valves'] } },
  base: { status: 'NONE', savedAt: null },
  ...extra,
});
const meeting = (id: string, extra: Partial<MeetingChange> = {}): MeetingChange => ({
  ...base,
  id,
  type: 'schedule_meeting',
  fields: { title: 'Review', projectId: null, date: '2026-10-27', time: '10:00', minutes: 30, attendeeIds: ['u-sara'], agenda: ['Progress'], description: '' },
  labels: { project: null, attendees: [{ id: 'u-sara', name: 'Sara Ahmed' }] },
  ...extra,
});

const card = (status: ProposalStatus, items: ProposalChange[], extra: Partial<MicoAiProposal> = {}): MicoAiProposal => ({
  id: `p-${status}`,
  status,
  note: null,
  sendInvites: true,
  hasMeetings: items.some((i) => i.type === 'schedule_meeting'),
  items,
  confirmedAt: null,
  undoUntil: null,
  canUndo: false,
  serverNow: '2026-10-30T08:00:00.000Z',
  ...extra,
});

const done = (message: string, label: string, url: string) => ({ status: 'done' as const, message, link: { label, url } });

/**
 * One card per status. The proposed one has all four kinds, a change that needs putting right and
 * a locked one; the done and undone ones have results and undos of every kind.
 */
export const PROPOSALS: MicoAiProposal[] = [
  card(
    'proposed',
    [
      create('c1', { needs: [{ fields: ['projectId'], message: 'Pick a project.' }], problem: 'Pick a project.', fields: { title: 'Order valves', projectId: null, assigneeIds: [], due: null, priority: 'HIGH', description: 'For RIG-3' }, labels: { project: null, assignees: [] }, ownerDefault: true }),
      update('c2', { warning: 'RIG-14 was changed by Sara since.' }),
      minutes('c3'),
      meeting('c4', { needs: [{ fields: ['time'], message: 'Pick a time.' }, { fields: ['title', 'date'], message: 'Give it a title.' }], problem: 'Pick a time. Give it a title.' }),
      update('c5', { locked: true, problem: 'Nothing to change.', fields: {} }),
    ],
    { note: 'I left RIG-9 out: it is done.' },
  ),
  card('confirming', [create('c1', { result: { status: 'started', message: null, link: null } }), create('c2')]),
  card(
    'done',
    [
      create('c1', { result: done('Created RIG-31.', 'RIG-31', '?task=t31') }),
      update('c2', { result: { status: 'refused', message: 'RIG-14 was deleted since.', link: null } }),
      meeting('c3', { result: { status: 'failed', message: null, link: null } }),
      minutes('c4', { result: { status: 'skipped', message: null, link: null } }),
    ],
    { confirmedAt: '2026-10-30T07:59:00.000Z', undoUntil: '2026-10-30T08:14:00.000Z' },
  ),
  card('cancelled', [meeting('c1')]),
  card(
    'undoing',
    [update('c1', { result: done('RIG-14 moved to 25 Oct.', 'RIG-14', '?task=t14'), undo: { status: 'started', message: null } }), update('c2', { result: done('RIG-15 is High.', 'RIG-15', '?task=t15') })],
    { confirmedAt: '2026-10-30T07:50:00.000Z', undoUntil: '2026-10-30T08:05:00.000Z', canUndo: true },
  ),
  card(
    'undone',
    [
      create('c1', { result: done('Created RIG-31.', 'RIG-31', '?task=t31'), undo: { status: 'undone', message: null, gone: true } }),
      update('c2', { result: done('RIG-14 moved.', 'RIG-14', '?task=t14'), undo: { status: 'refused', message: 'Sara changed RIG-14 since.' } }),
      meeting('c3', { result: done('Scheduled Review.', 'Review', '/meetings/m7'), undo: { status: 'failed', message: null } }),
    ],
    { confirmedAt: '2026-10-30T07:50:00.000Z', undoUntil: '2026-10-30T08:05:00.000Z' },
  ),
  card('superseded', [minutes('c1')]),
];

/** A done proposal answer carrying a card. */
export const proposalMessage = (p: MicoAiProposal, id = `m-${p.id}`): MicoAiMessage => ({
  id,
  role: 'assistant',
  status: 'done',
  text: 'Here is what I would change.',
  createdAt: '2026-10-30T07:58:00.000Z',
  step: null,
  answer: { kind: 'proposal', unavailable: false, tables: [], sources: [], followUps: [], options: [], proposal: p },
});
