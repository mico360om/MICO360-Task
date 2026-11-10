/**
 * The PDF standard (1.23.10): one set of seeded sample data for every PDF the server makes, so the
 * same data can be rendered before and after a change — the content-preservation tests compare
 * the text of both renders, and render-samples.ts writes them out for the owner's before/after.
 *
 * Deterministic: fixed dates and words. The pictures (a project's picture and a company logo) are
 * passed in, so a render can prepare them the way the routes do and a test can pass them raw.
 */
import { taskPdf, type TaskExportData } from '../../../src/modules/tasks/task-export';
import { reportPdf, type ReportBundle, type ReportMeta } from '../../../src/modules/reports/report-export';
import { buildMinutesPdf, type MinutesData } from '../../../src/modules/meetings/minutes';
import { buildClientMinutesPdf } from '../../../src/modules/client-view/client-minutes-pdf';
import { buildClientTaskListPdf, type ClientTaskRow } from '../../../src/modules/client-view/client-task-list-pdf';
import { buildInspectionPdf, type InspectionReportData } from '../../../src/modules/inspections/inspection-report-pdf';
import { buildManagementPdf } from '../../../src/modules/management/management-pdf';
import type { ManagementOverview } from '../../../src/modules/management/management-service';
import { answerPdf } from '../../../src/modules/mico-ai/mico-ai-export';
import { toSimplePdf } from '../../../src/lib/pdf';

export interface SamplePictures {
  /** The project's picture as the PDF gets it (null: its initials). */
  project: Buffer | null;
  /** The company's logo as the PDF gets it (null: the built-in logo). */
  logo: Buffer | null;
  /** An inspection's drawn signature (a PNG). */
  signature: Buffer | null;
}

export const SAMPLE_NAMES = ['task', 'task-full', 'report', 'minutes', 'client-minutes', 'client-task-list', 'inspection', 'management', 'mico-ai', 'simple'] as const;
export type SampleName = (typeof SAMPLE_NAMES)[number];

/** Samples whose first table can't fit across a portrait page (review, 1.23.10): they must not leave page 1 nearly empty. */
export const WIDE_SAMPLE_NAMES = ['report-wide', 'mico-ai-wide'] as const;
export type WideSampleName = (typeof WIDE_SAMPLE_NAMES)[number];

/** A dozen columns of long unbreakable words: too wide for a portrait page even at 7.5 pt. */
function wideColumns(n = 12) {
  return Array.from({ length: n }, (_, i) => `Certificate${i + 1}`);
}

export function wideSamplePdfs(p: SamplePictures): Record<WideSampleName, () => Buffer> {
  const company = { companyName: 'Prolens Projects LLC', logo: p.logo };
  const cols = wideColumns();
  return {
    'report-wide': () => {
      const b = reportBundle();
      const tasks = b.tasks.slice(0, 20).map((t, i) => ({ ...t, title: `Inspection-certificate-${2026_0000 + i}-north-deck-manifold`, projectName: `Pipeline-segment-${i}-section-north-west`, assignees: [`Engineer-${i}-on-call-rotation`] }));
      return reportPdf({ ...b, tasks }, { ...reportMeta, title: 'Tasks' }, ['tasks'], company);
    },
    'mico-ai-wide': () => {
      const a = micoAiAnswer();
      return answerPdf(
        {
          ...a,
          tables: [{ title: 'Certificates by rig', fromResult: 'r2', columns: cols.map((label, i) => ({ key: `c${i}`, label })), rows: Array.from({ length: 6 }, (_, r) => ({ ref: null, cells: cols.map((_, c) => `CERT-${2026_0000 + r * 100 + c}-RIG`) })) }],
        },
        company,
      );
    },
  };
}

const TZ = 'Asia/Muscat';
const at = (iso: string) => new Date(iso);
const BRAND = {
  productName: 'MICO360 Tasks',
  companyName: 'Prolens Projects LLC',
  tagline: 'Project & task management for teams',
  websiteUrl: 'https://mico360.com',
  supportEmail: 'info@mico360.com',
  companyAddress: 'Prolens Projects LLC, Muscat, Sultanate of Oman',
  colors: { brand: '#8B1E1E', ink: '#211B1A', muted: '#6C625F', line: '#E6DFDC' },
};

