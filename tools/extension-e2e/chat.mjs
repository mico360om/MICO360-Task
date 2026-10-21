// Notifications and chat stay current (Stage 5), in Chrome against a local server: the chat inbox's
// sections; a direct conversation that reads itself again while open (a teammate's message appears
// without a reload; what is being typed stays); "Load older messages"; a message sent with Enter
// (once, with its clientId) and a picture pasted into the box; Favorite saved on the server; the
// inbox telling the server a message reached this device ("Delivered"); Settings → Notifications
// saved on the server; and the desktop alert naming the newest notification when allowed.
// Each change is checked on the server.
//   node tools/extension-e2e/chat.mjs        (see lib.mjs for the settings)
import { launch, openApp, signIn, signedIn, apiSession, credentials, checks, outDir, sleep, inWorker } from './lib.mjs';

const shots = outDir('chat');
const { ck, error, done } = checks();
const who = credentials();
const admin = await apiSession(who);
const mate = await apiSession(credentials(process.env.MICO_E2E_TEAMMATE || 'mariam@mico360.test'));
const get = async (s, path) => (await s.call('GET', path)).data;
const stamp = Date.now().toString(36);
const mateRow = (await get(admin, '/users/directory')).find((u) => u.id === mate.user.id) || {};
const mateName = `${mateRow.firstName ?? ''} ${mateRow.lastName ?? ''}`.trim() || mate.user.username;

// A direct conversation with enough history for a second page (made once; later runs reuse it).
const dm = (await admin.call('POST', '/conversations/direct', { userId: mate.user.id })).data;
const history = await get(admin, `/conversations/${dm.id}/messages?limit=100`);
for (let i = history.length; i < 55; i += 1) await mate.call('POST', `/conversations/${dm.id}/messages`, { body: `History ${i + 1}` });
await admin.call('POST', `/conversations/${dm.id}/read`);
await admin.call('PUT', `/conversations/${dm.id}/prefs`, { favorite: false, archived: false, muted: false });
const prefsBefore = await get(admin, '/notifications/preferences');

