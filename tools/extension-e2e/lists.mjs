// The board, My Tasks and Projects at the web's level (Stage 4), in Chrome against a local server:
// a project card's picture, status in words and "Open dashboard on the web"; a board card's due day
// ("Overdue"), subtasks, comments, people and milestone; "Add a task to …" a column with the
// new-task form (saved in that column, on the board's day; Escape asks before discarding); and My
// Tasks filtered by project, sorted, and a task marked done. Each change is checked on the server.
//   node tools/extension-e2e/lists.mjs        (see lib.mjs for the settings)
import { launch, openApp, signIn, signedIn, apiSession, credentials, checks, outDir, todayIn, sleep } from './lib.mjs';

const shots = outDir('lists');
const { ck, error, done } = checks();
const who = credentials();
const server = await apiSession(who);
const me = server.user;
const get = async (path) => (await server.call('GET', path)).data;
const project = (await get('/projects')).find((p) => p.code === 'MICO');
const columns = (await get(`/projects/${project.id}/columns`)).filter((c) => c.enabled).sort((a, b) => a.position - b.position);
const start = columns.find((c) => c.category === 'TODO') ?? columns[0];
const target = columns.find((c) => c.category === 'IN_PROGRESS' && c.id !== start.id) ?? columns.find((c) => c.id !== start.id);
const team = await get(`/projects/${project.id}/members`);
const other = team.find((m) => m.id !== me.id);
const stamp = Date.now().toString(36);
const TITLE = `Ext card ${stamp}`;
const NEW_TITLE = `Ext added ${stamp}`;
const today = todayIn();
const STATUS = { PLANNING: 'Planning', ACTIVE: 'Active', ON_HOLD: 'On hold', COMPLETED: 'Completed', ARCHIVED: 'Archived' };

// A task with everything a card shows: overdue, a milestone, a comment, a checklist (1 of 2 done), two people.
const T = (await server.call('POST', '/tasks', {
  title: TITLE, projectId: project.id, columnId: start.id, priority: 'HIGH', boardDate: today, dueDate: '2026-01-05', isMilestone: true,
  assigneeIds: [me.id, ...(other ? [other.id] : [])],
})).data;
await server.call('POST', `/tasks/${T.id}/comments`, { body: 'Checked the gauge.' });
const item = (await server.call('POST', `/tasks/${T.id}/checklist`, { text: 'Photo of the valve' })).data;
await server.call('POST', `/tasks/${T.id}/checklist`, { text: 'Sign the sheet' });
await server.call('PUT', `/checklist/${item.id}`, { done: true });
const made = [T.id];

