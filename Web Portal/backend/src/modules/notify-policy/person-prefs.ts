import { cleanTime, KIND_TYPES, POLICY_KINDS, type ChannelChoices, type PolicyKind } from './policy';
import type { PersonDeliveryPrefs, PersonQuietHours } from './delivery';

/**
 * A person's own Notification & Scheduling choices, kept in their notification preferences beside the
 * older fields (muted types, lead time, daily email): per kind × channel, their quiet hours, whether
 * meeting reminders and @mentions break through, and "Pause everything except required". Older apps
 * never send these, and a save keeps whatever isn't sent.
 */
export type DeliveryPrefFields = Pick<PersonDeliveryPrefs, 'channels' | 'quietHours' | 'breakThrough' | 'pauseUntil'>;

/** The longest Pause: two weeks. */
export const MAX_PAUSE_MS = 14 * 24 * 60 * 60 * 1000;

const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

export function cleanChannels(v: unknown): ChannelChoices | undefined {
  const raw = obj(v);
  if (!raw) return undefined;
  const out: ChannelChoices = {};
  for (const k of POLICY_KINDS) {
    const c = obj(raw[k]);
    if (!c) continue;
    const one: { bell?: boolean; push?: boolean; email?: boolean } = {};
    for (const ch of ['bell', 'push', 'email'] as const) if (typeof c[ch] === 'boolean') one[ch] = c[ch] as boolean;
    if (Object.keys(one).length) out[k] = one;
  }
  return out;
}

export function cleanQuietHours(v: unknown): PersonQuietHours | undefined {
  const raw = obj(v);
  if (!raw) return undefined;
  const mode = raw.mode === 'custom' || raw.mode === 'off' ? raw.mode : 'company';
  return { mode, start: cleanTime(raw.start) ?? '22:00', end: cleanTime(raw.end) ?? '07:00', daysOff: raw.daysOff !== false };
}

export function cleanBreakThrough(v: unknown): PersonDeliveryPrefs['breakThrough'] | undefined {
  const raw = obj(v);
  if (!raw) return undefined;
  const out: { meetings?: boolean; mentions?: boolean } = {};
  if (typeof raw.meetings === 'boolean') out.meetings = raw.meetings;
  if (typeof raw.mentions === 'boolean') out.mentions = raw.mentions;
  return out;
}

/** A valid instant no more than two weeks after `now`; anything else → undefined. */
export function cleanPauseUntil(v: unknown, now: Date = new Date()): string | undefined {
  if (typeof v !== 'string') return undefined;
  const t = Date.parse(v);
  if (Number.isNaN(t) || t > now.getTime() + MAX_PAUSE_MS + 60_000) return undefined;
  return new Date(t).toISOString();
}

/** The stored delivery fields, cleaned (each absent when unset). A pause already over is dropped. */
export function cleanDeliveryPrefs(raw: Record<string, unknown>, now: Date = new Date()): DeliveryPrefFields {
  const out: DeliveryPrefFields = {};
  const channels = cleanChannels(raw.channels);
  if (channels && Object.keys(channels).length) out.channels = channels;
  const quiet = cleanQuietHours(raw.quietHours);
  if (quiet) out.quietHours = quiet;
  const bt = cleanBreakThrough(raw.breakThrough);
  if (bt && Object.keys(bt).length) out.breakThrough = bt;
  const pause = typeof raw.pauseUntil === 'string' && Date.parse(raw.pauseUntil) > now.getTime() ? cleanPauseUntil(raw.pauseUntil, now) : undefined;
  if (pause) out.pauseUntil = pause;
  return out;
}

/**
 * The website saved channel choices: keep `muted` (what older apps read) in step — a kind's bell off
 * puts all its types on the list, on takes them off.
 */
export function syncMutedWithChannels(muted: string[], channels: ChannelChoices): string[] {
  const set = new Set(muted);
  for (const k of Object.keys(channels) as PolicyKind[]) {
    const bell = channels[k]?.bell;
    if (bell === undefined) continue;
    for (const t of KIND_TYPES[k]) {
      if (bell) set.delete(t);
      else set.add(t);
    }
  }
  return [...set];
}