/** The owner's screenshot (10 Nov): MSSP-34 in "MICO360 Services (Sub Projects)". */
function screenshotTask(p: SamplePictures): TaskExportData {
  return {
    key: 'MSSP-34',
    title: 'Improve the design and layout of all PDF documents across the system.',
    description:
      'Improve the design and layout of all PDF documents across the system. A4 format.\n' +
      'Professional design: clean, modern, premium corporate design with consistent fonts, colors, spacing, and alignment.\n' +
      'Optimize page space: eliminate unnecessary white space, excessive margins, empty sections, and unwanted page breaks.\n' +
      'Headers & footers: consistent branding, company logos, document titles, page numbers, and relevant information.',
    projectName: 'MICO360 Services (Sub Projects)',
    projectCode: 'MSSP',
    projectNumber: null,
    projectColor: '#8B1E1E',
    projectIcon: null,
    projectImage: p.project,
    status: 'In Progress',
    category: 'IN_PROGRESS',
    priority: 'NORMAL',
    startDate: at('2026-11-10T04:00:00Z'),
    dueDate: at('2026-11-12T00:00:00Z'),
    completedAt: null,
    createdAt: at('2026-11-10T16:05:00Z'),
    updatedAt: at('2026-11-10T16:20:00Z'),
    progress: 0,
    estimatedHours: null,
    actualHours: null,
    createdBy: 'Khurram Mumtaz',
    assignees: ['Khurram Mumtaz'],
    watchers: [],
    tags: [],
    repeat: null,
    overdue: false,
    isMilestone: false,
    meeting: null,
    externalContacts: [],
    checklist: [],
    blockedBy: [],
    blocks: [],
    attachments: [],
    comments: [{ id: 'c1', parentId: null, author: 'Khurram Mumtaz', at: at('2026-11-10T16:20:00Z'), body: 'Improve the PDF, decrease the size.', edited: false }],
    mentionable: [],
    activity: [
      { at: at('2026-11-10T16:05:00Z'), who: 'Khurram Mumtaz', action: 'CREATED', meta: { title: 'x' } },
      { at: at('2026-11-10T16:06:00Z'), who: 'Khurram Mumtaz', action: 'ASSIGNED', meta: { assignee: 'Khurram Mumtaz' } },
      { at: at('2026-11-10T16:10:00Z'), who: 'Khurram Mumtaz', action: 'MOVED', meta: { from: 'To do', to: 'In Progress' } },
    ],
    activityTotal: 3,
  };
}

/** A task with everything: contacts, nested checklists, threads, files, dependencies, Arabic, 40 changes. */
function fullTask(p: SamplePictures): TaskExportData {
  const people = ['Omar Ahmed', 'Sara Al-Hinai', 'Bilal Ahmed', 'Aisha Khan', 'سالم الهنائي'];
  return {
    key: 'RIG-118',
    title: 'Pressure test of the north deck manifold before the client walk-down — مراجعة تقرير الضغط',
    description:
      'Run the hydrostatic pressure test on the north deck manifold and record the readings every 15 minutes.\n' +
      'The client wants the chart recorder trace attached, signed by the inspector and the company man.\n' +
      'يجب إرفاق تقرير الضغط الموقع قبل زيارة العميل.\n' +
      'If the test fails, raise a follow-up task for the valve crew and hold the walk-down.',
    projectName: 'Rig 3 Overhaul',
    projectCode: 'RIG',
    projectNumber: 'PDO-2026-014',
    projectColor: '#1E5A8B',
    projectIcon: null,
    projectImage: p.project,
    status: 'Blocked',
    category: 'BLOCKED',
    priority: 'URGENT',
    startDate: at('2026-11-02T04:00:00Z'),
    dueDate: at('2026-11-08T00:00:00Z'),
    completedAt: null,
    createdAt: at('2026-11-01T05:00:00Z'),
    updatedAt: at('2026-11-09T11:30:00Z'),
    progress: 60,
    estimatedHours: 16,
    actualHours: 9.5,
    createdBy: 'Aisha Khan',
    assignees: ['Omar Ahmed', 'Sara Al-Hinai'],
    watchers: ['Bilal Ahmed', 'سالم الهنائي'],
    tags: ['hydrotest', 'client walk-down', 'north deck'],
    repeat: 'Repeats every month on the first Sunday',
    overdue: true,
    isMilestone: true,
    meeting: { id: 'm1', title: 'Weekly progress review', startAt: at('2026-11-01T06:00:00Z') },
    externalContacts: [
      { name: 'Ahmed Al Said', company: 'Oman Drilling Co.', designation: 'Company man', email: 'ahmed.alsaid@odc.example', phone: '+968 9912 3456', remarks: 'Call before 10 am; on site Sunday to Wednesday.' },
      { name: 'سالم الهنائي', company: 'PDO', designation: 'Inspector', email: null, phone: '+968 9234 5678', remarks: null },
    ],
    checklist: [
      { text: 'Isolate the manifold and fit blinds', done: true, list: 'Preparation', listId: 'l1', depth: 0, leaf: true },
      { text: 'Calibrate the chart recorder', done: true, list: 'Preparation', listId: 'l1', depth: 0, leaf: false },
      { text: 'Check the calibration certificate date', done: true, list: 'Preparation', listId: 'l1', depth: 1, leaf: true },
      { text: 'Fit a new chart', done: false, list: 'Preparation', listId: 'l1', depth: 1, leaf: true },
      { text: 'Fill and vent the line', done: false, list: 'Test', listId: 'l2', depth: 0, leaf: true },
      { text: 'Hold at 1.5 × design pressure for 30 minutes and record every 15 minutes', done: false, list: 'Test', listId: 'l2', depth: 0, leaf: true },
      { text: 'تسجيل القراءات في النموذج', done: false, list: 'Test', listId: 'l2', depth: 0, leaf: true },
    ],
    blockedBy: [{ id: 't40', key: 'RIG-104', title: 'Replace the leaking gate valve on line 6', status: 'In Progress' }],
    blocks: [
      { id: 't41', key: 'RIG-120', title: 'Client walk-down of the north deck', status: 'To Do' },
      { id: 't42', key: 'RIG-121', title: 'Handover dossier', status: 'Backlog' },
    ],
    attachments: [
      { filename: 'chart-recorder-trace.pdf', mimeType: 'application/pdf', sizeBytes: 384_211, storageKey: 'k1', uploadedBy: 'Omar Ahmed', uploadedAt: at('2026-11-05T09:12:00Z') },
      { filename: 'manifold-layout.dwg', mimeType: 'application/octet-stream', sizeBytes: 2_411_008, storageKey: 'k2', uploadedBy: 'Sara Al-Hinai', uploadedAt: at('2026-11-05T09:40:00Z') },
      { filename: 'test-procedure-rev3.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', sizeBytes: 98_304, storageKey: 'k3', uploadedBy: 'Aisha Khan', uploadedAt: at('2026-11-02T07:00:00Z') },
    ],
    comments: [
      { id: 'c1', parentId: null, author: 'Omar Ahmed', at: at('2026-11-05T09:15:00Z'), body: 'Trace attached. The pressure dropped 3 bar in the last 10 minutes, so the test is not passed yet. @sara can you check the flange on the bypass?', edited: false },
      { id: 'c2', parentId: 'c1', author: 'Sara Al-Hinai', at: at('2026-11-05T10:02:00Z'), body: 'Checked: the bypass flange gasket is weeping. Valve crew will replace it with the gate valve on line 6.', edited: true },
      { id: 'c3', parentId: 'c2', author: 'Aisha Khan', at: at('2026-11-05T10:30:00Z'), body: 'Thanks — I have moved the walk-down by one week and told the client.', edited: false },
      { id: 'c4', parentId: null, author: 'سالم الهنائي', at: at('2026-11-06T06:45:00Z'), body: 'نرجو إرسال النتائج قبل يوم الأحد.', edited: false },
    ],
    mentionable: ['omar', 'sara', 'aisha'],
    activity: Array.from({ length: 40 }, (_, i) => ({
      at: at(`2026-11-0${1 + (i % 9)}T${String(5 + (i % 10)).padStart(2, '0')}:${String((i * 7) % 60).padStart(2, '0')}:00Z`),
      who: people[i % people.length]!,
      action: ['UPDATED', 'COMMENTED', 'MOVED', 'ASSIGNED'][i % 4]!,
      meta: i % 4 === 0 ? { changes: { priority: { from: 'HIGH', to: 'URGENT' } } } : i % 4 === 2 ? { from: 'To Do', to: 'In Progress' } : i % 4 === 3 ? { assignee: people[(i + 1) % people.length] } : {},
    })),
    activityTotal: 64,
    mergedFrom: ['RIG-97', 'RIG-99'],
  };
}

