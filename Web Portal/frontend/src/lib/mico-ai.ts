/**
 * MICO AI on the page: the answer's small Markdown subset (paragraphs, "- " bullets, **bold**) as
 * plain text runs — never HTML, so nothing in an answer can become markup — table cells in the
 * app's own wording, the chat list's day groups, what Copy puts on the clipboard, and the
 * questions a new chat suggests.
 */
import type { CellKind, CellValue, MicoAiChat, MicoAiMessage } from '../api/mico-ai';
import { shiftDayKey, todayKey, zonedDayKey } from './due-date';

export interface Run {
  text: string;
  bold: boolean;
}
export type Block = { kind: 'p'; lines: Run[][] } | { kind: 'ul'; items: Run[][] };

/** "**bold**" pairs on one line become bold runs; anything else, HTML included, stays text. */
function runs(line: string): Run[] {
  const out: Run[] = [];
  const re = /\*\*([^*]+?)\*\*/g;
  let at = 0;
  for (let m = re.exec(line); m; m = re.exec(line)) {
    if (m.index > at) out.push({ text: line.slice(at, m.index), bold: false });
    out.push({ text: m[1]!, bold: true });
    at = m.index + m[0].length;
  }
  if (at < line.length) out.push({ text: line.slice(at), bold: false });
  return out;
}

const BULLET = /^\s*(?:[-*•])\s+(.*)$/;

export function answerBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trimEnd();
    const last = blocks[blocks.length - 1];
    if (!line.trim()) {
      blocks.push({ kind: 'p', lines: [] }); // a paragraph break
      continue;
    }
    const item = BULLET.exec(line);
    if (item) {
      if (last?.kind === 'ul') last.items.push(runs(item[1]!.trim()));
      else blocks.push({ kind: 'ul', items: [runs(item[1]!.trim())] });
    } else if (last?.kind === 'p') last.lines.push(runs(line.trim())); // the same paragraph, on a new line
    else blocks.push({ kind: 'p', lines: [runs(line.trim())] });
  }
  return blocks.filter((b) => (b.kind === 'p' ? b.lines.length > 0 : b.items.length > 0));
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** 'YYYY-MM-DD' → 'Mon 19 Oct' (a calendar day, never shifted). */
function dayLabel(key: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(key);
  if (!m) return key;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return `${DAYS[d.getUTCDay()]} ${Number(m[3])} ${MONTHS[Number(m[2]) - 1]}`;
}

/** A table cell as the page shows it. */
export function cellDisplay(kind: CellKind | undefined, v: CellValue): string {
  if (v === null || v === undefined || v === '') return '';
  switch (kind) {
    case 'date':
      return dayLabel(String(v));
    case 'datetime': {
      const s = String(v);
      return s.length > 10 ? `${dayLabel(s.slice(0, 10))}, ${s.slice(11, 16)}` : dayLabel(s);
    }
    case 'days':
      return `${v} ${Number(v) === 1 ? 'day' : 'days'}`;
    case 'percent':
      return `${v}%`;
    default:
      return String(v);
  }
}

export const chatTitle = (c: Pick<MicoAiChat, 'title'>): string => c.title.trim() || 'New chat';

export interface ChatGroup {
  label: 'Today' | 'Yesterday' | 'Previous 7 days' | 'Older';
  chats: MicoAiChat[];
}

/** The chat list's groups, by each chat's last message in the person's time zone (newest first). */
export function chatGroups(chats: MicoAiChat[], now: Date, timeZone: string): ChatGroup[] {
  const today = todayKey(timeZone, now);
  const yesterday = shiftDayKey(today, -1);
  const weekAgo = shiftDayKey(today, -7);
  const groups: ChatGroup[] = [
    { label: 'Today', chats: [] },
    { label: 'Yesterday', chats: [] },
    { label: 'Previous 7 days', chats: [] },
    { label: 'Older', chats: [] },
  ];
  const sorted = [...chats].sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt));
  for (const c of sorted) {
    const day = zonedDayKey(new Date(c.lastMessageAt), timeZone);
    const g = day >= today ? 0 : day === yesterday ? 1 : day >= weekAgo ? 2 : 3;
    groups[g]!.chats.push(c);
  }
  return groups.filter((g) => g.chats.length > 0);
}

const plain = (r: Run[]) => r.map((x) => x.text).join('');

/** What Copy puts on the clipboard: the answer's words, its tables (tab-separated) and its sources. */
export function copyTextOf(m: MicoAiMessage): string {
  const words = answerBlocks(m.text)
    .map((b) => (b.kind === 'p' ? b.lines.map(plain).join('\n') : b.items.map((i) => `• ${plain(i)}`).join('\n')))
    .join('\n');
  const parts = [words];
  for (const t of m.answer?.tables ?? []) {
    const head = t.columns.map((c) => c.label).join('\t');
    const rows = t.rows.map((r) => r.cells.map((v, i) => cellDisplay(t.columns[i]?.kind, v)).join('\t'));
    parts.push([t.title, head, ...rows].join('\n'));
  }
  if (m.answer?.sources.length) parts.push(`Sources: ${m.answer.sources.map((s) => s.label).join(', ')}`);
  return parts.filter(Boolean).join('\n\n');
}

/** What a new chat suggests asking; the last one names one of the person's projects when there is one. */
export function suggestedQuestions(projectName: string | null): string[] {
  return [
    'Which of my tasks are overdue?',
    'Summarize this week’s meetings',
    'Workload report for my team this week',
    projectName ? `What changed in ${projectName} yesterday?` : 'Which projects need attention?',
  ];
}
