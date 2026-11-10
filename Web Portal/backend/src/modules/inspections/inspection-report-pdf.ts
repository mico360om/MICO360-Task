import { PDF_STANDARD, PdfDocument, hexToRgb, type GridPicture, type RGB, type TableColumn } from '../../lib/pdf-document';
import { OVERDUE_TONES, STATUS_TONES } from '../../lib/colour-scheme';
import { isolate, textDirection } from '../../lib/pdf-text';
import { formatDateTime, formatDay, slugPart } from '../../lib/export-format';
import { projectIconPaths, projectInitials } from '../projects/project-icons';
import { minutesFooter, printedAt, type MinutesBrand } from '../meetings/minutes';
import { resolveBrand } from '../email/brand';
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
    /** Who reopened it last (a reopened report). */
    reopenedBy?: string | null;
    /** Earlier signed revisions (taken off by reopens), oldest first. */
    earlierRevisions?: Array<{ number: number; reopenedAt: string; signatures: Array<{ role: string; name: string; signedAt: string }> }>;
  };
  /** Signatures the form asks for that were not given ('Client'): printed as "Not signed". */
  unsigned?: string[];
  timeZone: string;
  generatedAt: string;
  /** Who made the PDF (the staff copy only). */
  generatedBy?: string | null;
  /** Companies: the project's company logo (printable), on the header and the running header; null = the built-in logo. */
  logo?: Buffer | null;
}

