/**
 * The task drawer's external contacts: the people outside the company who are responsible for the
 * task (a client's engineer, a supplier's site lead), kept apart from its assignees, as on the
 * website. Each is shown with every detail given — the email and phone as links — and can be added,
 * changed or removed (removing asks first). Typing a name suggests earlier contacts on the project
 * (`GET /projects/:id/external-contacts`, online only); picking one copies all six fields. Each
 * change is sent now or kept on this device (ctx.write); one added on this device has no server id
 * yet, so it can be changed once it has synced. The task's details carry the contacts; a server
 * without them shows no section.
 */
import { el, mount } from '../dom.js';
import { isTempId, tempId } from '../../src/pending-overlay.js';
import {
  EXTERNAL_CONTACT_FIELDS as FIELDS,
  EXTERNAL_CONTACT_LIMITS as LIMITS,
  EXTERNAL_CONTACT_WORDS as W,
  MAX_EXTERNAL_CONTACTS,
  checkExternalContact,
  contactRoleLine,
  mailHref,
  phoneHref,
  suggestionText,
} from '../../src/external-contacts.js';
import { confirmBox, labelled, redrawKeepingFocus, section } from './kit.js';

/** How long typing pauses before earlier contacts are asked for. */
export const SUGGEST_DELAY_MS = 200;

const INPUT_TYPE = { email: 'email', phone: 'tel' };
let forms = 0; // each form's own ids