const PROJECTS = ['Rig 3 Overhaul', 'MICO360 Services (Sub Projects)', 'North Field Pipeline', 'Head Office Fit-out', 'مشروع صيانة المصفاة'];
const ASSIGNEES = ['Omar Ahmed', 'Sara Al-Hinai', 'Bilal Ahmed', 'Aisha Khan', 'Khurram Mumtaz', 'سالم الهنائي'];
const TITLES = [
  'Pressure test of the north deck manifold',
  'Replace the leaking gate valve on line 6',
  'Update the inspection checklist for the new client form and send it for approval',
  'Order spare gaskets',
  'Client walk-down of the north deck',
  'مراجعة تقرير المبيعات الشهري',
  'Prepare the handover dossier with as-built drawings, test certificates and the punch list',
  'Weekly safety meeting',
];

function reportBundle(): ReportBundle {
  const statuses = [
    ['To Do', 'TODO'],
    ['In Progress', 'IN_PROGRESS'],
    ['Blocked', 'BLOCKED'],
    ['Review', 'REVIEW'],
    ['Done', 'DONE'],
  ] as const;
  const tasks = Array.from({ length: 46 }, (_, i) => {
    const [status, category] = statuses[i % statuses.length]!;
    const done = category === 'DONE';
    return {
      key: `${['RIG', 'MSSP', 'NFP', 'HOF', 'REF'][i % 5]}-${100 + i}`,
      title: TITLES[i % TITLES.length]!,
      projectName: PROJECTS[i % PROJECTS.length]!,
      status,
      category,
      priority: ['URGENT', 'HIGH', 'NORMAL', 'LOW'][i % 4]!,
      assignees: i % 7 === 3 ? [] : [ASSIGNEES[i % ASSIGNEES.length]!, ...(i % 3 === 0 ? [ASSIGNEES[(i + 2) % ASSIGNEES.length]!] : [])],
      dueDate: i % 6 === 5 ? null : `2026-11-${String(1 + (i % 28)).padStart(2, '0')}`,
      completedAt: done ? at(`2026-11-${String(1 + (i % 9)).padStart(2, '0')}T09:30:00Z`) : null,
      done,
      overdue: !done && i % 4 === 1,
      ...(i === 7 ? { mergedFrom: ['RIG-41', 'RIG-42'] } : {}),
    };
  });
  return {
    completion: { total: 46, completed: 9, onTime: 6, late: 3, unclassified: 0, onTimeRate: 67 },
    status: { TODO: 10, IN_PROGRESS: 10, BLOCKED: 9, REVIEW: 8, DONE: 9 },
    projects: PROJECTS.map((name, i) => ({ projectId: `p${i}`, projectName: name, total: 9 + (i % 2), completed: 2 - (i % 2), overdue: i % 3, completionPct: 20 + i * 7, ...(i === 2 ? { completionBy: 'WEIGHT' as const } : {}) })),
    workload: ASSIGNEES.map((name, i) => ({ userId: `u${i}`, username: `user${i}`, name, assigned: 8 + i, completed: 1 + (i % 3), overdue: i % 2 })),
    series: {
      from: '2026-10-12',
      to: '2026-11-10',
      points: Array.from({ length: 30 }, (_, i) => {
        const d = new Date(Date.UTC(2026, 9, 12 + i));
        return { date: d.toISOString().slice(0, 10), created: (i * 3) % 5, completed: (i * 2) % 4, overdue: i % 6, remaining: 46 - i, ideal: 46 - i * 1.5 };
      }),
      velocity: [
        { weekStart: '2026-10-11', completed: 3 },
        { weekStart: '2026-10-18', completed: 5 },
        { weekStart: '2026-10-25', completed: 2 },
        { weekStart: '2026-11-01', completed: 4 },
        { weekStart: '2026-11-08', completed: 1 },
      ],
      velocityPerWeek: 3,
    },
    tasks,
  };
}

