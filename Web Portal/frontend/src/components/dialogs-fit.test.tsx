import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { ProjectFormDialog } from './project-form/ProjectFormDialog';
import { CreateUserModal } from './CreateUserModal';
import { CreateTaskFromNoteModal } from './CreateTaskFromNoteModal';
import { NewTaskModal } from './NewTaskModal';
import { MeetingFormModal } from './MeetingFormModal';
import { MoveTaskDialog } from './MoveTaskDialog';
import type { MeetingNote } from '../api/meetings';

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'content-type': 'application/json' } })));
});
afterEach(() => vi.unstubAllGlobals());

const note: MeetingNote = {
  id: 'n1', meetingId: 'm1', agendaItemId: null, authorId: 'u1', type: 'ACTION', body: 'Prepare the vendor sheet', highlighted: false,
  taskId: null, actionItemId: null, decisionId: null, createdAt: '2026-10-01T06:00:00.000Z', editedAt: null,
};

const DIALOGS: [name: RegExp, element: ReactElement][] = [
  [/new user/i, <CreateUserModal onClose={() => {}} />],
  [/create task from note/i, <CreateTaskFromNoteModal meetingId="m1" note={note} defaultProjectId={null} onClose={() => {}} onCreated={() => {}} />],
  [/new meeting/i, <MeetingFormModal onClose={() => {}} onSaved={() => {}} />],
  [/move to another project/i, <MoveTaskDialog tasks={[{ id: 't1', key: 'RIG-4', title: 'Inspect the rig', projectId: 'p1' }]} onClose={() => {}} />],
];
const PROJECT_FORM: [name: RegExp, element: ReactElement] = [/new project/i, <ProjectFormDialog onClose={() => {}} />];
const TASK_FORM: [name: RegExp, element: ReactElement] = [/new task/i, <NewTaskModal onClose={() => {}} />];

describe('dialogs on short screens', () => {
  it.each(DIALOGS)('%s: is never taller than the screen above the keyboard; its fields scroll while its buttons stay in view', async (name, element) => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter>{element}</MemoryRouter>
      </QueryClientProvider>,
    );
    const dialog = await screen.findByRole('dialog', { name });
    // --visible-height: the height really visible on a phone — no address bar, and above the
    // on-screen keyboard, which the layer itself also stops at (index.css).
    expect(dialog.className).toMatch(/max-h-\[calc\(var\(--visible-height\)-2rem\)\]/);
    expect(dialog.closest('.fixed')!.className).toContain('above-keyboard');
    const scroller = dialog.querySelector('.overflow-y-auto');
    expect(scroller).not.toBeNull();
    expect(scroller!.contains(dialog.querySelector('button[type="submit"]'))).toBe(false);
  });

  it('new project: fills a phone screen, scrolls its fields and keeps its buttons outside the scrolling part', async () => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter>{PROJECT_FORM[1]}</MemoryRouter>
      </QueryClientProvider>,
    );
    const dialog = await screen.findByRole('dialog', { name: PROJECT_FORM[0] });
    expect(dialog.className).toMatch(/(^|\s)h-full(\s|$)/); // a full-height sheet on a phone
    expect(dialog.className).toMatch(/sm:max-h-\[min\(calc\(var\(--visible-height\)\*0\.92\)/); // a centred card on wider screens, never taller than the window
    expect(dialog.closest('.fixed')!.className).toContain('above-keyboard');
    const scroller = screen.getByLabelText(/^name/i).closest('.overflow-y-auto');
    expect(scroller).not.toBeNull();
    expect(scroller!.contains(screen.getByRole('button', { name: 'Create project' }))).toBe(false);
  });

  it('new task: fills a phone screen; elsewhere at most 800px wide and 90% of the height, its buttons outside the scrolling part', async () => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter>{TASK_FORM[1]}</MemoryRouter>
      </QueryClientProvider>,
    );
    const dialog = await screen.findByRole('dialog', { name: TASK_FORM[0] });
    expect(dialog.className).toMatch(/(^|\s)h-full(\s|$)/);
    expect(dialog.className).toMatch(/sm:w-\[min\(800px,calc\(100vw-32px\)\)\]/);
    expect(dialog.className).toMatch(/sm:max-h-\[calc\(var\(--visible-height\)\*0\.9\)\]/);
    expect(dialog.closest('.fixed')!.className).toContain('above-keyboard');
    const scroller = screen.getByLabelText(/^task title/i).closest('.overflow-y-auto');
    expect(scroller).not.toBeNull();
    expect(scroller!.contains(screen.getByRole('button', { name: 'Create task' }))).toBe(false);
  });
});

describe('dialogs are laid out against the window, wherever they are opened from', () => {
  it.each([...DIALOGS, PROJECT_FORM, TASK_FORM])('%s: its layer sits directly in <body>', async (name, element) => {
    // A "fixed" layer is only relative to the window while no ancestor has a transform, a filter or
    // a backdrop-filter. The frosted header and the animated page heading have one, so a dialog
    // rendered inside them was placed inside that strip — half of it above the screen.
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter>
          <header style={{ backdropFilter: 'blur(12px)' }}>{element}</header>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const dialog = await screen.findByRole('dialog', { name });
    const layer = dialog.closest('.fixed');
    expect(layer).not.toBeNull();
    expect(layer!.parentElement).toBe(document.body);
    expect(dialog.closest('header')).toBeNull();
  });
});

