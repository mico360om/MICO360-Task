// The extension in Chrome against a local server: it loads (Manifest V3, Chrome 116+), signs in,
// lists projects (Arabic names get their own text direction), shows a board, and works from the
// keyboard: Enter or Space opens a card, the task drawer is a modal dialog (focus moves in, Tab stays
// in, Escape closes it, focus goes back to the card), and a card's "Move to…" menu moves it. It shows
// the extension's and the server's versions, and the notice when the server is newer.
//   node tools/extension-e2e/board.mjs        (see lib.mjs for the settings)
import { launch, openApp, signIn, signedIn, apiSession, credentials, checks, outDir, todayIn, sleep, SERVER } from './lib.mjs';

const shots = outDir('board');
const { ck, error, done } = checks();
const who = credentials();
const server = await apiSession(who);
const project = (await server.call('GET', '/projects')).data.find((p) => p.code === 'MICO');
const columns = (await server.call('GET', `/projects/${project.id}/columns`)).data.filter((c) => c.enabled).sort((a, b) => a.position - b.position);
const start = columns.find((c) => c.category === 'TODO') ?? columns[0];
const target = columns.find((c) => c.category === 'IN_PROGRESS' && c.id !== start.id) ?? columns.find((c) => c.id !== start.id);
const TITLE = `Ext keyboard ${Date.now().toString(36)}`;
const T = (await server.call('POST', '/tasks', { title: TITLE, projectId: project.id, columnId: start.id, priority: 'NORMAL', boardDate: todayIn() })).data;
const serverVersion = (await server.call('GET', '/version')).data.version;
const arabic = (await server.call('GET', '/projects')).data.find((p) => /[؀-ۿ]/.test(p.name));