const reportMeta: ReportMeta = {
  title: 'Tasks report',
  generatedAt: at('2026-11-10T10:05:00Z'),
  timeZone: TZ,
  generatedBy: 'Khurram Mumtaz',
  projectName: null,
  memberName: null,
  from: '2026-10-12',
  to: '2026-11-10',
};

function minutesData(p: SamplePictures): MinutesData {
  return {
    brand: BRAND,
    project: {
      name: 'Rig 3 Overhaul',
      code: 'RIG',
      number: 'PDO-2026-014',
      color: '#1E5A8B',
      image: p.project,
      icon: null,
      clientName: 'Oman Drilling Co.',
      statusLabel: 'Active',
      ownerName: 'Khurram Mumtaz',
      startDate: '2026-09-01T00:00:00Z',
      targetDate: '2026-12-31T00:00:00Z',
    },
    meeting: {
      title: 'Weekly progress review',
      statusLabel: 'Completed',
      organizerName: 'Khurram Mumtaz',
      location: 'Boardroom A, Head Office',
      onlineLink: 'https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc123def456%40thread.v2/0?context=%7b%22Tid%22%3a%22x%22%7d',
      startAt: '2026-11-08T06:00:00Z',
      endAt: '2026-11-08T07:00:00Z',
      timeZone: TZ,
      description: 'Review progress on the overhaul and agree the go-live plan.',
    },
    attendees: [
      { name: 'Khurram Mumtaz', roleLabel: 'Organizer', responseLabel: 'Accepted', attendanceLabel: 'Present', external: false, email: null },
      { name: 'Bilal Ahmed', roleLabel: 'Required', responseLabel: 'Accepted', attendanceLabel: 'Present', external: false, email: null },
      { name: 'Sara Al-Hinai', roleLabel: 'Required', responseLabel: 'Maybe', attendanceLabel: 'Late', external: false, email: null },
      { name: 'Omar Ahmed', roleLabel: 'Optional', responseLabel: 'Declined', attendanceLabel: 'Absent', external: false, email: null },
      { name: 'Ahmed Al Said', roleLabel: 'Optional', responseLabel: 'Accepted', attendanceLabel: 'Present', external: true, email: 'ahmed.alsaid@odc.example' },
    ],
    agenda: [
      { title: 'Progress since last week', presenterName: 'Bilal Ahmed', expectedMinutes: 15, completed: true },
      { title: 'Pressure test results and the leaking valve', presenterName: 'Sara Al-Hinai', expectedMinutes: 20, completed: true },
      { title: 'Go-live plan and the client walk-down', presenterName: 'Khurram Mumtaz', expectedMinutes: 15, completed: false },
    ],
    notes: [
      { type: 'DISCUSSION', typeLabel: 'Discussion', body: 'The photo upload is slow on site; the team will compress pictures on the phone before upload.', authorName: 'Bilal Ahmed', createdAt: '2026-11-08T06:10:00Z', highlighted: false },
      { type: 'DECISION', typeLabel: 'Decision', body: 'Go-live moves to 1 December so the client can test the new forms.', authorName: 'Khurram Mumtaz', createdAt: '2026-11-08T06:40:00Z', highlighted: true },
      { type: 'ACTION', typeLabel: 'Action Item', body: 'Send the revised inspection form to the client.', authorName: 'Khurram Mumtaz', createdAt: '2026-11-08T06:45:00Z', highlighted: false, trackedAsActionItem: true },
      { type: 'ISSUE', typeLabel: 'Issue', body: 'Field tablets may not be updated in time for go-live.', authorName: 'Sara Al-Hinai', createdAt: '2026-11-08T06:50:00Z', highlighted: false },
      { type: 'INFORMATION', typeLabel: 'Information', body: '<p>The client confirmed the <strong>walk-down</strong> on <em>15 December</em>.</p><ul><li>North deck first</li><li>Then the pump room</li></ul>', format: 'RICH', authorName: 'Khurram Mumtaz', createdAt: '2026-11-08T06:55:00Z', highlighted: false },
      { type: 'QUESTION', typeLabel: 'Question', body: 'هل يمكن تأجيل الفحص إلى الأسبوع القادم؟', authorName: 'Omar Ahmed', createdAt: '2026-11-08T06:58:00Z', highlighted: false },
    ],
    actionItems: [
      { description: 'Send the revised inspection form to the client', ownerName: 'Bilal Ahmed', dueDate: '2026-11-05', statusLabel: 'Open', priorityLabel: 'High', taskKey: 'RIG-142', open: true },
      { description: 'Compress photos before upload in the Android app', ownerName: 'Sara Al-Hinai', dueDate: '2026-11-25', statusLabel: 'In progress', priorityLabel: 'Normal', taskKey: 'RIG-143', open: true },
      { description: 'Book the crane for the valve change', ownerName: null, dueDate: null, statusLabel: 'Completed', priorityLabel: 'Low', taskKey: null, open: false },
    ],
    generatedAt: '2026-11-10T10:05:00Z',
    generatedByName: 'Khurram Mumtaz',
    companyTimeZone: TZ,
    logo: p.logo,
    series: {
      name: 'Rig 3 weekly review',
      openFromEarlier: [
        { description: 'Confirm the hydrotest procedure with the client', ownerName: 'Aisha Khan', dueDate: '2026-10-30', statusLabel: 'Open', priorityLabel: 'High', taskKey: 'RIG-120', open: true, meetingStartAt: '2026-10-25T06:00:00Z' },
      ],
    },
    final: {
      status: 'FINAL',
      approvedByName: 'Khurram Mumtaz',
      approvedAt: '2026-11-09T08:00:00Z',
      content: {
        summary: 'The overhaul is on track except for the north deck pressure test, which failed on a weeping bypass flange. Go-live moves to 1 December.',
        discussion: [
          { topic: 'Progress since last week', text: 'Scaffolding is down on the south side.\nThe pump room cabling is 80% complete.' },
          { topic: 'Pressure test results and the leaking valve', text: 'The test lost 3 bar in 10 minutes; the bypass flange gasket and the gate valve on line 6 will be replaced before a re-test.' },
        ],
        decisions: ['Go-live moves to 1 December so the client can test the new forms.', 'The re-test is witnessed by the client inspector.'],
        risks: ['Field tablets may not be updated in time.', 'Valve delivery could slip by a week.'],
        nextSteps: ['Bilal sends the revised inspection form to the client.', 'Sara schedules the re-test after the valve change.'],
      },
    },
  };
}

