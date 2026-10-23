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
    appBase: over.appBase ?? 'https://tasks.example.com',
    me: { id: 'u1', name: 'Me', email: 'me@example.com', roles: over.roles ?? ['EMPLOYEE'] },
    manifest: { version: '1.6.0' },
    isOnline: over.isOnline ?? (() => true),
    api: {
      version: async () => ({ data: { version: '1.6.0' }, stale: false }),
      config: vi.fn(async () => ({ timeZone: 'Asia/Muscat', emailEnabled: over.emailEnabled ?? true })),
      notifications: {
        preferences: over.read ?? vi.fn(async () => ({ data: prefs, stale: false })),
        setPreferences: over.save ?? vi.fn(async (body) => {
          prefs = { ...prefs, ...body, ...(body.dailyEmails ? { dailyEmails: { ...prefs.dailyEmails, ...body.dailyEmails } } : {}) };
          return prefs;
        }),
        sendDailyTest: over.test ?? vi.fn(async () => ({ pending: 'sent', completed: 'empty' })),
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
    time.focus();
    time.value = '06:15';
    time.dispatchEvent(new Event('change', { bubbles: true }));
    time.blur(); // saved once typed (on leaving the field, or Enter)
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

describe('Settings → Notifications: "Send me a test now", and the daily email log for administrators', () => {
  const testButton = (root) => [...card(root, 'Notifications').querySelectorAll('button')].find((b) => /Send me a test now|Sending…/.test(b.textContent));
  const said = (root) => card(root, 'Notifications').querySelector('.nset-test [role="status"]').textContent;
  const problem = (root) => card(root, 'Notifications').querySelector('.nset-test [role="alert"]')?.textContent ?? '';

  it('sends the two morning emails now and says, in the website’s words, which went; focus stays on the button', async () => {
    const ctx = ctxWith();
    const root = await open(ctx);
    const button = testButton(root);
    button.focus();
    button.click();
    await settle();
    expect(ctx.api.notifications.sendDailyTest).toHaveBeenCalledTimes(1);
    expect(said(root)).toBe('Sent the pending tasks email. Nothing was completed yesterday, so there was no completed tasks email to send.');
    expect(problem(root)).toBe('');
    expect(document.activeElement).toBe(testButton(root));
  });

  it('while it is sending it says so, and a second press sends nothing more', async () => {
    let finish;
    const test = vi.fn(() => new Promise((resolve) => { finish = resolve; }));
    const root = await open(ctxWith({ test }));
    testButton(root).click();
    await settle();
    expect(testButton(root).textContent).toBe('Sending…');
    expect(testButton(root).getAttribute('aria-disabled')).toBe('true');
    testButton(root).click();
    expect(test).toHaveBeenCalledTimes(1);
    finish({ pending: 'sent', completed: 'sent' });
    await settle();
    expect(said(root)).toBe('Sent both emails: pending tasks and completed tasks.');
    expect(testButton(root).textContent).toBe('Send me a test now');
    expect(testButton(root).hasAttribute('aria-disabled')).toBe(false);
  });

  it('the server’s own words when it refuses: too soon, or email isn’t set up', async () => {
    const tooSoon = 'A test was just sent. Wait a minute before sending another.';
    let root = await open(ctxWith({ test: vi.fn(async () => { throw new ApiError(429, tooSoon, 'TOO_SOON'); }) }));
    testButton(root).click();
    await settle();
    expect(problem(root)).toBe(tooSoon);
    document.body.innerHTML = '';
    const notSetUp = 'Email isn’t set up on this server yet, so no email can be sent. An administrator needs to add the email (Mailjet) keys.';
    root = await open(ctxWith({ test: vi.fn(async () => { throw new ApiError(503, notSetUp, 'EMAIL_NOT_CONFIGURED'); }) }));
    testButton(root).click();
    await settle();
    expect(problem(root)).toBe(notSetUp);
  });

  it('a blocked address: says so as a problem, and never that it was sent', async () => {
    const root = await open(ctxWith({ test: vi.fn(async () => ({ pending: 'blocked', completed: 'empty' })) }));
    testButton(root).click();
    await settle();
    expect(problem(root)).toBe('Not sent: your email address is blocked after a bounce or spam complaint. Ask an administrator to check it.');
    expect(said(root)).toBe('');
  });

  it('no connection: says so plainly', async () => {
    const root = await open(ctxWith({ test: vi.fn(async () => { throw new TypeError('Failed to fetch'); }) }));
    testButton(root).click();
    await settle();
    expect(problem(root)).toBe('Couldn’t send the test. Check your connection and try again.');
  });

  it('online only: offline, it says so and sends nothing', async () => {
    const ctx = ctxWith({ isOnline: () => false });
    const root = await open(ctx);
    testButton(root).click();
    await settle();
    expect(ctx.api.notifications.sendDailyTest).not.toHaveBeenCalled();
    expect(problem(root)).toBe('Sending a test needs a connection — you appear to be offline.');
  });

  it('not offered while email isn’t set up on the server', async () => {
    const root = await open(ctxWith({ emailEnabled: false }));
    expect(card(root, 'Notifications').querySelector('.nset-test').classList.contains('hidden')).toBe(true);
  });

  it('administrators get a link to the daily email log on the website (a new tab); others don’t', async () => {
    const link = (root) => [...card(root, 'Notifications').querySelectorAll('a')].find((a) => a.textContent === 'Daily email log (opens the website)');
    const admin = await open(ctxWith({ roles: ['ADMIN'] }));
    const a = link(admin);
    expect(a.getAttribute('href')).toBe('https://tasks.example.com/admin/settings#daily-emails');
    expect(a.getAttribute('target')).toBe('_blank');
    expect(a.getAttribute('rel')).toBe('noopener');
    document.body.innerHTML = '';
    expect(link(await open(ctxWith()))).toBeUndefined();
  });

  it('the link only ever goes to the configured web app address — never an unsafe one', async () => {
    const link = (root) => [...card(root, 'Notifications').querySelectorAll('a')].find((a) => a.textContent === 'Daily email log (opens the website)');
    for (const appBase of ['javascript:alert(1)', 'http://evil.example.com', '']) {
      document.body.innerHTML = '';
      expect(link(await open(ctxWith({ roles: ['ADMIN'], appBase })))).toBeUndefined();
    }
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
