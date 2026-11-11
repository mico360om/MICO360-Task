import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
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

describe('Training Center: who sees which tabs', () => {
  it('is the page’s default export too (the route loads either)', () => {
    expect(TrainingCenterDefault).toBe(TrainingCenterPage);
  });

  it('a Training manager: every tab but Settings, Courses first', async () => {
    api.access.mockResolvedValue(access({ manager: true, admin: false }));
    renderManage(<TrainingCenterPage />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Training Center' })).toBeInTheDocument();
    await screen.findByRole('tablist', { name: 'Training Center' });
    expect(tabNames()).toEqual(['Courses', 'Assignments', 'Onboarding rules', 'Feedback', 'Certificates', 'Reports']);
    expect(screen.getByRole('tab', { name: 'Courses' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel', { name: 'Courses' })).toBeInTheDocument();
  });

  it('an administrator also gets Settings', async () => {
    api.access.mockResolvedValue(access({ manager: true, admin: true }));
    renderManage(<TrainingCenterPage />);
    await screen.findByRole('tablist', { name: 'Training Center' });
    expect(tabNames()).toEqual(['Courses', 'Assignments', 'Onboarding rules', 'Feedback', 'Certificates', 'Reports', 'Settings']);
  });

  it('the open tab is in the address (?tab=), and an unknown or forbidden one opens Courses', async () => {
    api.access.mockResolvedValue(access({ manager: true, admin: false }));
    const { where } = renderManage(<TrainingCenterPage />, { path: '/training/manage?tab=settings' });
    await screen.findByRole('tablist', { name: 'Training Center' });
    expect(screen.getByRole('tab', { name: 'Courses' })).toHaveAttribute('aria-selected', 'true');
    await userEvent.click(screen.getByRole('tab', { name: 'Feedback' }));
    expect(where.path).toBe('/training/manage?tab=feedback');
    expect(screen.getByRole('tab', { name: 'Feedback' })).toHaveAttribute('aria-selected', 'true');
  });

  it('arrow keys, Home and End move along the tabs (one Tab stop)', async () => {
    api.access.mockResolvedValue(access({ manager: true, admin: true }));
    renderManage(<TrainingCenterPage />, { path: '/training/manage?tab=reports' });
    const reports = await screen.findByRole('tab', { name: 'Reports' });
    expect(reports).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('tab', { name: 'Courses' })).toHaveAttribute('tabindex', '-1');
    reports.focus();
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

  it('a project manager (team reports only): Reports alone, read-only, for “Your team” — no tabs, no course tools', async () => {
    api.access.mockResolvedValue(access({ manager: false, admin: false, teamReports: true }));
    api.report.mockResolvedValue(report({ scope: 'TEAM' }));
    renderManage(<TrainingCenterPage />, { path: '/training/manage?tab=courses' });
    expect(await screen.findByRole('heading', { level: 1, name: 'Training Center' })).toBeInTheDocument();
    expect(await screen.findByText('Your team')).toBeInTheDocument();
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.queryByRole('button', { name: 'New course' })).toBeNull();
    expect(api.courses).not.toHaveBeenCalled();
    expect(api.options).not.toHaveBeenCalled();
    expect(screen.getByRole('region', { name: 'Training reports' })).toBeInTheDocument();
  });

  it('anyone else: a plain page that says who it is for, with a way to their own training', async () => {
    api.access.mockResolvedValue(access({ manager: false, admin: false, teamReports: false }));
    renderManage(<TrainingCenterPage />);
    expect(await screen.findByText(/Only Training managers and administrators/)).toBeInTheDocument();
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.getByRole('link', { name: 'Go to My training' })).toHaveAttribute('href', '/training');
    expect(api.report).not.toHaveBeenCalled();
  });

  it('when access can’t be read: says so, with Retry', async () => {
    api.access.mockRejectedValue(new TypeError('offline'));
    renderManage(<TrainingCenterPage />);
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });
});