const browser = await launch({ name: 'board' });
const { extId, manifest } = browser;
try {
  ck(`Chrome loads the extension ${manifest.version} (Manifest V3)`, !!extId, extId);
  const { targetInfos } = await browser.send('Target.getTargets');
  ck('its background service worker starts', targetInfos.some((t) => t.type === 'service_worker' && t.url.includes(extId)));
  const page = await openApp(browser, { shotsDir: shots });
  const { evaluate, text, shot, press } = page;
  const m = await evaluate('chrome.runtime.getManifest()');
  ck('it asks for Chrome 116 or later, and not for unlimitedStorage', m.minimum_chrome_version === '116' && !m.permissions.includes('unlimitedStorage'), JSON.stringify(m.permissions));

  ck('the app page opens on the sign-in screen', /sign in/i.test(await text()));
  await shot('01-login.png');
  const { switched, after } = await signIn(page, who);
  ck(`switching to the server ${SERVER} is accepted`, switched.includes(`Using ${new URL(SERVER).host}`), switched.slice(0, 200));
  ck('signing in reaches the app', signedIn(after), after.slice(0, 300));
  ck(`the sidebar shows "Version ${manifest.version}"`, (await evaluate(`document.querySelector('.side-ver')?.textContent`)) === `Version ${manifest.version}`);

  await evaluate(`location.hash = '#/projects'; true`);
  await sleep(3000);
  if (arabic) {
    ck('the Projects screen lists the Arabic project from the server', (await text()).includes(arabic.name));
    ck('Arabic project names get their own text direction (dir=auto)', await evaluate(`!![...document.querySelectorAll('[dir=auto]')].find(x => x.textContent.includes(${JSON.stringify(arabic.name)}))`));
  }
  await shot('02-projects.png');

  // ---- The board, from the keyboard ---------------------------------------------------------
  await evaluate(`location.hash = '#/board/${project.id}'; true`);
  await sleep(3500);
  const card = `[...document.querySelectorAll('.tcard')].find((x) => x.dataset.taskId === ${JSON.stringify(T.id)})`;
  ck('the board shows the new task', (await text()).includes(TITLE));
  ck('its card is a button named after the task', (await evaluate(`(() => { const c = ${card}; return c && c.getAttribute('role') + '|' + c.getAttribute('aria-label'); })()`)) === `button|${TITLE}, ${T.key}, Normal priority`);
  await evaluate(`${card}.focus(); true`);
  await press('Enter');
  await sleep(2500);
  const dialog = await evaluate(`(() => { const d = document.querySelector('[role="dialog"]'); return d && { modal: d.getAttribute('aria-modal'), label: d.getAttribute('aria-label'), focusInside: d.contains(document.activeElement), appInert: document.getElementById('app').hasAttribute('inert') }; })()`);
  ck('Enter on the card opens its drawer, a modal dialog named after the task', dialog && dialog.modal === 'true' && dialog.label === `Task ${T.key}: ${TITLE}`, JSON.stringify(dialog));
  ck('focus moves into the drawer and the page behind is inert', dialog && dialog.focusInside && dialog.appInert, JSON.stringify(dialog));
  await shot('03-drawer.png');
  let outside = 0;
  const seen = new Set();
  for (let i = 0; i < 40; i += 1) {
    await press('Tab');
    const where = await evaluate(`(() => { const a = document.activeElement; return { inside: !!a.closest('[role="dialog"]'), name: a.getAttribute('aria-label') || a.textContent.trim().slice(0, 30) }; })()`);
    if (!where.inside) outside += 1;
    seen.add(where.name);
  }
  for (let i = 0; i < 6; i += 1) {
    await press('Tab', { shift: true });
    if (!(await evaluate(`!!document.activeElement.closest('[role="dialog"]')`))) outside += 1;
  }
  ck(`Tab and Shift+Tab stay inside the drawer (${seen.size} controls, 46 presses)`, outside === 0 && seen.size > 5, `${outside} outside`);
  await press('Escape');
  await sleep(3500);
  const back = await evaluate(`({ open: !!document.querySelector('[role="dialog"]'), hash: location.hash, focused: document.activeElement.dataset.taskId || document.activeElement.tagName, inert: document.getElementById('app').hasAttribute('inert') })`);
  ck('Escape closes the drawer and the page is usable again', !back.open && back.hash === `#/board/${project.id}` && !back.inert, JSON.stringify(back));
  ck('focus goes back to the card that opened it', back.focused === T.id, JSON.stringify(back));
  await press(' ');
  await sleep(2500);
  ck('Space on the card opens the drawer too', await evaluate(`!!document.querySelector('[role="dialog"]')`));
  await evaluate(`document.querySelector('[role="dialog"] [aria-label="Close"]').click(); true`);
  await sleep(3500);
  ck('closing with the ✕ button also returns focus to the card', (await evaluate('document.activeElement.dataset.taskId')) === T.id);

  // ---- "Move to…" --------------------------------------------------------------------------
  await press('Tab');
  const moveBtn = await evaluate(`(() => { const a = document.activeElement; return { cls: a.className, label: a.getAttribute('aria-label'), popup: a.getAttribute('aria-haspopup') }; })()`);
  ck('Tab from the card reaches its "Move to…" button', moveBtn.popup === 'menu' && moveBtn.label === `Move “${TITLE}” to another column`, JSON.stringify(moveBtn));
  await press('Enter');
  const menu = await evaluate(`(() => { const m = document.querySelector('[role="menu"]'); return m && { items: [...m.querySelectorAll('[role="menuitem"]')].map((i) => i.textContent.trim()), focused: document.activeElement.getAttribute('role') }; })()`);
  const others = columns.filter((c) => c.id !== start.id).map((c) => c.name);
  ck('Enter opens the menu on its first item, listing the other columns', menu && menu.focused === 'menuitem' && JSON.stringify(menu.items) === JSON.stringify(others), JSON.stringify(menu));
  await shot('04-move-menu.png');
  await press('Escape');
  ck('Escape closes the menu and puts focus back on its button', await evaluate(`!document.querySelector('[role="menu"]') && document.activeElement.getAttribute('aria-haspopup') === 'menu'`));
  await press('Enter');
  for (let i = 0; i < others.length && (await evaluate('document.activeElement.textContent.trim()')) !== target.name; i += 1) await press('ArrowDown');
  await press('Enter');
  await sleep(3000);
  const saved = (await server.call('GET', `/tasks/${T.id}`)).data;
  ck(`choosing "${target.name}" moves the task on the server`, saved.columnId === target.id, `${saved.columnId} ≠ ${target.id}`);
  const moved = await evaluate(`(() => { const c = ${card}; return c && { col: c.closest('.column').querySelector('.cname').textContent, focused: document.activeElement === c, said: document.querySelector('.sr-only[aria-live]')?.textContent }; })()`);
  ck('the card shows in its new column and keeps keyboard focus', moved && moved.col === target.name && moved.focused, JSON.stringify(moved));
  ck('a screen reader hears where it went', moved && moved.said === `Moved “${TITLE}” to ${target.name}.`, JSON.stringify(moved));
  await shot('05-moved.png');

  // ---- Versions ----------------------------------------------------------------------------
  await evaluate(`location.hash = '#/settings'; true`);
  await sleep(2500);
  const aboutText = await evaluate(`[...document.querySelectorAll('.card')].find((c) => c.querySelector('.section-title')?.textContent === 'About')?.innerText ?? ''`);
  ck(`Settings → About shows the extension (${manifest.version}) and server (${serverVersion}) versions`, aboutText.includes(`Extension version ${manifest.version}`) && aboutText.includes(`Server version ${serverVersion}`), aboutText);
  ck('…and links to the web app’s About page', await evaluate(`[...document.querySelectorAll('a')].some((a) => a.href.endsWith('/about') && a.target === '_blank')`));

  // The server says it is newer (its /version reply is answered here): a zip install is told.
  let fakeNewer = true;
  browser.on((msg) => {
    if (msg.sessionId !== page.sessionId || msg.method !== 'Fetch.requestPaused') return;
    const { requestId, request } = msg.params;
    if (!fakeNewer || request.method !== 'GET') { void browser.send('Fetch.continueRequest', { requestId }, page.sessionId); return; }
    const body = Buffer.from(JSON.stringify({ data: { version: '99.0.0', deployedAt: new Date().toISOString() } })).toString('base64');
    void browser.send('Fetch.fulfillRequest', {
      requestId, responseCode: 200, body,
      responseHeaders: [
        { name: 'content-type', value: 'application/json; charset=utf-8' },
        { name: 'cache-control', value: 'no-store' },
        { name: 'access-control-allow-origin', value: `chrome-extension://${extId}` },
        { name: 'access-control-allow-credentials', value: 'true' },
      ],
    }, page.sessionId);
  });
  await browser.send('Fetch.enable', { patterns: [{ urlPattern: '*/api/v1/version*' }] }, page.sessionId);
  await evaluate(`location.hash = '#/'; location.reload(); true`).catch(() => {});
  await sleep(5000);
  const bar = await evaluate(`document.querySelector('.updatebar')?.innerText ?? ''`);
  ck('with a newer server the app says so, naming both versions', bar.includes(`A newer version of MICO360 Tasks, 99.0.0, is available (this extension is ${manifest.version}).`), bar || '(no notice)');
  await shot('06-update-notice.png');
  await evaluate(`[...document.querySelectorAll('.updatebar button')].find((b) => b.textContent.trim() === 'Dismiss').click(); true`);
  await sleep(500);
  const dismissed = await evaluate(`chrome.storage.local.get('dismissedUpdate')`);
  ck('Dismiss hides it for that version', !(await evaluate(`!!document.querySelector('.updatebar')`)) && dismissed.dismissedUpdate === '99.0.0', JSON.stringify(dismissed));
  await evaluate(`location.hash = '#/settings'; true`);
  await sleep(2500);
  const firstCard = await evaluate(`document.querySelector('.content .card')?.innerText ?? ''`);
  ck('Settings → About (now first) still says how to update', /^about/i.test(firstCard) && firstCard.includes('A newer version, 99.0.0, is available') && firstCard.includes('chrome://extensions'), firstCard);
  await shot('07-settings-about.png');
  fakeNewer = false;
  await browser.send('Fetch.disable', {}, page.sessionId);

  ck('no script errors in the extension page', page.errors.length === 0, page.errors.join(' | '));
} catch (e) {
  error(e);
} finally {
  try { await server.call('DELETE', `/tasks/${T.id}`); } catch { /* best effort */ }
  console.log(`  (screenshots: ${shots})`);
  await browser.close();
  process.exit(done());
}
