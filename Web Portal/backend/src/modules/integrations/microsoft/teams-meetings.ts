import type { MeetingChangeKind } from '../../meetings/meeting-service';
import type { MeetingRecord } from '../../meetings/meeting-repository';
import { MicrosoftError, type MicrosoftClient } from './microsoft-client';
import { NotConnectedError, type MicrosoftConnections } from './microsoft-connections';
import type { TeamsLinkRow, TeamsLinkStore } from './teams-link-store';

/**
 * Automatic Teams links on meetings (1.23, part B). The organizer's own Microsoft account makes a Teams
 * meeting (POST /me/onlineMeetings: subject, start, end) and its join link becomes the meeting's online
 * link; a repeating family shares one Teams meeting. Afterwards the Teams meeting follows the meetings
 * that use it, in the background (coalesced per Teams meeting): a new time or title updates it, a new
 * repeat stretches its end, and when no meeting uses it any more (cancelled, deleted, link taken away)
 * it is deleted — tried again later when Microsoft refuses for a moment, and swept up daily if every try
 * failed. A meeting is always saved: when Microsoft can't be reached or refuses, the meeting waits for
 * its link ("The Teams link couldn't be made — try again" and Make Teams link).
 *
 * Only the organizer's own connection is ever used: a link is made only when the organizer asks, and a
 * Teams meeting is changed or deleted only with the account that made it while that person is still the
 * organizer (after a handover the link simply stays as it is).
 */

export type TeamsNoticeCode = 'TEAMS_FAILED' | 'TEAMS_NOT_CONNECTED' | 'TEAMS_NOT_ORGANIZER' | 'TEAMS_UNAVAILABLE' | 'TEAMS_NOT_OPEN';
export interface TeamsNotice {
  code: TeamsNoticeCode;
  message: string;
}

export const TEAMS_FAILED_MESSAGE = 'The Teams link couldn’t be made — try again.';
const NOTICE_TEXT: Record<TeamsNoticeCode, string> = {
  TEAMS_FAILED: TEAMS_FAILED_MESSAGE,
  TEAMS_NOT_CONNECTED: 'The Teams link couldn’t be made: connect Microsoft Teams in Settings, then press Make Teams link.',
  TEAMS_NOT_ORGANIZER: 'Only the meeting’s organizer can make its Teams link, with their own Microsoft account.',
  TEAMS_UNAVAILABLE: 'Teams links aren’t set up on this site.',
  TEAMS_NOT_OPEN: 'A cancelled or finished meeting doesn’t get a Teams link.',
};
const notice = (code: TeamsNoticeCode): TeamsNotice => ({ code, message: NOTICE_TEXT[code] });

export interface TeamsMeetingsDeps {
  /** Null when Teams links aren't set up on this server (the feature is hidden). */
  connections: Pick<MicrosoftConnections, 'accessToken' | 'forgetAccess'> | null;
  client: Pick<MicrosoftClient, 'createMeeting' | 'updateMeeting' | 'deleteMeeting'> | null;
  store: TeamsLinkStore;
  now?: () => Date;
  logger?: { warn(msg: string, ctx?: Record<string, unknown>): void; info?(msg: string, ctx?: Record<string, unknown>): void };
  /** How long background work waits to gather the changes of one save (100 ms). */
  delayMs?: number;
  /** The waits before a refused delete is tried again (30 s, 2 min, 10 min); the daily sweep does the rest. */
  retryDelaysMs?: number[];
}

const HOUR = 3_600_000;
const endOf = (r: Pick<TeamsLinkRow, 'startAt' | 'endAt'>) => r.endAt ?? new Date(r.startAt.getTime() + HOUR);
const isOpen = (r: Pick<TeamsLinkRow, 'status'>) => r.status !== 'CANCELLED' && r.status !== 'COMPLETED';

interface Pending {
  /** Something stopped using it (cancelled, deleted, link taken away): delete it if nothing else does. */
  removed: boolean;
  ownerId: string | null;
  organizerId: string | null;
  /** The Teams join link, when the caller knows it (taking the link away); else read from the meetings. */
  joinUrl: string | null;
  /** Tries of a delete so far. */
  attempt?: number;
}

