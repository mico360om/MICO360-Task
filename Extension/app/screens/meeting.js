import { el, mount, Loader, redrawKeepingFocus } from '../dom.js';
import { AnswerControl } from '../meeting/answer.js';
import {
  formatMeetingDay, formatMeetingTimes, safeJoinLink, meetingStatusLabel, responseLabel, responseSummary, responseLine,
  myInvitation, canAnswer, isUnderWay, meetingRepeatText, meetingWebUrl,
} from '../../src/meetings.js';
import { ApiError } from '../../src/errors.js';

const rows = (v) => (Array.isArray(v) ? v : []);

/**
 * One meeting (light, Stage 6): when and where (in the meeting's zone, as on the web), Join for a
 * secure online link, the organizer and project, what it is about, its agenda and who is coming —
 * read-only — and your answer to the invitation. Notes, minutes and action items open on the
 * website. Read from the saved copy when offline.
 */
export function MeetingScreen(ctx) {
  const id = ctx.params.meetingId;
  const root = el('div', { class: 'mt-page' });
  let shown = false;
  root.refresh = () => { void load(); return true; };
  void load();
  return root;

  async function load() {
    if (!shown) mount(root, Loader('Loading the meeting…'));
    let m;
    try {
      m = await ctx.api.meetings.get(id);
    } catch (e) {
      if (!shown) problem(e instanceof ApiError && (e.status === 404 || e.status === 403));
      return;
    }
    const meeting = m && m.data;
    if (!meeting || !meeting.id) {
      if (!shown) problem(true);
      return;
    }
    const soft = (p) => Promise.resolve(p).catch(() => null);
    const [people, agenda, projects, directory] = await Promise.all([
      soft(ctx.api.meetings.attendees(id)), soft(ctx.api.meetings.agenda(id)), soft(ctx.api.projects.list()),
      soft(ctx.api.directory ? ctx.api.directory() : null),
    ]);
    shown = true;
    redrawKeepingFocus(root, () => render(meeting, {
      stale: !!m.stale, people: people ? rows(people.data) : null, agenda: agenda ? rows(agenda.data) : null,
      projects: rows(projects && projects.data), directory: rows(directory && directory.data),
    }));
  }

  /** The web's words: a meeting that is gone (or not yours to see) can't be retried; a failed read can. */
  function problem(missing) {
    mount(root, el('div', { class: 'card mt-problem', role: 'alert' },
      el('h2', {}, missing ? 'Meeting not found' : 'Couldn’t load this meeting'),
      el('p', { class: 'muted' }, missing ? 'It may have been deleted, or you don’t have access to it.' : 'Check your connection and try again.'),
      el('div', { class: 'mt-problem-actions' },
        el('button', { class: 'btn', type: 'button', onClick: () => ctx.navigate('#/meetings') }, '← Back to meetings'),
        missing ? null : el('button', { class: 'btn primary', type: 'button', onClick: () => load() }, 'Retry'))));
  }

  function render(m, { stale, people, agenda, projects, directory }) {
    const zone = m.timeZone || ctx.timeZone;
    const nameOf = (userId) => {
      const u = directory.find((x) => x.id === userId);
      return u ? `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.username : null;
    };
    const project = m.projectId ? projects.find((p) => p.id === m.projectId) : null;
    const join = safeJoinLink(m.onlineLink);
    const live = isUnderWay(m, new Date());
    const mine = people ? myInvitation(people, ctx.me.id) : null;
    const web = meetingWebUrl(ctx.appBase, m.id);
    const repeat = m.series && m.series.rule ? meetingRepeatText(m.series.rule, m.recurrenceStart || m.startAt, m.series.timeZone || zone)
      : m.recurrenceRule ? meetingRepeatText(m.recurrenceRule, m.startAt, zone)
        : m.recurrenceParentId ? 'Part of a repeating series' : null;
    const fact = (icon, ...content) => el('li', { class: 'mt-fact' }, el('span', { class: 'mt-fact-ic', 'aria-hidden': 'true' }, icon), el('span', {}, ...content));
    // Your answer shows in the people list at once; only that list is drawn again (focus stays put).
    let list = people;
    const peopleSlot = el('div', {}, list ? peoplePart(list, nameOf) : null);
    const answered = (response) => {
      list = list.map((a) => (mine && a.id === mine.id ? { ...a, response } : a));
      mount(peopleSlot, peoplePart(list, nameOf));
    };
    mount(root,
      el('div', { class: 'toolbar mt-head' },
        el('button', { class: 'btn sm', type: 'button', onClick: () => ctx.navigate('#/meetings') }, '← Back to meetings'),
        stale ? el('span', { class: 'stale-tag' }, 'offline · saved') : null,
        el('span', { class: 'sp' }),
        web ? el('a', { class: 'btn sm', href: web, target: '_blank', rel: 'noopener noreferrer' }, 'Open on the web ↗') : null),
      el('div', { class: 'card mt-sheet' },
        el('div', { class: 'mt-status' },
          el('span', { class: `pill ms-${m.status}` }, meetingStatusLabel(m.status)),
          live ? el('span', { class: 'pill mt-live' }, 'Under way') : null),
        el('h2', { class: `mt-page-title${m.status === 'CANCELLED' ? ' cancelled' : ''}`, dir: 'auto' }, m.title),
        el('ul', { class: 'mt-facts' },
          fact('🗂', el('span', { dir: 'auto' }, project ? project.name : m.projectId ? 'Project' : 'Standalone meeting')),
          fact('📅', formatMeetingDay(m.startAt, zone)),
          el('li', { class: 'mt-fact', title: `Company time (${zone})` }, el('span', { class: 'mt-fact-ic', 'aria-hidden': 'true' }, '🕒'), el('span', {}, `${formatMeetingTimes(m.startAt, m.endAt, zone)} (${zone})`)),
          repeat ? fact('🔁', repeat) : null,
          m.location ? fact('📍', el('span', { dir: 'auto' }, m.location)) : null,
          join ? fact('🎥', el('a', { href: join, target: '_blank', rel: 'noopener noreferrer' }, 'Join online')) : null,
          fact('👤', 'Organizer: ', el('span', { dir: 'auto' }, nameOf(m.organizerId) || '—'))),
        mine && canAnswer(m) ? AnswerControl(ctx, { meeting: m, attendee: mine, onAnswered: answered }) : null),
      m.description ? el('section', { class: 'card mt-section' }, el('h3', { class: 'section-title' }, 'About'), el('p', { class: 'mt-about', dir: 'auto' }, m.description)) : null,
      agenda && agenda.length ? agendaPart(agenda, nameOf) : null,
      peopleSlot,
      el('p', { class: 'muted mt-more' }, 'Notes, minutes and action items are on the website. ',
        web ? el('a', { href: web, target: '_blank', rel: 'noopener noreferrer' }, 'Open the meeting there ↗') : null));
  }

  function agendaPart(items, nameOf) {
    const sorted = [...items].sort((a, b) => (a.position || 0) - (b.position || 0));
    return el('section', { class: 'card mt-section mt-agenda' },
      el('h3', { class: 'section-title' }, 'Agenda'),
      el('ol', { class: 'mt-agenda-list' }, sorted.map((g) => el('li', { class: g.completed ? 'done' : null },
        el('span', { class: 'mt-agenda-title', dir: 'auto' }, g.title),
        g.completed ? el('span', { class: 'sr-only' }, ' (covered)') : null,
        el('span', { class: 'muted mt-agenda-line' }, `${(g.ownerId && nameOf(g.ownerId)) || 'No presenter'} · ${g.expectedMinutes != null ? `${g.expectedMinutes} min` : 'no time set'}`)))));
  }

  function peoplePart(people, nameOf) {
    return el('section', { class: 'card mt-section mt-people' },
      el('h3', { class: 'section-title' }, `People · ${people.length}`),
      people.length ? el('p', { class: 'muted' }, responseLine(responseSummary(people))) : el('p', { class: 'muted' }, 'Nobody has been added yet.'),
      el('ul', { class: 'mt-people-list' }, people.map((a) => {
        const name = a.userId ? nameOf(a.userId) || 'A team member' : (a.externalName || '').trim() || 'Guest';
        return el('li', {},
          el('span', { class: 'mt-person', dir: 'auto' }, a.userId === ctx.me.id ? `${name} (you)` : name),
          el('span', { class: 'pill' }, a.role === 'OPTIONAL' ? 'Optional' : 'Required'),
          a.userId ? null : el('span', { class: 'pill' }, 'Guest'),
          el('span', { class: `pill r-${a.response || 'PENDING'}` }, responseLabel(a.response)));
      })));
  }
}
