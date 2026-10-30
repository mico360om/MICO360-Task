/**
 * Inspection checklists: the rules the server and the website must agree on — what an item's
 * result is (a reading decides its own: outside its limits it fails, whatever was sent), how a
 * typed reading is read, how limits are worded, the counts, and which signatures a form asks for.
 *
 * The server owns this file; the website keeps an identical copy (Web Portal/frontend/src/lib/
 * inspection-rules.ts) and a test fails when the two differ. No imports: it runs in both.
 */

export type ItemKind = 'CHECK' | 'READING';
export type ItemResult = 'PASS' | 'FAIL' | 'NA';
/** Whether a form asks for a signature beyond the inspector's, and whether finishing needs it. */
export type SignatureRule = 'NONE' | 'OPTIONAL' | 'REQUIRED';
export type SignatureRole = 'INSPECTOR' | 'CLIENT' | 'SUPERVISOR';
export type InspectionStatus = 'IN_PROGRESS' | 'FINISHED';

/** Pass / Fail / N/A, with an optional note. */
export interface CheckItem {
  id: string;
  kind: 'CHECK';
  label: string;
  help: string | null;
}

/** A number with a unit and optional limits ("Pressure, psi, 0–150"); outside them it fails. */
export interface ReadingItem {
  id: string;
  kind: 'READING';
  label: string;
  help: string | null;
  unit: string | null;
  min: number | null;
  max: number | null;
}

export type FormItem = CheckItem | ReadingItem;

export interface FormSection {
  id: string;
  title: string;
  items: FormItem[];
}

/** A form's checklist and signatures — copied into each inspection when it starts. */
export interface FormStructure {
  sections: FormSection[];
  clientSignature: SignatureRule;
  supervisorSignature: SignatureRule;
}

export const INSPECTION_LIMITS = {
  titleMax: 150,
  descriptionMax: 2000,
  sectionTitleMax: 150,
  labelMax: 200,
  helpMax: 500,
  unitMax: 20,
  sectionsMax: 50,
  itemsMax: 300,
  noteMax: 2000,
  placeMax: 200,
  signerNameMax: 120,
  readingMax: 32,
  /** A limit's size and decimals (a reading is held to the same). */
  numberAbsMax: 1e12,
  decimalsMax: 6,
} as const;

const ARABIC_INDIC = '٠١٢٣٤٥٦٧٨٩';
const PERSIAN = '۰۱۲۳۴۵۶۷۸۹';

/**
 * A typed reading as a plain decimal ("12.5"), or null when it isn't one number. A comma or the
 * Arabic decimal sign counts as the decimal point, and Arabic-Indic digits are read as digits; the
 * digits are otherwise kept as typed ("150.00" stays "150.00").
 */
export function parseReading(text: string): string | null {
  if (typeof text !== 'string') return null;
  let s = text.trim();
  if (!s || s.length > INSPECTION_LIMITS.readingMax) return null;
  s = s.replace(/[٠-٩]/g, (d) => String(ARABIC_INDIC.indexOf(d))).replace(/[۰-۹]/g, (d) => String(PERSIAN.indexOf(d)));
  s = s.replace(/[,٫]/g, '.').replace(/^[−–]/, '-');
  const m = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(s);
  if (!m) return null;
  const [, sign, whole = '', frac] = m;
  if (!whole && !frac) return null;
  if (frac !== undefined && frac.length > INSPECTION_LIMITS.decimalsMax) return null;
  const out = `${sign === '-' ? '-' : ''}${whole || '0'}${frac ? `.${frac}` : ''}`;
  const value = Number(out);
  if (!Number.isFinite(value) || Math.abs(value) > INSPECTION_LIMITS.numberAbsMax) return null;
  return out;
}

/** Inside its limits (both inclusive; a missing limit doesn't apply). */
export function withinLimits(item: Pick<ReadingItem, 'min' | 'max'>, value: number): boolean {
  if (!Number.isFinite(value)) return false;
  if (item.min !== null && value < item.min) return false;
  if (item.max !== null && value > item.max) return false;
  return true;
}

/** A limit as written: no trailing zeros, no thousands separators. */
export function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return '';
  return String(Number(n.toFixed(INSPECTION_LIMITS.decimalsMax)));
}

const withUnit = (text: string, unit: string | null) => (unit ? `${text} ${unit}` : text);

