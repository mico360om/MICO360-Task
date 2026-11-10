import { arrange, type ItemRow, type ListRow } from './checklist-tree';
/**
 * One task as a document: an Excel workbook (details, external contacts, checklist, comments,
 * attachments, dependencies and activity, one sheet each) or a PDF of the whole task under its project's badge.
 */
import type { PrismaClient } from '@prisma/client';
import { PDF_STANDARD, PdfDocument, hexToRgb, type GridPicture, type RGB, type TableColumn, type TextOptions } from '../../lib/pdf-document';
import { isolate, layoutText, lineBox, type StyledRun } from '../../lib/pdf-text';
import { printableAsStored, printableImage } from '../../lib/pdf-image';
import type { XlsxSheet } from '../../lib/xlsx-writer';
import { BRAND, formatDateTime, formatDay, printedLine, priorityLabel, wallClock } from '../../lib/export-format';
import { OVERDUE_TONES, PRIORITY_TONES, statusTones, type PriorityLevel } from '../../lib/colour-scheme';
import { resolveBrand } from '../email/brand';
import { dueDayKey, isOverdue } from '../../lib/due-date';
import { projectIconPaths, projectInitials } from '../projects/project-icons';
import { projectAudienceIds } from './prisma-assignee-repository';
import { buildTimeline } from '../activity/activity-feed';
import { mentionTokens } from './mentions';
import { recurrenceSummary } from './recurrence-summary';
import type { RecurrenceRule } from './recurrence';
import { isTaskDone } from './task-status';
import type { ExternalContactFields } from './external-contacts';

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
  /** The people outside the company responsible for it (all six fields), in order. */
  externalContacts: ExternalContactFields[];
  /**
   * Its checklist items in order. 1.23.3: each with its checklist's title (`list`), its level (`depth`, 0 =
   * top) and whether it is a real to-do item (`leaf`: no sub-items) — counts use those only.
   */
  checklist: TaskExportChecklistItem[];
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
  /** 1.23.1: the numbers of the tasks merged into it ("Merged from: MICO-14, MICO-15"). */
  mergedFrom?: string[];
}

