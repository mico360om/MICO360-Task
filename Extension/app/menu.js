import { el } from './dom.js';

let menuSeq = 0;

/**
 * A menu button (the ARIA menu-button pattern): a button that opens a short list of actions.
 * Click, Enter, Space or Down Arrow opens it on the first item, Up Arrow on the last. In the menu,
 * the arrows, Home and End move between items; Enter or Space picks one; Escape closes it and puts
 * focus back on the button; Tab or a click elsewhere closes it.
 *
 * `items()` is read each time it opens: [{ label, onPick, swatch? }]. The menu is placed in `host`
 * (default: the button's parent), after the button. Returns the button.
 */
export function menuButton({ text, label, menuLabel, title, className = '', items, host }) {
  const id = `menu-${(menuSeq += 1)}`;
  const button = el('button', {
    class: className, type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-label': label, title,
  }, text);
  let menu = null;

  function onOutside(e) {
    if (!menu) return;
    if (!menu.isConnected) { close(false); return; }
    if (!menu.contains(e.target) && !button.contains(e.target)) close(false);
  }

  function close(refocus) {
    if (menu) menu.remove();
    menu = null;
    button.setAttribute('aria-expanded', 'false');
    button.removeAttribute('aria-controls');
    document.removeEventListener('pointerdown', onOutside, true);
    if (refocus && button.isConnected) button.focus();
  }

  function entries() {
    return menu ? [...menu.querySelectorAll('[role="menuitem"]')] : [];
  }

  function open(at = 'first') {
    if (menu) close(false);
    const list = items();
    if (!list.length) return;
    menu = el('div', { class: 'menu', role: 'menu', id, 'aria-label': menuLabel || label },
      list.map((item) => el('button', {
        class: 'menu-item', type: 'button', role: 'menuitem', tabindex: '-1',
        onClick: () => { close(false); item.onPick(); },
      }, item.swatch ? el('span', { class: 'cdot', 'aria-hidden': 'true', style: { background: item.swatch } }) : null, item.label)),
    );
    menu.addEventListener('keydown', onMenuKey);
    (host || button.parentNode).append(menu);
    button.setAttribute('aria-expanded', 'true');
    button.setAttribute('aria-controls', id);
    document.addEventListener('pointerdown', onOutside, true);
    const all = entries();
    (at === 'last' ? all[all.length - 1] : all[0]).focus();
  }

  function onMenuKey(e) {
    const all = entries();
    const i = all.indexOf(document.activeElement);
    const go = (n) => { e.preventDefault(); all[(n + all.length) % all.length].focus(); };
    if (e.key === 'ArrowDown') go(i + 1);
    else if (e.key === 'ArrowUp') go(i - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(all.length - 1);
    else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close(true);
    } else if (e.key === 'Tab') close(false); // focus moves on as usual
  }

  button.addEventListener('click', () => (menu ? close(true) : open('first')));
  button.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); open('first'); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); open('last'); }
  });
  return button;
}