function clientTasks(): { milestones: ClientTaskRow[]; tasks: ClientTaskRow[] } {
  const row = (i: number): ClientTaskRow => ({
    key: `RIG-${200 + i}`,
    title: TITLES[i % TITLES.length]!,
    status: ['To Do', 'In Progress', 'Done', 'Review'][i % 4]!,
    dueDate: i % 5 === 4 ? null : `2026-11-${String(3 + i).padStart(2, '0')}`,
    late: i % 6 === 1,
    acceptedOn: i % 4 === 2 ? `2026-11-${String(4 + i).padStart(2, '0')}` : null,
  });
  return { milestones: [0, 1, 2].map((i) => ({ ...row(i), key: `RIG-M${i + 1}`, title: ['Mechanical completion', 'Pressure test passed', 'Handover to the client'][i]! })), tasks: Array.from({ length: 22 }, (_, i) => row(i)) };
}

function inspectionData(p: SamplePictures): InspectionReportData {
  const check = (label: string, result: string, note: string | null = null) => ({ label, kind: 'CHECK' as const, result, reading: null, limits: null, note });
  const reading = (label: string, value: string, limits: string, result: string, note: string | null = null) => ({ label, kind: 'READING' as const, result, reading: value, limits, note });
  const signature = p.signature ? `data:image/png;base64,${p.signature.toString('base64')}` : null;
  return {
    brand: BRAND,
    project: { name: 'Rig 3 Overhaul', code: 'RIG', number: 'PDO-2026-014', clientName: 'Oman Drilling Co.', color: '#1E5A8B', icon: null, image: p.project },
    report: {
      id: 'insp-1',
      title: 'Rig daily safety check',
      date: '2026-11-09',
      place: 'Rig 3, north deck',
      counts: { total: 16, passed: 12, failed: 2, na: 2 },
      result: '2 failed',
      sections: [
        { title: 'Well head', items: [reading('Casing pressure', '162.5 psi', '0–150 psi', 'Fail', 'Gauge read high twice; re-checked with the spare gauge.'), check('Valves closed and locked', 'Pass'), check('Bleed-off line clear', 'Pass'), reading('Annulus pressure', '12 psi', '0–50 psi', 'Pass')] },
        { title: 'Deck and access', items: [check('Guard rails fitted', 'Fail', 'One rail loose at the stairs to the pipe rack; tied off and tagged.'), check('Walkways clear', 'Pass'), check('Lighting working', 'Pass'), reading('Air temperature', '31.5 °C', '-10 to 45 °C', 'Pass'), check('Eye-wash station checked', 'N/A', 'Station removed for the overhaul.')] },
        { title: 'Fire and gas', items: [check('Extinguishers in date', 'Pass'), check('Gas detectors tested', 'Pass'), check('Fire pump started', 'Pass'), check('Muster point sign visible', 'Pass'), check('Deluge valve tested', 'N/A'), check('Smoke detectors in the accommodation', 'Pass'), check('Fire blankets in the galley', 'Pass')] },
      ],
      signatures: [
        { role: 'Inspector', name: 'Ivan Petrov', signedAt: '2026-11-09T08:30:00.000Z', signedOn: '9 Nov 2026, 12:30', image: signature, typed: false },
        { role: 'Supervisor', name: 'Khurram Mumtaz', signedAt: '2026-11-09T09:10:00.000Z', signedOn: '9 Nov 2026, 13:10', image: null, typed: true },
      ],
      unsigned: ['Client'],
      revisionNumber: 1,
      reopenedOn: null,
    },
    staff: { inspector: 'Ivan Petrov', startedAt: '2026-11-09T08:00:00.000Z', finishedAt: '2026-11-09T08:31:00.000Z', task: 'RIG-112 · Rig daily safety check', followUps: [['RIG-150', null, null, null], ['RIG-151', null, null, null, null], [null, null, null, null, null, null, null]] },
    timeZone: TZ,
    generatedAt: '2026-11-10T10:05:00.000Z',
    generatedBy: 'Khurram Mumtaz',
    logo: p.logo,
  };
}