export interface TaskExportContext {
  generatedAt: Date;
  timeZone: string;
  generatedBy?: string | null;
  /** Companies: the project's company name for the PDF's credit line (only while the site has 2+ companies). */
  companyName?: string | null;
  /** Companies: the project's company logo (printable) for the PDF's headers; null = the built-in logo. */
  logo?: Buffer | null;
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
    ...(t.mergedFrom?.length ? [['Merged from', t.mergedFrom.join(', ')] as [string, string]] : []),
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
    {
      name: 'External contacts',
      title,
      notes,
      columns: [{ header: 'Name' }, { header: 'Company' }, { header: 'Designation' }, { header: 'Email' }, { header: 'Phone' }, { header: 'Remarks', wrap: true }],
      rows: t.externalContacts.map((c) => [c.name, c.company ?? '', c.designation ?? '', c.email ?? '', c.phone ?? '', c.remarks ?? '']),
    },
    checklistSheet(t.checklist, title, notes),
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

const MUTED: RGB = [0.42, 0.4, 0.38];
const THREAD: RGB = [0.82, 0.8, 0.78];

/** The title's size (1.23.11): 15.5 pt while it takes at most two lines, else 14 pt, else 13 pt over as many lines as it needs. */
export function titleSize(title: string, width: number): number {
  const lines = (size: number) => layoutText(title, { size, bold: true, maxWidth: width }).length;
  return [PDF_STANDARD.type.title, 14].find((size) => lines(size) <= 2) ?? 13;
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

/** 1.23.11: the summary strip's status, priority and due colours — the site's one colour scheme. */
function statusColors(category: string) {
  return statusTones(category).light;
}
function priorityColors(priority: string) {
  return (PRIORITY_TONES[priority as PriorityLevel] ?? PRIORITY_TONES.NORMAL).light;
}

export function taskPdf(t: TaskExportData, ctx: TaskExportContext): Buffer {
  const tz = ctx.timeZone;
  const brand = hexToRgb(BRAND);
  // 1.23.11 footer (owner): the company — the project's on a site with 2+ companies, else the site's —
  // "Printed … by …" and the page number; the company's logo in the headers.
  const doc = new PdfDocument({
    title: `${t.key} · ${t.title}`,
    runningTitle: `${t.key} · ${t.projectName}`,
    footer: { company: ctx.companyName ?? resolveBrand().companyName, printed: printedLine(ctx.generatedAt, tz, ctx.generatedBy, isolate) },
    palette: { brand: BRAND },
    ...(ctx.logo ? { logo: ctx.logo } : {}),
  });
  const S = PDF_STANDARD.type;

  // Header: the project's badge (its picture, else its icon, else its initials, on its colour), name
  // and number, the company's logo; then the task's key just above its title.
  doc.identityHeader({
    image: t.projectImage ?? null, // shown when the PDF can print it (a see-through PNG set on white), as the minutes PDF does
    icon: projectIconPaths(t.projectIcon),
    initials: projectInitials(t.projectName),
    color: t.projectColor ? hexToRgb(t.projectColor, brand) : undefined,
    eyebrow: 'Task',
    title: t.projectName,
    subtitle: [t.projectCode, t.projectNumber ? `Project no. ${t.projectNumber}` : null].filter((s): s is string => Boolean(s)).map(isolate).join('  ·  '),
  });
  doc.documentTitle(t.title, { key: t.key, size: titleSize(t.title, doc.pageWidth - doc.margin * 2) });

  // One slim strip: status, priority, due and progress, each in the colour scheme's tones.
  const due = day(t.dueDate, tz);
  doc.statTiles([
    { label: 'Status', value: t.status, colors: statusColors(t.category) },
    { label: 'Priority', value: priorityLabel(t.priority), colors: priorityColors(t.priority) },
    { label: 'Due', value: due || '—', note: t.overdue ? 'Overdue' : undefined, ...(t.overdue ? { colors: OVERDUE_TONES.light } : { tone: 'muted' as const }) },
    { label: 'Progress', value: `${t.progress}%`, ...(t.progress >= 100 ? { colors: statusColors('DONE') } : { tone: 'brand' as const }) },
  ]);

  const none = (text: string) => doc.text(text, { size: S.small, color: MUTED, gap: 2 });
  // Each section heading is kept on the page with its note and the first thing under it (a
  // paragraph's first two lines, a picture row, a table's header and first rows), never left alone
  // at the bottom of a page; these measure them. A section under a third of a page is kept whole.
  const noteHeight = (text: string, gap = 3) => doc.textHeight(text, { size: S.small, gap });
  const opening = (text: string, size: number) => Math.min(doc.textHeight(text, { size }), lineBox(null, size).height * 2);

  // Details: everything the strip above doesn't show.
  const time = [t.estimatedHours != null ? `${hours(t.estimatedHours)} estimated` : '', t.actualHours != null ? `${hours(t.actualHours)} spent` : ''].filter(Boolean).join(' · ');
  const rows = (pairs: Array<[string, string]>) => pairs.filter(([, v]) => v !== '');
  doc.section(() => {
    doc.heading('Details', { topGap: 6, keepWith: 60 });
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
        ['Merged from', t.mergedFrom?.length ? t.mergedFrom.join(', ') : ''],
      ]),
    );
  });

  // 1.23.11: the optional sections below are left out when they have nothing in them (design call 1).

  // External contacts: the people outside the company responsible for it, each with every detail
  // given — name; company and designation; email and phone; remarks — kept on one page.
  const contactLines = (c: ExternalContactFields): Array<TextOptions & { text: string }> => {
    const role = [c.company, c.designation].filter((v): v is string => Boolean(v)).map(isolate).join(' · ');
    const reach = [c.email ? `Email ${c.email}` : null, c.phone ? `Phone ${c.phone}` : null].filter(Boolean).join(' · ');
    return [
      { text: c.name, bold: true, size: S.body },
      ...(role ? [{ text: role, size: S.data }] : []),
      ...(reach ? [{ text: reach, size: S.data, direction: 'ltr' as const }] : []),
      ...(c.remarks ? [{ text: c.remarks, size: S.small, color: MUTED }] : []),
    ];
  };
  const contactHeight = (c: ExternalContactFields) => contactLines(c).reduce((h, { text, ...l }) => h + doc.textHeight(text, l), 0) + 4;
  if (t.externalContacts.length) {
    doc.section(() => {
      doc.heading('External contacts', { keepWith: contactHeight(t.externalContacts[0]!) });
      for (const c of t.externalContacts) {
        doc.keepTogether(contactHeight(c));
        const lines = contactLines(c);
        lines.forEach(({ text, ...l }, i) => doc.text(text, { ...l, gap: i === lines.length - 1 ? 4 : 0 }));
      }
    });
  }

  // Description: each paragraph in its own direction.
  const description = t.description?.replace(/\r\n?/g, '\n').trim();
  const paragraphs = description ? description.split('\n') : [];
  if (paragraphs.length) {
    doc.section(() => {
      doc.heading('Description', { keepWith: opening(paragraphs[0]!, S.body) });
      for (const para of paragraphs) doc.text(para);
    });
  }

  // Checklist: drawn boxes, ticked when done; long items wrap in full. 1.23.3: the real to-do items are
  // counted (no parents), each checklist named with its own count, sub-items a step further in.
  if (t.checklist.length) {
    const leaves = t.checklist.filter(isLeaf);
    const checked = `${leaves.filter((c) => c.done).length} of ${leaves.length} done`;
    doc.section(() => {
      doc.heading('Checklist', { keepWith: noteHeight(checked) + opening(t.checklist[0]!.text, S.body), aside: checked });
      for (const group of checklistGroups(t.checklist)) {
        if (group.title !== null) doc.keepTogether(noteHeight(group.label) + opening(group.items[0]?.text ?? '', S.body)).text(group.label, { size: S.data, bold: true, gap: 1 });
        for (const c of group.items) doc.checkItem(c.text, c.done, { indent: Math.min(c.depth ?? 0, CHECKLIST_PDF_LEVELS) * 14 });
      }
    });
  }

  // Comments: each reply under the comment it answers, a step further in; @mentions in bold. A
  // comment's name line starts on the same page as its first lines.
  const commentStart = 28;
  if (t.comments.length) {
    doc.section(() => {
      doc.heading('Comments', { keepWith: commentStart });
      for (const { comment: c, depth } of commentThreads(t.comments)) {
        const inset = Math.min(depth, 3) * 16;
        const bar = depth > 0 ? THREAD : undefined;
        doc.keepTogether(commentStart);
        doc.text(`${isolate(c.author)} · ${formatDateTime(c.at, tz)}${c.edited ? ' · edited' : ''}`, { size: S.small, bold: true, color: MUTED, inset, bar, direction: 'ltr' });
        doc.styledText(commentRuns(c.body, t.mentionable), { inset, bar, gap: 4 });
      }
    });
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
  if (t.attachments.length) {
    const files = `${plural(t.attachments.length, 'file')}${shown.length ? ` · ${plural(shown.length, 'picture')} shown` : ''}`;
    const firstFiles = shown.length ? doc.imageGridFirstRowHeight(shown) : doc.tableHeight(fileCols, listed, { wide: 0, firstRows: 2 });
    doc.section(() => {
      doc.heading('Attachments', { keepWith: firstFiles, aside: files });
      doc.imageGrid(shown);
      if (listed.length) {
        if (shown.length) doc.subheading('Other files', { topGap: 2, keepWith: doc.tableHeight(fileCols, listed, { wide: 0, firstRows: 2 }) });
        doc.table(fileCols, listed, { wide: 0 });
      }
    });
  }

  // Dependencies: what this task waits for, and what waits for it. The title comes last and takes
  // the spare width, so an Arabic title ends at the page's edge.
  const linkCols: TableColumn[] = [{ header: 'Task' }, { header: 'Status' }, { header: 'Title' }];
  const sides = [
    { label: 'Blocked by', rows: t.blockedBy.map((d) => [d.key, d.status, d.title]), empty: 'Nothing blocks this task.' },
    { label: 'Blocks', rows: t.blocks.map((d) => [d.key, d.status, d.title]), empty: 'No other task waits for this one.' },
  ].map((s) => ({ ...s, keep: { topGap: 2, keepWith: s.rows.length ? doc.tableHeight(linkCols, s.rows, { wide: 2, firstRows: 2 }) : 16 } }));
  if (sides.some((s) => s.rows.length > 0)) {
    doc.section(() => {
      doc.heading('Dependencies', { keepWith: doc.subheadingRoom(sides[0]!.keep) });
      for (const side of sides) {
        doc.subheading(side.label, side.keep);
        if (side.rows.length) doc.table(linkCols, side.rows, { wide: 2 });
        else none(side.empty);
      }
    });
  }

  // Activity: the latest changes, newest first.
  const latest = [...t.activity].reverse().sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, MAX_ACTIVITY);
  const changeCols: TableColumn[] = [{ header: 'When' }, { header: 'Who' }, { header: 'What' }];
  const changes = latest.map((a) => [formatDateTime(a.at, tz), a.who, describeActivity(a.action, a.meta)]);
  if (changes.length) {
    const earlier = Math.max(t.activityTotal ?? 0, t.activity.length) - latest.length;
    doc.section(() => {
      doc.heading('Activity', { keepWith: doc.tableHeight(changeCols, changes, { wide: 2, firstRows: 2 }), aside: 'Newest first' });
      doc.table(changeCols, changes, { wide: 2 });
      if (earlier > 0) doc.spacer(3).text(`${plural(earlier, 'earlier change')} not shown`, { size: S.small, color: MUTED });
    });
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
          // 1.23.3: the live checklists and items, arranged (titles, levels, the real to-do items).
          checklistLists: { where: { deletedAt: null } },
          checklist: { where: { deletedAt: null } },
          externalContacts: { orderBy: { position: 'asc' }, select: { name: true, company: true, designation: true, email: true, phone: true, remarks: true } },
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
      const merged = await prisma.task.findMany({ where: { mergedIntoId: t.id }, select: { key: true }, orderBy: [{ mergedAt: 'asc' }, { key: 'asc' }] });
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
        // Never while it waits for approval (owner, 30 Oct).
        overdue: !done && !t.approvalRequestedAt && isOverdue(t.dueDate, timeZone, now()),
        isMilestone: t.isMilestone,
        meeting: t.meeting && !t.meeting.deletedAt ? { id: t.meeting.id, title: t.meeting.title, startAt: t.meeting.startAt } : null,
        externalContacts: t.externalContacts,
        checklist: exportChecklist(t.checklistLists as ListRow[], t.checklist as ItemRow[]),
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
        ...(merged.length ? { mergedFrom: merged.map((m) => m.key) } : {}),
      };
    },
  };
}

