import { describe, it, expect, vi, afterEach } from 'vitest';
import { downloadTextFile, downloadBlob , downloadNameFor } from './download';

afterEach(() => vi.restoreAllMocks());

describe('downloadTextFile', () => {
  it('creates an object URL for the content and clicks a download link with the filename', async () => {
    let capturedBlob: Blob | null = null;
    const createObjectURL = vi.fn((b: Blob) => { capturedBlob = b; return 'blob:mock'; });
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL });
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    downloadTextFile('report.csv', 'a,b\r\n1,2', 'text/csv');

    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(clickSpy).toHaveBeenCalledOnce();
    expect(capturedBlob).not.toBeNull();
    expect(capturedBlob!.size).toBe(Buffer.byteLength('a,b\r\n1,2')); // content passed through
    expect(capturedBlob!.type).toContain('text/csv');
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock');
  });

  it('downloadBlob clicks a link for the given blob and filename', () => {
    const createObjectURL = vi.fn(() => 'blob:pdf');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL });
    let downloadName = '';
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      downloadName = this.download;
    });
    downloadBlob('report.pdf', new Blob(['%PDF'], { type: 'application/pdf' }));
    expect(clickSpy).toHaveBeenCalledOnce();
    expect(downloadName).toBe('report.pdf');
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:pdf');
  });
});

describe('downloadNameFor — the name an attached file is saved under', () => {
  it('is the file’s own name for anything the browser saves (documents, PDFs, archives)', () => {
    // The server stores files under random names; without this a download arrived as "46304f6b-….txt".
    expect(downloadNameFor('FLOW-B note.txt')).toBe('FLOW-B note.txt');
    expect(downloadNameFor('spec.pdf')).toBe('spec.pdf');
    expect(downloadNameFor('budget.xlsx')).toBe('budget.xlsx');
  });

  it('is not set for a picture, which opens for viewing instead', () => {
    for (const name of ['photo.png', 'scan.JPG', 'a.jpeg', 'b.gif', 'c.webp']) expect(downloadNameFor(name), name).toBeUndefined();
  });
});

