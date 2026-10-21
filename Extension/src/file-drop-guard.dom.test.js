// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { guardFileDrops } from './file-drop-guard.js';

// A file dropped where nothing takes it would make Chrome open it in the tab (or the popup), and
// whatever was typed but not sent would be lost (review M6). The app page and the popup guard it.
const drag = (type, target, types) => {
  const e = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(e, 'dataTransfer', { value: { files: [], types, dropEffect: 'copy' } });
  target.dispatchEvent(e);
  return e;
};

let stop = () => {};
afterEach(() => {
  stop();
  document.body.innerHTML = '';
});

describe('files dropped where nothing takes them', () => {
  it('are kept from opening in the tab, and the pointer says they can’t be dropped there', () => {
    stop = guardFileDrops(document);
    const header = document.createElement('header');
    document.body.append(header);
    const over = drag('dragover', header, ['Files']);
    expect(over.defaultPrevented).toBe(true);
    expect(over.dataTransfer.dropEffect).toBe('none');
    expect(drag('drop', header, ['Files']).defaultPrevented).toBe(true);
  });

  it('a place that takes files keeps its own answer; text drags are left alone', () => {
    stop = guardFileDrops(document);
    const zone = document.createElement('div');
    zone.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
    const input = document.createElement('input');
    document.body.append(zone, input);
    expect(drag('dragover', zone, ['Files']).dataTransfer.dropEffect).toBe('copy');
    expect(drag('dragover', input, ['text/plain']).defaultPrevented).toBe(false);
    expect(drag('drop', input, ['text/plain']).defaultPrevented).toBe(false);
  });

  it('can be taken off again', () => {
    guardFileDrops(document)();
    expect(drag('drop', document.body, ['Files']).defaultPrevented).toBe(false);
  });
});
