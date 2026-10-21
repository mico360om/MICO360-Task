/**
 * One task as a document: an Excel workbook (details, checklist, comments, attachments,
 * dependencies and activity, one sheet each) or a PDF of the whole task under its project's badge.
 */
import type { PrismaClient } from '@prisma/client';
import { PdfDocument, hexToRgb, type GridPicture, type RGB, type TableColumn } from '../../lib/pdf-document';
import { isolate, layoutText, type StyledRun } from '../../lib/pdf-text';
import { printableImage } from '../../lib/pdf-image';
import type { XlsxSheet } from '../../lib/xlsx-writer';
import { BRAND, formatDateTime, formatDay, priorityLabel, wallClock } from '../../lib/export-format';
import { dueDayKey, isOverdue } from '../../lib/due-date';
import { projectIconPaths, projectInitials } from '../projects/project-icons';
import { projectAudienceIds } from './prisma-assignee-repository';
import { mentionTokens } from './mentions';
import { recurrenceSummary } from './recurrence-summary';
import type { RecurrenceRule } from './recurrence';
import { isTaskDone } from './task-status';

export interface TaskExportAttachment {
  filename: string;
  mimeType: string;
  sizeBytes: number;
  /** Where the file is kept (read back for the PDF's pictures). */
  storageKey: string;
  uploadedBy: string;
  uploadedAt: Date;
  /**
   * A picture ready to print, filled in by withPictures: a Buffer when it was read, null when it
   * couldn't be (the PDF lists it instead), absent when it wasn't read.
   */
  picture?: Buffer | null;
}

export interface TaskExportComment {
  id: string;
  /** The comment this one answers (a reply), or null. */
  parentId: string | null;
  author: string;
  at: Date;
  body: string;
  edited: boolean;
}