function managementOverview(): ManagementOverview {
  const names = ['Rig 3 Overhaul', 'North Field Pipeline', 'MICO360 Services (Sub Projects)', 'Head Office Fit-out', 'مشروع صيانة المصفاة', 'Camp Expansion Phase 2', 'Water Treatment Upgrade'];
  const rags = ['RED', 'AMBER', 'GREEN', 'GREEN', 'AMBER', 'RED', 'GREEN'] as const;
  return {
    scope: 'ALL',
    generatedAt: '2026-11-10T10:05:00.000Z',
    timeZone: TZ,
    today: '2026-11-10',
    weekStart: 0,
    filters: { projectIds: [], ownerId: null, statuses: ['PLANNING', 'ACTIVE', 'ON_HOLD'], weeks: 12 },
    period: { from: '2026-08-23', to: '2026-11-10', weeks: 12 },
    options: { projects: [], owners: [] },
    tiles: { projects: 7, red: 2, amber: 2, green: 3, lateTasks: 14, missingChecks: 3, checksDue: 40, checksDone: 35, checksDoneLate: 4, passRate: 88, openFollowUps: 5, overloadedPeople: 2 },
    projects: names.map((name, i) => ({
      id: `p${i}`,
      code: ['RIG', 'NFP', 'MSSP', 'HOF', 'REF', 'CMP', 'WTU'][i]!,
      name,
      status: 'ACTIVE',
      color: '#1E5A8B',
      icon: null,
      imageUrl: null,
      owner: i === 3 ? null : { id: `u${i}`, name: ASSIGNEES[i % ASSIGNEES.length]! },
      total: 20 + i,
      done: 5 + i,
      open: 15,
      late: rags[i] === 'GREEN' ? 0 : 2 + i,
      completionPct: 25 + i * 9,
      completionBy: i === 1 ? 'WEIGHT' : 'COUNT',
      nextMilestone: i === 6 ? null : { id: `m${i}`, key: `${['RIG', 'NFP', 'MSSP', 'HOF', 'REF', 'CMP'][i]}-${10 + i}`, title: ['Handover', 'Tie-in complete', 'PDF standard live', 'Furniture delivered', 'تسليم المرحلة الأولى', 'Camp occupied'][i]!, due: `2026-11-${String(5 + i * 3).padStart(2, '0')}`, daysLeft: i - 3, waiting: i === 2 },
      lateMilestones: rags[i] === 'RED' ? 1 : 0,
      lastActivityAt: `2026-11-0${1 + i}T08:00:00.000Z`,
      missingChecks: i === 0 ? 3 : 0,
      checksDue: 6,
      checksDone: 5,
      checksDoneLate: i % 2,
      openFollowUps: i % 3,
      rag: rags[i]!,
      reasons:
        rags[i] === 'RED'
          ? [
              { code: 'MILESTONE_LATE', level: 'RED', text: 'A milestone is 3 days late' },
              { code: 'MANY_LATE', level: 'RED', text: '6 tasks are late' },
              { code: 'MISSING_CHECKS', level: 'AMBER', text: '3 checks are missing' },
            ]
          : rags[i] === 'AMBER'
            ? [{ code: 'BEHIND', level: 'AMBER', text: 'Progress is 22 points behind the time used' }]
            : [{ code: 'ON_TRACK', level: 'GREEN', text: 'On track' }],
    })),
    approvals: { total: 6, projects: [{ id: 'p0', code: 'RIG', name: 'Rig 3 Overhaul', count: 4 }, { id: 'p2', code: 'MSSP', name: 'MICO360 Services (Sub Projects)', count: 2 }] },
    inspections: {
      due: 40,
      done: 35,
      doneLate: 4,
      noReport: 1,
      missing: 3,
      finished: 34,
      passed: 30,
      failed: 4,
      passRate: 88,
      openFollowUps: 5,
      topItems: [
        { formId: 'f1', itemId: 'i1', label: 'Guard rails fitted', formTitle: 'Rig daily safety check', failures: 4 },
        { formId: 'f1', itemId: 'i2', label: 'Casing pressure', formTitle: 'Rig daily safety check', failures: 3 },
        { formId: 'f2', itemId: 'i3', label: 'Extinguishers in date', formTitle: 'Weekly fire and gas check', failures: 1 },
      ],
      topForms: [
        { formId: 'f1', title: 'Rig daily safety check', finished: 24, withFailures: 4, failedItems: 7 },
        { formId: 'f2', title: 'Weekly fire and gas check', finished: 10, withFailures: 1, failedItems: 1 },
      ],
    } as ManagementOverview['inspections'],
    people: ASSIGNEES.map((name, i) => ({
      id: `u${i}`,
      name,
      avatarUrl: null,
      lateTasks: i % 3,
      overloadedDays: i % 3 === 0 ? [{ date: '2026-11-09', count: 9, limit: 6 }, { date: '2026-11-10', count: 8, limit: 6 }] : [],
      openActions: 1 + (i % 4),
      overdueActions: i % 2,
    })),
    workload: { week: '2026-11-08', limit: 6, workingDays: [0, 1, 2, 3, 4] },
    trends: Array.from({ length: 12 }, (_, i) => {
      const start = new Date(Date.UTC(2026, 7, 23 + i * 7));
      const end = new Date(Date.UTC(2026, 7, 29 + i * 7));
      return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10), label: start.toISOString().slice(5, 10), current: i === 11, created: 5 + ((i * 3) % 7), completed: 3 + ((i * 2) % 6), late: i % 5, passed: 2 + (i % 3), failed: i % 2, passRate: i % 4 === 3 ? null : 80 + (i % 3) * 5 };
    }),
  };
}

