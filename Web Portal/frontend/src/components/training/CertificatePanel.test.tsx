import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CertificatePanel } from './CertificatePanel';
import { adminModuleDetail, certificate, detail, fakeLearner, mine, moduleCard, moduleDetail, renderOnSide } from './training-fixtures';

const finished = (over = {}) => mine({ ...moduleCard().mine, status: 'COMPLETED', progressPct: 100, modules: { done: 3, total: 3 }, certificate: certificate(), ...over });

describe('CertificatePanel', () => {
  it('before finishing: how many modules are left, over a faint certificate outline', () => {
    renderOnSide(<CertificatePanel course={moduleDetail()} />, { api: fakeLearner() });
    const panel = screen.getByRole('region', { name: 'Certificate' });
    expect(within(panel).getByText('Finish 2 more modules to get it')).toBeInTheDocument();
    expect(panel.querySelector('[data-certificate-outline]')).toHaveAttribute('aria-hidden', 'true');
    expect(within(panel).queryByRole('button')).toBeNull();
    expect(within(panel).queryByRole('link')).toBeNull();
  });

  it('counts only the person’s modules (an administrator has more)', () => {
    renderOnSide(<CertificatePanel course={adminModuleDetail()} />, { api: fakeLearner() });
    expect(screen.getByText('Finish 4 more modules to get it')).toBeInTheDocument();
  });

  it('ready: its code, View (the course page, where the certificate is shown) and Download PDF', async () => {
    const api = fakeLearner();
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:x');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    renderOnSide(<CertificatePanel course={moduleDetail({ mine: finished() })} />, { api });
    const panel = screen.getByRole('region', { name: 'Certificate' });
    expect(within(panel).getByText('Certificate ready')).toBeInTheDocument();
    expect(within(panel).getByText('TC-UT7A-UT7B-UT7C')).toBeInTheDocument();
    expect(within(panel).getByRole('link', { name: 'View the certificate' })).toHaveAttribute('href', '/training/courses/u1');
    await userEvent.click(within(panel).getByRole('button', { name: 'Download the certificate (PDF)' }));
    await waitFor(() => expect(click).toHaveBeenCalled());
    expect(api.certificatePdf).toHaveBeenCalledWith('cert7');
    // No “Check it online” here (the certificate page has it; the portal never does).
    expect(within(panel).queryByRole('link', { name: /online/i })).toBeNull();
  });

  it('View calls the page’s own handler when it gives one (a button, not a link)', async () => {
    const onView = vi.fn();
    renderOnSide(<CertificatePanel course={moduleDetail({ mine: finished() })} onView={onView} />, { api: fakeLearner() });
    await userEvent.click(screen.getByRole('button', { name: 'View the certificate' }));
    expect(onView).toHaveBeenCalledTimes(1);
  });

  it('a download that fails says so', async () => {
    const api = fakeLearner({ certificatePdf: vi.fn(async () => Promise.reject(new Error('offline'))) });
    renderOnSide(<CertificatePanel course={moduleDetail({ mine: finished() })} />, { api });
    await userEvent.click(screen.getByRole('button', { name: 'Download the certificate (PDF)' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t download the certificate.');
  });

  it('finished, then modules new for their role: an updated certificate when those are done; the current one kept', () => {
    renderOnSide(<CertificatePanel course={adminModuleDetail({ mine: finished({ newForRole: 2, modules: { done: 3, total: 5 } }) })} />, { api: fakeLearner() });
    const panel = screen.getByRole('region', { name: 'Certificate' });
    expect(within(panel).getByText('Finish the new modules for an updated certificate')).toBeInTheDocument();
    expect(within(panel).queryByText('Certificate ready')).toBeNull();
    expect(within(panel).getByRole('button', { name: 'Download the certificate (PDF)' })).toBeInTheDocument();
  });

  it('a plain course: lessons left', () => {
    renderOnSide(<CertificatePanel course={detail()} />, { api: fakeLearner() });
    expect(screen.getByText('Finish 3 more lessons to get it')).toBeInTheDocument();
  });

  it('a course without a certificate: nothing', () => {
    const { container } = renderOnSide(<CertificatePanel course={detail({ certificateOn: false })} />, { api: fakeLearner() });
    expect(container.querySelector('[data-certificate-panel]')).toBeNull();
  });

  it('in the Client portal: the portal’s course page', () => {
    renderOnSide(<CertificatePanel course={detail({ id: 'pc1', mine: mine({ status: 'COMPLETED', progressPct: 100, certificate: certificate({ courseId: 'pc1' }) }) })} />, { api: fakeLearner(), portal: true });
    expect(screen.getByRole('link', { name: 'View the certificate' })).toHaveAttribute('href', '/portal/training/courses/pc1');
  });
});
