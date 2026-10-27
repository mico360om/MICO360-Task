import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { INSPECTION_LIMITS as L, type FormItem, type FormSection, type FormStructure, type SignatureRule } from './inspection-rules';

/**
 * A form as it is sent to be created or edited, checked and tidied: text trimmed, limits sane
 * (min ≤ max, at most 6 decimals), at most 50 sections and 300 items. Every section and item gets a
 * stable id: one it already had (on an edit) is kept, so inspections and reports keep pointing at
 * the same item; anything else gets a new one.
 */

const ID = /^[A-Za-z0-9_-]{1,40}$/;
const text = (max: number, what: string) => z.string().trim().min(1, `Enter ${what}.`).max(max, `${what[0]!.toUpperCase()}${what.slice(1)} can have at most ${max} characters.`);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `At most ${max} characters.`)
    .nullish()
    .transform((v) => (v ? v : null));
const decimals = (n: number) => {
  const s = String(n);
  const dot = s.indexOf('.');
  return /e/i.test(s) ? 99 : dot < 0 ? 0 : s.length - dot - 1;
};
const limit = z
  .number()
  .finite()
  .refine((n) => Math.abs(n) <= L.numberAbsMax, 'That limit is too large.')
  .refine((n) => decimals(n) <= L.decimalsMax, `A limit can have at most ${L.decimalsMax} decimals.`)
  .nullish()
  .transform((v) => (v === undefined ? null : v));
const signatureRule = z.enum(['NONE', 'OPTIONAL', 'REQUIRED']).default('NONE');

const checkItem = z.object({ id: z.string().optional(), kind: z.literal('CHECK'), label: text(L.labelMax, 'the item'), help: optionalText(L.helpMax) });
const readingItem = z.object({
  id: z.string().optional(),
  kind: z.literal('READING'),
  label: text(L.labelMax, 'the item'),
  help: optionalText(L.helpMax),
  unit: optionalText(L.unitMax),
  min: limit,
  max: limit,
});
const item = z.discriminatedUnion('kind', [checkItem, readingItem]).superRefine((i, ctx) => {
  if (i.kind === 'READING' && i.min !== null && i.max !== null && i.min > i.max) {
    ctx.addIssue({ code: 'custom', message: 'The lowest allowed reading must not be above the highest.', path: ['min'] });
  }
});

const formBody = z.object({
    title: text(L.titleMax, 'a title'),
    description: optionalText(L.descriptionMax),
    clientSignature: signatureRule,
    supervisorSignature: signatureRule,
    sections: z
      .array(
        z.object({
          id: z.string().optional(),
          title: text(L.sectionTitleMax, 'the section’s name'),
          items: z.array(item).min(1, 'Each section needs at least one item.'),
        }),
      )
      .min(1, 'Add at least one section.')
      .max(L.sectionsMax, `A form can have at most ${L.sectionsMax} sections.`)
      .refine((sections) => sections.reduce((n, s) => n + s.items.length, 0) <= L.itemsMax, `A form can have at most ${L.itemsMax} items.`),
});

export interface FormInput {
  title: string;
  description: string | null;
  structure: FormStructure;
}

export const newItemId = (): string => randomBytes(9).toString('base64url');

/**
 * Checks a form body (throws a ZodError) and gives ids: `knownIds` are the ids the form already has
 * (an edit keeps them), each used once; any other id is replaced.
 */
export function parseFormInput(raw: unknown, opts: { newId?: () => string; knownIds?: ReadonlySet<string> } = {}): FormInput {
  const body = formBody.parse(raw);
  const newId = opts.newId ?? newItemId;
  const used = new Set<string>();
  const idFor = (given: string | undefined) => {
    const id = given && ID.test(given) && opts.knownIds?.has(given) && !used.has(given) ? given : newId();
    used.add(id);
    return id;
  };
  const sections: FormSection[] = body.sections.map((s) => ({
    id: idFor(s.id),
    title: s.title,
    items: s.items.map((i): FormItem =>
      i.kind === 'CHECK'
        ? { id: idFor(i.id), kind: 'CHECK', label: i.label, help: i.help }
        : { id: idFor(i.id), kind: 'READING', label: i.label, help: i.help, unit: i.unit, min: i.min, max: i.max },
    ),
  }));
  return { title: body.title, description: body.description, structure: { sections, clientSignature: body.clientSignature, supervisorSignature: body.supervisorSignature } };
}

/** Every section and item id of a structure (an edit keeps these). */
export function idsOf(structure: FormStructure): Set<string> {
  return new Set(structure.sections.flatMap((s) => [s.id, ...s.items.map((i) => i.id)]));
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const rule = (v: unknown): SignatureRule => (v === 'OPTIONAL' || v === 'REQUIRED' ? v : 'NONE');

/** A stored structure (JSON) read back: anything it can't read is left out rather than failing. */
export function readStructure(raw: unknown): FormStructure {
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const sections: FormSection[] = [];
  for (const s of Array.isArray(o.sections) ? o.sections : []) {
    const so = (s ?? {}) as Record<string, unknown>;
    const id = str(so.id);
    if (!id) continue;
    const items: FormItem[] = [];
    for (const i of Array.isArray(so.items) ? so.items : []) {
      const io = (i ?? {}) as Record<string, unknown>;
      const itemId = str(io.id);
      const label = str(io.label);
      if (!itemId || !label) continue;
      if (io.kind === 'CHECK') items.push({ id: itemId, kind: 'CHECK', label, help: str(io.help) });
      else if (io.kind === 'READING') items.push({ id: itemId, kind: 'READING', label, help: str(io.help), unit: str(io.unit), min: num(io.min), max: num(io.max) });
    }
    sections.push({ id, title: str(so.title) ?? '', items });
  }
  return { sections, clientSignature: rule(o.clientSignature), supervisorSignature: rule(o.supervisorSignature) };
}
