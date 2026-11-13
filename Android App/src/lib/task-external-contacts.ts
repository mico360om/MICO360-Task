/**
 * External contacts on the phone (the people outside the company responsible for a task): the
 * form's rows, saving an Edit task's changes (only what changed; what went is kept, so a retry sends
 * the rest), what goes wrong in words, TalkBack's names, where the card sits on the task screen and
 * what a change refreshes. The shared rules and words are lib/external-contacts (the website's copy);
 * this file is the app's own. Changing contacts needs a connection (they aren't kept offline).
 */
import { ApiError, isNetworkError } from './api-client';
import { newIdempotencyKey } from './idempotency';
import {
  EXTERNAL_CONTACT_LIMITS,
  EXTERNAL_CONTACT_WORDS,
  hasExternalCompany,
  type ExternalContactDraft,
  type ExternalContactField,
  type ExternalContactFields,
  type ExternalContactSummary,
} from './external-contacts';
import type { Refresh } from './refresh';
import type { TaskPart } from './task-cards';

/** A contact in a form: its saved id (none until it is saved) and its six fields. `key` stays the same while it is edited. */
export interface ContactRow {
  key: string;
  id?: string;
  fields: ExternalContactFields;
  /** A new contact's Idempotency-Key, kept until it is added: a retry after a lost answer never adds it twice. */
  addKey?: string;
}

/** A contact as the server has it (what an Edit task form opened with, or has saved since). */
export interface SavedContact {
  id: string;
  fields: ExternalContactFields;
}

const FIELDS = Object.keys(EXTERNAL_CONTACT_LIMITS) as ExternalContactField[];

/** A contact with nothing filled in. */
export function emptyContact(): ExternalContactFields {
  return { name: '', company: null, designation: null, email: null, phone: null, remarks: null };
}

/** Just the six fields of a contact from the server. */
export function fieldsOf(c: ExternalContactFields): ExternalContactFields {
  return { name: c.name, company: c.company ?? null, designation: c.designation ?? null, email: c.email ?? null, phone: c.phone ?? null, remarks: c.remarks ?? null };
}

/** A contact in the editor's six boxes: each one's text ('' for nothing given). */
export type ContactDraftText = Record<ExternalContactField, string>;

/** The editor's boxes filled from a contact (null: a new, empty contact). */
export function draftOf(c: Partial<ExternalContactFields> | null | undefined): ContactDraftText {
  const out = {} as ContactDraftText;
  for (const k of FIELDS) out[k] = (c?.[k] ?? '') || '';
  return out;
}

let seq = 0;
/** A contact added in the form (not saved yet). */
export function newContactRow(fields: ExternalContactFields): ContactRow {
  seq += 1;
  return { key: `new-${Date.now().toString(36)}-${seq}`, fields, addKey: newIdempotencyKey() };
}

/** The task's contacts as the form's rows. */
export function contactRowsOf<C extends ExternalContactFields & { id: string }>(contacts: readonly C[]): ContactRow[] {
  return contacts.map((c) => ({ key: c.id, id: c.id, fields: fieldsOf(c) }));
}

/** The task's contacts as saved. */
export function savedContactsOf<C extends ExternalContactFields & { id: string }>(contacts: readonly C[]): SavedContact[] {
  return contacts.map((c) => ({ id: c.id, fields: fieldsOf(c) }));
}

/** A new task's contacts as POST /tasks takes them, in order. */
export function contactInputs(rows: readonly ContactRow[]): ExternalContactFields[] {
  return rows.map((r) => fieldsOf(r.fields));
}

const same = (a: ExternalContactFields, b: ExternalContactFields) => FIELDS.every((k) => (a[k] ?? null) === (b[k] ?? null));

/** Do the rows differ from what is saved (something to save, or to lose on leaving)? */
export function contactsDirty(saved: readonly SavedContact[], rows: readonly ContactRow[]): boolean {
  return planCount(planContactChanges(saved, rows)) > 0;
}

export interface ContactPlan {
  remove: string[];
  /** `patch`: only the fields that changed (PUT changes only those, so someone else's change to another field stays). */
  update: { id: string; fields: ExternalContactFields; patch: ExternalContactDraft }[];
  add: { key: string; addKey?: string; fields: ExternalContactFields }[];
}
const planCount = (p: ContactPlan) => p.remove.length + p.update.length + p.add.length;