const browser = await launch({ name: 'chat' });
try {
  const page = await openApp(browser, { shotsDir: shots });
  const { evaluate, shot, press, insertText } = page;
  ck('signs in to the local server', signedIn((await signIn(page, who)).after));

  // ---- The inbox -----------------------------------------------------------------------------
  await evaluate(`location.hash = '#/chat'; true`);
  await sleep(3000);
  const inbox = await evaluate(`(() => {
    const sections = [...document.querySelectorAll('.chat-section-toggle')].map((t) => t.querySelector('.chat-section-name')?.textContent);
    const row = [...document.querySelectorAll('.chat-row')].find((r) => r.querySelector('.chat-row-title')?.textContent === ${JSON.stringify(mateName)});
    return { sections, row: !!row, more: !!row?.querySelector('[aria-label=${JSON.stringify(`More options for ${mateName}`)}]'), dm: !!document.querySelector('[aria-label="New direct message"]') };
  })()`);
  ck('the inbox: project channels and direct messages, with this conversation and its options', inbox.sections.includes('Project channels') && inbox.sections.includes('Direct messages') && inbox.row && inbox.more && inbox.dm, JSON.stringify(inbox));
  await shot('01-inbox.png');

  // ---- A conversation reads itself again while open ------------------------------------------
  await evaluate(`(() => { [...document.querySelectorAll('.chat-row')].find((r) => r.querySelector('.chat-row-title')?.textContent === ${JSON.stringify(mateName)}).querySelector('.chat-row-open').click(); return true; })()`);
  await sleep(3000);
  const opened = await evaluate(`({ hash: location.hash, title: document.querySelector('.chat-title')?.textContent, log: document.querySelector('[role="log"]')?.getAttribute('aria-label'),
    older: [...document.querySelectorAll('button')].some((b) => b.textContent === 'Load older messages'), count: document.querySelectorAll('[data-message-id]').length })`);
  ck('opens the conversation: its name, its messages in a log, “Load older messages”', opened.hash === `#/chat/${dm.id}` && opened.title === mateName && opened.log === 'Messages' && opened.older && opened.count >= 50, JSON.stringify(opened));
  await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent === 'Load older messages'); b.focus(); b.click(); return true; })()`);
  await sleep(2500);
  const older = await evaluate(`document.querySelectorAll('[data-message-id]').length`);
  ck('“Load older messages” adds the page before', older > opened.count, `${opened.count} → ${older}`);

  await evaluate(`(() => { const t = document.querySelector('textarea[aria-label="Message"]'); t.focus(); return true; })()`);
  await insertText('Half a thought');
  const POLL_TEXT = `Ext poll ${stamp}`;
  await mate.call('POST', `/conversations/${dm.id}/messages`, { body: POLL_TEXT });
  await sleep(15000);
  const polled = await evaluate(`({ shown: [...document.querySelectorAll('[data-message-id]')].some((n) => n.textContent.includes(${JSON.stringify(POLL_TEXT)})),
    draft: document.querySelector('textarea[aria-label="Message"]').value, focus: document.activeElement?.getAttribute('aria-label') })`);
  ck('a teammate’s new message appears within 15 s, without a reload', polled.shown, JSON.stringify(polled));
  ck('…what was being typed, and focus, stay in the message box', polled.draft === 'Half a thought' && polled.focus === 'Message', JSON.stringify(polled));
  const unreadAfter = (await get(admin, '/conversations')).find((s) => s.conversation.id === dm.id)?.unread;
  ck('…and it is marked read on the server (the tab is in front)', unreadAfter === 0, `unread ${unreadAfter}`);
  await shot('02-thread.png');

  // Review fix #5: what was being typed stays with the conversation after going Back.
  await evaluate(`[...document.querySelectorAll('button')].find((b) => b.textContent === '← Back').click(); true`);
  await sleep(2000);
  await evaluate(`location.hash = '#/chat/${dm.id}'; true`);
  await sleep(3000);
  const kept = await evaluate(`document.querySelector('textarea[aria-label="Message"]').value`);
  ck('what was being typed is still there after going Back and returning', kept === 'Half a thought', JSON.stringify(kept));

  // ---- Sending ---------------------------------------------------------------------------------
  const SENT = `Ext hello ${stamp}`;
  await evaluate(`(() => { const t = document.querySelector('textarea[aria-label="Message"]'); t.value = ''; t.dispatchEvent(new Event('input', { bubbles: true })); t.focus(); return true; })()`);
  await insertText(SENT);
  await press('Enter');
  await sleep(2500);
  await sleep(13000); // and through the next read: still shown once
  const onServer = (await get(admin, `/conversations/${dm.id}/messages`)).filter((m) => m.body === SENT);
  const shownSent = await evaluate(`[...document.querySelectorAll('[data-message-id]')].filter((n) => n.querySelector('.txt')?.textContent === ${JSON.stringify(SENT)}).length`);
  ck('Enter sends it: once on the server, with its clientId; shown once, even after the next read', onServer.length === 1 && !!onServer[0].clientId && onServer[0].userId === admin.user.id && shownSent === 1, JSON.stringify({ server: onServer.length, clientId: onServer[0]?.clientId, shownSent }));

  await evaluate(`(async () => {
    const c = document.createElement('canvas'); c.width = 24; c.height = 24;
    const g = c.getContext('2d'); g.fillStyle = '#8B1E1E'; g.fillRect(0, 0, 24, 24);
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    const dt = new DataTransfer(); dt.items.add(new File([blob], 'image.png', { type: 'image/png' }));
    const t = document.querySelector('textarea[aria-label="Message"]');
    t.focus();
    t.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    return true;
  })()`);
  await sleep(4000);
  const pic = (await get(admin, `/conversations/${dm.id}/messages`)).filter((m) => m.userId === admin.user.id && (m.attachments || []).some((a) => a.mimeType === 'image/png' && /^Pasted image /.test(a.fileName))).pop();
  const picShown = await evaluate(`(() => { const a = [...document.querySelectorAll('a.chat-picture')].pop(); return a ? { label: a.getAttribute('aria-label'), img: !!a.querySelector('img'), loaded: a.querySelector('img')?.naturalWidth || 0 } : null; })()`);
  ck('a picture pasted into the box is sent as a message (“Pasted image …”)', !!pic, JSON.stringify(pic && pic.attachments));
  ck('…and shown in the conversation, from this server', !!picShown && /^Open Pasted image /.test(picShown.label) && picShown.img, JSON.stringify(picShown));
  await shot('03-sent.png');

  // ---- Favorite --------------------------------------------------------------------------------
  await evaluate(`document.querySelector('[aria-label="Favorite"]').click(); true`);
  await sleep(2000);
  const fav = (await get(admin, '/conversations')).find((s) => s.conversation.id === dm.id)?.prefs;
  const pressed = await evaluate(`document.querySelector('[aria-label="Favorite"]').getAttribute('aria-pressed')`);
  ck('Favorite is saved on the server and shown pressed', fav && fav.favorite === true && pressed === 'true', JSON.stringify({ fav, pressed }));

  // ---- Delivered, from the inbox ---------------------------------------------------------------
  await evaluate(`location.hash = '#/chat'; true`);
  await sleep(2500);
  const favorites = await evaluate(`(() => { const s = [...document.querySelectorAll('.chat-section')].find((x) => x.dataset.section === 'favorites'); return !!s && [...s.querySelectorAll('.chat-row-title')].some((t) => t.textContent === ${JSON.stringify(mateName)}); })()`);
  ck('…and the conversation is listed under Favorites', favorites);
  const DELIVER = `Ext delivered ${stamp}`;
  const posted = (await mate.call('POST', `/conversations/${dm.id}/messages`, { body: DELIVER })).data;
  await sleep(15000);
  const seenByMate = (await get(mate, '/conversations')).find((s) => s.conversation.id === dm.id);
  const adminPart = seenByMate && seenByMate.participants.find((p) => p.userId === admin.user.id);
  ck('the inbox tells the server a new direct message reached this device (the sender sees “Delivered”)', !!adminPart && !!adminPart.lastDeliveredAt && adminPart.lastDeliveredAt >= posted.createdAt, JSON.stringify(adminPart));
  const badge = await evaluate(`(() => { const r = [...document.querySelectorAll('.chat-row')].find((x) => x.querySelector('.chat-row-title')?.textContent === ${JSON.stringify(mateName)}); return r?.querySelector('.badge')?.getAttribute('aria-label') ?? null; })()`);
  ck('…and its unread count shows without leaving the inbox', badge === '1 unread', String(badge));

  // ---- Settings → Notifications ----------------------------------------------------------------
  await evaluate(`location.hash = '#/settings'; true`);
  await sleep(3000);
  await evaluate(`document.querySelector('[aria-label="Notify me: Comments"]').click(); true`);
  await sleep(2000);
  const saved = await get(admin, '/notifications/preferences');
  ck('switching off “Comments” is saved on the server (the rest kept)', saved.muted.includes('TASK_COMMENT') && JSON.stringify(saved.dailyEmails) === JSON.stringify(prefsBefore.dailyEmails), JSON.stringify(saved));
  await evaluate(`document.querySelector('[aria-label="Say what it’s about"]').click(); true`);
  await sleep(800);
  const alertsSet = await evaluate(`chrome.storage.local.get('desktopAlerts').then((o) => o.desktopAlerts)`);
  ck('“Say what it’s about” is kept on this device', alertsSet && alertsSet.on === true && alertsSet.details === true, JSON.stringify(alertsSet));

  // Review fix #1: a time typed with the keyboard is saved once, when the field is left — Chrome
  // reports each part as a change while it is typed (it used to save 00:00 first).
  const TIME = prefsBefore.dailyEmails && prefsBefore.dailyEmails.time === '09:45' ? '10:15' : '09:45';
  await evaluate(`(() => { const t = document.getElementById('nset-time'); t.scrollIntoView(); t.focus(); return true; })()`);
  for (const ch of TIME.replace(':', '')) {
    const base = { key: ch, code: `Digit${ch}`, windowsVirtualKeyCode: 48 + Number(ch), nativeVirtualKeyCode: 48 + Number(ch), text: ch, unmodifiedText: ch };
    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', ...base }, page.sessionId);
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base }, page.sessionId);
    await sleep(250);
  }
  await sleep(1500);
  const typing = await evaluate(`({ value: document.getElementById('nset-time').value, focus: document.activeElement?.id, alert: document.querySelector('.nset [role="alert"]')?.textContent || '' })`);
  const whileTyping = (await get(admin, '/notifications/preferences')).dailyEmails;
  ck('typing a time keeps the field (and focus) and saves nothing yet', typing.value === TIME && typing.focus === 'nset-time' && !typing.alert && whileTyping.time === prefsBefore.dailyEmails.time, JSON.stringify({ typing, whileTyping }));
  // Tab moves through the field's own parts (hours, minutes, AM/PM) before it leaves the field.
  for (let i = 0; i < 4 && (await evaluate(`document.activeElement?.id`)) === 'nset-time'; i += 1) await press('Tab');
  await sleep(2000);
  const afterTab = (await get(admin, '/notifications/preferences')).dailyEmails;
  ck('…leaving the field saves the whole time once', afterTab.time === TIME, JSON.stringify(afterTab));
  await shot('04-settings.png', { full: true });

  // ---- The desktop alert names the newest notification ------------------------------------------
  // Chrome stops an idle service worker after about 30 s: a message from the page wakes it.
  await evaluate(`chrome.runtime.sendMessage({ type: 'mico360:flush' }).catch(() => null).then(() => true)`);
  await sleep(800);
  await inWorker(browser, `(() => { self.__alerts = []; const make = chrome.notifications.create.bind(chrome.notifications);
    chrome.notifications.create = (id, opts, cb) => { self.__alerts.push({ id, opts }); return make(id, opts, cb); }; return true; })()`);
  // An unread notification about the same conversation is reworded by the server (the count stays):
  // start from none unread, so the teammate's message makes a new one and the count rises.
  await admin.call('POST', '/notifications/read-all');
  const count = (await get(admin, '/notifications/unread-count')).count;
  await evaluate(`chrome.storage.local.set({ lastUnread: ${count}, lastUnreadUser: ${JSON.stringify(admin.user.id)} }).then(() => true)`);
  const ALERT = `Ext alert ${stamp}`;
  await mate.call('POST', `/conversations/${dm.id}/messages`, { body: ALERT });
  await sleep(1500);
  const newest = (await get(admin, '/notifications')).filter((n) => !n.readAt).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  await inWorker(browser, `chrome.alarms.create('poll', { when: Date.now() + 300, periodInMinutes: 1 }).then(() => true)`);
  await sleep(4000);
  const made = await inWorker(browser, `self.__alerts`);
  const alert = (made || []).pop();
  ck('a new notification: the desktop alert says what it is about (allowed on this device)', !!alert && !!newest && alert.opts.title === newest.title && alert.opts.contextMessage === 'MICO360 Tasks', JSON.stringify({ alert, newest: newest && { title: newest.title, body: newest.body } }));
  const target = await inWorker(browser, `chrome.storage.session.get('mico360.alertTarget').then((o) => o['mico360.alertTarget'])`);
  ck('…and remembers it, so a click opens that conversation', !!target && target.id === newest.id && target.entityType === newest.entityType, JSON.stringify(target));

  // ---- Notifications stay current ----------------------------------------------------------------
  await evaluate(`location.hash = '#/notifications'; true`);
  await sleep(2500);
  const before = await evaluate(`document.querySelectorAll('.nrow').length`);
  await mate.call('POST', `/conversations/${dm.id}/messages`, { body: `Ext list ${stamp}` });
  await sleep(1500);
  await evaluate(`document.dispatchEvent(new Event('visibilitychange')); true`);
  await sleep(2500);
  const list = await evaluate(`({ rows: document.querySelectorAll('.nrow').length, first: document.querySelector('.nrow .ntitle')?.textContent, spinner: !!document.querySelector('.state .spinner') })`);
  const newestNow = (await get(admin, '/notifications'))[0];
  ck('Notifications read themselves again on coming back to the tab: the newest is at the top', list.first === newestNow.title && !list.spinner && list.rows >= Math.min(before, 100), JSON.stringify({ ...list, newest: newestNow.title, before }));
  await shot('05-notifications.png');

  // "Mark all as read" stops at the newest one shown (`upTo`); a server from before it ignores the
  // body and reads them all — either way nothing shown is left unread.
  await evaluate(`(() => { window.__readAll = []; const real = window.fetch.bind(window);
    window.fetch = (url, init) => { if (String(url).endsWith('/notifications/read-all')) window.__readAll.push(init && init.body); return real(url, init); }; return true; })()`);
  const markAll = await evaluate(`(() => { const b = document.querySelector('.mark-all'); if (b) b.click(); return !!b; })()`);
  await sleep(2500);
  const bodies = await evaluate('window.__readAll');
  const sentUpTo = bodies && bodies[0] ? JSON.parse(bodies[0]).upTo : undefined;
  ck('“Mark all as read” sends the newest notification shown as upTo', markAll && sentUpTo === new Date(newestNow.createdAt).toISOString(), JSON.stringify({ markAll, bodies, newest: newestNow.createdAt }));
  const leftUnread = (await get(admin, '/notifications/unread-count')).count;
  ck('…and the server reads them (an older server, which ignores upTo, reads them all)', leftUnread === 0, String(leftUnread));
  ck('no script errors in the extension page', page.errors.length === 0, page.errors.join(' | ').slice(0, 300));
} catch (e) {
  error(e);
} finally {
  await browser.close();
  await admin.call('PUT', `/conversations/${dm.id}/prefs`, { favorite: false }).catch(() => {});
  await admin.call('PUT', '/notifications/preferences', { muted: prefsBefore.muted, ...(typeof prefsBefore.reminderLeadMinutes === 'number' ? { reminderLeadMinutes: prefsBefore.reminderLeadMinutes } : {}) }).catch(() => {});
  if (prefsBefore.dailyEmails) await admin.call('PUT', '/notifications/preferences', { dailyEmails: prefsBefore.dailyEmails }).catch(() => {});
}
console.log(`  (screenshots: ${shots})`);
process.exit(done());
