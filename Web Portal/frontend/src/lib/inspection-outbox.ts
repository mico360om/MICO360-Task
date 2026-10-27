import { ApiError } from './api-client';
import { effectiveResult, INSPECTION_LIMITS, itemsOf, parseReading, summarize, type ItemResult } from './inspection-rules';
import type { AnswerOutcome, AnswerView, AnswerWrite, FinishInput, FollowUpResult, InspectionCounts, InspectionDetail, InspectionListItem, SignatureInput } from '../api/inspections';

/**
 * Inspections that keep working with no signal. Every answer, signature and follow-up request is
 * saved on this device first — one record per person and inspection, in localStorage — and sent
 * from there; nothing is sent straight from the page. So there is one path, online or not:
 *
 * - Answers are kept by item: a newer change to an item replaces the waiting one, and all waiting
 *   answers go in one request. The server keeps an answer only if it was changed later than the one
 *   it has (the device's edit time), so a repeat, a late or an out-of-order send changes nothing;
 *   an answer it already has newer (another device) is dropped here and the newer one shown.
 * - A finish waits until its answers are in. It carries what the signers saw; if the server's
 *   answers differ by then (another device won), it isn't sent: the signers look again. It is
 *   sent with the server's own edit times, and an id of its own, so sending it twice is harmless.
 * - Follow-up requests go after the answers (the server makes one task per failed item, once).
 * - Offline, signed out (a session that ended offline: sign in again, then it sends), or server
 *   trouble: everything stays and is tried again. A refusal that won't change by trying again —
 *   the inspection was deleted, finished elsewhere, taken over — is kept with its reason, and
 *   nothing more is sent until the person decides (looks, throws it away).
 * - Storage full: the change is kept in the page and the page says so (room is made first by
 *   dropping other inspections' copies that have nothing waiting).
 * - Only the signed-in person's records are sent or shown; a record is the person's own.
 */

export interface DraftStorage {
  get(key: string): string | null;
  /** Throws when the storage is full (or unavailable). */
  set(key: string, value: string): void;
  remove(key: string): void;
  keys(): string[];
}

const PREFIX = 'mico360.inspection.';
const keyOf = (ownerId: string, inspectionId: string) => `${PREFIX}${ownerId}.${inspectionId}`;
const ownerPrefix = (ownerId: string) => `${PREFIX}${ownerId}.`;

export const localDraftStorage: DraftStorage = {
  get(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key, value) {
    localStorage.setItem(key, value);
  },
  remove(key) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* unavailable */
    }
  },
  keys() {
    try {
      return Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)).filter((k): k is string => !!k);
    } catch {
      return [];
    }
  },
};

/** In memory, for tests: `full` refuses every write, `limit` caps the characters stored in all. */
export function memoryDraftStorage(): DraftStorage & { raw: Map<string, string>; full: boolean; limit: number | null } {
  const raw = new Map<string, string>();
  const s = {
    raw,
    full: false,
    limit: null as number | null,
    get: (k: string) => raw.get(k) ?? null,
    set(k: string, v: string) {
      if (s.full) throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
      const used = [...raw.entries()].reduce((n, [key, val]) => n + (key === k ? 0 : val.length), 0);
      if (s.limit !== null && used + v.length > s.limit) throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
      raw.set(k, v);
    },
    remove: (k: string) => void raw.delete(k),
    keys: () => [...raw.keys()],
  };
  return s;
}

export interface OutboxApi {
  answer(id: string, writes: AnswerWrite[]): Promise<{ results: AnswerOutcome[]; inspection: InspectionListItem }>;
  finish(id: string, input: FinishInput): Promise<InspectionDetail>;
  makeFollowUps(id: string, input: { itemIds: string[]; assigneeId?: string | null }): Promise<FollowUpResult[]>;
}

type Content = { result: ItemResult | null; reading: string | null; note: string | null };

interface QueuedFinish {
  finishId: string;
  signatures: SignatureInput[];
  /** What the signers saw, item by item. */
  signed: Record<string, Content>;
  queuedAt: string;
}

export interface OutboxProblem {
  code: string;
  message: string;
  /** What couldn't be sent: the answers, a finish, follow-up tasks. */
  stage: 'answers' | 'finish' | 'follow-ups';
  at: string;
}

interface Draft {
  v: 1;
  ownerId: string;
  inspectionId: string;
  projectId: string;
  title: string;
  /** The inspection as last read from (or returned by) the server. */
  snapshot: InspectionDetail;
  /** Changes made here the server hasn't confirmed, by item. */
  answers: Record<string, AnswerWrite>;
  finish: QueuedFinish | null;
  followUps: Record<string, { assigneeId?: string | null; queuedAt: string }>;
  problem: OutboxProblem | null;
  /** A finish sent from here went through: its attached task, offered to be marked done (until answered). */
  finishedOffer?: InspectionDetail['taskOffer'] | null;
  savedAt: string;
  sentAt: string | null;
}

