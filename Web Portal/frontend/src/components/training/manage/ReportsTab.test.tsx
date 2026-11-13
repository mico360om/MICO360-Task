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
    expect(within(totals).getByText('Completion').closest('.card')).toHaveTextContent('40%');
    expect(within(totals).getByText('Completion').closest('.card')).toHaveTextContent('4 of 10 enrolments');
    expect(within(totals).getByText('Overdue').closest('.card')).toHaveTextContent('1');
    expect(within(totals).getByText('Certificates expiring').closest('.card')).toHaveTextContent('1');

    const table = within(region).getByRole('table', { name: 'By course' });
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Course', 'People', 'Assigned', 'Started themselves', 'Started', 'Completed', 'Overdue', 'Completion rate', 'Average score']);
    expect(within(table).getAllByRole('row')[1]).toHaveTextContent(/Tasks basics.*10.*8.*2.*6.*4.*1.*40%.*82%/);

    const overdue = within(region).getByRole('region', { name: 'Overdue' });
    const sam = within(overdue).getByText('Sam Shared').closest('li')!;
    expect(sam).toHaveTextContent('Tasks basics');
    expect(sam).toHaveTextContent(/Due 1 Nov · 4 days late/);
    expect(within(sam).getByText('Mandatory')).toBeInTheDocument();

    const expiring = within(region).getByRole('region', { name: 'Certificates expiring in 30 days' });
    expect(within(expiring).getByText('Sam Shared').closest('li')).toHaveTextContent(/Tasks basics.*Expires 30 Nov/);

    const quizzes = within(region).getByRole('region', { name: 'Quiz results' });
    const qt = within(quizzes).getByRole('table', { name: 'Quiz results' });
    expect(within(qt).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Quiz', 'Course / module', 'Attempts', 'People', 'Pass rate', 'Average', 'Questions', 'Details']);
    expect(within(qt).getByText('Check yourself').closest('tr')).toHaveTextContent(/Tasks basics.*9.*9.*78%.*81%.*4/);
  });

  it('quizzes nobody has handed in are hidden behind “Show all quizzes”; with none handed in, it says so', async () => {
    const fresh = { lessonId: 'l-new', courseTitle: 'Tasks basics', title: 'New quiz', attempts: 0, passRate: null, averageScore: null, people: 0, moduleTitle: 'Tasks', questions: 3 };
    api.report.mockResolvedValue(report({ quizzes: [fresh, report().quizzes[0]!] }));
    const view = renderManage(<ReportsTab />);
    let quizzes = await screen.findByRole('region', { name: 'Quiz results' });
    expect(within(quizzes).queryByText('New quiz')).toBeNull();
    expect(within(quizzes).getByText('Check yourself')).toBeInTheDocument();
    await userEvent.click(within(quizzes).getByRole('button', { name: 'Show all quizzes' }));
    const row = within(quizzes).getByText('New quiz').closest('tr')!;
    expect(row).toHaveTextContent('Tasks basics · Tasks');
    expect(row).toHaveTextContent(/0.*0.*—.*—.*3/);
    await userEvent.click(within(quizzes).getByRole('button', { name: 'Hide quizzes nobody has taken' }));
    expect(within(quizzes).queryByText('New quiz')).toBeNull();
    view.unmount();
    api.report.mockResolvedValue(report({ quizzes: [fresh] }));
    renderManage(<ReportsTab />);
    quizzes = await screen.findByRole('region', { name: 'Quiz results' });
    expect(within(quizzes).queryByText('New quiz')).toBeNull();
    expect(within(quizzes).getByText('No quiz was handed in.')).toBeInTheDocument();
    expect(within(quizzes).getByRole('button', { name: 'Show all quizzes' })).toBeInTheDocument();
  });

  it('“Dates by”: Got the course (default) or Finished the course, sent to the server and shown in the note', async () => {
    renderManage(<ReportsTab />);
    await screen.findByRole('table', { name: 'By course' });
    const dates = screen.getByRole('combobox', { name: 'Dates by' });
    expect(within(dates).getAllByRole('option').map((o) => o.textContent)).toEqual(['Got the course', 'Finished the course']);
    expect(screen.getByText(/days people got the course/)).toBeInTheDocument();
    await userEvent.selectOptions(dates, 'finished');
    await waitFor(() => expect(api.report).toHaveBeenLastCalledWith({ by: 'course', dates: 'finished' }));
    expect(screen.getByText(/days people finished the course/)).toBeInTheDocument();
    api.reportFile.mockResolvedValue(new File(['x'], 'r.xlsx'));
    await userEvent.click(screen.getByRole('button', { name: 'Excel' }));
    await waitFor(() => expect(api.reportFile).toHaveBeenLastCalledWith({ by: 'course', dates: 'finished' }, 'xlsx'));
  });

  it('a course with modules: “By module” and “By person” tables; the certificate code downloads its PDF', async () => {
    api.certificatePdf.mockResolvedValue(new File(['%PDF'], 'cert.pdf'));
    api.report.mockResolvedValue(
      report({
        modules: [
          { moduleId: 'm1', title: 'Getting started', people: 5, done: 3, inProgress: 1, notStarted: 1 },
          { moduleId: 'm2', title: 'Tasks', people: 5, done: 2, inProgress: 2, notStarted: 1 },
        ],
        learners: [
          { userId: 'u-sam', name: 'Sam Shared', modulesDone: 2, modulesRequired: 8, lastActivityAt: '2026-11-10T08:00:00.000Z', certificate: null },
          { userId: 'u-omar', name: 'Omar Ahmed', modulesDone: 8, modulesRequired: 8, lastActivityAt: null, certificate: { id: 'cert9', code: 'TC-AAAA-BBBB-CCCC' } },
        ],
      }),
    );
    renderManage(<ReportsTab />);
    const byModule = await screen.findByRole('table', { name: 'By module' });
    expect(within(byModule).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Module', 'People', 'Done', 'In progress', 'Not started']);
    expect(within(byModule).getByText('Getting started').closest('tr')).toHaveTextContent(/5.*3.*1.*1/);
    const byPerson = screen.getByRole('table', { name: 'By person' });
    expect(within(byPerson).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Person', 'Modules done', 'Last activity', 'Certificate']);
    expect(within(byPerson).getByText('Sam Shared').closest('tr')).toHaveTextContent(/2 of 8/);
    await userEvent.click(within(byPerson).getByRole('button', { name: 'Certificate TC-AAAA-BBBB-CCCC (PDF)' }));
    await waitFor(() => expect(api.certificatePdf).toHaveBeenCalledWith('cert9'));
    await waitFor(() => expect(downloads.calls).toEqual(['cert.pdf']));
  });

  it('13 Nov new look: each “By module” row has its module’s icon beside the name (Getting started the brand mark; a module of no feature the book)', async () => {
    api.report.mockResolvedValue(
      report({
        modules: [
          { moduleId: 'm1', title: 'Getting started', people: 5, done: 3, inProgress: 1, notStarted: 1 },
          { moduleId: 'm2', title: 'Meetings & minutes', people: 5, done: 2, inProgress: 2, notStarted: 1 },
          { moduleId: 'm3', title: 'Safety at Acme', people: 5, done: 0, inProgress: 0, notStarted: 5 },
        ],
        learners: [],
      }),
    );
    renderManage(<ReportsTab />);
    const byModule = await screen.findByRole('table', { name: 'By module' });
    const icon = (title: string) => within(byModule).getByRole('rowheader', { name: title }).querySelector('svg[data-module-icon]');
    expect(icon('Getting started')).toHaveAttribute('data-module-icon', 'general');
    expect(icon('Meetings & minutes')).toHaveAttribute('data-module-icon', 'meetings');
    expect(icon('Safety at Acme')).toHaveAttribute('data-module-icon', 'book');
    expect(icon('Meetings & minutes')).toHaveAttribute('aria-hidden', 'true');
    // The table as before: the numbers in their columns.
    expect(within(byModule).getByRole('rowheader', { name: 'Meetings & minutes' }).closest('tr')).toHaveTextContent(/5.*2.*2.*1/);
  });

  it('each wide table sits in a focusable, uniquely named scroll region (keyboard scrolling)', async () => {
    api.report.mockResolvedValue(
      report({
        modules: [{ moduleId: 'm1', title: 'Tasks', people: 5, done: 2, inProgress: 2, notStarted: 1 }],
        learners: [{ userId: 'u-sam', name: 'Sam Shared', modulesDone: 2, modulesRequired: 8, lastActivityAt: null, certificate: null }],
      }),
    );
    renderManage(<ReportsTab />);
    await screen.findByRole('table', { name: 'By module' });
    for (const name of ['By module table', 'By person table', 'Quiz results table']) {
      const region = screen.getByRole('region', { name });
      expect(region).toHaveAttribute('tabindex', '0');
      expect(region.className).toContain('focus-visible:ring-2');
      expect(region.querySelector('table')).not.toBeNull();
    }
  });

  it('with no modules in the report, there are no module tables', async () => {
    renderManage(<ReportsTab />);
    await screen.findByRole('table', { name: 'By course' });
    expect(screen.queryByRole('table', { name: 'By module' })).toBeNull();
    expect(screen.queryByRole('table', { name: 'By person' })).toBeNull();
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
    expect(within(card).getByText('Started themselves').nextElementSibling).toHaveTextContent('2');
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
