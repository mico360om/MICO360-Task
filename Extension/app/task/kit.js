/**
 * Shared pieces of the task drawer's sections (app/task/*.js). Each section is `{ node, render }`:
 * `node` is put in the drawer once, and `render()` draws it again — only it, never the whole drawer,
 * so what is being typed elsewhere (a comment, a reply) is never lost to someone else's redraw.
 */
import { el, mount } from '../dom.js';

export { personName } from '../../src/quick-add.js';

/** A section: a heading (for screen-reader navigation) and its content, named by the heading. */
export function section(id, title, ...children) {
  return el('section', { class: 'td-sec', 'aria-labelledby': `td-${id}-h` },
    el('h3', { class: 'section-title', id: `td-${id}-h` }, title),
    ...children);
}

/**
 * Draw `container` again (`draw()` fills it) keeping keyboard focus on the same control: the one
 * with the same id, else the same label, else the same kind of control with the same text (or
 * `fallback()`) — looked for first in the same row (`data-row`, e.g. one comment), since controls
 * of different rows can share a name ("Edit your comment"). A text box being typed in keeps its
 * caret. Nothing happens to focus elsewhere.
 */
export function redrawKeepingFocus(container, draw, fallback) {
  const doc = container.ownerDocument;
  const a = doc.activeElement;
  const rowOf = (n) => {
    const r = n.closest('[data-row]');
    return r && container.contains(r) ? r.dataset.row : null;
  };
  const had = a && a !== container && container.contains(a)
    ? { id: a.id, tag: a.tagName, label: a.getAttribute('aria-label'), text: a.textContent, start: a.selectionStart, end: a.selectionEnd, row: rowOf(a) }
    : null;
  draw();
  if (!had) return;
  const all = [...container.querySelectorAll(had.tag)];
  const match = (list) => (had.id && list.find((n) => n.id === had.id))
    || (had.label && list.find((n) => n.getAttribute('aria-label') === had.label))
    || (!had.label && list.find((n) => !n.getAttribute('aria-label') && n.textContent === had.text));
  const again = (had.row && match(all.filter((n) => rowOf(n) === had.row))) || match(all);
  const target = again || (fallback && fallback());
  if (!target || target.disabled) return;
  target.focus();
  if (again && typeof had.start === 'number' && typeof target.setSelectionRange === 'function') {
    try { target.setSelectionRange(had.start, had.end); } catch { /* not a text box */ }
  }
}

/** A part of a section that draws itself again with `redrawKeepingFocus`. */
export function part(draw, { tag = 'div', props = {} } = {}) {
  const node = el(tag, props);
  return { node, render: () => redrawKeepingFocus(node, () => mount(node, draw())) };
}

/** The control in `container` named `label` (no selector escaping needed for names with quotes). */
export function labelled(container, label) {
  return [...container.querySelectorAll('[aria-label]')].find((n) => n.getAttribute('aria-label') === label) || null;
}

export function row(...children) {
  return el('div', { class: 'td-row' }, ...children);
}

export function select(label, options, value, onPick, extra = {}) {
  const node = el('select', { class: 'field td-select', 'aria-label': label, ...extra },
    options.map(([v, text]) => el('option', { value: v }, text)));
  node.value = value;
  node.addEventListener('change', () => onPick(node.value));
  return node;
}

/**
 * "Delete this …?" asked in place: the question and its answers, the safe one ("Keep") last and the
 * one focused, so Enter never deletes by accident. Escape answers "Keep" too (not the drawer's
 * Escape, which closes it). Call `focusSafe()` once it is on the page.
 */
export function confirmBox(question, answers, onKeep, { keepLabel = 'Keep', label = 'Confirm delete' } = {}) {
  const keep = el('button', { class: 'btn sm', type: 'button', onClick: onKeep }, keepLabel);
  const node = el('div', { class: 'td-confirm', role: 'group', 'aria-label': label },
    el('span', { class: 'td-confirm-q' }, question),
    answers.map(({ text, onClick, aria }) => el('button', { class: 'btn sm danger', type: 'button', 'aria-label': aria || null, onClick }, text)),
    keep);
  node.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    onKeep();
  });
  return { node, focusSafe: () => keep.focus() };
}

/** "3m ago" with the full time on hover, as a <time>. */
export function when(iso, ago) {
  if (!iso) return null;
  const d = new Date(iso);
  return el('time', { class: 'time', datetime: iso, title: Number.isNaN(d.getTime()) ? null : d.toLocaleString() }, ago);
}
