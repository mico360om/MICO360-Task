/**
 * Browser checks for the Chrome extension, shared by the scripts in this folder.
 *
 * Headless Chrome with a throwaway profile loads the extension unpacked over the DevTools protocol
 * (a pipe: --remote-debugging-pipe + Extensions.loadUnpacked, so no npm packages are needed). The
 * scripts drive the extension's pages with Runtime.evaluate and real key presses
 * (Input.dispatchKeyEvent), and use the same server's API to set up data and check what was saved.
 *
 * Run from the repo root, e.g.  node tools/extension-e2e/board.mjs   (Git Bash: MSYS_NO_PATHCONV=1)
 *
 * Settings (environment variables, all optional):
 *   MICO_E2E_SERVER     the server, default http://localhost:4000. Its CORS_ORIGINS must list
 *                       chrome-extension://* (the permission prompt is stubbed, so the host isn't
 *                       really granted and requests are plain CORS).
 *   MICO_E2E_USER       sign-in, default admin@mico360.test
 *   MICO_E2E_PASSWORD   default: DEV_PASSWORD from Web Portal/backend/prisma/seed.ts (a demo database)
 *   MICO_E2E_EXTENSION  the unpacked extension folder, default Extension/ (or an unzipped release zip)
 *   MICO_E2E_OUT        screenshots, downloads and the profile, default <temp>/mico360-extension-e2e
 *   CHROME_PATH         default C:/Program Files/Google/Chrome/Application/chrome.exe
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const EXTENSION_DIR = path.resolve(process.env.MICO_E2E_EXTENSION || path.join(ROOT, 'Extension'));
export const SERVER = (process.env.MICO_E2E_SERVER || 'http://localhost:4000').replace(/\/+$/, '');
export const API = `${SERVER}/api/v1`;
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = path.resolve(process.env.MICO_E2E_OUT || path.join(os.tmpdir(), 'mico360-extension-e2e'));

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The sign-in to use. The password is never printed. */
export function credentials(user = process.env.MICO_E2E_USER || 'admin@mico360.test') {
  let password = process.env.MICO_E2E_PASSWORD;
  if (!password) {
    const seed = fs.readFileSync(path.join(ROOT, 'Web Portal/backend/prisma/seed.ts'), 'utf8');
    password = /const DEV_PASSWORD = '([^']+)'/.exec(seed)?.[1];
  }
  if (!password) throw new Error('Set MICO_E2E_PASSWORD (no DEV_PASSWORD found in the seed).');
  return { user, password };
}

/** A folder for one script's output (emptied first). */
export function outDir(name) {
  const dir = path.join(OUT, name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** ✓/✗ lines and a summary; `done()` prints it and returns the exit code. */
export function checks() {
  let pass = 0;
  let fail = 0;
  const ck = (name, ok, extra = '') => {
    if (ok) pass += 1;
    else fail += 1;
    console.log(`  ${ok ? '✓' : '✗'} ${name}${ok ? '' : `  → ${extra}`}`);
    return ok;
  };
  const error = (e) => {
    fail += 1;
    console.log('  ✗ harness error:', e && e.message ? e.message : e);
  };
  const done = () => {
    console.log(`\n${fail ? 'FAILURES' : 'ALL PASSED'}: ${pass} passed, ${fail} failed`);
    return fail ? 1 : 0;
  };
  return { ck, error, done };
}

/** Sign in over the API (as the web or another app would) and call it as that person. */
export async function apiSession({ user, password } = credentials()) {
  const res = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ identifier: user, password }) });
  if (!res.ok) throw new Error(`API sign-in as ${user} failed (${res.status}) — is the server at ${SERVER} running?`);
  const { data } = await res.json();
  const call = async (method, p, body) => {
    const r = await fetch(`${API}${p}`, { method, headers: { authorization: `Bearer ${data.accessToken}`, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const t = await r.text();
    return t ? JSON.parse(t) : null;
  };
  return { user: data.user, call };
}

/** Today's 'YYYY-MM-DD' in a time zone (the company's, by default Muscat). */
export function todayIn(timeZone = 'Asia/Muscat') {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

/**
 * Start headless Chrome and load the extension. `downloads`: a folder to let downloads land in.
 * Resolves { send, on, extId, manifest, close }.
 */
export async function launch({ name, extensionDir = EXTENSION_DIR, downloads = null, height = 900 } = {}) {
  // A short path on purpose: Chrome's storage files sit deep inside the profile, and Windows refuses
  // paths over 260 characters ("Failed to start: IO error … Unable to create writable file").
  const profile = path.join(os.tmpdir(), `mico360-e2e-${name}`);
  fs.rmSync(profile, { recursive: true, force: true });
  const chrome = spawn(CHROME, [
    '--headless=new', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--disable-sync',
    '--enable-unsafe-extension-debugging', '--remote-debugging-pipe', `--window-size=1280,${height}`, 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });
  const toChrome = chrome.stdio[3];
  const fromChrome = chrome.stdio[4];
  let buf = '';
  let nextId = 1;
  const pending = new Map();
  const listeners = [];
  fromChrome.on('data', (chunk) => {
    buf += chunk.toString('utf8');
    let i;
    while ((i = buf.indexOf('\0')) >= 0) {
      const msg = JSON.parse(buf.slice(0, i));
      buf = buf.slice(i + 1);
      if (msg.id && pending.has(msg.id)) {
        const { resolve, reject } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
      } else listeners.forEach((l) => l(msg));
    }
  });
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    toChrome.write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0');
  });
  const on = (fn) => listeners.push(fn);
  if (downloads) await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads, eventsEnabled: true });
  const { id: extId } = await send('Extensions.loadUnpacked', { path: extensionDir });
  const manifest = JSON.parse(fs.readFileSync(path.join(extensionDir, 'manifest.json'), 'utf8'));
  await sleep(1500);
  const close = async () => {
    try { await send('Browser.close'); } catch { /* already gone */ }
    await sleep(800);
    chrome.kill();
  };
  return { send, on, extId, manifest, close };
}

