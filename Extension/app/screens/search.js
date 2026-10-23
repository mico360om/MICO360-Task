import { el } from '../dom.js';
import { SearchPanel } from '../search.js';

/**
 * Search as a screen (`#/search?q=…`): where typing "mico" and some words in Chrome's address bar
 * leads. It searches for those words at once; the box works as the Ctrl+K search does.
 */
export function SearchScreen(ctx) {
  const panel = SearchPanel(ctx, { initial: String((ctx.query && ctx.query.q) || '') });
  const root = el('div', { class: 'card search-screen' }, panel.node);
  setTimeout(() => { if (panel.input.isConnected) panel.input.focus(); }, 0);
  return root;
}
