import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReportsTab } from './ReportsTab';
import { courseRow, fakeTrainingApi, report, reportRow, type FakeTrainingApi } from './test-api';
import { renderManage } from './test-render';
import { windowWidth } from '../../../test/window-width';

let api: FakeTrainingApi;
const fake = vi.hoisted(() => ({ api: null as FakeTrainingApi | null }));
vi.mock('../../../api/training', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../api/training')>()),
  trainingApi: (await import('./test-api')).followFake(() => fake.api),
}));
const downloads = vi.hoisted(() => ({ calls: [] as string[] }));
vi.mock('../../../lib/download', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../../lib/download')>();
  return { ...real, downloadBlob: (name: string) => downloads.calls.push(name) };
});

beforeEach(() => {
  api = fake.api = fakeTrainingApi();
  downloads.calls = [];
  api.courses.mockResolvedValue({ courses: [courseRow({ id: 'c1', title: 'Tasks basics' }), courseRow({ id: 'c2', title: 'Meetings basics' })] });
  api.report.mockResolvedValue(report());
});
afterEach(() => vi.unstubAllGlobals());

describe('Training Center → Reports', () => {
  it('totals, the rows by course, overdue people, certificates expiring and quiz results — for everyone (administrator)', async () => {
    renderManage(<ReportsTab />);
    const region = await screen.findByRole('region', { name: 'Training reports' });
    expect(await within(region).findByText('All people')).toBeInTheDocument();
    const totals = within(region).getByRole('group', { name: 'Totals' });
    expect(within(totals).getByText('People').closest('.card')).toHaveTextContent('10');
    expect(within(totals).getByText('Completed').closest('.card')).toHaveTextContent('40%');
    expect(within(totals).getByText('Overdue').closest('.card')).toHaveTextContent('1');
    expect(within(totals).getByText('Certificates expiring').closest('.card')).toHaveTextContent('1');

    const table = within(region).getByRole('table', { name: 'By course' });
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Course', 'People', 'Assigned', 'Started', 'Completed', 'Overdue', 'Completion rate', 'Average score']);
    expect(within(table).getAllByRole('row')[1]).toHaveTextContent(/Tasks basics.*10.*8.*6.*4.*1.*40%.*82%/);

    const overdue = within(region).getByRole('region', { name: 'Overdue' });
    const sam = within(overdue).getByText('Sam Shared').closest('li')!;
    expect(sam).toHaveTextContent('Tasks basics');
    expect(sam).toHaveTextContent(/Due 1 Nov · 4 days late/);
    expect(within(sam).getByText('Mandatory')).toBeInTheDocument();

    const expiring = within(region).getByRole('region', { name: 'Certificates expiring in 30 days' });
    expect(within(expiring).getByText('Sam Shared').closest('li')).toHaveTextContent(/Tasks basics.*Expires 30 Nov/);

    const quizzes = within(region).getByRole('region', { name: 'Quiz results' });
    expect(within(quizzes).getByText('Check yourself').closest('li')).toHaveTextContent(/9 attempts · 78% passed · average 81%/);
  });

  it('a quiz nobody has handed in yet says so', async () => {
    api.report.mockResolvedValue(report({ quizzes: [{ lessonId: 'l-new', courseTitle: 'Tasks basics', title: 'New quiz', attempts: 0, passRate: null, averageScore: null }] }));
    renderManage(<ReportsTab />);
    const quizzes = await screen.findByRole('region', { name: 'Quiz results' });
    expect(within(quizzes).getByText('New quiz').closest('li')).toHaveTextContent('No attempts yet');
  });

  it('group by, course and period are sent to the server', async () => {
    renderManage(<ReportsTab />);
    await screen.findByRole('table', { name: 'By course' });
    expect(api.report).toHaveBeenLastCalledWith({ by: 'course' });
    api.report.mockResolvedValue(report({ by: 'department', rows: [reportRow({ key: 'd-ops', label: 'Operations' })] }));
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Group by' }), 'department');
    await waitFor(() => expect(api.report).toHaveBeenLastCalledWith({ by: 'department' }));
    expect(await screen.findByRole('table', { name: 'By department' })).toHaveTextContent('Operations');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Course' }), 'c2');
    await waitFor(() => expect(api.report).toHaveBeenLastCalledWith({ by: 'department', courseId: 'c2' }));
    await userEvent.type(screen.getByLabelText('From'), '2026-10-01');
    await userEvent.type(screen.getByLabelText('To'), '2026-10-31');
    await waitFor(() => expect(api.report).toHaveBeenLastCalledWith({ by: 'department', courseId: 'c2', from: '2026-10-01', to: '2026-10-31' }));
  });

  it('a period that ends before it starts is said, not asked for', async () => {
    renderManage(<ReportsTab />);
    await screen.findByRole('table', { name: 'By course' });
    await userEvent.type(screen.getByLabelText('From'), '2026-10-31');
    await userEvent.type(screen.getByLabelText('To'), '2026-10-01');
    expect(await screen.findByText('The period ends before it starts.')).toBeInTheDocument();
    expect(api.report).not.toHaveBeenCalledWith(expect.objectContaining({ from: '2026-10-31', to: '2026-10-01' }));
  });

  it('Excel and PDF: the same report as a file, under the server’s name', async () => {
    api.reportFile.mockImplementation(async (_q, format) => new File(['x'], `training-report-by-course.${format}`));
    renderManage(<ReportsTab />);
    await screen.findByRole('table', { name: 'By course' });
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Course' }), 'c1');
    await userEvent.click(screen.getByRole('button', { name: 'Excel' }));
    await waitFor(() => expect(api.reportFile).toHaveBeenLastCalledWith({ by: 'course', courseId: 'c1' }, 'xlsx'));
    await userEvent.click(screen.getByRole('button', { name: 'PDF' }));
    await waitFor(() => expect(api.reportFile).toHaveBeenLastCalledWith({ by: 'course', courseId: 'c1' }, 'pdf'));
    await waitFor(() => expect(downloads.calls).toEqual(['training-report-by-course.xlsx', 'training-report-by-course.pdf']));
  });

  it('a quiz’s questions: how many got each one right', async () => {
    renderManage(<ReportsTab />);
    const quizzes = await screen.findByRole('region', { name: 'Quiz results' });
    await userEvent.click(within(quizzes).getByRole('button', { name: 'Questions in “Check yourself”' }));
    const dialog = await screen.findByRole('dialog', { name: 'Check yourself' });
    expect(api.quizReport).toHaveBeenCalledWith('l-quiz');
    expect(await within(dialog).findByText('Where do new tasks go?')).toBeInTheDocument();
    expect(within(dialog).getByText('Where do new tasks go?').closest('li')).toHaveTextContent(/89% right · 9 answers/);
    expect(within(dialog).getByText('Who can delete a task?').closest('li')).toHaveTextContent(/33% right/);
    expect(within(dialog).getByText(/9 attempts by 7 people/)).toBeInTheDocument();
  });

  it('on a phone each row is a card (no wide table)', async () => {
    windowWidth(375);
    renderManage(<ReportsTab />);
    const list = await screen.findByRole('list', { name: 'By course' });
    expect(screen.queryByRole('table')).toBeNull();
    const card = within(list).getByRole('listitem');
    expect(within(card).getByText('Tasks basics')).toBeInTheDocument();
    expect(within(card).getByText('Completion rate').nextElementSibling).toHaveTextContent('40%');
  });

  it('a project manager (read-only): “Your team”, courses from their own report, never the manage calls', async () => {
    api.report.mockResolvedValue(report({ scope: 'TEAM', rows: [reportRow({ key: 'c1', label: 'Tasks basics' }), reportRow({ key: 'c9', label: 'Team course' })] }));
    renderManage(<ReportsTab readOnly />);
    expect(await screen.findByText('Your team')).toBeInTheDocument();
    await waitFor(() => expect(within(screen.getByRole('combobox', { name: 'Course' })).getAllByRole('option').map((o) => o.textContent)).toEqual(['All courses', 'Tasks basics', 'Team course']));
    expect(api.courses).not.toHaveBeenCalled();
  });

  it('a Training manager’s scope: “Your companies”', async () => {
    api.report.mockResolvedValue(report({ scope: 'COMPANIES' }));
    renderManage(<ReportsTab />);
    expect(await screen.findByText('Your companies')).toBeInTheDocument();
  });
});
