import type {
  AiActionItemRec,
  AiActivityRec,
  AiChatMessageRec,
  AiConversationRec,
  AiMeetingDetail,
  AiMembershipRec,
  AiPersonRec,
  AiProjectRec,
  AiTaskExtras,
  AiTaskRec,
  MicoAiDataPort,
  Viewer,
} from './mico-ai-data';

/**
 * An in-memory MICO AI data port for tests, following the app's rules: a project is visible to its
 * owner, manager, creator and members (admins see all); a meeting to its organizer, creator and
 * attendees and its project's people; a conversation to its people (direct) or its project's people.
 */
export interface MemoryData {
  projects: Array<AiProjectRec & { createdById: string }>;
  members: AiMembershipRec[];
  tasks: AiTaskRec[];
  extras?: Record<string, Partial<AiTaskExtras>>;
  activity?: AiActivityRec[];
  meetings?: AiMeetingDetail[];
  actionItems?: AiActionItemRec[];
  conversations?: AiConversationRec[];
  messages?: AiChatMessageRec[];
  people: AiPersonRec[];
}

const isAdmin = (v: Viewer) => v.roles.includes('ADMIN');
const inRange = (d: Date, from?: Date, to?: Date) => (!from || d >= from) && (!to || d <= to);

export function createMemoryMicoAiData(d: MemoryData): MicoAiDataPort & { calls: string[] } {
  const calls: string[] = [];
  const visible = (v: Viewer): string[] | null =>
    isAdmin(v)
      ? null
      : d.projects
          .filter((p) => p.ownerId === v.userId || p.managerId === v.userId || p.createdById === v.userId || d.members.some((m) => m.projectId === p.id && m.userId === v.userId))
          .map((p) => p.id);
  const within = (ids: string[] | null, projectId: string | null) => ids === null || (!!projectId && ids.includes(projectId));
  const meetingVisible = (v: Viewer, m: AiMeetingDetail) =>
    isAdmin(v) || m.organizerId === v.userId || m.createdById === v.userId || m.attendeeUserIds.includes(v.userId) || (!!m.projectId && (visible(v) ?? []).includes(m.projectId));

  return {
    calls,
    async accessibleProjectIds(v) {
      calls.push('accessibleProjectIds');
      return visible(v);
    },
    async projects(ids) {
      calls.push('projects');
      return d.projects.filter((p) => within(ids, p.id));
    },
    async tasks(f) {
      calls.push('tasks');
      return d.tasks.filter((t) => within(f.projectIds, t.projectId) && (!f.projectId || t.projectId === f.projectId) && (!f.assigneeId || t.assigneeIds.includes(f.assigneeId)));
    },
    async findTask(ids, keyOrId) {
      calls.push('findTask');
      return d.tasks.find((t) => within(ids, t.projectId) && (t.id === keyOrId || t.key.toLowerCase() === keyOrId.toLowerCase())) ?? null;
    },
    async taskExtras(taskId) {
      calls.push('taskExtras');
      const e = d.extras?.[taskId] ?? {};
      return { description: null, checklist: [], comments: [], activity: [], blockedBy: [], blocks: [], meeting: null, ...e };
    },
    async activity(f) {
      calls.push('activity');
      return (d.activity ?? [])
        .filter((a) => within(f.projectIds, a.projectId) && (!f.projectId || a.projectId === f.projectId) && inRange(a.createdAt, f.from, f.to))
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice(0, f.limit);
    },
    async meetings(v, f) {
      calls.push('meetings');
      return (d.meetings ?? []).filter((m) => meetingVisible(v, m) && (!f.projectId || m.projectId === f.projectId) && inRange(m.startAt, f.from, f.to)).slice(0, f.limit);
    },
    async canViewMeeting(v, id) {
      calls.push('canViewMeeting');
      const m = (d.meetings ?? []).find((x) => x.id === id);
      return !!m && meetingVisible(v, m);
    },
    async meetingDetail(id) {
      calls.push('meetingDetail');
      return (d.meetings ?? []).find((m) => m.id === id) ?? null;
    },
    async actionItems(ids) {
      calls.push('actionItems');
      return (d.actionItems ?? []).filter((a) => ids.includes(a.meetingId));
    },
    async conversations(v) {
      calls.push('conversations');
      const ids = visible(v);
      return (d.conversations ?? []).filter((c) => (c.kind === 'DIRECT' ? c.participantIds.includes(v.userId) : within(ids, c.projectId)));
    },
    async chatMessages(f) {
      calls.push('chatMessages');
      return (d.messages ?? [])
        .filter(
          (m) =>
            f.conversationIds.includes(m.conversationId) &&
            (!f.text || m.body.toLowerCase().includes(f.text.toLowerCase())) &&
            (!f.senderIds || f.senderIds.includes(m.userId)) &&
            inRange(m.createdAt, f.from, f.to),
        )
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice(0, f.limit);
    },
    async people() {
      calls.push('people');
      return d.people;
    },
    async memberships(ids) {
      calls.push('memberships');
      const out: AiMembershipRec[] = [];
      for (const p of d.projects.filter((x) => within(ids, x.id))) {
        if (p.ownerId) out.push({ projectId: p.id, userId: p.ownerId, role: 'OWNER' });
        if (p.managerId && p.managerId !== p.ownerId) out.push({ projectId: p.id, userId: p.managerId, role: 'MANAGER' });
        for (const m of d.members.filter((x) => x.projectId === p.id)) if (!out.some((o) => o.projectId === p.id && o.userId === m.userId)) out.push(m);
      }
      return out;
    },
  };
}