const browser = await launch({ name: 'lists' });
try {
  const page = await openApp(browser, { shotsDir: shots });
  const { evaluate, shot, press, insertText } = page;
  ck('signs in to the local server', signedIn((await signIn(page, who)).after));

  // ---- Projects ------------------------------------------------------------------------------
  await evaluate(`location.hash = '#/projects'; true`);
  await sleep(2500);
  const card = await evaluate(`(() => {
    const c = [...document.querySelectorAll('.project')].find((x) => x.querySelector('.code')?.textContent === 'MICO');
    if (!c) return null;
    const a = c.querySelector('.pavatar');
    return { avatar: a && a.dataset.projectAvatar, status: c.querySelector('.pstatus')?.textContent, number: c.querySelector('.pnumber')?.textContent ?? null,
      link: [...c.querySelectorAll('a')].find((l) => l.textContent.startsWith('Open dashboard on the web'))?.href, target: c.querySelector('a')?.target,
      open: c.querySelector('button.project-open')?.getAttribute('aria-label') };
  })()`);
  ck('a project card shows its picture (image, icon or initials)', !!card && ['image', 'icon', 'initials'].includes(card.avatar), JSON.stringify(card));
  ck(`its status in words (“${STATUS[project.status]}”) and its own number when it has one`, card && card.status === STATUS[project.status] && card.number === (project.number || null), JSON.stringify(card));
  ck('“Open dashboard on the web” opens the project’s page on the website, in a new tab', card && /\/projects\//.test(card.link) && card.link.endsWith(`/projects/${project.id}`) && card.target === '_blank', JSON.stringify(card));
  await shot('01-projects.png');

  // ---- Board cards -------------------------------------------------------------------------
  await evaluate(`(() => { [...document.querySelectorAll('button.project-open')].find((b) => b.getAttribute('aria-label') === ${JSON.stringify(`Open the board of ${project.name}`)}).click(); return true; })()`);
  await sleep(3000);
  const cardSel = `[...document.querySelectorAll('.tcard')].find((x) => x.dataset.taskId === ${JSON.stringify(T.id)})`;
  const facts = await evaluate(`(() => { const c = ${cardSel}; if (!c) return null; return {
    due: c.querySelector('.tdue')?.textContent, overdue: c.querySelector('.tdue')?.classList.contains('overdue'),
    checklist: c.querySelector('[aria-label="Subtasks done"]')?.textContent, comments: c.querySelector('[aria-label="Comments"]')?.textContent,
    milestone: !!c.querySelector('[aria-label="Milestone"]'), people: c.querySelectorAll('.tavatar').length, label: c.getAttribute('aria-label') }; })()`);
  ck('the card says it is overdue, with its due day', facts && facts.overdue && facts.due === 'Overdue · Jan 5, 2026', JSON.stringify(facts));
  ck('…its subtasks (1/2) and comments (1)', facts && facts.checklist === '1/2' && facts.comments === '1', JSON.stringify(facts));
  ck('…its milestone flag and its people', facts && facts.milestone && facts.people === (other ? 2 : 1), JSON.stringify(facts));
  ck('…and its name says all of it', facts && /milestone/.test(facts.label) && /overdue, due Jan 5, 2026/.test(facts.label) && /1 of 2 subtasks done, 1 comment/.test(facts.label), facts && facts.label);
  await shot('02-board.png');

  // ---- "Add a task to …" ---------------------------------------------------------------------
  const addLabel = `Add a task to ${target.name}`;
  await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.getAttribute('aria-label') === ${JSON.stringify(addLabel)}); b.focus(); b.click(); return true; })()`);
  await sleep(2500);
  const form = await evaluate(`(() => { const d = document.querySelector('[role="dialog"][aria-modal="true"]'); if (!d) return null; return {
    title: document.getElementById(d.getAttribute('aria-labelledby'))?.textContent, project: d.querySelector('#qa-project > span:last-child')?.textContent,
    projectSelect: !!d.querySelector('select#qa-project'), column: d.querySelector('#qa-column')?.value, focus: document.activeElement?.id,
    appInert: document.getElementById('app').hasAttribute('inert') }; })()`);
  ck(`“${addLabel}” opens the New task form, focused on the title, the board behind out of reach`, form && form.title === 'New task' && form.focus === 'qa-title' && form.appInert, JSON.stringify(form));
  ck('…in this project (shown, not changed) and this column', form && form.project === project.name && !form.projectSelect && form.column === target.id, JSON.stringify(form));
  await shot('03-new-task.png');
  await insertText('Half typed');
  await press('Escape');
  await sleep(400);
  const asked = await evaluate(`({ text: document.querySelector('[role="dialog"]')?.textContent ?? '', focus: document.activeElement?.textContent?.trim() })`);
  ck('Escape with something typed asks “Discard this task?”, with “Keep editing” focused', asked.text.includes('Discard this task?') && asked.focus === 'Keep editing', JSON.stringify(asked).slice(0, 200));
  await press('Enter'); // Keep editing
  await sleep(300);
  await evaluate(`(() => { const t = document.getElementById('qa-title'); t.focus(); t.select(); return true; })()`);
  await insertText(NEW_TITLE);
  await press('Enter', { ctrl: true });
  await sleep(3500);
  const created = (await get(`/tasks?projectId=${project.id}&boardDate=${today}`)).find((t) => t.title === NEW_TITLE);
  if (created) made.push(created.id);
  ck('Ctrl+Enter creates it on the server in that column, on the board’s day', !!created && created.columnId === target.id && String(created.boardDate || '').slice(0, 10) === today, JSON.stringify(created && { columnId: created.columnId, boardDate: created.boardDate }));
  const after = await evaluate(`({ dialog: !!document.querySelector('[role="dialog"][aria-modal="true"]'), focus: document.activeElement?.getAttribute('aria-label'),
    inColumn: [...document.querySelectorAll('.column')].find((c) => c.querySelector('.cname')?.textContent === ${JSON.stringify(target.name)})?.textContent.includes(${JSON.stringify(NEW_TITLE)}) })`);
  ck('…the dialog closes, the card is in the column, and focus is back on the button', !after.dialog && after.inColumn && after.focus === addLabel, JSON.stringify(after));

  // ---- My Tasks ----------------------------------------------------------------------------
  await evaluate(`location.hash = '#/my-tasks'; true`);
  await sleep(3000);
  const filter = await evaluate(`(() => { const s = document.querySelector('[aria-label="Filter by project"]'); const o = s ? [...s.options].map((x) => x.textContent) : null;
    const sort = document.querySelector('[aria-label="Sort tasks"]'); return { options: o, sorts: sort ? [...sort.options].map((x) => x.textContent) : null }; })()`);
  ck('My Tasks has “Filter by project” (with this project) and the web’s sorts', filter.options && filter.options[0] === 'All projects' && filter.options.includes(project.name)
    && JSON.stringify(filter.sorts) === JSON.stringify(['Due date', 'Priority', 'Progress', 'Title (A–Z)']), JSON.stringify(filter));
  await evaluate(`(() => { const s = document.querySelector('[aria-label="Filter by project"]'); s.value = ${JSON.stringify(project.id)}; s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  await sleep(300);
  const mine = (await get('/tasks/mine')).filter((t) => t.projectId === project.id);
  const shown = await evaluate(`document.querySelectorAll('.task-row').length`);
  ck('filtered to the project: only its tasks are listed', shown === mine.length, `${shown} shown, ${mine.length} on the server`);
  const markLabel = `Mark “${TITLE}” done`;
  await evaluate(`(() => { const b = document.querySelector(${JSON.stringify(`[aria-label="${markLabel}"]`)}); b.focus(); return true; })()`);
  await press('Enter');
  await sleep(3000);
  const t = await get(`/tasks/${T.id}`);
  ck('“Mark done” moves it to the project’s Done column on the server (completed)', t.columnCategory === 'DONE' && !!t.completedAt, JSON.stringify({ columnCategory: t.columnCategory, completedAt: t.completedAt }));
  const listed = await evaluate(`(() => { const s = [...document.querySelectorAll('.mt-section')].find((x) => x.querySelector('.section-title').textContent.startsWith('Completed'));
    return { completed: !!s && s.textContent.includes(${JSON.stringify(TITLE)}), focus: document.activeElement?.dataset?.taskId, said: document.querySelector('.sr-only[role="status"]')?.textContent }; })()`);
  ck('…it is listed under Completed, focus stays on it, and it is said', listed.completed && listed.focus === T.id && listed.said === `“${TITLE}” is done.`, JSON.stringify(listed));
  await shot('04-my-tasks.png');
  ck('no script errors in the extension page', page.errors.length === 0, page.errors.join(' | ').slice(0, 300));
} catch (e) {
  error(e);
} finally {
  await browser.close();
  for (const id of made) await server.call('DELETE', `/tasks/${id}`).catch(() => {});
}
console.log(`  (screenshots: ${shots})`);
process.exit(done());
