// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as ext from './clipboard-files.js';

const { pastedFiles, isTypingTarget } = ext;

const at = new Date(2026, 9, 20, 22, 31, 5); // 20 Oct 2026, 22:31 local time
const png = (name = 'image.png') => new File(['png-bytes'], name, { type: 'image/png' });

/** A clipboard as a paste event hands it over. */
function clip({ files = [], items, text = '' } = {}) {
  return {
    files,
    items: (items ?? []).map((f) => ({ kind: 'file', type: f.type, getAsFile: () => f })),
    getData: (type) => (type === 'text/plain' ? text : ''),
  };
}

describe('pastedFiles — what a paste attaches (as on the web)', () => {
  it('takes the files on the clipboard', () => {
    const pdf = new File(['%PDF'], 'report.pdf', { type: 'application/pdf' });
    expect(pastedFiles(clip({ files: [pdf] }), { typing: false, now: at })).toEqual([pdf]);
  });

  it('reads the clipboard items when the browser leaves the file list empty', () => {
    const out = pastedFiles(clip({ items: [png()] }), { typing: false, now: at });
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe('image/png');
  });

  it('names a pasted screenshot by when it was pasted, not "image.png"', () => {
    const out = pastedFiles(clip({ files: [png(), png(), new File(['j'], 'image.jpeg', { type: 'image/jpeg' })] }), { typing: false, now: at });
    expect(out.map((f) => f.name)).toEqual(['Pasted image 2026-10-20 22.31.05.png', 'Pasted image 2026-10-20 22.31.05 (2).png', 'Pasted image 2026-10-20 22.31.05 (3).jpg']);
    expect(out[0].type).toBe('image/png');
    expect(out[0].size).toBe(png().size);
  });

  it('a picture with no name at all gets one too; a copied file keeps its own name', () => {
    const out = pastedFiles(clip({ files: [png(''), png('site photo.png')] }), { typing: false, now: at });
    expect(out.map((f) => f.name)).toEqual(['Pasted image 2026-10-20 22.31.05.png', 'site photo.png']);
  });

  it('while typing, text on the clipboard wins — copied spreadsheet cells also carry a picture of themselves', () => {
    expect(pastedFiles(clip({ files: [png()], text: 'Qty\tPrice' }), { typing: true, now: at })).toEqual([]);
  });

  it('while typing, a picture with no text is attached (a screenshot pasted into the description)', () => {
    expect(pastedFiles(clip({ files: [png()], text: '  ' }), { typing: true, now: at })).toHaveLength(1);
  });

  it('outside a text box the files are taken even with text beside them', () => {
    expect(pastedFiles(clip({ files: [png()], text: 'caption' }), { typing: false, now: at })).toHaveLength(1);
  });

  it('nothing to attach: no clipboard, or only text', () => {
    expect(pastedFiles(null, { typing: false, now: at })).toEqual([]);
    expect(pastedFiles(clip({ text: 'hello' }), { typing: false, now: at })).toEqual([]);
  });
});

describe('isTypingTarget — a paste there is text first', () => {
  const make = (html) => {
    document.body.innerHTML = html;
    return document.body.firstElementChild;
  };
  it('text boxes, text areas, lists and editable text take typing', () => {
    for (const html of ['<input>', '<input type="search">', '<input type="date">', '<textarea></textarea>', '<select></select>', '<div contenteditable="true"></div>', '<div role="combobox"></div>']) {
      expect(isTypingTarget(make(html)), html).toBe(true);
    }
  });
  it('buttons, check boxes and file pickers do not', () => {
    for (const html of ['<button></button>', '<input type="checkbox">', '<input type="file">', '<div></div>']) {
      expect(isTypingTarget(make(html)), html).toBe(false);
    }
    expect(isTypingTarget(null)).toBe(false);
  });
});

