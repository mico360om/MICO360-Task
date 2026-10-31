import { ConflictError, NotFoundError, ValidationError } from '../../lib/http-errors';
import type { TaskLookup } from './assignee-repository';
import type { ExternalContactRecord, ExternalContactRepository } from './external-contact-repository';
import { MAX_EXTERNAL_CONTACTS, checkExternalContact, type ExternalContactDraft, type ExternalContactFields } from './external-contacts';

/** At most this many earlier contacts are suggested while a name is typed. */
export const MAX_SUGGESTIONS = 10;
/** Rows read per suggestion search before they are made one per person. */
const SUGGESTION_ROWS = 200;

const TOO_MANY = `A task can have at most ${MAX_EXTERNAL_CONTACTS} external contacts.`;
const GONE = 'This contact isn’t on the task any more. Someone may have removed it.';

const FIELDS = ['name', 'company', 'designation', 'email', 'phone', 'remarks'] as const;
const fieldsOf = (c: ExternalContactFields): ExternalContactFields => ({ name: c.name, company: c.company, designation: c.designation, email: c.email, phone: c.phone, remarks: c.remarks });

/** Clean a contact or refuse it, the first problem in words and every field's problem in `details.fields`. */
function cleanOrRefuse(draft: ExternalContactDraft, prefix = ''): ExternalContactFields {
  const check = checkExternalContact(draft);
  if (check.ok) return check.contact;
  const first = Object.values(check.problems)[0] ?? 'Check the contact’s details.';
  throw new ValidationError(`${prefix}${first}`, { fields: check.problems });
}

/** The external contacts sent with a new task, checked and cleaned (in order) — or refused before anything is written. */
export function checkNewTaskContacts(drafts: ExternalContactDraft[] | undefined): ExternalContactFields[] {
  const list = drafts ?? [];
  if (list.length > MAX_EXTERNAL_CONTACTS) throw new ValidationError(TOO_MANY);
  return list.map((d, i) => cleanOrRefuse(d, list.length > 1 ? `External contact ${i + 1}: ` : ''));
}

/** One person per name and company (case and spacing aside). */
const personKey = (c: ExternalContactFields) => [c.name, c.company ?? ''].map((v) => v.trim().replace(/\s+/g, ' ').toLowerCase()).join('|');

export interface ExternalContactServiceDeps {
  repo: ExternalContactRepository;
  taskLookup: TaskLookup;
  /** After a change to the words of a task (the task search index re-reads it). */
  onChanged?: (taskId: string) => void | Promise<void>;
}

export function createExternalContactService({ repo, taskLookup, onChanged }: ExternalContactServiceDeps) {
  async function ensureTask(taskId: string): Promise<void> {
    if (!(await taskLookup.exists(taskId))) throw new NotFoundError('Task not found.');
  }

  /** A task's contacts, in order. */
  async function list(taskId: string): Promise<ExternalContactRecord[]> {
    await ensureTask(taskId);
    return repo.list(taskId);
  }

  /** A contact of a live task (callers check access to its `taskId`). */
  async function get(contactId: string): Promise<ExternalContactRecord> {
    const contact = await repo.get(contactId);
    if (!contact) throw new NotFoundError(GONE);
    return contact;
  }

  async function add(taskId: string, draft: ExternalContactDraft, userId: string): Promise<ExternalContactRecord> {
    const fields = cleanOrRefuse(draft);
    await ensureTask(taskId);
    const added = await repo.add(taskId, fields, userId, MAX_EXTERNAL_CONTACTS);
    if (!added) throw new ConflictError(TOO_MANY, 'TOO_MANY_EXTERNAL_CONTACTS');
    await onChanged?.(taskId);
    return added;
  }

  /** Change the fields sent (one sent empty is cleared), keeping the rest; says what it was before and whether anything changed. */
  async function update(contactId: string, draft: ExternalContactDraft): Promise<{ before: ExternalContactRecord; after: ExternalContactRecord; changed: boolean }> {
    const before = await get(contactId);
    const merged: ExternalContactDraft = { ...fieldsOf(before) };
    for (const field of FIELDS) if (draft[field] !== undefined) merged[field] = draft[field];
    const fields = cleanOrRefuse(merged);
    const changed = FIELDS.some((f) => fields[f] !== before[f]);
    if (!changed) return { before, after: before, changed };
    const after = await repo.update(contactId, fields);
    if (!after) throw new NotFoundError(GONE);
    await onChanged?.(after.taskId);
    return { before, after, changed };
  }

  /** Remove a contact, handing back what it was. */
  async function remove(contactId: string): Promise<ExternalContactRecord> {
    const contact = await get(contactId);
    if (!(await repo.remove(contactId))) throw new NotFoundError(GONE);
    await onChanged?.(contact.taskId);
    return contact;
  }

  /**
   * Earlier contacts on the project's tasks whose name or company has a word starting with what was
   * typed — each person once (their most recently saved details), newest first, at most 10. Picking
   * one copies its six fields; nothing is shared between tasks.
   */
  async function suggest(projectId: string, typed: string): Promise<ExternalContactFields[]> {
    const prefix = typed.trim();
    if (!prefix) return [];
    const seen = new Set<string>();
    const out: ExternalContactFields[] = [];
    for (const c of await repo.searchProject(projectId, prefix, SUGGESTION_ROWS)) {
      const key = personKey(c);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(fieldsOf(c));
      if (out.length >= MAX_SUGGESTIONS) break;
    }
    return out;
  }

  return { list, get, add, update, remove, suggest };
}

export type ExternalContactService = ReturnType<typeof createExternalContactService>;