/** What saving the rows sends: removals first (they free room under the limit), then changes, then additions. */
export function planContactChanges(saved: readonly SavedContact[], rows: readonly ContactRow[]): ContactPlan {
  const kept = new Set(rows.filter((r) => r.id).map((r) => r.id!));
  const byId = new Map(saved.map((s) => [s.id, s.fields]));
  return {
    remove: saved.filter((s) => !kept.has(s.id)).map((s) => s.id),
    update: rows
      .filter((r) => r.id && byId.has(r.id) && !same(byId.get(r.id)!, r.fields))
      .map((r) => ({ id: r.id!, fields: fieldsOf(r.fields), patch: contactPatch(byId.get(r.id!)!, r.fields) })),
    add: rows.filter((r) => !r.id).map((r) => ({ key: r.key, addKey: r.addKey, fields: fieldsOf(r.fields) })),
  };
}

export interface ContactDeps {
  remove(id: string): Promise<unknown>;
  /** Only the fields that changed. */
  update(id: string, patch: ExternalContactDraft): Promise<unknown>;
  /** Under the contact's own key (the same on every try until it is added). */
  add(fields: ExternalContactFields, idempotencyKey?: string): Promise<{ id: string }>;
}

/** The fields that differ from what was loaded (a cleared one as null): what a change sends. */
export function contactPatch(before: ExternalContactFields, after: ExternalContactFields): ExternalContactDraft {
  const out: ExternalContactDraft = {};
  for (const k of FIELDS) if ((before[k] ?? null) !== (after[k] ?? null)) out[k] = after[k] ?? null;
  return out;
}

/** The contact isn't on the task any more (someone removed it): a removal of it is done. */
export function isContactGone(e: unknown): boolean {
  return e instanceof ApiError && e.status === 404;
}

/**
 * Send an Edit task form's contact changes one by one (stopping at the first that fails). What went
 * is kept in `saved` (an addition gets its id in `rows`), so the next try sends only the rest. A
 * contact someone else already removed counts as removed.
 */
export async function saveContactChanges(deps: ContactDeps, saved: readonly SavedContact[], rows: readonly ContactRow[]): Promise<{ saved: SavedContact[]; rows: ContactRow[]; problem: string | null }> {
  const plan = planContactChanges(saved, rows);
  let done = [...saved];
  let now = [...rows];
  const fail = (e: unknown, fallback: string) => ({ saved: done, rows: now, problem: contactFailureText(e, fallback) });
  for (const id of plan.remove) {
    try {
      await deps.remove(id);
    } catch (e) {
      if (!isContactGone(e)) return fail(e, 'Couldn’t remove the contact.');
    }
    done = done.filter((s) => s.id !== id);
  }
  for (const u of plan.update) {
    try {
      await deps.update(u.id, u.patch);
    } catch (e) {
      return fail(e, 'Couldn’t save the contact.');
    }
    done = done.map((s) => (s.id === u.id ? { id: u.id, fields: u.fields } : s));
  }
  for (const a of plan.add) {
    let id: string;
    try {
      id = (await deps.add(a.fields, a.addKey)).id;
    } catch (e) {
      return fail(e, 'Couldn’t add the contact.');
    }
    done = [...done, { id, fields: a.fields }];
    now = now.map((r) => (r.key === a.key ? { key: r.key, id, fields: r.fields } : r));
  }
  return { saved: done, rows: now, problem: null };
}

/** Said when a change to the contacts needs a connection (they aren't kept on the phone). */
export const CONTACTS_OFFLINE = 'Changing external contacts needs a connection — check your connection and try again.';

/** A failed change in words: offline, else the server's reason, else the fallback. */
export function contactFailureText(e: unknown, fallback: string): string {
  if (isNetworkError(e)) return CONTACTS_OFFLINE;
  return e instanceof Error && e.message ? e.message : fallback;
}

/** Each field's problem, as the server's refusal names them (400 VALIDATION, details.fields). */
export function contactFieldProblems(e: unknown): Partial<Record<ExternalContactField, string>> {
  const fields = e instanceof ApiError ? (e.details as { fields?: unknown } | undefined)?.fields : undefined;
  if (!fields || typeof fields !== 'object') return {};
  const out: Partial<Record<ExternalContactField, string>> = {};
  for (const k of FIELDS) {
    const v = (fields as Record<string, unknown>)[k];
    if (typeof v === 'string' && v) out[k] = v;
  }
  return out;
}

