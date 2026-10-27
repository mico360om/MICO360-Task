import type { FormInput, InspectionForm } from '../../api/inspections';
import { INSPECTION_LIMITS as L, limitsText, parseReading, type ItemKind, type SignatureRule } from '../../lib/inspection-rules';

/**
 * The forms manager's editing model: a form as it is typed (limits as text, so "-" or "0." can be
 * half typed), checked as the server checks it, and turned into what the server takes. Sections and
 * items of a saved form keep their ids, so the inspections started from it keep pointing at the same
 * items; new ones have none until the server gives them one.
 */

export interface DraftItem {
  /** This editor's own key for the item (a React key and the key of its problems). */
  key: string;
  id?: string;
  kind: ItemKind;
  label: string;
  help: string;
  unit: string;
  min: string;
  max: string;
}

export interface DraftSection {
  key: string;
  id?: string;
  title: string;
  items: DraftItem[];
}

export interface Draft {
  title: string;
  description: string;
  clientSignature: SignatureRule;
  supervisorSignature: SignatureRule;
  sections: DraftSection[];
}

/**
 * Problems by where they are: 'title', 'description', 'form', `section:<key>:title`,
 * `section:<key>:items`, `item:<key>:label|help|unit|min|max`. In the order they appear on screen.
 */
export type Problems = Record<string, string>;

let n = 0;
const nextKey = () => `k${++n}`;

export function newItem(kind: ItemKind): DraftItem {
  return { key: nextKey(), kind, label: '', help: '', unit: '', min: '', max: '' };
}

export function newSection(): DraftSection {
  return { key: nextKey(), title: '', items: [newItem('CHECK')] };
}

export function emptyDraft(): Draft {
  return { title: '', description: '', clientSignature: 'NONE', supervisorSignature: 'NONE', sections: [newSection()] };
}

const limitText = (v: number | null) => (v === null ? '' : String(v));

export function draftFromForm(form: InspectionForm): Draft {
  return {
    title: form.title,
    description: form.description ?? '',
    clientSignature: form.structure.clientSignature,
    supervisorSignature: form.structure.supervisorSignature,
    sections: form.structure.sections.map((s) => ({
      key: nextKey(),
      id: s.id,
      title: s.title,
      items: s.items.map((i) =>
        i.kind === 'READING'
          ? { key: nextKey(), id: i.id, kind: 'READING' as const, label: i.label, help: i.help ?? '', unit: i.unit ?? '', min: limitText(i.min), max: limitText(i.max) }
          : { key: nextKey(), id: i.id, kind: 'CHECK' as const, label: i.label, help: i.help ?? '', unit: '', min: '', max: '' },
      ),
    })),
  };
}

export const itemCount = (d: Draft) => d.sections.reduce((sum, s) => sum + s.items.length, 0);

/** The list with the entry at `index` moved by `delta` (unchanged at either end). */
export function move<T>(list: readonly T[], index: number, delta: -1 | 1): T[] {
  const to = index + delta;
  if (index < 0 || index >= list.length || to < 0 || to >= list.length) return [...list];
  const next = [...list];
  const [it] = next.splice(index, 1);
  next.splice(to, 0, it!);
  return next;
}

const withSection = (d: Draft, sectionKey: string, change: (s: DraftSection) => DraftSection): Draft => ({
  ...d,
  sections: d.sections.map((s) => (s.key === sectionKey ? change(s) : s)),
});

export const addSection = (d: Draft): Draft => ({ ...d, sections: [...d.sections, newSection()] });
export const removeSection = (d: Draft, sectionKey: string): Draft => ({ ...d, sections: d.sections.filter((s) => s.key !== sectionKey) });
export const addItem = (d: Draft, sectionKey: string, kind: ItemKind): Draft => withSection(d, sectionKey, (s) => ({ ...s, items: [...s.items, newItem(kind)] }));
export const removeItem = (d: Draft, itemKey: string): Draft => ({ ...d, sections: d.sections.map((s) => ({ ...s, items: s.items.filter((i) => i.key !== itemKey) })) });
export const updateItem = (d: Draft, itemKey: string, patch: Partial<DraftItem>): Draft => ({
  ...d,
  sections: d.sections.map((s) => ({ ...s, items: s.items.map((i) => (i.key === itemKey ? { ...i, ...patch } : i)) })),
});
export const updateSection = (d: Draft, sectionKey: string, patch: Partial<Omit<DraftSection, 'items'>>): Draft => withSection(d, sectionKey, (s) => ({ ...s, ...patch }));
export const moveSection = (d: Draft, sectionKey: string, delta: -1 | 1): Draft => ({ ...d, sections: move(d.sections, d.sections.findIndex((s) => s.key === sectionKey), delta) });
export const moveItem = (d: Draft, sectionKey: string, itemKey: string, delta: -1 | 1): Draft =>
  withSection(d, sectionKey, (s) => ({ ...s, items: move(s.items, s.items.findIndex((i) => i.key === itemKey), delta) }));