export interface TaskExportData {
  key: string;
  title: string;
  description: string | null;
  projectName: string;
  projectCode: string;
  /** The project's own number (e.g. the client's job number). */
  projectNumber: string | null;
  /** The project's colour (hex) and icon: its badge at the top of the PDF. */
  projectColor: string | null;
  projectIcon: string | null;
  /** The project's uploaded picture ('/uploads/…'): shown as its badge instead, as on the minutes PDF. */
  projectImageUrl?: string | null;
  /** That picture's bytes, read by the PDF route; without them the icon or initials are shown. */
  projectImage?: Buffer | null;
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
  /** A milestone: a key date of its project. */
  isMilestone: boolean;
  /** The meeting the task was made from (null when none, or when that meeting was deleted). */
  meeting: { title: string; startAt: Date } | null;
  checklist: { text: string; done: boolean }[];
  blockedBy: { key: string; title: string; status: string }[];
  blocks: { key: string; title: string; status: string }[];
  attachments: TaskExportAttachment[];
  /** Oldest first. */
  comments: TaskExportComment[];
  /** The usernames that count as @mentions in comments: the people who can open the task. */
  mentionable: string[];
  /** Oldest first; may hold only the latest entries (see activityTotal). */
  activity: { at: Date; who: string; action: string; meta: unknown }[];
  /** How many activity entries the task has in all, when more than `activity` holds. */
  activityTotal?: number;
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
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** "Generated 1 Oct 2026, 10:00 (Asia/Muscat) by Aisha Khan"; `name` wraps the name (the PDF isolates it, so an Arabic name keeps its place). */
function generatedLine(ctx: TaskExportContext, name: (s: string) => string = (s) => s): string {
  return `Generated ${formatDateTime(ctx.generatedAt, ctx.timeZone)} (${ctx.timeZone})${ctx.generatedBy ? ` by ${name(ctx.generatedBy)}` : ''}`;
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
// Pictures
// ---------------------------------------------------------------------------

/** At most this many attached pictures are shown in a task's PDF; the rest are listed. */
export const MAX_PICTURES = 12;

/** The latest this many changes are shown in a task's PDF, newest first. */
export const MAX_ACTIVITY = 50;

/** An attachment the PDF can try to show as a picture. */
export const isPicture = (mimeType: string): boolean => /^image\//i.test(mimeType) && !/svg/i.test(mimeType);

export interface PictureReader {
  /** The stored bytes of an attached file, by its storage key. */
  read: (storageKey: string) => Promise<Buffer | null>;
  /** A small picture a PDF can print (a JPEG thumbnail) made from the stored one; null when it can't. */
  thumbnail?: (raw: Buffer) => Promise<Buffer | null>;
}

/**
 * The task with its attached pictures read for the PDF, in order and one at a time, until
 * MAX_PICTURES of them could be read (trying at most twice that many): made small when a thumbnail
 * maker is given, else as stored when the PDF can print that. A picture that can't be read gets
 * null, so the PDF lists it; nothing here ever fails the export.
 */
export async function withPictures(t: TaskExportData, reader: PictureReader): Promise<TaskExportData> {
  let tried = 0;
  let read = 0;
  const attachments: TaskExportAttachment[] = [];
  for (const a of t.attachments) {
    if (!isPicture(a.mimeType) || read >= MAX_PICTURES || tried >= MAX_PICTURES * 2) {
      attachments.push(a);
      continue;
    }
    tried++;
    const picture = await readPicture(a.storageKey, reader);
    if (picture) read++;
    attachments.push({ ...a, picture });
  }
  return { ...t, attachments };
}

async function readPicture(storageKey: string, reader: PictureReader): Promise<Buffer | null> {
  const raw = await reader.read(storageKey).catch(() => null);
  if (!raw) return null;
  const small = reader.thumbnail ? await reader.thumbnail(raw).catch(() => null) : null;
  return small ?? printableImage(raw);
}

// ---------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------

const INK: RGB = [0.11, 0.1, 0.09];
const MUTED: RGB = [0.42, 0.4, 0.38];
const THREAD: RGB = [0.82, 0.8, 0.78];

/** The title's size: as big as keeps it to two lines (20, 18 or 16 pt), else 14 pt over as many lines as it needs. */
export function titleSize(title: string, width: number): number {
  const lines = (size: number) => layoutText(title, { size, bold: true, family: 'display', maxWidth: width }).length;
  return [20, 18, 16].find((size) => lines(size) <= 2) ?? 14;
}

/** Comments in reading order: each followed by its replies (and theirs), with how deep it sits. */
export function commentThreads<C extends { id: string; parentId: string | null }>(comments: C[]): Array<{ comment: C; depth: number }> {
  const ids = new Set(comments.map((c) => c.id));
  const replies = new Map<string, C[]>();
  for (const c of comments) {
    if (c.parentId && c.parentId !== c.id && ids.has(c.parentId)) replies.set(c.parentId, [...(replies.get(c.parentId) ?? []), c]);
  }
  const out: Array<{ comment: C; depth: number }> = [];
  const seen = new Set<string>();
  const visit = (c: C, depth: number) => {
    if (seen.has(c.id)) return;
    seen.add(c.id);
    out.push({ comment: c, depth });
    for (const r of replies.get(c.id) ?? []) visit(r, depth + 1);
  };
  // Top-level comments, and replies to a comment that is gone, start a thread; anything else
  // left over (it can't happen, but never lose a comment) follows at the top level.
  for (const c of comments) if (!c.parentId || !ids.has(c.parentId) || c.parentId === c.id) visit(c, 0);
  for (const c of comments) visit(c, 0);
  return out;
}

/** A comment as formatted runs: real @mentions in bold, each kept whole ("@aisha") inside right-to-left text. */
export function commentRuns(body: string, mentionable: string[]): StyledRun[] {
  return mentionTokens(body, mentionable).map((t) => (t.mention ? { text: isolate(t.text), bold: true } : { text: t.text }));
}

/** Names in a list, each isolated so an Arabic name can't pull its neighbours (or the commas) out of order. */
const names = (list: string[]) => list.map(isolate).join(', ');

export function taskPdf(t: TaskExportData, ctx: TaskExportContext): Buffer {
  const tz = ctx.timeZone;
  const brand = hexToRgb(BRAND);
  const generated = generatedLine(ctx, isolate);
  const doc = new PdfDocument({ title: `${t.key} · ${t.title}`, runningTitle: `${t.key} · ${t.projectName}`, footerLeft: `MICO360 Tasks · ${generated}`, palette: { brand: BRAND } });
  const width = doc.pageWidth - doc.margin * 2;

  // Header: the project's badge (its picture, else its icon, else its initials, on its colour), name
  // and number; then the task's key, its title from its start edge, and who made this PDF when.
  doc.identityHeader({
    image: t.projectImage ?? null,
    icon: projectIconPaths(t.projectIcon),
    initials: projectInitials(t.projectName),
    color: t.projectColor ? hexToRgb(t.projectColor, brand) : undefined,
    eyebrow: 'Task',
    title: t.projectName,
    subtitle: [t.projectCode, t.projectNumber ? `Project no. ${t.projectNumber}` : null].filter((s): s is string => Boolean(s)).map(isolate).join('  ·  '),
  });
  doc.text(t.key, { bold: true, size: 10, color: brand, gap: 1, direction: 'ltr' });
  doc.text(t.title, { bold: true, size: titleSize(t.title, width), family: 'display', color: INK, gap: 2 });
  doc.text(generated, { size: 8.5, color: MUTED, gap: 10, direction: 'ltr' });

  const due = day(t.dueDate, tz);
  doc.statTiles([
    { label: 'Status', value: t.status, tone: t.category === 'DONE' ? 'success' : t.category === 'BLOCKED' ? 'danger' : 'brand' },
    { label: 'Priority', value: priorityLabel(t.priority), tone: t.priority === 'URGENT' || t.priority === 'HIGH' ? 'danger' : 'muted' },
    { label: 'Due', value: due || '—', note: t.overdue ? 'Overdue' : undefined, tone: t.overdue ? 'danger' : 'muted' },
    { label: 'Progress', value: `${t.progress}%`, tone: t.progress >= 100 ? 'success' : 'brand' },
  ]);

  const none = (text: string) => doc.text(text, { size: 9.5, color: MUTED, gap: 2 });
  const note = (text: string, gap = 3) => doc.text(text, { size: 9, color: MUTED, gap });

  // Details: everything the cards above don't show.
  doc.heading('Details', { keepWith: 90 });
  const time = [t.estimatedHours != null ? `${hours(t.estimatedHours)} estimated` : '', t.actualHours != null ? `${hours(t.actualHours)} spent` : ''].filter(Boolean).join(' · ');
  const rows = (pairs: Array<[string, string]>) => pairs.filter(([, v]) => v !== '');
  doc.keyValueColumns(
    rows([
      ['Project', t.projectName],
      ['Assignees', names(t.assignees) || 'Unassigned'],
      ['Watchers', names(t.watchers)],
      ['Tags', names(t.tags)],
      ['Milestone', t.isMilestone ? 'Yes, a key date of this project' : ''],
      ['From meeting', t.meeting ? `${isolate(t.meeting.title)} · ${day(t.meeting.startAt, tz)}` : ''],
    ]),
    rows([
      ['Start', day(t.startDate, tz)],
      ['Completed', t.completedAt ? formatDateTime(t.completedAt, tz) : ''],
      ['Time', time],
      ['Repeat', t.repeat ?? ''],
      ['Created', `${formatDateTime(t.createdAt, tz)} by ${isolate(t.createdBy)}`],
      ['Last updated', formatDateTime(t.updatedAt, tz)],
    ]),
    { size: 9.5 },
  );

  // Description: each paragraph in its own direction.
  doc.heading('Description', { keepWith: 30 });
  const description = t.description?.replace(/\r\n?/g, '\n').trim();
  if (description) for (const para of description.split('\n')) doc.text(para, { size: 10 });
  else none('No description.');

  // Checklist: drawn boxes, ticked when done; long items wrap in full.
  doc.heading('Checklist', { keepWith: 40 });
  if (t.checklist.length === 0) none('No checklist items.');
  else {
    note(`${t.checklist.filter((c) => c.done).length} of ${t.checklist.length} done`);
    for (const c of t.checklist) doc.checkItem(c.text, c.done, { size: 10 });
  }

  // Comments: each reply under the comment it answers, a step further in; @mentions in bold.
  doc.heading('Comments', { keepWith: 40 });
  if (t.comments.length === 0) none('No comments yet.');
  for (const { comment: c, depth } of commentThreads(t.comments)) {
    const inset = Math.min(depth, 3) * 18;
    const bar = depth > 0 ? THREAD : undefined;
    doc.keepTogether(34);
    doc.text(`${isolate(c.author)} · ${formatDateTime(c.at, tz)}${c.edited ? ' · edited' : ''}`, { size: 8.5, bold: true, color: MUTED, inset, bar, direction: 'ltr' });
    doc.styledText(commentRuns(c.body, t.mentionable), { size: 10, inset, bar, gap: 6 });
  }

  // Attachments: the first pictures as thumbnails, three to a row; everything else listed.
  doc.heading('Attachments', { keepWith: 60 });
  if (t.attachments.length === 0) none('No attachments.');
  else {
    const shown: GridPicture[] = [];
    const listed: string[][] = [];
    for (const a of t.attachments) {
      const image = a.picture && shown.length < MAX_PICTURES ? doc.prepareImage(a.picture) : null;
      if (image) {
        shown.push({ image, caption: a.filename });
        continue;
      }
      const failed = a.picture === null || (a.picture !== undefined && shown.length < MAX_PICTURES);
      listed.push([failed ? `${a.filename} (picture could not be shown)` : a.filename, formatSize(a.sizeBytes), a.uploadedBy, formatDateTime(a.uploadedAt, tz)]);
    }
    note(`${plural(t.attachments.length, 'file')}${shown.length ? ` · ${plural(shown.length, 'picture')} shown` : ''}`, 6);
    doc.imageGrid(shown);
    if (listed.length) {
      const cols: TableColumn[] = [{ header: 'File' }, { header: 'Size', align: 'right' }, { header: 'Added by' }, { header: 'Added' }];
      if (shown.length) doc.subheading('Other files', { topGap: 2, keepWith: doc.tableHeight(cols, listed.slice(0, 2), { size: 9, wide: 0 }) });
      doc.table(cols, listed, { size: 9, wide: 0 });
    }
  }

  // Dependencies: what this task waits for, and what waits for it.
  doc.heading('Dependencies', { keepWith: 50 });
  if (t.blockedBy.length === 0 && t.blocks.length === 0) none('No dependencies.');
  else {
    // The title comes last and takes the spare width, so an Arabic title ends at the page's edge.
    const cols: TableColumn[] = [{ header: 'Task' }, { header: 'Status' }, { header: 'Title' }];
    const side = (label: string, list: TaskExportData['blocks'], empty: string) => {
      const tableRows = list.map((d) => [d.key, d.status, d.title]);
      doc.subheading(label, { topGap: 4, keepWith: tableRows.length ? doc.tableHeight(cols, tableRows.slice(0, 3), { size: 9, wide: 2 }) : 16 });
      if (tableRows.length) doc.table(cols, tableRows, { size: 9, wide: 2 });
      else none(empty);
    };
    side('Blocked by', t.blockedBy, 'Nothing blocks this task.');
    side('Blocks', t.blocks, 'No other task waits for this one.');
  }

  // Activity: the latest changes, newest first.
  doc.heading('Activity', { keepWith: 50 });
  if (t.activity.length === 0) none('No activity yet.');
  else {
    const latest = [...t.activity].reverse().sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, MAX_ACTIVITY);
    const earlier = Math.max(t.activityTotal ?? 0, t.activity.length) - latest.length;
    note('Newest first');
    doc.table([{ header: 'When' }, { header: 'Who' }, { header: 'What' }], latest.map((a) => [formatDateTime(a.at, tz), a.who, describeActivity(a.action, a.meta)]), { size: 9, wide: 2 });
    if (earlier > 0) doc.spacer(4).text(`${plural(earlier, 'earlier change')} not shown`, { size: 9, color: MUTED });
  }
  return doc.build();
}

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

const personName = (u: { firstName: string | null; lastName: string | null; username: string } | null | undefined): string =>
  u ? [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || u.username : 'Someone';

/** Everything a task export shows, read in one go (deleted comments, tasks and meetings left out). */
export function createPrismaTaskExportSource(prisma: PrismaClient, timeZone: string, now: () => Date = () => new Date()): TaskExportSource {
  const person = { select: { firstName: true, lastName: true, username: true } } as const;
  return {
    async load(taskId) {
      const t = await prisma.task.findFirst({
        where: { id: taskId, deletedAt: null, project: { is: { deletedAt: null } } },
        include: {
          project: { select: { name: true, code: true, number: true, color: true, icon: true, imageUrl: true } },
          column: { select: { name: true, category: true } },
          createdBy: person,
          meeting: { select: { title: true, startAt: true, deletedAt: true } },
          assignees: { include: { user: person } },
          watchers: { include: { user: person } },
          tags: { include: { tag: { select: { name: true } } } },
          checklist: { orderBy: { position: 'asc' }, select: { text: true, done: true } },
          dependencies: { include: { dependsOn: { select: { key: true, title: true, deletedAt: true, column: { select: { name: true } } } } } },
          dependedOnBy: { include: { task: { select: { key: true, title: true, deletedAt: true, column: { select: { name: true } } } } } },
          attachments: { orderBy: { createdAt: 'asc' }, include: { uploadedBy: person } },
          comments: { where: { deletedAt: null }, orderBy: { createdAt: 'asc' }, include: { user: person } },
          // The latest 500 changes (shown oldest first); the count says how many there are in all.
          activities: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 500, include: { user: person } },
          _count: { select: { activities: true } },
        },
      });
      if (!t) return null;
      const rule = t.recurrenceRule as unknown as RecurrenceRule | null;
      const done = isTaskDone({ columnCategory: t.column.category, completedAt: t.completedAt });
      // Who can be @mentioned: the people who can open the task (as when the comment was written).
      const mentionable = t.comments.some((c) => c.body.includes('@'))
        ? (await prisma.user.findMany({ where: { id: { in: await projectAudienceIds(prisma, t.projectId) } }, select: { username: true } })).map((u) => u.username)
        : [];
      return {
        key: t.key,
        title: t.title,
        description: t.description,
        projectName: t.project.name,
        projectCode: t.project.code,
        projectNumber: t.project.number,
        projectColor: t.project.color,
        projectIcon: t.project.icon,
        projectImageUrl: t.project.imageUrl,
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
        isMilestone: t.isMilestone,
        meeting: t.meeting && !t.meeting.deletedAt ? { title: t.meeting.title, startAt: t.meeting.startAt } : null,
        checklist: t.checklist,
        blockedBy: t.dependencies.filter((d) => !d.dependsOn.deletedAt).map((d) => ({ key: d.dependsOn.key, title: d.dependsOn.title, status: d.dependsOn.column.name })),
        blocks: t.dependedOnBy.filter((d) => !d.task.deletedAt).map((d) => ({ key: d.task.key, title: d.task.title, status: d.task.column.name })),
        attachments: t.attachments.map((a) => ({
          filename: a.filename,
          mimeType: a.mimeType,
          sizeBytes: a.sizeBytes,
          storageKey: a.storageKey,
          uploadedBy: personName(a.uploadedBy),
          uploadedAt: a.createdAt,
        })),
        comments: t.comments.map((c) => ({ id: c.id, parentId: c.parentId, author: personName(c.user), at: c.createdAt, body: c.body, edited: c.editedAt !== null })),
        mentionable,
        activity: [...t.activities].reverse().map((a) => ({ at: a.createdAt, who: personName(a.user), action: a.action, meta: a.meta })),
        activityTotal: t._count.activities,
      };
    },
  };
}
