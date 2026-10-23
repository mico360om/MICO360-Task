// Quick capture (Stage 2): the toolbar popup in Chrome against a local server. The manifest declares
// the popup, the keyboard shortcut and the right-click menu (no install warning); signed out, the
// popup sends you to sign in; signed in, it creates a task with its place, priority, due date, people,
// description, "Add this page" and a pasted picture (uploaded after the task is created), from the
// keyboard (Ctrl+Enter). "Describe it" shows the server's own answer. Offline, a task with files is
// held, then saved without them and synced later. The unsent form survives the popup closing, and
// what the right-click menu captured fills it.
//   node tools/extension-e2e/popup.mjs        (see lib.mjs for the settings)
import { launch, openApp, openPage, inWorker, signIn, signedIn, apiSession, credentials, checks, outDir, sleep } from './lib.mjs';

const shots = outDir('popup');
const { ck, error, done } = checks();
const who = credentials();
const server = await apiSession(who);
const projects = (await server.call('GET', '/projects')).data;
const project = projects.find((p) => p.code === 'MICO');
const team = (await server.call('GET', `/projects/${project.id}/members`)).data;
const onTeam = team.some((m) => m.id === server.user.id);
const archived = projects.find((p) => p.status === 'ARCHIVED');
const arabic = projects.find((p) => p.status !== 'ARCHIVED' && /[؀-ۿ]/.test(p.name));
const stamp = Date.now().toString(36);
const TITLE = `Ext popup ${stamp}`;
const OFFLINE_TITLE = `Ext popup offline ${stamp}`;
const created = [];
const findTask = async (title) => ((await server.call('GET', `/tasks?projectId=${project.id}&q=${encodeURIComponent(title)}`)).data || []).find((t) => t.title === title);

const POPUP = 'popup/popup.html';
const q = (sel) => `document.querySelector(${JSON.stringify(sel)})`;
const clickText = (label, scope = 'document') => `(() => { const b = [...${scope}.querySelectorAll('button')].find((x) => x.textContent.trim() === ${JSON.stringify(label)}); if (!b) return false; b.click(); return true; })()`;
const choose = (id, value) => `(() => { const s = document.getElementById(${JSON.stringify(id)}); s.value = ${JSON.stringify(value)}; s.dispatchEvent(new Event('change', { bubbles: true })); return s.value; })()`;
/** A real paste event carrying a small PNG named like a screenshot ("image.png"). */
const pastePicture = (targetId) => `(async () => {
  const c = document.createElement('canvas'); c.width = 12; c.height = 12;
  const g = c.getContext('2d'); g.fillStyle = '#8b1e1e'; g.fillRect(0, 0, 12, 12);
  const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
  const dt = new DataTransfer(); dt.items.add(new File([blob], 'image.png', { type: 'image/png' }));
  const e = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
  document.getElementById(${JSON.stringify(targetId)}).dispatchEvent(e);
  return { prevented: e.defaultPrevented, names: [...document.querySelectorAll('.qa-file-name')].map((n) => n.textContent) };
})()`;
const waitFor = async (page, expression, ms = 8000) => {
  const end = Date.now() + ms;
  for (;;) {
    const v = await page.evaluate(expression).catch(() => null);
    if (v || Date.now() > end) return v;
    await sleep(250);
  }
};