/** 1.23.3: one checklist item as the export reads it. */
export interface TaskExportChecklistItem {
  text: string;
  done: boolean;
  /** Its checklist's title (absent: one untitled list, as before 1.23.3). */
  list?: string;
  /** Its checklist (two checklists may share a title). */
  listId?: string;
  /** 0 = top level. */
  depth?: number;
  /** A real to-do item (no sub-items); absent = yes. */
  leaf?: boolean;
}

/** Levels the PDF steps in (deeper items keep the last step, as on the website). */
const CHECKLIST_PDF_LEVELS = 6;
const isLeaf = (c: TaskExportChecklistItem) => c.leaf !== false;

/** The items grouped by checklist, in order, each with its "Electrical · 5/8" label. */
function checklistGroups(items: TaskExportChecklistItem[]): { title: string | null; label: string; items: TaskExportChecklistItem[] }[] {
  const groups: { title: string | null; label: string; items: TaskExportChecklistItem[] }[] = [];
  let lastKey: string | null | undefined;
  for (const c of items) {
    const title = c.list ?? null;
    const key = c.listId ?? title;
    const last = groups[groups.length - 1];
    if (last && key === lastKey) last.items.push(c);
    else groups.push({ title, label: '', items: [c] });
    lastKey = key;
  }
  for (const g of groups) {
    const leaves = g.items.filter(isLeaf);
    g.label = `${g.title ?? 'Checklist'} · ${leaves.filter((c) => c.done).length}/${leaves.length}`;
  }
  return groups;
}

