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

describe('Learning Hub → Manage → Courses', () => {
  it('lists every course with its status, size, people taking it and unpublished changes (no Starter badge); each opens the editor', async () => {
    renderManage(<CoursesTab />);
    const list = await screen.findByRole('list', { name: 'Courses' });
    const tasks = within(list).getByRole('link', { name: 'Tasks basics' }).closest('li')!;
    expect(within(list).getByRole('link', { name: 'Tasks basics' })).toHaveAttribute('href', '/training/manage/courses/c1');
    expect(within(tasks).getByText('Published')).toBeInTheDocument();
    expect(within(tasks).queryByText('Starter')).toBeNull();
    expect(within(tasks).getByText(/Tasks · Staff · Beginner · 3 lessons · 25 min/)).toBeInTheDocument();
    expect(within(tasks).getByText('10 taking it · 4 finished')).toBeInTheDocument();
    const minutes = within(list).getByRole('link', { name: 'Meeting minutes' }).closest('li')!;
    expect(within(minutes).getByText('Draft')).toBeInTheDocument();
    expect(within(minutes).queryByText('Starter')).toBeNull();
    expect(within(minutes).getByText(/Meetings & minutes · Staff · Intermediate · 1 lesson · 1 h 30 min/)).toBeInTheDocument();
    // 1.23.33: archived courses are left out of the default list (as Projects' "All" leaves archived projects out).
    expect(within(list).queryByRole('link', { name: 'Old board' })).toBeNull();
    const portal = within(list).getByRole('link', { name: 'Portal tour' }).closest('li')!;
    expect(within(portal).getByText('Changes not published')).toBeInTheDocument();
    expect(within(portal).getByText(/Client portal · Clients/)).toBeInTheDocument();
  });

  it('1.23.33: archived courses are left out of the default list, one click away (“Show the 1 archived course”, or Status → Archived)', async () => {
    renderManage(<CoursesTab />);
    const list = await screen.findByRole('list', { name: 'Courses' });
    expect(within(list).getAllByRole('link').map((l) => l.textContent)).toEqual(['Tasks basics', 'Meeting minutes', 'Portal tour']);
    await userEvent.click(screen.getByRole('button', { name: 'Show the 1 archived course' }));
    await waitFor(() => expect(api.courses).toHaveBeenLastCalledWith({ status: 'ARCHIVED', module: '', q: '', audience: '' }));
    expect(screen.getByRole('combobox', { name: 'Status' })).toHaveValue('ARCHIVED');
    expect(within(await screen.findByRole('list', { name: 'Courses' })).getByRole('link', { name: 'Old board' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /archived course/ })).toBeNull();
  });

  it('1.23.33: after “Show the archived courses” the focus is on Status (it reads Archived, and is the way back)', async () => {
    renderManage(<CoursesTab />);
    await screen.findByRole('list', { name: 'Courses' });
    await userEvent.click(screen.getByRole('button', { name: 'Show the 1 archived course' }));
    expect(screen.getByRole('combobox', { name: 'Status' })).toHaveFocus();
  });

  it('1.23.33: no “Show the archived courses” under a load error (a failed reload keeps the old list’s data)', async () => {
    renderManage(<CoursesTab />);
    await screen.findByRole('list', { name: 'Courses' });
    api.courses.mockRejectedValue(new ApiError(500, 'INTERNAL', 'Server error'));
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Audience' }), 'STAFF');
    await screen.findByRole('button', { name: /Try again|Retry/ });
    expect(screen.queryByRole('button', { name: /archived course/ })).toBeNull();
  });

  it('1.23.33: when every course is archived, the default list says so and offers to show them (not “No courses yet”)', async () => {
    api.courses.mockResolvedValue({ courses: [courseRow({ id: 'a1', title: 'Old board', status: 'ARCHIVED' }), courseRow({ id: 'a2', title: 'Old chat', status: 'ARCHIVED' })] });
    renderManage(<CoursesTab />);
    expect(await screen.findByText('Every course is archived')).toBeInTheDocument();
    expect(screen.queryByText('No courses yet')).toBeNull();
    expect(screen.getByRole('button', { name: 'Show the 2 archived courses' })).toBeInTheDocument();
  });

  it('1.23.33: a search that matches only archived courses offers them (“No courses match” + Show the archived course)', async () => {
    renderManage(<CoursesTab />);
    await screen.findByRole('list', { name: 'Courses' });
    api.courses.mockResolvedValue({ courses: [courseRow({ id: 'c3', title: 'Old board', moduleKey: 'board', status: 'ARCHIVED' })] });
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search courses' }), 'old');
    expect(await screen.findByText('No courses match')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Show the 1 archived course' }));
    await waitFor(() => expect(api.courses).toHaveBeenLastCalledWith({ status: 'ARCHIVED', module: '', q: 'old', audience: '' }));
  });

  it('filters by status, audience and module on the server, and searches as you type', async () => {
    renderManage(<CoursesTab />);
    await screen.findByRole('list', { name: 'Courses' });
    expect(api.courses).toHaveBeenLastCalledWith({ status: '', module: '', q: '', audience: '' });
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Status' }), 'DRAFT');
    await waitFor(() => expect(api.courses).toHaveBeenLastCalledWith({ status: 'DRAFT', module: '', q: '', audience: '' }));
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Module' }), 'meetings');
    await waitFor(() => expect(api.courses).toHaveBeenLastCalledWith({ status: 'DRAFT', module: 'meetings', q: '', audience: '' }));
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search courses' }), 'minutes');
    await waitFor(() => expect(api.courses).toHaveBeenLastCalledWith({ status: 'DRAFT', module: 'meetings', q: 'minutes', audience: '' }));
  });

  it('the Audience filter: All, Staff or Clients (sent to the server)', async () => {
    renderManage(<CoursesTab />);
    await screen.findByRole('list', { name: 'Courses' });
    const audience = screen.getByRole('combobox', { name: 'Audience' });
    expect(within(audience).getAllByRole('option').map((o) => o.textContent)).toEqual(['All', 'Staff', 'Clients']);
    await userEvent.selectOptions(audience, 'CLIENTS');
    await waitFor(() => expect(api.courses).toHaveBeenLastCalledWith({ status: '', module: '', q: '', audience: 'CLIENTS' }));
    await userEvent.selectOptions(audience, 'STAFF');
    await waitFor(() => expect(api.courses).toHaveBeenLastCalledWith({ status: '', module: '', q: '', audience: 'STAFF' }));
    api.courses.mockResolvedValue({ courses: [] });
    await userEvent.selectOptions(audience, 'CLIENTS');
    expect(await screen.findByText('No courses match')).toBeInTheDocument();
  });

  it('the facts say who a course is limited to and how many modules it has; a notice is shown on its row', async () => {
    const notice = 'This built-in course was edited, so it wasn’t merged. Its assignments moved to MICO360 Tasks User Training. Archive it when you’re ready.';
    api.courses.mockResolvedValue({
      courses: [
        courseRow({ id: 'one', title: 'MICO360 Tasks User Training', moduleKey: 'general', starter: true, moduleCount: 10, lessonCount: 42, minutes: 180 }),
        courseRow({ id: 'rep', title: 'Reports for admins', moduleKey: 'reports', limitedTo: 'Admins only', lessonCount: 1, minutes: 10 }),
        courseRow({ id: 'edited', title: 'Kanban board basics', moduleKey: 'board', starter: true, notice }),
      ],
    });
    renderManage(<CoursesTab />);
    const list = await screen.findByRole('list', { name: 'Courses' });
    const row = (title: string) => within(list).getByRole('link', { name: title }).closest('li')!;
    expect(within(row('MICO360 Tasks User Training')).getByText('General · Staff · Beginner · 10 modules · 42 lessons · 3 h')).toBeInTheDocument();
    expect(within(row('Reports for admins')).getByText('Reports · Staff · Admins only · Beginner · 1 lesson · 10 min')).toBeInTheDocument();
    expect(within(row('Kanban board basics')).getByText(notice)).toBeInTheDocument();
    expect(within(row('Reports for admins')).queryByText(/wasn’t merged/)).toBeNull();
    // Every row has its ⋯ menu.
    for (const title of ['MICO360 Tasks User Training', 'Reports for admins', 'Kanban board basics']) {
      expect(within(row(title)).getByRole('button', { name: `More for ${title}` })).toHaveAttribute('aria-haspopup', 'menu');
    }
  });

  it('13 Nov new look: each course’s icon beside its facts — the one course the brand mark, a feature’s course its menu icon, another General course the book', async () => {
    api.courses.mockResolvedValue({
      courses: [
        courseRow({ id: 'one', title: 'MICO360 Tasks User Training', moduleKey: 'general', starter: true, moduleCount: 10 }),
        courseRow({ id: 'c2', title: 'Meeting minutes', moduleKey: 'meetings' }),
        courseRow({ id: 'acme', title: 'Acme site induction', moduleKey: 'general', starter: false }),
      ],
    });
    renderManage(<CoursesTab />);
    const list = await screen.findByRole('list', { name: 'Courses' });
    const icon = (title: string) => within(list).getByRole('link', { name: title }).closest('li')!.querySelector('[data-course-facts] svg[data-module-icon]');
    expect(icon('MICO360 Tasks User Training')).toHaveAttribute('data-module-icon', 'general');
    expect(icon('MICO360 Tasks User Training')!.querySelector('svg[aria-label="MICO360 Tasks"]')).not.toBeNull();
    expect(icon('Meeting minutes')).toHaveAttribute('data-module-icon', 'meetings');
    expect(icon('Acme site induction')).toHaveAttribute('data-module-icon', 'book');
    // Decorative: the facts say the module in words; the layout is as before.
    expect(icon('Meeting minutes')).toHaveAttribute('aria-hidden', 'true');
    expect(within(list).getByRole('link', { name: 'Meeting minutes' }).closest('li')!.querySelector('[data-course-facts]')).toHaveTextContent(/^Meetings & minutes · Staff/);
  });

  it('13 Nov new look: the Module filter shows the chosen module’s icon (none for All modules)', async () => {
    renderManage(<CoursesTab />);
    await screen.findByRole('list', { name: 'Courses' });
    const filter = screen.getByRole('combobox', { name: 'Module' });
    const shown = () => filter.parentElement!.querySelector('svg[data-module-icon]');
    expect(shown()).toBeNull();
    await userEvent.selectOptions(filter, 'meetings');
    expect(shown()).toHaveAttribute('data-module-icon', 'meetings');
    expect(shown()).toHaveAttribute('aria-hidden', 'true');
    await userEvent.selectOptions(filter, 'general');
    expect(shown()).toHaveAttribute('data-module-icon', 'book');
    await userEvent.selectOptions(filter, '');
    expect(shown()).toBeNull();
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