/** Windows virtual key codes for the keys the scripts press. */
const KEYS = {
  Enter: { code: 'Enter', keyCode: 13, text: '\r' },
  ' ': { code: 'Space', keyCode: 32, text: ' ' },
  Tab: { code: 'Tab', keyCode: 9 },
  Escape: { code: 'Escape', keyCode: 27 },
  ArrowDown: { code: 'ArrowDown', keyCode: 40 },
  ArrowUp: { code: 'ArrowUp', keyCode: 38 },
  Home: { code: 'Home', keyCode: 36 },
  End: { code: 'End', keyCode: 35 },
};

/**
 * Open the extension's app page in a tab. Resolves { evaluate, text, shot, press, errors, sessionId }.
 * `errors` collects uncaught exceptions and console errors from the page.
 */
export function openApp(browser, opts = {}) {
  return openPage(browser, 'app/app.html', opts);
}

/**
 * Open one of the extension's pages (e.g. 'popup/popup.html', the toolbar popup) in a tab. Resolves
 * { evaluate, text, shot, press, insertText, errors, sessionId, targetId, close }.
 */
export async function openPage(browser, page, { shotsDir, wait = 2500 } = {}) {
  const { send, on, extId } = browser;
  const { targetId } = await send('Target.createTarget', { url: `chrome-extension://${extId}/${page}` });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  await send('Runtime.enable', {}, sessionId);
  await send('Page.enable', {}, sessionId);
  await send('Page.bringToFront', {}, sessionId);
  const errors = [];
  on((m) => {
    if (m.sessionId !== sessionId) return;
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map((a) => a.value ?? a.description).join(' '));
  });
  await sleep(wait);
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
    if (r.exceptionDetails) throw new Error(`page: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
    return r.result.value;
  };
  const text = () => evaluate('document.body.innerText');
  const shot = async (file, { full = false } = {}) => {
    if (!shotsDir) return;
    if (full) {
      const h = await evaluate('Math.ceil(document.documentElement.scrollHeight)');
      await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: Math.max(1000, h), deviceScaleFactor: 1, mobile: false }, sessionId);
      await sleep(600);
    }
    const { data } = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
    fs.writeFileSync(path.join(shotsDir, file), Buffer.from(data, 'base64'));
    if (full) await send('Emulation.clearDeviceMetricsOverride', {}, sessionId);
  };
  /** A real key press (keyDown + keyUp) in the page, e.g. press('Tab', { shift: true }) or press('Enter', { ctrl: true }). */
  const press = async (key, { shift = false, ctrl = false } = {}) => {
    const k = KEYS[key];
    if (!k) throw new Error(`no key code for ${key}`);
    const base = { key, code: k.code, windowsVirtualKeyCode: k.keyCode, nativeVirtualKeyCode: k.keyCode, modifiers: (shift ? 8 : 0) | (ctrl ? 2 : 0) };
    await send('Input.dispatchKeyEvent', { type: k.text ? 'keyDown' : 'rawKeyDown', ...base, ...(k.text ? { text: k.text, unmodifiedText: k.text } : {}) }, sessionId);
    await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base }, sessionId);
    await sleep(120);
  };
  /** Type text into the focused field, as a keyboard or an input method would (fires `input`). */
  const insertText = async (value) => {
    await send('Input.insertText', { text: value }, sessionId);
    await sleep(80);
  };
  const close = () => send('Target.closeTarget', { targetId }).catch(() => {});
  return { evaluate, text, shot, press, insertText, errors, sessionId, targetId, send, close };
}

/**
 * Evaluate in the extension's background service worker (its own target), e.g. to check the
 * right-click menu item exists. Resolves the value.
 */
export async function inWorker(browser, expression) {
  const { send, extId } = browser;
  const { targetInfos } = await send('Target.getTargets');
  const worker = targetInfos.find((t) => t.type === 'service_worker' && t.url.includes(extId));
  if (!worker) throw new Error('the background service worker is not running');
  const { sessionId } = await send('Target.attachToTarget', { targetId: worker.targetId, flatten: true });
  try {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
    if (r.exceptionDetails) throw new Error(`worker: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
    return r.result.value;
  } finally {
    await send('Target.detachFromTarget', { sessionId }).catch(() => {});
  }
}

/**
 * On the sign-in screen: choose this server ("Advanced: change server"), then sign in. Chrome's
 * host-permission prompt can't be clicked headless, so it is stubbed to say yes.
 */
export async function signIn(page, { user, password } = credentials(), { server = SERVER } = {}) {
  const { evaluate } = page;
  await evaluate('chrome.permissions.request = async () => true; true');
  await evaluate(`[...document.querySelectorAll('button')].find(b => /change server/i.test(b.textContent)).click(); true`);
  await evaluate(`(() => { const i = document.getElementById('ls'); i.value = ${JSON.stringify(server)}; i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  await evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Use this server').click(); true`);
  await sleep(1500);
  const switched = await page.text();
  await evaluate(`(() => { const set = (id, v) => { const i = document.getElementById(id); i.value = v; i.dispatchEvent(new Event('input', { bubbles: true })); }; set('li', ${JSON.stringify(user)}); set('lp', ${JSON.stringify(password)}); return true; })()`);
  await evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Sign in').click(); true`);
  await sleep(5000);
  return { switched, after: await page.text() };
}

/** True once the page is signed in (not on the sign-in screen any more). */
export const signedIn = (pageText) => !/Invalid email or password|can.t reach|Sign in to/i.test(pageText) && pageText.length > 50;