function micoAiAnswer() {
  const ref = (id: string, label: string) => ({ type: 'task' as const, id, label, url: `?task=${id}` });
  return {
    question: 'Which tasks are overdue in Rig 3 Overhaul, and who has them?',
    text: '**12 tasks** are overdue in Rig 3 Overhaul.\n- Omar Ahmed has 4 of them, the oldest 9 days late.\n- Sara Al-Hinai has 3.\n\nThe pressure test (RIG-118) blocks the client walk-down, so it is the one to clear first.',
    tables: [
      {
        title: 'Overdue tasks in Rig 3 Overhaul',
        fromResult: 'r1',
        columns: [
          { key: 'key', label: 'Task', kind: 'key' as const },
          { key: 'title', label: 'Title' },
          { key: 'assignees', label: 'Assigned to' },
          { key: 'due', label: 'Due', kind: 'date' as const },
          { key: 'overdueDays', label: 'Overdue', kind: 'days' as const },
          { key: 'progress', label: 'Progress', kind: 'percent' as const },
        ],
        rows: Array.from({ length: 12 }, (_, i) => ({ ref: ref(`t${i}`, `RIG-${110 + i}`), cells: [`RIG-${110 + i}`, TITLES[i % TITLES.length]!, ASSIGNEES[i % ASSIGNEES.length]!, `2026-11-0${1 + (i % 8)}`, 9 - (i % 9), (i * 10) % 100] })),
        total: 12,
      },
    ],
    sources: [ref('t118', 'RIG-118'), ref('t104', 'RIG-104'), { type: 'project' as const, id: 'p0', label: 'Rig 3 Overhaul', url: '/projects/p0' }],
    chatTitle: 'Overdue tasks in Rig 3 Overhaul',
    generatedAt: at('2026-11-10T10:05:00Z'),
    timeZone: TZ,
    generatedBy: 'Khurram Mumtaz',
  };
}

