/**
 * What happened to the task, newest first (read-only): short lines worded as on the web
 * (src/activity-feed.js), quick runs by one person folded into one line, five at a time.
 */
import { el, mount, timeAgo } from '../dom.js';
import { buildTimeline } from '../../src/activity-feed.js';
import { redrawKeepingFocus, section, when } from './kit.js';

const FIRST = 5;
const MORE = 10;

export function ActivitySection(d) {
  const node = el('div');
  let shown = FIRST;

  function render() {
    redrawKeepingFocus(node, () => mount(node, draw()));
  }

  function draw() {
    const rows = Array.isArray(d.s.activity) ? d.s.activity : [];
    const items = buildTimeline(rows.map((a) => ({
      id: a.id,
      action: a.action,
      actorName: (a.actor && a.actor.name) || d.name(a.userId),
      createdAt: a.createdAt,
      meta: a.meta ?? null,
    })));
    if (!items.length) return null;
    return section('activity', 'Activity',
      el('ul', { class: 'td-activity', 'aria-label': 'Activity' }, items.slice(0, shown).map(line)),
      items.length > shown
        ? el('button', { class: 'btn sm ghost', type: 'button', onClick: () => { shown += MORE; render(); } }, 'Show more')
        : null,
    );
  }

  function line(item) {
    const path = item.path && item.path.length > 1 ? item.path : null;
    return el('li', { class: `td-act kind-${item.kind}` },
      el('span', { class: 'td-act-text' }, el('span', { class: 'td-strong', dir: 'auto' }, item.actorName), ' ', el('span', {}, item.text)),
      path ? el('span', { class: 'td-act-path', 'aria-hidden': 'true' }, path.map((step, i) => [i ? el('span', { class: 'muted' }, ' → ') : null, el('span', { class: 'td-step' }, step)])) : null,
      path ? el('span', { class: 'sr-only' }, `: ${path.join(', then ')}`) : null,
      item.createdAt ? el('span', { class: 'time' }, ' · ', when(item.createdAt, timeAgo(item.createdAt))) : null,
    );
  }

  return { node, render };
}