// The web app owns these rules (Web Portal/frontend/src/lib/clipboard-files.ts and the typing check
// in lib/shortcuts.ts). The copies can't be compared as text, so both run over the same pastes and
// fail when the answers drift (skipped where the web app isn't checked out next to the extension).
const repo = resolve(__dirname, '../..');
const WEB_CLIPBOARD = resolve(repo, 'Web Portal/frontend/src/lib/clipboard-files.ts');
const WEB_SHORTCUTS = resolve(repo, 'Web Portal/frontend/src/lib/shortcuts.ts');
const load = (file) => (existsSync(file) ? import(pathToFileURL(file).href) : null);
const webClipboard = await load(WEB_CLIPBOARD);
const webShortcuts = await load(WEB_SHORTCUTS);

/** What a paste attaches, comparably: each file's name, type, size, and whether it is the copied file itself. */
const shape = (inputs, out) => out.map((f) => ({ name: f.name, type: f.type, size: f.size, same: inputs.includes(f) }));

describe.skipIf(!webClipboard)('pasted files: src/clipboard-files.js matches the web app (lib/clipboard-files.ts)', () => {
  const files = () => [
    [], [png()], [png(''), png('IMAGE.PNG'), png('image.jpg')], [png('site photo.png')],
    [new File(['j'], 'image.jpeg', { type: 'image/jpeg' }), new File(['g'], 'image.gif', { type: 'image/gif' }), new File(['w'], 'image.webp', { type: 'image/webp' })],
    [new File(['b'], 'image.bmp', { type: 'image/bmp' }), new File(['s'], '', { type: 'image/svg+xml' }), new File(['h'], 'image.heic', { type: 'image/heic' })],
    [new File(['%PDF'], 'report.pdf', { type: 'application/pdf' }), new File([''], 'image.png', { type: '' })],
  ];
  const texts = ['', '  ', 'caption', 'Qty\tPrice'];
  const NOWS = [at, new Date(2026, 0, 2, 3, 4, 5), new Date(2027, 11, 31, 23, 59, 59)];

  it('attaches the same files under the same names, from the file list or the items', () => {
    let compared = 0;
    for (const typing of [false, true]) {
      for (const text of texts) {
        for (const now of NOWS) {
          for (const viaItems of [false, true]) {
            for (const list of files()) {
              const data = viaItems ? clip({ items: list, text }) : clip({ files: list, text });
              const at2 = `${typing}/${JSON.stringify(text)}/${now.toISOString()}/${viaItems}/${list.map((f) => f.name).join(',')}`;
              expect(shape(list, pastedFiles(data, { typing, now })), at2).toEqual(shape(list, webClipboard.pastedFiles(data, { typing, now })));
              compared += 1;
            }
          }
        }
      }
    }
    expect(compared).toBeGreaterThan(300);
    expect(pastedFiles(null, { typing: false })).toEqual(webClipboard.pastedFiles(null, { typing: false }));
    expect(pastedFiles(undefined, { typing: true })).toEqual(webClipboard.pastedFiles(undefined, { typing: true }));
  });
});

describe.skipIf(!webShortcuts)('typing check: src/clipboard-files.js matches the web app (lib/shortcuts.ts)', () => {
  it('treats the same elements as places you type in', () => {
    const types = ['', 'text', 'search', 'email', 'number', 'date', 'password', 'url', 'tel', 'button', 'submit', 'reset', 'checkbox', 'radio', 'range', 'color', 'file', 'image', 'hidden', 'CHECKBOX'];
    const html = [
      ...types.map((t) => `<input type="${t}">`), '<input>', '<textarea></textarea>', '<select></select>', '<button></button>', '<a href="#">x</a>',
      '<div contenteditable="true"></div>', '<div contenteditable="false"></div>', '<div role="textbox"></div>', '<div role="combobox"></div>',
      '<div role="searchbox"></div>', '<div role="button"></div>', '<div></div>', '<span></span>',
    ];
    for (const h of html) {
      document.body.innerHTML = h;
      const node = document.body.firstElementChild;
      expect(isTypingTarget(node), h).toBe(webShortcuts.isTypingTarget(node));
    }
    expect(isTypingTarget(null)).toBe(webShortcuts.isTypingTarget(null));
  });
});