/** Each sample's PDF, built from the same data every time. */
export function samplePdfs(p: SamplePictures): Record<SampleName, () => Buffer> {
  const company = { companyName: 'Prolens Projects LLC', logo: p.logo };
  const ctx = { generatedAt: at('2026-11-10T16:23:00Z'), timeZone: TZ, generatedBy: 'Khurram Mumtaz', companyName: 'Prolens Projects LLC', ...(p.logo ? { logo: p.logo } : {}) };
  return {
    task: () => taskPdf(screenshotTask(p), ctx),
    'task-full': () => taskPdf(fullTask(p), ctx),
    report: () => reportPdf(reportBundle(), reportMeta, undefined, company),
    minutes: () => buildMinutesPdf(minutesData(p)),
    'client-minutes': () => {
      const m = minutesData(p);
      return buildClientMinutesPdf({
        brand: BRAND,
        project: { name: m.project!.name, code: m.project!.code ?? null, number: m.project!.number ?? null, clientName: m.project!.clientName ?? null, color: m.project!.color ?? null, icon: null, image: p.project },
        meeting: { title: m.meeting.title, startAt: m.meeting.startAt, endAt: m.meeting.endAt, timeZone: m.meeting.timeZone },
        approvedAt: m.final!.approvedAt,
        content: m.final!.content,
        companyTimeZone: TZ,
        generatedAt: m.generatedAt,
        logo: p.logo,
      });
    },
    'client-task-list': () =>
      buildClientTaskListPdf({
        brand: BRAND,
        logo: p.logo,
        project: { name: 'Rig 3 Overhaul', code: 'RIG', number: 'PDO-2026-014', clientName: 'Oman Drilling Co.', color: '#1E5A8B', icon: null, image: p.project },
        percentDone: 41,
        ...clientTasks(),
        timeZone: TZ,
        generatedAt: '2026-11-10T10:05:00.000Z',
      }),
    inspection: () => buildInspectionPdf(inspectionData(p)),
    management: () => buildManagementPdf(managementOverview(), { generatedBy: 'Khurram Mumtaz', company }),
    'mico-ai': () => answerPdf(micoAiAnswer(), company),
    simple: () =>
      toSimplePdf({
        title: 'Project performance',
        columns: ['projectName', 'total', 'completed', 'overdue', 'completionPct'],
        rows: PROJECTS.flatMap((name, i) => [0, 1, 2, 3, 4, 5].map((k) => ({ projectName: `${name}${k ? ` — phase ${k}` : ''}`, total: 10 + i + k, completed: i + k, overdue: (i + k) % 3, completionPct: 10 * ((i + k) % 10) }))),
      }),
  };
}

/** Deterministic stand-ins for an uploaded project picture and company logo (see-through PNGs, as uploads are), and a drawn signature. */
export async function samplePictures(): Promise<SamplePictures> {
  const { default: sharp } = await import('sharp');
  const project = await sharp(
    Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="900"><defs><radialGradient id="g"><stop offset="0" stop-color="#e8483b"/><stop offset="1" stop-color="#7a1010"/></radialGradient></defs>` +
        `<rect x="40" y="40" width="820" height="820" rx="160" fill="#ffffff" stroke="#cccccc" stroke-width="6"/>` +
        `<circle cx="450" cy="360" r="230" fill="url(#g)"/><circle cx="450" cy="360" r="120" fill="#ffffff"/>` +
        `<rect x="150" y="640" width="600" height="70" rx="20" fill="#222222"/><rect x="230" y="740" width="440" height="40" rx="12" fill="#b3261e"/></svg>`,
    ),
  )
    .png()
    .toBuffer();
  const logo = await sharp(
    Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="560"><defs><linearGradient id="o" x1="0" x2="1"><stop offset="0" stop-color="#f7a21b"/><stop offset="1" stop-color="#c2410c"/></linearGradient></defs>` +
        `<g fill="url(#o)"><ellipse cx="300" cy="200" rx="90" ry="170" transform="rotate(-30 300 200)"/><ellipse cx="420" cy="200" rx="90" ry="170" transform="rotate(30 420 200)"/>` +
        `<ellipse cx="300" cy="380" rx="70" ry="130" transform="rotate(30 300 380)"/><ellipse cx="420" cy="380" rx="70" ry="130" transform="rotate(-30 420 380)"/></g>` +
        `<rect x="560" y="330" width="760" height="110" rx="24" fill="#f59e0b"/><rect x="560" y="470" width="480" height="40" rx="12" fill="#b91c1c"/></svg>`,
    ),
  )
    .png()
    .toBuffer();
  const signature = await sharp(
    Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="200"><path d="M20 150 C 80 20, 140 20, 180 120 S 300 180, 360 60 S 480 40, 580 140" fill="none" stroke="#1d3a8a" stroke-width="8"/></svg>`),
  )
    .png()
    .toBuffer();
  return { project, logo, signature };
}
