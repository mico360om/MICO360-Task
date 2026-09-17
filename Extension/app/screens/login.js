import { el, mount } from '../dom.js';

/**
 * Sign-in screen. Posts to /auth/login, stores the tokens in chrome.storage, then calls onAuthed()
 * so app.js re-boots into the authenticated shell. (30-day refresh keeps the session alive.)
 */
export function LoginScreen({ apiBase, storage, onAuthed }) {
  const err = el('div', { class: 'errbar hidden', role: 'alert' });
  const idInput = el('input', { class: 'field', type: 'text', autocomplete: 'username', placeholder: 'you@company.com' });
  const pwInput = el('input', { class: 'field', type: 'password', autocomplete: 'current-password', placeholder: 'Enter your password' });
  const btn = el('button', { class: 'btn primary', style: { width: '100%', marginTop: '6px' } }, 'Sign in');

  async function submit() {
    const identifier = idInput.value.trim();
    const password = pwInput.value;
    err.classList.add('hidden');
    if (!identifier || !password) { showErr('Enter your email and password.'); return; }
    btn.disabled = true; btn.textContent = 'Signing in…';
    try {
      const res = await fetch(`${apiBase}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier, password }),
      });
      if (!res.ok) { showErr(res.status === 423 ? 'Account locked — reset your password.' : 'Invalid email or password.'); return; }
      const session = (await res.json()).data;
      await storage.set({ accessToken: session.accessToken, refreshToken: session.refreshToken });
      onAuthed();
    } catch {
      showErr('Could not reach the server. Check your connection.');
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
      err,
      el('label', { class: 'lbl', for: 'li' }, 'Email or username'),
      idInput,
      el('div', { style: { height: '12px' } }),
      el('label', { class: 'lbl' }, 'Password'),
      pwInput,
      btn,
    ),
  );
}
