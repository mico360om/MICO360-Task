/**
 * @mention suggestions for a text box (task comments), as on the web: typing "@" and part of a name
 * lists the people the mention can reach; ↑/↓ choose, Enter or Tab puts the @username in, Escape
 * closes the list (only the list — not the drawer). The rules are the shared ones (src/mentions.js).
 *
 * `attachMentions(box, people)` — `people()` gives `{ id, username, name }` rows — returns the list's
 * place on the page (put it right after the box) and `close()`.
 */
import { el, mount } from '../dom.js';
import { mentionMenu, applyMention } from '../../src/mentions.js';

let lists = 0;
const PASS = new Set(['ArrowDown', 'ArrowUp', 'Enter', 'Tab', 'Escape']);

export function attachMentions(box, people) {
  const id = `td-mention-${(lists += 1)}`;
  const node = el('div', { class: 'td-mentions' });
  let menu = { kind: 'closed' };
  let active = 0;

  box.setAttribute('aria-autocomplete', 'list');

  function sync() {
    const next = mentionMenu(box.value, box.selectionStart ?? box.value.length, people());
    const same = next.kind === menu.kind && next.start === menu.start && next.query === menu.query;
    menu = next;
    if (!same) active = 0;
    draw();
  }

  function draw() {
    if (menu.kind === 'people') {
      const options = menu.people.map((p, i) => {
        const option = el('li', { id: `${id}-${i}`, role: 'option', 'aria-selected': String(i === active), class: i === active ? 'on' : null },
          el('span', { class: 'td-mention-name', dir: 'auto' }, p.name || p.username),
          el('span', { class: 'td-mention-user', dir: 'ltr' }, `@${p.username}`));
        // Keep focus (and the caret) in the box.
        option.addEventListener('mousedown', (e) => { e.preventDefault(); pick(p); });
        option.addEventListener('mouseenter', () => { active = i; draw(); });
        return option;
      });
      mount(node, el('ul', { role: 'listbox', id, 'aria-label': 'Mention someone' }, options));
      box.setAttribute('aria-controls', id);
      box.setAttribute('aria-activedescendant', `${id}-${active}`);
      return;
    }
    box.removeAttribute('aria-controls');
    box.removeAttribute('aria-activedescendant');
    mount(node, menu.kind === 'no-match' ? el('p', { class: 'td-mention-none', role: 'status' }, `No one on this project matches “@${menu.query}”.`) : null);
  }

  function pick(person) {
    if (menu.kind !== 'people') return;
    const end = menu.start + 1 + menu.query.length;
    const { text, caret } = applyMention(box.value, menu.start, person.username, end);
    box.value = text;
    box.setSelectionRange(caret, caret);
    box.dispatchEvent(new Event('input', { bubbles: true })); // so a draft kept by the caller follows
    close();
  }

  function close() {
    menu = { kind: 'closed' };
    draw();
  }

  box.addEventListener('input', sync);
  box.addEventListener('click', sync);
  box.addEventListener('keyup', (e) => { if (!PASS.has(e.key)) sync(); });
  box.addEventListener('blur', close);
  box.addEventListener('keydown', (e) => {
    if (e.isComposing) return;
    if (menu.kind === 'no-match' && e.key === 'Escape') {
      close();
    } else if (menu.kind === 'people') {
      const n = menu.people.length;
      if (e.key === 'ArrowDown') active = (active + 1) % n;
      else if (e.key === 'ArrowUp') active = (active - 1 + n) % n;
      else if (e.key === 'Enter' || e.key === 'Tab') { pick(menu.people[active]); }
      else if (e.key === 'Escape') close();
      else return;
      if (menu.kind === 'people') draw();
    } else {
      return;
    }
    // Taken here: the box's own Ctrl+Enter and the drawer's Escape never see these keys.
    e.preventDefault();
    e.stopPropagation();
  });

  return { node, close };
}

/** Who can be mentioned, as the suggestions show them ("First Last", else the username). */
export function mentionPeople(rows) {
  return (Array.isArray(rows) ? rows : [])
    .filter((p) => p && p.username)
    .map((p) => ({ id: p.id, username: p.username, name: [p.firstName, p.lastName].filter(Boolean).join(' ') || p.username }));
}
