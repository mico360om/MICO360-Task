// Repeating tasks in the extension, against a local server: set a repeat in the task drawer, see the
// card marked, complete it on the board and see the next copy appear; a copy made in another app
// shows when you come back to the tab; an earlier copy points to the newest one; the newest copy can
// switch its repeat off and on again.
//   node tools/extension-e2e/recur.mjs        (see lib.mjs for the settings)
import { launch, openApp, signIn, signedIn, apiSession, credentials, checks, outDir, todayIn, sleep } from './lib.mjs';

const shots = outDir('recur');
const { ck, error, done } = checks();
const who = credentials();
const server = await apiSession(who);
const api = (p) => server.call('GET', p);
const project = (await api('/projects')).data.find((p) => p.code === 'MICO');
const cols = (await api(`/projects/${project.id}/columns`)).data.sort((a, b) => a.position - b.position);
const plus = (k, n) => { const d = new Date(`${k}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const due = plus(todayIn(), 7);
const title = `Weekly stock count (extension) ${Date.now().toString(36)}`;
const taskId = (await server.call('POST', '/tasks', { title, projectId: project.id, columnId: cols[0].id, dueDate: due, priority: 'HIGH' })).data.id;
const made = [taskId];

const browser = await launch({ name: 'recur' });
try {
  ck(`Chrome loads the extension ${browser.manifest.version}`, !!browser.extId);
  const page = await openApp(browser, { shotsDir: shots });
  const { evaluate, text, shot } = page;
  const pick = (label, value) => evaluate(`(() => { const s = document.querySelector('select[aria-label="${label}"]'); if (!s) return false; s.value = ${JSON.stringify(value)}; s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  ck('signs in to the local server', signedIn((await signIn(page, who)).after));

  // Task drawer: due date shown, set a weekly repeat on Sunday + Thursday.
  await evaluate(`location.hash = '#/task/${taskId}'; true`);
  await sleep(3000);
  ck('the task drawer shows its due date', (await evaluate(`document.querySelector('input[aria-label="Due date"]')?.value`)) === due);
  ck('choose Repeat → Weekly', await pick('Repeat', 'WEEKLY'));
  await sleep(2000);
  await evaluate(`document.querySelector('button[aria-label="Sun"]').click(); true`);
  await sleep(2000);
  await evaluate(`document.querySelector('button[aria-label="Thu"]').click(); true`);
  await sleep(2000);
  ck('the drawer summarises the repeat', /Repeats every week on Sun, Thu/.test(await text()), (await text()).slice(0, 400));
  await shot('01-drawer.png');
  const saved = (await api(`/tasks/${taskId}`)).data.recurrenceRule;
  ck('the server has the rule (seen by the web and mobile apps)', saved?.freq === 'WEEKLY' && JSON.stringify(saved.weekdays) === '[0,4]', JSON.stringify(saved));

  // Board: the card is marked; complete it by dragging it to the Done column.
  await evaluate(`location.hash = '#/board/${project.id}'; true`);
  await sleep(3500);
  const marked = await evaluate(`(() => { const c = [...document.querySelectorAll('.tcard')].find(n => n.textContent.includes(${JSON.stringify(title)})); return !!c?.querySelector('[aria-label="Repeats"]'); })()`);
  ck('its board card is marked as repeating', marked);
  const doneName = cols.find((c) => c.category === 'DONE').name;
  await evaluate(`(() => {
    const card = [...document.querySelectorAll('.tcard')].find(n => n.textContent.includes(${JSON.stringify(title)}));
    card.dispatchEvent(new DragEvent('dragstart', { bubbles: true }));
    const col = [...document.querySelectorAll('.column')].find(c => c.querySelector('.cname')?.textContent === ${JSON.stringify(doneName)});
    col.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true }));
    return true; })()`);
  await sleep(4000);
  const copies = (await api(`/tasks?projectId=${project.id}`)).data.filter((t) => t.recurrenceParentId === taskId && t.id !== taskId);
  made.push(...copies.map((c) => c.id));
  // Due Thursday (today + 7 can be any day): the next Sunday or Thursday after it.
  const expectedNext = (() => { let k = plus(due, 1); while (![0, 4].includes(new Date(`${k}T00:00:00Z`).getUTCDay())) k = plus(k, 1); return k; })();
  ck('completing it on the board makes exactly one next copy', copies.length === 1, `${copies.length}`);
  ck(`the next copy is due ${expectedNext} (the next Sunday or Thursday)`, copies[0]?.dueDate?.startsWith(expectedNext), copies[0]?.dueDate);
  const where = await evaluate(`[...document.querySelectorAll('.column')].map(c => ({ col: c.querySelector('.cname')?.textContent, n: [...c.querySelectorAll('.tcard')].filter(n => n.textContent.includes(${JSON.stringify(title)})).length, repeats: [...c.querySelectorAll('.tcard')].filter(n => n.textContent.includes(${JSON.stringify(title)}) && n.querySelector('[aria-label=Repeats]')).length })).filter(x => x.n)`);
  const inDone = where.find((w) => w.col === doneName);
  const open = where.filter((w) => w.col !== doneName);
  ck('the board reloads: the done one sits in Done, the new copy (marked as repeating) in an open column', inDone?.n === 1 && inDone?.repeats === 0 && open.length === 1 && open[0].n === 1 && open[0].repeats === 1, JSON.stringify(where));
  await shot('02-board.png');

  // Another app completes the new copy while the extension sits on the board; coming back to the
  // tab shows the next copy (the extension has no live connection).
  const copyId = copies[0].id;
  const doneCol = cols.find((c) => c.category === 'DONE');
  await server.call('PATCH', `/tasks/${copyId}/move`, { columnId: doneCol.id });
  const third = (await api(`/tasks/${copyId}`)).data.recurrenceNextId;
  if (third) made.push(third);
  await evaluate(`document.dispatchEvent(new Event('visibilitychange')); true`);
  await sleep(3500);
  const seen = await evaluate(`[...document.querySelectorAll('.tcard')].filter(n => n.textContent.includes(${JSON.stringify(title)})).length`);
  ck('a copy made in another app shows up when you come back to the tab', !!third && seen === 3, `next=${third} cards=${seen}`);

  // The first task is now an earlier copy: no repeat editor, a pointer to the newest copy.
  await evaluate(`location.hash = '#/task/${taskId}'; true`);
  await sleep(3000);
  const earlier = await evaluate(`({ editor: !!document.querySelector('select[aria-label="Repeat"]'), note: /newest copy/.test(document.body.innerText) })`);
  ck('the earlier copy points to the newest copy and has no repeat editor', !earlier.editor && earlier.note, JSON.stringify(earlier));

  // The newest copy switches its repeat off and back on.
  await evaluate(`location.hash = '#/task/${third}'; true`);
  await sleep(3000);
  await pick('Repeat', 'NONE');
  await sleep(2500);
  const offRule = (await api(`/tasks/${third}`)).data.recurrenceRule;
  ck('the newest copy can switch its repeat off', offRule === null && (await evaluate(`!!document.querySelector('select[aria-label="Repeat"]')`)), JSON.stringify(offRule));
  await pick('Repeat', 'DAILY');
  await sleep(2500);
  const onRule = (await api(`/tasks/${third}`)).data.recurrenceRule;
  ck('…and back on', onRule?.freq === 'DAILY', JSON.stringify(onRule));
  await shot('03-reenabled.png');
  ck('no script errors in the extension page', page.errors.length === 0, page.errors.join(' | '));
} catch (e) {
  error(e);
} finally {
  // Newest first, so no copy is left pointing at a deleted one.
  for (const id of made.reverse()) {
    try { await server.call('DELETE', `/tasks/${id}`); } catch { /* best effort */ }
  }
  await browser.close();
  process.exit(done());
}
