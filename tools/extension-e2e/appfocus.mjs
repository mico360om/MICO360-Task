// Keyboard focus is never hidden under the full app page's sticky top bar (WCAG 2.4.11), in a short
// window: My Tasks with enough tasks to scroll, Shift+Tab from the last row up to the top bar.
//   node tools/extension-e2e/appfocus.mjs        (see lib.mjs for the settings)
import { launch, openApp, signIn, signedIn, apiSession, credentials, checks, outDir, todayIn, sleep } from './lib.mjs';

const shots = outDir('appfocus');
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
const made = [];
for (let i = 0; i < 10; i += 1) {
  made.push((await server.call('POST', '/tasks', { title: `Ext focus ${i} ${stamp}`, projectId: project.id, columnId: todo.id, dueDate: today, assigneeIds: [me.id] })).data.id);
}

const browser = await launch({ name: 'appfocus' });
try {
  const app = await openApp(browser, { shotsDir: shots });
  const { evaluate, press, shot, send, sessionId } = app;
  ck('signs in to the local server', signedIn((await signIn(app, who)).after));
  for (const width of [1024, 700]) {
  await send('Emulation.setDeviceMetricsOverride', { width, height: 420, deviceScaleFactor: 1, mobile: false }, sessionId);
  await evaluate('location.hash = "#/"; true');
  await sleep(800);
  await evaluate('location.hash = "#/my-tasks"; true');
  await sleep(3500);
  const where = () => evaluate(`(() => {
    const a = document.activeElement;
    if (!a || a === document.body) return { what: 'body', hidden: false };
    const bar = document.querySelector('.topbar').getBoundingClientRect();
    const r = a.getBoundingClientRect();
    const inBar = !!a.closest('.topbar');
    const inSide = !!a.closest('.side');
    return { what: (a.getAttribute('aria-label') || a.id || a.textContent.trim()).slice(0, 36), top: Math.round(r.top), bar: Math.round(bar.bottom),
      hidden: !inBar && !inSide && r.top < bar.bottom - 0.5, stop: inBar || inSide };
  })()`);
  await evaluate(`(() => { const all = [...document.querySelectorAll('.task-row, .mark-done')]; all[all.length - 1].focus(); return true; })()`);
  await sleep(300);
  const hidden = [];
  let reached = false;
  for (let i = 0; i < 60; i += 1) {
    await press('Tab', { shift: true });
    await sleep(150);
    const w = await where();
    if (w.hidden) hidden.push(w);
    if (w.stop) { reached = true; break; }
  }
  const tall = await evaluate('document.documentElement.scrollHeight > innerHeight + 100');
  await shot(`01-my-tasks-${width}.png`);
  ck(`at ${width} × 420: Shift+Tab up My Tasks never leaves focus hidden under the top bar`, tall && reached && hidden.length === 0, JSON.stringify({ tall, reached, hidden }).slice(0, 400));
  }
} catch (e) {
  error(e);
} finally {
  await browser.close();
  for (const id of made) await server.call('DELETE', `/tasks/${id}`).catch(() => {});
}
console.log(`  (screenshots: ${shots})`);
process.exit(done());
