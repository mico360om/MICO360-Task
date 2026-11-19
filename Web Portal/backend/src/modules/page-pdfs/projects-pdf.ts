/**
 * Projects as a PDF: the cards the page shows, in its order (its tab, search, owner, client and sort
 * applied by the page), three to a row — each project's colour and code, its name and number, its health
 * mark, status, progress, the person accountable for it, its target, and its open and overdue tasks.
 */
import { HEALTH_TONES, OVERDUE_TONES } from '../../lib/colour-scheme';
import { dueDayKey } from '../../lib/due-date';
import { BRAND, INK, LINE, MUTED, PROJECT_STATUS_WORD, SOFT, TYPE, colourOr, note, pagePdf, plural, shortDay, type PdfMeta } from './page-pdf-kit';

type Rag = 'RED' | 'AMBER' | 'GREEN';

export interface ProjectOverviewWire {
  id: string;
  code: string;
  number?: string | null;
  name: string;
  clientName?: string | null;
  status: string;
  color?: string | null;
  targetDate?: string | null;
  stats: { total: number; done: number; open: number; overdue: number; nextDue: string | null };
  owner: { id: string; name: string } | null;
  teamCount?: number;
  health?: { rag: Rag; completion: { mode: 'COUNT' | 'WEIGHT'; pct: number }; accountable: { name: string; role: 'MANAGER' | 'OWNER' } | null } | null;
}

const RAG: Record<Rag, { word: string; tone: { fill: string; soft: string; text: string } }> = {
  GREEN: { word: '• Green', tone: HEALTH_TONES.ON_TRACK.light },
  AMBER: { word: '• Amber', tone: HEALTH_TONES.AT_RISK.light },
  RED: { word: '• Red', tone: HEALTH_TONES.LATE.light },
};
const TABS: Record<string, string> = { all: 'All', active: 'Active', planning: 'Planning', 'on-hold': 'On hold', completed: 'Completed', archived: 'Archived' };
const finished = (s: string) => s === 'COMPLETED' || s === 'ARCHIVED';
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);

/** The card's progress (lib/project-list.ts progressOf, or the health's own mode when it counts by weight). */
function progress(p: ProjectOverviewWire): { pct: number; text: string } {
  if (p.health?.completion.mode === 'WEIGHT') return { pct: p.health.completion.pct, text: `${p.health.completion.pct}% done by weight` };
  const s = p.stats;
  if (!s.total) return { pct: 0, text: 'No tasks yet' };
  const pct = s.done >= s.total ? 100 : Math.min(99, Math.round((s.done / s.total) * 100));
  return { pct, text: `${pct}% done · ${s.done} of ${plural(s.total, 'task')}` };
}

/** "Target 30 Nov · 38 days", "Target passed 3 days ago" (lib/project-list.ts targetLabel). */
function target(p: ProjectOverviewWire, today: string, timeZone: string): { text: string; late: boolean } {
  const key = dueDayKey(p.targetDate ?? null, timeZone);
  if (!key) return { text: 'No target date', late: false };
  if (finished(p.status)) return { text: `Target ${shortDay(key, today)}`, late: false };
  const days = daysBetween(today, key);
  if (days === 0) return { text: 'Target today', late: false };
  if (days === -1) return { text: 'Target passed yesterday', late: true };
  if (days < 0) return { text: `Target passed ${-days} days ago`, late: true };
  return { text: `Target ${shortDay(key, today)} · ${plural(days, 'day')}`, late: false };
}