/** A typed limit: null when empty, 'invalid' when it isn't a number (as a reading is read). */
export function parseLimit(text: string): number | null | 'invalid' {
  if (!text.trim()) return null;
  const v = parseReading(text);
  return v === null ? 'invalid' : Number(v);
}

/** "Allowed: 0–150 psi. A reading outside this fails." — null while a limit can't be read or they cross. */
export function limitsPreview(item: Pick<DraftItem, 'unit' | 'min' | 'max'>): string | null {
  const min = parseLimit(item.min);
  const max = parseLimit(item.max);
  if (min === 'invalid' || max === 'invalid') return null;
  if (min !== null && max !== null && min > max) return null;
  const text = limitsText({ min, max, unit: item.unit.trim() || null });
  return text ? `Allowed: ${text}. A reading outside this fails.` : 'No limits: every reading is recorded as a pass.';
}

const tooLong = (what: string, max: number) => `${what} can have at most ${max} characters.`;
const blankToNull = (s: string) => (s.trim() ? s.trim() : null);

/** Checks a draft as the server will, and gives what to send — or the problems, by where they are. */
export function validateDraft(d: Draft): { ok: true; input: FormInput } | { ok: false; problems: Problems } {
  const problems: Problems = {};
  const title = d.title.trim();
  if (!title) problems.title = 'Enter a title.';
  else if (title.length > L.titleMax) problems.title = tooLong('A title', L.titleMax);
  if (d.description.trim().length > L.descriptionMax) problems.description = tooLong('A description', L.descriptionMax);
  if (d.sections.length === 0) problems.form = 'Add at least one section.';
  else if (d.sections.length > L.sectionsMax) problems.form = `A form can have at most ${L.sectionsMax} sections.`;
  else if (itemCount(d) > L.itemsMax) problems.form = `A form can have at most ${L.itemsMax} items.`;

  const sections: FormInput['sections'] = [];
  for (const s of d.sections) {
    const sTitle = s.title.trim();
    if (!sTitle) problems[`section:${s.key}:title`] = 'Enter the section’s name.';
    else if (sTitle.length > L.sectionTitleMax) problems[`section:${s.key}:title`] = tooLong('A section’s name', L.sectionTitleMax);
    if (s.items.length === 0) problems[`section:${s.key}:items`] = 'Add at least one item to this section.';
    const items: FormInput['sections'][number]['items'] = [];
    for (const i of s.items) {
      const at = (field: string) => `item:${i.key}:${field}`;
      const label = i.label.trim();
      if (!label) problems[at('label')] = 'Enter the item.';
      else if (label.length > L.labelMax) problems[at('label')] = tooLong('An item', L.labelMax);
      if (i.help.trim().length > L.helpMax) problems[at('help')] = tooLong('A hint', L.helpMax);
      const id = i.id ? { id: i.id } : {};
      if (i.kind === 'CHECK') {
        items.push({ ...id, kind: 'CHECK', label, help: blankToNull(i.help) });
        continue;
      }
      if (i.unit.trim().length > L.unitMax) problems[at('unit')] = tooLong('A unit', L.unitMax);
      const min = parseLimit(i.min);
      const max = parseLimit(i.max);
      if (min === 'invalid') problems[at('min')] = 'Enter a number, or leave it empty.';
      if (max === 'invalid') problems[at('max')] = 'Enter a number, or leave it empty.';
      if (typeof min === 'number' && typeof max === 'number' && min > max) problems[at('min')] = 'The lowest allowed reading must not be above the highest.';
      items.push({ ...id, kind: 'READING', label, help: blankToNull(i.help), unit: blankToNull(i.unit), min: typeof min === 'number' ? min : null, max: typeof max === 'number' ? max : null });
    }
    sections.push({ ...(s.id ? { id: s.id } : {}), title: sTitle, items });
  }
  if (Object.keys(problems).length) return { ok: false, problems };
  return { ok: true, input: { title, description: blankToNull(d.description), clientSignature: d.clientSignature, supervisorSignature: d.supervisorSignature, sections } };
}
