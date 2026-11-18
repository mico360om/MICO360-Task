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
  courseRow({ id: 'pub', title: 'Tasks basics', status: 'PUBLISHED' }),
  courseRow({ id: 'changed', title: 'Board basics', moduleKey: 'board', status: 'PUBLISHED', unpublishedChanges: true }),
  courseRow({ id: 'new', title: 'Meeting minutes', moduleKey: 'meetings', status: 'DRAFT', everPublished: false, enrolled: 0, completed: 0 }),
  courseRow({ id: 'back', title: 'Calendar tips', moduleKey: 'calendar', status: 'DRAFT', everPublished: true }),
  courseRow({ id: 'old', title: 'Old chat guide', moduleKey: 'chat', status: 'ARCHIVED' }),
];

beforeEach(() => {
  api = fake.api = fakeTrainingApi();
  api.courses.mockResolvedValue({ courses: ROWS });
});

const openTab = async () => {
  const r = renderManage(<CoursesTab />);
  await screen.findByRole('list', { name: 'Courses' });
  return r;
};
const openMenu = async (title: string) => {
  await userEvent.click(screen.getByRole('button', { name: `More for ${title}` }));
  return screen.getByRole('menu', { name: `More for ${title}` });
};
const items = (menu: HTMLElement) => within(menu).getAllByRole('menuitem').map((i) => i.textContent);
const choose = async (title: string, item: string) => {
  const menu = await openMenu(title);
  await userEvent.click(within(menu).getByRole('menuitem', { name: item }));
};

