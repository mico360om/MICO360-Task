import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DownloadPdfButton } from './DownloadPdfButton';
import { ApiError } from '../../lib/api-client';

let saved: { name: string; blob: Blob }[] = [];
beforeEach(() => {
  saved = [];
  Object.assign(URL, { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    saved.push({ name: this.download, blob: new Blob() });
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('DownloadPdfButton (1.24.3 page PDFs)', () => {
  it('asks for the PDF, says "Preparing…" while it is made, and saves it under the server’s name', async () => {
    let finish!: (b: Blob) => void;
    const make = vi.fn(() => new Promise<Blob>((r) => (finish = r)));
    render(<DownloadPdfButton make={make} fallbackName="Workload.pdf" />);
    const button = screen.getByRole('button', { name: 'Download PDF' });
    await userEvent.click(button);
    expect(make).toHaveBeenCalledTimes(1);
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button).toBeDisabled();
    expect(button).toHaveTextContent('Preparing…');
    await act(async () => finish(new File(['%PDF'], 'Workload 2026-11-19.pdf', { type: 'application/pdf' })));
    await waitFor(() => expect(button).not.toBeDisabled());
    expect(button).toHaveTextContent('Download PDF');
    expect(saved.map((s) => s.name)).toEqual(['Workload 2026-11-19.pdf']);
  });

  it('a failure shows an error toast with the server’s words, which can be dismissed', async () => {
    const make = vi.fn(async () => {
      throw new ApiError(403, 'FORBIDDEN', 'You can’t see this person’s performance.');
    });
    render(<DownloadPdfButton make={make} fallbackName="x.pdf" />);
    await userEvent.click(screen.getByRole('button', { name: 'Download PDF' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Couldn’t make the PDF: You can’t see this person’s performance.');
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(saved).toEqual([]);
  });

  it('a lost connection says so plainly', async () => {
    render(<DownloadPdfButton make={async () => { throw new TypeError('Failed to fetch'); }} fallbackName="x.pdf" />);
    await userEvent.click(screen.getByRole('button', { name: 'Download PDF' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t make the PDF: the server couldn’t be reached. Please try again.');
  });

  it('on a phone it is a 44 px icon button whose label is for screen readers; it waits while the page loads', () => {
    render(<DownloadPdfButton make={async () => new Blob()} fallbackName="x.pdf" disabled />);
    const button = screen.getByRole('button', { name: 'Download PDF' });
    expect(button).toBeDisabled();
    expect(button.className).toContain('max-sm:h-11');
    expect(button.className).toContain('max-sm:w-11');
    expect(button.className).toContain('[@media(pointer:coarse)]:min-h-11');
    expect(button.querySelector('svg')).not.toBeNull();
    expect(screen.getByText('Download PDF').className).toContain('max-sm:sr-only');
  });
});