/** "0–150 psi", "at least 0 psi", "at most 150 psi", "-10 to 5 °C"; '' without limits. */
export function limitsText(item: Pick<ReadingItem, 'min' | 'max' | 'unit'>): string {
  const { min, max, unit } = item;
  if (min !== null && max !== null) {
    const joiner = min < 0 || max < 0 ? ' to ' : '–';
    return withUnit(`${formatNumber(min)}${joiner}${formatNumber(max)}`, unit);
  }
  if (min !== null) return `at least ${withUnit(formatNumber(min), unit)}`;
  if (max !== null) return `at most ${withUnit(formatNumber(max), unit)}`;
  return '';
}

/** A reading with its unit ("162.5 psi"); '' for none. */
export function readingText(item: Pick<ReadingItem, 'unit'>, reading: string | null): string {
  return reading ? withUnit(reading, item.unit) : '';
}

export interface AnswerValue {
  result: ItemResult | null;
  reading: string | null;
}

/**
 * The result an item has. A reading with a value is decided by its limits alone — outside them it
 * fails, inside it passes — whatever result came with it. A reading without a value can be N/A or
 * failed (it couldn't be taken), never passed. A check item's result is as given. Null: unanswered.
 */
export function effectiveResult(item: FormItem, answer: AnswerValue | undefined | null): ItemResult | null {
  if (!answer) return null;
  if (item.kind === 'READING') {
    const reading = answer.reading === null ? null : parseReading(answer.reading);
    if (reading !== null) return withinLimits(item, Number(reading)) ? 'PASS' : 'FAIL';
    return answer.result === 'NA' || answer.result === 'FAIL' ? answer.result : null;
  }
  return answer.result === 'PASS' || answer.result === 'FAIL' || answer.result === 'NA' ? answer.result : null;
}

export interface InspectionSummary {
  total: number;
  answered: number;
  passed: number;
  failed: number;
  na: number;
  /** Item ids with no answer yet, in the form's order. */
  unanswered: string[];
  /** Item ids that failed, in the form's order. */
  failedItems: string[];
}

/** Every item of the structure (in order). */
export function itemsOf(structure: Pick<FormStructure, 'sections'>): FormItem[] {
  return structure.sections.flatMap((s) => s.items);
}

/** Counts over the structure's items (answers to items it doesn't have are ignored). */
export function summarize(structure: Pick<FormStructure, 'sections'>, answers: ReadonlyArray<AnswerValue & { itemId: string }>): InspectionSummary {
  const byItem = new Map(answers.map((a) => [a.itemId, a]));
  const out: InspectionSummary = { total: 0, answered: 0, passed: 0, failed: 0, na: 0, unanswered: [], failedItems: [] };
  for (const item of itemsOf(structure)) {
    out.total += 1;
    const result = effectiveResult(item, byItem.get(item.id));
    if (result === null) {
      out.unanswered.push(item.id);
      continue;
    }
    out.answered += 1;
    if (result === 'PASS') out.passed += 1;
    else if (result === 'NA') out.na += 1;
    else {
      out.failed += 1;
      out.failedItems.push(item.id);
    }
  }
  return out;
}

/** "Passed", "2 failed", or "All N/A" (nothing was checked). */
export function resultLabel(c: Pick<InspectionSummary, 'failed' | 'passed' | 'na' | 'total'>): string {
  if (c.failed > 0) return `${c.failed} failed`;
  if (c.passed === 0 && c.na > 0) return 'All N/A';
  return 'Passed';
}

export const RESULT_LABEL: Record<ItemResult, string> = { PASS: 'Pass', FAIL: 'Fail', NA: 'N/A' };
export const SIGNATURE_LABEL: Record<SignatureRole, string> = { INSPECTOR: 'Inspector', CLIENT: 'Client', SUPERVISOR: 'Supervisor' };

/** The signatures an inspection of this form takes: the inspector's always, then the form's own. */
export function allowedSignatures(structure: Pick<FormStructure, 'clientSignature' | 'supervisorSignature'>): SignatureRole[] {
  return [
    'INSPECTOR',
    ...(structure.clientSignature !== 'NONE' ? (['CLIENT'] as const) : []),
    ...(structure.supervisorSignature !== 'NONE' ? (['SUPERVISOR'] as const) : []),
  ];
}

/** The signatures finishing needs. */
export function requiredSignatures(structure: Pick<FormStructure, 'clientSignature' | 'supervisorSignature'>): SignatureRole[] {
  return [
    'INSPECTOR',
    ...(structure.clientSignature === 'REQUIRED' ? (['CLIENT'] as const) : []),
    ...(structure.supervisorSignature === 'REQUIRED' ? (['SUPERVISOR'] as const) : []),
  ];
}
