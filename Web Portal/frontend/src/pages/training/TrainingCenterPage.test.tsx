import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TrainingCenterDefault, { TrainingCenterPage } from './TrainingCenterPage';
import { access, fakeTrainingApi, report, type FakeTrainingApi } from '../../components/training/manage/test-api';
import { renderManage } from '../../components/training/manage/test-render';

let api: FakeTrainingApi;
const fake = vi.hoisted(() => ({ api: null as FakeTrainingApi | null }));
vi.mock('../../api/training', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/training')>()),
  trainingApi: (await import('../../components/training/manage/test-api')).followFake(() => fake.api),
}));

beforeEach(() => {
  api = fake.api = fakeTrainingApi();
});

const tabNames = () => screen.getAllByRole('tab').map((t) => t.textContent);
const hub = () => screen.getByRole('navigation', { name: 'Learning Hub' });
const hubCurrent = () => within(hub()).getAllByRole('link').find((l) => l.getAttribute('aria-current') === 'page')?.textContent;

describe('Learning Hub → Manage and Reports: who sees what', () => {
  it('is the page’s default export too (the route loads either)', () => {
    expect(TrainingCenterDefault).toBe(TrainingCenterPage);
  });

  it('a Training manager: the Learning Hub with Manage open — its sections, Courses first (Reports is its own top tab)', async () => {
    api.access.mockResolvedValue(access({ manager: true, admin: false }));
    renderManage(<TrainingCenterPage />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Learning Hub' })).toBeInTheDocument();
    await screen.findByRole('tablist', { name: 'Manage' });
    await waitFor(() => expect(within(hub()).getAllByRole('link').map((l) => l.textContent)).toEqual(['My learning', 'Catalogue', 'Manage', 'Reports']));
    expect(hubCurrent()).toBe('Manage');
    expect(tabNames()).toEqual(['Courses', 'Assignments', 'Onboarding rules', 'Feedback', 'Certificates']);
    expect(screen.getByRole('tab', { name: 'Courses' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel', { name: 'Courses' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Training Center/ })).toBeNull();
  });

  it('an administrator also gets Settings', async () => {
    api.access.mockResolvedValue(access({ manager: true, admin: true }));
    renderManage(<TrainingCenterPage />);
    await screen.findByRole('tablist', { name: 'Manage' });
    expect(tabNames()).toEqual(['Courses', 'Assignments', 'Onboarding rules', 'Feedback', 'Certificates', 'Settings']);
  });

  it('the open section is in the address (?tab=), and an unknown or forbidden one opens Courses', async () => {
    api.access.mockResolvedValue(access({ manager: true, admin: false }));
    const { where } = renderManage(<TrainingCenterPage />, { path: '/training/manage?tab=settings' });
    await screen.findByRole('tablist', { name: 'Manage' });
    expect(screen.getByRole('tab', { name: 'Courses' })).toHaveAttribute('aria-selected', 'true');
    await userEvent.click(screen.getByRole('tab', { name: 'Feedback' }));
    expect(where.path).toBe('/training/manage?tab=feedback');
    expect(screen.getByRole('tab', { name: 'Feedback' })).toHaveAttribute('aria-selected', 'true');
    expect(hubCurrent()).toBe('Manage');
  });

  it('arrow keys, Home and End move along Manage’s sections (one Tab stop)', async () => {
    api.access.mockResolvedValue(access({ manager: true, admin: true }));
    renderManage(<TrainingCenterPage />, { path: '/training/manage?tab=certificates' });
    const certificates = await screen.findByRole('tab', { name: 'Certificates' });
    expect(certificates).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('tab', { name: 'Courses' })).toHaveAttribute('tabindex', '-1');
    certificates.focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Settings' })).toHaveFocus();
    expect(screen.getByRole('tab', { name: 'Settings' })).toHaveAttribute('aria-selected', 'true');
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Courses' })).toHaveFocus();
    await userEvent.keyboard('{End}');
    expect(screen.getByRole('tab', { name: 'Settings' })).toHaveFocus();
    await userEvent.keyboard('{Home}');
    expect(screen.getByRole('tab', { name: 'Courses' })).toHaveFocus();
  });

  it('Reports (?tab=reports): the top tab Reports, the full reports, without Manage’s sections', async () => {
    api.access.mockResolvedValue(access({ manager: true, admin: true }));
    renderManage(<TrainingCenterPage />, { path: '/training/manage?tab=reports' });
    expect(await screen.findByRole('region', { name: 'Training reports' })).toBeInTheDocument();
    await waitFor(() => expect(hubCurrent()).toBe('Reports'));
    expect(screen.queryByRole('tablist', { name: 'Manage' })).toBeNull();
  });

  it('a project manager (team reports only): Reports alone, read-only, for “Your team” — no Manage, no course tools', async () => {
    api.access.mockResolvedValue(access({ manager: false, admin: false, teamReports: true }));
    api.report.mockResolvedValue(report({ scope: 'TEAM' }));
    renderManage(<TrainingCenterPage />, { path: '/training/manage?tab=courses' });
    expect(await screen.findByRole('heading', { level: 1, name: 'Learning Hub' })).toBeInTheDocument();
    expect(await screen.findByText('Your team')).toBeInTheDocument();
    await waitFor(() => expect(within(hub()).getAllByRole('link').map((l) => l.textContent)).toEqual(['My learning', 'Catalogue', 'Reports']));
    expect(hubCurrent()).toBe('Reports');
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.queryByRole('button', { name: 'New course' })).toBeNull();
    expect(api.courses).not.toHaveBeenCalled();
    expect(api.options).not.toHaveBeenCalled();
    expect(screen.getByRole('region', { name: 'Training reports' })).toBeInTheDocument();
  });

  it('anyone else: a plain page that says who it is for, with a way to their own learning', async () => {
    api.access.mockResolvedValue(access({ manager: false, admin: false, teamReports: false }));
    renderManage(<TrainingCenterPage />);
    expect(await screen.findByText('Only Training managers and administrators can manage the Learning Hub')).toBeInTheDocument();
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.getByRole('link', { name: 'Go to My learning' })).toHaveAttribute('href', '/training');
    expect(api.report).not.toHaveBeenCalled();
  });

  it('when access can’t be read: says so, with Retry', async () => {
    api.access.mockRejectedValue(new TypeError('offline'));
    renderManage(<TrainingCenterPage />);
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });
});
