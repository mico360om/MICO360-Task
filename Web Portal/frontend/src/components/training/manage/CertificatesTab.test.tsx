import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CertificatesTab } from './CertificatesTab';
import { certificateRow, courseRow, fakeTrainingApi, type FakeTrainingApi } from './test-api';
import { renderManage } from './test-render';

let api: FakeTrainingApi;
const fake = vi.hoisted(() => ({ api: null as FakeTrainingApi | null }));
vi.mock('../../../api/training', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../api/training')>()),
  trainingApi: (await import('./test-api')).followFake(() => fake.api),
}));
const downloads = vi.hoisted(() => ({ calls: [] as [string, Blob][] }));
vi.mock('../../../lib/download', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../../lib/download')>();
  return { ...real, downloadBlob: (name: string, blob: Blob) => downloads.calls.push([name, blob]) };
});

const ROWS = [
  certificateRow({ id: 'cert1', learnerName: 'Sam Shared', code: 'TC-AAAA-BBBB-CCCC', expiresAt: '2027-11-03T08:00:00.000Z' }),
  certificateRow({ id: 'cert2', learnerName: 'Omar Ahmed', code: 'TC-DDDD-EEEE-FFFF', status: 'REVOKED' }),
  certificateRow({ id: 'cert3', learnerName: 'Lina Lee', code: 'TC-GGGG-HHHH-JJJJ', status: 'EXPIRED', expiresAt: '2026-10-01T08:00:00.000Z' }),
];

beforeEach(() => {
  api = fake.api = fakeTrainingApi();
  downloads.calls = [];
  api.courses.mockResolvedValue({ courses: [courseRow({ id: 'c1', title: 'Tasks basics' }), courseRow({ id: 'c2', title: 'Meetings basics' })] });
  api.certificates.mockResolvedValue({ certificates: ROWS });
});

const rowOf = async (name: string) => (await screen.findByText(name, { selector: 'li *' })).closest('li')!;

describe('Training Center → Certificates', () => {
  it('lists each certificate: learner, course, code, issued, expiry and status; revoked ones can’t be revoked again', async () => {
    renderManage(<CertificatesTab />);
    const sam = await rowOf('Sam Shared');
    expect(within(sam).getByText('Tasks basics')).toBeInTheDocument();
    expect(within(sam).getByText('TC-AAAA-BBBB-CCCC')).toBeInTheDocument();
    expect(within(sam).getByText(/Issued 3 Nov/)).toBeInTheDocument();
    expect(within(sam).getByText('Completed 3 Nov')).toBeInTheDocument();
    expect(within(sam).getByText(/Expires 3 Nov 2027/)).toBeInTheDocument();
    expect(within(sam).getByText('Valid')).toBeInTheDocument();
    expect(within(sam).getByRole('button', { name: 'Revoke' })).toBeInTheDocument();
    const omar = await rowOf('Omar Ahmed');
    expect(within(omar).getByText('Revoked')).toBeInTheDocument();
    expect(within(omar).getByText(/Never expires/)).toBeInTheDocument();
    expect(within(omar).queryByRole('button', { name: 'Revoke' })).toBeNull();
    expect(within(await rowOf('Lina Lee')).getByText('Expired')).toBeInTheDocument();
  });

  it('searches by name, code or course, and filters by course', async () => {
    renderManage(<CertificatesTab />);
    await rowOf('Sam Shared');
    expect(api.certificates).toHaveBeenLastCalledWith({ courseId: '', q: '' });
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Course' }), 'c2');
    await waitFor(() => expect(api.certificates).toHaveBeenLastCalledWith({ courseId: 'c2', q: '' }));
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search certificates' }), 'TC-AAAA');
    await waitFor(() => expect(api.certificates).toHaveBeenLastCalledWith({ courseId: 'c2', q: 'TC-AAAA' }));
  });

  it('Revoke needs a reason (at most 200 characters), then the certificate is revoked', async () => {
    renderManage(<CertificatesTab />);
    const sam = await rowOf('Sam Shared');
    await userEvent.click(within(sam).getByRole('button', { name: 'Revoke' }));
    const dialog = screen.getByRole('dialog', { name: 'Revoke the certificate?' });
    expect(dialog).toHaveTextContent('Sam Shared');
    expect(dialog).toHaveTextContent('TC-AAAA-BBBB-CCCC');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Revoke certificate' }));
    expect(within(dialog).getByText('Say why it is revoked.')).toBeInTheDocument();
    expect(api.revoke).not.toHaveBeenCalled();
    const reason = within(dialog).getByRole('textbox', { name: 'Reason' });
    expect(reason).toHaveAttribute('maxLength', '200');
    await userEvent.type(reason, 'Issued to the wrong person');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Revoke certificate' }));
    await waitFor(() => expect(api.revoke).toHaveBeenCalledWith('cert1', 'Issued to the wrong person'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(api.certificates.mock.calls.length).toBeGreaterThan(1);
  });

  it('downloads a certificate’s PDF under the server’s name', async () => {
    api.certificatePdf.mockResolvedValue(new File(['%PDF'], 'certificate-TC-AAAA.pdf', { type: 'application/pdf' }));
    renderManage(<CertificatesTab />);
    const sam = await rowOf('Sam Shared');
    await userEvent.click(within(sam).getByRole('button', { name: 'PDF' }));
    await waitFor(() => expect(downloads.calls.map(([n]) => n)).toEqual(['certificate-TC-AAAA.pdf']));
    expect(api.certificatePdf).toHaveBeenCalledWith('cert1');
  });
});
