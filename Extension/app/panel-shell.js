/**
 * The side panel's frame (Stage 7): a short header — the app's name, how it is connected, and "Open
 * MICO360 Tasks" (the full app page) — then three tabs (Today, My Tasks, Add a task) as links in a
 * named navigation, the offline bar, the screen, and a polite live region. Built for 320–400 px; the
 * app (app/app.js) draws its screens into `content` as it does in the full page.
 */
import { el } from './dom.js';

const TABS = [
  { path: '/', label: 'Today' },
  { path: '/my-tasks', label: 'My Tasks' },
  { path: '/add', label: 'Add a task' },
];

/** `onOpenApp()`: "Open MICO360 Tasks" was pressed. Returns the parts the app fills in. */
export function PanelShell({ onOpenApp }) {
  const connEl = el('span', { class: 'conn panel-conn' });
  const links = TABS.map((t) => el('a', { class: 'panel-tab', href: `#${t.path}`, dataset: { path: t.path } }, t.label));
  const titleEl = el('h1', { class: 'sr-only' }, 'Today');
  const offbar = el('div', { class: 'offbar hidden' }, 'Offline — showing saved data. Changes will sync when you reconnect.');
  const content = el('div', { class: 'content panel-content' });
  const live = el('div', { class: 'sr-only', role: 'status', 'aria-live': 'polite' });
  const top = el('div', { class: 'panel-top' },
    el('header', { class: 'panel-head' },
      el('span', { class: 'panel-brand' }, el('span', { class: 'm' }, 'MICO'), '360'),
      connEl,
      el('button', { class: 'btn sm panel-open', type: 'button', title: 'Open the full app in a tab', onClick: () => onOpenApp() }, 'Open MICO360 Tasks')),
    el('nav', { class: 'panel-tabs', 'aria-label': 'Side panel' }, links));
  const node = el('div', { class: 'panel-app' },
    top,
    offbar,
    el('main', { class: 'panel-main' }, titleEl, content),
    live);
  keepFocusClearOf(top);

  /**
   * The screen shown is `path` (its name `title`): its tab is the current page. A task's panel over
   * a list leaves the tab and heading as they were.
   */
  function setActive(path, title) {
    const tab = TABS.find((t) => t.path === path);
    if (!tab) return;
    for (const a of links) {
      if (a.dataset.path === path) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    }
    titleEl.textContent = title || tab.label;
  }

  return { node, content, live, titleEl, connEl, offbar, setActive };
}

/**
 * The header stays at the top while the page scrolls, so keyboard focus could go under it (WCAG
 * 2.4.11): the page keeps its height as `--panel-top-h`, and app.css scrolls a control that takes
 * focus clear of it (scroll-padding). It wraps to two lines at the narrowest, so it is measured.
 */
function keepFocusClearOf(top) {
  if (typeof ResizeObserver !== 'function') return; // app.css has a fallback height
  const root = top.ownerDocument.documentElement;
  new ResizeObserver(() => {
    const h = Math.ceil(top.getBoundingClientRect().height);
    if (h > 0) root.style.setProperty('--panel-top-h', `${h}px`);
  }).observe(top);
}
