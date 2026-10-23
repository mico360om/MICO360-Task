import type { DailyEmailKind, DailyEmailOverviewEmail, DailyEmailSendNowResult, DailyEmailSendResult, DailyEmailState } from '../../api/daily-emails';
import { zonedDayKey } from '../../lib/due-date';

/** The plain words for the daily emails on the admins' page (System Settings → Daily task emails). */

export const KIND_LABEL: Record<DailyEmailKind, string> = { PENDING: 'Pending tasks', COMPLETED: 'Completed yesterday' };

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

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

export type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';
export const STATE_TONE: Record<DailyEmailState, Tone> = {
  SENT: 'success', SKIPPED: 'neutral', DUE: 'info', SENDING: 'info', RETRY: 'warning', FAILED: 'danger', OFF: 'neutral', NONE: 'neutral',
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
      return 'Skipped — nothing to send';
    case 'DUE':
      if (!e.dueAt) return 'Still to come';
      return new Date(e.dueAt).getTime() > now.getTime() ? `Still to come at ${when(e.dueAt, timeZone, now)}` : `Due since ${when(e.dueAt, timeZone, now)} — not sent yet`;
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

/** How "Send today's emails now" went, in a sentence or a few. */
export function sendNowText(r: DailyEmailSendNowResult): string {
  const parts = [r.sent ? `Sent ${plural(r.sent, 'email')}.` : 'No emails were sent.'];
  if (r.skipped) parts.push(`${r.skipped} had nothing to send.`);
  if (r.failed) {
    if (r.retrying === r.failed) parts.push(`${r.failed} couldn’t be sent; ${r.failed === 1 ? 'it' : 'they'} will be tried again.`);
    else if (r.retrying) parts.push(`${r.failed} couldn’t be sent (${r.retrying} will be tried again).`);
    else parts.push(`${r.failed} couldn’t be sent.`);
  }
  if (r.alreadyDone) parts.push(`${r.alreadyDone} ${r.alreadyDone === 1 ? 'was' : 'were'} already done today.`);
  return parts.join(' ');
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
    case 'already-sent':
      return { ok: true, text: `${r.name} already got today’s ${label} email${one.sentAt ? ` at ${when(one.sentAt, timeZone)}` : ''}.` };
    case 'already-done':
      return { ok: true, text: `Today’s ${label} email for ${r.name} is already done.` };
    case 'busy':
      return { ok: true, text: `The ${label} email to ${r.name} is being sent right now.` };
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