// ── A small company: Khurram (admin), Omar and Sara (Rig Inspection), Layla (Falcon CRM only) ──
export const NOW = new Date('2026-10-24T08:00:00Z'); // Sat 24 Oct 2026, 12:00 in Muscat

export const ADMIN: Viewer = { userId: 'u-admin', roles: ['ADMIN'] };
export const OMAR: Viewer = { userId: 'u-omar', roles: ['EMPLOYEE'] };
export const SARA: Viewer = { userId: 'u-sara', roles: ['EMPLOYEE'] };
export const LAYLA: Viewer = { userId: 'u-layla', roles: ['EMPLOYEE'] };

const day = (key: string) => new Date(`${key}T00:00:00.000Z`);
const at = (iso: string) => new Date(iso);

function project(id: string, code: string, name: string, extra: Partial<AiProjectRec & { createdById: string }> = {}): AiProjectRec & { createdById: string } {
  return { id, code, number: null, name, status: 'ACTIVE', clientName: null, description: null, startDate: null, targetDate: null, managerId: null, ownerId: null, createdById: 'u-admin', ...extra };
}

function task(id: string, key: string, title: string, projectId: string, extra: Partial<AiTaskRec> = {}): AiTaskRec {
  const projectName = projectId === 'p-rig' ? 'Rig Inspection Portal' : 'Falcon CRM';
  return {
    id,
    key,
    title,
    projectId,
    projectName,
    columnName: 'To do',
    category: 'TODO',
    priority: 'NORMAL',
    startDate: null,
    dueDate: null,
    completedAt: null,
    createdAt: at('2026-10-01T08:00:00Z'),
    updatedAt: at('2026-10-20T08:00:00Z'),
    progress: 0,
    isMilestone: false,
    assigneeIds: [],
    ...extra,
  };
}

const meeting = (id: string, title: string, projectId: string | null, extra: Partial<AiMeetingDetail> = {}): AiMeetingDetail => ({
  id,
  title,
  projectId,
  organizerId: 'u-admin',
  createdById: 'u-admin',
  attendeeUserIds: [],
  startAt: at('2026-10-21T06:00:00Z'),
  endAt: at('2026-10-21T07:00:00Z'),
  status: 'COMPLETED',
  location: null,
  decisions: 0,
  openActionItems: 0,
  description: null,
  timeZone: null,
  attendees: [],
  agenda: [],
  notes: [],
  actionItems: [],
  decisionsList: [],
  finalMinutes: null,
  ...extra,
});

