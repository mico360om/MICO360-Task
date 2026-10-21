// @vitest-environment jsdom
/**
 * Stage 5 review fixes: Settings → Notifications saves the morning-email time once it has been
 * typed, and its saves go one at a time (the latest wins).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SettingsScreen } from '../app/screens/settings.js';
import { fakeStorage } from './test-helpers.js';
import { DEFAULTS } from './config.js';

const settle = async () => {
  for (let i = 0; i < 10; i += 1) await new Promise((r) => setTimeout(r, 0));
};
const byLabel = (root, label) => root.querySelector(`[aria-label="${label}"]`);
const card = (root, title) => [...root.querySelectorAll('.card')].find((c) => c.querySelector('.section-title')?.textContent === title);

beforeEach(() => {
  document.body.innerHTML = '';
});

function settingsCtx(over = {}) {
  let prefs = { muted: [], reminderLeadMinutes: 60, dailyEmails: { pending: true, completed: true, time: '06:00' } };
  return {
    storage: fakeStorage({ apiBase: DEFAULTS.apiBase, appBase: 'https://tasks.example.com', syncQueue: [] }),
    me: { id: 'u1', name: 'Me', email: 'me@example.com' },
    manifest: { version: '1.6.0' },
    isOnline: () => true,
    api: {
      version: async () => ({ data: { version: '1.6.0' }, stale: false }),
      config: vi.fn(async () => ({ timeZone: 'Asia/Muscat', emailEnabled: true })),
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
}

async function openSettings(ctx) {
  const root = SettingsScreen(ctx);
  document.body.append(root);
  await settle();
  return root;
}

describe('#1 the morning-email time is saved once it has been typed, as on the web', () => {
  const timeOf = (root) => card(root, 'Notifications').querySelector('input[type="time"]');
  const change = (input, value) => {
    input.value = value;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  };

  it('typing it (Chrome reports each part as a change) saves nothing until the field is left, then the whole time', async () => {
    const ctx = settingsCtx();
    const root = await openSettings(ctx);
    const time = timeOf(root);
    time.focus();
    change(time, '');      // the hours being typed
    change(time, '00:00'); // a part typed: Chrome already has a full value
    change(time, '09:45');
    await settle();
    expect(ctx.api.notifications.setPreferences).not.toHaveBeenCalled();
    expect(timeOf(root)).toBe(time); // the field isn't drawn again while it is being typed in
    expect(document.activeElement).toBe(time);
    expect(card(root, 'Notifications').querySelector('[role="alert"]')).toBeNull();
    time.blur();
    await settle();
    expect(ctx.api.notifications.setPreferences).toHaveBeenCalledTimes(1);
    expect(ctx.api.notifications.setPreferences).toHaveBeenCalledWith({ dailyEmails: { pending: true, completed: true, time: '09:45' } });
  });

  it('Enter saves it too, once', async () => {
    const ctx = settingsCtx();
    const root = await openSettings(ctx);
    const time = timeOf(root);
    time.focus();
    change(time, '07:15');
    time.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await settle();
    expect(ctx.api.notifications.setPreferences).toHaveBeenCalledWith({ dailyEmails: { pending: true, completed: true, time: '07:15' } });
    time.blur();
    await settle();
    expect(ctx.api.notifications.setPreferences).toHaveBeenCalledTimes(1); // the same time isn't saved again
  });

  it('left half-typed: says how to write it and puts the saved time back', async () => {
    const ctx = settingsCtx();
    const root = await openSettings(ctx);
    const time = timeOf(root);
    time.focus();
    change(time, '');
    time.blur();
    await settle();
    expect(ctx.api.notifications.setPreferences).not.toHaveBeenCalled();
    expect(card(root, 'Notifications').querySelector('[role="alert"]').textContent).toBe('Choose a time, for example 06:00.');
    expect(timeOf(root).value).toBe('06:00');
  });

  it('leaving the field with Tab keeps focus where Tab took it', async () => {
    const ctx = settingsCtx();
    const root = await openSettings(ctx);
    const time = timeOf(root);
    time.focus();
    change(time, '08:00');
    const next = byLabel(card(root, 'Notifications'), 'Desktop alerts');
    next.focus(); // what Tab does: the time loses focus, the next control gets it
    await settle();
    expect(ctx.api.notifications.setPreferences).toHaveBeenCalledTimes(1);
    expect(document.activeElement.getAttribute('aria-label')).toBe('Desktop alerts');
  });
});

describe('#10 preference saves go one at a time, the latest last', () => {
  it('quick changes reach the server in the order made, never two at once, and the screen shows the server’s last answer', async () => {
    let inFlight = 0;
    let most = 0;
    const order = [];
    let prefs = { muted: [], reminderLeadMinutes: 60, dailyEmails: { pending: true, completed: true, time: '06:00' } };
    const save = vi.fn(async (body) => {
      inFlight += 1;
      most = Math.max(most, inFlight);
      order.push(body.reminderLeadMinutes);
      // The first answer is the slowest: sent at once, it would land last and win.
      await new Promise((r) => setTimeout(r, order.length === 1 ? 30 : 1));
      prefs = { ...prefs, ...body };
      inFlight -= 1;
      return prefs;
    });
    const ctx = settingsCtx({ save, read: vi.fn(async () => ({ data: prefs, stale: false })) });
    const root = await openSettings(ctx);
    const lead = () => byLabel(card(root, 'Notifications'), 'Reminder timing');
    for (const v of ['0', '240', '1440']) {
      lead().value = v;
      lead().dispatchEvent(new Event('change', { bubbles: true }));
    }
    await new Promise((r) => setTimeout(r, 80));
    await settle();
    expect(most).toBe(1);
    expect(order).toEqual([0, 240, 1440]);
    expect(lead().value).toBe('1440');
  });

  it('when one fails, the preferences are read again so the screen shows what the server has', async () => {
    let n = 0;
    const server = { muted: [], reminderLeadMinutes: 240, dailyEmails: { pending: true, completed: true, time: '06:00' } };
    const save = vi.fn(async () => { n += 1; throw new TypeError('Failed to fetch'); });
    const read = vi.fn(async () => ({ data: n ? server : { ...server, reminderLeadMinutes: 60 }, stale: false }));
    const ctx = settingsCtx({ save, read });
    const root = await openSettings(ctx);
    const lead = byLabel(card(root, 'Notifications'), 'Reminder timing');
    lead.value = '1440';
    lead.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    expect(read).toHaveBeenCalledTimes(2);
    expect(byLabel(card(root, 'Notifications'), 'Reminder timing').value).toBe('240');
    expect(card(root, 'Notifications').querySelector('[role="alert"]').textContent).toBe('Couldn’t save that change. Please try again.');
  });
});