describe('Learning Hub → Manage → Courses: the ⋯ menu on each course', () => {
  it('offers what the course’s state allows: Assign only when published, Delete only for a draft never published', async () => {
    await openTab();
    expect(items(await openMenu('Tasks basics'))).toEqual(['Edit', 'Preview as learner', 'Assign', 'Duplicate', 'Unpublish', 'Archive']);
    await userEvent.keyboard('{Escape}');
    expect(items(await openMenu('Board basics'))).toEqual(['Edit', 'Preview as learner', 'Assign', 'Publish changes', 'Duplicate', 'Unpublish', 'Archive']);
    await userEvent.keyboard('{Escape}');
    expect(items(await openMenu('Meeting minutes'))).toEqual(['Edit', 'Preview as learner', 'Publish', 'Duplicate', 'Archive', 'Delete']);
    await userEvent.keyboard('{Escape}');
    expect(items(await openMenu('Calendar tips'))).toEqual(['Edit', 'Preview as learner', 'Publish again', 'Duplicate', 'Archive']);
    await userEvent.keyboard('{Escape}');
    // 1.23.33: an archived course is out of the default list; "Show the 1 archived course" lists it.
    await userEvent.click(screen.getByRole('button', { name: 'Show the 1 archived course' }));
    expect(items(await openMenu('Old chat guide'))).toEqual(['Edit', 'Preview as learner', 'Publish again', 'Duplicate']);
  });

  it('works from the keyboard: the first item has the focus, arrows / Home / End move, Escape closes back to the button', async () => {
    await openTab();
    const button = screen.getByRole('button', { name: 'More for Tasks basics' });
    button.focus();
    await userEvent.keyboard('{Enter}');
    const menu = screen.getByRole('menu', { name: 'More for Tasks basics' });
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(within(menu).getByRole('menuitem', { name: 'Edit' })).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}');
    expect(within(menu).getByRole('menuitem', { name: 'Preview as learner' })).toHaveFocus();
    await userEvent.keyboard('{End}');
    expect(within(menu).getByRole('menuitem', { name: 'Archive' })).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}');
    expect(within(menu).getByRole('menuitem', { name: 'Edit' })).toHaveFocus();
    await userEvent.keyboard('{ArrowUp}');
    expect(within(menu).getByRole('menuitem', { name: 'Archive' })).toHaveFocus();
    await userEvent.keyboard('{Home}');
    expect(within(menu).getByRole('menuitem', { name: 'Edit' })).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(button).toHaveFocus();
    expect(button).toHaveAttribute('aria-expanded', 'false');
  });

  it('Edit opens the editor; Preview as learner opens the course as learners see it', async () => {
    const { where } = await openTab();
    await choose('Tasks basics', 'Edit');
    expect(where.path).toBe('/training/manage/courses/pub');
  });

  it('Preview as learner opens /training/courses/:id', async () => {
    const { where } = await openTab();
    await choose('Tasks basics', 'Preview as learner');
    expect(where.path).toBe('/training/courses/pub');
  });

  it('Assign opens the Assign window with the course ticked', async () => {
    await openTab();
    await choose('Tasks basics', 'Assign');
    const dialog = await screen.findByRole('dialog', { name: 'Assign a course' });
    expect(await within(dialog).findByRole('checkbox', { name: 'Tasks basics' })).toBeChecked();
    expect(within(dialog).getByRole('checkbox', { name: 'Board basics' })).not.toBeChecked();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Publish (a draft never published) publishes straight away and says so', async () => {
    api.publish.mockResolvedValue(manageCourse({ id: 'new', title: 'Meeting minutes', status: 'PUBLISHED', publishedAt: '2026-11-13T08:00:00.000Z' }));
    await openTab();
    await choose('Meeting minutes', 'Publish');
    await waitFor(() => expect(api.publish).toHaveBeenCalledWith('new'));
    expect(await screen.findByText('Published “Meeting minutes”. People can now find it, and you can assign it.')).toBeInTheDocument();
    // The list is read again.
    await waitFor(() => expect(api.courses.mock.calls.length).toBeGreaterThan(1));
  });

  it('Publish refused (it can’t be published yet): the problem is shown with a way to the editor', async () => {
    api.publish.mockRejectedValue(
      new ApiError(409, 'PUBLISH_PROBLEMS', 'This course can’t be published yet: Lesson “Check”: add at least one question.', { problems: ['Lesson “Check”: add at least one question.'] }),
    );
    const { where } = await openTab();
    await choose('Meeting minutes', 'Publish');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Couldn’t publish “Meeting minutes”. This course can’t be published yet: Lesson “Check”: add at least one question.');
    await userEvent.click(within(alert).getByRole('link', { name: 'Edit the course' }));
    expect(where.path).toBe('/training/manage/courses/new');
  });

  it('Publish changes and Publish again open the editor’s publish panel', async () => {
    const { where } = await openTab();
    await choose('Board basics', 'Publish changes');
    expect(where.path).toBe('/training/manage/courses/changed?publish=1');
  });

  it('Publish again (published before) opens the editor’s publish panel too', async () => {
    const { where } = await openTab();
    await choose('Calendar tips', 'Publish again');
    expect(where.path).toBe('/training/manage/courses/back?publish=1');
    expect(api.publish).not.toHaveBeenCalled();
  });

  it('Unpublish asks first', async () => {
    api.unpublish.mockResolvedValue(manageCourse({ id: 'pub', status: 'DRAFT' }));
    await openTab();
    await choose('Tasks basics', 'Unpublish');
    const ask = screen.getByRole('alertdialog', { name: 'Unpublish “Tasks basics”?' });
    await userEvent.click(within(ask).getByRole('button', { name: 'Keep it' }));
    expect(api.unpublish).not.toHaveBeenCalled();
    await choose('Tasks basics', 'Unpublish');
    await userEvent.click(within(screen.getByRole('alertdialog', { name: 'Unpublish “Tasks basics”?' })).getByRole('button', { name: 'Unpublish' }));
    await waitFor(() => expect(api.unpublish).toHaveBeenCalledWith('pub'));
    expect(await screen.findByText('Unpublished “Tasks basics”: it is a draft again.')).toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('Archive asks first; a refusal is said in the server’s words inside the question', async () => {
    api.archive.mockRejectedValueOnce(new ApiError(409, 'CONFLICT', 'Someone changed it just now.'));
    await openTab();
    await choose('Board basics', 'Archive');
    const ask = screen.getByRole('alertdialog', { name: 'Archive “Board basics”?' });
    await userEvent.click(within(ask).getByRole('button', { name: 'Archive' }));
    expect(await within(ask).findByText('Couldn’t archive it. Someone changed it just now.')).toBeInTheDocument();
    await userEvent.click(within(ask).getByRole('button', { name: 'Archive' }));
    await waitFor(() => expect(api.archive).toHaveBeenLastCalledWith('changed'));
    expect(await screen.findByText('Archived “Board basics”.')).toBeInTheDocument();
  });

  it('Delete (a draft never published) asks first, then the course goes', async () => {
    await openTab();
    await choose('Meeting minutes', 'Delete');
    const ask = screen.getByRole('alertdialog', { name: 'Delete “Meeting minutes”?' });
    expect(ask).toHaveTextContent('can’t be undone');
    await userEvent.click(within(ask).getByRole('button', { name: 'Delete course' }));
    await waitFor(() => expect(api.deleteCourse).toHaveBeenCalledWith('new'));
    expect(await screen.findByText('Deleted “Meeting minutes”.')).toBeInTheDocument();
  });

  it('Duplicate makes a draft copy and opens its editor', async () => {
    api.duplicateCourse.mockResolvedValue(manageCourse({ id: 'c-copy', title: 'Copy of Tasks basics' }));
    const { where } = await openTab();
    await choose('Tasks basics', 'Duplicate');
    await waitFor(() => expect(api.duplicateCourse).toHaveBeenCalledWith('pub'));
    await waitFor(() => expect(where.path).toBe('/training/manage/courses/c-copy'));
  });

  it('Duplicate refused: the server’s words, and the page stays', async () => {
    api.duplicateCourse.mockRejectedValue(new ApiError(403, 'FORBIDDEN', 'You can’t manage this course.'));
    const { where } = await openTab();
    await choose('Tasks basics', 'Duplicate');
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t duplicate “Tasks basics”. You can’t manage this course.');
    expect(where.path).toBe('/training/manage');
  });
});
