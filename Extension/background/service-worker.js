import { resolveBases } from '../src/config.js';
import { shouldNotify, notificationText } from '../src/notify.js';
import { flushQueue, makePerformMutation } from '../src/queue.js';
import { authedFetch, getTokens } from '../src/auth.js';

/** Replay one queued mutation from the background. Refreshes on 401 via authedFetch; the
 *  replay + permanent-4xx rule is the shared factory, so it can't drift from the popup's copy. */
function makePerform(apiBase) {
  return makePerformMutation((path, init) => authedFetch(chrome.storage.local, apiBase, path, init));
}

async function poll() {
  const stored = await chrome.storage.local.get(['accessToken', 'apiBase', 'lastUnread']);
  const { apiBase } = resolveBases(stored);
  const { accessToken } = await getTokens(chrome.storage.local);
  if (!accessToken) {
    chrome.action.setBadgeText({ text: '' });
    return;
  }
  try {
    // Silently refreshes + retries on a 401 so the badge/session survive the full 30-day window.
    const res = await authedFetch(chrome.storage.local, apiBase, '/notifications/unread-count');
    if (!res.ok) return;
    const json = await res.json();
    const count = json?.data?.count ?? 0;

    chrome.action.setBadgeText({ text: count > 0 ? String(count) : '' });
    chrome.action.setBadgeBackgroundColor({ color: '#8B1E1E' });

    // Desktop notification when new unread items arrive (T16.5).
    if (shouldNotify(stored.lastUnread, count)) {
      chrome.notifications?.create({
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: 'MICO360 Tasks',
        message: notificationText(count),
      });
    }

    // Connection is up — replay any offline changes and record the sync time.
    await flushQueue(chrome.storage.local, makePerform(apiBase));
    await chrome.storage.local.set({ lastUnread: count, lastSync: Date.now() });
  } catch {
    /* offline — leave the badge as-is; the queue drains on the next successful poll */
  }
}

/** The extension UI is a full-page tab (no popup). Open it, focusing an existing one if present. */
async function openApp() {
  const url = chrome.runtime.getURL('app/app.html');
  try {
    const existing = await chrome.tabs.query({ url });
    if (existing && existing[0]) {
      await chrome.tabs.update(existing[0].id, { active: true });
      if (existing[0].windowId != null) await chrome.windows?.update(existing[0].windowId, { focused: true });
      return;
    }
  } catch {
    /* tabs.query can reject without the permission — fall through and just open a new tab */
  }
  await chrome.tabs.create({ url });
}

chrome.action.onClicked.addListener(() => void openApp());

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create('poll', { periodInMinutes: 1 });
  void poll();
});
chrome.runtime.onStartup?.addListener(() => void poll());

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'poll') void poll();
});
