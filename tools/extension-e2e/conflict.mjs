// The extension never saves over someone else's change (H1): a task open in its drawer is changed on
// the server meanwhile; the extension's edit is refused and explained, the latest version is shown,
// and the next edits go through, each on the version the one before made.
//   node tools/extension-e2e/conflict.mjs        (see lib.mjs for the settings)
import { launch, openApp, signIn, signedIn, apiSession, credentials, checks, outDir, todayIn, sleep } from './lib.mjs';

const shots = outDir('conflict');
const { ck, error, done } = checks();
const who = credentials();
const server = await apiSession(who);
const project = (await server.call('GET', '/projects')).data.find((p) => p.code === 'MICO');
const cols = (await server.call('GET', `/projects/${project.id}/columns`)).data.sort((a, b) => a.position - b.position);
const TITLE = `Ext conflict ${Date.now().toString(36)}`;
const T = (await server.call('POST', '/tasks', { title: TITLE, projectId: project.id, columnId: (cols.find((c) => c.category === 'TODO') ?? cols[0]).id, priority: 'NORMAL', boardDate: todayIn() })).data;

const browser = await launch({ name: 'conflict' });
try {
  ck(`Chrome loads the extension ${browser.manifest.version}`, !!browser.extId);
  const page = await openApp(browser, { shotsDir: shots });
  const { evaluate, text, shot } = page;
  ck('signs in to the local server', signedIn((await signIn(page, who)).after));

  await evaluate(`location.hash = '#/board/${project.id}'; true`);
  await sleep(3000);
  ck('the board shows the new task', (await text()).includes(TITLE));
  await evaluate(`[...document.querySelectorAll('.tcard')].find((x) => x.dataset.taskId === ${JSON.stringify(T.id)}).click(); true`);
  await sleep(2500);
  ck('its drawer opens', await evaluate(`!!document.querySelector('input[aria-label="Task title"]')`));
  // Someone else renames it on the website while it is open here.
  await server.call('PUT', `/tasks/${T.id}`, { title: `${TITLE} (renamed)` });
  const clickChip = (label) => evaluate(`(() => { const b = [...document.querySelectorAll('button.chip')].find((x) => x.textContent.trim() === ${JSON.stringify(label)}); if (b) { b.click(); return true; } return false; })()`);
  ck('the High priority chip is there', await clickChip('High'));
  await sleep(3000);
  const saved = (await server.call('GET', `/tasks/${T.id}`)).data;
  ck('the edit made over the other change is NOT saved', saved.priority === 'NORMAL' && saved.title === `${TITLE} (renamed)`, `${saved.priority} / ${saved.title}`);
  ck('the drawer says someone else changed it', /Someone else changed this task, so your change was not saved/.test(await text()), (await text()).slice(0, 300));
  const shownTitle = await evaluate(`document.querySelector('input[aria-label="Task title"]')?.value ?? ''`);
  ck('the drawer shows the latest version (the new title)', shownTitle === `${TITLE} (renamed)`, shownTitle);
  await shot('01-conflict.png');
  // Now it holds the latest version: the next edit goes through.
  await clickChip('High');
  await sleep(3000);
  ck('the next edit, on the latest version, is saved', (await server.call('GET', `/tasks/${T.id}`)).data.priority === 'HIGH');
  await clickChip('Urgent');
  await sleep(3000);
  ck('and the one after it too (the version follows each reply)', (await server.call('GET', `/tasks/${T.id}`)).data.priority === 'URGENT');
  ck('no script errors in the extension page', page.errors.length === 0, page.errors.join(' | '));
} catch (e) {
  error(e);
} finally {
  try { await server.call('DELETE', `/tasks/${T.id}`); } catch { /* best effort */ }
  await browser.close();
  process.exit(done());
}
