// @vitest-environment jsdom
/**
 * Stage 5: Settings → Notifications — the web's notification preferences (which kinds to get, how
 * early a "due soon" reminder comes, the two morning emails), saved on the server; and this device's
 * desktop alerts (on or off, and whether one may say what the newest notification is about).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SettingsScreen } from '../app/screens/settings.js';
import { ApiError } from './errors.js';
import { fakeStorage } from './test-helpers.js';
import { DEFAULTS } from './config.js';
import { DESKTOP_ALERTS_KEY } from './notify.js';

const settle = async () => {
  for (let i = 0; i < 10; i += 1) await new Promise((r) => setTimeout(r, 0));
};
const byLabel = (root, label) => root.querySelector(`[aria-label="${label}"]`);
const card = (root, title) => [...root.querySelectorAll('.card')].find((c) => c.querySelector('.section-title')?.textContent === title);

beforeEach(() => {
  document.body.innerHTML = '';
});

function ctxWith(over = {}) {
  let prefs = over.prefs ?? { muted: ['TASK_STATUS'], reminderLeadMinutes: 60, dailyEmails: { pending: true, completed: false, time: '07:30' } };
  const ctx = {
    storage: fakeStorage({ apiBase: DEFAULTS.apiBase, appBase: 'https://tasks.example.com', syncQueue: [], ...over.local }),
    me: { id: 'u1', name: 'Me', email: 'me@example.com' },
    manifest: { version: '1.6.0' },
    isOnline: () => true,
    api: {
      version: async () => ({ data: { version: '1.6.0' }, stale: false }),
      config: vi.fn(async () => ({ timeZone: 'Asia/Muscat', emailEnabled: over.emailEnabled ?? true })),
      notifications: {
        preferences: over.read ?? vi.fn(async () => ({ data: prefs, stale: false })),
        setPreferences: over.save ?? vi.fn(async (body) => {
          prefs = { ...prefs, ...body, ...(body.dailyEmails ? { dailyEmails: { ...prefs.dailyEmails, ...body.dailyEmails } } : {}) };
          return prefs;
        }),
      },
    },
    signOut: vi.fn(async () => {}),
    requestSync: vi.fn(),
    afterMutation: vi.fn(),
  };
  return ctx;
}

async function open(ctx) {
  const root = SettingsScreen(ctx);
  document.body.append(root);
  await settle();
  return root;
}

describe('Settings → Notifications: the web’s preferences', () => {
  it('a switch for each kind (on unless muted), the reminder time, and the morning emails — as the server has them', async () => {
    const root = await open(ctxWith());
    const box = card(root, 'Notifications');
    expect(box).toBeTruthy();
    const sw = (label) => byLabel(box, `Notify me: ${label}`);
    expect(sw('Task assignments').getAttribute('role')).toBe('switch');
    expect(sw('Task assignments').getAttribute('aria-checked')).toBe('true');
    expect(sw('Status changes').getAttribute('aria-checked')).toBe('false');
    expect(box.textContent).toContain('When one of your tasks moves column');
    expect(byLabel(box, 'Reminder timing').value).toBe('60');
    expect([...byLabel(box, 'Reminder timing').options].map((o) => o.textContent)).toContain('Default (1 day)');
    expect(byLabel(box, 'Pending tasks email').getAttribute('aria-checked')).toBe('true');
    expect(byLabel(box, 'Completed yesterday email').getAttribute('aria-checked')).toBe('false');
    expect(box.querySelector('input[type="time"]').value).toBe('07:30');
  });

  it('switching one off saves the whole list with the reminder time (so nothing else is lost), and it stays switched', async () => {
    const ctx = ctxWith();
    const root = await open(ctx);
    const box = card(root, 'Notifications');
    const comments = byLabel(box, 'Notify me: Comments');
    comments.focus(); // a click focuses the button in a browser
    comments.click();
    await settle();
    expect(ctx.api.notifications.setPreferences).toHaveBeenCalledWith({ muted: ['TASK_STATUS', 'TASK_COMMENT'], reminderLeadMinutes: 60 });
    expect(byLabel(card(root, 'Notifications'), 'Notify me: Comments').getAttribute('aria-checked')).toBe('false');
    expect(document.activeElement).toBe(byLabel(card(root, 'Notifications'), 'Notify me: Comments')); // focus stays on it
    const lead = byLabel(card(root, 'Notifications'), 'Reminder timing');
    lead.value = '';
    lead.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    expect(ctx.api.notifications.setPreferences).toHaveBeenLastCalledWith({ muted: ['TASK_STATUS', 'TASK_COMMENT'] }); // the default: left out
  });

  it('the morning emails: each on or off, and the time they go — only those are sent', async () => {
    const ctx = ctxWith();
    const root = await open(ctx);
    byLabel(card(root, 'Notifications'), 'Completed yesterday email').click();
    await settle();
    expect(ctx.api.notifications.setPreferences).toHaveBeenCalledWith({ dailyEmails: { pending: true, completed: true, time: '07:30' } });
    const time = card(root, 'Notifications').querySelector('input[type="time"]');
    time.value = '06:15';
    time.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    expect(ctx.api.notifications.setPreferences).toHaveBeenLastCalledWith({ dailyEmails: { pending: true, completed: true, time: '06:15' } });
  });

  it('a change that can’t be saved goes back, and says so', async () => {
    const ctx = ctxWith({ save: vi.fn(async () => { throw new TypeError('Failed to fetch'); }) });
    const root = await open(ctx);
    byLabel(card(root, 'Notifications'), 'Notify me: Mentions').click();
    await settle();
    const box = card(root, 'Notifications');
    expect(box.querySelector('[role="alert"]').textContent).toBe('Couldn’t save that change. Please try again.');
    expect(byLabel(box, 'Notify me: Mentions').getAttribute('aria-checked')).toBe('true');
  });

  it('the server’s own reason when it refuses', async () => {
    const ctx = ctxWith({ save: vi.fn(async () => { throw new ApiError(400, 'Choose a time as HH:MM.', 'VALIDATION_ERROR'); }) });
    const root = await open(ctx);
    byLabel(card(root, 'Notifications'), 'Pending tasks email').click();
    await settle();
    expect(card(root, 'Notifications').querySelector('[role="alert"]').textContent).toBe('Choose a time as HH:MM.');
  });

  it('can’t be read (offline, nothing saved): says so, with Try again', async () => {
    let fail = true;
    const read = vi.fn(async () => { if (fail) throw new TypeError('Failed to fetch'); return { data: { muted: [] }, stale: false }; });
    const root = await open(ctxWith({ read }));
    const box = card(root, 'Notifications');
    expect(box.textContent).toContain('Your notification preferences show when you’re online.');
    fail = false;
    [...box.querySelectorAll('button')].find((b) => b.textContent === 'Try again').click();
    await settle();
    expect(byLabel(card(root, 'Notifications'), 'Notify me: Task assignments').getAttribute('aria-checked')).toBe('true');
  });

  it('when the server can’t send email, it says the morning emails start once it can', async () => {
    const root = await open(ctxWith({ emailEnabled: false }));
    expect(card(root, 'Notifications').textContent).toContain('Email isn’t set up on this server yet');
  });
});

describe('Settings → Notifications: desktop alerts on this device', () => {
  it('on, and not saying what they are about, until chosen; each choice is kept on this device', async () => {
    const ctx = ctxWith();
    const root = await open(ctx);
    const box = card(root, 'Notifications');
    const alerts = byLabel(box, 'Desktop alerts');
    const details = byLabel(box, 'Say what it’s about');
    expect(alerts.getAttribute('aria-checked')).toBe('true');
    expect(details.getAttribute('aria-checked')).toBe('false');
    details.click();
    await settle();
    expect(ctx.storage.data[DESKTOP_ALERTS_KEY]).toEqual({ on: true, details: true });
    expect(byLabel(card(root, 'Notifications'), 'Say what it’s about').getAttribute('aria-checked')).toBe('true');
    byLabel(card(root, 'Notifications'), 'Desktop alerts').click();
    await settle();
    expect(ctx.storage.data[DESKTOP_ALERTS_KEY]).toEqual({ on: false, details: true });
    expect(byLabel(card(root, 'Notifications'), 'Say what it’s about').disabled).toBe(true);
  });
});
