import { el } from '../dom.js';
import { AnswerControl } from './answer.js';
import {
  isUnderWay, startsLabel, formatClockTime, formatMeetingDay, formatMeetingTimes, safeJoinLink, meetingPlace, canAnswer,
} from '../../src/meetings.js';

/**
 * "Up next": the meeting under way, or the next one to come — when it starts, where, which project,
 * how many are coming; Join for an online one (a secure link only, in a new tab), Open (its page
 * here), and your answer when you are invited. As the web's UpNextCard, on Meetings and the Dashboard.
 * `attendee`: your row on it, or null when you aren't invited (or it couldn't be read).
 */
export function UpNext(ctx, m, { attendee = null, project = null, now = new Date() } = {}) {
  const tz = ctx.timeZone;
  const live = isUnderWay(m, now);
  const when = live ? (m.endAt ? `until ${formatClockTime(m.endAt, tz)}` : 'Happening now') : startsLabel(m, now, tz);
  const join = safeJoinLink(m.onlineLink);
  const place = meetingPlace(m);
  const people = typeof m.attendeeCount === 'number' ? m.attendeeCount : (m.attendees || []).length;
  return el('section', { class: `card mt-upnext${live ? ' live' : ''}`, 'aria-label': 'Up next' },
    el('div', { class: 'mt-upnext-main' },
      el('p', { class: 'mt-upnext-when' },
        el('span', { class: 'mt-upnext-tag' }, live ? 'Under way' : 'Up next'),
        el('span', { 'aria-hidden': 'true' }, ' · '),
        el('span', { class: 'mt-upnext-at' }, when)),
      el('p', { class: 'mt-upnext-title', dir: 'auto' }, m.title),
      el('p', { class: 'muted mt-upnext-meta' },
        el('span', {}, `${formatMeetingDay(m.startAt, tz)} · ${formatMeetingTimes(m.startAt, m.endAt, tz)}`),
        place ? el('span', { dir: 'auto' }, ` · ${place}`) : null,
        el('span', { dir: 'auto' }, ` · ${project ? project.name : 'Standalone'}`),
        people ? el('span', {}, ` · ${people} ${people === 1 ? 'person' : 'people'}`) : null)),
    el('div', { class: 'mt-upnext-actions' },
      join ? el('a', { class: 'btn primary', href: join, target: '_blank', rel: 'noopener noreferrer' }, 'Join') : null,
      el('button', { class: `btn${join ? '' : ' primary'}`, type: 'button', 'aria-label': `Open ${m.title}`, onClick: () => ctx.navigate(`#/meeting/${encodeURIComponent(m.id)}`) }, 'Open')),
    attendee && canAnswer(m) ? AnswerControl(ctx, { meeting: m, attendee }) : null);
}