export interface DraftView {
  inspectionId: string;
  projectId: string;
  title: string;
  status: InspectionDetail['status'];
  snapshot: InspectionDetail;
  /** The answers to show: the server's, with this device's changes over them (in the form's order). */
  answers: AnswerView[];
  counts: InspectionCounts;
  pending: { answers: number; finish: boolean; followUps: number };
  /** Item ids with a follow-up request waiting. */
  followUpsWaiting: string[];
  problem: OutboxProblem | null;
  /** Saved in the phone's storage (false: storage is full, the changes are only in this page). */
  persisted: boolean;
  /** Signed and waiting to finish: no more answers until it is sent or taken back. */
  locked: boolean;
  finishedOffer: InspectionDetail['taskOffer'] | null;
  savedAt: string;
  sentAt: string | null;
}

export type FlushState = 'sent' | 'offline' | 'signed-out' | 'retry' | 'problem';

export interface WaitingInspection {
  inspectionId: string;
  projectId: string;
  title: string;
  pending: DraftView['pending'];
  problem: OutboxProblem | null;
  persisted: boolean;
}

const isoNow = (now: () => Date) => now().toISOString();
const contentOf = (a: { result: ItemResult | null; reading: string | null; note: string | null } | undefined): Content => ({ result: a?.result ?? null, reading: a?.reading ?? null, note: a?.note ?? null });
const sameContent = (a: Content, b: Content) => a.result === b.result && a.reading === b.reading && a.note === b.note;

/** Friendly words for a refusal that trying again won't change. */
function problemWords(e: ApiError, stage: OutboxProblem['stage']): string {
  if (e.status === 404) return 'This inspection was deleted (or you can no longer open it), so what is saved on this phone can’t be sent. You can throw it away.';
  if (e.code === 'INSPECTION_FINISHED') return 'This inspection was finished on another device, so the changes saved on this phone weren’t applied.';
  if (e.code === 'NOT_THE_INSPECTOR') return `${e.message} The changes saved on this phone weren’t sent.`;
  if (stage === 'finish' || stage === 'follow-ups') return e.message && !/^Request failed/.test(e.message) ? e.message : 'The server refused it.';
  return e.message && !/^Request failed/.test(e.message) ? e.message : 'The server refused these changes.';
}

