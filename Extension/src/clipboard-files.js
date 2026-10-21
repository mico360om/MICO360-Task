/**
 * Pictures and files pasted into a form, as the web app takes them. A plain-JavaScript copy of the
 * web's `lib/clipboard-files.ts` (and of the typing check in its `lib/shortcuts.ts`);
 * src/clipboard-files.dom.test.js runs both over the same pastes, so the copies can't drift apart.
 */

/** The names browsers give a pasted picture: Chrome and Edge "image.png", Firefox "image.png", or none. */
const GENERIC_NAME = /^(image\.(png|jpe?g|gif|webp|bmp)|)$/i;
const EXTENSION = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/bmp': 'bmp' };

const pad = (n) => String(n).padStart(2, '0');

/**
 * "Pasted image 2026-10-20 22.31.05" in local time — to the second, so two pastes a moment apart
 * read differently in the list and the activity; no colons: Windows can't save them in a file name.
 */
function pastedStem(now) {
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  return `Pasted image ${date} ${pad(now.getHours())}.${pad(now.getMinutes())}.${pad(now.getSeconds())}`;
}

/**
 * The files a paste should attach (`data` is the paste event's clipboardData). A copied file keeps
 * its own name; a pasted picture (a screenshot, an image copied from a page) gets "Pasted image
 * <date> <time>" instead of the browser's "image.png", numbered when there are several. While the
 * person is typing in a text box (`typing`), text on the clipboard wins: copied spreadsheet cells
 * carry a picture of themselves, and pasting them into the description must paste the text.
 */
export function pastedFiles(data, { typing, now } = {}) {
  if (!data) return [];
  let files = Array.from(data.files ?? []);
  if (files.length === 0) {
    // Some browsers leave the file list empty and offer the picture as an item only.
    files = Array.from(data.items ?? [])
      .filter((item) => item.kind === 'file')
      .map((item) => item.getAsFile())
      .filter((f) => !!f);
  }
  if (files.length === 0) return [];
  if (typing && data.getData('text/plain').trim()) return [];

  const stem = pastedStem(now ?? new Date());
  let n = 0;
  return files.map((file) => {
    if (!file.type.startsWith('image/') || !GENERIC_NAME.test(file.name)) return file;
    n += 1;
    const ext = EXTENSION[file.type] ?? file.type.slice('image/'.length);
    return new File([file], `${stem}${n > 1 ? ` (${n})` : ''}.${ext}`, { type: file.type, lastModified: file.lastModified });
  });
}

const NOT_TYPED = new Set(['button', 'submit', 'reset', 'checkbox', 'radio', 'range', 'color', 'file', 'image', 'hidden']);

/** Is focus somewhere that takes typed letters (a field, a list you type into, editable text)? */
export function isTypingTarget(el) {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') return !NOT_TYPED.has((el.type || 'text').toLowerCase());
  if (el.isContentEditable || el.getAttribute('contenteditable') === 'true') return true;
  const role = el.getAttribute('role');
  return role === 'textbox' || role === 'combobox' || role === 'searchbox';
}
