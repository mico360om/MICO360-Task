/**
 * Who works on the task: its assignees, assigning or unassigning yourself, and a picker for anyone
 * else on the project's team (`GET /projects/:id/members`, kept for offline). The server takes only
 * active members: someone whose account is switched off isn't offered when the people an @mention
 * can reach (all active, `/tasks/:id/mentionable`) are known.
 */
import { el, mount } from '../dom.js';
import { createWriteLane } from '../../src/task-writes.js';
import { personName, redrawKeepingFocus, section } from './kit.js';

export function PeopleSection(d) {
  const node = el('div');
  const me = () => d.ctx.me;
  const lane = createWriteLane(); // one change of the task's people at a time
  let latest = 0;                 // the newest change asked for: only its answer is shown

  function render() {
    redrawKeepingFocus(node, () => mount(node, draw()), () => node.querySelector('select'));
  }

  /** The team members who can still be picked (undefined while loading, null when unknown). */
  function pickable() {
    const team = d.s.members;
    if (!Array.isArray(team)) return team;
    const active = Array.isArray(d.s.mentionable) && d.s.mentionable.length ? new Set(d.s.mentionable.map((p) => p.id)) : null;
    const assigned = new Set(d.s.assignees.map((a) => a.id));
    return team.filter((m) => m && !assigned.has(m.id) && (!active || active.has(m.id)));
  }

  function draw() {
    const assignees = d.s.assignees;
    const mine = assignees.some((a) => a.id === me().id);
    const choices = pickable();
    const known = Array.isArray(d.s.mentionable) && d.s.mentionable.length;
    const canAssignMe = mine || !known || d.s.mentionable.some((p) => p.id === me().id);
    const placeholder = choices === undefined ? 'Loading the team…'
      : choices === null ? 'The team shows when you’re online'
        : choices.length ? 'Add someone…'
          : (d.s.members || []).length ? 'Everyone on the project is assigned' : 'No one is on this project yet';
    const picker = el('select', { class: 'field td-select', 'aria-label': 'Add an assignee', disabled: !choices || !choices.length },
      el('option', { value: '' }, placeholder),
      (choices || []).map((m) => el('option', { value: m.id }, `${personName(m)}${m.id === me().id ? ' (you)' : ''}`)));
    picker.value = '';
    picker.addEventListener('change', () => { if (picker.value) assign(picker.value); });

    return section('people', 'Assignees',
      el('ul', { class: 'td-chiplist', 'aria-label': 'Assignees' }, assignees.map((a) => {
        const name = d.name(a.id, a);
        const you = a.id === me().id;
        return el('li', { class: 'td-chip' },
          el('span', {}, you ? `${name} (you)` : name),
          you ? null : el('button', { class: 'td-chip-x', type: 'button', 'aria-label': `Remove ${name}`, title: `Remove ${name}`, onClick: () => unassign(a) },
            el('span', { 'aria-hidden': 'true' }, '✕')));
      })),
      assignees.length ? null : el('div', { class: 'muted td-small' }, 'No one assigned yet.'),
      el('div', { class: 'td-row' },
        canAssignMe ? el('button', { class: `btn sm${mine ? '' : ' primary'}`, type: 'button', onClick: () => toggleMe(mine) }, mine ? 'Unassign me' : 'Assign me') : null,
        picker),
    );
  }

  /**
   * Show a change at once (`apply`), then send it after the one before it has been answered, so two
   * quick changes reach the server in order. Only the newest change's answer is shown; one that is
   * refused takes back only itself (`undo`), not what was changed after it.
   */
  function change(apply, undo, write, fallback, said) {
    d.clearError();
    d.s.assignees = apply(d.s.assignees);
    render();
    latest += 1;
    const mine = latest;
    return lane.run(async () => {
      try {
        const r = await write();
        // The server answers an assignment with the task's people as they are now.
        if (!r.queued && Array.isArray(r.data) && mine === latest) d.s.assignees = r.data;
        d.announce(said);
      } catch (e) {
        d.s.assignees = undo(d.s.assignees);
        d.fail(e, fallback);
      }
      render();
    });
  }

  const without = (id) => (list) => list.filter((x) => x.id !== id);
  const withRow = (row) => (list) => (list.some((x) => x.id === row.id) ? list : [...list, row]);

  function assign(userId) {
    const m = (d.s.members || []).find((x) => x.id === userId) || { id: userId };
    const name = userId === me().id ? 'you' : personName(m);
    return change(withRow(m), without(userId), () => d.send('task.assign', { id: d.taskId, userIds: [userId] }), `Couldn’t assign ${name}.`, `Assigned ${name}.`);
  }

  function unassign(a) {
    const name = d.name(a.id, a);
    return change(without(a.id), withRow(a), () => d.send('task.unassign', { id: d.taskId, userId: a.id }), `Couldn’t remove ${name}.`, `Removed ${name}.`);
  }

  function toggleMe(mine) {
    if (!mine) return assign(me().id);
    const row = d.s.assignees.find((a) => a.id === me().id);
    return change(without(me().id), withRow(row), () => d.send('task.unassign', { id: d.taskId, userId: me().id }), 'Could not unassign you.', 'You’re no longer assigned.');
  }

  return { node, render };
}
