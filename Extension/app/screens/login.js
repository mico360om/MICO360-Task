import { el, mount } from '../dom.js';
import { basesFromServer, runtimeOriginsFor, sameOrigin, DEFAULTS } from '../../src/config.js';
import { startSession, clearUserData } from '../../src/session.js';
import { timeoutSignal } from '../../src/auth.js';

/**
 * Ask Chrome for access to a non-production API host. Must be the first await in a click handler
 * (Chrome only shows the prompt during the user's gesture).
 */
export async function requestHostAccess(apiBase) {
  const origins = runtimeOriginsFor(apiBase);
  if (!origins.length) return true;
  if (typeof chrome === 'undefined' || !chrome.permissions || !chrome.permissions.request) return false;
  try {
    return await chrome.permissions.request({ origins });
  } catch {
    return false;
  }
}

/**
 * Sign-in screen. Posts to /auth/login, starts the session (see src/session.js), then calls
 * onAuthed() so app.js re-boots into the authenticated shell. "Advanced" lets the user pick a
 * different server before signing in (EXT-01); the default is production.
 */
export function LoginScreen({ apiBase, appBase, storage, session, notice, onAuthed }) {
  let currentApi = apiBase;
  const err = el('div', { class: 'errbar hidden', role: 'alert' });
  const info = notice ? el('div', { class: 'infobar', role: 'status' }, notice) : null;
  const idInput = el('input', { class: 'field', id: 'li', type: 'text', autocomplete: 'username', placeholder: 'you@company.com' });
  const pwInput = el('input', { class: 'field', id: 'lp', type: 'password', autocomplete: 'current-password', placeholder: 'Enter your password' });
  const btn = el('button', { class: 'btn primary', type: 'button', style: { width: '100%', marginTop: '6px' } }, 'Sign in');
  const serverLabel = el('span', {});

  // ---- Advanced: server ---------------------------------------------------
  const shownServer = apiBase === `${appBase}/api/v1` ? appBase : apiBase;
  const serverInput = el('input', { class: 'field', id: 'ls', type: 'url', value: shownServer, placeholder: DEFAULTS.appBase, 'aria-describedby': 'ls-help' });
  const serverMsg = el('div', { class: 'muted', id: 'ls-help', style: { fontSize: '12px', marginTop: '6px' } },
    'The MICO360 Tasks site (https://…), or its API address ending in /api/v1.');
  const serverSave = el('button', { class: 'btn sm', type: 'button' }, 'Use this server');
  const serverReset = el('button', { class: 'btn sm ghost', type: 'button' }, 'Use default');
  const advanced = el('div', { class: 'advanced hidden' },
    el('label', { class: 'lbl', for: 'ls' }, 'Server'),
    serverInput,
    serverMsg,
    el('div', { class: 'toolbar', style: { marginTop: '8px', marginBottom: 0 } }, serverSave, serverReset),
  );
  const advancedToggle = el('button', { class: 'linkbtn', type: 'button', 'aria-expanded': 'false' }, 'Advanced: change server');
  advancedToggle.addEventListener('click', () => {
    const open = advanced.classList.toggle('hidden') === false;
    advancedToggle.setAttribute('aria-expanded', String(open));
    if (open) serverInput.focus();
  });

  function renderServerLabel() {
    mount(serverLabel, sameOrigin(currentApi, DEFAULTS.apiBase) ? '' : `Server: ${new URL(currentApi).host}`);
  }
  renderServerLabel();

  async function useServer(input) {
    const next = basesFromServer(input);
    if (!next.ok) { mount(serverMsg, next.error); serverMsg.classList.add('error'); return; }
    // First await: keep the click's user gesture for Chrome's permission prompt.
    const granted = await requestHostAccess(next.apiBase);
    if (!granted) {
      mount(serverMsg, 'Chrome did not allow access to that server, so the extension can’t use it.');
      serverMsg.classList.add('error');
      return;
    }
    if (!sameOrigin(next.apiBase, currentApi)) {
      // A different host: nothing from the previous server (cache, queue, tokens) may follow (EXT-04).
      await clearUserData({ local: storage, session });
    }
    await storage.set({ apiBase: next.apiBase, appBase: next.appBase });
    currentApi = next.apiBase;
    serverInput.value = next.appBase;
    serverMsg.classList.remove('error');
    mount(serverMsg, `Using ${new URL(next.apiBase).host}.`);
    renderServerLabel();
  }
  serverSave.addEventListener('click', () => useServer(serverInput.value));
  serverReset.addEventListener('click', () => useServer(DEFAULTS.appBase));

  // ---- Sign in ----------------------------------------------------------
  async function submit() {
    const identifier = idInput.value.trim();
    const password = pwInput.value;
    err.classList.add('hidden');
    if (!identifier || !password) { showErr('Enter your email and password.'); return; }
    btn.disabled = true; btn.textContent = 'Signing in…';
    try {
      const res = await fetch(`${currentApi}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier, password }),
        signal: timeoutSignal(15000),
      });
      if (!res.ok) {
        showErr(res.status === 423 ? 'Account locked — reset your password.' : res.status === 429 ? 'Too many attempts — wait a minute and try again.' : res.status >= 500 ? 'The server had a problem. Please try again.' : 'Invalid email or password.');
        return;
      }
      const data = (await res.json()).data || {};
      await startSession({ local: storage, session }, {
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
        userId: data.user && data.user.id,
        apiBase: currentApi,
      });
      onAuthed();
    } catch {
      showErr(`Could not reach ${new URL(currentApi).host}. Check your connection, or change the server under Advanced.`);
    } finally {
      btn.disabled = false; btn.textContent = 'Sign in';
    }
  }
  function showErr(m) { mount(err, m); err.classList.remove('hidden'); }

  btn.addEventListener('click', submit);
  for (const inp of [idInput, pwInput]) inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });

  return el('div', { class: 'login-wrap' },
    el('div', { class: 'card' },
      el('h2', {}, 'Welcome back'),
      el('p', { class: 'sub' }, 'Sign in to MICO360 Tasks'),
      info,
      err,
      el('label', { class: 'lbl', for: 'li' }, 'Email or username'),
      idInput,
      el('div', { style: { height: '12px' } }),
      el('label', { class: 'lbl', for: 'lp' }, 'Password'),
      pwInput,
      btn,
      el('div', { class: 'login-foot' }, advancedToggle, el('span', { class: 'muted' }, serverLabel)),
      advanced,
    ),
  );
}
