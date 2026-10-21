import { el, mount } from './dom.js';
import { ProjectAvatar } from './components.js';
import { showModal } from './dialog.js';
import { buildResults, flatItems, searchable, taskByKey } from '../src/search.js';
import { messageFor } from '../src/errors.js';

let panels = 0; // ids unique on the page

/** Ctrl+K (⌘K on a Mac) opens search, as on the website. Ctrl+Shift+K is "Add a task" (the popup). */
export function isSearchShortcut(e) {
  return !!e && (e.key === 'k' || e.key === 'K') && (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey;
}

/**
 * The app's Ctrl+K: search opens over the screen — or over the task panel or another dialog, as on
 * the web; with search already open, focus goes back to its box. Chrome never gets the keys (its
 * Ctrl+K puts focus in the address bar). `open()` opens the search dialog. Returns whether it acted.
 */
export function searchShortcut(e, { doc = document, open }) {
  if (!isSearchShortcut(e) || e.defaultPrevented) return false;
  e.preventDefault();
  const box = doc.querySelector('.search-dialog .search-input');
  if (box) {
    box.focus();
    if (typeof box.select === 'function') box.select();
    return true;
  }
  open();
  return true;
}

/** Why the server couldn't be asked, in plain words. */
function failureText(e) {
  if (!e || typeof e.status !== 'number') return 'You’re offline — search needs a connection.';
  return messageFor(e, 'Search didn’t work. Please try again.');
}

/**
 * The search box and its results, as the website's Ctrl+K search: a combobox over a list (the
 * focus stays in the box; the arrows choose a result, Enter opens it, a click opens one too). Pages
 * are listed at once; from two letters the server is asked (GET /search, `debounceMs` after typing
 * stops) and what it finds is grouped as on the web. A task, project or meeting opens here, a page
 * the extension doesn't have on the website. `onLeave` runs before a result opens (the dialog
 * closes). Resolves `{ node, input }`.
 */
export function SearchPanel(ctx, { initial = '', debounceMs = 250, onLeave } = {}) {
  const uid = `search-${(panels += 1)}`;
  const isAdmin = (ctx.me && ctx.me.roles ? ctx.me.roles : []).includes('ADMIN');
  let term = String(initial || '');
  let answer = null; // the server's answer for `answered`
  let answered = null;
  let problem = ''; // why the server couldn't be asked
  let note = ''; // what a command did ("No task RIG-5.")
  let active = 0;
  let items = [];
  let timer = null;
  let asked = 0;
  let looks = new Map(); // projects by id: their pictures

  const input = el('input', {
    type: 'search', class: 'field search-input', role: 'combobox', 'aria-label': 'Search', 'aria-autocomplete': 'list',
    'aria-expanded': 'false', 'aria-controls': `${uid}-list`, placeholder: 'Search tasks, projects, people, meetings…',
    autocomplete: 'off', spellcheck: 'false', value: term,
    onInput: () => changed(),
    onKeydown: (e) => onKey(e),
  });
  const list = el('div', { id: `${uid}-list`, role: 'listbox', 'aria-label': 'Search results', class: 'search-list' });
  const noteEl = el('p', { class: 'search-note' });
  const live = el('div', { class: 'sr-only', role: 'status', 'aria-live': 'polite' });
  const node = el('div', { class: 'search-panel' },
    el('div', { class: 'search-box' }, input),
    noteEl, list, live);

  if (ctx.api.projects && typeof ctx.api.projects.list === 'function') {
    ctx.api.projects.list().then((r) => {
      looks = new Map((Array.isArray(r && r.data) ? r.data : []).map((p) => [p.id, p]));
      if (answer) render();
    }, () => { /* the pictures are a nicety */ });
  }
  if (searchable(term)) ask();
  render();
  return { node, input };

  function changed() {
    term = input.value;
    note = '';
    problem = '';
    clearTimeout(timer);
    if (searchable(term)) timer = setTimeout(ask, debounceMs);
    else asked += 1; // an answer still on its way is for words no longer there
    render();
  }

  async function ask() {
    const words = term.trim();
    const mine = (asked += 1);
    let found = null;
    let failed = '';
    try {
      found = await ctx.api.search(words);
    } catch (e) {
      failed = failureText(e);
    }
    if (mine !== asked) return; // newer words were typed meanwhile
    answer = found;
    answered = found ? words : null;
    problem = failed;
    render();
    if (failed) say(failed);
    else say(items.length ? `${items.length} result${items.length === 1 ? '' : 's'}` : `No matches for “${words}”.`);
  }

  function groups() {
    const fresh = answered !== null && answered === term.trim() ? answer : null;
    return buildResults({ term, results: fresh, isAdmin, myId: ctx.me && ctx.me.id, appBase: ctx.appBase });
  }

  function render() {
    const gs = groups();
    items = flatItems(gs);
    if (active >= items.length) active = 0;
    const waiting = searchable(term) && answered !== term.trim() && !problem;
    const text = note || problem || (waiting && !items.length ? 'Searching…' : '')
      || (answered !== null && answered === term.trim() && !items.length ? `No matches for “${answered}”.` : '');
    noteEl.textContent = text;
    noteEl.classList.toggle('hidden', !text);
    noteEl.classList.toggle('bad', Boolean(problem || note));
    let i = -1;
    mount(list, gs.map((g) => el('div', { role: 'group', 'aria-label': g.group, class: 'search-group' },
      el('div', { class: 'search-group-name', 'aria-hidden': 'true' }, g.group),
      g.items.map((it) => {
        i += 1;
        return option(it, i);
      }))));
    input.setAttribute('aria-expanded', items.length ? 'true' : 'false');
    paint();
  }

  function option(it, i) {
    const look = it.projectId ? looks.get(it.projectId) || { name: it.label } : null;
    return el('div', {
      role: 'option', id: `${uid}-o${i}`, class: 'search-opt', 'aria-selected': 'false', dataset: { itemId: it.id, index: String(i) },
      // The box keeps the focus (and its words); a click opens the result.
      onMousedown: (e) => e.preventDefault(),
      onMousemove: () => { if (active !== i) { active = i; paint(); } },
      onClick: () => { void run(it); },
    },
    look ? ProjectAvatar(look, { size: 'xs', apiBase: ctx.apiBase }) : null,
    it.hint ? el('span', { class: 'search-hint' }, it.hint) : null,
    el('span', { class: 'search-text' },
      el('span', { class: 'search-label', dir: 'auto' }, it.label),
      it.secondary ? el('span', { class: 'search-sub', dir: 'auto' }, it.secondary) : null),
    it.web ? el('span', { class: 'search-web' }, el('span', { 'aria-hidden': 'true' }, '↗'), el('span', { class: 'sr-only' }, ' — opens on the website')) : null);
  }

  /** Show which result is chosen (the box points at it; it scrolls into view). */
  function paint() {
    const opts = [...list.querySelectorAll('[role="option"]')];
    opts.forEach((o, n) => {
      o.setAttribute('aria-selected', n === active ? 'true' : 'false');
      o.classList.toggle('on', n === active);
    });
    const chosen = opts[active];
    if (chosen) {
      input.setAttribute('aria-activedescendant', chosen.id);
      if (typeof chosen.scrollIntoView === 'function') chosen.scrollIntoView({ block: 'nearest' });
    } else {
      input.removeAttribute('aria-activedescendant');
    }
  }

  function onKey(e) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!items.length) return;
      active = e.key === 'ArrowDown' ? Math.min(items.length - 1, active + 1) : Math.max(0, active - 1);
      paint();
    } else if (e.key === 'Enter') {
      const it = items[active];
      if (!it) return;
      e.preventDefault();
      void run(it);
    }
  }

  function say(text) {
    live.textContent = text;
  }

  function tell(text) {
    note = text;
    render();
    say(text);
  }

  /** Open a result: here (a screen), on the website, a direct message, or a task found by its key. */
  async function run(it) {
    const t = it.target;
    if (t.taskKey) {
      tell(`Looking for ${t.taskKey}…`);
      let task;
      try {
        task = taskByKey(await ctx.api.search(t.taskKey), t.taskKey);
      } catch (e) {
        tell(failureText(e));
        return;
      }
      if (!task) {
        tell(`No task ${t.taskKey}.`);
        return;
      }
      leave();
      ctx.navigate(`#/task/${encodeURIComponent(task.id)}`);
      return;
    }
    if (t.dm) {
      let conv;
      try {
        conv = await ctx.api.chat.startDirect(t.dm);
      } catch (e) {
        tell(e && typeof e.status === 'number' ? messageFor(e, `Couldn’t start a conversation with ${it.label}.`) : 'You’re offline — a new conversation needs a connection.');
        return;
      }
      leave();
      if (conv && conv.id) ctx.navigate(`#/chat/${encodeURIComponent(conv.id)}`);
      return;
    }
    leave();
    if (t.hash) ctx.navigate(t.hash);
    else if (t.url) ctx.openExternal(t.url);
  }

  function leave() {
    clearTimeout(timer);
    if (onLeave) onLeave();
  }
}

/**
 * Ctrl+K: search in a modal dialog over the screen (focus in the box, Escape or a click outside
 * closes it, focus goes back to what had it). Opening a result closes it first. Returns `close()`.
 */
export function openSearch(ctx, { initial = '', debounceMs } = {}) {
  const doc = document;
  const opener = doc.activeElement;
  let release = null;
  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    if (release) release();
    overlay.remove();
    if (opener && opener !== doc.body && opener.isConnected && typeof opener.focus === 'function') opener.focus();
  }
  const panel = SearchPanel(ctx, { initial, ...(debounceMs != null ? { debounceMs } : {}), onLeave: close });
  const dialog = el('div', { class: 'search-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Search' },
    panel.node,
    el('p', { class: 'search-keys', 'aria-hidden': 'true' }, '↑ ↓ to choose · Enter to open · Esc to close'));
  const overlay = el('div', { class: 'search-backdrop', onMousedown: (e) => { if (e.target === overlay) close(); } }, dialog);
  doc.body.append(overlay);
  release = showModal(overlay, { onEscape: close });
  panel.input.focus();
  return close;
}
