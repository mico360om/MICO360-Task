import { el, mount } from '../dom.js';
import { getTheme, setTheme } from '../theme.js';
import { resolveBases, DEFAULTS } from '../../src/config.js';
import { queueSize } from '../../src/queue.js';

/** Settings — theme, backend URLs (so a non-dev install can point at production), sync state, sign out. */
export function SettingsScreen(ctx) {
  const root = el('div', { style: { maxWidth: '560px' } });
  load();
  return root;

  async function load() {
    const theme = await getTheme(ctx.storage);
    const stored = await ctx.storage.get(['apiBase', 'appBase']);
    const bases = resolveBases(stored);
    const pending = await queueSize(ctx.storage);

    const themeSeg = el('div', { class: 'toolbar' },
      ...['light', 'dark', 'system'].map((m) =>
        el('button', { class: `chip${theme === m ? ' on' : ''}`, onClick: async (e) => {
          await setTheme(ctx.storage, m);
          for (const c of themeSeg.children) c.classList.remove('on');
          e.currentTarget.classList.add('on');
        } }, m[0].toUpperCase() + m.slice(1)),
      ),
    );

    const apiInput = el('input', { class: 'field', type: 'url', value: bases.apiBase, placeholder: DEFAULTS.apiBase });
    const appInput = el('input', { class: 'field', type: 'url', value: bases.appBase, placeholder: DEFAULTS.appBase });
    const saveMsg = el('span', { class: 'muted', style: { fontSize: '12px' } });
    const save = el('button', { class: 'btn primary sm', onClick: async () => {
      const nextApi = apiInput.value.trim();
      const nextApp = appInput.value.trim();
      await ctx.storage.set({ apiBase: nextApi, appBase: nextApp });
      // A non-localhost (e.g. production https) backend needs its host permission granted at runtime
      // (declared as optional_host_permissions in the manifest). Request it so calls aren't blocked.
      try {
        const origins = [];
        for (const u of [nextApi, nextApp]) {
          try {
            const o = new URL(u).origin;
            if (!/^https?:\/\/(localhost|127\.0\.0\.1)/.test(o)) origins.push(o + '/*');
          } catch { /* invalid URL — skip */ }
        }
        if (origins.length && typeof chrome !== 'undefined' && chrome.permissions && chrome.permissions.request) {
          await new Promise((res) => chrome.permissions.request({ origins }, res));
        }
      } catch { /* permission API unavailable — reload still applies the URL */ }
      mount(saveMsg, 'Saved — reload to apply.');
    } }, 'Save');

    mount(root,
      card('Appearance', themeSeg),
      card('Backend', el('div', {},
        el('label', { class: 'lbl' }, 'API base URL'), apiInput,
        el('div', { style: { height: '10px' } }),
        el('label', { class: 'lbl' }, 'Web app URL'), appInput,
        el('div', { class: 'toolbar', style: { marginTop: '10px', marginBottom: 0 } }, save, saveMsg),
      )),
      card('Sync', el('div', { class: 'muted' }, pending ? `${pending} change${pending === 1 ? '' : 's'} waiting to sync.` : 'Everything is synced.')),
      card('Account', el('div', {},
        el('div', { class: 'muted', style: { marginBottom: '10px' } }, ctx.me.email || ctx.me.name),
        el('button', { class: 'btn', onClick: signOut }, 'Sign out'),
      )),
      el('p', { class: 'muted', style: { fontSize: '12px', marginTop: '18px' } },
        el('a', { href: `${bases.appBase}`, target: '_blank' }, 'Open the full web app ↗'),
      ),
    );
  }

  async function signOut() {
    await ctx.storage.remove(['accessToken', 'refreshToken']);
    window.location.hash = '#/';
    window.location.reload();
  }

  function card(title, body) {
    return el('div', { class: 'card', style: { marginBottom: '14px' } }, el('div', { class: 'section-title' }, title), body);
  }
}
