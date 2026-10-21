// Search, the calendar and light meetings (Stage 6), in Chrome against a local server: Ctrl+K opens
// search (a real key press), finds a task by its words and opens its panel, a project opens its
// board; the Search screen ("mico …" in the address bar leads there) searches for the words it is
// opened with; the Calendar shows the month (a task due today, the copy a repeating task will make,
// a meeting), Week and Agenda, Only mine, and a chip opens the task; Meetings lists the meeting with
// your answer, its page has Join (https) and Accept/Maybe/Decline — saved on the server, and kept
// on this device while offline, then synced; the Dashboard's Up next; the address-bar keyword adds
// no permission warning; and the screens at a narrow width. Each change is checked on the server.
//   node tools/extension-e2e/stage6.mjs        (see lib.mjs for the settings)
import { launch, openApp, signIn, signedIn, apiSession, credentials, checks, outDir, todayIn, sleep, inWorker } from './lib.mjs';

const shots = outDir('stage6');
const { ck, error, done } = checks();
const who = credentials();
const admin = await apiSession(who);
const mate = await apiSession(credentials(process.env.MICO_E2E_TEAMMATE || 'mariam@mico360.test'));
const get = async (s, path) => (await s.call('GET', path)).data;
const stamp = Date.now().toString(36);
const today = todayIn();
const project = (await get(admin, '/projects')).find((p) => p.code === 'MICO');
const columns = (await get(admin, `/projects/${project.id}/columns`)).filter((c) => c.enabled).sort((a, b) => a.position - b.position);
const todo = columns.find((c) => c.category === 'TODO') ?? columns[0];

// A task due today for me, a weekly one (its next copy shows as "not created yet"), and a meeting
// the teammate organizes with me invited.
const TITLE = `Ext search ${stamp}`;
const task = (await admin.call('POST', '/tasks', { title: TITLE, projectId: project.id, columnId: todo.id, dueDate: today, assigneeIds: [admin.user.id] })).data;
const weekly = (await admin.call('POST', '/tasks', {
  title: `Ext weekly ${stamp}`, projectId: project.id, columnId: todo.id, dueDate: today, assigneeIds: [admin.user.id],
  recurrenceRule: { freq: 'WEEKLY', interval: 1, createNext: 'ON_SCHEDULE' },
})).data;
const startAt = new Date(Date.now() + 40 * 60000);
const MEETING = `Ext meeting ${stamp}`;
const meeting = (await mate.call('POST', '/meetings', {
  title: MEETING, status: 'SCHEDULED', projectId: null, location: 'Room 6', onlineLink: 'https://meet.example.com/ext-s6',
  startAt: startAt.toISOString(), endAt: new Date(startAt.getTime() + 3600000).toISOString(), timeZone: 'Asia/Muscat',
})).data;
await mate.call('POST', `/meetings/${meeting.id}/attendees`, { userId: admin.user.id, role: 'REQUIRED' });
const myRow = async () => (await get(mate, `/meetings/${meeting.id}/attendees`)).find((a) => a.userId === admin.user.id);

