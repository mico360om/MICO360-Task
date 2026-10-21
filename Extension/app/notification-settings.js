/**
 * Settings → Notifications (Stage 5). The web's notification preferences, saved on the server
 * (`GET/PUT /notifications/preferences`): which kinds of notification to get, how early a "due soon"
 * reminder comes, and the two morning emails. The server makes only the notifications someone
 * hasn't switched off, so the badge and the desktop alerts follow them too. Then this device's
 * desktop alerts: whether there are any, and whether one may say what the newest notification is
 * about (off until chosen — anyone near the screen can read it).
 *
 * Changing a preference needs the connection, as on the web: it shows at once, and goes back with
 * the reason when it can't be saved. The switches keep focus when the card is drawn again.
 */
import { el, mount } from './dom.js';
import { switchButton, writeErrorMessage } from './components.js';
import { NOTIFICATION_TYPES, REMINDER_OPTIONS, DEFAULT_DAILY_EMAILS, readAlertSettings, saveAlertSettings } from '../src/notify.js';

const SAVE_FAILED = 'Couldn’t save that change. Please try again.';
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export function NotificationSettings(ctx) {
  const node = el('div', { class: 'nset' });
  const api = ctx.api && ctx.api.notifications;
  let prefs = null;          // the server's preferences (null until read)
  let status = 'loading';    // 'loading' | 'ready' | 'offline'
  let problem = '';
  let emailEnabled = true;
  let alerts = { on: true, details: false };
  let saves = 0;             // each save's number: only the newest answer is kept

  load();
  return node;

  async function load() {
    status = 'loading';
    problem = '';
    render();
    alerts = await readAlertSettings(ctx.storage);
    try {
      const r = await api.preferences();
      prefs = normalize(r && r.data);
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

  /** Draw the card again, keeping focus on the same control. */
  function render() {
    const a = document.activeElement;
    const key = a && node.contains(a) ? a.dataset.focusKey : null;
    mount(node, draw());
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
    const time = el('input', { class: 'field nset-time', type: 'time', id: 'nset-time', step: '60', value: daily.time, dataset: { focusKey: 'time' } });
    time.addEventListener('change', () => {
      if (time.value === daily.time) return;
      if (!TIME.test(time.value)) {
        problem = 'Choose a time, for example 06:00.';
        render();
        return;
      }
      saveDaily({ ...daily, time: time.value });
    });
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
      el('div', { class: 'nset-row' },
        el('div', { class: 'nset-text' },
          el('label', { class: 'nset-title', for: 'nset-time' }, 'Send them at'),
          el('div', { class: 'muted nset-desc' }, 'In your own time zone, as set on the website.')),
        time),
    ];
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

  async function save(change, body) {
    const before = prefs;
    const n = (saves += 1);
    prefs = { ...prefs, ...change };
    problem = '';
    render();
    try {
      const saved = await api.setPreferences(body);
      if (n === saves && saved && typeof saved === 'object') prefs = normalize(saved);
    } catch (e) {
      if (n === saves) prefs = before;
      problem = writeErrorMessage(e, SAVE_FAILED);
    }
    render();
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