/** The workbook's Checklist sheet: each item with its checklist (and its count), sub-items indented. */
function checklistSheet(items: TaskExportChecklistItem[], title: string, notes: string[]) {
  const nested = items.some((c) => c.list !== undefined);
  if (!nested) return { name: 'Checklist', title, notes, columns: [{ header: 'Done' }, { header: 'Item', wrap: true }], rows: items.map((c) => [c.done ? 'Done' : '', c.text]) };
  const rows = checklistGroups(items).flatMap((g) => g.items.map((c) => [g.label, c.done ? 'Done' : '', `${'\u00a0'.repeat(4 * Math.min(c.depth ?? 0, CHECKLIST_PDF_LEVELS))}${c.text}`]));
  return { name: 'Checklist', title, notes, columns: [{ header: 'Checklist' }, { header: 'Done' }, { header: 'Item', wrap: true }], rows };
}

/** A task's live checklists as the export lists them (in order, with titles, levels and leaves). */
export function exportChecklist(lists: ListRow[], items: ItemRow[]): TaskExportChecklistItem[] {
  const a = arrange(lists, items);
  const titles = new Map(a.lists.map((l) => [l.id, l.title]));
  return a.items.map((i) => ({ text: i.text, done: i.done, list: titles.get(i.listId) ?? 'Checklist', listId: i.listId, depth: i.depth, leaf: i.childCount === 0 }));
}
