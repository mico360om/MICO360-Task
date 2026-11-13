import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CourseEditorDefault, { CourseEditorPage } from './CourseEditorPage';
import { fakeTrainingApi, lesson, manageCourse, manageModule, type FakeTrainingApi } from '../../components/training/manage/test-api';
import { renderManage } from '../../components/training/manage/test-render';
import { ApiError } from '../../lib/api-client';

let api: FakeTrainingApi;
const fake = vi.hoisted(() => ({ api: null as FakeTrainingApi | null }));
vi.mock('../../api/training', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/training')>()),
  trainingApi: (await import('../../components/training/manage/test-api')).followFake(() => fake.api),
}));

const PATH = { path: '/training/manage/courses/c1', route: '/training/manage/courses/:id' };
const open = () => renderManage(<CourseEditorPage />, PATH);

beforeEach(() => {
  api = fake.api = fakeTrainingApi();
});

describe('Course editor: the page', () => {
  it('is the page’s default export too', () => {
    expect(CourseEditorDefault).toBe(CourseEditorPage);
  });

  it('the course’s title, the way back, Preview as learner, and its sections', async () => {
    api.manageCourse.mockResolvedValue(manageCourse({ lessons: [lesson({ id: 'l1', kind: 'GUIDE', title: 'Make a task', minutes: 7 })] }));
    open();
    expect(await screen.findByRole('heading', { level: 1, name: 'Tasks basics' })).toBeInTheDocument();
    expect(api.manageCourse).toHaveBeenCalledWith('c1');
    const crumbs = within(screen.getByRole('navigation', { name: 'Breadcrumb' }));
    expect(crumbs.getByRole('link', { name: 'Learning Hub' })).toHaveAttribute('href', '/training');
    expect(crumbs.getByRole('link', { name: 'Manage' })).toHaveAttribute('href', '/training/manage');
    expect(screen.getByRole('link', { name: 'Preview as learner' })).toHaveAttribute('href', '/training/courses/c1');
    expect(screen.getByText('Tasks · Staff · Beginner · 1 lesson · 7 min')).toBeInTheDocument();
    for (const name of ['Publish', 'Details', 'Modules', 'Lessons', 'Downloads']) expect(screen.getByRole('region', { name })).toBeInTheDocument();
    // Only a published course can be assigned.
    expect(screen.queryByRole('link', { name: 'Assign this course' })).toBeNull();
  });

  it('the facts count the modules; the Modules section comes before the Lessons', async () => {
    api.manageCourse.mockResolvedValue(
      manageCourse({
        modules: [manageModule({ id: 'm1', title: 'Getting started' }), manageModule({ id: 'm2', title: 'Tasks', position: 1 })],
        lessons: [lesson({ id: 'l1', kind: 'GUIDE', title: 'Make a task', minutes: 7, moduleId: 'm2' })],
      }),
    );
    open();
    expect(await screen.findByText('Tasks · Staff · Beginner · 2 modules · 1 lesson · 7 min')).toBeInTheDocument();
    const modules = screen.getByRole('region', { name: 'Modules' });
    const lessons = screen.getByRole('region', { name: 'Lessons' });
    expect(modules.compareDocumentPosition(lessons) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('a course’s notice (a built-in course that was edited) is shown at the top', async () => {
    const notice = 'This built-in course was edited, so it wasn’t merged. Its assignments moved to MICO360 Tasks User Training. Archive it when you’re ready.';
    api.manageCourse.mockResolvedValue(manageCourse({ starter: true, status: 'PUBLISHED', publishedAt: '2026-11-01T08:00:00.000Z', notice }));
    open();
    expect(await screen.findByText(notice)).toBeInTheDocument();
  });

  it('no notice, no notice line', async () => {
    api.manageCourse.mockResolvedValue(manageCourse());
    open();
    await screen.findByRole('heading', { level: 1, name: 'Tasks basics' });
    expect(screen.queryByText(/wasn’t merged/)).toBeNull();
  });

  it('a published course links to Assign with the course chosen', async () => {
    api.manageCourse.mockResolvedValue(manageCourse({ status: 'PUBLISHED', publishedAt: '2026-11-01T08:00:00.000Z' }));
    open();
    expect(await screen.findByRole('link', { name: 'Assign this course' })).toHaveAttribute('href', '/training/manage?tab=assignments&course=c1&assign=1');
  });

  it('someone who isn’t a Training manager is told so; a missing course says so', async () => {
    api.manageCourse.mockRejectedValue(new ApiError(403, 'FORBIDDEN', 'Only Training managers and administrators can do that.'));
    open();
    expect(await screen.findByText('Only Training managers and administrators can manage the Learning Hub')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to My learning' })).toHaveAttribute('href', '/training');
  });

  it('a course that doesn’t exist says so', async () => {
    api.manageCourse.mockRejectedValue(new ApiError(404, 'NOT_FOUND', 'Course not found.'));
    open();
    expect(await screen.findByText('This course doesn’t exist')).toBeInTheDocument();
  });
});

describe('Course editor: details', () => {
  it('Save sends only what changed — title, the certificate (valid months, Issued by) and a company limit', async () => {
    api.manageCourse.mockResolvedValue(manageCourse());
    api.updateCourse.mockImplementation(async (_id, p) => manageCourse({ ...p, certificateMonths: p.certificateMonths ?? null } as never));
    open();
    const details = await screen.findByRole('region', { name: 'Details' });
    expect(within(details).getByRole('button', { name: 'Save details' })).toBeDisabled();
    const title = within(details).getByRole('textbox', { name: 'Title' });
    await userEvent.clear(title);
    await userEvent.type(title, 'Tasks for beginners');
    await userEvent.click(within(details).getByRole('switch', { name: 'Certificate' }));
    await userEvent.type(within(details).getByRole('spinbutton', { name: 'Valid for (months)' }), '12');
    await waitFor(() => expect(within(details).getByRole('option', { name: 'Tara Trainer' })).toBeInTheDocument());
    await userEvent.selectOptions(within(details).getByRole('combobox', { name: /Issued by/ }), 'u-tm');
    await userEvent.type(within(details).getByRole('textbox', { name: /Their title/ }), 'Training manager');
    await userEvent.click(within(details).getByRole('checkbox', { name: 'Beta Co' }));
    await userEvent.click(within(details).getByRole('button', { name: 'Save details' }));
    await waitFor(() =>
      expect(api.updateCourse).toHaveBeenCalledWith('c1', { title: 'Tasks for beginners', certificateOn: true, certificateMonths: 12, issuerUserId: 'u-tm', issuerTitle: 'Training manager', companyIds: ['co-b'] }),
    );
    expect(await within(details).findByText('Details saved.')).toBeInTheDocument();
  });

  it('roles for staff; the Client portal module makes it a clients’ course (no roles)', async () => {
    api.manageCourse.mockResolvedValue(manageCourse({ roleKeys: ['employees'] }));
    open();
    const details = await screen.findByRole('region', { name: 'Details' });
    expect(within(details).getByRole('checkbox', { name: 'Employees' })).toBeChecked();
    await userEvent.click(within(details).getByRole('checkbox', { name: 'People who run a project' }));
    await userEvent.selectOptions(within(details).getByRole('combobox', { name: 'Module' }), 'portal');
    expect(within(details).getByRole('radio', { name: /^Clients/ })).toBeChecked();
    expect(within(details).getByRole('radio', { name: /^Staff/ })).toBeDisabled();
    expect(within(details).queryByRole('checkbox', { name: 'Employees' })).toBeNull();
    await userEvent.click(within(details).getByRole('button', { name: 'Save details' }));
    await waitFor(() => expect(api.updateCourse).toHaveBeenCalledWith('c1', { moduleKey: 'portal', audience: 'CLIENTS', roleKeys: [] }));
  });

  it('checks lengths before sending and shows the server’s words when it refuses', async () => {
    api.manageCourse.mockResolvedValue(manageCourse());
    api.updateCourse.mockRejectedValue(new ApiError(400, 'VALIDATION', '“Issued by” must be a Training manager or an administrator.', { field: 'issuerUserId' }));
    open();
    const details = await screen.findByRole('region', { name: 'Details' });
    const title = within(details).getByRole('textbox', { name: 'Title' });
    await userEvent.clear(title);
    await userEvent.click(within(details).getByRole('button', { name: 'Save details' }));
    expect(within(details).getByText('Give the course a title.')).toBeInTheDocument();
    expect(api.updateCourse).not.toHaveBeenCalled();
    expect(title).toHaveAttribute('maxLength', '160');
    expect(within(details).getByRole('textbox', { name: /Summary/ })).toHaveAttribute('maxLength', '2000');
    await userEvent.type(title, 'New name');
    await userEvent.click(within(details).getByRole('button', { name: 'Save details' }));
    expect(await within(details).findByText(/“Issued by” must be a Training manager or an administrator\./)).toBeInTheDocument();
  });

  it('a signature picture is uploaded, shown, and saved with the details (or removed)', async () => {
    api.manageCourse.mockResolvedValue(manageCourse({ certificateOn: true }));
    open();
    const details = await screen.findByRole('region', { name: 'Details' });
    await userEvent.upload(within(details).getByLabelText('Upload a signature'), new File(['png'], 'sig.png', { type: 'image/png' }));
    await waitFor(() => expect(api.uploadSignature).toHaveBeenCalled());
    expect(await within(details).findByRole('button', { name: 'Remove signature' })).toBeInTheDocument();
    await userEvent.click(within(details).getByRole('button', { name: 'Save details' }));
    await waitFor(() => expect(api.updateCourse).toHaveBeenCalledWith('c1', { signatureFileId: 'sig1' }));
  });
});

describe('Course editor: a starter course and the words (12 Nov)', () => {
  it('no STARTER badge: a quiet “Comes with MICO360” inside the details only; people “taking it”', async () => {
    api.manageCourse.mockResolvedValue(manageCourse({ starter: true, status: 'PUBLISHED', publishedAt: '2026-11-01T08:00:00.000Z', enrolled: 12, completed: 5 }));
    open();
    const publish = await screen.findByRole('region', { name: 'Publish' });
    expect(screen.queryByText(/^Starter$/i)).toBeNull();
    expect(within(publish).getByText('12 taking it · 5 finished')).toBeInTheDocument();
    expect(within(publish).queryByText(/enrolled/)).toBeNull();
    const details = screen.getByRole('region', { name: 'Details' });
    expect(within(details).getByText('Comes with MICO360')).toBeInTheDocument();
    expect(within(details).getByRole('group', { name: 'Finished when' })).toBeInTheDocument();
    expect(within(details).queryByText('Completed when')).toBeNull();
  });

  it('a course someone made doesn’t say it comes with MICO360', async () => {
    api.manageCourse.mockResolvedValue(manageCourse({ starter: false }));
    open();
    const details = await screen.findByRole('region', { name: 'Details' });
    expect(within(details).queryByText('Comes with MICO360')).toBeNull();
  });
});

describe('Course editor: publish', () => {
  it('what stops it being published is listed and Publish is unavailable', async () => {
    api.manageCourse.mockResolvedValue(manageCourse({ publishProblems: ['Lesson “Watch”: add the YouTube or Vimeo link.', 'Lesson “Check”: add at least one question.'] }));
    open();
    const panel = await screen.findByRole('region', { name: 'Publish' });
    expect(within(panel).getByText('Lesson “Watch”: add the YouTube or Vimeo link.')).toBeInTheDocument();
    expect(within(panel).getByText('Lesson “Check”: add at least one question.')).toBeInTheDocument();
    const publish = within(panel).getByRole('button', { name: 'Publish' });
    expect(publish).toBeDisabled();
    expect(publish).toHaveAccessibleDescription(/can’t be published yet/);
  });

  it('a draft never published: Publish asks nothing more', async () => {
    api.manageCourse.mockResolvedValue(manageCourse());
    api.publish.mockResolvedValue(manageCourse({ status: 'PUBLISHED', publishedAt: '2026-11-11T08:00:00.000Z' }));
    open();
    const panel = await screen.findByRole('region', { name: 'Publish' });
    expect(within(panel).getByText('Draft')).toBeInTheDocument();
    expect(within(panel).getByText('Version 1')).toBeInTheDocument();
    await userEvent.click(within(panel).getByRole('button', { name: 'Publish' }));
    await waitFor(() => expect(api.publish).toHaveBeenCalledWith('c1'));
    expect(await within(panel).findByText(/Published\. People can now find it/)).toBeInTheDocument();
  });

  it('published before, with changes: Small fix — people keep their progress (completions and certificates stay)', async () => {
    api.manageCourse.mockResolvedValue(manageCourse({ status: 'PUBLISHED', publishedAt: '2026-11-01T08:00:00.000Z', unpublishedChanges: true, version: 2, completed: 6 }));
    api.publish.mockResolvedValue(manageCourse({ status: 'PUBLISHED', version: 3 }));
    open();
    const panel = await screen.findByRole('region', { name: 'Publish' });
    expect(within(panel).getByText('Changes not published')).toBeInTheDocument();
    await userEvent.click(within(panel).getByRole('button', { name: 'Publish changes' }));
    const dialog = screen.getByRole('dialog', { name: 'What kind of change is this?' });
    expect(dialog).toHaveTextContent('version 3');
    expect(within(dialog).getByRole('radio', { name: /^Small fix — people keep their progress/ })).toBeChecked();
    expect(within(dialog).getByRole('radio', { name: /^Small fix/ })).toHaveAccessibleName(/completions and certificates stay/);
    expect(within(dialog).queryByText(/Minor fix|Major change/)).toBeNull();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Publish' }));
    await waitFor(() => expect(api.publish).toHaveBeenCalledWith('c1', { change: 'MINOR' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('Big change — people take it again: completed people review the changed lessons within N days (14 by default)', async () => {
    api.manageCourse.mockResolvedValue(manageCourse({ status: 'PUBLISHED', publishedAt: '2026-11-01T08:00:00.000Z', unpublishedChanges: true }));
    open();
    const panel = await screen.findByRole('region', { name: 'Publish' });
    await userEvent.click(within(panel).getByRole('button', { name: 'Publish changes' }));
    const dialog = screen.getByRole('dialog', { name: 'What kind of change is this?' });
    await userEvent.click(within(dialog).getByRole('radio', { name: /^Big change — people take it again/ }));
    const days = within(dialog).getByRole('spinbutton', { name: 'Review within (days)' });
    expect(days).toHaveValue(14);
    await userEvent.clear(days);
    await userEvent.type(days, '10');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Publish' }));
    await waitFor(() => expect(api.publish).toHaveBeenCalledWith('c1', { change: 'MAJOR', reviewDays: 10 }));
  });

  it('?publish=1 (the Manage menu’s Publish changes) opens the publish window at once, and leaves the address', async () => {
    api.manageCourse.mockResolvedValue(manageCourse({ status: 'PUBLISHED', publishedAt: '2026-11-01T08:00:00.000Z', unpublishedChanges: true, version: 2 }));
    const { where } = renderManage(<CourseEditorPage />, { path: '/training/manage/courses/c1?publish=1', route: PATH.route });
    const dialog = await screen.findByRole('dialog', { name: 'What kind of change is this?' });
    expect(dialog).toHaveTextContent('version 3');
    await waitFor(() => expect(where.path).toBe('/training/manage/courses/c1'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Publish' }));
    await waitFor(() => expect(api.publish).toHaveBeenCalledWith('c1', { change: 'MINOR' }));
  });

  it('?publish=1 on a course that can’t be published yet: no window, the reasons are in the Publish panel', async () => {
    api.manageCourse.mockResolvedValue(manageCourse({ status: 'ARCHIVED', publishedAt: '2026-11-01T08:00:00.000Z', publishProblems: ['Lesson “Check”: add at least one question.'] }));
    renderManage(<CourseEditorPage />, { path: '/training/manage/courses/c1?publish=1', route: PATH.route });
    const panel = await screen.findByRole('region', { name: 'Publish' });
    expect(within(panel).getByText('Lesson “Check”: add at least one question.')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('when the server needs the kind of change (CHANGE_KIND_NEEDED), it is asked', async () => {
    api.manageCourse.mockResolvedValue(manageCourse());
    api.publish.mockRejectedValueOnce(new ApiError(400, 'CHANGE_KIND_NEEDED', 'Say whether this is a minor fix or a major change.'));
    open();
    const panel = await screen.findByRole('region', { name: 'Publish' });
    await userEvent.click(within(panel).getByRole('button', { name: 'Publish' }));
    expect(await screen.findByRole('dialog', { name: 'What kind of change is this?' })).toBeInTheDocument();
  });

  it('Unpublish and Archive ask first', async () => {
    api.manageCourse.mockResolvedValue(manageCourse({ status: 'PUBLISHED', publishedAt: '2026-11-01T08:00:00.000Z' }));
    open();
    const panel = await screen.findByRole('region', { name: 'Publish' });
    expect(within(panel).queryByRole('button', { name: 'Delete' })).toBeNull();
    await userEvent.click(within(panel).getByRole('button', { name: 'Unpublish' }));
    await userEvent.click(within(screen.getByRole('alertdialog', { name: 'Unpublish “Tasks basics”?' })).getByRole('button', { name: 'Unpublish' }));
    await waitFor(() => expect(api.unpublish).toHaveBeenCalledWith('c1'));
    await userEvent.click(within(panel).getByRole('button', { name: 'Archive' }));
    await userEvent.click(within(screen.getByRole('alertdialog', { name: 'Archive “Tasks basics”?' })).getByRole('button', { name: 'Archive' }));
    await waitFor(() => expect(api.archive).toHaveBeenCalledWith('c1'));
  });

  it('Delete (a draft never published) goes back to Manage; a refusal is said in the server’s words', async () => {
    api.manageCourse.mockResolvedValue(manageCourse());
    api.deleteCourse.mockRejectedValueOnce(new ApiError(409, 'ARCHIVE_INSTEAD', 'This course has been published or taken. Archive it instead.'));
    const { where } = open();
    const panel = await screen.findByRole('region', { name: 'Publish' });
    await userEvent.click(within(panel).getByRole('button', { name: 'Delete' }));
    await userEvent.click(within(screen.getByRole('alertdialog', { name: 'Delete “Tasks basics”?' })).getByRole('button', { name: 'Delete course' }));
    expect(await within(panel).findByText(/Archive it instead\./)).toBeInTheDocument();
    await userEvent.click(within(panel).getByRole('button', { name: 'Delete' }));
    await userEvent.click(within(screen.getByRole('alertdialog', { name: 'Delete “Tasks basics”?' })).getByRole('button', { name: 'Delete course' }));
    await waitFor(() => expect(where.path).toBe('/training/manage'));
  });
});
