import { ConflictError, HttpError, ValidationError } from '../../lib/http-errors';
import { KEEP_GRACE_MS, MAX_ATTEMPTS, type AiJobHandler, type AiJobRunner } from '../ai-jobs/ai-job-runner';
import type { AiJobError, AiJobRecord, AiJobStore } from '../ai-jobs/ai-job-store';
import { normalizeFinalMinutes, type FinalMinutesContent } from './final-minutes';
import type { FinalMinutesRecord, FinalMinutesRepository } from './final-minutes-repository';

/**
 * 1.22 (§10): the Final MOM's "Draft with AI" keeps running after the page is closed. Asking starts
 * a job (or joins the one already drafting this meeting's minutes) and answers at once; the job asks
 * the AI — trying again after a time-out, a 429 or a 5xx — and then, owner's rule:
 * - nothing was written since it was asked for: the AI's text is saved as the draft;
 * - someone saved the minutes meanwhile (or marked them final): their text stays, and the AI's draft
 *   is offered beside it — Use it, Compare, Discard;
 * and the person who asked is told by the bell and a phone push (ready, or failed for good), unless
 * their page was showing it. "Start from the notes" stays instant and is not a job.
 */

export const FINAL_MINUTES_JOB = 'final-minutes' as const;
export const AI_NOT_CONFIGURED = 'AI is not configured yet — an admin needs to add a provider and enable a chat model in AI Management.';
export const MINUTES_LOCKED = 'These minutes are final. Reopen them to make changes.';
/** The notification types of the requester's notice. */
export const AI_DRAFT_READY = 'AI_DRAFT_READY';
export const AI_DRAFT_FAILED = 'AI_DRAFT_FAILED';
/** Older apps wait for the text in the request, as before: up to this long (the Android app waits 190 s). */
export const LEGACY_WAIT_MS = 180_000;
const DRAFT_GONE = 'This AI draft is no longer there to use.';
const STILL_KEEPING = 'The AI draft is still being saved. Try again in a moment.';
const CHANGED_JUST_NOW = 'The minutes were changed just now. Look at them again, then use the AI draft if you still want it.';
const EMPTY = 'The AI’s draft was empty. Try again, or start from the notes.';
const FAILED = 'Something went wrong while drafting with AI. Try again, or start from the notes.';
const STILL_RUNNING = 'The AI is still drafting. It will be saved as the draft, and you’ll be told when it’s ready.';

/** What an editor's page shows of the AI's work on the minutes (null: nothing to show). */
export type AiDraftView =
  | {
      id: string;
      /** running: a try is under way (or about to start); waiting: a try failed and the next is at nextTryAt. */
      status: 'running' | 'waiting';
      /** The try under way, or the next one. */
      attempt: number;
      maxAttempts: number;
      nextTryAt: string | null;
      /** Why the last try failed (waiting). */
      error: string | null;
      requestedAt: string;
      requestedBy: { id: string; name: string | null };
      /** The person reading asked for it. */
      mine: boolean;
    }
  | {
      id: string;
      /** The AI's draft, kept beside the minutes: someone saved them meanwhile ('changed') or they are final ('final'). */
      status: 'ready';
      reason: 'changed' | 'final';
      content: FinalMinutesContent;
      finishedAt: string;
    }
  /** The AI's draft was saved as the draft, and nobody has saved since. */
  | { id: string; status: 'saved'; finishedAt: string }
  /** It failed for good (until dismissed, or the minutes are saved again). */
  | { id: string; status: 'failed'; error: string; finishedAt: string };

