import { el, mount, timeAgo } from '../dom.js';
import { getTheme, setTheme } from '../theme.js';
import { resolveBases, checkBaseUrl, sameOrigin, DEFAULTS } from '../../src/config.js';
import { queueStats, describeMutation, retryQueued, removeQueued } from '../../src/queue.js';
import { requestHostAccess } from './login.js';

/** Settings — theme, backend URLs, sync state (incl. changes that failed to sync), sign out. */
export function SettingsScreen(ctx) {
  const root = el('div', { style: { maxWidth: '560px' } });
  const syncBody = el('div');
  load();
  return root;

  async function load() {
    const theme = await getTheme(ctx.storage);
    const stored = await ctx.storage.get(['apiBase', 'appBase']);
    const bases = resolveBases(stored);

    const themeSeg = el('div', { class: 'toolbar' },
      ...['light', 'dark', 'system'].map((m) =>
        el('button', { class: `chip${theme === m ? ' on' : ''}`, onClick: async (e) => {
          await setTheme(ctx.storage, m);
          for (const c of themeSeg.children) c.classList.remove('on');
          e.currentTarget.classList.add('on');
        } }, m[0].toUpperCase() + m.slice(1)),
      ),
    );

    const apiInput = el('input', { class: 'field', id: 'set-api', type: 'url', value: bases.apiBase, placeholder: DEFAULTS.apiBase });
    const appInput = el('input', { class: 'field', id: 'set-app', type: 'url', value: bases.appBase, placeholder: DEFAULTS.appBase });
    const saveMsg = el('span', { class: 'muted', role: 'status', style: { fontSize: '12px' } });
    const save = el('button', { class: 'btn primary sm', onClick: () => saveBackend(apiInput.value, appInput.value, bases, saveMsg) }, 'Save');

    mount(root,
      card('Appearance', themeSeg),
      card('Backend', el('div', {},
        el('label', { class: 'lbl', for: 'set-api' }, 'API base URL'), apiInput,
        el('div', { style: { height: '10px' } }),
        el('label', { class: 'lbl', for: 'set-app' }, 'Web app URL'), appInput,
        el('div', { class: 'muted', style: { fontSize: '12px', marginTop: '8px' } },
          'Only secure https:// addresses are accepted (http only for this computer or an office-network server). Changing the server signs you out on this device.'),
        el('div', { class: 'toolbar', style: { marginTop: '10px', marginBottom: 0 } }, save, saveMsg),
      )),
      card('Sync', syncBody),
      card('Account', el('div', {},
        el('div', { class: 'muted', style: { marginBottom: '10px' } }, ctx.me.email || ctx.me.name),
        el('button', { class: 'btn', onClick: signOut }, 'Sign out'),
      )),
      el('p', { class: 'muted', style: { fontSize: '12px', marginTop: '18px' } },
        el('a', { href: `${bases.appBase}`, target: '_blank', rel: 'noopener' }, 'Open the full web app ↗'),
      ),
    );
    renderSync();
  }

  async function saveBackend(apiValue, appValue, current, saveMsg) {
    const api = checkBaseUrl(apiValue);
    const app = checkBaseUrl(appValue);
    if (!api.ok) { mount(saveMsg, `API: ${api.error}`); saveMsg.classList.add('error'); return; }
    if (!app.ok) { mount(saveMsg, `Web app: ${app.error}`); saveMsg.classList.add('error'); return; }
    // First await: Chrome only shows the host-permission prompt during the click's user gesture.
    if (!(await requestHostAccess(api.url))) {
      mount(saveMsg, 'Chrome did not allow access to that server.'); saveMsg.classList.add('error');
      return;
    }
    saveMsg.classList.remove('error');
    if (!sameOrigin(api.url, current.apiBase)) {
      // EXT-04: tokens, cached data and queued changes never follow a host change.
      const { pending, failed } = await queueStats(ctx.storage, ctx.me.id);
      const unsynced = pending + failed;
      const ok = window.confirm(
        `Switch to ${new URL(api.url).host}? You will be signed out on this device` +
          (unsynced ? ` and ${unsynced} unsynced change${unsynced === 1 ? '' : 's'} will be discarded.` : '.'),
      );
      if (!ok) return;
      await ctx.storage.set({ apiBase: api.url, appBase: app.url });
      await ctx.signOut(); // revokes at the current server, wipes local data, reloads to sign-in
      return;
    }
    await ctx.storage.set({ apiBase: api.url, appBase: app.url });
    mount(saveMsg, 'Saved — reload to apply.');
  }

  async function renderSync() {
    const { pending, failedItems } = await queueStats(ctx.storage, ctx.me.id);
    const { lastSync } = await ctx.storage.get('lastSync');
    mount(syncBody,
      el('div', { class: 'muted' },
        pending ? `${pending} change${pending === 1 ? '' : 's'} waiting to sync.` : failedItems.length ? 'Nothing else waiting to sync.' : 'Everything is synced.',
        lastSync ? ` Last sync ${timeAgo(new Date(lastSync).toISOString())}.` : null),
      failedItems.length
        ? el('div', { style: { marginTop: '10px' } },
            el('div', { class: 'error', style: { fontWeight: '700', fontSize: '13px' } },
              `${failedItems.length} change${failedItems.length === 1 ? '' : 's'} could not be synced`),
            failedItems.map((item) => el('div', { class: 'sync-item' },
              el('div', { class: 'what' },
                el('div', {}, describeMutation(item)),
                item.lastError ? el('div', { class: 'why' }, item.lastError) : null),
              el('button', { class: 'btn sm', type: 'button', onClick: async () => { await retryQueued(ctx.storage, item.id); ctx.requestSync(); renderSync(); } }, 'Retry'),
              el('button', { class: 'btn sm ghost', type: 'button', onClick: async () => { await removeQueued(ctx.storage, item.id); ctx.afterMutation(); renderSync(); } }, 'Discard'),
            )))
        : null,
    );
  }

  async function signOut() {
    const { pending, failed } = await queueStats(ctx.storage, ctx.me.id);
    const unsynced = pending + failed;
    if (unsynced && !window.confirm(`You have ${unsynced} change${unsynced === 1 ? '' : 's'} that ${unsynced === 1 ? 'hasn’t' : 'haven’t'} synced yet. Signing out discards ${unsynced === 1 ? 'it' : 'them'}. Sign out anyway?`)) return;
    await ctx.signOut();
  }

  function card(title, body) {
    return el('div', { class: 'card', style: { marginBottom: '14px' } }, el('div', { class: 'section-title' }, title), body);
  }
}
