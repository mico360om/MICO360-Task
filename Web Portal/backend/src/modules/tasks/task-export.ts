/**
 * One task as a document: an Excel workbook (details, checklist, comments, attachments,
 * dependencies and activity, one sheet each) or a branded PDF with the same sections.
 */
import type { PrismaClient } from '@prisma/client';
import { PdfDocument, type TableColumn } from '../../lib/pdf-document';
import type { XlsxSheet } from '../../lib/xlsx-writer';
import { BRAND, formatDateTime, formatDay, priorityLabel, wallClock } from '../../lib/export-format';
import { dueDayKey, isOverdue } from '../../lib/due-date';
import { recurrenceSummary } from './recurrence-summary';
import type { RecurrenceRule } from './recurrence';
import { isTaskDone } from './task-status';

export interface TaskExportData {
  key: string;
  title: string;
  description: string | null;
  projectName: string;
  projectCode: string;
  /** The column's name. */
  status: string;
  category: string;
  priority: string;
  startDate: Date | null;
  dueDate: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  progress: number;
  estimatedHours: number | null;
  actualHours: number | null;
  createdBy: string;
  assignees: string[];
  watchers: string[];
  tags: string[];
  /** The repeat rule in words, or a note that the task belongs to a series; null for one-off tasks. */
  repeat: string | null;
  overdue: boolean;
  checklist: { text: string; done: boolean }[];
  blockedBy: { key: string; title: string; status: string }[];
  blocks: { key: string; title: string; status: string }[];
  attachments: { filename: string; sizeBytes: number; uploadedBy: string; uploadedAt: Date }[];
  comments: { author: string; at: Date; body: string }[];
  activity: { at: Date; who: string; action: string; meta: unknown }[];
}

export interface TaskExportContext {
  generatedAt: Date;
  timeZone: string;
  generatedBy?: string | null;
}

export interface TaskExportSource {
  load(taskId: string): Promise<TaskExportData | null>;
}

const humanize = (s: string): string => {
  const t = s.replace(/[._]+/g, ' ').trim().toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
};

/** A stored activity entry as a sentence ("Moved from To do to In progress"). */
export function describeActivity(action: string, meta: unknown): string {
  const m = (meta && typeof meta === 'object' ? meta : {}) as Record<string, unknown>;
  const str = (k: string) => (typeof m[k] === 'string' && m[k] ? (m[k] as string) : null);
  const fromTo = str('from') && str('to') ? ` (${str('from')} → ${str('to')})` : '';
  switch (action) {
    case 'CREATED':
      return m.recurring ? 'Created the task (next copy of a repeating task)' : 'Created the task';
    case 'ASSIGNED':
      return str('assignee') ? `Assigned ${str('assignee')}` : 'Assigned a teammate';
    case 'MOVED':
      return str('from') && str('to') ? `Moved from ${str('from')} to ${str('to')}` : 'Moved the task';
    case 'COMPLETED':
      return `Completed${fromTo}`;
    case 'REOPENED':
      return `Reopened${fromTo}`;
    default:
      return humanize(action);
  }
}

