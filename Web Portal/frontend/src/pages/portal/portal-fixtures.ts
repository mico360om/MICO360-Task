import type {
  PortalFile,
  PortalHome,
  PortalMeetingItem,
  PortalMeetingView,
  PortalNotice,
  PortalNotices,
  PortalNoticeSettings,
  PortalProjectCard,
  PortalProjectView,
  PortalTaskItem,
  PortalTaskView,
} from '../../api/portal';

/** Test data in the server's shapes (backend/src/modules/clients/portal-payload.ts). */

export const card = (over: Partial<PortalProjectCard> = {}): PortalProjectCard => ({
  id: 'p1',
  code: 'MICO',
  number: '2026-07',
  name: 'Office fit-out',
  status: 'ACTIVE',
  statusLabel: 'In progress',
  color: '#8B1E1E',
  icon: null,
  imageUrl: null,
  company: { name: 'Prolens Projects LLC', logoUrl: null },
  percentDone: 40,
  modules: { progress: true, meetings: true },
  actions: { comment: true, signOff: true, respond: true, download: true },
  ...over,
});

export const home = (projects: PortalProjectCard[] = [card()]): PortalHome => ({
  me: { name: 'Huda Client', email: 'huda@client.test', organisation: 'Fabrikam Logistics' },
  projects,
  timeZone: 'Asia/Muscat',
});

export const taskItem = (over: Partial<PortalTaskItem> = {}): PortalTaskItem => ({
  id: 't1',
  key: 'MICO-7',
  title: 'Install the glass doors',
  status: 'In progress',
  dueDate: '2026-10-30',
  late: false,
  acceptedOn: null,
  awaitingSignOff: false,
  hasDescription: false,
  ...over,
});

export const projectView = (over: Partial<PortalProjectView> = {}): PortalProjectView => {
  const c = card();
  return {
    project: { id: c.id, code: c.code, number: c.number, name: c.name, status: c.status, statusLabel: c.statusLabel, color: c.color, icon: c.icon, imageUrl: c.imageUrl, company: c.company, clientName: 'Fabrikam Logistics' },
    modules: { progress: true, meetings: true },
    actions: { comment: true, signOff: true, respond: true, download: true },
    progress: {
      percentDone: 40,
      timeline: { startDate: '2026-10-01', targetDate: '2026-12-31', today: '2026-11-04', elapsedPercent: 37 },
      milestones: [taskItem({ id: 'ms1', key: 'MICO-1', title: 'Design signed off', status: 'Done', dueDate: '2026-10-10', acceptedOn: '2026-10-12' })],
      tasks: [
        taskItem(),
        taskItem({ id: 't2', key: 'MICO-8', title: 'Paint the walls', status: 'Done', dueDate: '2026-10-20', awaitingSignOff: true }),
        taskItem({ id: 't3', key: 'MICO-9', title: 'Lay the carpet', status: 'Not started', dueDate: '2026-10-25', late: true }),
      ],
    },
    generatedAt: '2026-11-04T08:00:00.000Z',
    timeZone: 'Asia/Muscat',
    ...over,
  };
};

export const taskView = (over: Partial<PortalTaskView> = {}, task: Partial<PortalTaskView['task']> = {}): PortalTaskView => ({
  task: { ...taskItem({ id: 't2', key: 'MICO-8', title: 'Paint the walls', status: 'Done', dueDate: '2026-10-20', awaitingSignOff: true, hasDescription: true }), description: 'Two coats, white.', ...task },
  comments: [
    { id: 'c1', from: 'you', replyTo: null, body: 'Which white?', createdAt: '2026-10-21T06:00:00.000Z', edited: false },
    { id: 'c2', from: 'team', replyTo: 'c1', body: 'Snow white, as agreed.', createdAt: '2026-10-21T07:00:00.000Z', edited: false },
  ],
  can: { comment: true, signOff: true },
  ...over,
});

export const meetingItem = (over: Partial<PortalMeetingItem> = {}): PortalMeetingItem => ({
  id: 'm1',
  title: 'Site walk-through',
  date: '2026-10-30',
  startAt: '2026-10-30T05:00:00.000Z',
  endAt: '2026-10-30T06:00:00.000Z',
  timeZone: 'Asia/Muscat',
  status: 'Scheduled',
  cancelled: false,
  invited: true,
  response: 'PENDING',
  hasMinutes: false,
  ...over,
});

export const meetingView = (over: Partial<PortalMeetingView> = {}, meeting: Partial<PortalMeetingView['meeting']> = {}): PortalMeetingView => ({
  meeting: { ...meetingItem(), location: 'Muscat office', onlineLink: 'https://meet.example.com/abc', description: 'Walk the site together.', ...meeting },
  agenda: [{ title: 'Doors', minutes: 15 }, { title: 'Paint', minutes: null }],
  minutes: { approvedOn: '2026-10-31', content: { summary: 'All on track.', discussion: [{ topic: 'Doors', text: 'Fitted next week.' }], decisions: ['Keep the white'], risks: [], nextSteps: ['Order carpet'] } },
  actionItems: [
    { id: 'a1', description: 'Send the carpet samples', dueDate: '2026-11-05', done: false, cancelled: false },
    { id: 'a2', description: 'Confirm the colour', dueDate: null, done: true, cancelled: false },
  ],
  can: { respond: true, markDone: true, downloadMinutes: true },
  ...over,
});

/** 1.23.7 A file on a shared task. */
export const portalFile = (over: Partial<PortalFile> = {}): PortalFile => ({
  id: 'f1',
  name: 'Site plan.pdf',
  type: 'application/pdf',
  sizeBytes: 1_258_291,
  addedAt: '2026-11-03T06:00:00.000Z',
  from: 'team',
  ...over,
});

/** 1.23.7 One notice on the bell. */
export const notice = (over: Partial<PortalNotice> = {}): PortalNotice => ({
  id: 'n1',
  kind: 'reply',
  title: 'The project team replied to your comment',
  body: null,
  project: { id: 'p1', name: 'Office fit-out' },
  taskId: 't2',
  meetingId: null,
  read: false,
  createdAt: '2026-11-04T06:30:00.000Z',
  ...over,
});

export const notices = (items: PortalNotice[] = []): PortalNotices => ({ items, unread: items.filter((n) => !n.read).length });

/** 1.23.7 The client's notification switches. */
export const noticeSettings = (over: Partial<PortalNoticeSettings['settings']> = {}, projects: PortalNoticeSettings['projects'] = [{ id: 'p1', name: 'Office fit-out', notify: true }]): PortalNoticeSettings => ({
  settings: { reply: true, signOff: true, minutes: true, document: true, ...over },
  projects,
});
