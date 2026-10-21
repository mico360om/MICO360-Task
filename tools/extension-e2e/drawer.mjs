// The task drawer at the web's level (Stage 3), in Chrome against a local server: the meeting a
// task came from opens on the website; milestone and start date; tags; the assignee picker;
// watching; files (choose, preview — Escape closes only the preview — paste, delete); threaded
// comments with an @mention picked from the keyboard, edited and deleted; the timeline; editing a
// whole series; and deleting the series. Each change is checked on the server.
//   node tools/extension-e2e/drawer.mjs        (see lib.mjs for the settings)
import { launch, openApp, signIn, signedIn, apiSession, credentials, checks, outDir, todayIn, sleep } from './lib.mjs';

const shots = outDir('drawer');
const { ck, error, done } = checks();
const who = credentials();
const server = await apiSession(who);
const me = server.user;
const project = (await server.call('GET', '/projects')).data.find((p) => p.code === 'MICO');
const columns = (await server.call('GET', `/projects/${project.id}/columns`)).data.filter((c) => c.enabled).sort((a, b) => a.position - b.position);
const todo = columns.find((c) => c.category === 'TODO') ?? columns[0];
const stamp = Date.now().toString(36);
const TITLE = `Ext drawer ${stamp}`;
const TAG = `ext-${stamp}`;
const DUE = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);

// A task made from a meeting's note carries the meeting (as the web's "Create task from note" does).
const meeting = (await server.call('POST', '/meetings', { title: `Ext review ${stamp}`, projectId: project.id, startAt: new Date(Date.now() + 3600000).toISOString() })).data;
const note = (await server.call('POST', `/meetings/${meeting.id}/notes`, { body: 'Follow up on the valve', type: 'DISCUSSION' })).data;
const T = (await server.call('POST', `/meetings/${meeting.id}/notes/${note.id}/task`, { title: TITLE, projectId: project.id, columnId: todo.id })).data.task;
await server.call('PUT', `/tasks/${T.id}`, { dueDate: DUE });
// Someone else on the project: to assign, and to @mention.
const audience = (await server.call('GET', `/tasks/${T.id}/mentionable`)).data;
const team = (await server.call('GET', `/projects/${project.id}/members`)).data;
const other = team.find((m) => m.id !== me.id && audience.some((a) => a.id === m.id));
const mentioned = audience.find((a) => a.id !== me.id);
const fullName = (u) => [u.firstName, u.lastName].filter(Boolean).join(' ') || u.username;
const first = (await server.call('POST', `/tasks/${T.id}/comments`, { body: 'Please check the valve before Thursday.' })).data;
const get = async (path) => (await server.call('GET', path)).data;

