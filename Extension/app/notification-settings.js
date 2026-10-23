/**
 * Settings → Notifications (Stage 5). The web's notification preferences, saved on the server
 * (`GET/PUT /notifications/preferences`): which kinds of notification to get, how early a "due soon"
 * reminder comes, and the two morning emails. The server makes only the notifications someone
 * hasn't switched off, so the badge and the desktop alerts follow them too. Then this device's
 * desktop alerts: whether there are any, and whether one may say what the newest notification is
 * about (off until chosen — anyone near the screen can read it).
 *
 * Changing a preference needs the connection, as on the web: it shows at once, and goes back with
 * the reason when it can't be saved. Saves go one at a time, in the order made (the latest wins);
 * after one fails, the preferences are read again, so the screen shows what the server has. The
 * switches keep focus when the card is drawn again. The morning-email time is saved once it has
 * been typed — on leaving the field, or Enter — as on the web: Chrome reports each part of a time
 * as a change while it is typed, and the field is never drawn again under the typing.
 *
 * "Send me a test now" sends the two morning emails at once, as on the web (online only; the server
 * allows one a minute and says so). Administrators also get a link to the daily email log, which
 * is on the website (System Settings → Daily task emails).
 */
import { el, mount } from './dom.js';
import { switchButton, writeErrorMessage } from './components.js';
import { NOTIFICATION_TYPES, REMINDER_OPTIONS, DEFAULT_DAILY_EMAILS, readAlertSettings, saveAlertSettings } from '../src/notify.js';
import { checkBaseUrl } from '../src/config.js';

const SAVE_FAILED = 'Couldn’t save that change. Please try again.';
const TEST_FAILED = 'Couldn’t send the test. Check your connection and try again.';
const TEST_LABEL = 'Send me a test now';
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
/** The website's address of System Settings → Daily task emails. */
const DAILY_LOG_PATH = '/admin/settings#daily-emails';

/** What a test sent, in the website's words: an email with nothing in it isn't sent. */
export function testSummary(r) {
  const pending = Boolean(r && r.pending === 'sent');
  const completed = Boolean(r && r.completed === 'sent');
  const parts = [];
  if (pending && completed) parts.push('Sent both emails: pending tasks and completed tasks.');
  else if (pending || completed) parts.push(`Sent the ${pending ? 'pending tasks' : 'completed tasks'} email.`);
  if (!pending) parts.push('You have no pending tasks, so there was no pending tasks email to send.');
  if (!completed) parts.push('Nothing was completed yesterday, so there was no completed tasks email to send.');
  return parts.join(' ');
}

/** The daily email log on the website, for an administrator — only ever at the configured web app address. */
function dailyLogUrl(ctx) {
  const admin = ((ctx.me && ctx.me.roles) || []).includes('ADMIN');
  const base = checkBaseUrl(ctx.appBase || '');
  return admin && base.ok ? `${base.url}${DAILY_LOG_PATH}` : null;
}

