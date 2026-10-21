import { el, mount, Loader, ErrorState, Empty } from '../dom.js';
import { UpNext } from '../meeting/up-next.js';
import {
  nextUpMeeting, upcomingGroups, isUnderWay, formatMeetingTimes, meetingPlace, meetingStatusLabel, myInvitation, myAnswerText, answersFor, meetingWebUrl,
} from '../../src/meetings.js';
import { seriesIdOf } from '../../src/calendar.js';
import { todayKey, zonedDayKey } from '../../src/due-date.js';

/** Meetings whose answers are looked up (the soonest): each is one small read. */
const ANSWERS_READ = 12;

const rows = (v) => (Array.isArray(v) ? v : []);

/**
 * Meetings (light, Stage 6): "Up next" on top — Join, Open and your answer — then the upcoming
 * meetings in Today, Next 7 days and Later, as the web groups them, each with your answer when you
 * are invited. A meeting opens its page here; past meetings, drafts, notes and minutes are on the
 * website. Days and times are in company time, as on the web's list. Reads work offline (saved).
 */
export function MeetingsScreen(ctx) {
  const root = el('div', { class: 'mt-screen' });
  let loaded = false;
  root.refresh = () => { void load(); return true; };
  void load();
  return root;

  async function load() {
    if (!loaded) mount(root, Loader('Loading meetings…'));
    let list;
    let projects = [];
    let directory = [];
    try {
      const [m, p, d] = await Promise.all([
        ctx.api.meetings.list(),
        ctx.api.projects.list().catch(() => null),
        (ctx.api.directory ? ctx.api.directory() : Promise.resolve(null)).catch(() => null),
      ]);
      list = m;
      projects = rows(p && p.data);
      directory = rows(d && d.data);
    } catch {
      if (!loaded) mount(root, ErrorState('Couldn’t load meetings. Check your connection and try again.', () => load()));
      return;
    }
    const now = new Date();
    const all = rows(list.data);
    const up = nextUpMeeting(all, now);
    const groups = upcomingGroups(all, { timeZone: ctx.timeZone, now });
    // Your answers: the people of the soonest meetings (each read is kept for offline).
    const soon = [...new Set([up, ...groups.filter((g) => g.key !== 'later').flatMap((g) => g.items)].filter(Boolean))].slice(0, ANSWERS_READ);
    const people = await Promise.all(soon.map((m) => ctx.api.meetings.attendees(m.id)
      .then((r) => ({ meetingId: m.id, people: rows(r && r.data) }), () => ({ meetingId: m.id, people: null }))));
    const answers = answersFor(people, ctx.me.id);
    const mine = up ? myInvitation((people.find((x) => x.meetingId === up.id) || {}).people, ctx.me.id) : null;
    loaded = true;
    render({ all, up, groups, answers, mine, projects, directory, stale: !!list.stale, now });
  }

  function render({ up, groups, answers, mine, projects, directory, stale, now }) {
    const projectOf = (id) => projects.find((p) => p.id === id) || null;
    const nameOf = (id) => {
      const u = directory.find((x) => x.id === id);
      return u ? `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.username : null;
    };
    const web = meetingWebUrl(ctx.appBase, '');
    mount(root,
      el('div', { class: 'toolbar mt-head' },
        stale ? el('span', { class: 'stale-tag' }, 'offline · saved') : null,
        el('span', { class: 'sp' }),
        web ? el('a', { class: 'btn sm', href: web.replace(/\/$/, ''), target: '_blank', rel: 'noopener noreferrer' }, 'Past meetings, drafts and everything else on the website ↗') : null),
      up ? UpNext(ctx, up, { attendee: mine, project: up.projectId ? projectOf(up.projectId) : null, now }) : null,
      groups.length
        ? groups.map((g) => el('section', { class: 'mt-group', 'aria-labelledby': `mt-group-${g.key}` },
          el('h2', { class: 'section-title', id: `mt-group-${g.key}` }, g.label, el('span', { class: 'mt-count' }, String(g.items.length))),
          el('div', { class: 'mt-cards' }, g.items.map((m) => card(m, { answer: answers.get(m.id), project: m.projectId ? projectOf(m.projectId) : null, organizer: nameOf(m.organizerId), now })))))
        : Empty('No upcoming meetings', 'Meetings you’re invited to, or in your projects, show up here.'),
    );
  }

  function card(m, { answer, project, organizer, now }) {
    const tz = ctx.timeZone;
    const d = new Date(m.startAt);
    const part = (o) => new Intl.DateTimeFormat('en-GB', { ...o, timeZone: tz }).format(d);
    const today = zonedDayKey(d, tz) === todayKey(tz, now);
    const live = isUnderWay(m, now);
    const cancelled = m.status === 'CANCELLED';
    const place = meetingPlace(m);
    const people = typeof m.attendeeCount === 'number' ? m.attendeeCount : rows(m.attendees).length;
    const open = () => ctx.navigate(`#/meeting/${encodeURIComponent(m.id)}`);
    return el('article', { class: `mt-card${live ? ' live' : ''}${cancelled ? ' cancelled' : ''}`, dataset: { meetingId: m.id } },
      el('div', { class: `mt-leaf${today ? ' today' : ''}`, 'aria-hidden': 'true' },
        el('span', {}, part({ weekday: 'short' })), el('b', {}, part({ day: 'numeric' })), el('span', {}, part({ month: 'short' }))),
      el('div', { class: 'mt-body' },
        el('h3', { class: 'mt-h' }, el('button', { class: 'linkbtn mt-title', type: 'button', dir: 'auto', 'aria-label': `Open ${m.title}`, onClick: open }, m.title)),
        el('p', { class: 'muted mt-line' }, formatMeetingTimes(m.startAt, m.endAt, tz), place ? el('span', { dir: 'auto' }, ` · ${place}`) : null),
        el('p', { class: 'muted mt-line' },
          el('span', { dir: 'auto' }, project ? project.name : 'Standalone'),
          organizer ? el('span', { dir: 'auto' }, ` · Organizer: ${organizer}`) : null),
        el('p', { class: 'mt-foot' },
          people ? el('span', { class: 'muted' }, `${people} ${people === 1 ? 'person' : 'people'}`) : null,
          live ? el('span', { class: 'pill mt-live' }, 'Under way') : m.status !== 'SCHEDULED' ? el('span', { class: 'pill' }, meetingStatusLabel(m.status)) : null,
          seriesIdOf(m) ? el('span', { class: 'muted', title: 'Part of a repeating series' }, '↻ Repeats') : null,
          answer ? el('span', { class: `mt-mine r-${answer.response}` }, myAnswerText(answer.response)) : null)));
  }
}
