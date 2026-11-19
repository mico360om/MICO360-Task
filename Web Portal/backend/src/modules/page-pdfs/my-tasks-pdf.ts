/**
 * My Tasks as a PDF: the list as on the page — its groups (today's list, then Upcoming), its filters and
 * sort applied by the page — one row per task: number, title, project, status, priority, due date and
 * checklist progress, the status, priority and an overdue date in their colours.
 */
import type { TableColumn } from '../../lib/pdf-document';
import { formatDay } from '../../lib/export-format';
import { HEALTH_TONES, OVERDUE_TONES } from '../../lib/colour-scheme';
import { PRIORITY_WORD, STATUS_WORD, hexRgb, note, pagePdf, plainLine, plural, priorityTone, statusTone, type PdfMeta } from './page-pdf-kit';
import { checklistWords, dueKeyOf, isDone, isOverdue, type ProjectRef, type TaskWire } from './task-wire';

export interface MyTasksGroupAsk {
  label: string;
  ids: string[];
}

export function buildMyTasksPdf(tasks: TaskWire[], groups: MyTasksGroupAsk[], opts: { projects: Map<string, ProjectRef>; filters: string[]; today: string; timeZone: string }, meta: PdfMeta): Buffer {
  // Only the tasks My Tasks holds for this person, each once, in the page's order.
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const used = new Set<string>();
  const shown = groups
    .map((g) => ({
      label: plainLine(g.label, 80) || 'Tasks',
      rows: g.ids.filter((id) => !used.has(id) && byId.has(id) && used.add(id)).map((id) => byId.get(id)!),
    }))
    .filter((g) => g.rows.length > 0);
  const total = shown.reduce((n, g) => n + g.rows.length, 0);
  const doc = pagePdf('My Tasks', meta, { subtitle: plural(total, 'task'), filters: opts.filters });
  if (total === 0) {
    note(doc, 'No tasks match these filters.');
    return doc.build();
  }
  const columns: TableColumn[] = [
    { header: 'Number', nowrap: true },
    { header: 'Title' },
    { header: 'Project' },
    { header: 'Status', nowrap: true },
    { header: 'Priority', nowrap: true },
    { header: 'Due', align: 'center', nowrap: true },
    { header: 'Checklist', align: 'center', nowrap: true },
  ];
  for (const g of shown) {
    const rows = g.rows.map((t) => {
      const due = dueKeyOf(t.dueDate, opts.timeZone);
      const cat = isDone(t) ? 'DONE' : (t.columnCategory ?? 'TODO');
      return [
        t.key,
        t.title,
        opts.projects.get(t.projectId)?.name ?? '—',
        `${STATUS_WORD[cat] ?? cat}${t.approvalRequestedAt && !isDone(t) ? ' · waiting for approval' : ''}`,
        PRIORITY_WORD[t.priority] ?? t.priority,
        due ? `${formatDay(due, { year: due.slice(0, 4) !== opts.today.slice(0, 4) })}${isOverdue(t, opts.today, opts.timeZone) ? ' · Overdue' : due === opts.today ? ' · Today' : ''}` : '—',
        checklistWords(t) || '—',
      ];
    });
    doc.heading(`${g.label} · ${g.rows.length}`, { topGap: 6, keepWith: doc.tableHeight(columns, rows, { firstRows: 2 }) });
    doc.table(columns, rows, {
      wide: 1,
      cellColor: (r, c) => {
        const t = g.rows[r]!;
        if (c === 3) return hexRgb(isDone(t) ? HEALTH_TONES.ON_TRACK.light.text : statusTone(t.columnCategory).text);
        if (c === 4) return hexRgb(priorityTone(t.priority).text);
        if (c === 5 && isOverdue(t, opts.today, opts.timeZone)) return hexRgb(OVERDUE_TONES.light.text);
        return null;
      },
      cellBold: (r, c) => c === 5 && isOverdue(g.rows[r]!, opts.today, opts.timeZone),
    });
  }
  return doc.build();
}
