import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '../../lib/api-client';
import { CertificateView } from './CertificateView';
import { certificate, fakeLearner, renderOnSide } from './training-fixtures';

const show = (api: ReturnType<typeof fakeLearner>, cert = certificate(), portal = false) => renderOnSide(<CertificateView certificate={cert} />, { api, portal });

let saved: string[] = [];
beforeEach(() => {
  saved = [];
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:x');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    saved.push(this.download);
  });
});

describe('the certificate on the course page', () => {
  it('the learner, the course, the day they finished, its code, Valid, and a QR code of the public check', () => {
    show(fakeLearner());
    const box = screen.getByRole('region', { name: 'Certificate' });
    expect(within(box).getByText('Mariam Al Balushi')).toBeInTheDocument();
    expect(within(box).getByText('MICO360 Tasks User Training')).toBeInTheDocument();
    expect(within(box).getByText('Completed 3 Nov 2026')).toBeInTheDocument();
    expect(within(box).getByText('TC-UT7A-UT7B-UT7C')).toBeInTheDocument();
    expect(within(box).getByText('Valid')).toBeInTheDocument();
    // Issued on another day than it was finished (the change day): said too; no expiry: "Never".
    expect(within(box).getByText('5 Nov 2026')).toBeInTheDocument();
    expect(within(box).getByText('Never')).toBeInTheDocument();
    const qr = within(box).getByRole('img', { name: /QR code/ });
    expect(qr.tagName.toLowerCase()).toBe('svg');
    expect(qr.getAttribute('aria-label')).toContain('TC-UT7A-UT7B-UT7C');
    // On a white tile in both themes (a dark page would make a QR code that doesn't scan).
    expect(qr.parentElement!.className).toMatch(/\bbg-white\b/);
    expect(qr.parentElement!.className).toMatch(/\btext-black\b/);
  });

  it('issued the day it was finished: one day, not two', () => {
    show(fakeLearner(), certificate({ issuedAt: '2026-11-03T09:00:00.000Z', expiresAt: '2027-11-03T09:00:00.000Z' }));
    const box = screen.getByRole('region', { name: 'Certificate' });
    expect(within(box).queryByText('Issued')).toBeNull();
    expect(within(box).getByText('3 Nov 2027')).toBeInTheDocument();
  });

  it('Download certificate (PDF) saves it under the server’s name or its code; a failure says so', async () => {
    const api = fakeLearner();
    show(api);
    await userEvent.click(screen.getByRole('button', { name: 'Download certificate (PDF)' }));
    await waitFor(() => expect(saved).toEqual(['certificate-TC-UT7A-UT7B-UT7C.pdf']));
    expect(api.certificatePdf).toHaveBeenCalledWith('cert7');
    api.certificatePdf.mockRejectedValueOnce(new ApiError(500, 'X', 'boom'));
    await userEvent.click(screen.getByRole('button', { name: 'Download certificate (PDF)' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t download the certificate.');
  });

  it('staff: “Check it online” opens /verify/<code>; the Client portal has no such link', () => {
    const staff = show(fakeLearner());
    expect(screen.getByRole('link', { name: 'Check it online' })).toHaveAttribute('href', '/verify/TC-UT7A-UT7B-UT7C');
    staff.unmount();
    show(fakeLearner(), certificate(), true);
    expect(screen.getByRole('img', { name: /QR code/ })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Check it online' })).toBeNull();
  });

  it('expired and revoked say so beside the words', () => {
    const a = show(fakeLearner(), certificate({ status: 'EXPIRED', expiresAt: '2026-11-10T08:00:00.000Z' }));
    expect(screen.getByText('Expired')).toBeInTheDocument();
    expect(screen.getByText('10 Nov 2026')).toBeInTheDocument();
    a.unmount();
    show(fakeLearner(), certificate({ status: 'REVOKED' }));
    expect(screen.getByText('Revoked')).toBeInTheDocument();
  });
});
