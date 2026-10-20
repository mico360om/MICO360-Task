import { describe, it, expect } from 'vitest';
import { pastedFiles, type ClipboardLike } from './clipboard-files';

const at = new Date(2026, 9, 20, 22, 31, 5); // 20 Oct 2026, 22:31 local time
const png = (name = 'image.png') => new File(['png-bytes'], name, { type: 'image/png' });

/** A clipboard as a paste event hands it over. */
function clip({ files = [] as File[], items, text = '' }: { files?: File[]; items?: File[]; text?: string }): ClipboardLike {
  return {
    files: files as unknown as FileList,
    items: (items ?? []).map((f) => ({ kind: 'file', type: f.type, getAsFile: () => f })) as unknown as DataTransferItemList,
    getData: (type: string) => (type === 'text/plain' ? text : ''),
  };
}

describe('pastedFiles — what a paste attaches', () => {
  it('takes the files on the clipboard', () => {
    const pdf = new File(['%PDF'], 'report.pdf', { type: 'application/pdf' });
    expect(pastedFiles(clip({ files: [pdf] }), { typing: false, now: at })).toEqual([pdf]);
  });

  it('reads the clipboard items when the browser leaves the file list empty', () => {
    const shot = png();
    const out = pastedFiles(clip({ items: [shot] }), { typing: false, now: at });
    expect(out).toHaveLength(1);
    expect(out[0]!.type).toBe('image/png');
  });

  it('names a pasted screenshot by when it was pasted, not "image.png"', () => {
    const out = pastedFiles(clip({ files: [png(), png(), new File(['j'], 'image.jpeg', { type: 'image/jpeg' })] }), { typing: false, now: at });
    expect(out.map((f) => f.name)).toEqual(['Pasted image 2026-10-20 22.31.05.png', 'Pasted image 2026-10-20 22.31.05 (2).png', 'Pasted image 2026-10-20 22.31.05 (3).jpg']);
    expect(out[0]!.type).toBe('image/png');
    expect(out[0]!.size).toBe(png().size);
  });

  it('a picture with no name at all gets one too; a copied file keeps its own name', () => {
    const out = pastedFiles(clip({ files: [png(''), png('site photo.png')] }), { typing: false, now: at });
    expect(out.map((f) => f.name)).toEqual(['Pasted image 2026-10-20 22.31.05.png', 'site photo.png']);
  });

  it('while typing, text on the clipboard wins — copied spreadsheet cells also carry a picture of themselves', () => {
    expect(pastedFiles(clip({ files: [png()], text: 'Qty\tPrice' }), { typing: true, now: at })).toEqual([]);
  });

  it('while typing, a picture with no text is attached (a screenshot pasted into a comment)', () => {
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