/** TalkBack's names for a contact's buttons and links. */
export const editContactLabel = (c: { name: string }) => `Edit ${c.name}`;
export const removeContactLabel = (c: { name: string }) => `Remove ${c.name}`;
export const emailLabel = (c: { name: string; email?: string | null }) => `Email ${c.name} at ${c.email ?? ''}`;
export const callLabel = (c: { name: string; phone?: string | null }) => `Call ${c.name} on ${c.phone ?? ''}`;

type Layout = { top: TaskPart[]; main: TaskPart[]; side: TaskPart[] };

/** The External contacts card right after the details (the assignees are in them): on a phone, and beside the work. */
export function withExternalContacts(l: Layout): Layout {
  const place = (list: TaskPart[]) => {
    const at = list.indexOf('details');
    return at < 0 ? list : [...list.slice(0, at + 1), 'external' as TaskPart, ...list.slice(at + 1)];
  };
  return { top: [...l.top], main: place(l.main), side: place(l.side) };
}

/** What a change to a task's contacts refreshes: the task (its details carry them), its history, and every list showing it (the card line). */
export function externalContactRefreshes(taskId: string): Refresh[] {
  return [{ queryKey: ['task', taskId], exact: true }, { queryKey: ['task', taskId, 'activity'], exact: true }, { listsHolding: taskId }];
}

/** The tasks with a contact from this company (case and extra spaces aside); no company keeps them all. */
export function filterByExternalCompany<T extends { externalSummary?: ExternalContactSummary | null }>(tasks: readonly T[], company: string): T[] {
  return company.trim() ? tasks.filter((t) => hasExternalCompany(t.externalSummary, company)) : [...tasks];
}

/** The company filter's button: "External company: Any company" / "External company: Acme". */
export function companyFilterLabel(company: string): string {
  return `${EXTERNAL_CONTACT_WORDS.filter}: ${company.trim() || EXTERNAL_CONTACT_WORDS.anyCompany}`;
}

/** The company filter's choices: Any company, then each company (lib/external-contacts externalCompanyOptions). */
export function companyChoices(companies: readonly string[]): { value: string; label: string }[] {
  return [{ value: '', label: EXTERNAL_CONTACT_WORDS.anyCompany }, ...companies.map((c) => ({ value: c, label: c }))];
}

/** Said when Create or Save is tapped while a contact is still open in its editor (the website's words). */
export const CONTACT_STILL_OPEN = 'Save the external contact you’re working on, or cancel it, first.';

/** The first field with a problem, in the editor's order (it is brought into view and said). */
export function firstProblem(problems: Partial<Record<ExternalContactField, string>>): { field: ExternalContactField; message: string } | null {
  for (const field of FIELDS) {
    const message = problems[field];
    if (message) return { field, message };
  }
  return null;
}

/**
 * The suggestions to offer: only those asked for the name as it is typed now (`forText`: what they
 * were asked for, lower case) — while typing pauses, the list for an earlier text is never offered.
 */
export function freshSuggestions<T>(typed: string, forText: string, list: readonly T[] | undefined): T[] {
  const now = typed.trim().toLowerCase();
  return now && now === forText && list ? [...list] : [];
}

/** Why an Edit task save stopped at its contacts — after saying, when they were, that the task's changes were kept on this phone. */
export function editSaveProblem(out: { kind: string; message?: string }, problem: string): string {
  return out.kind === 'kept' && out.message ? `${out.message} ${problem}` : problem;
}

/**
 * A move into another column while the board shows one external company: to the bottom of the
 * whole column (hidden cards counted), with no new order for the column — the hidden cards keep
 * their places (an order from the shown cards only would push them about).
 */
export function moveWithoutOrder(destTasks: readonly { id: string; position: number }[], taskId: string): { index: number; orderedIds: string[]; at: number } {
  const rest = destTasks.filter((t) => t.id !== taskId);
  const last = rest.reduce<number | null>((top, t) => (top === null || t.position > top ? t.position : top), null);
  return { index: rest.length, orderedIds: [], at: last === null ? 0 : last + 1 };
}
