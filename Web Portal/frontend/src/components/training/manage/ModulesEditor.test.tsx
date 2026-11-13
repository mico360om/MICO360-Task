import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CourseEditorPage } from '../../../pages/training/CourseEditorPage';
import { fakeTrainingApi, lesson, manageCourse, manageModule, type FakeTrainingApi } from './test-api';
import { renderManage } from './test-render';
import { ApiError } from '../../../lib/api-client';
import type { ManageCourse } from '../../../api/training';

let api: FakeTrainingApi;
const fake = vi.hoisted(() => ({ api: null as FakeTrainingApi | null }));
vi.mock('../../../api/training', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../api/training')>()),
  trainingApi: (await import('./test-api')).followFake(() => fake.api),
}));

const PATH = { path: '/training/manage/courses/c1', route: '/training/manage/courses/:id' };

const MODULES = [
  manageModule({ id: 'm1', title: 'Getting started', position: 0, moduleKey: 'general', visibility: 'All staff' }),
  manageModule({ id: 'm2', title: 'Tasks', position: 1, moduleKey: 'tasks', visibility: 'All staff' }),
  // Switched off, the server's visibility words are the Off words.
  manageModule({ id: 'm3', title: 'Reports', position: 2, moduleKey: 'reports', visibility: 'Off — the old course was removed', enabled: false, offReason: 'REMOVED' }),
];
const LESSONS = [
  lesson({ id: 'l1', kind: 'GUIDE', title: 'Sign in', position: 0, moduleId: 'm1' }),
  lesson({ id: 'l2', kind: 'GUIDE', title: 'Make a task', position: 1, moduleId: 'm2' }),
  lesson({ id: 'l3', kind: 'QUIZ', title: 'Tasks quiz', position: 2, moduleId: 'm2' }),
];
const withModules = (over: Partial<ManageCourse> = {}) => manageCourse({ modules: MODULES, lessons: LESSONS, ...over });

const open = async (course: ManageCourse = withModules()) => {
  api.manageCourse.mockResolvedValue(course);
  renderManage(<CourseEditorPage />, PATH);
  return screen.findByRole('region', { name: 'Modules' });
};
const moduleRow = (region: HTMLElement, title: string) => within(region).getByText(title, { selector: '[data-module-title]' }).closest('li')!;
const choose = async (region: HTMLElement, title: string, item: string) => {
  await userEvent.click(within(region).getByRole('button', { name: `More for the module “${title}”` }));
  await userEvent.click(within(screen.getByRole('menu', { name: `More for the module “${title}”` })).getByRole('menuitem', { name: item }));
};

beforeEach(() => {
  api = fake.api = fakeTrainingApi();
});