export function createTeamsMeetings(deps: TeamsMeetingsDeps) {
  const { store } = deps;
  const now = deps.now ?? (() => new Date());
  const delayMs = deps.delayMs ?? 100;
  const retryDelays = deps.retryDelaysMs ?? [30_000, 120_000, 600_000];
  const available = Boolean(deps.connections && deps.client);
  /** What each Teams meeting was last told (subject|start|end), so an unrelated change calls nobody. */
  const lastSent = new Map<string, string>();
  const queue = new Map<string, Pending>();
  const hooks = new Set<Promise<void>>();
  const retries = new Set<ReturnType<typeof setTimeout>>();
  /** One make at a time per meeting family: a double press makes one Teams meeting. */
  const making = new Map<string, Promise<{ made: boolean; notice: TeamsNotice | null }>>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let chain: Promise<void> = Promise.resolve();

  const warn = (msg: string, err: unknown, ctx: Record<string, unknown> = {}) =>
    deps.logger?.warn(msg, { ...ctx, ...(err instanceof MicrosoftError ? { kind: err.kind, status: err.status, code: err.code } : { reason: err instanceof Error ? err.name : 'unknown' }) });

  /** Runs `fn` with the person's access token; a 401 gets a fresh token and one more try. */
  async function withAccess<T>(userId: string, fn: (token: string) => Promise<T>): Promise<T> {
    const connections = deps.connections!;
    const token = await connections.accessToken(userId);
    try {
      return await fn(token);
    } catch (err) {
      if (!(err instanceof MicrosoftError && err.kind === 'auth' && err.status === 401)) throw err;
      connections.forgetAccess(userId);
      return fn(await connections.accessToken(userId));
    }
  }

  const spanKey = (s: { subject: string; start: Date; end: Date }) => `${s.subject}|${s.start.toISOString()}|${s.end.toISOString()}`;

  /**
   * The meetings a new link is for: this one, and a repeating family's upcoming meetings that have no
   * Teams meeting and the same link as this one (a repeat given its own link keeps it). Security review
   * (1.23): only those with the same organizer — a repeat handed over to someone else is theirs, and
   * their Microsoft account never hosts (or takes away) the rest of the family's link.
   */
  async function targetsOf(row: TeamsLinkRow): Promise<TeamsLinkRow[]> {
    if (!row.rootId) return [row];
    const t = now().getTime();
    const rows = (await store.family(row.rootId)).filter(
      (r) =>
        r.id === row.id ||
        (r.organizerId === row.organizerId && !r.teamsId && isOpen(r) && endOf(r).getTime() > t && (r.onlineLink ?? null) === (row.onlineLink ?? null)),
    );
    return rows.some((r) => r.id === row.id) ? rows : [row, ...rows];
  }

  async function make(row: TeamsLinkRow): Promise<{ made: boolean; notice: TeamsNotice | null }> {
    const targets = await targetsOf(row);
    const ids = targets.map((r) => r.id);
    const span = {
      subject: row.title,
      start: new Date(Math.min(...targets.map((r) => r.startAt.getTime()))),
      end: new Date(Math.max(...targets.map((r) => endOf(r).getTime()))),
    };
    const waitForLink = () => store.write(ids, { provider: 'TEAMS', teamsId: null, ownerId: null }).catch((err) => warn('Microsoft Teams: marking a meeting as waiting for its link failed', err));
    let made: { id: string; joinWebUrl: string };
    try {
      made = await withAccess(row.organizerId, (token) => deps.client!.createMeeting(token, span));
    } catch (err) {
      // Saved anyway: the meeting waits for its link.
      await waitForLink();
      if (err instanceof NotConnectedError) return { made: false, notice: notice('TEAMS_NOT_CONNECTED') };
      warn('Microsoft Teams: the Teams link couldn’t be made', err, { meetingId: row.id });
      return { made: false, notice: notice('TEAMS_FAILED') };
    }
    try {
      await store.write(ids, { onlineLink: made.joinWebUrl, provider: 'TEAMS', teamsId: made.id, ownerId: row.organizerId });
    } catch (err) {
      // Made at Microsoft but not kept here: take it back, so no Teams meeting is left over.
      warn('Microsoft Teams: the new Teams link couldn’t be saved; its Teams meeting is deleted again', err, { meetingId: row.id });
      await withAccess(row.organizerId, (token) => deps.client!.deleteMeeting(token, made.id)).catch((e) => warn('Microsoft Teams: deleting the unsaved Teams meeting failed', e, { meetingId: row.id }));
      await waitForLink();
      return { made: false, notice: notice('TEAMS_FAILED') };
    }
    lastSent.set(made.id, spanKey(span));
    deps.logger?.info?.('Microsoft Teams: a Teams link was made', { meetingId: row.id, meetings: ids.length });
    return { made: true, notice: null };
  }

  /** Make the Teams link (the organizer only, with their own account). */
  async function makeLink(meetingId: string, actor: { id: string }): Promise<{ made: boolean; notice: TeamsNotice | null }> {
    if (!available) return { made: false, notice: notice('TEAMS_UNAVAILABLE') };
    const row = await store.get(meetingId);
    if (!row || row.deletedAt) return { made: false, notice: notice('TEAMS_FAILED') };
    if (row.teamsId) return { made: false, notice: null };
    if (actor.id !== row.organizerId) return { made: false, notice: notice('TEAMS_NOT_ORGANIZER') };
    if (!isOpen(row)) return { made: false, notice: notice('TEAMS_NOT_OPEN') };
    const key = row.rootId ?? row.id;
    const running = making.get(key);
    if (running) {
      await running.catch(() => undefined);
      return { made: false, notice: null };
    }
    const job = make(row).finally(() => making.delete(key));
    making.set(key, job);
    return job;
  }

  function schedule(teamsId: string, p: Pending, wait = delayMs): void {
    if (!available) return;
    if (wait > delayMs) {
      // A delete to try again later (its own timer; the queue takes it then).
      const t = setTimeout(() => {
        retries.delete(t);
        schedule(teamsId, p);
      }, wait);
      t.unref?.();
      retries.add(t);
      return;
    }
    const had = queue.get(teamsId);
    queue.set(
      teamsId,
      had
        ? { removed: had.removed || p.removed, ownerId: had.ownerId ?? p.ownerId, organizerId: had.organizerId ?? p.organizerId, joinUrl: had.joinUrl ?? p.joinUrl, attempt: Math.max(had.attempt ?? 0, p.attempt ?? 0) }
        : p,
    );
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      chain = chain.then(drain).catch(() => undefined);
    }, delayMs);
  }

  async function drain(): Promise<void> {
    while (queue.size) {
      const batch = [...queue];
      queue.clear();
      for (const [teamsId, p] of batch) {
        try {
          await reconcile(teamsId, p);
        } catch (err) {
          warn('Microsoft Teams: keeping a Teams meeting in step failed', err);
        }
      }
    }
  }

  /** Delete a Teams meeting nothing uses any more: 'kept' after a handover, 'failed' to try again later. */
  async function deleteUnused(teamsId: string, p: Pending, rows: TeamsLinkRow[]): Promise<'deleted' | 'kept' | 'failed'> {
    const owner = rows[0]?.ownerId ?? p.ownerId;
    const organizer = rows[0]?.organizerId ?? p.organizerId;
    if (!owner || owner !== organizer) {
      deps.logger?.info?.('Microsoft Teams: a Teams meeting was left as it is (its organizer changed)');
      return 'kept';
    }
    try {
      await withAccess(owner, (token) => deps.client!.deleteMeeting(token, teamsId));
    } catch (err) {
      if (err instanceof NotConnectedError) {
        deps.logger?.info?.('Microsoft Teams: a Teams meeting couldn’t be deleted (its owner isn’t connected)');
        return 'failed';
      }
      warn('Microsoft Teams: a Teams meeting couldn’t be deleted', err);
      return 'failed';
    }
    const joinUrl = p.joinUrl ?? rows.find((r) => r.provider === 'TEAMS' && r.onlineLink)?.onlineLink ?? null;
    await store.forget(teamsId, joinUrl);
    lastSent.delete(teamsId);
    return 'deleted';
  }

  /** Bring one Teams meeting in line with the meetings that use it. */
  async function reconcile(teamsId: string, p: Pending): Promise<void> {
    const rows = await store.using(teamsId);
    const live = rows.filter((r) => r.status !== 'CANCELLED');
    if (p.removed && live.length === 0) {
      const attempt = (p.attempt ?? 0) + 1;
      if ((await deleteUnused(teamsId, p, rows)) === 'failed' && attempt <= retryDelays.length) {
        schedule(teamsId, { ...p, attempt }, retryDelays[attempt - 1]!);
      }
      return;
    }
    const t = now().getTime();
    const upcoming = live.filter((r) => isOpen(r) && endOf(r).getTime() > t);
    const first = upcoming[0];
    if (!first) return;
    const owner = first.ownerId;
    if (!owner || first.organizerId !== owner) return; // handed over: never another person's account
    const span = { subject: first.title, start: first.startAt, end: new Date(Math.max(...upcoming.map((r) => endOf(r).getTime()))) };
    const key = spanKey(span);
    if (lastSent.get(teamsId) === key) return;
    try {
      await withAccess(owner, (token) => deps.client!.updateMeeting(token, teamsId, span));
      lastSent.set(teamsId, key);
    } catch (err) {
      warn('Microsoft Teams: updating a Teams meeting failed (its link still works)', err, { meetingId: first.id });
    }
  }

  /**
   * The daily sweep: Teams meetings that only cancelled or deleted meetings still hold (every delete try
   * failed, or the server restarted meanwhile) are deleted now. Returns how many were deleted.
   */
  async function sweepLeftovers(): Promise<number> {
    if (!available) return 0;
    let deleted = 0;
    for (const left of await store.leftovers()) {
      const rows = await store.using(left.teamsId);
      if (rows.some((r) => r.status !== 'CANCELLED')) continue; // still in use
      const p: Pending = { removed: true, ownerId: left.ownerId, organizerId: left.organizerId, joinUrl: left.joinUrl };
      try {
        if ((await deleteUnused(left.teamsId, p, rows)) === 'deleted') deleted += 1;
      } catch (err) {
        warn('Microsoft Teams: the daily sweep failed for one Teams meeting', err);
      }
    }
    return deleted;
  }

  /** Untick "Create a Teams link": the meeting (a family: its upcoming meetings) loses it; the Teams meeting goes when nothing uses it. */
  async function removeLink(meetingId: string, joinUrl: string | null): Promise<void> {
    const row = await store.get(meetingId);
    if (!row || row.provider !== 'TEAMS') return;
    const t = now().getTime();
    const targets = row.rootId
      ? (await store.family(row.rootId)).filter(
          (r) => r.provider === 'TEAMS' && (r.id === row.id || (r.organizerId === row.organizerId && isOpen(r) && endOf(r).getTime() > t)) && (r.teamsId === row.teamsId || !r.teamsId),
        )
      : [row];
    if (!targets.some((r) => r.id === row.id)) targets.push(row);
    const url = row.teamsId ? joinUrl : null;
    await store.clear(targets.map((r) => r.id), url);
    if (row.teamsId) schedule(row.teamsId, { removed: true, ownerId: row.ownerId, organizerId: row.organizerId, joinUrl: url });
  }

  /** A hand-pasted link replaced the Teams link: the meetings whose link is no longer the Teams one are plain again. */
  async function plainLinkGiven(meetingId: string, joinUrl: string | null): Promise<void> {
    const row = await store.get(meetingId);
    if (!row || row.provider !== 'TEAMS') return;
    const rows = row.teamsId ? await store.using(row.teamsId) : [row];
    // (A link that was never made — the meeting waiting for it — is plain at once.)
    const changed = rows.filter((r) => r.onlineLink !== joinUrl || (r.id === row.id && !row.teamsId));
    await store.clear(changed.map((r) => r.id), null);
    if (row.teamsId) schedule(row.teamsId, { removed: true, ownerId: row.ownerId, organizerId: row.organizerId, joinUrl });
  }

  /**
   * After a meeting form is saved (create or edit): make the link when it was ticked, take it away when
   * it was unticked, or make it plain when another link was pasted over it (any app). Never throws: the
   * meeting is saved already, so any failure here is the plain notice.
   */
  async function afterSave(input: {
    meetingId: string;
    actor: { id: string };
    /** The "Create a Teams link" tick as sent (undefined: not sent — an older app). */
    wanted?: boolean;
    before?: Pick<MeetingRecord, 'onlineLink' | 'onlineMeetingProvider'> | null;
  }): Promise<{ changed: boolean; notice: TeamsNotice | null }> {
    try {
      const row = await store.get(input.meetingId);
      if (!row || row.deletedAt) return { changed: false, notice: null };
      if (input.wanted === true) {
        if (row.teamsId) return { changed: false, notice: null };
        const out = await makeLink(input.meetingId, input.actor);
        const wrote = out.made || out.notice?.code === 'TEAMS_FAILED' || out.notice?.code === 'TEAMS_NOT_CONNECTED';
        return { changed: wrote, notice: out.notice };
      }
      if (input.wanted === false) {
        if (row.provider !== 'TEAMS') return { changed: false, notice: null };
        await removeLink(input.meetingId, input.before?.onlineLink ?? row.onlineLink);
        return { changed: true, notice: null };
      }
      if (input.before?.onlineMeetingProvider === 'TEAMS' && row.provider === 'TEAMS' && row.onlineLink !== input.before.onlineLink) {
        await plainLinkGiven(input.meetingId, input.before.onlineLink);
        return { changed: true, notice: null };
      }
      return { changed: false, notice: null };
    } catch (err) {
      warn('Microsoft Teams: the Teams step after a save failed (the meeting is saved)', err, { meetingId: input.meetingId });
      return { changed: true, notice: input.wanted === true ? notice('TEAMS_FAILED') : null };
    }
  }

  /**
   * Every meeting change (the meeting and repeat services' onChanged): a new repeat is linked to its
   * family's Teams meeting, and the Teams meeting is brought in step in the background. Never throws.
   */
  function onMeetingChanged(meeting: Pick<MeetingRecord, 'id' | 'onlineMeetingProvider'>, kind: MeetingChangeKind): Promise<void> {
    if (meeting.onlineMeetingProvider !== 'TEAMS') return Promise.resolve();
    const job = (async () => {
      try {
        let row = await store.get(meeting.id);
        if (!row) return;
        if (kind === 'created' && !row.teamsId && row.rootId) {
          const from = (await store.family(row.rootId)).find((r) => r.teamsId && r.onlineLink === row!.onlineLink);
          if (from) {
            await store.write([row.id], { teamsId: from.teamsId, ownerId: from.ownerId });
            row = { ...row, teamsId: from.teamsId, ownerId: from.ownerId };
          }
        }
        if (!row.teamsId) return;
        // (The join link is read from the meetings when it is needed: this one's may be a pasted one now.)
        schedule(row.teamsId, { removed: kind === 'cancelled' || kind === 'deleted', ownerId: row.ownerId, organizerId: row.organizerId, joinUrl: null });
      } catch (err) {
        warn('Microsoft Teams: following a meeting change failed', err, { meetingId: meeting.id });
      }
    })();
    hooks.add(job);
    void job.finally(() => hooks.delete(job));
    return job;
  }

  /** Tests: wait until every background change (retries too) has been carried out. */
  async function idle(): Promise<void> {
    for (let i = 0; i < 400; i++) {
      await Promise.all([...hooks]);
      await new Promise((r) => setTimeout(r, delayMs + 5));
      await chain;
      if (!timer && queue.size === 0 && hooks.size === 0 && retries.size === 0) return;
    }
  }

  return { available, makeLink, removeLink, plainLinkGiven, afterSave, onMeetingChanged, sweepLeftovers, idle };
}

export type TeamsMeetings = ReturnType<typeof createTeamsMeetings>;
