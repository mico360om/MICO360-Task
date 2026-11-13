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
    // Issued on another day than it was finished (the change day): said too; no expiry: "Never expires".
    expect(within(box).getByText('5 Nov 2026').parentElement).toHaveTextContent(/^Issued 5 Nov 2026$/);
    expect(within(box).getByText('Never expires')).toBeInTheDocument();
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
    // An expiry day: the PDF's words.
    expect(within(box).getByText('3 Nov 2027').parentElement).toHaveTextContent(/^Valid until 3 Nov 2027$/);
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
    expect(screen.getByText('10 Nov 2026').parentElement).toHaveTextContent(/^Expired on 10 Nov 2026$/);
    a.unmount();
    show(fakeLearner(), certificate({ status: 'REVOKED' }));
    expect(screen.getByText('Revoked')).toBeInTheDocument();
  });
});

describe('the certificate framed like the PDF (13 Nov new look; the PDF itself is unchanged)', () => {
  const frameOf = () => screen.getByRole('region', { name: 'Certificate' }).querySelector<HTMLElement>('[data-certificate-frame]')!;

  it('a brand border, the logo, then “This certifies that” the learner (large) “has completed” the course “on” the day, in the PDF’s order', () => {
    show(fakeLearner());
    const frame = frameOf();
    expect(frame.className).toMatch(/\bborder-brand\b/);
    const logo = within(frame).getAllByRole('img', { name: 'MICO360 Tasks' });
    expect(logo.length).toBeGreaterThan(0);
    expect(logo[0]!.tagName.toLowerCase()).toBe('img');
    const lines = [...frame.querySelectorAll('[data-certificate-line]')].map((el) => el.textContent);
    expect(lines).toEqual(['Certificate of completion', 'This certifies that', 'Mariam Al Balushi', 'has completed', 'MICO360 Tasks User Training', 'on 3 Nov 2026']);
    expect(within(frame).getByText('Mariam Al Balushi').closest('[data-certificate-line]')!.className).toMatch(/\btext-(2xl|3xl)\b/);
  });

  it('under a rule, as on the PDF: Completed, Issued (another day), how long it is valid, the code, and the QR code — all inside the frame', () => {
    show(fakeLearner());
    const frame = frameOf();
    const facts = frame.querySelector('[data-certificate-facts]')!;
    expect([...facts.children].map((d) => d.textContent)).toEqual(['Completed 3 Nov 2026', 'Issued 5 Nov 2026', 'Never expires', 'Code TC-UT7A-UT7B-UT7C']);
    expect(within(frame).getByRole('img', { name: 'QR code: check certificate TC-UT7A-UT7B-UT7C online' })).toBeInTheDocument();
    // Its state, Download and Check it online stay outside the frame (the frame is the certificate itself).
    expect(within(frame).queryByText('Valid')).toBeNull();
    expect(within(frame).queryByRole('button')).toBeNull();
    expect(within(frame).queryByRole('link')).toBeNull();
  });

  it('expired or revoked: a plain frame (no brand border), the state said beside it', () => {
    const a = show(fakeLearner(), certificate({ status: 'EXPIRED', expiresAt: '2026-11-10T08:00:00.000Z' }));
    expect(frameOf().className).not.toMatch(/\bborder-brand\b/);
    a.unmount();
    show(fakeLearner(), certificate({ status: 'REVOKED' }));
    expect(frameOf().className).not.toMatch(/\bborder-brand\b/);
  });

  it('in the Client portal: the same frame, with no link out of the portal at all', () => {
    show(fakeLearner(), certificate(), true);
    const box = screen.getByRole('region', { name: 'Certificate' });
    expect(frameOf()).toBeInTheDocument();
    expect(within(box).queryAllByRole('link')).toHaveLength(0);
    expect(within(box).getByRole('button', { name: 'Download certificate (PDF)' })).toBeInTheDocument();
  });
});
