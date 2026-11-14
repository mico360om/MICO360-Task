import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import qrcode from 'qrcode-generator';
import { ApiError } from '../../lib/api-client';
import { CertificateView } from './CertificateView';
import { CERT_PAGE, certQrBox } from './certificate-art';
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

const region = () => screen.getByRole('region', { name: 'Certificate' });
const frameOf = () => region().querySelector<HTMLElement>('[data-certificate-frame]')!;
const paper = () => frameOf().querySelector<SVGSVGElement>('svg[data-certificate-paper]')!;
const word = (role: string) => [...paper().querySelectorAll(`[data-certificate-word="${role}"]`)].map((t) => t.textContent);
/** The certificate's detail rows: each label with its value (a value's lines joined). */
const facts = () =>
  [...paper().querySelectorAll('[data-certificate-word="label"]')].map((l) => [
    l.textContent,
    [...paper().querySelectorAll(`[data-certificate-word="value"][data-certificate-row="${l.getAttribute('data-certificate-row')}"]`)].map((v) => v.textContent).join(' '),
  ]);

describe('the certificate on the course page (1.23.35: the PDF’s new design, on screen)', () => {
  it('the same page as the PDF: CERTIFICATE / OF COMPLETION, the name in script and red, the course, the company, the rows; Valid beside it', () => {
    show(fakeLearner());
    expect(word('heading')).toEqual(['CERTIFICATE']);
    expect(word('subheading')).toEqual(['OF COMPLETION']);
    expect(word('certifies')).toEqual(['THIS CERTIFIES THAT']);
    expect(word('name')).toEqual(['Mariam Al Balushi']);
    expect(word('completed')).toEqual(['has successfully completed']);
    expect(word('course')).toEqual(['MICO360 Tasks User Training']);
    expect(word('company')).toEqual(['Contoso Engineering LLC']);
    expect(word('through')).toEqual(['Issued through MICO360 Tasks · Learning Hub']);
    // Issued on another day than finished (the change day): Completed, then Issued; no expiry: Never.
    expect(word('label')).toEqual(['Completed', 'Issued', 'Expires', 'Certificate ID']);
    expect(word('value')).toEqual(['3 Nov 2026', '5 Nov 2026', 'Never', 'TC-UT7A-UT7B-UT7C']);
    const name = paper().querySelector('[data-certificate-word="name"]')!;
    expect(name.getAttribute('font-family')).toMatch(/Great Vibes/);
    expect(name.getAttribute('fill')).toBe('#8B1E1E');
    expect(paper().querySelector('[data-certificate-word="heading"]')!.getAttribute('font-weight')).toBe('900');
    expect(within(region()).getByText('Valid')).toBeInTheDocument();
    // The laurel wreath and the angled shapes are drawn (vector paths), and "Scan to verify" under the QR code.
    expect(paper().querySelectorAll('path').length).toBeGreaterThan(40);
    expect(paper().querySelector('[data-certificate-scan]')!.textContent).toBe('Scan to verify');
  });

  it('scaled to the width with the page’s shape, light like paper in both themes, laid out left to right', () => {
    show(fakeLearner());
    const frame = frameOf();
    expect(frame.style.aspectRatio.replace(/\s/g, '')).toBe(`${CERT_PAGE.width}/${CERT_PAGE.height}`);
    expect(frame.className).toMatch(/\bw-full\b/);
    expect(frame.className).not.toMatch(/\bdark:/);
    expect(frame.style.backgroundColor).toBe('rgb(255, 255, 255)');
    expect(frame).toHaveAttribute('dir', 'ltr');
    expect(paper()).toHaveAttribute('viewBox', `0 0 ${CERT_PAGE.width} ${CERT_PAGE.height}`);
  });

  it('read aloud: the words are real text in reading order, the shapes hidden; the logo and the QR code are named images on the paper', () => {
    show(fakeLearner());
    expect(paper()).toHaveAttribute('role', 'group');
    expect(paper()).toHaveAttribute('aria-label', 'Certificate of completion');
    expect(paper()).not.toHaveAttribute('aria-hidden');
    // Each word once (no hidden copy), in the order they read.
    expect(within(region()).getAllByText('Mariam Al Balushi')).toHaveLength(1);
    const order = [...paper().querySelectorAll('text')].map((t) => t.textContent);
    expect(order.slice(0, 8)).toEqual(['CERTIFICATE', 'OF COMPLETION', 'THIS CERTIFIES THAT', 'Mariam Al Balushi', 'has successfully completed', 'MICO360 Tasks User Training', 'Contoso Engineering LLC', 'Issued through MICO360 Tasks · Learning Hub']);
    expect(paper().querySelectorAll('path').length).toBe(paper().querySelectorAll('g[aria-hidden="true"] path').length);
    expect(within(paper() as unknown as HTMLElement).getByRole('img', { name: 'MICO360 Tasks' }).tagName.toLowerCase()).toBe('image');
    expect(facts()).toEqual([
      ['Completed', '3 Nov 2026'],
      ['Issued', '5 Nov 2026'],
      ['Expires', 'Never'],
      ['Certificate ID', 'TC-UT7A-UT7B-UT7C'],
    ]);
    const qr = within(region()).getByRole('img', { name: 'QR code: check certificate TC-UT7A-UT7B-UT7C online' });
    expect(qr.tagName.toLowerCase()).toBe('svg');
    // On a white tile in both themes (a dark page would make a QR code that doesn't scan), centred in the wreath.
    const tile = qr.parentElement!;
    expect(tile.className).toMatch(/\bbg-white\b/);
    expect(tile.className).toMatch(/\btext-black\b/);
    const q = qrcode(0, 'M');
    q.addData(certificate().verifyUrl);
    q.make();
    const box = certQrBox(q.getModuleCount());
    expect(parseFloat(tile.style.left)).toBeCloseTo((box.x / CERT_PAGE.width) * 100, 3);
    expect(parseFloat(tile.style.width)).toBeCloseTo((box.size / CERT_PAGE.width) * 100, 3);
  });

  it('the score, the expiry and Issued by when the certificate has them; the company’s own logo, else MICO360’s', () => {
    const a = show(fakeLearner(), certificate({ issuedAt: '2026-11-03T09:00:00.000Z', expiresAt: '2027-11-03T09:00:00.000Z', scorePct: 96, issuerName: 'Tariq Training', issuerTitle: 'Training manager' }));
    expect(facts()).toEqual([
      ['Completed and issued', '3 Nov 2026'],
      ['Quiz score', '96%'],
      ['Expires', '3 Nov 2027'],
      ['Certificate ID', 'TC-UT7A-UT7B-UT7C'],
      ['Issued by', 'Tariq Training, Training manager'],
    ]);
    expect(paper().querySelector('image')!.getAttribute('href')).toMatch(/logo/);
    a.unmount();
    show(fakeLearner(), certificate({ company: { name: 'Fabrikam LLC', logoUrl: '/uploads/fabrikam.png' } }));
    expect(paper().querySelector('image')!.getAttribute('href')).toMatch(/\/uploads\/fabrikam\.png$/);
    expect(paper().querySelector('image')).toHaveAttribute('aria-label', 'Fabrikam LLC logo');
    expect(word('company')).toEqual(['Fabrikam LLC']);
  });

  it('a logo kept at another address is used as it is; one that won’t load falls back to MICO360’s', () => {
    show(fakeLearner(), certificate({ company: { name: 'Northwind', logoUrl: 'https://files.example.com/northwind.png' } }));
    const img = paper().querySelector('image')!;
    expect(img.getAttribute('href')).toBe('https://files.example.com/northwind.png');
    fireEvent.error(img);
    expect(paper().querySelector('image')!.getAttribute('href')).not.toMatch(/northwind/);
    expect(paper().querySelector('image')).toHaveAttribute('aria-label', 'MICO360 Tasks');
  });

  it('an Arabic name is set in Naskh, not the script face', () => {
    show(fakeLearner(), certificate({ learnerName: 'سارة علي' }));
    const name = paper().querySelector('[data-certificate-word="name"]')!;
    expect(name.textContent).toBe('سارة علي');
    expect(name.getAttribute('font-family')).toMatch(/Naskh/);
  });

  it('expired or revoked: the large faint stamp, the date and reason in the rows; the state beside it', () => {
    const a = show(fakeLearner(), certificate({ status: 'EXPIRED', expiresAt: '2026-11-10T08:00:00.000Z' }));
    expect(within(region()).getByText('Expired')).toBeInTheDocument();
    expect(paper().querySelector('[data-certificate-stamp]')!.textContent).toBe('EXPIRED');
    expect(facts()).toContainEqual(['Expired on', '10 Nov 2026']);
    a.unmount();
    show(fakeLearner(), certificate({ status: 'REVOKED', revokedAt: '2026-11-12T08:00:00.000Z', revokedReason: 'Replaced after the retake' }));
    expect(within(region()).getByText('Revoked')).toBeInTheDocument();
    expect(paper().querySelector('[data-certificate-stamp]')!.textContent).toBe('REVOKED');
    expect(facts()).toContainEqual(['Revoked on', '12 Nov 2026']);
    expect(facts()).toContainEqual(['Reason', 'Replaced after the retake']);
  });

  it('valid: no stamp', () => {
    show(fakeLearner());
    expect(paper().querySelector('[data-certificate-stamp]')).toBeNull();
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

  it('staff: “Check it online” opens /verify/<code>; the Client portal has the same certificate and no link out', () => {
    const staff = show(fakeLearner());
    expect(screen.getByRole('link', { name: 'Check it online' })).toHaveAttribute('href', '/verify/TC-UT7A-UT7B-UT7C');
    // The actions stay outside the certificate itself.
    expect(within(frameOf()).queryByRole('button')).toBeNull();
    expect(within(frameOf()).queryByRole('link')).toBeNull();
    staff.unmount();
    show(fakeLearner(), certificate(), true);
    expect(frameOf()).toBeInTheDocument();
    expect(word('name')).toEqual(['Mariam Al Balushi']);
    expect(screen.getByRole('img', { name: /QR code/ })).toBeInTheDocument();
    expect(within(region()).queryAllByRole('link')).toHaveLength(0);
    expect(within(region()).getByRole('button', { name: 'Download certificate (PDF)' })).toBeInTheDocument();
  });

  it('an older server’s answer (no company or score fields) still shows the certificate', () => {
    const old = certificate();
    delete old.company;
    delete old.scorePct;
    delete old.issuerName;
    show(fakeLearner(), old);
    expect(word('name')).toEqual(['Mariam Al Balushi']);
    expect(facts().map((f) => f[0])).toEqual(['Completed', 'Issued', 'Expires', 'Certificate ID']);
  });
});
