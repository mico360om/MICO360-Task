// 1.23.29 Private file links, in the extension as it is (no extension change), in Chrome against a local
// server: a task's picture and a chat picture come as links signed for the person, and load from the
// extension's own page (another origin, no cookies, no headers) — the server's
// Cross-Origin-Resource-Policy: cross-origin lets them; the old unsigned address of the same file is
// refused; and while a conversation polls (every 12 s) within one 6-hour block the picture is never
// drawn again (its link stays the same, so the message's signature does).
//   node tools/extension-e2e/files.mjs        (see lib.mjs for the settings)
import { launch, openApp, signIn, signedIn, apiSession, credentials, checks, outDir, sleep, SERVER, API } from './lib.mjs';

const shots = outDir('files');
const { ck, error, done } = checks();
const who = credentials();
const server = await apiSession(who);
// The same person's token for the uploads (multipart, which apiSession's JSON calls don't send).
const token = (await (await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ identifier: who.user, password: who.password }) })).json()).data.accessToken;
const stamp = Date.now().toString(36);
const SIGNED = /^\/uploads\/[^/?#]+\?u=[A-Za-z0-9_-]+&e=[0-9a-z]+&s=[A-Za-z0-9_-]{43}$/;
// A real picture (16×16), so a loaded one has a width.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAGklEQVR4nGP8z8BQz0AEYBxVSF+FAAhKDveksOjmAAAAAElFTkSuQmCC',
  'base64',
);
async function upload(path, name, fields = {}) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  form.append('file', new Blob([PNG], { type: 'image/png' }), name);
  const res = await fetch(`${API}${path}`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: form });
  return (await res.json()).data;
}

const project = (await server.call('GET', '/projects')).data.find((p) => p.code === 'MICO') ?? (await server.call('GET', '/projects')).data[0];
const columns = (await server.call('GET', `/projects/${project.id}/columns`)).data.sort((a, b) => a.position - b.position);
const T = (await server.call('POST', '/tasks', { title: `Ext files ${stamp}`, projectId: project.id, columnId: columns[0].id })).data;
const taskPic = await upload(`/tasks/${T.id}/attachments`, `site-${stamp}.png`);
const channel = (await server.call('GET', `/projects/${project.id}/chat`)).data.conversation;
const chatMsg = await upload(`/conversations/${channel.id}/attachments`, `chat-${stamp}.png`, { clientId: `ext-files-${stamp}` });
ck('the server answers both files with links signed for the person', SIGNED.test(taskPic?.url ?? '') && SIGNED.test(chatMsg?.attachments?.[0]?.url ?? ''), `${taskPic?.url} · ${chatMsg?.attachments?.[0]?.url}`);
const plain = await fetch(`${SERVER}/uploads/${taskPic.storageKey}`);
ck('the old unsigned address of the same file is refused (403)', plain.status === 403, String(plain.status));

const browser = await launch({ name: 'files' });
try {
  const page = await openApp(browser, { shotsDir: shots });
  const { evaluate, shot } = page;
  ck('signs in to the local server', signedIn((await signIn(page, who)).after));

  // ---- A task's picture in the drawer --------------------------------------------------------
  await evaluate(`location.hash = '#/task/${T.id}'; true`);
  await sleep(4000);
  const thumb = await evaluate(`(async () => {
    const img = [...document.querySelectorAll('[role="dialog"] img')].find((i) => (i.getAttribute('src') || '').includes(${JSON.stringify(taskPic.storageKey)}));
    if (!img) return null;
    if (!img.complete) await new Promise((r) => { img.onload = r; img.onerror = r; });
    return { src: img.getAttribute('src'), width: img.naturalWidth, origin: location.origin };
  })()`);
  ck('the task picture loads in the extension’s drawer (another origin, signed link)', !!thumb && thumb.width > 0 && thumb.origin.startsWith('chrome-extension://') && /[?&]s=/.test(thumb.src), JSON.stringify(thumb));
  await shot('task-picture');

  // ---- A chat picture, and the poll that doesn't redraw it ----------------------------------------
  await evaluate(`location.hash = '#/chat/${channel.id}'; true`);
  await sleep(4000);
  const findPic = `[...document.querySelectorAll('a.chat-picture img')].find((i) => (i.getAttribute('src') || '').includes(${JSON.stringify(chatMsg.attachments[0].storageKey)}))`;
  const chatPic = await evaluate(`(async () => {
    const img = ${findPic};
    if (!img) return null;
    if (!img.complete) await new Promise((r) => { img.onload = r; img.onerror = r; });
    img.dataset.pfMark = 'first-draw';
    return { src: img.getAttribute('src'), width: img.naturalWidth };
  })()`);
  ck('the chat picture loads in the conversation (signed link)', !!chatPic && chatPic.width > 0 && /[?&]s=/.test(chatPic.src), JSON.stringify(chatPic));
  await shot('chat-picture');
  await sleep(26_000); // two polls of the conversation (every 12 seconds)
  const after = await evaluate(`(() => { const img = ${findPic}; return img ? { mark: img.dataset.pfMark || null, src: img.getAttribute('src') } : null; })()`);
  ck('two polls later the same picture element is still there, same link (not drawn again)', !!after && after.mark === 'first-draw' && after.src === chatPic?.src, JSON.stringify(after));
} catch (err) {
  error(err);
} finally {
  await browser.close();
}
await server.call('DELETE', `/tasks/${T.id}`).catch(() => {});
process.exit(done());
