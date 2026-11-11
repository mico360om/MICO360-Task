import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CoursesTab } from './CoursesTab';
import { courseRow, fakeTrainingApi, manageCourse, type FakeTrainingApi } from './test-api';
import { renderManage } from './test-render';
import { ApiError } from '../../../lib/api-client';

let api: FakeTrainingApi;
const fake = vi.hoisted(() => ({ api: null as FakeTrainingApi | null }));
vi.mock('../../../api/training', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../api/training')>()),
  trainingApi: (await import('./test-api')).followFake(() => fake.api),
}));

const ROWS = [
  courseRow({ id: 'c1', title: 'Tasks basics', status: 'PUBLISHED', starter: true, lessonCount: 3, minutes: 25, enrolled: 10, completed: 4 }),
  courseRow({ id: 'c2', title: 'Meeting minutes', moduleKey: 'meetings', status: 'DRAFT', difficulty: 'INTERMEDIATE', lessonCount: 1, minutes: 90, enrolled: 0, completed: 0 }),
  courseRow({ id: 'c3', title: 'Old board', moduleKey: 'board', status: 'ARCHIVED', unpublishedChanges: false }),
  courseRow({ id: 'c4', title: 'Portal tour', moduleKey: 'portal', audience: 'CLIENTS', status: 'PUBLISHED', unpublishedChanges: true }),
];

beforeEach(() => {
  api = fake.api = fakeTrainingApi();
  api.courses.mockResolvedValue({ courses: ROWS });
});

describe('Training Center → Courses', () => {
  it('lists every course with its status, Starter badge, size, people and unpublished changes; each opens the editor', async () => {
    renderManage(<CoursesTab />);
    const list = await screen.findByRole('list', { name: 'Courses' });
    const tasks = within(list).getByRole('link', { name: 'Tasks basics' }).closest('li')!;
    expect(within(list).getByRole('link', { name: 'Tasks basics' })).toHaveAttribute('href', '/training/manage/courses/c1');
    expect(within(tasks).getByText('Published')).toBeInTheDocument();
    expect(within(tasks).getByText('Starter')).toBeInTheDocument();
    expect(within(tasks).getByText(/Tasks · Staff · Beginner · 3 lessons · 25 min/)).toBeInTheDocument();
    expect(within(tasks).getByText('10 enrolled · 4 completed')).toBeInTheDocument();
    const minutes = within(list).getByRole('link', { name: 'Meeting minutes' }).closest('li')!;
    expect(within(minutes).getByText('Draft')).toBeInTheDocument();
    expect(within(minutes).queryByText('Starter')).toBeNull();
    expect(within(minutes).getByText(/Meetings & minutes · Staff · Intermediate · 1 lesson · 1 h 30 min/)).toBeInTheDocument();
    expect(within(within(list).getByRole('link', { name: 'Old board' }).closest('li')!).getByText('Archived')).toBeInTheDocument();
    const portal = within(list).getByRole('link', { name: 'Portal tour' }).closest('li')!;
    expect(within(portal).getByText('Changes not published')).toBeInTheDocument();
    expect(within(portal).getByText(/Client portal · Clients/)).toBeInTheDocument();
  });

  it('filters by status and module on the server, and searches as you type', async () => {
    renderManage(<CoursesTab />);
    await screen.findByRole('list', { name: 'Courses' });
    expect(api.courses).toHaveBeenLastCalledWith({ status: '', module: '', q: '' });
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Status' }), 'DRAFT');
    await waitFor(() => expect(api.courses).toHaveBeenLastCalledWith({ status: 'DRAFT', module: '', q: '' }));
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Module' }), 'meetings');
    await waitFor(() => expect(api.courses).toHaveBeenLastCalledWith({ status: 'DRAFT', module: 'meetings', q: '' }));
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search courses' }), 'minutes');
    await waitFor(() => expect(api.courses).toHaveBeenLastCalledWith({ status: 'DRAFT', module: 'meetings', q: 'minutes' }));
  });

  it('nothing yet: says so and offers New course', async () => {
    api.courses.mockResolvedValue({ courses: [] });
    renderManage(<CoursesTab />);
    expect(await screen.findByText('No courses yet')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'New course' })).toHaveLength(1);
  });

  it('New course: title, module, audience and difficulty make a draft, and its editor opens', async () => {
    api.createCourse.mockResolvedValue(manageCourse({ id: 'c-new', title: 'Calendar tips' }));
    const { where } = renderManage(<CoursesTab />);
    await screen.findByRole('list', { name: 'Courses' });
    await userEvent.click(screen.getByRole('button', { name: 'New course' }));
    const dialog = screen.getByRole('dialog', { name: 'New course' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create draft' }));
    expect(within(dialog).getByText('Give the course a title.')).toBeInTheDocument();
    expect(api.createCourse).not.toHaveBeenCalled();
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Title' }), 'Calendar tips');
    await userEvent.selectOptions(within(dialog).getByRole('combobox', { name: 'Module' }), 'calendar');
    await userEvent.selectOptions(within(dialog).getByRole('combobox', { name: 'Difficulty' }), 'ADVANCED');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create draft' }));
    await waitFor(() => expect(api.createCourse).toHaveBeenCalledWith({ title: 'Calendar tips', moduleKey: 'calendar', audience: 'STAFF', difficulty: 'ADVANCED' }));
    await waitFor(() => expect(where.path).toBe('/training/manage/courses/c-new'));
  });

  it('New course: the Client portal module is for clients — Staff can’t be chosen', async () => {
    renderManage(<CoursesTab />);
    await screen.findByRole('list', { name: 'Courses' });
    await userEvent.click(screen.getByRole('button', { name: 'New course' }));
    const dialog = screen.getByRole('dialog', { name: 'New course' });
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Title' }), 'Portal basics');
    await userEvent.selectOptions(within(dialog).getByRole('combobox', { name: 'Module' }), 'portal');
    expect(within(dialog).getByRole('radio', { name: /Clients/ })).toBeChecked();
    expect(within(dialog).getByRole('radio', { name: /Staff/ })).toBeDisabled();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create draft' }));
    await waitFor(() => expect(api.createCourse).toHaveBeenCalledWith(expect.objectContaining({ moduleKey: 'portal', audience: 'CLIENTS' })));
  });

  it('New course: the server’s refusal is shown in its words and the window stays open', async () => {
    api.createCourse.mockRejectedValue(new ApiError(400, 'VALIDATION', 'Invalid input.', { fieldErrors: { title: ['Use at most 160 characters.'] }, formErrors: [] }));
    renderManage(<CoursesTab />);
    await screen.findByRole('list', { name: 'Courses' });
    await userEvent.click(screen.getByRole('button', { name: 'New course' }));
    const dialog = screen.getByRole('dialog', { name: 'New course' });
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Title' }), 'Too long');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create draft' }));
    expect(await within(dialog).findByText(/Use at most 160 characters\./)).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'New course' })).toBeInTheDocument();
  });
});