const browser = await launch({ name: 'popup' });
const { extId, manifest } = browser;
try {
  ck(`Chrome loads the extension ${manifest.version}`, !!extId, extId);
  ck('the toolbar button opens the popup (action.default_popup)', manifest.action.default_popup === POPUP, manifest.action.default_popup);
  ck('it asks for contextMenus and activeTab — neither shows an install warning — and no "tabs" permission or content script',
    manifest.permissions.includes('contextMenus') && manifest.permissions.includes('activeTab') && !manifest.permissions.includes('tabs') && !manifest.content_scripts, JSON.stringify(manifest.permissions));
  const menu = await inWorker(browser, `chrome.contextMenus.update('mico360-add-task', {}).then(() => true, (e) => String(e && e.message))`);
  ck('the background worker made the right-click menu item "Add to MICO360 Tasks"', menu === true, String(menu));

  // ---- Signed out -----------------------------------------------------------------------------
  const out = await openPage(browser, POPUP, { shotsDir: shots });
  ck('signed out, the popup says to sign in and offers "Open MICO360 Tasks"', /Sign in to MICO360 Tasks/.test(await out.text()) && await out.evaluate(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Open MICO360 Tasks')`), (await out.text()).slice(0, 200));
  await out.shot('01-signed-out.png');
  const shortcut = await out.evaluate(`chrome.commands.getAll().then((all) => (all.find((c) => c.name === '_execute_action') || {}).shortcut || '')`);
  ck('the keyboard shortcut Ctrl+Shift+K opens the popup (commands._execute_action)', shortcut === 'Ctrl+Shift+K', JSON.stringify(shortcut));
  await out.close();

  const app = await openApp(browser, { shotsDir: shots });
  ck('signs in to the local server in the app', signedIn((await signIn(app, who)).after));

  // ---- The form -------------------------------------------------------------------------------
  let page = await openPage(browser, POPUP, { shotsDir: shots, wait: 3500 });
  ck('the popup shows the New task form, with the title field focused', await page.evaluate(`document.querySelector('form[aria-label="New task"]') !== null && document.activeElement === document.getElementById('qa-title')`));
  const offered = await page.evaluate(`[...document.getElementById('qa-project').options].map((o) => o.value)`);
  ck('it offers your projects, without archived ones', offered.includes(project.id) && (!archived || !offered.includes(archived.id)), `${offered.length} offered`);
  if (arabic) ck('an Arabic project name gets its own text direction (dir=auto)', await page.evaluate(`[...document.getElementById('qa-project').options].find((o) => o.value === ${JSON.stringify(arabic.id)})?.getAttribute('dir') === 'auto'`));
  ck('typed fields follow the language being typed (dir=auto)', await page.evaluate(`['qa-title', 'qa-desc', 'qa-describe'].every((id) => document.getElementById(id).getAttribute('dir') === 'auto')`));
  await page.evaluate(choose('qa-project', project.id));
  await sleep(1500);
  const cols = await page.evaluate(`[...document.getElementById('qa-column').options].map((o) => o.textContent)`);
  ck(`choosing ${project.code} shows its board’s columns`, cols.length > 0 && !cols.includes('Loading…'), JSON.stringify(cols));

  // "Describe it": the server's own answer (on this demo server AI isn't set up).
  await page.evaluate(`(() => { const t = document.getElementById('qa-describe'); t.focus(); return true; })()`);
  await page.insertText('Send the site report to the team every Monday, high priority');
  await page.evaluate(clickText('Fill task details'));
  const described = await waitFor(page, `(() => { const a = document.querySelector('.qa-describe [role="alert"]'); if (a) return 'msg:' + a.textContent; return document.querySelector('[role="group"][aria-label="Suggested details"]') ? 'suggestions' : null; })()`, 60000);
  ck('"Describe it" shows the server’s own answer (here: AI is not configured yet), or its suggestions', /^msg:AI is not configured yet/.test(described || '') || described === 'suggestions', String(described));
  if (described === 'suggestions') await page.evaluate(clickText('Dismiss'));
  await page.shot('02-describe.png');

  // Fill it in: title (typed), priority, due date, me, a picture, this page.
  await page.evaluate(`document.getElementById('qa-title').focus(); true`);
  await page.insertText(TITLE);
  await page.evaluate(choose('qa-priority', 'HIGH'));
  await page.evaluate(`(() => { const d = document.getElementById('qa-due'); d.value = '2026-12-31'; d.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  if (onTeam) ck('"Assign me" is offered on a project you are on, and assigns you', await page.evaluate(clickText('Assign me')) && /\(you\)/.test(await page.evaluate(`document.querySelector('.qa-chips')?.textContent || ''`)));
  const pasted = await page.evaluate(pastePicture('qa-title'));
  ck('a pasted screenshot is added as "Pasted image <date> <time>.png"', pasted.prevented && pasted.names.length === 1 && /^Pasted image \d{4}-\d{2}-\d{2} \d{2}\.\d{2}\.\d{2}\.png$/.test(pasted.names[0]), JSON.stringify(pasted));
  // Opened as a tab here, the "page you are on" would be the popup itself: stand in a web page.
  await page.evaluate(`chrome.tabs.query = async () => [{ title: 'Pump P-12 datasheet', url: 'https://vendor.example/p12.pdf' }]; true`);
  await page.evaluate(clickText('Add this page'));
  await sleep(300);
  const desc = await page.evaluate(`document.getElementById('qa-desc').value`);
  ck('"Add this page" puts the page’s title and address into the description', desc === 'Pump P-12 datasheet\nhttps://vendor.example/p12.pdf', JSON.stringify(desc));
  const draft = await page.evaluate(`chrome.storage.session.get('mico360.quickAdd.draft').then((o) => o['mico360.quickAdd.draft'] || null)`);
  ck('the unsent form is kept in session storage (memory only) while you type', draft && draft.fields && draft.fields.title === TITLE, JSON.stringify(draft).slice(0, 200));
  await page.shot('03-filled.png', { full: true });

  // Ctrl+Enter from the description creates it; the picture goes up after the task exists.
  await page.evaluate(`document.getElementById('qa-desc').focus(); true`);
  await page.press('Enter', { ctrl: true });
  const banner = await waitFor(page, `(() => { const b = document.querySelector('.qa-banner'); return b && !/Creating|Attaching/.test(document.querySelector('button[type=submit]').textContent) ? b.textContent : null; })()`, 20000);
  ck('Ctrl+Enter creates the task and says so', /Created MICO-\d+ “/.test(banner || ''), String(banner));
  const T = await findTask(TITLE);
  if (T) created.push(T.id);
  ck('the server has the task with its priority, due date and description', T && T.priority === 'HIGH' && String(T.dueDate).startsWith('2026-12-31') && /vendor\.example\/p12\.pdf/.test(T.description || ''), JSON.stringify(T && { p: T.priority, d: T.dueDate, desc: T.description }));
  if (T && onTeam) {
    const assignees = (await server.call('GET', `/tasks/${T.id}/assignees`)).data || [];
    ck('…assigned to you', assignees.some((a) => a.id === server.user.id), JSON.stringify(assignees.map((a) => a.id)));
  }
  if (T) {
    const files = (await server.call('GET', `/tasks/${T.id}/attachments`)).data || [];
    ck('…with the pasted picture attached', files.length === 1 && /^Pasted image /.test(files[0].filename), JSON.stringify(files.map((f) => f.filename)));
  }
  ck('the form is ready for the next task, in the same project', await page.evaluate(`document.getElementById('qa-title').value === '' && document.getElementById('qa-project').value === ${JSON.stringify(project.id)} && document.querySelectorAll('.qa-file').length === 0`));
  ck('the task is listed under "Recently added"', (await page.evaluate(`document.querySelector('.qa-recent')?.textContent || ''`)).includes(TITLE));
  await page.shot('04-created.png', { full: true });

  // ---- Offline: a task with files is held, then saved without them ------------------------------
  await page.send('Network.enable', {}, page.sessionId);
  await page.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }, page.sessionId);
  await sleep(500);
  await page.evaluate(`document.getElementById('qa-title').focus(); true`);
  await page.insertText(OFFLINE_TITLE);
  await page.evaluate(pastePicture('qa-title'));
  await page.evaluate(clickText('Create task'));
  const held = await waitFor(page, `document.querySelector('.qa-banner.error')?.textContent || null`, 15000);
  ck('offline, a task with files is not queued silently: the popup says files can’t be attached offline', /files can’t be attached offline/.test(held || ''), String(held));
  ck('…and offers to save it without them', await page.evaluate(clickText('Save without the files')));
  const queuedMsg = await waitFor(page, `(() => { const b = document.querySelector('.qa-banner.info'); return b ? b.textContent : null; })()`, 15000);
  ck('saved on this device without its files, and it says so', /Saved on this device.*Its files weren’t kept/.test(queuedMsg || ''), String(queuedMsg));
  const queue = await page.evaluate(`chrome.storage.local.get('syncQueue').then((o) => (o.syncQueue || []).map((i) => ({ kind: i.kind, title: i.payload && i.payload.title, key: !!i.idempotencyKey })))`);
  ck('it waits in the offline queue with its idempotency key', queue.some((i) => i.kind === 'task.create' && i.title === OFFLINE_TITLE && i.key), JSON.stringify(queue));
  ck('"Recently added" shows it waiting to sync', /Waiting to sync/.test(await page.evaluate(`document.querySelector('.qa-recent')?.textContent || ''`)));
  await page.shot('05-offline.png', { full: true });
  await page.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }, page.sessionId);
  await sleep(500);
  const flushed = await page.evaluate(`chrome.runtime.sendMessage({ type: 'mico360:flush' })`);
  await sleep(1000);
  const T2 = await findTask(OFFLINE_TITLE);
  if (T2) created.push(T2.id);
  ck('back online, the background worker syncs it: the task exists, without files', !!T2 && ((await server.call('GET', `/tasks/${T2.id}/attachments`)).data || []).length === 0, JSON.stringify(flushed));

  // ---- The unsent form survives the popup closing; a right-click capture fills it ----------------
  await page.evaluate(`document.getElementById('qa-title').focus(); true`);
  await page.insertText('Half typed');
  await sleep(400);
  await page.close();
  page = await openPage(browser, POPUP, { shotsDir: shots, wait: 3000 });
  ck('closing and opening the popup brings the unsent title back', (await page.evaluate(`document.getElementById('qa-title').value`)) === 'Half typed');
  await page.evaluate(clickText('Clear'));
  await page.evaluate(`chrome.storage.session.set({ 'mico360.quickAdd.capture': { title: 'Order spares', text: 'Order spares\\nqty 4', link: '', page: { title: 'Stores', url: 'https://intranet.example/stores' }, at: Date.now() } })`);
  await page.close();
  page = await openPage(browser, POPUP, { shotsDir: shots, wait: 3000 });
  const capture = await page.evaluate(`({ title: document.getElementById('qa-title').value, desc: document.getElementById('qa-desc').value })`);
  ck('what the right-click menu captured fills the title and the description', capture.title === 'Order spares' && capture.desc === 'Order spares\nqty 4\n\nStores\nhttps://intranet.example/stores', JSON.stringify(capture));
  ck('…and is used once', (await page.evaluate(`chrome.storage.session.get('mico360.quickAdd.capture').then((o) => !o['mico360.quickAdd.capture'])`)) === true);
  await page.evaluate(clickText('Clear'));
  await page.shot('06-capture.png');

  // ---- "Open MICO360 Tasks" and recent tasks open the full app --------------------------------
  if (T) {
    await page.evaluate(`[...document.querySelectorAll('.qa-recent button')].find((b) => b.textContent.includes(${JSON.stringify(TITLE)})).click(); true`);
    await sleep(1500);
    const hash = await app.evaluate('location.hash');
    ck('a recent task opens in the app tab (its task drawer)', hash === `#/task/${encodeURIComponent(T.id)}`, hash);
  }
  ck('no script errors in the popup or the app', page.errors.length === 0 && app.errors.length === 0, [...page.errors, ...app.errors].join(' | '));
} catch (e) {
  error(e);
} finally {
  for (const id of created) {
    try { await server.call('DELETE', `/tasks/${id}`); } catch { /* best effort */ }
  }
  await browser.close();
}
process.exit(done());
