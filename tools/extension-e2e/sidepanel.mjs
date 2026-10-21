// The side panel (Stage 7), in Chrome against a local server. Its page (app/panel.html) is opened in
// a tab at 360 px and at 320 px: Today (overdue and due today for me, in company time; not later
// work), "Mark done" (saved on the server, under Done today, focus kept), a task's panel inside the
// side panel (fits, Escape closes it, focus goes back), My Tasks, the new-task form ("Open it" opens
// the task here), reading again on coming back, a page it doesn't show opening in the full app page,
// "Open MICO360 Tasks", and nothing wider than the panel. Then the real side panel: the app's and
// the popup's buttons open it (a real click), Chrome's own list of install warnings is the same
// without the sidePanel permission, and signing out in the app clears the side panel.
//   node tools/extension-e2e/sidepanel.mjs        (see lib.mjs for the settings)
import { launch, openApp, openPage, signIn, signedIn, apiSession, credentials, checks, outDir, todayIn, sleep, inWorker } from './lib.mjs';

const shots = outDir('sidepanel');
const { ck, error, done } = checks();
const who = credentials();
const server = await apiSession(who);
const me = server.user;
const get = async (path) => (await server.call('GET', path)).data;
const project = (await get('/projects')).find((p) => p.code === 'MICO');
const columns = (await get(`/projects/${project.id}/columns`)).filter((c) => c.enabled).sort((a, b) => a.position - b.position);
const todo = columns.find((c) => c.category === 'TODO') ?? columns[0];
const stamp = Date.now().toString(36);
const today = todayIn();
const shift = (key, days) => { const d = new Date(`${key}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
const make = async (title, dueDate) => (await server.call('POST', '/tasks', { title, projectId: project.id, columnId: todo.id, dueDate, assigneeIds: [me.id] })).data;
const LATE = `Ext panel late ${stamp}`;
const TODAY = `Ext panel today ${stamp}`;
const LATER = `Ext panel later ${stamp}`;
const ADDED = `Ext panel added ${stamp}`;
const AGAIN = `Ext panel again ${stamp}`;
const late = await make(LATE, shift(today, -2));
const due = await make(TODAY, today);
const later = await make(LATER, shift(today, 5));
const made = [late.id, due.id, later.id];

const browser = await launch({ name: 'sidepanel' });
try {
  const app = await openApp(browser, { shotsDir: shots });
  ck('signs in to the local server (the side panel shares the session)', signedIn((await signIn(app, who)).after));

  // ---- Chrome's own list of install warnings ------------------------------------------------
  const warn = await app.evaluate(`(async () => {
    if (!chrome.management || !chrome.management.getPermissionWarningsByManifest) return null;
    const m = chrome.runtime.getManifest();
    const without = { ...m, permissions: m.permissions.filter((p) => p !== 'sidePanel') }; delete without.side_panel;
    return { with: await chrome.management.getPermissionWarningsByManifest(JSON.stringify(m)), without: await chrome.management.getPermissionWarningsByManifest(JSON.stringify(without)) };
  })()`);
  ck('the side panel adds no install warning (Chrome’s list is the same without it)', !!warn && JSON.stringify(warn.with) === JSON.stringify(warn.without), JSON.stringify(warn));
  if (warn) console.log(`  (Chrome's install warnings: ${JSON.stringify(warn.with)})`);

  // ---- The panel's page in a tab, 360 px wide ---------------------------------------------------
  const panel = await openPage(browser, 'app/panel.html', { shotsDir: shots });
  const { evaluate, press, insertText, send, sessionId } = panel;
  const narrow = async (width) => {
    await send('Emulation.setDeviceMetricsOverride', { width, height: 800, deviceScaleFactor: 1, mobile: false }, sessionId);
    await sleep(400);
  };
  const shot = async (file) => {
    const { data } = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
    const fs = await import('node:fs');
    fs.writeFileSync(`${shots}/${file}`, Buffer.from(data, 'base64'));
  };
  const fits = () => evaluate(`(() => {
    const over = document.documentElement.scrollWidth - window.innerWidth;
    const wide = [...document.querySelectorAll('body *')].filter((n) => { const r = n.getBoundingClientRect(); return r.width && (r.right > window.innerWidth + 1 || r.left < -1); })
      .filter((n) => !n.closest('.sr-only')).slice(0, 3).map((n) => n.className || n.tagName);
    return { over, wide };
  })()`);
  const fitsOk = (f) => f.over <= 1 && f.wide.length === 0;
  await narrow(360);
  await evaluate('location.hash = "#/"; location.reload(); true');
  await sleep(4000);

  const view = await evaluate(`(() => ({
    tabs: [...document.querySelectorAll('nav[aria-label="Side panel"] a')].map((a) => [a.textContent, a.getAttribute('aria-current')]),
    sections: [...document.querySelectorAll('.mt-section .section-title')].map((s) => s.textContent),
    text: document.body.innerText, date: document.querySelector('.today-date')?.textContent, h1: document.querySelector('h1')?.textContent,
    open: [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Open MICO360 Tasks'),
  }))()`);
  ck('the panel shows its tabs (Today, My Tasks, Add a task) with Today current, and “Open MICO360 Tasks”',
    JSON.stringify(view.tabs) === JSON.stringify([['Today', 'page'], ['My Tasks', null], ['Add a task', null]]) && view.open && view.h1 === 'Today', JSON.stringify(view.tabs));
  ck('Today lists what is overdue and due today for me — not later work — with the day', view.text.includes(LATE) && view.text.includes(TODAY) && !view.text.includes(LATER) && !!view.date
    && view.sections.some((s) => s.startsWith('Overdue')) && view.sections.some((s) => s.startsWith('Due today')), JSON.stringify({ sections: view.sections, date: view.date }));
  let f = await fits();
  ck('at 360 px: Today fits the width', fitsOk(f), JSON.stringify(f));
  await shot('01-today-360.png');

  // Mark done, by keyboard.
  await evaluate(`(() => { document.querySelector(${JSON.stringify(`[aria-label="Mark done: “${TODAY}”"]`)}).focus(); return true; })()`);
  await press('Enter');
  await sleep(3000);
  const t1 = await get(`/tasks/${due.id}`);
  const after = await evaluate(`(() => { const s = [...document.querySelectorAll('.mt-section')].find((x) => x.querySelector('.section-title').textContent.startsWith('Done today'));
    return { done: !!s && s.textContent.includes(${JSON.stringify(TODAY)}), focus: document.activeElement?.dataset?.taskId, said: document.querySelector('.content .sr-only[role="status"]')?.textContent }; })()`);
  ck('“Mark done” in Today: done on the server, listed under Done today, focus stays on it, and it is said', t1.columnCategory === 'DONE' && after.done && after.focus === due.id && after.said === `“${TODAY}” is done.`,
    JSON.stringify({ server: t1.columnCategory, ...after }));

  // A task's panel inside the side panel.
  await evaluate(`(() => { [...document.querySelectorAll('.task-row')].find((r) => r.dataset.taskId === ${JSON.stringify(late.id)}).focus(); return true; })()`);
  await press('Enter');
  await sleep(3000);
  const drawer = await evaluate(`(() => { const d = document.querySelector('.drawer[role="dialog"]'); if (!d) return null; const r = d.getBoundingClientRect();
    return { hash: location.hash, width: Math.round(r.width), inner: window.innerWidth, scroll: d.scrollWidth - d.clientWidth, body: d.querySelector('.drawer-body').scrollWidth - d.querySelector('.drawer-body').clientWidth,
      title: [...d.querySelectorAll('input, textarea')].some((x) => x.value === ${JSON.stringify(LATE)}), focusIn: d.contains(document.activeElement) }; })()`);
  ck('a row opens the task’s panel inside the side panel, the whole width, with focus in it', !!drawer && drawer.hash === `#/task/${late.id}` && drawer.title && drawer.focusIn && drawer.width === drawer.inner, JSON.stringify(drawer));
  f = await fits();
  ck('at 360 px: the task’s panel fits (nothing wider than the side panel)', fitsOk(f) && drawer && drawer.scroll <= 1 && drawer.body <= 1, JSON.stringify({ ...f, drawer }));
  await shot('02-task-360.png');
  await press('Escape');
  await sleep(2000);
  const back = await evaluate(`({ hash: location.hash, dialog: !!document.querySelector('.drawer'), focus: document.activeElement?.dataset?.taskId })`);
  ck('Escape closes it; focus goes back to the row that opened it', back.hash === '#/' && !back.dialog && back.focus === late.id, JSON.stringify(back));

  // My Tasks.
  await evaluate(`document.querySelector('nav[aria-label="Side panel"] a[href="#/my-tasks"]').click(); true`);
  await sleep(3000);
  const mt = await evaluate(`({ text: document.body.innerText, search: !!document.querySelector('[aria-label="Search my tasks"]'), current: document.querySelector('nav a[aria-current="page"]')?.textContent })`);
  ck('My Tasks lists all my open work (later work too), with its search and filters', mt.current === 'My Tasks' && mt.search && mt.text.includes(LATER), JSON.stringify({ current: mt.current, search: mt.search }));
  f = await fits();
  ck('at 360 px: My Tasks fits the width', fitsOk(f), JSON.stringify(f));
  await shot('03-my-tasks-360.png');
  await evaluate(`(() => { document.querySelector(${JSON.stringify(`[aria-label="Mark done: “${LATER}”"]`)}).click(); return true; })()`);
  await sleep(3000);
  ck('“Mark done” in My Tasks: done on the server', (await get(`/tasks/${later.id}`)).columnCategory === 'DONE');

  // Add a task.
  await evaluate(`document.querySelector('nav[aria-label="Side panel"] a[href="#/add"]').click(); true`);
  await sleep(3000);
  const form = await evaluate(`({ form: document.querySelector('form')?.getAttribute('aria-label'), head: !!document.querySelector('.qa-head'), page: [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Add this page') })`);
  ck('Add a task shows the new-task form, without a header of its own or “Add this page”', form.form === 'New task' && !form.head && !form.page, JSON.stringify(form));
  f = await fits();
  ck('at 360 px: the new-task form fits the width', fitsOk(f), JSON.stringify(f));
  await shot('04-add-360.png');
  const focused = await evaluate(`document.activeElement?.id || ''`);
  ck('…choosing the tab puts you in the title (as the popup does)', focused === 'qa-title', focused);
  await evaluate(`document.getElementById('qa-title').focus(); true`);
  await insertText(ADDED);
  await press('Enter', { ctrl: true });
  await sleep(3500);
  const banner = await evaluate(`document.querySelector('.qa-banner')?.textContent || ''`);
  await evaluate(`[...document.querySelectorAll('.qa-banner button')].find((b) => b.textContent.trim() === 'Open it').click(); true`);
  await sleep(3000);
  const opened = await evaluate(`({ hash: location.hash, title: [...document.querySelectorAll('.drawer input, .drawer textarea')].some((x) => x.value === ${JSON.stringify(ADDED)}) })`);
  const createdId = decodeURIComponent((/^#\/task\/(.+)$/.exec(opened.hash) || [])[1] || '');
  const created = createdId ? await get(`/tasks/${encodeURIComponent(createdId)}`) : null;
  if (created && created.id) made.push(created.id);
  ck('Ctrl+Enter creates the task on the server, and says so', !!created && created.title === ADDED && /^Created /.test(banner), JSON.stringify({ banner, title: created && created.title }));
  ck('…“Open it” opens the new task’s panel here, in the side panel', !!created && opened.title, JSON.stringify(opened));
  await press('Escape');
  await sleep(1500);
  const kept = await evaluate(`({ hash: location.hash, form: !!document.querySelector('form[aria-label="New task"]') })`);
  ck('…and closing it goes back to the form', kept.hash === '#/add' && kept.form, JSON.stringify(kept));

  // Reading again on coming back.
  await evaluate(`document.querySelector('nav[aria-label="Side panel"] a[href="#/"]').click(); true`);
  await sleep(2500);
  const again = await make(AGAIN, today);
  made.push(again.id);
  await evaluate(`document.dispatchEvent(new Event('visibilitychange')); true`);
  await sleep(3000);
  ck('coming back to the side panel reads Today again (a task added elsewhere shows)', (await evaluate('document.body.innerText')).includes(AGAIN));

  // A page the panel doesn't show opens in the full app page; the panel stays where it was.
  await evaluate(`location.hash = '#/projects'; true`);
  await sleep(2500);
  const elsewhere = await evaluate(`(async () => ({ hash: location.hash, tabs: (await chrome.runtime.getContexts({ contextTypes: ['TAB'] })).map((c) => c.documentUrl) }))()`);
  ck('a page it doesn’t show (Projects) opens in the full app page; the side panel stays on Today', elsewhere.hash === '#/' && elsewhere.tabs.some((u) => u.endsWith('/app/app.html#/projects')), JSON.stringify(elsewhere));

  // 400 px (the widest a side panel opens at by default) and 320 px (the narrowest).
  for (const width of [400, 320]) {
    await narrow(width);
    for (const [hash, name] of [['#/', 'Today'], ['#/my-tasks', 'My Tasks'], ['#/add', 'the new-task form'], [`#/task/${late.id}`, 'a task’s panel']]) {
      await evaluate(`location.hash = ${JSON.stringify(hash)}; true`);
      await sleep(3000);
      f = await fits();
      ck(`at ${width} px: ${name} fits the width`, fitsOk(f), JSON.stringify(f));
    }
    await shot(`05-task-${width}.png`);
    await press('Escape');
    await sleep(1500);
  }

  // Keyboard focus is never hidden under the sticky header or the form's sticky "Create task" bar
  // (WCAG 2.4.11), in a short side panel: 360 × 420, with enough due today for Today to scroll.
  for (let i = 0; i < 6; i += 1) made.push((await make(`Ext panel more ${i} ${stamp}`, today)).id);
  await send('Emulation.setDeviceMetricsOverride', { width: 360, height: 420, deviceScaleFactor: 1, mobile: false }, sessionId);
  await sleep(400);
  const where = () => evaluate(`(() => {
    const a = document.activeElement;
    if (!a || a === document.body) return { what: 'body', hidden: false };
    const head = document.querySelector('.panel-top').getBoundingClientRect();
    const barEl = a.closest('.qa-actions') ? null : document.querySelector('.qa-in-panel .qa-actions');
    const bar = barEl && barEl.getBoundingClientRect();
    const r = a.getBoundingClientRect();
    const underHead = !a.closest('.panel-top') && r.top < head.bottom - 0.5;
    const underBar = !!bar && bar.height > 0 && r.bottom > bar.top + 0.5 && r.top < bar.bottom;
    return { what: (a.getAttribute('aria-label') || a.id || a.textContent.trim()).slice(0, 36), top: Math.round(r.top), bottom: Math.round(r.bottom),
      head: Math.round(head.bottom), bar: bar ? Math.round(bar.top) : null, hidden: underHead || underBar, inTabs: !!a.closest('.panel-tabs'), create: a.textContent.trim() === 'Create task' };
  })()`);
  /** Press Tab (or Shift+Tab) until `stop(where)`; the places where focus was hidden. */
  const walk = async (shift, stop, max = 40) => {
    const hidden = [];
    for (let i = 0; i < max; i += 1) {
      await press('Tab', { shift });
      await sleep(150);
      const w = await where();
      if (w.hidden) hidden.push(w);
      if (stop(w)) return { hidden, reached: true };
    }
    return { hidden, reached: false };
  };
  await evaluate('location.hash = "#/"; true');
  await sleep(3000);
  await evaluate(`(() => { const all = [...document.querySelectorAll('.task-row, .mark-done')]; all[all.length - 1].focus(); return true; })()`);
  await sleep(300);
  const upToday = await walk(true, (w) => w.inTabs);
  const tall = await evaluate('document.documentElement.scrollHeight > innerHeight + 100');
  ck('at 360 × 420: Shift+Tab up Today never leaves focus hidden under the panel’s header', tall && upToday.reached && upToday.hidden.length === 0, JSON.stringify({ tall, ...upToday }).slice(0, 400));
  await evaluate('location.hash = "#/add"; true');
  await sleep(3000);
  await evaluate(`document.getElementById('qa-title').focus(); true`);
  const downForm = await walk(false, (w) => w.create);
  ck('…Tab down the new-task form never leaves focus hidden under its “Create task” bar', downForm.reached && downForm.hidden.length === 0, JSON.stringify(downForm).slice(0, 400));
  const upForm = await walk(true, (w) => w.inTabs);
  ck('…and Shift+Tab back up it never leaves focus hidden under the header', upForm.reached && upForm.hidden.length === 0, JSON.stringify(upForm).slice(0, 400));
  await shot('06-focus-360x420.png');
  ck('no script errors in the side panel page', panel.errors.length === 0, panel.errors.join(' | ').slice(0, 300));

  // "Open MICO360 Tasks": the full app page (a new tab when none is open).
  await app.close();
  await sleep(800);
  await evaluate(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Open MICO360 Tasks').click(); true`);
  await sleep(2500);
  const appTabs = await evaluate(`(async () => (await chrome.runtime.getContexts({ contextTypes: ['TAB'] })).map((c) => c.documentUrl).filter((u) => u.includes('/app/app.html')))()`);
  ck('“Open MICO360 Tasks” opens the full app page', appTabs.length === 1, JSON.stringify(appTabs));
  await panel.close();

  // ---- The real side panel: opened by a click on the app's and the popup's buttons ----------------
  const page2 = await openApp(browser, { shotsDir: shots });
  await sleep(1500);
  const click = async (p, selector) => {
    const r = await p.evaluate(`(() => { const b = document.querySelector(${JSON.stringify(selector)}); if (!b) return null; const x = b.getBoundingClientRect(); return { x: x.left + x.width / 2, y: x.top + x.height / 2 }; })()`);
    if (!r) return false;
    for (const type of ['mousePressed', 'mouseReleased']) await p.send('Input.dispatchMouseEvent', { type, x: r.x, y: r.y, button: 'left', clickCount: 1 }, p.sessionId);
    return true;
  };
  /** The side panel's page, whatever screen it shows (its address has the hash). */
  const isPanelUrl = (u) => typeof u === 'string' && u.split('#')[0].endsWith('/app/panel.html');
  const panels = () => inWorker(browser, `chrome.runtime.getContexts({ contextTypes: ['SIDE_PANEL'] }).then((c) => c.map((x) => x.documentUrl))`);
  /** Evaluate in the real side panel's page (its own target). */
  const inSidePanel = async (expression) => {
    const target = (await send('Target.getTargets')).targetInfos.find((t) => t.type !== 'service_worker' && isPanelUrl(t.url));
    if (!target) return undefined;
    const { sessionId: sp } = await send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
    try {
      await send('Runtime.enable', {}, sp);
      return (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sp)).result.value;
    } finally {
      await send('Target.detachFromTarget', { sessionId: sp }).catch(() => {});
    }
  };
  // The popup's button (the popup page in a tab of its own window here; it closes once the panel is open).
  const popup = await openPage(browser, 'popup/popup.html', { shotsDir: shots });
  await sleep(2000);
  const before = (await panels()).length;
  const popupButton = await click(popup, '.qa-head [aria-label="Open the side panel"]');
  await sleep(3000);
  const fromPopup = await panels();
  ck('the popup’s “Open the side panel” button (a real click) opens Chrome’s side panel with the panel page', popupButton && before === 0 && fromPopup.some(isPanelUrl),
    JSON.stringify({ popupButton, before, fromPopup }));
  await popup.close(); // its window (and that side panel) go with it
  await sleep(1500);

  // The app's button.
  const hasButton = await click(page2, '[aria-label="Open the side panel"]');
  await sleep(3000);
  const fromApp = await panels();
  ck('the app’s “Open the side panel” button (a real click) opens it beside the app', hasButton && fromApp.some(isPanelUrl), JSON.stringify({ hasButton, fromApp }));
  const shown = await inSidePanel(`({ today: document.body.innerText.includes(${JSON.stringify(LATE)}), width: innerWidth })`);
  ck('…it shows Today there (the same session)', !!shown && shown.today, JSON.stringify(shown));
  if (shown) console.log(`  (Chrome's side panel is ${shown.width} px wide here)`);

  // Signing out in the app clears the side panel too.
  await page2.evaluate(`location.hash = '#/settings'; true`);
  await sleep(2500);
  await page2.evaluate(`window.confirm = () => true; [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Sign out').click(); true`);
  await sleep(5000);
  let text = '';
  for (let i = 0; i < 5 && !text; i += 1) {
    text = (await inSidePanel('document.body.innerText').catch(() => '')) || '';
    if (!text) await sleep(1500); // the side panel may still be starting again
  }
  const targets = (await send('Target.getTargets')).targetInfos.filter((t) => isPanelUrl(t.url)).map((t) => t.type);
  if (!text) console.log(`  (side panel targets: ${JSON.stringify(targets)})`);
  ck('signing out in the app clears the side panel: it asks to sign in there, and shows none of the tasks', /Sign in to MICO360 Tasks|signed out/i.test(text) && !text.includes(LATE) && !text.includes(TODAY) && !text.includes(AGAIN), text.slice(0, 200));
} catch (e) {
  error(e);
} finally {
  await browser.close();
  for (const id of made) await server.call('DELETE', `/tasks/${id}`).catch(() => {});
}
console.log(`  (screenshots: ${shots})`);
process.exit(done());
