import { isWorkingDay, minutesOf, shiftDay, zonedClock, zonedDay, zonedInstant, type WorkCalendar, type WorkHours } from '../../lib/working-days';
import { channelsForType, cleanTime, policyKindOfType, type ChannelChoices, type NotificationPolicy, type PolicyKind } from './policy';

/**
 * What happens to one notice for one person (Notification & Scheduling centre): the bell (the in-app
 * notice), the phone push and the email — each now, held until quiet hours end, or not at all.
 *
 *   - Quiet hours (the company's: outside working hours and on days off, unless it set nightly hours;
 *     or the person's own, in their own time zone): the bell still fills, the push and email wait for
 *     the next working morning and then go as one bundled message.
 *   - Meeting reminders and @mentions (and direct messages, which are addressed to the person like a
 *     mention) come through quiet hours unless the person turned that off.
 *   - Pause: everything not required loses its push and email (the bell fills); a required kind's push
 *     waits for the pause — and any quiet hours after it — to end.
 *   - Answers to the person's own requests (MICO AI) are never held.
 */

/** A person's own quiet hours: the company's, their own (in their time zone), or none. */
export interface PersonQuietHours {
  mode: 'company' | 'custom' | 'off';
  start: string;
  end: string;
  /** Days off (weekends and holidays) quiet all day too. */
  daysOff: boolean;
}

/** The preferences delivery reads (a subset of the stored notification preferences). */
export interface PersonDeliveryPrefs {
  muted: string[];
  channels?: ChannelChoices;
  quietHours?: PersonQuietHours;
  /** Whether meeting reminders / @mentions come through quiet hours (unset: the company's default). */
  breakThrough?: { meetings?: boolean; mentions?: boolean };
  /** "Pause everything except required" until this instant (ISO). */
  pauseUntil?: string;
}

export interface DeliveryContext {
  now: Date;
  /** The person's company's rules (their primary company). */
  policy: NotificationPolicy;
  /** That company's working days and holidays, and its working hours. */
  calendar: WorkCalendar;
  hours: WorkHours;
  /** The site's (company) time zone, and the person's own. */
  companyZone: string;
  personZone: string;
}

export type ChannelAction = 'now' | 'hold' | 'off';

export interface DeliveryDecision {
  kind: PolicyKind | null;
  bell: boolean;
  push: ChannelAction;
  email: ChannelAction;
  /** When held pushes and emails go (null when nothing is held). */
  releaseAt: Date | null;
}

/** Answers to the person's own requests: never held. */
const OWN_REQUEST_TYPES = new Set(['MICO_AI_ANSWER', 'MICO_AI_FAILED', 'AI_DRAFT_READY', 'AI_DRAFT_FAILED']);
/** Kindless types that come through quiet hours with @mentions (a direct message is addressed to the person). */
const LIKE_MENTIONS = new Set(['CHAT_MESSAGE']);

/** Quiet from `start` until `end` (wrapping past midnight when `start` is later), in `zone`; days off quiet all day. */
export interface QuietSpec {
  zone: string;
  start: string;
  end: string;
  daysOff: boolean;
  calendar: WorkCalendar;
  /** Never quiet. */
  off?: boolean;
}

/** The quiet hours in force for a person. */
export function quietSpecFor(prefs: PersonDeliveryPrefs, ctx: DeliveryContext): QuietSpec {
  const own = prefs.quietHours;
  if (own?.mode === 'off') return { zone: ctx.personZone, start: '00:00', end: '00:00', daysOff: false, calendar: ctx.calendar, off: true };
  if (own?.mode === 'custom') {
    return { zone: ctx.personZone, start: cleanTime(own.start) ?? '22:00', end: cleanTime(own.end) ?? '07:00', daysOff: own.daysOff !== false, calendar: ctx.calendar };
  }
  const q = ctx.policy.quietHours;
  // The company default: quiet from the end of the working day until its start, days off all day.
  if (q.mode === 'workingHours') return { zone: ctx.companyZone, start: ctx.hours.end, end: ctx.hours.start, daysOff: true, calendar: ctx.calendar };
  return { zone: ctx.companyZone, start: q.start, end: q.end, daysOff: true, calendar: ctx.calendar };
}