export function createInspectionOutbox(deps: { storage: DraftStorage; api: OutboxApi; now?: () => Date; newId?: () => string }) {
  const { storage, api } = deps;
  const now = deps.now ?? (() => new Date());
  const newId =
    deps.newId ??
    (() => {
      try {
        return crypto.randomUUID();
      } catch {
        return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
      }
    });
  /** Records that couldn't be written to storage (it is full): they live here until they can. */
  const unsaved = new Map<string, Draft>();
  const listeners = new Set<() => void>();
  const flights = new Map<string, Promise<{ state: FlushState }>>();
  const notify = () => listeners.forEach((l) => l());

  function read(ownerId: string, inspectionId: string): Draft | null {
    const key = keyOf(ownerId, inspectionId);
    const held = unsaved.get(key);
    if (held) return structuredClone(held);
    const raw = storage.get(key);
    if (!raw) return null;
    try {
      const d = JSON.parse(raw) as Draft;
      return d && d.v === 1 && d.ownerId === ownerId && d.inspectionId === inspectionId ? d : null;
    } catch {
      return null;
    }
  }

  const hasWork = (d: Draft) => Object.keys(d.answers).length > 0 || d.finish !== null || Object.keys(d.followUps).length > 0;

  /** Other records of this person with nothing waiting: kept only so an inspection opens without signal. */
  function makeRoom(ownerId: string, keep: string): void {
    for (const key of storage.keys()) {
      if (!key.startsWith(ownerPrefix(ownerId)) || key === keep) continue;
      try {
        const d = JSON.parse(storage.get(key) ?? 'null') as Draft | null;
        if (d && !hasWork(d) && !d.problem && !d.finishedOffer) storage.remove(key);
      } catch {
        storage.remove(key);
      }
    }
  }

  /** Writes the record; true when it is in the phone's storage, false when only in this page. */
  function write(d: Draft): boolean {
    const key = keyOf(d.ownerId, d.inspectionId);
    const json = JSON.stringify(d);
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        storage.set(key, json);
        unsaved.delete(key);
        return true;
      } catch {
        if (attempt === 0) makeRoom(d.ownerId, key);
      }
    }
    unsaved.set(key, structuredClone(d));
    return false;
  }

  function remove(ownerId: string, inspectionId: string): void {
    const key = keyOf(ownerId, inspectionId);
    unsaved.delete(key);
    storage.remove(key);
  }

  function save(d: Draft): boolean {
    d.savedAt = isoNow(now);
    const ok = write(d);
    notify();
    return ok;
  }

  function mustRead(ownerId: string, inspectionId: string): Draft {
    const d = read(ownerId, inspectionId);
    if (!d) throw new Error('Open the inspection first.');
    return d;
  }

  function merged(d: Draft): AnswerView[] {
    const byItem = new Map(d.snapshot.answers.map((a) => [a.itemId, a]));
    for (const w of Object.values(d.answers)) byItem.set(w.itemId, { itemId: w.itemId, result: w.result, reading: w.reading, note: w.note, editedAt: w.editedAt });
    const order = itemsOf(d.snapshot.structure).map((i) => i.id);
    return order.filter((id) => byItem.has(id)).map((id) => byItem.get(id)!);
  }

  function viewOf(d: Draft): DraftView {
    const answers = merged(d);
    const s = summarize(d.snapshot.structure, answers);
    return {
      inspectionId: d.inspectionId,
      projectId: d.projectId,
      title: d.title,
      status: d.snapshot.status,
      snapshot: d.snapshot,
      answers,
      counts: { total: s.total, answered: s.answered, passed: s.passed, failed: s.failed, na: s.na },
      pending: { answers: Object.keys(d.answers).length, finish: d.finish !== null, followUps: Object.keys(d.followUps).length },
      followUpsWaiting: Object.keys(d.followUps),
      problem: d.problem,
      persisted: !unsaved.has(keyOf(d.ownerId, d.inspectionId)),
      locked: d.finish !== null,
      finishedOffer: d.finishedOffer ?? null,
      savedAt: d.savedAt,
      sentAt: d.sentAt,
    };
  }

  /** Records a refusal (or a pause): what flush() answers. */
  function failed(ownerId: string, inspectionId: string, e: unknown, stage: OutboxProblem['stage']): { state: FlushState } {
    if (!(e instanceof ApiError)) return { state: 'offline' };
    if (e.status === 401) return { state: 'signed-out' };
    if (e.status === 408 || e.status === 429 || e.status >= 500 || e.code === 'IDEMPOTENCY_IN_PROGRESS') return { state: 'retry' };
    const d = read(ownerId, inspectionId);
    if (d) {
      d.problem = { code: e.code, message: problemWords(e, stage), stage, at: isoNow(now) };
      // Signatures were given for answers that the server now holds differently: they sign again.
      if (stage === 'finish') d.finish = null;
      save(d);
    }
    return { state: 'problem' };
  }

  async function sendAnswers(ownerId: string, inspectionId: string): Promise<{ state: FlushState } | null> {
    const d = read(ownerId, inspectionId);
    const writes = d ? Object.values(d.answers) : [];
    if (!writes.length) return null;
    let out: Awaited<ReturnType<OutboxApi['answer']>>;
    try {
      out = await api.answer(inspectionId, writes);
    } catch (e) {
      return failed(ownerId, inspectionId, e, 'answers');
    }
    const after = read(ownerId, inspectionId);
    if (!after) return null;
    const sent = new Map(writes.map((w) => [w.itemId, w.editedAt]));
    const snap = new Map(after.snapshot.answers.map((a) => [a.itemId, a]));
    for (const r of out.results) {
      snap.set(r.itemId, r.answer);
      // Changed again while this was on its way: that newer change still waits.
      if (after.answers[r.itemId]?.editedAt === sent.get(r.itemId)) delete after.answers[r.itemId];
    }
    after.snapshot = { ...after.snapshot, ...out.inspection, answers: [...snap.values()] };
    after.sentAt = isoNow(now);
    save(after);
    return null;
  }

  async function sendFollowUps(ownerId: string, inspectionId: string): Promise<{ state: FlushState } | null> {
    const d = read(ownerId, inspectionId);
    if (!d || !Object.keys(d.followUps).length) return null;
    const groups = new Map<string, { assigneeId?: string | null; itemIds: string[] }>();
    for (const [itemId, f] of Object.entries(d.followUps)) {
      const k = f.assigneeId === undefined ? '~default' : f.assigneeId === null ? '~nobody' : f.assigneeId;
      const g = groups.get(k) ?? { ...(f.assigneeId !== undefined ? { assigneeId: f.assigneeId } : {}), itemIds: [] };
      g.itemIds.push(itemId);
      groups.set(k, g);
    }
    for (const g of groups.values()) {
      try {
        await api.makeFollowUps(inspectionId, g);
      } catch (e) {
        return failed(ownerId, inspectionId, e, 'follow-ups');
      }
      const after = read(ownerId, inspectionId);
      if (!after) return null;
      for (const itemId of g.itemIds) delete after.followUps[itemId];
      after.sentAt = isoNow(now);
      save(after);
    }
    return null;
  }

  async function sendFinish(ownerId: string, inspectionId: string): Promise<{ state: FlushState } | null> {
    const d = read(ownerId, inspectionId);
    if (!d?.finish || Object.keys(d.answers).length) return null;
    // What the server holds now must be what was signed (both ways round).
    const stored = new Map(d.snapshot.answers.map((a) => [a.itemId, contentOf(a)]));
    const ids = new Set([...stored.keys(), ...Object.keys(d.finish.signed)]);
    const changed = [...ids].filter((id) => !sameContent(stored.get(id) ?? contentOf(undefined), d.finish!.signed[id] ?? contentOf(undefined)));
    if (changed.length) {
      d.problem = {
        code: 'ANSWERS_CHANGED',
        message: 'Some answers were changed on another device after they were signed here, so it wasn’t finished. Look at them again and sign again.',
        stage: 'finish',
        at: isoNow(now),
      };
      d.finish = null;
      save(d);
      return { state: 'problem' };
    }
    let done: InspectionDetail;
    try {
      done = await api.finish(inspectionId, { finishId: d.finish.finishId, seen: d.snapshot.answers.map((a) => ({ itemId: a.itemId, editedAt: a.editedAt })), signatures: d.finish.signatures });
    } catch (e) {
      return failed(ownerId, inspectionId, e, 'finish');
    }
    const after = read(ownerId, inspectionId) ?? d;
    after.snapshot = done;
    after.finish = null;
    after.finishedOffer = done.taskOffer ?? null;
    after.sentAt = isoNow(now);
    if (!after.finishedOffer && !hasWork(after) && !after.problem) {
      remove(ownerId, inspectionId);
      notify();
    } else save(after);
    return null;
  }

  async function run(ownerId: string, inspectionId: string): Promise<{ state: FlushState }> {
    const d = read(ownerId, inspectionId);
    if (!d) return { state: 'sent' };
    if (d.problem) return { state: 'problem' };
    for (const step of [sendAnswers, sendFollowUps, sendFinish]) {
      const stop = await step(ownerId, inspectionId);
      if (stop) return stop;
    }
    return { state: 'sent' };
  }

  return {
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    /** For other tabs' changes (a storage event): tell the listeners. */
    changedElsewhere: notify,

    /** The record as stored (tests, and the page's checks). */
    draft: (ownerId: string, inspectionId: string) => read(ownerId, inspectionId),

    view(ownerId: string, inspectionId: string): DraftView | null {
      const d = read(ownerId, inspectionId);
      return d ? viewOf(d) : null;
    },

    /**
     * The inspection as just read from the server: kept so it opens without signal. This device's
     * waiting changes stay over it — except those the server already has (as new, or newer).
     */
    remember(ownerId: string, detail: InspectionDetail): void {
      const d: Draft = read(ownerId, detail.id) ?? {
        v: 1,
        ownerId,
        inspectionId: detail.id,
        projectId: detail.projectId,
        title: detail.title,
        snapshot: detail,
        answers: {},
        finish: null,
        followUps: {},
        problem: null,
        savedAt: isoNow(now),
        sentAt: null,
      };
      const server = new Map(detail.answers.map((a) => [a.itemId, a.editedAt]));
      for (const [itemId, w] of Object.entries(d.answers)) {
        const at = server.get(itemId);
        if (at !== undefined && at >= w.editedAt) delete d.answers[itemId];
      }
      d.snapshot = detail;
      d.title = detail.title;
      d.projectId = detail.projectId;
      if (detail.status === 'FINISHED' && !hasWork(d) && !d.problem && !d.finishedOffer) {
        if (read(ownerId, detail.id)) {
          remove(ownerId, detail.id);
          notify();
        }
        return;
      }
      save(d);
    },

    /** One answer changed on this device, worked out as the server will. */
    saveAnswer(ownerId: string, inspectionId: string, value: Content & { itemId: string }): { persisted: boolean } {
      const d = mustRead(ownerId, inspectionId);
      const item = itemsOf(d.snapshot.structure).find((i) => i.id === value.itemId);
      if (!item) throw new Error('That item isn’t on this inspection.');
      let reading: string | null = null;
      if (item.kind === 'READING' && value.reading !== null && value.reading.trim() !== '') {
        reading = parseReading(value.reading);
        if (reading === null) throw new Error(`Enter the reading for “${item.label}” as a number.`);
      }
      const note = value.note?.trim() ? value.note.trim().slice(0, INSPECTION_LIMITS.noteMax) : null;
      const result = effectiveResult(item, { result: value.result, reading });
      // Each change later than the one before it, even within a millisecond.
      const previous = d.answers[item.id]?.editedAt ?? d.snapshot.answers.find((a) => a.itemId === item.id)?.editedAt;
      let at = now().getTime();
      if (previous && Date.parse(previous) >= at) at = Date.parse(previous) + 1;
      d.answers[item.id] = { itemId: item.id, result, reading, note, editedAt: new Date(at).toISOString() };
      return { persisted: save(d) };
    },

    /** Signed: finishes as soon as its answers are in (now, or when back online). */
    queueFinish(ownerId: string, inspectionId: string, signatures: SignatureInput[]): { persisted: boolean } {
      const d = mustRead(ownerId, inspectionId);
      const signed: Record<string, Content> = {};
      for (const a of merged(d)) signed[a.itemId] = contentOf(a);
      d.finish = { finishId: newId(), signatures, signed, queuedAt: isoNow(now) };
      d.problem = null;
      return { persisted: save(d) };
    },

    /** Takes a waiting finish back (to change an answer before it goes). */
    cancelFinish(ownerId: string, inspectionId: string): void {
      const d = read(ownerId, inspectionId);
      if (!d) return;
      d.finish = null;
      save(d);
    },

    queueFollowUps(ownerId: string, inspectionId: string, itemIds: string[], assigneeId: string | null | undefined): { persisted: boolean } {
      const d = mustRead(ownerId, inspectionId);
      for (const itemId of itemIds) if (!d.followUps[itemId]) d.followUps[itemId] = { ...(assigneeId !== undefined ? { assigneeId } : {}), queuedAt: isoNow(now) };
      return { persisted: save(d) };
    },

    /** The person read the problem: try again (a finish problem: they sign again). */
    clearProblem(ownerId: string, inspectionId: string): void {
      const d = read(ownerId, inspectionId);
      if (!d) return;
      d.problem = null;
      save(d);
    },

    /** Throws away what is saved on this device for the inspection. */
    discard(ownerId: string, inspectionId: string): void {
      remove(ownerId, inspectionId);
      notify();
    },

    /** The person answered the "mark the task done?" offer. */
    ackFinished(ownerId: string, inspectionId: string): void {
      const d = read(ownerId, inspectionId);
      if (!d) return;
      d.finishedOffer = null;
      if (d.snapshot.status === 'FINISHED' && !hasWork(d) && !d.problem) {
        remove(ownerId, inspectionId);
        notify();
      } else save(d);
    },

    /** Sends what waits for one inspection (one send at a time per inspection). */
    flush(ownerId: string, inspectionId: string): Promise<{ state: FlushState }> {
      const key = keyOf(ownerId, inspectionId);
      const going = flights.get(key);
      if (going) return going;
      const p = run(ownerId, inspectionId).finally(() => flights.delete(key));
      flights.set(key, p);
      return p;
    },

    /** The person's inspections with something waiting, or a problem to look at. */
    waiting(ownerId: string): WaitingInspection[] {
      const ids = new Set<string>();
      for (const key of [...storage.keys(), ...unsaved.keys()]) if (key.startsWith(ownerPrefix(ownerId))) ids.add(key.slice(ownerPrefix(ownerId).length));
      const out: WaitingInspection[] = [];
      for (const id of ids) {
        const d = read(ownerId, id);
        if (!d || (!hasWork(d) && !d.problem)) continue;
        const v = viewOf(d);
        out.push({ inspectionId: id, projectId: d.projectId, title: d.title, pending: v.pending, problem: d.problem, persisted: v.persisted });
      }
      return out.sort((a, b) => a.title.localeCompare(b.title));
    },

    /** Sends everything the person has waiting (on load, when back online, after signing in). */
    async flushAll(ownerId: string): Promise<{ sent: number; waiting: number }> {
      let sent = 0;
      for (const w of this.waiting(ownerId)) {
        if (w.problem) continue;
        const r = await this.flush(ownerId, w.inspectionId);
        if (r.state === 'sent') sent += 1;
        if (r.state === 'offline' || r.state === 'signed-out') break;
      }
      return { sent, waiting: this.waiting(ownerId).length };
    },
  };
}

export type InspectionOutbox = ReturnType<typeof createInspectionOutbox>;