describe('Course editor: modules', () => {
  it('a course without modules shows only Add module (the lessons stay one plain list)', async () => {
    const region = await open(manageCourse({ lessons: [lesson({ id: 'l1', kind: 'GUIDE', title: 'Make a task' })] }));
    expect(within(region).getByRole('button', { name: 'Add module' })).toBeInTheDocument();
    expect(within(region).queryByRole('list')).toBeNull();
    expect(within(region).getByText(/Without modules the course is one list of lessons/)).toBeInTheDocument();
    const lessons = screen.getByRole('region', { name: 'Lessons' });
    expect(within(lessons).queryByRole('combobox')).toBeNull();
    expect(within(lessons).queryByRole('heading', { level: 3 })).toBeNull();
  });

  it('lists the modules in order with who sees each one, its lessons, and Off when switched off', async () => {
    const region = await open();
    const list = within(region).getByRole('list', { name: 'Modules' });
    expect(within(list).getAllByRole('listitem').map((li) => li.querySelector('[data-module-title]')!.textContent)).toEqual(['Getting started', 'Tasks', 'Reports']);
    expect(within(moduleRow(region, 'Getting started')).getByText('All staff · 1 lesson')).toBeInTheDocument();
    expect(within(moduleRow(region, 'Tasks')).getByText('All staff · 2 lessons')).toBeInTheDocument();
    const reports = moduleRow(region, 'Reports');
    // Said once (a badge), not again in the facts line.
    expect(within(reports).getByText('No lessons')).toBeInTheDocument();
    expect(within(reports).getAllByText(/Off — the old course was removed/)).toHaveLength(1);
    expect(within(moduleRow(region, 'Tasks')).queryByText(/^Off/)).toBeNull();
  });

  it('a module switched off by an admin just says Off', async () => {
    const region = await open(withModules({ modules: [manageModule({ id: 'm1', title: 'Chat', enabled: false, visibility: 'Off' })] }));
    const chat = moduleRow(region, 'Chat');
    expect(within(chat).getByText('Off')).toBeInTheDocument();
    expect(within(chat).getByText('1 lesson')).toBeInTheDocument();
  });

  it('Add module: a title is needed, then it is added at the end', async () => {
    const added = withModules({ modules: [...MODULES, manageModule({ id: 'm4', title: 'MICO AI', position: 3 })] });
    api.addModule.mockResolvedValue(added);
    const region = await open();
    await userEvent.click(within(region).getByRole('button', { name: 'Add module' }));
    const dialog = screen.getByRole('dialog', { name: 'Add module' });
    const title = within(dialog).getByRole('textbox', { name: 'Title' });
    expect(title).toHaveAttribute('maxLength', '160');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add module' }));
    expect(within(dialog).getByText('Give the module a title.')).toBeInTheDocument();
    expect(api.addModule).not.toHaveBeenCalled();
    api.manageCourse.mockResolvedValue(added);
    await userEvent.type(title, '  MICO AI ');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add module' }));
    await waitFor(() => expect(api.addModule).toHaveBeenCalledWith('c1', { title: 'MICO AI' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await within(region).findByText('MICO AI', { selector: '[data-module-title]' })).toBeInTheDocument();
  });

  it('Add module: the server’s refusal is shown and the window stays open', async () => {
    api.addModule.mockRejectedValue(new ApiError(400, 'VALIDATION', 'A course has at most 30 modules.'));
    const region = await open();
    await userEvent.click(within(region).getByRole('button', { name: 'Add module' }));
    const dialog = screen.getByRole('dialog', { name: 'Add module' });
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Title' }), 'One more');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add module' }));
    expect(await within(dialog).findByText('Couldn’t add the module. A course has at most 30 modules.')).toBeInTheDocument();
  });

  it('Rename sends the new title', async () => {
    const region = await open();
    await choose(region, 'Tasks', 'Rename');
    const dialog = screen.getByRole('dialog', { name: 'Rename module' });
    const title = within(dialog).getByRole('textbox', { name: 'Title' });
    expect(title).toHaveValue('Tasks');
    await userEvent.clear(title);
    await userEvent.type(title, 'Tasks and lists');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.updateModule).toHaveBeenCalledWith('m2', { title: 'Tasks and lists' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('moves a module up or down (the whole order is sent); the ends can’t move further', async () => {
    const region = await open();
    expect(within(region).getByRole('button', { name: 'Move the module “Getting started” up' })).toBeDisabled();
    expect(within(region).getByRole('button', { name: 'Move the module “Reports” down' })).toBeDisabled();
    const moved = withModules({ modules: [MODULES[1]!, MODULES[0]!, MODULES[2]!].map((m, i) => ({ ...m, position: i })) });
    api.reorderModules.mockResolvedValue(moved);
    api.manageCourse.mockResolvedValue(moved);
    await userEvent.click(within(region).getByRole('button', { name: 'Move the module “Tasks” up' }));
    await waitFor(() => expect(api.reorderModules).toHaveBeenCalledWith('c1', ['m2', 'm1', 'm3']));
    await waitFor(() => expect(within(region).getAllByRole('listitem').map((li) => li.querySelector('[data-module-title]')!.textContent)).toEqual(['Tasks', 'Getting started', 'Reports']));
    // It reached the top: its other button has the focus.
    await waitFor(() => expect(within(region).getByRole('button', { name: 'Move the module “Tasks” down' })).toHaveFocus());
    await userEvent.click(within(region).getByRole('button', { name: 'Move the module “Getting started” down' }));
    await waitFor(() => expect(api.reorderModules).toHaveBeenLastCalledWith('c1', ['m2', 'm3', 'm1']));
  });

  it('Who sees it (a staff course): the feature, the groups and the companies — the Client portal isn’t offered', async () => {
    const region = await open();
    await choose(region, 'Getting started', 'Who sees it');
    const dialog = screen.getByRole('dialog', { name: 'Who sees it' });
    expect(dialog).toHaveTextContent('Getting started');
    const feature = within(dialog).getByRole('combobox', { name: 'Feature' });
    expect(feature).toHaveValue('general');
    const features = within(feature).getAllByRole('option').map((o) => o.textContent);
    expect(features).toContain('Reports');
    expect(features).not.toContain('Client portal');
    const groups = within(dialog).getByRole('group', { name: 'Groups' });
    expect(within(groups).getAllByRole('checkbox').map((c) => c.closest('label')!.textContent)).toEqual(['All staff', 'Administrators', 'Employees', 'People who run a project', 'Training managers']);
    expect(within(groups).getByRole('checkbox', { name: 'All staff' })).toBeChecked();
    await userEvent.selectOptions(feature, 'reports');
    await userEvent.click(within(groups).getByRole('checkbox', { name: 'Administrators' }));
    expect(within(groups).getByRole('checkbox', { name: 'All staff' })).not.toBeChecked();
    await userEvent.click(within(groups).getByRole('checkbox', { name: 'Training managers' }));
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Beta Co' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.updateModule).toHaveBeenCalledWith('m1', { moduleKey: 'reports', roleKeys: ['admins', 'training-managers'], companyIds: ['co-b'] }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('Who sees it: ticking All staff clears the groups; nothing changed sends nothing', async () => {
    const region = await open(withModules({ modules: [manageModule({ id: 'm1', title: 'Admin settings', moduleKey: 'admin', roleKeys: ['admins'], visibility: 'Admins only' })], lessons: [] }));
    await choose(region, 'Admin settings', 'Who sees it');
    let dialog = screen.getByRole('dialog', { name: 'Who sees it' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(api.updateModule).not.toHaveBeenCalled();
    await choose(region, 'Admin settings', 'Who sees it');
    dialog = screen.getByRole('dialog', { name: 'Who sees it' });
    const groups = within(dialog).getByRole('group', { name: 'Groups' });
    expect(within(groups).getByRole('checkbox', { name: 'Administrators' })).toBeChecked();
    await userEvent.click(within(groups).getByRole('checkbox', { name: 'All staff' }));
    expect(within(groups).getByRole('checkbox', { name: 'Administrators' })).not.toBeChecked();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.updateModule).toHaveBeenCalledWith('m1', { roleKeys: [] }));
  });

  it('Who sees it (a clients’ course): companies only — the feature and the groups don’t apply to clients', async () => {
    const region = await open(withModules({ audience: 'CLIENTS', moduleKey: 'portal' }));
    await choose(region, 'Tasks', 'Who sees it');
    const dialog = screen.getByRole('dialog', { name: 'Who sees it' });
    expect(within(dialog).queryByRole('combobox', { name: 'Feature' })).toBeNull();
    expect(within(dialog).queryByRole('group', { name: 'Groups' })).toBeNull();
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Alpha Co' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.updateModule).toHaveBeenCalledWith('m2', { companyIds: ['co-a'] }));
  });

  it('Switch off hides a module from learners; Switch on brings it back', async () => {
    const region = await open();
    await choose(region, 'Tasks', 'Switch off');
    await waitFor(() => expect(api.updateModule).toHaveBeenCalledWith('m2', { enabled: false }));
    await choose(region, 'Reports', 'Switch on');
    await waitFor(() => expect(api.updateModule).toHaveBeenLastCalledWith('m3', { enabled: true }));
  });

  it('a second Switch click while the first is still running sends nothing more', async () => {
    let finish!: (c: ManageCourse) => void;
    api.updateModule.mockReturnValue(new Promise<ManageCourse>((r) => { finish = r; }));
    const region = await open();
    await choose(region, 'Tasks', 'Switch off');
    await choose(region, 'Tasks', 'Switch off');
    expect(api.updateModule).toHaveBeenCalledTimes(1);
    finish(withModules());
    await waitFor(() => expect(within(region).getByText(/Switched “Tasks” off/)).toBeInTheDocument());
  });

  it('a refused change is shown in the server’s words', async () => {
    api.updateModule.mockRejectedValue(new ApiError(403, 'FORBIDDEN', 'You can’t manage this course.'));
    const region = await open();
    await choose(region, 'Tasks', 'Switch off');
    expect(await within(region).findByText('Couldn’t switch the module off. You can’t manage this course.')).toBeInTheDocument();
  });

  it('Remove asks first: its lessons move to the module chosen (or to no module) — lessons are never deleted', async () => {
    api.removeModule.mockResolvedValue(withModules({ modules: [MODULES[0]!, MODULES[2]!], lessons: LESSONS.map((l) => ({ ...l, moduleId: 'm1' })) }));
    const region = await open();
    await choose(region, 'Tasks', 'Remove');
    const ask = screen.getByRole('alertdialog', { name: 'Remove the module “Tasks”?' });
    expect(ask).toHaveTextContent('Lessons are never deleted.');
    const moveTo = within(ask).getByRole('combobox', { name: 'Move its 2 lessons to' });
    expect(within(moveTo).getAllByRole('option').map((o) => o.textContent)).toEqual(['No module', 'Getting started', 'Reports (off)']);
    expect(moveTo).toHaveValue('');
    await userEvent.selectOptions(moveTo, 'm1');
    await userEvent.click(within(ask).getByRole('button', { name: 'Remove module' }));
    await waitFor(() => expect(api.removeModule).toHaveBeenCalledWith('m2', 'm1'));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  });

  it('Remove with “No module”: the lessons stay in the course without a module', async () => {
    const region = await open();
    await choose(region, 'Getting started', 'Remove');
    const ask = screen.getByRole('alertdialog', { name: 'Remove the module “Getting started”?' });
    await userEvent.click(within(ask).getByRole('button', { name: 'Remove module' }));
    await waitFor(() => expect(api.removeModule).toHaveBeenCalledWith('m1', null));
  });

  it('Remove a module without lessons: nothing to move', async () => {
    api.removeModule.mockRejectedValueOnce(new ApiError(409, 'CONFLICT', 'Someone changed the course just now.'));
    const region = await open();
    await choose(region, 'Reports', 'Remove');
    const ask = screen.getByRole('alertdialog', { name: 'Remove the module “Reports”?' });
    expect(within(ask).queryByRole('combobox')).toBeNull();
    expect(ask).toHaveTextContent('It has no lessons.');
    await userEvent.click(within(ask).getByRole('button', { name: 'Remove module' }));
    expect(await within(ask).findByText('Couldn’t remove it. Someone changed the course just now.')).toBeInTheDocument();
    await userEvent.click(within(ask).getByRole('button', { name: 'Remove module' }));
    await waitFor(() => expect(api.removeModule).toHaveBeenLastCalledWith('m3', null));
  });
});
