/**
 * Kanban Board as a PDF (a project's board, or All projects): the columns side by side, five to a page's
 * width (more columns on the next page), each card with its number, title, assignees, due date and its
 * priority's colour — the page's day or month, its filters and search applied by the page, hidden columns
 * left out. A long column flows onto more pages one card row at a time, so no card is cut.
 */
import { formatDay } from '../../lib/export-format';
import { OVERDUE_TONES } from '../../lib/colour-scheme';
import { BRAND, INK, LINE, MUTED, SOFT, STATUS_WORD, TYPE, colourOr, note, pagePdf, plural, priorityTone, shortDay, statusTone, type PdfMeta } from './page-pdf-kit';
import { assigneeWords, checklistWords, dueKeyOf, isOverdue, type ProjectRef, type TaskWire } from './task-wire';

export interface ColumnWire {
  id: string;
  name: string;
  category: string;
  position: number;
  color: string;
  enabled: boolean;
}
export interface BoardColumnAsk {
  id: string;
  keys: string[];
}

const STATUS_COLUMN = 'status:';
const STATUSES = ['BACKLOG', 'TODO', 'IN_PROGRESS', 'BLOCKED', 'REVIEW', 'DONE'];
const PER_PAGE = 5;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

interface Column {
  name: string;
  colour: string;
  cards: TaskWire[];
}

export function buildBoardPdf(
  tasks: TaskWire[],
  columns: ColumnWire[] | null,
  asked: BoardColumnAsk[],
  opts: { project: ProjectRef | null; projects: Map<string, ProjectRef>; date: string | null; month: string | null; filters: string[]; today: string; timeZone: string },
  meta: PdfMeta,
): Buffer {
  // The cards the board's own answer holds for this person, by their number.
  const byKey = new Map(tasks.map((t) => [t.key, t]));
  const used = new Set<string>();
  const shown: Column[] = [];
  for (const a of asked) {
    let name: string;
    let colour: string;
    if (columns) {
      const c = columns.find((x) => x.id === a.id);
      if (!c || c.enabled === false) continue; // a hidden column is left out, as on the page
      name = c.name;
      colour = colourOr(c.color, statusTone(c.category).fill);
    } else {
      const status = a.id.startsWith(STATUS_COLUMN) ? a.id.slice(STATUS_COLUMN.length) : '';
      if (!STATUSES.includes(status)) continue;
      name = STATUS_WORD[status]!;
      colour = statusTone(status).fill;
    }
    const cards: TaskWire[] = [];
    for (const key of a.keys) {
      const t = byKey.get(key);
      if (!t || used.has(key) || t.columnHidden) continue;
      if (columns && t.columnId !== a.id) continue; // a card sits only in its own column
      if (!columns && (t.columnCategory ?? 'TODO') !== a.id.slice(STATUS_COLUMN.length)) continue;
      used.add(key);
      cards.push(t);
    }
    shown.push({ name, colour, cards });
  }

  const when = opts.month ? `${MONTHS[Number(opts.month.slice(5)) - 1]} ${opts.month.slice(0, 4)}` : opts.date ? formatDay(opts.date, { weekday: true }) : formatDay(opts.today, { weekday: true });
  const where = opts.project ? `${opts.project.name} (${opts.project.code})` : 'All projects';
  const cardsTotal = shown.reduce((n, c) => n + c.cards.length, 0);
  const doc = pagePdf('Kanban Board', meta, { subtitle: `${where} · ${when}`, filters: [...opts.filters, `${plural(shown.length, 'column')} · ${plural(cardsTotal, 'card')}`] });
  if (shown.length === 0) {
    note(doc, 'No columns to show.');
    return doc.build();
  }

  const gap = 8;
  const cardH = 52;
  const all = !opts.project;
  for (let band = 0; band < shown.length; band += PER_PAGE) {
    const cols = shown.slice(band, band + PER_PAGE);
    if (band > 0) doc.pageBreak();
    const head = () =>
      doc.canvas(24, (p) => {
        const w = (p.width - gap * (PER_PAGE - 1)) / PER_PAGE;
        cols.forEach((c, i) => {
          const x = i * (w + gap);
          p.rect(x, 0, w, 20, SOFT, { radius: 4 });
          p.rect(x, 0, w, 2.5, c.colour);
          p.text(x + 6, 6, c.name, { size: TYPE.small, bold: true, maxWidth: w - 34 });
          p.text(x + w - 28, 6, String(c.cards.length), { size: TYPE.small, bold: true, color: MUTED, maxWidth: 22, align: 'right' });
        });
      });
    head();
    const rows = Math.max(1, ...cols.map((c) => c.cards.length));
    for (let r = 0; r < rows; r++) {
      doc.canvas(
        cardH + 5,
        (p) => {
          const w = (p.width - gap * (PER_PAGE - 1)) / PER_PAGE;
          cols.forEach((c, i) => {
            const x = i * (w + gap);
            const t = c.cards[r];
            if (!t) {
              if (r === 0) p.text(x + 6, 8, 'No cards', { size: TYPE.label, color: MUTED, maxWidth: w - 12 });
              return;
            }
            const late = isOverdue(t, opts.today, opts.timeZone);
            p.rect(x, 0, w, cardH, '#FFFFFF', { radius: 4, stroke: LINE });
            p.rect(x, 0, 3, cardH, priorityTone(t.priority).fill);
            const project = all ? opts.projects.get(t.projectId) : null;
            p.text(x + 7, 3, project ? `${t.key} · ${project.name}` : t.key, { size: TYPE.label, bold: true, color: BRAND, maxWidth: w - 12 });
            p.lines(x + 7, 13, t.title, { size: TYPE.label, maxWidth: w - 12, maxLines: 2 });
            const due = dueKeyOf(t.dueDate, opts.timeZone);
            const list = checklistWords(t);
            p.text(x + 7, 39, assigneeWords(t, 1), { size: TYPE.label, color: MUTED, maxWidth: (w - 14) * 0.5 });
            const right = [list, due ? shortDay(due, opts.today) : ''].filter(Boolean).join(' · ');
            if (right) p.text(x + 7 + (w - 14) * 0.5, 39, right, { size: TYPE.label, bold: late, color: late ? OVERDUE_TONES.light.text : INK, maxWidth: (w - 14) * 0.5, align: 'right' });
          });
        },
        { onNewPage: head },
      );
    }
  }
  doc.spacer(4);
  note(doc, 'Each card’s left edge is its priority’s colour (red urgent, orange high, slate normal, grey low); “2/5” is its checklist; a red date is overdue.');
  return doc.build();
}
