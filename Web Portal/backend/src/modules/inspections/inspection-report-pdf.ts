import { PdfDocument, hexToRgb, type GridPicture, type RGB, type TableColumn } from '../../lib/pdf-document';
import { isolate, textDirection } from '../../lib/pdf-text';
import { formatDateTime, formatDay, slugPart } from '../../lib/export-format';
import { projectIconPaths, projectInitials } from '../projects/project-icons';
import type { MinutesBrand } from '../meetings/minutes';
import type { ClientInspection, ClientInspectionItem } from './inspection-client-copy';

/**
 * A finished inspection as a branded PDF: the project's header, the form's title, when and where,
 * a summary of the counts, the failed items first, then every section with each item's result,
 * reading and limits, and note, and the signatures.
 *
 * The same builder makes both copies. The checklist and signatures come from the client copy
 * (`report`, an allow-list: see inspection-client-copy), so the client's PDF can only print what
 * that copy holds; the staff copy adds `staff` — the inspector's account name, the times, the
 * attached task, each item's follow-up task — and who made the PDF. Without `staff`, none of that
 * is printed, and the footer says the report was shared, not who made it.
 *
 * Failed items stand out by more than colour: they are listed on their own near the top, and in
 * the checklist their result reads FAIL, in capitals and bold (and red).
 */
export interface InspectionReportData {
  brand: Pick<MinutesBrand, 'productName' | 'companyName' | 'websiteUrl' | 'supportEmail' | 'companyAddress' | 'colors'>;
  project: {
    name: string;
    code: string | null;
    number: string | null;
    clientName: string | null;
    color: string | null;
    icon: string | null;
    /** The project's picture (bytes as stored), printed when the PDF can take it. */
    image: Buffer | null;
  };
  report: ClientInspection;
  /** The staff copy's extras; absent for the client's copy. */
  staff?: {
    /** The inspector's account name. */
    inspector: string;
    startedAt: string;
    finishedAt: string | null;
    /** The attached task ("RIG-12 · Inspect rig 3"). */
    task: string | null;
    /** Per section, per item: its follow-up task's key. */
    followUps: Array<Array<string | null>>;
  };
  /** Signatures the form asks for that were not given ('Client'): printed as "Not signed". */
  unsigned?: string[];
  timeZone: string;
  generatedAt: string;
  /** Who made the PDF (the staff copy only). */
  generatedBy?: string | null;
}

const INK: RGB = [0.11, 0.1, 0.09];
const MUTED: RGB = [0.42, 0.4, 0.38];
const DANGER: RGB = [0.72, 0.16, 0.16];
const SUCCESS: RGB = [0.18, 0.49, 0.33];
const TYPE = { body: 10, heading: 12, note: 8.5, table: 9, tableMin: 7 } as const;
const MAX_SLUG = 60;
/** A note longer than this is cut short in its table cell and printed in full under its section's table. */
const CELL_NOTE_MAX = 280;
/** The failed list shows this much of a note (the checklist has all of it). */
const LIST_NOTE_MAX = 140;
/** Signatures in this order (the client copy’s role words). */
const ROLE_ORDER = ['Inspector', 'Client', 'Supervisor'];

/** The start of a long note, cut at a word, with where the rest is. */
function shortNote(note: string, max: number, rest: string): string {
  if (note.length <= max) return note;
  const cut = note.slice(0, max);
  const at = cut.lastIndexOf(' ');
  return `${(at > max * 0.6 ? cut.slice(0, at) : cut).trimEnd()}… (${rest})`;
}

/** "inspection-rig-daily-check-2026-10-27.pdf" (a title with no Latin letters is left out). */
export function inspectionPdfFileName(title: string, dayKey: string): string {
  const slug = slugPart(title).slice(0, MAX_SLUG).replace(/-+$/g, '');
  return `inspection-${slug ? `${slug}-` : ''}${dayKey}.pdf`;
}