export interface FinalMinutesAiDeps {
  jobs: Pick<AiJobRunner, 'enqueue' | 'watch'>;
  store: Pick<AiJobStore, 'get' | 'latest' | 'active' | 'setOutcome'>;
  finalMinutes: FinalMinutesRepository;
  /** One try: the AI's JSON for the minutes, from the meeting's facts (the person's AI limits apply). */
  draftMinutesWithAi: (facts: string, requester: { userId: string; roles?: string[] }, opts: { signal?: AbortSignal }) => Promise<unknown>;
  /** Is a chat model set up? Asked up front, so AI being off is said at once, as before. */
  ready?: () => Promise<boolean>;
  /** Throws the person's AI limit error (429) when one more request would be over it; counts nothing. */
  checkLimits?: (userId: string) => void;
  /** The bell, the phone push and the live pop-up (the notification service's notify). */
  notify?: (n: { userId: string; type: string; title: string; body: string; entityType: string; entityId: string }) => Promise<unknown>;
  /** An archived project's minutes are not changed in the background: the draft is offered instead. */
  isArchived?: (meetingId: string) => Promise<boolean>;
  /** The meeting's live event: open pages read the minutes again. */
  onChanged?: (meetingId: string) => void;
  userNames?: (ids: string[]) => Promise<Map<string, string>>;
  maxAttempts?: number;
  now?: () => Date;
  legacyWaitMs?: number;
  pollMs?: number;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const hasContent = (c: FinalMinutesContent) => Boolean(c.summary || c.discussion.length || c.decisions.length || c.risks.length || c.nextSteps.length);
const quoted = (title: string) => `“${title.length > 80 ? `${title.slice(0, 79)}…` : title}”`;

export function createFinalMinutesAi(deps: FinalMinutesAiDeps) {
  const { store, finalMinutes } = deps;
  const now = deps.now ?? (() => new Date());
  const maxAttempts = deps.maxAttempts ?? MAX_ATTEMPTS;

  const describe = (err: unknown): AiJobError =>
    err instanceof HttpError && err.status < 500 ? { message: err.message, code: err.code, status: err.status } : { message: FAILED, code: null, status: 500 };

  const handler: AiJobHandler = {
    async run(job, signal) {
      const raw = await deps.draftMinutesWithAi(str(job.input.facts), { userId: job.requestedById, roles: Array.isArray(job.input.roles) ? (job.input.roles as string[]) : [] }, { signal });
      const content = normalizeFinalMinutes(raw);
      if (!hasContent(content)) throw new ValidationError(EMPTY);
      return content;
    },
    async save(job, result) {
      const meetingId = job.subjectId;
      if (deps.isArchived && (await deps.isArchived(meetingId))) return { outcome: 'OFFERED' };
      const asked = str(job.input.baseline);
      const saved = await finalMinutes.saveIfUnchanged(meetingId, asked ? new Date(asked) : null, {
        content: normalizeFinalMinutes(result),
        status: 'DRAFT',
        approvedById: null,
        approvedAt: null,
      });
      return saved ? { outcome: 'SAVED', at: saved.savedAt } : { outcome: 'OFFERED' };
    },
    async notify(job, end) {
      if (!deps.notify) return;
      const title = quoted(str(job.input.title) || 'the meeting');
      const base = { userId: job.requestedById, entityType: 'meeting', entityId: job.subjectId };
      if (end.status === 'FAILED') {
        await deps.notify({ ...base, type: AI_DRAFT_FAILED, title: `Couldn’t draft the minutes for ${title} with AI — try again`, body: end.error.message });
        return;
      }
      const final = end.outcome === 'OFFERED' && (await finalMinutes.get(job.subjectId))?.status === 'APPROVED';
      const body =
        end.outcome === 'SAVED'
          ? 'It was saved as the draft. Check it, then mark it final.'
          : final
            ? 'The minutes were marked final meanwhile, so they were kept. Open them to compare, or reopen them to use the AI draft.'
            : 'The minutes were changed while the AI was drafting, so they were kept. Open them to use the AI draft, compare or discard it.';
      await deps.notify({ ...base, type: AI_DRAFT_READY, title: `The AI draft of the minutes for ${title} is ready`, body });
    },
    changed(job) {
      deps.onChanged?.(job.subjectId);
    },
    describe,
  };

  /**
   * Ask for the AI's draft of a meeting's minutes, as `viewer` (an editor; the caller checked). Joins
   * the job already drafting them; else says at once when AI is off or the person is over their limit.
   * `facts` is read only when a new job starts. `current`: the minutes as they are now.
   */
  async function start(
    viewer: { userId: string; roles: string[] },
    meetingId: string,
    input: { title: string; facts: () => Promise<string>; waiting?: boolean },
    current: FinalMinutesRecord | null,
  ): Promise<{ job: AiJobRecord; joined: boolean }> {
    if (current?.status === 'APPROVED') throw new ConflictError(MINUTES_LOCKED, 'FINAL_MINUTES_LOCKED');
    const running = await store.active(FINAL_MINUTES_JOB, meetingId);
    if (running) {
      if (input.waiting && running.requestedById === viewer.userId) await deps.jobs.watch(FINAL_MINUTES_JOB, meetingId);
      return { job: running, joined: true };
    }
    if (deps.ready && !(await deps.ready())) throw new ValidationError(AI_NOT_CONFIGURED);
    deps.checkLimits?.(viewer.userId);
    return deps.jobs.enqueue({
      kind: FINAL_MINUTES_JOB,
      subjectId: meetingId,
      meetingId,
      requestedById: viewer.userId,
      input: { title: input.title, facts: await input.facts(), roles: viewer.roles, baseline: current ? current.savedAt.toISOString() : null },
      // A request that waits for the text (older apps) is watching it: no bell for what it shows.
      watched: input.waiting ?? false,
    });
  }

  /**
   * Finished but its result not kept yet: being kept (SAVING), or the moment between the two (a
   * stopped server's is kept by a sweep after KEEP_GRACE_MS) — still "drafting" to the page.
   */
  const keeping = (job: AiJobRecord) =>
    job.status === 'DONE' && (job.outcome === 'SAVING' || (job.outcome === null && now().getTime() - (job.finishedAt ?? job.createdAt).getTime() < KEEP_GRACE_MS + 30_000));

  /** The page's view of one job, given the minutes as they are now. */
  async function viewOf(job: AiJobRecord | null, minutes: FinalMinutesRecord | null): Promise<AiDraftView | null> {
    if (!job) return null;
    const finishedAt = (job.finishedAt ?? job.createdAt).toISOString();
    if (job.status === 'QUEUED' || job.status === 'RUNNING' || keeping(job)) {
      const waiting = job.status === 'QUEUED' && job.attempts > 0;
      const names = deps.userNames ? await deps.userNames([job.requestedById]).catch(() => new Map<string, string>()) : new Map<string, string>();
      return {
        id: job.id,
        status: waiting ? 'waiting' : 'running',
        attempt: waiting ? job.attempts + 1 : Math.max(1, job.attempts),
        maxAttempts,
        nextTryAt: waiting ? job.nextTryAt.toISOString() : null,
        error: waiting ? (job.error?.message ?? null) : null,
        requestedAt: job.createdAt.toISOString(),
        requestedBy: { id: job.requestedById, name: names.get(job.requestedById) ?? null },
        mine: false,
      };
    }
    if (job.status === 'DONE') {
      if (job.outcome === 'SAVED') {
        const still = minutes && minutes.status === 'DRAFT' && job.outcomeAt && minutes.savedAt.getTime() === job.outcomeAt.getTime();
        return still ? { id: job.id, status: 'saved', finishedAt } : null;
      }
      // Offered (or, long after, a save that never said which): the draft is there to use.
      if (job.outcome === null || job.outcome === 'OFFERED') {
        let content: FinalMinutesContent;
        try {
          content = normalizeFinalMinutes(job.result);
        } catch {
          return null;
        }
        return { id: job.id, status: 'ready', reason: minutes?.status === 'APPROVED' ? 'final' : 'changed', content, finishedAt };
      }
      // Its draft could never be kept (LOST): said as a failure.
      if (job.outcome === 'LOST') return failedView(job, minutes, finishedAt);
      return null;
    }
    if (job.status === 'FAILED' && job.outcome !== 'DISCARDED') return failedView(job, minutes, finishedAt);
    return null;
  }

  /** A failure (until the minutes are saved again: then it is old news). */
  function failedView(job: AiJobRecord, minutes: FinalMinutesRecord | null, finishedAt: string): AiDraftView | null {
    if (minutes && job.finishedAt && minutes.savedAt.getTime() > job.finishedAt.getTime()) return null;
    return { id: job.id, status: 'failed', error: job.error?.message ?? FAILED, finishedAt };
  }

  /**
   * What an editor's page shows for a meeting (the newest job). The requester's page reading it marks
   * it watched (`watch`: not the answer to the click that started it — they may close the page next).
   */
  async function view(meetingId: string, minutes: FinalMinutesRecord | null, viewerId: string, opts: { watch?: boolean } = {}): Promise<AiDraftView | null> {
    const job = await store.latest(FINAL_MINUTES_JOB, meetingId);
    const shown = await viewOf(job, minutes);
    if (shown && (shown.status === 'running' || shown.status === 'waiting')) {
      shown.mine = job!.requestedById === viewerId;
      if (shown.mine && opts.watch !== false) await deps.jobs.watch(FINAL_MINUTES_JOB, meetingId);
    }
    return shown;
  }

  /** The job, if it is this meeting's offered draft (else 409: used, discarded or gone). */
  async function offered(meetingId: string, jobId: string): Promise<AiJobRecord> {
    const job = await store.get(jobId);
    if (job && job.kind === FINAL_MINUTES_JOB && job.subjectId === meetingId && keeping(job)) throw new ConflictError(STILL_KEEPING, 'AI_DRAFT_RUNNING');
    if (!job || job.kind !== FINAL_MINUTES_JOB || job.subjectId !== meetingId || job.status !== 'DONE' || !(job.outcome === null || job.outcome === 'OFFERED')) {
      throw new ConflictError(DRAFT_GONE, 'AI_DRAFT_GONE');
    }
    return job;
  }

  /**
   * "Use it": the offered AI draft becomes the draft — not over final minutes (reopen them first),
   * and only over the minutes as they were read here (one conditional save: a change or an approval
   * at the same moment wins, and the offer stays). Once.
   */
  async function use(meetingId: string, jobId: string): Promise<FinalMinutesRecord> {
    const job = await offered(meetingId, jobId);
    const current = await finalMinutes.get(meetingId);
    if (current?.status === 'APPROVED') throw new ConflictError(MINUTES_LOCKED, 'FINAL_MINUTES_LOCKED');
    if (!(await store.setOutcome(job.id, 'USED', { at: now(), from: [null, 'OFFERED'] }))) throw new ConflictError(DRAFT_GONE, 'AI_DRAFT_GONE');
    const saved = await finalMinutes.saveIfUnchanged(meetingId, current ? current.savedAt : null, {
      content: normalizeFinalMinutes(job.result),
      status: 'DRAFT',
      approvedById: null,
      approvedAt: null,
    });
    if (!saved) {
      await store.setOutcome(job.id, 'OFFERED', { at: now(), from: ['USED'] });
      throw new ConflictError(CHANGED_JUST_NOW, 'FINAL_MINUTES_CHANGED');
    }
    deps.onChanged?.(meetingId);
    return saved;
  }

  /** "Discard": the offered draft, or the failure notice, is put away (nothing else changes). */
  async function discard(meetingId: string, jobId: string): Promise<void> {
    const job = await store.get(jobId);
    if (!job || job.kind !== FINAL_MINUTES_JOB || job.subjectId !== meetingId) throw new ConflictError(DRAFT_GONE, 'AI_DRAFT_GONE');
    if ((job.status !== 'DONE' && job.status !== 'FAILED') || keeping(job)) throw new ConflictError('The AI is still drafting.', 'AI_DRAFT_RUNNING');
    if (job.outcome === 'DISCARDED') return;
    if (!(await store.setOutcome(job.id, 'DISCARDED', { at: now(), from: [null, 'OFFERED', 'LOST'] }))) throw new ConflictError(DRAFT_GONE, 'AI_DRAFT_GONE');
    deps.onChanged?.(meetingId);
  }

  /**
   * Older apps (the Android app before 1.22) wait in the request for the text, as before: the job is
   * followed until it ends or the wait is over — marked watched (no bell) only while the person who
   * asked is the one waiting — and no longer once the app has gone (`gone`). Its text is saved as the
   * draft too, by the rule above.
   */
  async function waitForContent(jobId: string, meetingId: string, viewerId: string, gone?: AbortSignal): Promise<FinalMinutesContent> {
    const until = Date.now() + (deps.legacyWaitMs ?? LEGACY_WAIT_MS);
    const pollMs = deps.pollMs ?? 500;
    for (;;) {
      const job = await store.get(jobId);
      if (!job) throw new ConflictError(DRAFT_GONE, 'AI_DRAFT_GONE');
      if (job.status === 'DONE') return normalizeFinalMinutes(job.result);
      if (job.status === 'FAILED') throw new HttpError(job.error?.message ?? FAILED, job.error?.code ?? 'AI_DRAFT_FAILED', job.error?.status ?? 500);
      if (job.status === 'CANCELLED') throw new ConflictError('The AI draft was stopped.', 'AI_DRAFT_STOPPED');
      if (Date.now() >= until || gone?.aborted) throw new ConflictError(STILL_RUNNING, 'AI_DRAFT_RUNNING');
      if (job.requestedById === viewerId) await deps.jobs.watch(FINAL_MINUTES_JOB, meetingId);
      await new Promise((r) => setTimeout(r, pollMs));
    }
  }

  return { handler, start, view, viewOf, use, discard, waitForContent };
}

export type FinalMinutesAi = ReturnType<typeof createFinalMinutesAi>;