/** 48213 → '47.1 KB'. */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round((bytes / 1024) * 10) / 10} KB`;
  return `${Math.round((bytes / 1024 / 1024) * 10) / 10} MB`;
}

const day = (d: Date | null, tz: string) => (d ? formatDay(dueDayKey(d, tz)) : '');
const hours = (h: number | null) => (h === null || h === undefined ? '' : `${h} h`);

function generatedLine(ctx: TaskExportContext): string {
  return `Generated ${formatDateTime(ctx.generatedAt, ctx.timeZone)} (${ctx.timeZone})${ctx.generatedBy ? ` by ${ctx.generatedBy}` : ''}`;
}

function detailRows(t: TaskExportData, tz: string): [string, string][] {
  const due = day(t.dueDate, tz);
  return [
    ['Task', t.key],
    ['Title', t.title],
    ['Project', t.projectName],
    ['Status', t.status],
    ['Priority', priorityLabel(t.priority)],
    ['Assignees', t.assignees.join(', ') || 'Unassigned'],
    ['Watchers', t.watchers.join(', ')],
    ['Tags', t.tags.join(', ')],
    ['Start', day(t.startDate, tz)],
    ['Due', due && t.overdue ? `${due} · Overdue` : due],
    ['Completed', t.completedAt ? formatDateTime(t.completedAt, tz) : ''],
    ['Progress', `${t.progress}%`],
    ['Estimated time', hours(t.estimatedHours)],
    ['Time spent', hours(t.actualHours)],
    ['Repeat', t.repeat ?? ''],
    ['Created', `${formatDateTime(t.createdAt, tz)} by ${t.createdBy}`],
    ['Last updated', formatDateTime(t.updatedAt, tz)],
  ];
}

// ---------------------------------------------------------------------------
// Excel
// ---------------------------------------------------------------------------

export function taskSheets(t: TaskExportData, ctx: TaskExportContext): XlsxSheet[] {
  const tz = ctx.timeZone;
  const title = `${t.key} · ${t.title}`;
  const notes = [`${t.projectName} · ${generatedLine(ctx)}`];
  const at = (d: Date) => ({ date: wallClock(d, tz) });
  return [
    {
      name: 'Task',
      title,
      notes,
      columns: [{ header: 'Field' }, { header: 'Value', wrap: true }],
      rows: [...detailRows(t, tz).filter(([, v]) => v !== ''), ['Description', t.description ?? '']],
    },
    { name: 'Checklist', title, notes, columns: [{ header: 'Done' }, { header: 'Item', wrap: true }], rows: t.checklist.map((c) => [c.done ? 'Done' : '', c.text]) },
    { name: 'Comments', title, notes, columns: [{ header: 'When', kind: 'datetime' }, { header: 'Author' }, { header: 'Comment', wrap: true }], rows: t.comments.map((c) => [at(c.at), c.author, c.body]) },
    {
      name: 'Attachments',
      title,
      notes,
      columns: [{ header: 'File' }, { header: 'Size' }, { header: 'Uploaded by' }, { header: 'Uploaded', kind: 'datetime' }],
      rows: t.attachments.map((a) => [a.filename, formatSize(a.sizeBytes), a.uploadedBy, at(a.uploadedAt)]),
    },
    {
      name: 'Dependencies',
      title,
      notes,
      columns: [{ header: 'Relation' }, { header: 'Task' }, { header: 'Title', wrap: true }, { header: 'Status' }],
      rows: [...t.blockedBy.map((d) => ['Blocked by', d.key, d.title, d.status]), ...t.blocks.map((d) => ['Blocks', d.key, d.title, d.status])],
    },
    { name: 'Activity', title, notes, columns: [{ header: 'When', kind: 'datetime' }, { header: 'Who' }, { header: 'What', wrap: true }], rows: t.activity.map((a) => [at(a.at), a.who, describeActivity(a.action, a.meta)]) },
  ];
}

// ---------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------

export function taskPdf(t: TaskExportData, ctx: TaskExportContext): Buffer {
  const tz = ctx.timeZone;
  const running = `${t.key} · ${t.projectName}`;
  const doc = new PdfDocument({ title: `${t.key} · ${t.title}`, runningTitle: running, footerLeft: `MICO360 Tasks · ${generatedLine(ctx)}`, palette: { brand: BRAND } });
  doc.reportHeader({ title: t.title, subtitle: t.projectName, details: [`Task ${t.key}`, generatedLine(ctx)] });

  const due = day(t.dueDate, tz);
  doc.statTiles([
    { label: 'Status', value: t.status, tone: t.category === 'DONE' ? 'success' : t.category === 'BLOCKED' ? 'danger' : 'brand' },
    { label: 'Priority', value: priorityLabel(t.priority), tone: t.priority === 'URGENT' || t.priority === 'HIGH' ? 'danger' : 'muted' },
    { label: 'Due', value: due || '—', note: t.overdue ? 'Overdue' : undefined, tone: t.overdue ? 'danger' : 'muted' },
    { label: 'Progress', value: `${t.progress}%`, tone: t.progress >= 100 ? 'success' : 'brand' },
  ]);

  const muted: [number, number, number] = [0.42, 0.4, 0.38];
  const none = (text: string) => doc.text(text, { size: 9.5, color: muted, gap: 2 });
  const table = (heading: string, cols: TableColumn[], rows: string[][], empty: string) => {
    doc.heading(heading, { keepWith: rows.length ? doc.tableHeight(cols, rows.slice(0, 3), { size: 9 }) : 20 });
    if (rows.length === 0) none(empty);
    else doc.table(cols, rows, { size: 9 });
  };

  doc.heading('Details', { keepWith: 120 });
  for (const [label, value] of detailRows(t, tz)) if (value && label !== 'Title') doc.keyValue(label, value, { size: 9.5 });

  doc.heading('Description', { keepWith: 30 });
  if (t.description?.trim()) doc.text(t.description.trim(), { size: 10 });
  else none('No description.');

  doc.heading('Checklist', { keepWith: 40 });
  if (t.checklist.length === 0) none('No checklist items.');
  else {
    doc.text(`${t.checklist.filter((c) => c.done).length} of ${t.checklist.length} done`, { size: 9, color: muted, gap: 3 });
    doc.table([{ header: 'Status', align: 'left' }, { header: 'Item' }], t.checklist.map((c) => [c.done ? 'Done' : 'Open', c.text]), {
      size: 9,
      cellColor: (r, c) => (c === 0 && t.checklist[r]!.done ? [0.18, 0.49, 0.33] : null),
    });
  }

  doc.heading('Comments', { keepWith: 40 });
  if (t.comments.length === 0) none('No comments yet.');
  for (const c of t.comments) {
    doc.keepTogether(30);
    doc.text(`${c.author} · ${formatDateTime(c.at, tz)}`, { size: 8.5, bold: true, color: muted });
    doc.text(c.body, { size: 10, gap: 6 });
  }

  table('Attachments', [{ header: 'File' }, { header: 'Size', align: 'right' }, { header: 'Uploaded by' }, { header: 'Uploaded' }], t.attachments.map((a) => [a.filename, formatSize(a.sizeBytes), a.uploadedBy, formatDateTime(a.uploadedAt, tz)]), 'No attachments.');
  table(
    'Dependencies',
    [{ header: 'Relation' }, { header: 'Task' }, { header: 'Title' }, { header: 'Status' }],
    [...t.blockedBy.map((d) => ['Blocked by', d.key, d.title, d.status]), ...t.blocks.map((d) => ['Blocks', d.key, d.title, d.status])],
    'No dependencies.',
  );
  table('Activity', [{ header: 'When' }, { header: 'Who' }, { header: 'What' }], t.activity.map((a) => [formatDateTime(a.at, tz), a.who, describeActivity(a.action, a.meta)]), 'No activity yet.');
  return doc.build();
}

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

const personName = (u: { firstName: string | null; lastName: string | null; username: string } | null | undefined): string =>
  u ? [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || u.username : 'Someone';

/** Everything a task export shows, read in one go (deleted comments and tasks left out). */
export function createPrismaTaskExportSource(prisma: PrismaClient, timeZone: string, now: () => Date = () => new Date()): TaskExportSource {
  const person = { select: { firstName: true, lastName: true, username: true } } as const;
  return {
    async load(taskId) {
      const t = await prisma.task.findFirst({
        where: { id: taskId, deletedAt: null, project: { is: { deletedAt: null } } },
        include: {
          project: { select: { name: true, code: true } },
          column: { select: { name: true, category: true } },
          createdBy: person,
          assignees: { include: { user: person } },
          watchers: { include: { user: person } },
          tags: { include: { tag: { select: { name: true } } } },
          checklist: { orderBy: { position: 'asc' }, select: { text: true, done: true } },
          dependencies: { include: { dependsOn: { select: { key: true, title: true, deletedAt: true, column: { select: { name: true } } } } } },
          dependedOnBy: { include: { task: { select: { key: true, title: true, deletedAt: true, column: { select: { name: true } } } } } },
          attachments: { orderBy: { createdAt: 'asc' }, include: { uploadedBy: person } },
          comments: { where: { deletedAt: null }, orderBy: { createdAt: 'asc' }, include: { user: person } },
          activities: { orderBy: { createdAt: 'asc' }, take: 500, include: { user: person } },
        },
      });
      if (!t) return null;
      const rule = t.recurrenceRule as unknown as RecurrenceRule | null;
      const done = isTaskDone({ columnCategory: t.column.category, completedAt: t.completedAt });
      return {
        key: t.key,
        title: t.title,
        description: t.description,
        projectName: t.project.name,
        projectCode: t.project.code,
        status: t.column.name,
        category: t.column.category,
        priority: t.priority,
        startDate: t.startDate,
        dueDate: t.dueDate,
        completedAt: t.completedAt,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
        progress: t.progress,
        estimatedHours: t.estimatedHours,
        actualHours: t.actualHours,
        createdBy: personName(t.createdBy),
        assignees: t.assignees.map((a) => personName(a.user)),
        watchers: t.watchers.map((w) => personName(w.user)),
        tags: t.tags.map((x) => x.tag.name),
        repeat: rule ? recurrenceSummary(rule) : t.recurrenceParentId ? 'Part of a repeating series' : null,
        overdue: !done && isOverdue(t.dueDate, timeZone, now()),
        checklist: t.checklist,
        blockedBy: t.dependencies.filter((d) => !d.dependsOn.deletedAt).map((d) => ({ key: d.dependsOn.key, title: d.dependsOn.title, status: d.dependsOn.column.name })),
        blocks: t.dependedOnBy.filter((d) => !d.task.deletedAt).map((d) => ({ key: d.task.key, title: d.task.title, status: d.task.column.name })),
        attachments: t.attachments.map((a) => ({ filename: a.filename, sizeBytes: a.sizeBytes, uploadedBy: personName(a.uploadedBy), uploadedAt: a.createdAt })),
        comments: t.comments.map((c) => ({ author: personName(c.user), at: c.createdAt, body: c.body })),
        activity: t.activities.map((a) => ({ at: a.createdAt, who: personName(a.user), action: a.action, meta: a.meta })),
      };
    },
  };
}
