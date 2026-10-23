import type {
  DailyEmailKind,
  DailyEmailOverviewEmail,
  DailyEmailSendNowCounts,
  DailyEmailSendNowRun,
  DailyEmailSendResult,
  DailyEmailState,
} from '../../api/daily-emails';
import { zonedDayKey } from '../../lib/due-date';

/** The plain words for the daily emails on the admins' page (System Settings → Daily task emails). */

export const KIND_LABEL: Record<DailyEmailKind, string> = { PENDING: 'Pending tasks', COMPLETED: 'Completed yesterday' };

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const wasWere = (n: number) => (n === 1 ? 'was' : 'were');

/** "07:01" in a time zone. */
export function clock(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
}
/** "Sat 24 Oct" for a 'YYYY-MM-DD' day. */
export function dayLabel(key: string): string {
  return new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${key}T12:00:00Z`)).replace(',', '');
}
/** "07:01" today (in that time zone), else "Sat 24 Oct, 07:01". */
export function when(iso: string, timeZone: string, now: Date = new Date()): string {
  const day = zonedDayKey(new Date(iso), timeZone);
  return day === zonedDayKey(now, timeZone) ? clock(iso, timeZone) : `${dayLabel(day)}, ${clock(iso, timeZone)}`;
}

/** The next send: "due now", "today at 06:00", "tomorrow at 06:00" or "Sat 24 Oct at 06:00". */
export function nextSendText(iso: string | null, timeZone: string, now: Date = new Date()): string {
  if (!iso) return 'nothing planned (no one gets these emails)';
  if (new Date(iso).getTime() <= now.getTime()) return 'due now';
  const day = zonedDayKey(new Date(iso), timeZone);
  const today = zonedDayKey(now, timeZone);
  const tomorrow = zonedDayKey(new Date(Date.parse(`${today}T12:00:00Z`) + 864e5), 'UTC');
  const at = clock(iso, timeZone);
  return day === today ? `today at ${at}` : day === tomorrow ? `tomorrow at ${at}` : `${dayLabel(day)} at ${at}`;
}

/** The server isn't checking although emails are due: when it last did, said plainly. */
export function checkLateText(lastCheckedAt: string | null, timeZone: string, now: Date = new Date()): string {
  return lastCheckedAt
    ? `The server hasn’t checked since ${when(lastCheckedAt, timeZone, now)} — emails due since then haven’t gone.`
    : 'The server hasn’t checked yet — emails that are due haven’t gone.';
}

export type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';
export const STATE_TONE: Record<DailyEmailState, Tone> = {
  SENT: 'success', SKIPPED: 'neutral', DUE: 'info', LATE: 'warning', SENDING: 'info', RETRY: 'warning', FAILED: 'danger', OFF: 'neutral', NONE: 'neutral',
};

/** One email's state on the day shown, in the person's own time zone. */
export function stateText(e: DailyEmailOverviewEmail, timeZone: string, now: Date = new Date()): string {
  switch (e.state) {
    case 'SENT': {
      const parts = [e.sentAt ? `Sent at ${when(e.sentAt, timeZone, now)}` : 'Sent', plural(e.taskCount, 'task')];
      if (e.attempts > 1) parts.push(plural(e.attempts, 'attempt'));
      if (e.lastError) parts.push(`the last resend didn’t go: ${e.lastError}`);
      return parts.join(' · ');
    }
    case 'SKIPPED':
      // Why, when there was another reason than an empty email (a blocked address, no longer active).
      return e.lastError ? `Skipped — ${e.lastError}` : 'Skipped — nothing to send';
    case 'DUE':
      if (!e.dueAt) return 'Still to come';
      return new Date(e.dueAt).getTime() > now.getTime() ? `Still to come at ${when(e.dueAt, timeZone, now)}` : `Due since ${when(e.dueAt, timeZone, now)} — not sent yet`;
    case 'LATE':
      return e.dueAt ? `Due since ${when(e.dueAt, timeZone, now)} — not sent yet` : 'Due — not sent yet';
    case 'SENDING':
      return 'Being sent now…';
    case 'RETRY':
      return `Retrying${e.nextAttemptAt ? ` at ${when(e.nextAttemptAt, timeZone, now)}` : ''} (${plural(e.attempts, 'attempt')} so far)${e.lastError ? `: ${e.lastError}` : ''}`;
    case 'FAILED':
      return `Failed after ${plural(e.attempts, 'attempt')}${e.lastError ? `: ${e.lastError}` : ''}`;
    case 'OFF':
      return 'Turned off';
    case 'NONE':
      return 'No email that day';
    default:
      return String(e.state); // a state this page doesn't know yet (a newer server), as it is
  }
}

/** How many people match the search and filters: "3 people match". */
export function matchCountText(n: number): string {
  return n === 0 ? 'No one matches' : n === 1 ? '1 person matches' : `${n} people match`;
}

/** How "Send today's emails now" went, in a sentence or a few. */
export function sendNowText(r: Partial<DailyEmailSendNowCounts>): string {
  const n = (k: keyof DailyEmailSendNowCounts) => r[k] ?? 0;
  const parts = [n('sent') ? `Sent ${plural(n('sent'), 'email')}.` : 'No emails were sent.'];
  if (n('skipped')) parts.push(`${n('skipped')} had nothing to send.`);
  if (n('blocked')) parts.push(`${n('blocked')} ${wasWere(n('blocked'))} not sent: the address is blocked after a bounce or spam complaint.`);
  const failed = n('failed');
  const retrying = n('retrying');
  if (failed) {
    if (retrying === failed) parts.push(`${failed} couldn’t be sent; ${failed === 1 ? 'it' : 'they'} will be tried again.`);
    else if (retrying) parts.push(`${failed} couldn’t be sent (${retrying} will be tried again).`);
    else parts.push(`${failed} couldn’t be sent.`);
  }
  if (n('errors')) parts.push(`${n('errors')} ran into a problem on the server; the server tries ${n('errors') === 1 ? 'it' : 'them'} again by itself.`);
  if (n('sending')) parts.push(`${n('sending')} ${wasWere(n('sending'))} already being sent.`);
  if (n('alreadyDone')) parts.push(`${n('alreadyDone')} ${wasWere(n('alreadyDone'))} already done today.`);
  if (n('notYet')) parts.push(`${n('notYet')} ${n('notYet') === 1 ? 'isn’t' : 'aren’t'} due yet and will go at the person’s own time.`);
  return parts.join(' ');
}

/** How far "Send today's emails now" has got: "Sending today's emails… 34 of 120 people done." */
export function runProgressText(run: DailyEmailSendNowRun): string {
  return run.total === null ? 'Sending today’s emails…' : `Sending today’s emails… ${run.done} of ${run.total} ${run.total === 1 ? 'person' : 'people'} done.`;
}

/** A finished "Send today's emails now", read out when it ends: "Today's emails: sent 9 emails. …". */
export function runDoneText(run: DailyEmailSendNowRun): string {
  const text = sendNowText(run.counts);
  const said = `Today’s emails: ${text.charAt(0).toLowerCase()}${text.slice(1)}`;
  return run.error ? `${said} It stopped early: ${run.error}` : said;
}

/** How one person's email went: the words, and whether it is a problem. */
export function sendResultText(r: DailyEmailSendResult, resend: boolean, timeZone: string): { ok: boolean; text: string } {
  const one = r.results[0];
  if (!one) return { ok: true, text: 'Nothing was sent.' };
  const label = KIND_LABEL[one.kind] ?? one.kind;
  switch (one.outcome) {
    case 'sent':
      return { ok: true, text: `Sent the ${label} email to ${r.name}${resend ? ' again' : ''}.` };
    case 'empty':
      return resend
        ? { ok: true, text: `There’s nothing in the ${label} email now, so it wasn’t sent again. The one they got earlier still counts.` }
        : { ok: true, text: `There’s nothing in the ${label} email for ${r.name} right now, so it wasn’t sent.` };
    case 'blocked':
      return resend
        ? { ok: false, text: `Not sent again: ${r.name}’s address is blocked after a bounce or spam complaint. The one they got earlier still counts.` }
        : { ok: false, text: `Not sent: ${r.name}’s address is blocked after a bounce or spam complaint.` };
    case 'already-sent':
      return { ok: true, text: `${r.name} already got today’s ${label} email${one.sentAt ? ` at ${when(one.sentAt, timeZone)}` : ''}.` };
    case 'already-done':
      return { ok: true, text: `Today’s ${label} email for ${r.name} is already done.` };
    case 'busy':
      return { ok: true, text: `The ${label} email to ${r.name} is being sent right now.` };
    case 'not-yet':
      return { ok: true, text: `It isn’t ${r.name}’s time yet${r.time ? ` (${r.time}, their time)` : ''}, so it wasn’t sent.` };
    case 'retry':
      return { ok: false, text: `Couldn’t send the ${label} email${one.error ? ` (${one.error})` : ''}. It will be tried again in a few minutes.` };
    case 'failed':
      return resend
        ? { ok: false, text: `Couldn’t send the ${label} email again${one.error ? ` (${one.error})` : ''}. The one they got earlier still counts.` }
        : { ok: false, text: `Couldn’t send the ${label} email${one.error ? ` (${one.error})` : ''}.` };
    case 'off':
      return { ok: false, text: `${r.name} turned this email off.` };
    default:
      return { ok: true, text: String(one.outcome) };
  }
}