function decodeDataUrl(url: string | null): Buffer | null {
  if (!url) return null;
  const m = /^data:image\/(?:png|jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(url);
  return m ? Buffer.from(m[1]!, 'base64') : null;
}

const resultCell = (result: string | null) => (result === 'Fail' ? 'FAIL' : result ?? '—');

/** A reading with what is allowed under it ("162.5 psi" / "allowed 0–150 psi"). */
function readingCell(item: ClientInspectionItem): string {
  if (item.kind !== 'READING') return '';
  const value = item.reading ?? (item.result === 'N/A' ? 'Not taken' : '—');
  return item.limits ? `${value}\nallowed ${item.limits}` : value;
}

export function buildInspectionPdf(d: InspectionReportData): Buffer {
  const { brand, project, report: r, staff } = d;
  const tz = d.timeZone;
  const when = (iso: string | null) => (iso ? formatDateTime(new Date(iso), tz) : '—');
  const companyLine = [brand.companyName, brand.websiteUrl, brand.supportEmail].filter((b): b is string => Boolean(b)).map(isolate).join('  ·  ');
  const footer = staff
    ? [companyLine, `${isolate(brand.productName)} · Inspection report · Generated ${when(d.generatedAt)} (${tz})${d.generatedBy ? ` by ${isolate(d.generatedBy)}` : ''}`]
    : [companyLine, brand.companyAddress ?? '', `Shared with you through ${isolate(brand.productName)}`];

  const doc = new PdfDocument({
    title: `Inspection report: ${r.title}`,
    runningTitle: `${r.title} · ${project.name}`,
    palette: { brand: brand.colors?.brand, ink: brand.colors?.ink, muted: brand.colors?.muted, line: brand.colors?.line },
    footerLeft: footer.filter(Boolean).join('\n'),
  });
  const brandRgb = hexToRgb(brand.colors?.brand ?? '#8B1E1E');

  // ── The project's header, the form's title, when and where ─────────────────────────────────
  const failed = r.counts.failed;
  const allNa = failed === 0 && r.counts.passed === 0 && r.counts.na > 0;
  doc.identityHeader({
    image: project.image,
    icon: projectIconPaths(project.icon),
    initials: projectInitials(project.name),
    color: project.color ? hexToRgb(project.color, brandRgb) : undefined,
    eyebrow: 'Inspection report',
    title: project.name,
    subtitle: [project.code, project.number ? `Project no. ${project.number}` : null, project.clientName].filter((b): b is string => Boolean(b)).map(isolate).join('  ·  ') || undefined,
    badge: { text: r.result, tone: failed > 0 ? 'warning' : allNa ? 'muted' : 'success' },
  });
  doc.text(r.title, { bold: true, size: 20, color: INK, gap: 6, family: 'display', direction: textDirection(r.title) });
  const left: Array<[string, string]> = [['Date', formatDay(r.date)]];
  if (r.place) left.push(['Place', r.place]);
  const right: Array<[string, string]> = staff
    ? [
        ['Inspector', staff.inspector],
        ['Started', when(staff.startedAt)],
        ['Finished', when(staff.finishedAt)],
        ...(staff.task ? ([['For task', staff.task]] as Array<[string, string]>) : []),
      ]
    : [['Items checked', String(r.counts.total)]];
  doc.keyValueColumns(left, right, { size: 9.5 });

  // ── Summary ─────────────────────────────────────────────────────────────────────────────────
  doc.spacer(10);
  doc.statTiles([
    { label: 'Passed', value: String(r.counts.passed), tone: 'success' },
    { label: 'Failed', value: String(failed), tone: failed > 0 ? 'danger' : 'muted' },
    { label: 'N/A', value: String(r.counts.na), tone: 'muted' },
    { label: 'Items', value: String(r.counts.total), tone: 'brand' },
  ]);
  if (failed > 0) doc.statusStrip(`${failed} ${failed === 1 ? 'ITEM' : 'ITEMS'} FAILED · listed below, and marked FAIL in the checklist`, 'warning');
  else if (allNa) doc.statusStrip('ALL ITEMS N/A · nothing was checked', 'muted');
  else doc.statusStrip('PASSED · every item passed or was N/A', 'success');

  // Items are numbered through the report, so the failed list points into the checklist.
  let n = 0;
  const numbered = r.sections.map((s, si) => ({ ...s, rows: s.items.map((item, ii) => ({ item, no: ++n, followUp: staff?.followUps[si]?.[ii] ?? null })) }));
  const tableOpts = (wide: number) => ({ size: TYPE.table, fit: { minSize: TYPE.tableMin }, wide });

  // ── The failed items, on their own ──────────────────────────────────────────────────────────
  const fails = numbered.flatMap((s) => s.rows.filter((x) => x.item.result === 'Fail').map((x) => ({ ...x, section: s.title })));
  if (fails.length) {
    const columns: TableColumn[] = [{ header: '#', align: 'right', nowrap: true }, { header: 'Item' }, { header: 'Section' }, { header: 'Reading' }, { header: 'Note' }, ...(staff ? [{ header: 'Follow-up', nowrap: true }] : [])];
    const rows = fails.map((x) => [String(x.no), x.item.label, x.section, readingCell(x.item), shortNote(x.item.note ?? '', LIST_NOTE_MAX, 'in full in the checklist'), ...(staff ? [x.followUp ?? ''] : [])]);
    const opts = tableOpts(1);
    doc.heading(`Failed items (${fails.length})`, { size: TYPE.heading, color: DANGER, keepWith: doc.tableHeight(columns, rows, { ...opts, firstRows: 1 }) });
    doc.table(columns, rows, opts);
  }

  // ── Every section ───────────────────────────────────────────────────────────────────────────
  for (const s of numbered) {
    const hasReading = s.rows.some((x) => x.item.kind === 'READING');
    const columns: TableColumn[] = [
      { header: '#', align: 'right', nowrap: true },
      { header: 'Item' },
      { header: 'Result', nowrap: true },
      ...(hasReading ? [{ header: 'Reading' }] : []),
      { header: 'Note' },
      ...(staff ? [{ header: 'Follow-up', nowrap: true }] : []),
    ];
    // A long note would make a row taller than a page: its cell has the start, and the whole note follows the table.
    const longNotes = s.rows.filter((x) => (x.item.note ?? '').length > CELL_NOTE_MAX);
    const rows = s.rows.map((x) => [
      String(x.no),
      x.item.label,
      resultCell(x.item.result),
      ...(hasReading ? [readingCell(x.item)] : []),
      shortNote(x.item.note ?? '', CELL_NOTE_MAX, 'the full note is under this table'),
      ...(staff ? [x.followUp ?? ''] : []),
    ]);
    const RESULT = 2;
    const opts = {
      ...tableOpts(1),
      cellColor: (ri: number, ci: number) => {
        if (ci !== RESULT) return null;
        const res = s.rows[ri]!.item.result;
        return res === 'Fail' ? DANGER : res === 'Pass' ? SUCCESS : MUTED;
      },
      cellBold: (ri: number, ci: number) => ci === RESULT && s.rows[ri]!.item.result === 'Fail',
    };
    doc.heading(s.title, { size: TYPE.heading, keepWith: doc.tableHeight(columns, rows, { ...opts, firstRows: 1 }) });
    if (rows.length) doc.table(columns, rows, opts);
    else doc.text('No items.', { size: TYPE.note, color: MUTED });
    if (longNotes.length) {
      doc.subheading(`Notes in full · ${s.title}`, { topGap: 8, keepWith: 30 });
      for (const x of longNotes) {
        doc.keepTogether(30);
        doc.text(`#${x.no} · ${isolate(x.item.label)}`, { size: TYPE.note, bold: true, color: MUTED, gap: 1, direction: textDirection(x.item.label) });
        for (const para of x.item.note!.split('\n').filter((l) => l.trim())) doc.text(para.trim(), { size: TYPE.body, gap: 1, direction: textDirection(para) });
        doc.spacer(5);
      }
    }
  }

  // ── Signatures ──────────────────────────────────────────────────────────────────────────────
  // One line per signature the form takes, in role order (given or not), then the drawn ones' pictures.
  const drawn: GridPicture[] = [];
  const entries: Array<{ role: string; line: string }> = [];
  for (const sig of r.signatures) {
    const who = `${sig.role}: ${isolate(sig.name)}`;
    const signed = `${who} · signed ${when(sig.signedAt)}`;
    if (sig.typed) {
      entries.push({ role: sig.role, line: `${signed} · typed name, not drawn` });
      continue;
    }
    const raw = decodeDataUrl(sig.image);
    const image = raw ? doc.prepareImage(raw) : null;
    if (image) {
      drawn.push({ image, caption: who });
      entries.push({ role: sig.role, line: signed });
    } else entries.push({ role: sig.role, line: `${signed} · (signature image could not be shown)` });
  }
  for (const role of d.unsigned ?? d.report.unsigned ?? []) entries.push({ role, line: `${role}: Not signed` });
  const order = (role: string) => (ROLE_ORDER.indexOf(role) + 1 || ROLE_ORDER.length + 1);
  entries.sort((a, b) => order(a.role) - order(b.role));
  const gridOpts = { columns: 3, height: 74 };
  doc.heading('Signatures', { size: TYPE.heading, keepWith: entries.length * 16 + (drawn.length ? doc.imageGridFirstRowHeight(drawn, gridOpts) + 6 : 0) });
  for (const e of entries) doc.text(e.line, { size: TYPE.body, gap: 3, direction: 'ltr' });
  if (!entries.length) doc.text('No signatures.', { size: TYPE.note, color: MUTED });
  if (drawn.length) {
    doc.spacer(6);
    doc.imageGrid(drawn, gridOpts);
  }

  return doc.build();
}