export function isQuiet(at: Date, spec: QuietSpec): boolean {
  if (spec.off) return false;
  const { day, minutes } = zonedClock(at, spec.zone);
  if (spec.daysOff && !isWorkingDay(day, spec.calendar)) return true;
  const s = minutesOf(spec.start);
  const e = minutesOf(spec.end);
  if (s === e) return false;
  return s < e ? minutes >= s && minutes < e : minutes >= s || minutes < e;
}

/** When the quiet hours `at` is in end (null when it isn't quiet, or they never end). */
export function quietEnd(at: Date, spec: QuietSpec): Date | null {
  if (!isQuiet(at, spec)) return null;
  let day = zonedDay(at, spec.zone);
  for (let i = 0; i < 3 * 366; i++, day = shiftDay(day, 1)) {
    // Quiet ends either at a day's end-of-quiet time or at a midnight (leaving a day off).
    const candidates = [zonedInstant(day, '00:00', spec.zone), zonedInstant(day, spec.end, spec.zone)].sort((a, b) => a.getTime() - b.getTime());
    for (const c of candidates) if (c.getTime() > at.getTime() && !isQuiet(c, spec)) return c;
  }
  return null;
}

const later = (a: Date, b: Date | null): Date => (b && b.getTime() > a.getTime() ? b : a);

/** Decide the bell, push and email of one notice (`expiresAt`: a held push after it is pointless, e.g. a meeting's start). */
export function decideDelivery(type: string, prefs: PersonDeliveryPrefs, ctx: DeliveryContext, opts: { expiresAt?: Date | null } = {}): DeliveryDecision {
  const ch = channelsForType(prefs, type, ctx.policy);
  const kind = policyKindOfType(type);
  const bell = ch ? ch.bell : !prefs.muted.includes(type);
  const required = ch?.required ?? false;
  const wantPush = ch ? ch.push : bell;
  const wantEmail = ch ? ch.email : false;
  const none: DeliveryDecision = { kind, bell, push: wantPush ? 'now' : 'off', email: wantEmail ? 'now' : 'off', releaseAt: null };
  if (OWN_REQUEST_TYPES.has(type)) return none;

  const now = ctx.now;
  const spec = quietSpecFor(prefs, ctx);
  const pauseUntil = prefs.pauseUntil ? new Date(prefs.pauseUntil) : null;
  const paused = !!pauseUntil && !Number.isNaN(pauseUntil.getTime()) && pauseUntil.getTime() > now.getTime();

  let releaseAt: Date | null = null;
  if (paused) {
    if (!required) return { ...none, push: 'off', email: 'off' };
    releaseAt = later(pauseUntil!, quietEnd(pauseUntil!, spec));
  } else {
    const end = quietEnd(now, spec);
    if (!end) return none;
    const bt = { meetings: prefs.breakThrough?.meetings ?? ctx.policy.quietHours.meetings, mentions: prefs.breakThrough?.mentions ?? ctx.policy.quietHours.mentions };
    const through = (kind === 'meetings' && bt.meetings) || ((kind === 'mentions' || LIKE_MENTIONS.has(type)) && bt.mentions);
    if (through) return none;
    releaseAt = end;
  }
  const expired = !!opts.expiresAt && releaseAt.getTime() >= opts.expiresAt.getTime();
  const held = (want: boolean): ChannelAction => (!want || expired ? 'off' : 'hold');
  const push = held(wantPush);
  const email = held(wantEmail);
  return { kind, bell, push, email, releaseAt: push === 'hold' || email === 'hold' ? releaseAt : null };
}