export function buildProjectsPdf(list: ProjectOverviewWire[], opts: { ids: string[]; tab: string; filters: string[]; today: string; timeZone: string }, meta: PdfMeta): Buffer {
  // The page's cards, in its order: only those the overview holds for this person.
  const byId = new Map(list.map((p) => [p.id, p]));
  const shown = [...new Set(opts.ids)].map((id) => byId.get(id)).filter((p): p is ProjectOverviewWire => !!p);
  const doc = pagePdf('Projects', meta, { subtitle: `${TABS[opts.tab] ?? 'All'} · ${plural(shown.length, 'project')}`, filters: opts.filters });
  if (shown.length === 0) {
    note(doc, 'No projects match these filters.');
    return doc.build();
  }
  const perRow = 3;
  const gap = 8;
  const cardH = 96;
  for (let i = 0; i < shown.length; i += perRow) {
    const row = shown.slice(i, i + perRow);
    doc.canvas(cardH + gap, (p) => {
      const w = (p.width - gap * (perRow - 1)) / perRow;
      row.forEach((proj, k) => {
        const x = k * (w + gap);
        const colour = colourOr(proj.color, BRAND);
        p.rect(x, 0, w, cardH, '#FFFFFF', { radius: 6, stroke: LINE });
        p.rect(x + 8, 8, 24, 24, colour, { radius: 5 });
        p.text(x + 8, 14, proj.code.slice(0, 4), { size: TYPE.label, bold: true, color: '#FFFFFF', maxWidth: 24, align: 'center', minSize: TYPE.min });
        const rag = proj.health?.rag ? RAG[proj.health.rag] : null;
        const badgeW = rag ? p.measure(rag.word, TYPE.label, true) + 12 : 0;
        p.text(x + 38, 7, proj.name, { size: TYPE.small, bold: true, maxWidth: w - 46 - badgeW });
        const sub = [proj.code, proj.number ? `No. ${proj.number}` : '', proj.clientName ?? ''].filter(Boolean).join(' · ');
        p.text(x + 38, 19, sub, { size: TYPE.label, color: MUTED, maxWidth: w - 46 });
        if (rag) {
          p.rect(x + w - 8 - badgeW, 7, badgeW, 11, rag.tone.soft, { radius: 5.5 });
          p.text(x + w - 8 - badgeW, 8, rag.word, { size: TYPE.label, bold: true, color: rag.tone.text, maxWidth: badgeW, align: 'center' });
        }
        const prog = progress(proj);
        p.rect(x + 8, 40, w - 16, 4, SOFT, { radius: 2 });
        p.rect(x + 8, 40, ((w - 16) * prog.pct) / 100, 4, rag ? rag.tone.fill : colour, { radius: 2 });
        p.text(x + 8, 46, prog.text, { size: TYPE.label, color: INK, maxWidth: (w - 16) * 0.62 });
        p.text(x + 8 + (w - 16) * 0.62, 46, PROJECT_STATUS_WORD[proj.status] ?? proj.status, { size: TYPE.label, bold: true, color: MUTED, maxWidth: (w - 16) * 0.38, align: 'right' });
        const who = proj.health?.accountable ? `${proj.health.accountable.role === 'MANAGER' ? 'Manager' : 'Owner'}: ${proj.health.accountable.name}` : proj.owner ? `Owner: ${proj.owner.name}` : 'No owner';
        p.text(x + 8, 60, who, { size: TYPE.label, color: INK, maxWidth: w - 16 });
        const t = target(proj, opts.today, opts.timeZone);
        p.text(x + 8, 71, t.text, { size: TYPE.label, color: t.late ? OVERDUE_TONES.light.text : MUTED, bold: t.late, maxWidth: w - 16 });
        p.line(x + 8, 83, x + w - 8, 83, '#EEEBE8');
        p.text(x + 8, 85, `${proj.stats.open} open`, { size: TYPE.label, color: INK, maxWidth: (w - 16) / 2 });
        p.text(x + 8 + (w - 16) / 2, 85, `${proj.stats.overdue} overdue`, { size: TYPE.label, bold: proj.stats.overdue > 0, color: proj.stats.overdue ? OVERDUE_TONES.light.text : MUTED, maxWidth: (w - 16) / 2, align: 'right' });
      });
    });
  }
  return doc.build();
}