export function NotificationSettings(ctx) {
  const api = ctx.api && ctx.api.notifications;
  let prefs = null;          // the preferences shown (a change shows at once)
  let confirmed = null;      // the server's last answer
  let status = 'loading';    // 'loading' | 'ready' | 'offline'
  let problem = '';
  let emailEnabled = true;
  let alerts = { on: true, details: false };
  let saves = 0;             // each save's number: only the newest answer is kept
  let lane = Promise.resolve(); // saves go one at a time
  let failed = false;        // a save failed since the last read

  // The morning-email time: one field for good, so drawing the card again never takes it away
  // from someone typing in it. Saved on leaving it, or Enter.
  const time = el('input', { class: 'field nset-time', type: 'time', id: 'nset-time', step: '60', dataset: { focusKey: 'time' } });
  time.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    saveTime();
  });
  // Once focus has gone where it was going (Tab, a click), so the card drawn again can put it back.
  time.addEventListener('blur', () => setTimeout(saveTime, 0));
  const timeRow = el('div', { class: 'nset-row' },
    el('div', { class: 'nset-text' },
      el('label', { class: 'nset-title', for: 'nset-time' }, 'Send them at'),
      el('div', { class: 'muted nset-desc' }, 'In your own time zone, as set on the website.')),
    time);
  // "Send me a test now" and what it said: the button and the status line are kept for good (like the
  // time field), so focus never drops and each answer is read out as it changes. A problem is an
  // alert put in when there is one (read out as it appears).
  let testing = false;
  const testButton = el('button', { class: 'btn sm', type: 'button', dataset: { focusKey: 'daily-test' } }, TEST_LABEL);
  testButton.addEventListener('click', () => sendTest());
  const testSaid = el('span', { class: 'muted nset-test-said', role: 'status' });
  const testProblem = el('span');
  const showTestProblem = (text) => mount(testProblem, text ? el('span', { class: 'error nset-test-said', role: 'alert' }, text) : null);
  const testRow = el('div', { class: 'nset-test' }, testButton, testSaid, testProblem);
  const logUrl = dailyLogUrl(ctx);
  const extras = el('div', { class: 'nset-extras' },
    testRow,
    logUrl ? el('a', { class: 'nset-log', href: logUrl, target: '_blank', rel: 'noopener' }, 'Daily email log (opens the website)') : null);
  const top = el('div');
  const bottom = el('div');
  const node = el('div', { class: 'nset' }, top, timeRow, extras, bottom);

  load();
  return node;

  /** Both morning emails to me now (the server says when it's too soon, or email isn't set up). */
  async function sendTest() {
    if (testing) return;
    testSaid.textContent = '';
    showTestProblem('');
    if (ctx.isOnline && !ctx.isOnline()) {
      showTestProblem('Sending a test needs a connection — you appear to be offline.');
      return;
    }
    testing = true;
    testButton.textContent = 'Sending…';
    testButton.setAttribute('aria-disabled', 'true');
    try {
      testSaid.textContent = testSummary(await api.sendDailyTest());
    } catch (e) {
      showTestProblem(e && e.code === 'EMAIL_NOT_CONFIGURED' && e.serverMessage ? e.serverMessage : writeErrorMessage(e, TEST_FAILED));
    } finally {
      testing = false;
      testButton.textContent = TEST_LABEL;
      testButton.removeAttribute('aria-disabled');
    }
  }

  async function load() {
    status = 'loading';
    problem = '';
    render();
    alerts = await readAlertSettings(ctx.storage);
    try {
      const r = await api.preferences();
      prefs = normalize(r && r.data);
      confirmed = prefs;
      status = 'ready';
    } catch {
      status = 'offline';
    }
    render();
    try {
      const cfg = ctx.api.config ? await ctx.api.config() : null;
      emailEnabled = !(cfg && cfg.emailEnabled === false);
      if (!emailEnabled) render();
    } catch { /* offline: say nothing about email */ }
  }

  function normalize(p) {
    const d = (p && p.dailyEmails) || {};
    return {
      muted: Array.isArray(p && p.muted) ? [...p.muted] : [],
      reminderLeadMinutes: typeof (p && p.reminderLeadMinutes) === 'number' ? p.reminderLeadMinutes : undefined,
      dailyEmails: {
        pending: typeof d.pending === 'boolean' ? d.pending : DEFAULT_DAILY_EMAILS.pending,
        completed: typeof d.completed === 'boolean' ? d.completed : DEFAULT_DAILY_EMAILS.completed,
        time: typeof d.time === 'string' && TIME.test(d.time) ? d.time : DEFAULT_DAILY_EMAILS.time,
      },
    };
  }

  /** Draw the card again (all but the time field), keeping focus on the same control. */
  function render() {
    const a = document.activeElement;
    const key = a && a !== time && node.contains(a) ? a.dataset.focusKey : null;
    mount(top, draw());
    timeRow.classList.toggle('hidden', status !== 'ready');
    extras.classList.toggle('hidden', status !== 'ready');
    // As on the web: no test while the server can't send email (the warning above says why).
    testRow.classList.toggle('hidden', !emailEnabled || !(api && api.sendDailyTest));
    if (prefs && document.activeElement !== time) time.value = prefs.dailyEmails.time;
    mount(bottom, alertsPart());
    if (key) {
      const again = node.querySelector(`[data-focus-key="${key}"]`);
      if (again) again.focus();
    }
  }

  function row(title, desc, control) {
    return el('div', { class: 'nset-row' },
      el('div', { class: 'nset-text' }, el('div', { class: 'nset-title' }, title), desc ? el('div', { class: 'muted nset-desc' }, desc) : null),
      control);
  }

  function draw() {
    return [
      problem ? el('div', { class: 'errbar', role: 'alert' }, el('span', {}, problem)) : null,
      status === 'loading' ? el('div', { class: 'muted' }, 'Loading your notification preferences…') : null,
      status === 'offline'
        ? el('div', { class: 'nset-offline' },
          el('span', { class: 'muted' }, 'Your notification preferences show when you’re online.'),
          el('button', { class: 'btn sm', type: 'button', onClick: () => load() }, 'Try again'))
        : null,
      status === 'ready' ? serverPart() : null,
    ];
  }

  function alertsPart() {
    return [
      el('div', { class: 'nset-head' }, 'Desktop alerts'),
      row('Desktop alerts', 'A Chrome notification on this computer when something new arrives.',
        switchButton({ on: alerts.on, label: 'Desktop alerts', focusKey: 'alerts', onChange: () => setAlerts({ on: !alerts.on }) })),
      row('Say what it’s about', 'The alert shows the newest notification’s title and words. Anyone near your screen can read them.',
        switchButton({ on: alerts.details, label: 'Say what it’s about', focusKey: 'alert-details', disabled: !alerts.on, onChange: () => setAlerts({ details: !alerts.details }) })),
    ];
  }

  function serverPart() {
    const lead = el('select', { class: 'field nset-select', 'aria-label': 'Reminder timing', dataset: { focusKey: 'lead' } },
      REMINDER_OPTIONS.map((o) => el('option', { value: o.value === null ? '' : String(o.value) }, o.label)));
    lead.value = prefs.reminderLeadMinutes === undefined ? '' : String(prefs.reminderLeadMinutes);
    lead.addEventListener('change', () => saveTypes(prefs.muted, lead.value === '' ? undefined : Number(lead.value)));
    const daily = prefs.dailyEmails;
    return [
      NOTIFICATION_TYPES.map((t) => {
        const on = !prefs.muted.includes(t.type);
        return row(t.label, t.desc, switchButton({
          on, label: `Notify me: ${t.label}`, focusKey: `type-${t.type}`,
          onChange: () => saveTypes(on ? [...prefs.muted, t.type] : prefs.muted.filter((m) => m !== t.type), prefs.reminderLeadMinutes),
        }));
      }),
      row('Remind me before due', 'How early a “due soon” reminder is sent for your tasks.', lead),
      el('div', { class: 'nset-head' }, 'Daily task emails'),
      el('p', { class: 'muted nset-desc' }, 'Two emails each morning: the tasks assigned to you that aren’t done yet, and your tasks completed the day before. An email with nothing in it isn’t sent.'),
      emailEnabled ? null : el('div', { class: 'warnbar' }, 'Email isn’t set up on this server yet, so these emails can’t be sent. You can still choose them; they start once an administrator sets up email.'),
      row('Pending tasks', 'Overdue, due today, upcoming and undated — with priority, status and a link to each.',
        switchButton({ on: daily.pending, label: 'Pending tasks email', focusKey: 'daily-pending', onChange: () => saveDaily({ ...daily, pending: !daily.pending }) })),
      row('Completed yesterday', 'Your tasks that were completed the day before, and whether they were on time.',
        switchButton({ on: daily.completed, label: 'Completed yesterday email', focusKey: 'daily-completed', onChange: () => saveDaily({ ...daily, completed: !daily.completed }) })),
    ];
  }

  /** The time typed, once it is complete: saved when it changed; half-typed, the saved time comes back. */
  function saveTime() {
    if (!prefs) return;
    const daily = prefs.dailyEmails;
    if (time.value === daily.time) return;
    if (!TIME.test(time.value)) {
      time.value = daily.time;
      problem = 'Choose a time, for example 06:00.';
      render();
      return;
    }
    saveDaily({ ...daily, time: time.value });
  }

  /** The muted kinds and the reminder time are saved together (left out = the default), as on the web. */
  function saveTypes(muted, reminderLeadMinutes) {
    const body = { muted, ...(typeof reminderLeadMinutes === 'number' ? { reminderLeadMinutes } : {}) };
    return save({ muted, reminderLeadMinutes }, body);
  }

  /** Only the morning emails are sent: the server keeps the rest as they are. */
  function saveDaily(dailyEmails) {
    return save({ dailyEmails }, { dailyEmails });
  }

  /**
   * Shown at once; sent after the saves before it (one at a time, so the server keeps the latest).
   * The newest one draws the result: the server's answer, or — when any failed — the preferences
   * read again (the last ones the server sent, when they can't be read either).
   */
  async function save(change, body) {
    const n = (saves += 1);
    prefs = { ...prefs, ...change };
    problem = '';
    render();
    const run = lane.then(async () => {
      try {
        const saved = await api.setPreferences(body);
        if (saved && typeof saved === 'object') {
          confirmed = normalize(saved);
          if (n === saves) prefs = confirmed;
        }
      } catch (e) {
        failed = true;
        problem = writeErrorMessage(e, SAVE_FAILED);
      }
    });
    lane = run;
    await run;
    if (n !== saves) return; // a later change is on its way: it draws the result
    if (failed) {
      failed = false;
      try {
        const r = await api.preferences();
        confirmed = normalize(r && r.data);
      } catch { /* keep the server's last answer */ }
      if (n === saves) prefs = confirmed;
    }
    if (n === saves) render();
  }

  async function setAlerts(patch) {
    try {
      alerts = await saveAlertSettings(ctx.storage, patch);
      problem = '';
    } catch (e) {
      problem = writeErrorMessage(e, SAVE_FAILED);
    }
    render();
  }
}
