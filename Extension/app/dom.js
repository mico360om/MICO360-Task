/** Minimal hyperscript + formatting helpers for the extension app screens (no framework). */

export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value' || k === 'checked' || k === 'disabled' || k === 'href' || k === 'type') node[k] = v;
    else node.setAttribute(k, v);
  }
  append(node, children);
  return node;
}

export function append(node, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false || c === true) continue;
    node.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

/** Replace a node's children with new ones. */
export function mount(node, ...children) {
  clear(node);
  append(node, children);
  return node;
}

export function timeAgo(iso, now = Date.now()) {
  if (!iso) return '';
  const diff = now - new Date(iso).getTime();
  const m = Math.round(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}

export function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function fmtDay(dateStr) {
  const d = new Date(`${dateStr}T00:00:00`);
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

/** A themed status/priority pill. */
export function pill(text, cls) {
  return el('span', { class: `pill ${cls || ''}` }, text);
}

/** Loading, empty and error placeholders shared by screens. */
export const Loader = (label = 'Loading…') => el('div', { class: 'state' }, el('div', { class: 'spinner' }), el('span', {}, label));
export const Empty = (title, sub) => el('div', { class: 'state empty' }, el('div', { class: 'state-title' }, title), sub ? el('div', { class: 'muted' }, sub) : null);
export const ErrorState = (msg, onRetry) =>
  el('div', { class: 'errbar', role: 'alert' }, el('span', {}, msg), onRetry ? el('button', { class: 'btn sm', onClick: onRetry }, 'Retry') : null);
