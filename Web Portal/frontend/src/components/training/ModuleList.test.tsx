import { describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ModuleList } from './ModuleList';
import { fakeLearner, moduleDetail, renderOnSide } from './training-fixtures';

const list = (course = moduleDetail(), openId: string | null = null, portal = false) =>
  renderOnSide(<ModuleList course={course} openId={openId} />, { api: fakeLearner(), portal });

const row = (title: string) => screen.getByRole('button', { name: new RegExp(`^${title}`) });

describe('the course’s modules', () => {
  it('in order, each with its state in words: Done (the day), In progress (lessons), Not started — folded', () => {
    list();
    expect(screen.getByRole('heading', { level: 2, name: 'Modules' })).toBeInTheDocument();
    const buttons = screen.getAllByRole('button');
    expect(buttons.map((b) => b.querySelector('[data-module-title]')?.textContent)).toEqual(['Getting started', 'Tasks', 'Kanban board']);
    expect(row('Getting started')).toHaveTextContent('Done · 3 Nov 2026');
    expect(row('Tasks')).toHaveTextContent('In progress · 1 of 3 lessons');
    expect(row('Kanban board')).toHaveTextContent('Not started');
    for (const b of buttons) expect(b).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.queryByText('New for your role')).toBeNull();
  });

  it('opening a module lists its lessons with ticks (links to each), closing hides them again', async () => {
    list();
    const tasks = row('Tasks');
    await userEvent.click(tasks);
    expect(tasks).toHaveAttribute('aria-expanded', 'true');
    const panel = document.getElementById(tasks.getAttribute('aria-controls')!)!;
    const links = within(panel).getAllByRole('link');
    expect(links.map((l) => l.getAttribute('href'))).toEqual(['/training/courses/u1/lessons/t1', '/training/courses/u1/lessons/t2', '/training/courses/u1/lessons/t3']);
    expect(within(links[0]!).getByText('Done')).toBeInTheDocument();
    expect(within(links[1]!).queryByText('Done')).toBeNull();
    await userEvent.click(tasks);
    expect(tasks).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('a module new for the person’s role (after they finished) says so', () => {
    const c = moduleDetail();
    list({ ...c, modules: c.modules.map((m) => (m.id === 'kb' ? { ...m, newForRole: true } : m)) });
    expect(row('Kanban board')).toHaveTextContent('New for your role');
    expect(row('Tasks')).not.toHaveTextContent('New for your role');
  });

  it('?moduleId= opens that module and brings it into view', () => {
    const into = vi.fn();
    const before = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = into;
    try {
      list(moduleDetail(), 'kb');
      expect(row('Kanban board')).toHaveAttribute('aria-expanded', 'true');
      expect(row('Tasks')).toHaveAttribute('aria-expanded', 'false');
      expect(into).toHaveBeenCalledTimes(1);
      expect(into.mock.contexts[0]).toBe(document.getElementById('module-kb'));
    } finally {
      Element.prototype.scrollIntoView = before;
    }
  });

  it('13 Nov new look: each row has its feature’s icon — from the module’s own key, whatever its name; “Other lessons” the book', () => {
    const c = moduleDetail();
    list({
      ...c,
      // A module renamed by an administrator keeps its feature's icon.
      modules: [...c.modules.map((m) => (m.id === 'tk' ? { ...m, title: 'Task basics' } : m)), { id: 'other', title: 'Other lessons', moduleKey: null, position: 3, status: 'NOT_STARTED' as const, lessonsDone: 0, lessonCount: 1, minutes: 4, doneAt: null, newForRole: false, nextLessonId: 'x1', lessonIds: ['x1'] }],
    });
    const icon = (title: string) => row(title).querySelector('[data-module-icon]')?.getAttribute('data-module-icon');
    expect(icon('Getting started')).toBe('general');
    expect(icon('Task basics')).toBe('tasks');
    expect(icon('Kanban board')).toBe('board');
    expect(icon('Other lessons')).toBe('book');
    // Decorative: the row is still named by its words.
    expect(row('Task basics').querySelector('[data-module-icon]')).toHaveAttribute('aria-hidden', 'true');
  });

  it('the module Continue opens is marked “Up next” (the brand colour); none once everything is done', () => {
    const one = list();
    expect(row('Tasks')).toHaveTextContent('Up next');
    expect(row('Tasks').closest('li')).toHaveAttribute('data-current', 'true');
    expect(row('Getting started')).not.toHaveTextContent('Up next');
    expect(row('Kanban board')).not.toHaveTextContent('Up next');
    expect(screen.getAllByText('Up next')).toHaveLength(1);
    one.unmount();
    const c = moduleDetail();
    list({ ...c, mine: { ...c.mine, status: 'COMPLETED', modules: { done: 3, total: 3 } }, modules: c.modules.map((m) => ({ ...m, status: 'DONE' as const, lessonsDone: m.lessonCount, doneAt: '2026-11-10T08:00:00.000Z', nextLessonId: null })) });
    expect(screen.queryByText('Up next')).toBeNull();
  });

  it('in the Client portal: the portal’s addresses', async () => {
    list(moduleDetail(), 'gs', true);
    expect(within(screen.getByRole('region', { name: 'Modules' })).getAllByRole('link')[0]).toHaveAttribute('href', '/portal/training/courses/u1/lessons/g1');
    await userEvent.click(row('Getting started'));
    expect(screen.queryByRole('link')).toBeNull();
  });
});