const browser = await launch({ name: 'stage6' });
try {
  const page = await openApp(browser, { shotsDir: shots });
  const { evaluate, shot, press, insertText, send, sessionId } = page;
  ck('signs in to the local server', signedIn((await signIn(page, who)).after));

  const ctrlK = async () => {
    const base = { key: 'k', code: 'KeyK', windowsVirtualKeyCode: 75, nativeVirtualKeyCode: 75, modifiers: 2 };
    await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base }, sessionId);
    await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base }, sessionId);
    await sleep(400);
  };

  // ---- Search (Ctrl+K) ----------------------------------------------------------------------
  await evaluate(`location.hash = '#/'; true`);
  await sleep(2500);
  await ctrlK();
  const dlg = await evaluate(`(() => { const d = document.querySelector('[role="dialog"][aria-label="Search"]'); return d ? { modal: d.getAttribute('aria-modal'), focus: document.activeElement?.getAttribute('role'), label: document.activeElement?.getAttribute('aria-label') } : null; })()`);
  ck('Ctrl+K opens search as a dialog, with the box focused', !!dlg && dlg.modal === 'true' && dlg.focus === 'combobox' && dlg.label === 'Search', JSON.stringify(dlg));
  await insertText(TITLE);
  await sleep(2500);
  const found = await evaluate(`(() => { const o = document.querySelector('[data-item-id="task-${task.id}"]'); const box = document.querySelector('[role="combobox"]');
    return { option: !!o, text: o?.textContent || '', active: box.getAttribute('aria-activedescendant'), id: o?.id, groups: [...document.querySelectorAll('[role="group"]')].map((g) => g.getAttribute('aria-label')) }; })()`);
  ck('…typing finds the task (GET /search), in the Tasks group, first choice', found.option && found.text.includes(TITLE) && found.groups.includes('Tasks'), JSON.stringify(found));
  // Arrow to the task (it may not be first when pages match too) and open it.
  for (let i = 0; i < 12 && (await evaluate(`document.querySelector('[role="combobox"]').getAttribute('aria-activedescendant')`)) !== found.id; i += 1) await press('ArrowDown');
  await press('Enter');
  await sleep(2500);
  const drawer = await evaluate(`({ hash: location.hash, dialog: !!document.querySelector('[role="dialog"][aria-modal="true"]'), search: !!document.querySelector('[aria-label="Search"][role="dialog"]'),
    title: [...document.querySelectorAll('[role="dialog"] input, [role="dialog"] textarea')].some((f) => f.value === ${JSON.stringify(TITLE)}) })`);
  ck('…Enter opens the task’s panel here (the search dialog closes first)', drawer.hash === `#/task/${task.id}` && drawer.dialog && !drawer.search && drawer.title, JSON.stringify(drawer));
  await press('Escape');
  await sleep(1500);
  await ctrlK();
  await insertText('MICO');
  await sleep(2500);
  const proj = await evaluate(`(() => { const o = document.querySelector('[data-item-id="proj-${project.id}"]'); return o ? { avatar: !!o.querySelector('.pavatar') } : null; })()`);
  ck('…a project is found too, with its picture', !!proj && proj.avatar, JSON.stringify(proj));
  await evaluate(`document.querySelector('[data-item-id="proj-${project.id}"]').click(); true`);
  await sleep(2500);
  ck('…and opens its board here', (await evaluate('location.hash')) === `#/board/${project.id}`);
  await ctrlK();
  await insertText('activity');
  await sleep(800);
  const webPage = await evaluate(`document.querySelector('[data-item-id="nav-activity"]')?.textContent || ''`);
  ck('…a page the extension doesn’t have says it opens on the website', webPage.includes('opens on the website'), webPage);
  await press('Escape');
  await sleep(600);
  ck('…Escape closes it and gives focus back', !(await evaluate(`!!document.querySelector('[aria-label="Search"][role="dialog"]')`)) && (await evaluate(`document.activeElement !== document.body`)));

  await evaluate(`location.hash = '#/search?q=${encodeURIComponent(TITLE)}'; true`);
  await sleep(3000);
  const screen = await evaluate(`({ value: document.querySelector('.search-screen [role="combobox"]')?.value, found: !!document.querySelector('[data-item-id="task-${task.id}"]') })`);
  ck('the Search screen (where “mico …” in the address bar leads) searches for its words at once', screen.value === TITLE && screen.found, JSON.stringify(screen));
  const omni = await inWorker(browser, `chrome.omnibox.onInputEntered.hasListeners() && chrome.omnibox.onInputChanged.hasListeners()`);
  ck('the address bar’s “mico” keyword is listened to by the background worker', omni === true, String(omni));

  // ---- Calendar ------------------------------------------------------------------------------
  await evaluate(`location.hash = '#/calendar'; true`);
  await sleep(4000);
  // A busy day shows three and "+N more" (an admin sees every project's tasks): the day's list under
  // the month (today, until another day is chosen) has them all.
  const cal = await evaluate(`(() => {
    const cell = document.querySelector('[data-day="${today}"]');
    return { period: document.querySelector('.cal-period')?.textContent, heads: [...document.querySelectorAll('.cal-month thead th')].length,
      today: !!cell && cell.classList.contains('today'), inCell: cell ? cell.querySelectorAll('.cal-chip').length : -1, more: cell?.querySelector('.cal-more')?.textContent || null,
      list: document.querySelector('.cal-daylist h3')?.textContent, task: !!document.querySelector('.cal-daylist [data-item="${task.id}"]'),
      meeting: !!document.querySelector('.cal-daylist [data-item="mtg:${meeting.id}"]') || !!document.querySelector('[data-item="mtg:${meeting.id}"]'),
      note: document.querySelector('.cal-note')?.textContent || '' };
  })()`);
  ck('Calendar: the month, today marked; today’s list under it has the task due today', cal.heads === 7 && cal.today && cal.task && cal.inCell <= 3, JSON.stringify(cal));
  ck('…the meeting on its day, and which zone the dates are in', cal.meeting && /Dates in .+\((company time|your setting)\)/.test(cal.note), JSON.stringify(cal));
  await shot('01-calendar-month.png', { full: true });
  const nextWeek = new Date(new Date(`${today}T12:00:00Z`).getTime() + 7 * 864e5).toISOString().slice(0, 10);
  if (nextWeek.slice(0, 7) === today.slice(0, 7)) {
    await evaluate(`document.querySelector('[data-day="${nextWeek}"] .cal-daynum').click(); true`);
    await sleep(800);
    const proj = await evaluate(`(() => { const c = document.querySelector('.cal-daylist [data-item="proj:${weekly.id}:${nextWeek}"]'); return { found: !!c, label: c?.getAttribute('aria-label') || '', hash: location.hash }; })()`);
    ck('…choosing next week’s day lists the copy the weekly task will make, “not created yet”', proj.found && proj.label.includes('not created yet') && proj.hash === `#/calendar?date=${nextWeek}`, JSON.stringify(proj));
    await evaluate(`[...document.querySelectorAll('.cal-nav button')].find((b) => b.textContent === 'Today').click(); true`);
    await sleep(800);
  } else {
    ck('…(next week is in another month: the copy check is left out)', true);
  }
  await evaluate(`document.querySelector('.cal-daylist [data-item="${task.id}"]').focus(); document.querySelector('.cal-daylist [data-item="${task.id}"]').click(); true`);
  await sleep(2500);
  ck('…a task chip opens its panel', (await evaluate('location.hash')) === `#/task/${task.id}`);
  await press('Escape');
  await sleep(2500);
  const back = await evaluate(`({ hash: location.hash, focus: document.activeElement?.dataset?.taskId || null })`);
  ck('…closing the panel goes back to the calendar, focus on the chip', back.hash.startsWith('#/calendar') && back.focus === task.id, JSON.stringify(back));
  await evaluate(`[...document.querySelectorAll('.cal-views button')].find((b) => b.textContent === 'Week').click(); true`);
  await sleep(3000);
  const week = await evaluate(`({ hash: location.hash, days: document.querySelectorAll('.cal-day-section').length, meta: document.querySelector('[data-item="${task.id}"] .cal-chip-meta')?.textContent || '' })`);
  ck('Week: seven days, the address keeps the view, each task with its key and project', week.hash === '#/calendar?view=week' && week.days === 7 && week.meta.includes(task.key) && week.meta.includes(project.name), JSON.stringify(week));
  await evaluate(`[...document.querySelectorAll('.cal-filters button')].find((b) => b.textContent === 'Only mine').click(); true`);
  await sleep(1500);
  const mine = await evaluate(`({ hash: location.hash, pressed: [...document.querySelectorAll('.cal-filters button')].find((b) => b.textContent === 'Only mine').getAttribute('aria-pressed'), meeting: !!document.querySelector('[data-item="mtg:${meeting.id}"]'), task: !!document.querySelector('[data-item="${task.id}"]') })`);
  ck('Only mine: my task stays, a meeting someone else organizes goes', mine.pressed === 'true' && mine.task && !mine.meeting && mine.hash === '#/calendar?mine=1&view=week', JSON.stringify(mine));
  await evaluate(`[...document.querySelectorAll('.cal-filters button')].find((b) => b.textContent === 'Only mine').click(); [...document.querySelectorAll('.cal-views button')].find((b) => b.textContent === 'Agenda').click(); true`);
  await sleep(3000);
  const agenda = await evaluate(`({ sections: document.querySelectorAll('.cal-day-section').length, meeting: !!document.querySelector('[data-item="mtg:${meeting.id}"]') })`);
  ck('Agenda: the days with something on them, the meeting among them', agenda.sections >= 1 && agenda.meeting, JSON.stringify(agenda));
  await evaluate(`document.querySelector('[data-item="mtg:${meeting.id}"]').click(); true`);
  await sleep(3000);
  ck('…a meeting chip opens the meeting’s page here', (await evaluate('location.hash')) === `#/meeting/${meeting.id}`);

  // ---- A meeting's page and your answer ------------------------------------------------------
  const pageInfo = await evaluate(`({ title: document.querySelector('.mt-page-title')?.textContent, join: [...document.querySelectorAll('a')].find((a) => a.textContent === 'Join online')?.href,
    web: [...document.querySelectorAll('a')].find((a) => a.textContent === 'Open on the web ↗')?.href, group: !!document.querySelector('[role="group"][aria-label="Your answer"]'),
    nav: document.querySelector('.navlink.active')?.textContent || '' })`);
  ck('the meeting’s page: its title, Join (https), Open on the web, and your answer', pageInfo.title === MEETING && pageInfo.join === 'https://meet.example.com/ext-s6' && /\/meetings\//.test(pageInfo.web || '') && pageInfo.group && pageInfo.nav.includes('Meetings'), JSON.stringify(pageInfo));
  await evaluate(`[...document.querySelectorAll('[aria-label="Your answer"] button')].find((b) => b.textContent === 'Accept').click(); true`);
  await sleep(2500);
  ck('Accept is saved on the server (an invitee answers their own invitation)', (await myRow()).response === 'ACCEPTED', JSON.stringify(await myRow()));
  const pressed = await evaluate(`({ p: [...document.querySelectorAll('[aria-label="Your answer"] button')].map((b) => b.getAttribute('aria-pressed')), status: document.querySelector('.mt-answer-status')?.textContent })`);
  ck('…shown pressed, in words', pressed.p.join() === 'true,false,false' && pressed.status === 'You’re going.', JSON.stringify(pressed));
  await shot('02-meeting.png', { full: true });

  await send('Network.enable', {}, sessionId);
  await send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }, sessionId);
  await sleep(800);
  await evaluate(`[...document.querySelectorAll('[aria-label="Your answer"] button')].find((b) => b.textContent === 'Decline').click(); true`);
  // The request gives up after 6 s; the answer is then kept. (The background worker isn't offline —
  // emulation is per page — so its minute poll may already have sent it: that counts as kept too.)
  let offline = '';
  for (let i = 0; i < 40 && !offline.includes('Saved on this device'); i += 1) {
    await sleep(300);
    offline = await evaluate(`document.querySelector('.mt-answer-status')?.textContent || ''`);
  }
  const queued = await evaluate(`chrome.storage.local.get('syncQueue').then((o) => (o.syncQueue || []).filter((i) => i.kind === 'meeting.respond').map((i) => i.payload.response))`);
  const sentByWorker = !queued.includes('DECLINED') && (await myRow()).response === 'DECLINED';
  ck('offline: Decline is kept on this device and says so', offline.includes('Saved on this device') && (queued.includes('DECLINED') || sentByWorker), JSON.stringify({ offline, queued, sentByWorker }));
  await send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }, sessionId);
  await sleep(6000);
  ck('…and sent once the connection is back', (await myRow()).response === 'DECLINED', JSON.stringify(await myRow()));
  await evaluate(`location.reload(); true`);
  await sleep(4000);
  await evaluate(`[...document.querySelectorAll('[aria-label="Your answer"] button')].find((b) => b.textContent === 'Decline').click(); true`);
  await sleep(2500);
  ck('pressing your answer again takes it back', (await myRow()).response === 'PENDING', JSON.stringify(await myRow()));

  // ---- Meetings list and Up next -------------------------------------------------------------
  await evaluate(`location.hash = '#/meetings'; true`);
  await sleep(4000);
  const list = await evaluate(`(() => { const c = [...document.querySelectorAll('.mt-card')].find((x) => x.querySelector('.mt-title')?.textContent === ${JSON.stringify(MEETING)});
    return { card: !!c, mine: c?.querySelector('.mt-mine')?.textContent || '', groups: [...document.querySelectorAll('.mt-group h2')].map((h) => h.firstChild.textContent), up: !!document.querySelector('[aria-label="Up next"]') }; })()`);
  ck('Meetings: the meeting in its group, with your answer', list.card && list.mine === 'You haven’t answered yet.' && list.groups.length >= 1 && list.up, JSON.stringify(list));
  await shot('03-meetings.png', { full: true });
  await evaluate(`location.hash = '#/'; true`);
  await sleep(4000);
  const dash = await evaluate(`(() => { const u = document.querySelector('[aria-label="Up next"]'); return u ? { open: !!u.querySelector('button[aria-label^="Open "]') } : null; })()`);
  ck('the Dashboard shows Up next, with Open', !!dash && dash.open, JSON.stringify(dash));

  // ---- The address-bar keyword adds no permission warning ------------------------------------
  const warn = await evaluate(`(async () => {
    if (!chrome.management || !chrome.management.getPermissionWarningsByManifest) return null;
    const m = chrome.runtime.getManifest();
    const without = { ...m }; delete without.omnibox;
    const a = await chrome.management.getPermissionWarningsByManifest(JSON.stringify(m));
    const b = await chrome.management.getPermissionWarningsByManifest(JSON.stringify(without));
    return { with: a, without: b };
  })()`);
  ck('“mico” in the address bar adds no install warning (Chrome’s own list of warnings is the same without it)', !warn || JSON.stringify(warn.with) === JSON.stringify(warn.without), JSON.stringify(warn));
  if (!warn) console.log('  (chrome.management is not available to the extension: warnings compared by the manifest test only)');

  // ---- A narrow window -----------------------------------------------------------------------
  await send('Emulation.setDeviceMetricsOverride', { width: 400, height: 800, deviceScaleFactor: 1, mobile: false }, sessionId);
  for (const [hash, name] of [['#/calendar', 'calendar'], ['#/meetings', 'meetings'], [`#/meeting/${meeting.id}`, 'meeting']]) {
    await evaluate(`location.hash = '${hash}'; true`);
    await sleep(3500);
    const fit = await evaluate(`({ over: document.documentElement.scrollWidth - window.innerWidth, chips: [...document.querySelectorAll('.cal-month .cal-chips')].some((c) => c.offsetParent), dots: [...document.querySelectorAll('.cal-dots')].some((d) => d.offsetParent) })`);
    ck(`at 400 px: ${name} fits the width${name === 'calendar' ? ' (the month shows dots; the day’s list has the items)' : ''}`, fit.over <= 1 && (name !== 'calendar' || (!fit.chips && fit.dots)), JSON.stringify(fit));
    await shot(`04-narrow-${name}.png`);
  }
  await ctrlK();
  const narrowSearch = await evaluate(`(() => { const d = document.querySelector('.search-dialog'); const r = d?.getBoundingClientRect(); return r ? { left: r.left, right: r.right, w: window.innerWidth } : null; })()`);
  ck('at 400 px: the search dialog fits the window', !!narrowSearch && narrowSearch.left >= 0 && narrowSearch.right <= narrowSearch.w, JSON.stringify(narrowSearch));
  await shot('05-narrow-search.png');
  await press('Escape');
  await send('Emulation.clearDeviceMetricsOverride', {}, sessionId);
  ck('no script errors in the extension page', page.errors.length === 0, page.errors.join(' | ').slice(0, 300));
} catch (e) {
  error(e);
} finally {
  await browser.close();
  await mate.call('DELETE', `/meetings/${meeting.id}`).catch(() => {});
  await admin.call('DELETE', `/tasks/${task.id}`).catch(() => {});
  await admin.call('DELETE', `/tasks/${weekly.id}?scope=series`).catch(() => {});
}
console.log(`  (screenshots: ${shots})`);
process.exit(done());
