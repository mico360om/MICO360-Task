/**
 * The task's tags: take one off, or type one (the workspace's tags are suggested). Each change is
 * sent with the list it started from (`PUT /tasks/:id/tags` over the task's tags as they are then),
 * one change after another, so two quick changes can't land in the wrong order. A name the server
 * would refuse (blank, an eleventh tag) is explained first.
 */
import { el, mount } from '../dom.js';
import { createWriteLane } from '../../src/task-writes.js';
import { withTag, withoutTag, tagRecords, tagChoices } from '../../src/tags.js';
import { redrawKeepingFocus, section } from './kit.js';

export function TagsSection(d) {
  const node = el('div');
  const lane = createWriteLane();
  let draft = '';
  let latest = 0; // the newest change asked for: only its answer is shown

  const tags = () => (Array.isArray(d.s.task.tags) ? d.s.task.tags : []);
  const names = () => tags().map((t) => t.name);

  function render() {
    redrawKeepingFocus(node, () => mount(node, draw()));
  }

  function draw() {
    const input = el('input', { class: 'field', 'aria-label': 'Add a tag', list: 'td-tag-choices', maxlength: '40', placeholder: 'Add a tag…', autocomplete: 'off' });
    input.value = draft;
    input.addEventListener('input', () => { draft = input.value; });
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      add(input.value);
    });
    const list = tags();
    return section('tags', 'Tags',
      el('ul', { class: 'td-chiplist', 'aria-label': 'Tags' }, list.map((t) => el('li', { class: 'td-chip' },
        el('span', { class: 'td-dot', 'aria-hidden': 'true', style: { background: t.color || 'var(--ink3)' } }),
        el('span', {}, t.name),
        el('button', { class: 'td-chip-x', type: 'button', 'aria-label': `Remove tag ${t.name}`, title: `Remove tag ${t.name}`, onClick: () => remove(t.name) },
          el('span', { 'aria-hidden': 'true' }, '✕')),
      ))),
      list.length ? null : el('div', { class: 'muted td-small' }, 'No tags yet.'),
      el('div', { class: 'td-add' },
        input,
        el('datalist', { id: 'td-tag-choices' }, tagChoices(d.s.tagCatalog, names()).map((n) => el('option', { value: n }))),
        el('button', { class: 'btn sm', type: 'button', onClick: () => add(node.querySelector('input[aria-label="Add a tag"]').value) }, 'Add tag'),
      ),
    );
  }

  function add(raw) {
    d.clearError();
    const r = withTag(names(), raw);
    if (r.error) {
      d.fail(null, r.error);
      return;
    }
    draft = '';
    if (r.already) {
      d.announce(`It already has the tag ${r.already}.`);
      render();
      return;
    }
    const name = r.names[r.names.length - 1];
    save(r.names, `Added the tag ${name}.`);
  }

  function remove(name) {
    d.clearError();
    save(withoutTag(names(), name), `Removed the tag ${name}.`);
  }

  /**
   * Show the new list at once, then send it after the change before it has been answered. The list
   * it started from goes with it, so it is sent as its own additions and removals over the task's
   * tags as they are then: a tag someone else added or took off meanwhile stays (src/queue.js).
   */
  function save(next, said) {
    const before = tags();
    const base = before.map((t) => t.name);
    d.s.task.tags = tagRecords(next, [...before, ...(Array.isArray(d.s.tagCatalog) ? d.s.tagCatalog : [])]);
    render();
    latest += 1;
    const mine = latest;
    return lane.run(async () => {
      try {
        const r = await d.send('task.tags', { id: d.taskId, base, tags: next });
        if (!r.queued && Array.isArray(r.data) && mine === latest) d.s.task.tags = r.data;
        d.announce(said);
      } catch (e) {
        if (mine === latest) d.s.task.tags = before;
        d.fail(e, 'Couldn’t change the tags.');
      }
      render();
    });
  }

  return { node, render };
}