const browser = await launch({ name: 'drawer' });
try {
  ck(`Chrome loads the extension ${browser.manifest.version}`, !!browser.extId);
  const page = await openApp(browser, { shotsDir: shots });
  const { evaluate, text, shot, press, insertText } = page;
  ck('signs in to the local server', signedIn((await signIn(page, who)).after));
  // The request bodies the drawer sends, to see what an edit carried.
  const sent = [];
  await browser.send('Network.enable', {}, page.sessionId);
  browser.on((m) => {
    if (m.sessionId === page.sessionId && m.method === 'Network.requestWillBeSent' && m.params.request.url.includes(`/api/v1/tasks/${T.id}`)) {
      sent.push({ method: m.params.request.method, url: m.params.request.url, body: m.params.request.postData || '' });
    }
  });

  await evaluate(`location.hash = '#/task/${T.id}'; true`);
  await sleep(3500);
  const D = `document.querySelector('[role="dialog"]')`;
  const inD = (sel) => `${D}.querySelector(${JSON.stringify(sel)})`;
  const byLabel = (label) => `[...${D}.querySelectorAll('[aria-label]')].find((n) => n.getAttribute('aria-label') === ${JSON.stringify(label)})`;
  const button = (name) => `[...${D}.querySelectorAll('button')].find((b) => b.textContent.trim() === ${JSON.stringify(name)})`;
  const click = (expr) => evaluate(`(() => { const n = ${expr}; if (!n) return false; n.click(); return true; })()`);
  const setValue = (expr, value) => evaluate(`(() => { const n = ${expr}; if (!n) return false; n.value = ${JSON.stringify(value)}; n.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  const focus = (expr) => evaluate(`(() => { const n = ${expr}; if (!n) return false; n.focus(); return true; })()`);
  const focused = () => evaluate(`document.activeElement.getAttribute('aria-label') || document.activeElement.textContent.trim().slice(0, 40)`);

  ck('the drawer opens for the task, named after it', (await evaluate(`${D}?.getAttribute('aria-label')`)) === `Task ${T.key}: ${TITLE}`);
  const link = await evaluate(`(() => { const a = [...${D}.querySelectorAll('a')].find((x) => /From meeting/.test(x.textContent)); return a && { href: a.href, target: a.target, text: a.textContent }; })()`);
  ck('“From meeting” names the meeting and opens it on the website, in a new tab', !!link && link.href.endsWith(`/meetings/${meeting.id}`) && link.target === '_blank' && link.text.includes(meeting.title), JSON.stringify(link));
  await shot('01-drawer.png');

  // ---- Milestone and start date -----------------------------------------------------------
  ck('the milestone box is there', await click(byLabel('Milestone')));
  await sleep(2000);
  ck('ticking it makes the task a milestone on the server, and says so under the title', (await get(`/tasks/${T.id}`)).isMilestone === true && /Milestone/.test(await evaluate(`${inD('.td-badges')}?.textContent ?? ''`)));
  const today = todayIn();
  await setValue(byLabel('Start date'), today);
  await sleep(2000);
  ck(`the start date (${today}) is saved`, String((await get(`/tasks/${T.id}`)).startDate || '').slice(0, 10) === today);
  // Typing a new title, then clicking (a real mouse click) into the description: the title saves,
  // and focus goes where the click was — a redraw never pulls it back.
  await evaluate(`(() => { const t = ${byLabel('Task title')}; t.focus(); t.setSelectionRange(t.value.length, t.value.length); return true; })()`);
  await insertText(' v2');
  const spot = await evaluate(`(() => { const n = ${byLabel('Description')}; n.scrollIntoView({ block: 'center' }); const r = n.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  for (const type of ['mousePressed', 'mouseReleased']) await browser.send('Input.dispatchMouseEvent', { type, x: spot.x, y: spot.y, button: 'left', clickCount: 1 }, page.sessionId);
  await sleep(2000);
  const whereNow = await focused();
  ck('after typing a title, a click into the description puts focus there, and the title is saved', whereNow === 'Description' && (await get(`/tasks/${T.id}`)).title === `${TITLE} v2`, whereNow);

  // ---- Tags --------------------------------------------------------------------------------
  await focus(byLabel('Add a tag'));
  await insertText(TAG);
  await press('Enter');
  await sleep(2000);
  ck(`typing a tag and Enter tags the task (“${TAG}”)`, (await get(`/tasks/${T.id}/tags`)).some((t) => t.name === TAG));
  ck('…and focus stays in the tag box for the next one', (await focused()) === 'Add a tag');
  await click(byLabel(`Remove tag ${TAG}`));
  await sleep(2000);
  ck('removing it takes it off on the server', !(await get(`/tasks/${T.id}/tags`)).some((t) => t.name === TAG));

  // ---- People and watching ------------------------------------------------------------------
  if (other) {
    await setValue(byLabel('Add an assignee'), other.id);
    await sleep(2000);
    ck(`picking ${fullName(other)} assigns them`, (await get(`/tasks/${T.id}/assignees`)).some((a) => a.id === other.id));
    await click(byLabel(`Remove ${fullName(other)}`));
    await sleep(2000);
    ck('the ✕ on their name takes them off', !(await get(`/tasks/${T.id}/assignees`)).some((a) => a.id === other.id));
  } else {
    ck('someone else is on the project to assign', false, 'no other active member');
  }
  const watch = byLabel('Watch this task');
  const pressedBefore = await evaluate(`${watch}?.getAttribute('aria-pressed')`);
  await click(watch);
  await sleep(2000);
  const watching = (await get(`/tasks/${T.id}/watch`)).watching;
  ck('Watch is a toggle (aria-pressed) and watches the task on the server', pressedBefore === 'false' && watching === true && (await evaluate(`${watch}.getAttribute('aria-pressed')`)) === 'true', `${pressedBefore} → ${watching}`);
  await click(watch);
  await sleep(2000);
  ck('pressing it again stops watching', (await get(`/tasks/${T.id}/watch`)).watching === false);

  // ---- Files ---------------------------------------------------------------------------------
  const picture = (name) => `(async () => {
    const c = document.createElement('canvas'); c.width = 96; c.height = 64;
    const g = c.getContext('2d'); g.fillStyle = '#8b1e1e'; g.fillRect(0, 0, 96, 64); g.fillStyle = '#fff'; g.fillRect(20, 16, 40, 24);
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    const dt = new DataTransfer(); dt.items.add(new File([blob], ${JSON.stringify(name)}, { type: 'image/png' }));
    return dt;
  })()`;
  await evaluate(`(async () => { const dt = await ${picture('site-photo.png')}; const i = ${byLabel('Attach files')}; i.files = dt.files; i.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  await sleep(3500);
  let files = await get(`/tasks/${T.id}/attachments`);
  ck('choosing a picture attaches it', files.some((f) => f.filename === 'site-photo.png'), JSON.stringify(files.map((f) => f.filename)));
  ck('…and the list shows it with its thumbnail', await evaluate(`!!${byLabel('Attachments')}?.querySelector('img.td-thumb')`));
  await focus(byLabel('Preview site-photo.png'));
  await press('Enter');
  await sleep(800);
  const preview = await evaluate(`(() => { const p = ${D}.querySelector('[aria-label="Preview of site-photo.png"]'); return p && { img: !!p.querySelector('img'), focus: document.activeElement.getAttribute('aria-label'), inert: ${D}.querySelector('.drawer-body').hasAttribute('inert') }; })()`);
  ck('Preview shows the picture over the drawer, with focus on its Close button', preview && preview.img && preview.focus === 'Close preview' && preview.inert, JSON.stringify(preview));
  await shot('02-preview.png');
  await press('Escape');
  await sleep(800);
  const afterEscape = await evaluate(`({ drawer: !!${D}, preview: !!document.querySelector('[aria-label="Preview of site-photo.png"]'), focus: document.activeElement.getAttribute('aria-label') })`);
  ck('Escape closes only the preview, and focus goes back to its button', afterEscape.drawer && !afterEscape.preview && afterEscape.focus === 'Preview site-photo.png', JSON.stringify(afterEscape));
  await evaluate(`(async () => { const dt = await ${picture('image.png')}; const e = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }); ${byLabel('Close')}.dispatchEvent(e); return true; })()`);
  await sleep(3500);
  files = await get(`/tasks/${T.id}/attachments`);
  ck('a screenshot pasted in the drawer is attached as “Pasted image …”', files.some((f) => /^Pasted image \d{4}-\d{2}-\d{2} /.test(f.filename)), JSON.stringify(files.map((f) => f.filename)));
  await click(byLabel('Delete site-photo.png'));
  await sleep(500);
  ck('deleting a file asks first, with Keep focused', (await focused()) === 'Keep');
  await click(button('Yes, delete'));
  await sleep(2000);
  ck('“Yes, delete” removes it on the server', !(await get(`/tasks/${T.id}/attachments`)).some((f) => f.filename === 'site-photo.png'));

  // ---- Comments: a reply with an @mention, edited, then deleted ------------------------------
  const commentEl = (id) => `[...${D}.querySelectorAll('[data-comment-id]')].find((n) => n.dataset.commentId === ${JSON.stringify(id)})`;
  await click(`${commentEl(first.id)}?.querySelector('.td-comment [aria-label^="Reply to"]')`);
  await sleep(500);
  ck('Reply opens a box under the comment, focused', /^Your reply to /.test(await focused()), await focused());
  await insertText(`On it @${mentioned.username.slice(0, 2)}`);
  await sleep(300);
  const options = await evaluate(`[...document.querySelectorAll('[role="listbox"] [role="option"]')].map((o) => o.textContent)`);
  ck('typing @ and two letters lists people to mention', options.length > 0, JSON.stringify(options));
  for (let i = 0; i < 6 && !(await evaluate(`(document.querySelector('[role="option"][aria-selected="true"]')?.textContent ?? '').endsWith('@${mentioned.username}')`)); i += 1) await press('ArrowDown');
  await press('Enter');
  await sleep(200);
  const typed = await evaluate(`document.activeElement.value`);
  ck(`Enter puts @${mentioned.username} in`, typed === `On it @${mentioned.username} `, typed);
  await press('Enter', { ctrl: true });
  await sleep(2500);
  let comments = await get(`/tasks/${T.id}/comments`);
  const reply = comments.find((c) => c.parentId === first.id);
  ck('Ctrl+Enter sends the reply, linked to the comment it answers', !!reply && reply.body === `On it @${mentioned.username}`, JSON.stringify(comments.map((c) => [c.body, c.parentId])));
  ck('it shows under that comment, the name marked', await evaluate(`!![...${D}.querySelectorAll('.td-replies .mention')].find((m) => m.textContent === '@${mentioned.username}')`));
  await shot('03-thread.png');
  if (reply) {
    await click(`[...${D}.querySelectorAll('[data-comment-id]')].find((n) => n.dataset.commentId === ${JSON.stringify(reply.id)})?.querySelector('[aria-label="Edit your comment"]')`);
    await sleep(400);
    await insertText(' — at 10');
    await click(byLabel('Save comment'));
    await sleep(2000);
    comments = await get(`/tasks/${T.id}/comments`);
    const edited = comments.find((c) => c.id === reply.id);
    ck('Edit → Save changes your comment’s text, marked “(edited)”', edited && edited.body.endsWith('— at 10') && !!edited.editedAt && /\(edited\)/.test(await text()), JSON.stringify(edited));
    await click(`[...${D}.querySelectorAll('[data-comment-id]')].find((n) => n.dataset.commentId === ${JSON.stringify(reply.id)})?.querySelector('[aria-label="Delete your comment"]')`);
    await sleep(400);
    await click(button('Yes, delete'));
    await sleep(2000);
    ck('Delete (after asking) removes it on the server', !(await get(`/tasks/${T.id}/comments`)).some((c) => c.id === reply.id));
  }
  // Escape with the @ list open closes the list, not the drawer.
  await focus(byLabel('New comment'));
  await insertText(`@${mentioned.username.slice(0, 1)}`);
  await sleep(300);
  const listOpen = await evaluate(`!!document.querySelector('[role="listbox"]')`);
  await press('Escape');
  await sleep(300);
  ck('Escape with the @ list open closes only the list', listOpen && (await evaluate(`!!${D} && !document.querySelector('[role="listbox"]')`)));

  // ---- The timeline -------------------------------------------------------------------------
  const timeline = await evaluate(`${byLabel('Activity')}?.innerText ?? ''`);
  ck('the timeline shows what happened, worded as on the web', /attached/.test(timeline) && /removed the file site-photo\.png|attached/.test(timeline), timeline.slice(0, 300));

  // ---- A whole series ------------------------------------------------------------------------
  await setValue(byLabel('Repeat'), 'WEEKLY');
  await sleep(2500);
  ck('making it repeat weekly saves the rule', (await get(`/tasks/${T.id}`)).recurrenceRule?.freq === 'WEEKLY');
  ck('a repeating task asks which copies an edit applies to', await click(byLabel('Entire series')));
  await sleep(300);
  sent.length = 0;
  await evaluate(`(() => { const t = ${byLabel('Task title')}; t.focus(); t.value = ${JSON.stringify(`${TITLE} (series)`)}; t.blur(); return true; })()`);
  await sleep(2500);
  const put = sent.find((r) => r.method === 'PUT' && /"title"/.test(r.body));
  ck('with “Entire series” chosen, a title edit is sent for the whole series', !!put && JSON.parse(put.body).scope === 'series', JSON.stringify(sent));
  ck('…and saved', (await get(`/tasks/${T.id}`)).title === `${TITLE} (series)`);
  await shot('04-series.png');

  // ---- Deleting the series --------------------------------------------------------------------
  ck('an admin is offered “Delete task”', await click(button('Delete task')));
  await sleep(400);
  ck('it asks which, with Cancel focused', (await focused()) === 'Cancel' && /repeating task — delete which\?/.test(await text()));
  await click(button('The whole series'));
  await sleep(3500);
  const gone = await server.call('GET', `/tasks/${T.id}`);
  ck('“The whole series” deletes it, and the drawer closes', !!gone.error && !(await evaluate(`!!${D}`)), JSON.stringify(gone).slice(0, 200));
  ck('no script errors in the extension page', page.errors.length === 0, page.errors.join(' | '));
} catch (e) {
  error(e);
} finally {
  try { await server.call('DELETE', `/tasks/${T.id}?scope=series`); } catch { /* best effort */ }
  try { await server.call('DELETE', `/meetings/${meeting.id}`); } catch { /* best effort */ }
  console.log(`  (screenshots: ${shots})`);
  await browser.close();
  process.exit(done());
}