const MUTED: RGB = [0.42, 0.4, 0.38];
/** 1.23.10: failed and passed results in the site's colour scheme's text tones. */
const DANGER: RGB = hexToRgb(OVERDUE_TONES.light.text);
const SUCCESS: RGB = hexToRgb(STATUS_TONES.DONE.light.text);
/** 1.23.10: the PDF standard's sizes (body 9.5, headings 11, notes 8, tables 8.5, never under 7.5). */
const TYPE = { body: PDF_STANDARD.type.body, heading: PDF_STANDARD.type.heading, note: PDF_STANDARD.type.small, table: PDF_STANDARD.type.table, tableMin: PDF_STANDARD.type.tableMin } as const;
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
  // 1.23.10 footer: the company, "Printed … by …" (the staff copy; a client's copy names no one) and
  // the page; the website and support address under them (and, on a client's copy, the postal
  // address and "Shared with you through …").
  const reach = [brand.websiteUrl, brand.supportEmail].filter((b): b is string => Boolean(b)).map(isolate).join('  ·  ');
  const footer = staff
    ? { company: brand.companyName, printed: printedAt(d.generatedAt, tz, d.generatedBy), extra: [reach].filter(Boolean) }
    : minutesFooter({ ...brand, companyAddress: brand.companyAddress ?? '' }, printedAt(d.generatedAt, tz), true);

  const doc = new PdfDocument({
    title: `Inspection report: ${r.title}`,
    runningTitle: `${r.title} · ${project.name}`,
    palette: { brand: brand.colors?.brand, ink: brand.colors?.ink, muted: brand.colors?.muted, line: brand.colors?.line },
    footer,
    ...(d.logo ? { logo: d.logo } : {}),
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
  doc.documentTitle(r.title, { direction: textDirection(r.title) });
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
  doc.keyValueColumns(left, right);
  // A reopened and signed-again report says which signing it is (the client's copy: no names).
  if (r.revisionNumber > 1 && r.reopenedOn) {
    doc.spacer(6);
    doc.statusStrip(`Revision ${r.revisionNumber} · reopened on ${formatDay(r.reopenedOn)}${staff?.reopenedBy ? ` by ${isolate(staff.reopenedBy)}` : ''}`, 'muted');
  }

  // ── Summary ─────────────────────────────────────────────────────────────────────────────────
  doc.spacer(6);
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
  /** 1.23.10 (owner): a table that can't fit across a portrait page turns its section landscape, then back. */
  const landscapeFor = (columns: TableColumn[], rows: string[][], draw: () => void) => {
    const wide = PdfDocument.needsLandscape(columns, rows);
    if (wide) doc.orient('landscape');
    draw();
    if (wide) doc.orient('portrait');
  };

  // ── The failed items, on their own ──────────────────────────────────────────────────────────
  const fails = numbered.flatMap((s) => s.rows.filter((x) => x.item.result === 'Fail').map((x) => ({ ...x, section: s.title })));
  if (fails.length) {
    const columns: TableColumn[] = [{ header: '#', align: 'right', nowrap: true }, { header: 'Item' }, { header: 'Section' }, { header: 'Reading' }, { header: 'Note' }, ...(staff ? [{ header: 'Follow-up', nowrap: true }] : [])];
    const rows = fails.map((x) => [String(x.no), x.item.label, x.section, readingCell(x.item), shortNote(x.item.note ?? '', LIST_NOTE_MAX, 'in full in the checklist'), ...(staff ? [x.followUp ?? ''] : [])]);
    const opts = tableOpts(1);
    landscapeFor(columns, rows, () =>
      doc.section(() => {
        doc.heading(`Failed items (${fails.length})`, { color: DANGER, keepWith: doc.tableHeight(columns, rows, { ...opts, firstRows: 2 }) });
        doc.table(columns, rows, opts);
      }),
    );
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
    landscapeFor(columns, rows, () =>
      doc.section(() => {
        doc.heading(s.title, { keepWith: doc.tableHeight(columns, rows, { ...opts, firstRows: 2 }) });
        if (rows.length) doc.table(columns, rows, opts);
        else doc.text('No items.', { size: TYPE.note, color: MUTED });
        if (longNotes.length) {
          doc.subheading(`Notes in full · ${s.title}`, { topGap: 6, keepWith: 30 });
          for (const x of longNotes) {
            doc.keepTogether(30);
            doc.text(`#${x.no} · ${isolate(x.item.label)}`, { size: TYPE.note, bold: true, color: MUTED, gap: 1, direction: textDirection(x.item.label) });
            for (const para of x.item.note!.split('\n').filter((l) => l.trim())) doc.text(para.trim(), { size: TYPE.body, gap: 1, direction: textDirection(para) });
            doc.spacer(4);
          }
        }
      }),
    );
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
  const gridOpts = { columns: 3, height: 64 };
  doc.section(() => {
    doc.heading('Signatures', { keepWith: entries.length * 14 + (drawn.length ? doc.imageGridFirstRowHeight(drawn, gridOpts) + 4 : 0) });
    for (const e of entries) doc.text(e.line, { size: TYPE.body, gap: 2, direction: 'ltr' });
    if (!entries.length) doc.text('No signatures.', { size: TYPE.note, color: MUTED });
    if (drawn.length) {
      doc.spacer(4);
      doc.imageGrid(drawn, gridOpts);
    }
  });

  // The staff copy keeps the signings a reopen took off (they no longer count).
  const earlier = staff?.earlierRevisions ?? [];
  if (earlier.length) {
    doc.heading('Earlier signed revisions', { keepWith: 40 });
    doc.text('These signatures were taken off when the inspection was reopened; they no longer count.', { size: TYPE.note, color: MUTED, gap: 4 });
    for (const e of earlier) {
      doc.keepTogether(16 + e.signatures.length * 14);
      doc.text(`Revision ${e.number} · reopened ${when(e.reopenedAt)}`, { size: TYPE.body, bold: true, gap: 1, direction: 'ltr' });
      for (const sig of e.signatures) doc.text(`${sig.role}: ${isolate(sig.name)} · signed ${when(sig.signedAt)}`, { size: TYPE.body, inset: 10, gap: 1, direction: 'ltr' });
      doc.spacer(4);
    }
  }

  return doc.build();
}

/** The report's brand: the same one every MICO360 PDF uses. */
export function reportBrand(): InspectionReportData['brand'] {
  const b = resolveBrand();
  return {
    productName: b.productName,
    companyName: b.companyName,
    websiteUrl: b.websiteUrl,
    supportEmail: b.supportEmail,
    companyAddress: b.companyAddress,
    colors: { brand: b.colors.brand, ink: b.colors.ink, muted: b.colors.ink2, line: b.colors.line },
  };
}