export function ExternalContactsSection(d) {
  const node = el('div');
  let form = null;        // the open form: { mode: 'add' | a contact's id, node, … }
  let asking = null;      // the contact whose removal is being asked about
  let focusNext = null;   // where focus goes once the section is drawn again

  const contacts = () => (d.s.task && Array.isArray(d.s.task.externalContacts) ? d.s.task.externalContacts : null);

  function render() {
    const rows = contacts();
    // A contact whose form or question is open but that is gone now (the task was read again).
    if (form && form.mode !== 'add' && !(rows || []).some((c) => c.id === form.mode)) form = null;
    if (asking && !(rows || []).some((c) => c.id === asking)) asking = null;
    redrawKeepingFocus(node, () => mount(node, draw()));
    if (focusNext) {
      const go = focusNext;
      focusNext = null;
      go();
    }
  }

  function draw() {
    const rows = contacts();
    if (!rows) return null;
    const full = rows.length >= MAX_EXTERNAL_CONTACTS;
    const adding = form && form.mode === 'add';
    return section('external', W.heading,
      el('p', { class: 'muted td-small td-contact-hint' }, W.hint),
      rows.length
        ? el('ul', { class: 'td-contacts', 'aria-label': W.heading }, rows.map((c) => el('li', { class: 'td-contact', dataset: { row: c.id } },
          form && form.mode === c.id ? form.node : contactView(c))))
        : el('div', { class: 'muted td-small' }, W.none),
      adding ? form.node : null,
      adding ? null : el('div', { class: 'td-row' },
        el('button', { class: 'btn sm', type: 'button', disabled: full, onClick: () => openForm('add') }, W.add),
        full ? el('span', { class: 'muted td-small' }, W.full) : null),
    );
  }

  /** One contact: name; company · designation; email and phone as links; remarks; Edit and Remove. */
  function contactView(c) {
    const waiting = isTempId(c.id) || c.pending === true;
    const role = contactRoleLine(c);
    const mail = mailHref(c.email);
    const tel = phoneHref(c.phone);
    let actions;
    if (asking === c.id) {
      const box = confirmBox(W.confirmRemove, [{ text: W.remove, onClick: () => remove(c) }], () => {
        asking = null;
        focusNext = () => labelled(node, `Remove ${c.name}`)?.focus();
        render();
      }, { keepLabel: W.keep, label: `Confirm: remove ${c.name}` });
      focusNext = () => box.focusSafe();
      actions = box.node;
    } else {
      const unsynced = isTempId(c.id);
      const why = unsynced ? 'Waiting to sync' : null;
      actions = el('div', { class: 'td-row td-contact-actions' },
        el('button', { class: 'btn sm ghost', type: 'button', 'aria-label': `${W.edit} ${c.name}`, title: why, disabled: unsynced, onClick: () => openForm(c.id) }, W.edit),
        el('button', { class: 'btn sm ghost danger', type: 'button', 'aria-label': `${W.remove} ${c.name}`, title: why, disabled: unsynced, onClick: () => askRemove(c) }, W.remove));
    }
    return el('div', {},
      el('div', { class: 'td-contact-head' },
        el('span', { class: 'td-contact-name', dir: 'auto' }, c.name),
        waiting ? el('span', { class: 'muted td-small' }, ' · waiting to sync') : null),
      role ? el('div', { class: 'td-contact-role muted', dir: 'auto' }, role) : null,
      mail || tel
        ? el('div', { class: 'td-contact-reach' },
          mail ? el('a', { href: mail, class: 'td-contact-link' }, c.email) : null,
          tel ? el('a', { href: tel, class: 'td-contact-link', dir: 'ltr' }, c.phone) : null)
        : null,
      c.remarks ? el('div', { class: 'td-contact-remarks', dir: 'auto' }, c.remarks) : null,
      actions,
    );
  }

  function askRemove(c) {
    d.clearError();
    asking = c.id;
    render();
  }

  // ---- The add / edit form ----------------------------------------------------------------

  function openForm(mode) {
    d.clearError();
    asking = null;
    const existing = mode === 'add' ? null : contacts().find((c) => c.id === mode);
    form = buildForm(mode, existing);
    focusNext = () => form && form.inputs.name.focus();
    render();
  }

  /** Put the form away; focus goes back to that contact's Edit (found by its id, so a rename keeps it), else Add. */
  function closeForm() {
    const was = form;
    form = null;
    if (was) focusNext = () => (was.mode === 'add' ? focusAdd() : focusEdit(was.mode));
    render();
  }

  /** The section's heading, which takes focus when no button can (Add off at the limit). */
  const heading = () => node.querySelector('h3');
  function focusHeading() {
    const h = heading();
    if (!h) return;
    h.setAttribute('tabindex', '-1');
    h.focus();
  }
  function focusAdd() {
    const add = [...node.querySelectorAll('button')].find((b) => b.textContent === W.add);
    if (add && !add.disabled) add.focus();
    else focusHeading();
  }
  function focusEdit(contactId) {
    const row = [...node.querySelectorAll('li[data-row]')].find((li) => li.dataset.row === contactId);
    const edit = row && [...row.querySelectorAll('button')].find((b) => b.textContent === W.edit);
    if (edit && !edit.disabled) edit.focus();
    else focusAdd();
  }

  function buildForm(mode, existing) {
    const n = (forms += 1);
    const id = (field) => `xc-${n}-${field}`;
    const inputs = {};
    const errors = {};
    const values = existing ? FIELDS.reduce((acc, f) => ({ ...acc, [f]: existing[f] ?? '' }), {}) : {};
    const fieldRow = (field) => {
      const required = field === 'name';
      const props = { id: id(field), class: 'field', maxlength: String(LIMITS[field]), name: field, ...(required ? { 'aria-required': 'true' } : {}) };
      const input = field === 'remarks'
        ? el('textarea', { ...props, rows: '3' })
        : el('input', { ...props, type: INPUT_TYPE[field] || 'text', autocomplete: 'off' });
      input.value = values[field] || '';
      inputs[field] = input;
      errors[field] = el('div', { class: 'td-field-err', id: `${id(field)}-err` });
      return el('div', { class: `td-field td-field-${field}` },
        el('label', { for: id(field) }, W.labels[field], required ? el('span', { class: 'muted' }, ` (${W.required})`) : null),
        input,
        field === 'name' ? suggest.node : null,
        errors[field]);
    };
    const suggest = suggestions(() => f);
    const save = el('button', { class: 'btn sm primary', type: 'submit' }, W.save);
    const cancel = el('button', { class: 'btn sm', type: 'button', onClick: () => closeForm() }, W.cancel);
    const formNode = el('form', { class: 'td-contact-form', 'aria-label': existing ? W.editTitle : W.addTitle, novalidate: '' },
      FIELDS.map(fieldRow),
      el('div', { class: 'td-row' }, save, cancel));
    const f = { mode, existing, node: formNode, inputs, errors, save, suggest };
    suggest.attach(inputs.name);
    formNode.addEventListener('submit', (e) => {
      e.preventDefault();
      submit(f);
    });
    formNode.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      e.preventDefault();
      e.stopPropagation(); // the drawer's own Escape would close it
      closeForm();
    });
    return f;
  }

  /** Show each field's problem at it (the others cleared); focus the first one with a problem. */
  function showProblems(f, problems) {
    let first = null;
    for (const field of FIELDS) {
      const text = problems[field];
      f.errors[field].textContent = text || '';
      const input = f.inputs[field];
      if (text) {
        input.setAttribute('aria-invalid', 'true');
        input.setAttribute('aria-describedby', f.errors[field].id);
        if (!first) first = input;
      } else {
        input.removeAttribute('aria-invalid');
        input.removeAttribute('aria-describedby');
      }
    }
    if (first) first.focus();
    return Boolean(first);
  }

  async function submit(f) {
    if (f.busy) return;
    f.suggest.close();
    const draft = FIELDS.reduce((acc, field) => ({ ...acc, [field]: f.inputs[field].value }), {});
    const check = checkExternalContact(draft);
    if (!check.ok) {
      showProblems(f, check.problems);
      return;
    }
    showProblems(f, {});
    const contact = check.contact;
    d.clearError();
    if (f.mode === 'add') return add(f, contact);
    const before = f.existing;
    const patch = {};
    for (const field of FIELDS) if ((before[field] ?? null) !== contact[field]) patch[field] = contact[field];
    if (!Object.keys(patch).length) return closeForm();
    return change(f, before, patch);
  }

  async function add(f, contact) {
    f.busy = true;
    f.save.disabled = true;
    try {
      const r = await d.send('contact.add', { id: d.taskId, contact });
      // The task may have been read again meanwhile — from a server without contacts: nothing to show.
      const rows = contacts() || [];
      rows.push(!r.queued && r.data && r.data.id ? r.data : { ...contact, id: r.item ? tempId(r.item) : `tmp-${Date.now()}`, taskId: d.taskId, position: rows.length, pending: true });
      d.announce('Contact added.');
      closeForm();
    } catch (e) {
      f.busy = false;
      f.save.disabled = false;
      refused(f, e, W.addFailed);
    }
  }

  async function change(f, before, patch) {
    f.busy = true;
    f.save.disabled = true;
    try {
      const r = await d.send('contact.update', { id: d.taskId, contactId: before.id, name: patch.name ?? before.name, patch });
      const rows = contacts() || [];
      const i = rows.findIndex((c) => c.id === before.id);
      if (i >= 0) rows[i] = { ...rows[i], ...patch, ...(!r.queued && r.data && r.data.id ? r.data : {}) };
      d.announce('Contact saved.');
      closeForm();
    } catch (e) {
      f.busy = false;
      f.save.disabled = false;
      refused(f, e, W.saveFailed);
    }
  }

  /** The server's reasons at their fields (the form stays open), or its message above the task. */
  function refused(f, e, fallback) {
    const fields = e && e.status === 400 && e.details && e.details.fields;
    if (fields && typeof fields === 'object' && FIELDS.some((field) => typeof fields[field] === 'string')) {
      showProblems(f, fields);
      return;
    }
    d.fail(e, fallback);
  }

  async function remove(c) {
    asking = null;
    const rows = contacts() || [];
    const at = rows.findIndex((x) => x.id === c.id);
    if (at >= 0) rows.splice(at, 1);
    d.clearError();
    focusNext = focusAdd;
    render();
    try {
      await d.send('contact.delete', { id: d.taskId, contactId: c.id, name: c.name });
      d.announce('Contact removed.');
    } catch (e) {
      const now = contacts();
      if (now && !now.some((x) => x.id === c.id)) now.splice(Math.min(Math.max(at, 0), now.length), 0, c);
      d.fail(e, W.removeFailed);
      render();
    }
  }

  // ---- Earlier contacts on the project, suggested while a name is typed ---------------------

  function suggestions(formOf) {
    const box = el('div', { class: 'td-suggest-box' });
    const listId = `xc-suggest-${forms}`;
    let input = null;
    let shown = [];
    let active = -1;
    let timer = null;
    let asked = 0;

    function close() {
      clearTimeout(timer);
      asked += 1; // an answer still on its way is dropped
      shown = [];
      active = -1;
      draw();
    }

    function draw() {
      if (input) {
        input.setAttribute('aria-expanded', shown.length ? 'true' : 'false');
        if (shown.length) input.setAttribute('aria-controls', listId);
        else input.removeAttribute('aria-controls');
        if (active >= 0 && shown.length) input.setAttribute('aria-activedescendant', `${listId}-o${active}`);
        else input.removeAttribute('aria-activedescendant');
      }
      mount(box, shown.length
        ? el('div', { class: 'td-suggest' },
          el('div', { class: 'muted td-small' }, W.suggestionHint),
          el('ul', { role: 'listbox', id: listId, 'aria-label': W.suggestions, class: 'td-suggest-list' },
            shown.map((s, i) => {
              const option = el('li', { role: 'option', id: `${listId}-o${i}`, 'aria-selected': i === active ? 'true' : 'false', class: `td-suggest-opt${i === active ? ' active' : ''}`, dir: 'auto' }, suggestionText(s));
              option.addEventListener('mousedown', (e) => {
                e.preventDefault(); // keep focus in the name box
                pick(i);
              });
              return option;
            })))
        : null);
    }

    function pick(i) {
      const s = shown[i];
      const f = formOf();
      if (!s || !f) return;
      for (const field of FIELDS) f.inputs[field].value = s[field] ?? '';
      close();
      input.focus();
    }

    async function ask(q) {
      const read = d.ctx.api.projects && d.ctx.api.projects.externalContacts;
      const projectId = d.s.task && d.s.task.projectId;
      if (typeof read !== 'function' || !projectId) return;
      const mine = (asked += 1);
      let found;
      try {
        found = await read(projectId, q);
      } catch {
        found = []; // offline or refused: the name is typed in full
      }
      // Too late: asked again since, the form gone, the text changed, or the Name box left meanwhile.
      if (mine !== asked || !input || !input.isConnected || input.value.trim() !== q || input.ownerDocument.activeElement !== input) return;
      shown = (Array.isArray(found) ? found : []).filter((s) => s && typeof s.name === 'string').slice(0, 10);
      active = -1;
      draw();
    }

    function attach(nameInput) {
      input = nameInput;
      input.setAttribute('role', 'combobox');
      input.setAttribute('aria-autocomplete', 'list');
      input.setAttribute('aria-expanded', 'false');
      input.addEventListener('input', () => {
        // The list for what was typed before goes at once: it can't be picked while the next is asked for.
        close();
        const q = input.value.trim();
        if (!q || !d.online()) return;
        timer = setTimeout(() => ask(q), SUGGEST_DELAY_MS);
      });
      input.addEventListener('blur', () => {
        if (shown.length) close();
      });
      input.addEventListener('keydown', (e) => {
        if (!shown.length) return;
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          active = e.key === 'ArrowDown' ? (active + 1) % shown.length : (active - 1 + shown.length) % shown.length;
          draw();
        } else if (e.key === 'Enter' && active >= 0) {
          e.preventDefault(); // picks it, rather than saving the form
          pick(active);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation(); // closes the list, not the form
          close();
        }
      });
    }

    return { node: box, attach, close };
  }

  return { node, render };
}
