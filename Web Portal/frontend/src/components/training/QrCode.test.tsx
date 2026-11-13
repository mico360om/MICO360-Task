import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import qrcode from 'qrcode-generator';
import { QrCode } from './QrCode';

const URL_ = 'https://tasks.example.com/verify/TC-UT7A-UT7B-UT7C';

describe('a QR code', () => {
  it('an image with its name: dark squares in the text colour on a white square with a 4-square quiet zone', () => {
    const { container } = render(<QrCode value={URL_} size={120} label="QR code: check certificate TC-UT7A-UT7B-UT7C online" />);
    const svg = screen.getByRole('img', { name: 'QR code: check certificate TC-UT7A-UT7B-UT7C online' });
    expect(svg.tagName.toLowerCase()).toBe('svg');
    expect(svg).toHaveAttribute('width', '120');
    expect(svg).toHaveAttribute('height', '120');
    const qr = qrcode(0, 'M');
    qr.addData(URL_);
    qr.make();
    const n = qr.getModuleCount();
    // The modules plus 4 empty modules on every side.
    expect(svg).toHaveAttribute('viewBox', `0 0 ${n + 8} ${n + 8}`);
    const bg = container.querySelector('rect')!;
    expect(bg).toHaveAttribute('fill', '#fff');
    expect(bg).toHaveAttribute('width', String(n + 8));
    const path = container.querySelector('path')!;
    expect(path).toHaveAttribute('fill', 'currentColor');
    // Every dark module is drawn once, shifted by the quiet zone; light ones never.
    const d = path.getAttribute('d')!;
    let dark = 0;
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) dark++;
    expect(d.match(/M/g)).toHaveLength(dark);
    expect(d).toContain('M4 4h1v1h-1z');
    expect(qr.isDark(0, 7)).toBe(false);
    expect(d).not.toContain('M11 4h');
  });

  it('nothing drawn (and nothing thrown) for an empty value', () => {
    const { container } = render(<QrCode value="" size={80} label="QR code" />);
    expect(container.querySelector('svg')).toBeNull();
  });
});
