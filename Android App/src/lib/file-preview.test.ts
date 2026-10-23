import { describe, it, expect, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ApiError, NetworkError } from './api-client';
import { PREVIEW_TEXT, TEXT_PREVIEW_MAX, loadTextPreview, previewFailureText, previewMode, readOfficePreview } from './file-preview';
import { carryForward } from './task-detail';

describe('a file shown inside the app (4d), as the website’s preview', () => {
  it('pictures, text and CSV, and Word / Excel / PowerPoint (the server reads them out) — a PDF opens in the phone’s own viewer', () => {
    expect(previewMode('image/png', 'site.png')).toBe('image');
    expect(previewMode('text/plain', 'notes.txt')).toBe('text');
    expect(previewMode('text/csv', 'rates.csv')).toBe('text');
    expect(previewMode('application/octet-stream', 'rates.csv')).toBe('text');
    expect(previewMode('application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'spec.docx')).toBe('office');
    expect(previewMode('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'boq.xlsx')).toBe('office');
    expect(previewMode('application/vnd.openxmlformats-officedocument.presentationml.presentation', 'deck.pptx')).toBe('office');
    expect(previewMode('application/pdf', 'drawing.pdf')).toBeNull();
    expect(previewMode('application/zip', 'site.zip')).toBeNull();
    expect(previewMode('image/svg+xml', 'logo.svg')).toBeNull();
  });

  it('reads the server’s Office preview carefully: a document’s paragraphs, a workbook’s sheets, a deck’s slides', () => {
    expect(readOfficePreview({ kind: 'document', paragraphs: ['One', 2, 'Two'], truncated: false })).toEqual({ kind: 'document', paragraphs: ['One', 'Two'], truncated: false });
    expect(readOfficePreview({ kind: 'sheet', sheets: [{ name: 'BOQ', rows: [['Item', 3], ['Pipe']], truncated: true }, { rows: [] }] })).toEqual({
      kind: 'sheet',
      sheets: [
        { name: 'BOQ', rows: [['Item', '3'], ['Pipe']], truncated: true },
        { name: 'Sheet 2', rows: [], truncated: false },
      ],
    });
    expect(readOfficePreview({ kind: 'slides', slides: [{ number: 1, lines: ['Plan'] }, { lines: 'x' }], truncated: false })).toEqual({ kind: 'slides', slides: [{ number: 1, lines: ['Plan'] }, { number: 2, lines: [] }], truncated: false });
    expect(readOfficePreview({ kind: 'video' })).toBeNull();
    expect(readOfficePreview(null)).toBeNull();
  });

  it('a text file is read from this server only, cut at the phone’s length, and never as markup', async () => {
    const long = 'a'.repeat(TEXT_PREVIEW_MAX + 5);
    const fetchImpl = vi.fn(async () => new Response(long, { status: 200 }));
    expect(await loadTextPreview(fetchImpl as unknown as typeof fetch, 'https://x.test/uploads/a.txt')).toEqual({ text: 'a'.repeat(TEXT_PREVIEW_MAX), cut: true });
    const missing = vi.fn(async () => new Response('', { status: 404 }));
    await expect(loadTextPreview(missing as unknown as typeof fetch, 'https://x.test/uploads/a.txt')).rejects.toThrow();
    await expect(loadTextPreview(fetchImpl as unknown as typeof fetch, null)).rejects.toThrow();
  });

  it('says why a preview couldn’t be shown, in the website’s words (the server’s reason when it gave one)', () => {
    expect(previewFailureText(new ApiError(415, 'NOT_PREVIEWABLE', 'This file has no preview — download it to open it.'))).toBe('This file has no preview — download it to open it. You can still download the file.');
    expect(previewFailureText(new NetworkError('offline'))).toBe(PREVIEW_TEXT.failed);
    expect(PREVIEW_TEXT).toMatchObject({
      failed: 'Couldn’t load the preview. You can still download the file.',
      cut: 'Only the beginning is shown — download the file for the rest.',
      moreRows: 'Only the first rows and columns are shown — download the file for the rest.',
      noText: 'This document has no text.',
      emptySheet: 'This sheet is empty.',
      noSlideText: 'No text on this slide.',
    });
    const web = readFileSync(resolve(__dirname, '../../../Web Portal/frontend/src/components/task-drawer/attachments.tsx'), 'utf8');
    for (const w of Object.values(PREVIEW_TEXT)) expect(web).toContain(w);
  });

  it('the details offer “Preview” for these files, and the preview loads through the server’s preview or this server’s file', () => {
    const src = (p: string) => (existsSync(resolve(__dirname, '..', p)) ? readFileSync(resolve(__dirname, '..', p), 'utf8') : '');
    expect(src('components/task-detail/InfoCards.tsx')).toMatch(/accessibilityLabel=\{`Preview \$\{a\.filename\}`\}|label=\{`Preview \$\{a\.filename\}`\}/);
    const screen = src('screens/TaskDetailScreen.tsx');
    expect(screen).toMatch(/<FilePreviewSheet/);
    expect(screen).toMatch(/resources\.tasks\.attachmentPreview\(/);
    expect(screen).toMatch(/loadTextPreview\(fetch, serverFileHref\(baseUrl, a\.url\)\)/);
    expect(src('lib/resources.ts')).toMatch(/attachmentPreview: \(id: string\) => data\(client\.get<Envelope<unknown>>\(`\/attachments\/\$\{seg\(id\)\}\/preview`\)\)\.then\(readOfficePreview\)/);
  });
});

describe('carry-forward history (4d), as the website’s “Carried forward” chip', () => {
  it('says how many times and since when, and lists each day it moved', () => {
    const view = carryForward([
      { from: '2026-10-08', to: '2026-10-09', at: '2026-10-09T00:05:00Z' },
      { from: '2026-10-09', to: '2026-10-10', at: '2026-10-10T00:05:00Z' },
    ]);
    expect(view).toEqual({
      text: 'Carried forward 2× · since Oct 8, 2026',
      label: 'Carried forward 2 times, since Oct 8, 2026',
      lines: ['Oct 8, 2026 → Oct 9, 2026', 'Oct 9, 2026 → Oct 10, 2026'],
    });
    expect(carryForward([{ from: '2026-10-08', to: '2026-10-09', at: '' }])?.label).toBe('Carried forward once, since Oct 8, 2026');
  });

  it('nothing when it never was (or what the server sent isn’t a history)', () => {
    expect(carryForward(null)).toBeNull();
    expect(carryForward([])).toBeNull();
    expect(carryForward([{ from: 3, to: 'x' } as never])).toBeNull();
  });

  it('the website words it the same way, and the details show it', () => {
    const drawer = readFileSync(resolve(__dirname, '../../../Web Portal/frontend/src/components/TaskDrawer.tsx'), 'utf8');
    expect(drawer).toContain('↪ Carried forward {carried.length}× · since {carried[0]!.from}');
    const header = readFileSync(resolve(__dirname, '../components/task-detail/HeaderCard.tsx'), 'utf8');
    expect(header).toMatch(/carryForward\(task\.carryForwardLog\)/);
  });
});

describe('a big text file or a picture the phone can’t show (final review A6)', () => {
  it('shows only the beginning of a long text — far less than the website’s 200,000 letters, which freeze a phone in one block', async () => {
    const long = 'a'.repeat(200_000);
    const fetchImpl = vi.fn(async () => new Response(long, { status: 200 }));
    const out = await loadTextPreview(fetchImpl as unknown as typeof fetch, 'https://x.test/uploads/a.txt');
    expect(out.text.length).toBe(30_000);
    expect(out.cut).toBe(true);
    expect(TEXT_PREVIEW_MAX).toBe(30_000);
  });

  it('a picture that doesn’t load (HEIC, AVIF, a file gone) says so, with the download still offered', () => {
    const sheet = readFileSync(resolve(__dirname, '../components/task-detail/FilePreviewSheet.tsx'), 'utf8');
    expect(sheet).toMatch(/<Image source=\{\{ uri: href \}\}[^>]*onError=\{\(\) => setView\(\{ error: PREVIEW_TEXT\.failed \}\)\}/);
  });
});
