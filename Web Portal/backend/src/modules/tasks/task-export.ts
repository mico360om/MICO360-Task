/**
 * One task as a document: an Excel workbook (details, checklist, comments, attachments,
 * dependencies and activity, one sheet each) or a PDF of the whole task under its project's badge.
 */
import type { PrismaClient } from '@prisma/client';
import { PdfDocument, hexToRgb, type GridPicture, type RGB, type TableColumn } from '../../lib/pdf-document';
import { isolate, layoutText, lineBox, type StyledRun } from '../../lib/pdf-text';
import { printableAsStored, printableImage } from '../../lib/pdf-image';
import type { XlsxSheet } from '../../lib/xlsx-writer';
import { BRAND, formatDateTime, formatDay, priorityLabel, wallClock } from '../../lib/export-format';
import { dueDayKey, isOverdue } from '../../lib/due-date';
import { projectIconPaths, projectInitials } from '../projects/project-icons';
import { projectAudienceIds } from './prisma-assignee-repository';
import { buildTimeline } from '../activity/activity-feed';
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

/** A task linked by a dependency. */
export interface TaskExportLink {
  id: string;
  key: string;
  title: string;
  /** Its column's name. */
  status: string;
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
  /**
   * The meeting the task was made from (null when none, or when that meeting was deleted). Its title
   * and start are null for a reader who may not see that meeting (the export route checks), as on the website.
   */
  meeting: { id: string; title: string | null; startAt: Date | null } | null;
  checklist: { text: string; done: boolean }[];
  /** The tasks this one waits for, and those waiting for it (the export route keeps only those the reader may open). */
  blockedBy: TaskExportLink[];
  blocks: TaskExportLink[];
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

/**
 * One stored activity entry in the website's words ("Changed priority from Normal to High", "Ticked
 * off “Order the parts”", "Moved this task: To do → In progress"), one line per change: the web
 * app's own wording (a copy of its activity-feed module), starting with a capital as it follows
 * the "Who" column.
 */
export function describeActivity(action: string, meta: unknown): string {
  const details = meta && typeof meta === 'object' && !Array.isArray(meta) ? (meta as Record<string, unknown>) : null;
  const [item] = buildTimeline([{ id: 'entry', action, actorName: '', meta: details }]);
  if (!item) return 'Updated this task'; // an edit that changed nothing it can name
  const text = item.text.charAt(0).toUpperCase() + item.text.slice(1);
  return item.path && item.path.length > 1 ? `${text}: ${item.path.join(' → ')}` : text;
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

/**
 * A picture the thumbnail maker turns down (a damaged or crafted file) is shown only when the PDF
 * can print it as stored, and is never unpacked here; without a thumbnail maker it is printed as
 * stored or flattened, within printableImage's limits.
 */
async function readPicture(storageKey: string, reader: PictureReader): Promise<Buffer | null> {
  const raw = await reader.read(storageKey).catch(() => null);
  if (!raw) return null;
  if (!reader.thumbnail) return printableImage(raw);
  const small = await reader.thumbnail(raw).catch(() => null);
  return small ?? (printableAsStored(raw) ? raw : null);
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

/** "Weekly review · 27 Sep 2026"; for a reader not part of that meeting, only that there is one (the website's words). */
function meetingText(meeting: TaskExportData['meeting'], tz: string): string {
  if (!meeting) return '';
  if (!meeting.title) return 'A meeting you’re not part of';
  return meeting.startAt ? `${isolate(meeting.title)} · ${day(meeting.startAt, tz)}` : isolate(meeting.title);
}

export function taskPdf(t: TaskExportData, ctx: TaskExportContext): Buffer {
  const tz = ctx.timeZone;
  const brand = hexToRgb(BRAND);
  const generated = generatedLine(ctx, isolate);
  const doc = new PdfDocument({ title: `${t.key} · ${t.title}`, runningTitle: `${t.key} · ${t.projectName}`, footerLeft: `MICO360 Tasks · ${generated}`, palette: { brand: BRAND } });
  const width = doc.pageWidth - doc.margin * 2;

  // Header: the project's badge (its picture, else its icon, else its initials, on its colour), name
  // and number; then the task's key, its title from its start edge, and who made this PDF when.
  doc.identityHeader({
    image: t.projectImage ?? null, // shown when the PDF can print it (a see-through PNG set on white), as the minutes PDF does
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
  // Each section heading is kept on the page with its note and the first thing under it (a
  // paragraph's first two lines, a picture row, a table's header and first row), never left alone
  // at the bottom of a page; these measure them.
  const noteHeight = (text: string, gap = 3) => doc.textHeight(text, { size: 9, gap });
  const opening = (text: string, size: number) => Math.min(doc.textHeight(text, { size }), lineBox(null, size).height * 2);

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
      ['From meeting', meetingText(t.meeting, tz)],
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
  const description = t.description?.replace(/\r\n?/g, '\n').trim();
  const paragraphs = description ? description.split('\n') : [];
  doc.heading('Description', { keepWith: paragraphs.length ? opening(paragraphs[0]!, 10) : 0 });
  if (paragraphs.length) for (const para of paragraphs) doc.text(para, { size: 10 });
  else none('No description.');

  // Checklist: drawn boxes, ticked when done; long items wrap in full.
  const checked = `${t.checklist.filter((c) => c.done).length} of ${t.checklist.length} done`;
  doc.heading('Checklist', { keepWith: t.checklist.length ? noteHeight(checked) + opening(t.checklist[0]!.text, 10) : 0 });
  if (t.checklist.length === 0) none('No checklist items.');
  else {
    note(checked);
    for (const c of t.checklist) doc.checkItem(c.text, c.done, { size: 10 });
  }

  // Comments: each reply under the comment it answers, a step further in; @mentions in bold. A
  // comment's name line starts on the same page as its first lines.
  const commentStart = 34;
  doc.heading('Comments', { keepWith: t.comments.length ? commentStart : 0 });
  if (t.comments.length === 0) none('No comments yet.');
  for (const { comment: c, depth } of commentThreads(t.comments)) {
    const inset = Math.min(depth, 3) * 18;
    const bar = depth > 0 ? THREAD : undefined;
    doc.keepTogether(commentStart);
    doc.text(`${isolate(c.author)} · ${formatDateTime(c.at, tz)}${c.edited ? ' · edited' : ''}`, { size: 8.5, bold: true, color: MUTED, inset, bar, direction: 'ltr' });
    doc.styledText(commentRuns(c.body, t.mentionable), { size: 10, inset, bar, gap: 6 });
  }

  // Attachments: the first pictures as thumbnails, three to a row; everything else listed.
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
  const fileCols: TableColumn[] = [{ header: 'File' }, { header: 'Size', align: 'right' }, { header: 'Added by' }, { header: 'Added' }];
  const files = `${plural(t.attachments.length, 'file')}${shown.length ? ` · ${plural(shown.length, 'picture')} shown` : ''}`;
  const firstFiles = shown.length ? doc.imageGridFirstRowHeight(shown) : doc.tableHeight(fileCols, listed, { size: 9, wide: 0, firstRows: 1 });
  doc.heading('Attachments', { keepWith: t.attachments.length ? noteHeight(files, 6) + firstFiles : 0 });
  if (t.attachments.length === 0) none('No attachments.');
  else {
    note(files, 6);
    doc.imageGrid(shown);
    if (listed.length) {
      if (shown.length) doc.subheading('Other files', { topGap: 2, keepWith: doc.tableHeight(fileCols, listed, { size: 9, wide: 0, firstRows: 2 }) });
      doc.table(fileCols, listed, { size: 9, wide: 0 });
    }
  }

  // Dependencies: what this task waits for, and what waits for it. The title comes last and takes
  // the spare width, so an Arabic title ends at the page's edge.
  const linkCols: TableColumn[] = [{ header: 'Task' }, { header: 'Status' }, { header: 'Title' }];
  const sides = [
    { label: 'Blocked by', rows: t.blockedBy.map((d) => [d.key, d.status, d.title]), empty: 'Nothing blocks this task.' },
    { label: 'Blocks', rows: t.blocks.map((d) => [d.key, d.status, d.title]), empty: 'No other task waits for this one.' },
  ].map((s) => ({ ...s, keep: { topGap: 4, keepWith: s.rows.length ? doc.tableHeight(linkCols, s.rows, { size: 9, wide: 2, firstRows: 3 }) : 16 } }));
  const anyLinks = sides.some((s) => s.rows.length > 0);
  doc.heading('Dependencies', { keepWith: anyLinks ? doc.subheadingRoom(sides[0]!.keep) : 0 });
  if (!anyLinks) none('No dependencies.');
  else {
    for (const side of sides) {
      doc.subheading(side.label, side.keep);
      if (side.rows.length) doc.table(linkCols, side.rows, { size: 9, wide: 2 });
      else none(side.empty);
    }
  }

  // Activity: the latest changes, newest first.
  const latest = [...t.activity].reverse().sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, MAX_ACTIVITY);
  const changeCols: TableColumn[] = [{ header: 'When' }, { header: 'Who' }, { header: 'What' }];
  const changes = latest.map((a) => [formatDateTime(a.at, tz), a.who, describeActivity(a.action, a.meta)]);
  doc.heading('Activity', { keepWith: changes.length ? noteHeight('Newest first') + doc.tableHeight(changeCols, changes, { size: 9, wide: 2, firstRows: 1 }) : 0 });
  if (changes.length === 0) none('No activity yet.');
  else {
    const earlier = Math.max(t.activityTotal ?? 0, t.activity.length) - latest.length;
    note('Newest first');
    doc.table(changeCols, changes, { size: 9, wide: 2 });
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
  const live = { deletedAt: null, project: { is: { deletedAt: null } } } as const;
  const link = { id: true, key: true, title: true, column: { select: { name: true } } } as const;
  const linked = (t: { id: string; key: string; title: string; column: { name: string } }): TaskExportLink => ({ id: t.id, key: t.key, title: t.title, status: t.column.name });
  return {
    async load(taskId) {
      const t = await prisma.task.findFirst({
        where: { id: taskId, deletedAt: null, project: { is: { deletedAt: null } } },
        include: {
          project: { select: { name: true, code: true, number: true, color: true, icon: true, imageUrl: true } },
          column: { select: { name: true, category: true } },
          createdBy: person,
          meeting: { select: { id: true, title: true, startAt: true, deletedAt: true } },
          assignees: { include: { user: person } },
          watchers: { include: { user: person } },
          tags: { include: { tag: { select: { name: true } } } },
          checklist: { orderBy: { position: 'asc' }, select: { text: true, done: true } },
          // Linked tasks that are deleted, or in a deleted project, are left out.
          dependencies: { where: { dependsOn: live }, include: { dependsOn: { select: link } } },
          dependedOnBy: { where: { task: live }, include: { task: { select: link } } },
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
        meeting: t.meeting && !t.meeting.deletedAt ? { id: t.meeting.id, title: t.meeting.title, startAt: t.meeting.startAt } : null,
        checklist: t.checklist,
        blockedBy: t.dependencies.map((d) => linked(d.dependsOn)),
        blocks: t.dependedOnBy.map((d) => linked(d.task)),
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