export function company(): MemoryData {
  return {
    projects: [
      project('p-rig', 'RIG', 'Rig Inspection Portal', { ownerId: 'u-omar', targetDate: day('2026-11-30') }),
      project('p-falcon', 'FAL', 'Falcon CRM', { ownerId: 'u-layla', number: 'C-2041' }),
    ],
    members: [
      { projectId: 'p-rig', userId: 'u-sara', role: 'MEMBER' },
      { projectId: 'p-falcon', userId: 'u-layla', role: 'MANAGER' },
    ],
    tasks: [
      task('t14', 'RIG-14', 'Pressure test report', 'p-rig', { dueDate: day('2026-10-19'), assigneeIds: ['u-omar'], columnName: 'In progress', category: 'IN_PROGRESS' }),
      task('t9', 'RIG-9', 'Valve inventory update', 'p-rig', { dueDate: day('2026-10-20'), assigneeIds: ['u-sara'] }),
      task('t21', 'RIG-21', 'Safety checklist v2', 'p-rig', { dueDate: day('2026-10-21'), assigneeIds: ['u-omar'] }),
      task('t15', 'RIG-15', 'Pilot on rig 3', 'p-rig', { dueDate: day('2026-10-30'), assigneeIds: ['u-sara'], columnName: 'Blocked', category: 'BLOCKED' }),
      task('t3', 'RIG-3', 'Site survey', 'p-rig', { dueDate: day('2026-10-10'), completedAt: at('2026-10-09T10:00:00Z'), columnName: 'Done', category: 'DONE', assigneeIds: ['u-omar'] }),
      task('f1', 'FAL-1', 'Client contract (secret)', 'p-falcon', { dueDate: day('2026-10-15'), assigneeIds: ['u-layla'] }),
      task('f2', 'FAL-2', 'Import leads', 'p-falcon', { dueDate: day('2026-10-28'), assigneeIds: ['u-layla', 'u-omar'] }),
    ],
    extras: {
      t14: {
        description: 'Run the pressure test on rig 2 and write the report.',
        checklist: [{ text: 'Calibrate the gauge', done: true }, { text: 'Write the report', done: false }],
        comments: [{ userId: 'u-sara', body: 'Vendor certificate is still missing.', createdAt: at('2026-10-20T09:00:00Z') }],
        blocks: [{ id: 't15', key: 'RIG-15', title: 'Pilot on rig 3', projectId: 'p-rig', category: 'BLOCKED', columnName: 'Blocked' }],
        blockedBy: [{ id: 'f1', key: 'FAL-1', title: 'Client contract (secret)', projectId: 'p-falcon', category: 'TODO', columnName: 'To do' }],
      },
    },
    activity: [
      { id: 'a1', taskId: 't14', projectId: 'p-rig', userId: 'u-omar', action: 'MOVED', meta: { from: 'To do', to: 'In progress' }, createdAt: at('2026-10-23T07:00:00Z'), task: { id: 't14', key: 'RIG-14', title: 'Pressure test report' } },
      { id: 'a2', taskId: 'f2', projectId: 'p-falcon', userId: 'u-layla', action: 'COMMENTED', meta: null, createdAt: at('2026-10-23T08:00:00Z'), task: { id: 'f2', key: 'FAL-2', title: 'Import leads' } },
    ],
    meetings: [
      meeting('m-weekly', 'Weekly review', 'p-rig', {
        decisions: 1,
        openActionItems: 1,
        notes: [{ type: 'DECISION', text: 'Omar to finish the pressure test once the gauge is calibrated.', authorId: 'u-sara', agendaTitle: 'RIG-14', createdAt: at('2026-10-21T06:20:00Z') }],
        actionItems: [{ description: 'Check the vendor’s certificate', assigneeId: 'u-sara', dueDate: day('2026-10-25'), status: 'OPEN', taskId: null, taskKey: null }],
        finalMinutes: { status: 'APPROVED', summary: 'Pressure test moved to rig 3.', discussion: [], decisions: ['Finish the pressure test after calibration'], risks: [], nextSteps: ['Sara: vendor certificate by 25 Oct'] },
      }),
      meeting('m-falcon', 'Falcon pricing (private)', 'p-falcon', { organizerId: 'u-layla', createdById: 'u-layla' }),
      meeting('m-1on1', 'Omar and Layla catch-up', null, { organizerId: 'u-layla', createdById: 'u-layla', attendeeUserIds: ['u-omar'], startAt: at('2026-10-22T09:00:00Z') }),
    ],
    actionItems: [
      { id: 'ai1', description: 'Check the vendor’s certificate', assigneeId: 'u-sara', dueDate: day('2026-10-25'), status: 'OPEN', meetingId: 'm-weekly', taskId: null, taskKey: null },
      { id: 'ai2', description: 'Send the price list', assigneeId: 'u-layla', dueDate: day('2026-10-26'), status: 'OPEN', meetingId: 'm-falcon', taskId: null, taskKey: null },
    ],
    conversations: [
      { id: 'c-rig', kind: 'PROJECT', projectId: 'p-rig', participantIds: [] },
      { id: 'c-falcon', kind: 'PROJECT', projectId: 'p-falcon', participantIds: [] },
      { id: 'c-dm-ol', kind: 'DIRECT', projectId: null, participantIds: ['u-omar', 'u-layla'] },
      { id: 'c-dm-ls', kind: 'DIRECT', projectId: null, participantIds: ['u-layla', 'u-sara'] },
    ],
    messages: [
      { id: 'cm1', conversationId: 'c-rig', userId: 'u-sara', body: 'The gauge is calibrated now.', createdAt: at('2026-10-22T10:00:00Z') },
      { id: 'cm2', conversationId: 'c-falcon', userId: 'u-layla', body: 'The gauge price is 400 OMR (Falcon only).', createdAt: at('2026-10-22T11:00:00Z') },
      { id: 'cm3', conversationId: 'c-dm-ol', userId: 'u-layla', body: 'Can you look at the gauge order?', createdAt: at('2026-10-22T12:00:00Z') },
      { id: 'cm4', conversationId: 'c-dm-ls', userId: 'u-layla', body: 'Private: the gauge supplier is late.', createdAt: at('2026-10-22T13:00:00Z') },
    ],
    people: [
      { id: 'u-admin', firstName: 'Khurram', lastName: 'Shahzad', username: 'khurram', active: true },
      { id: 'u-omar', firstName: 'Omar', lastName: 'Said', username: 'omar', active: true },
      { id: 'u-sara', firstName: 'Sara', lastName: 'Ahmed', username: 'sara', active: true },
      { id: 'u-layla', firstName: 'Layla', lastName: 'Hassan', username: 'layla', active: true },
    ],
  };
}
