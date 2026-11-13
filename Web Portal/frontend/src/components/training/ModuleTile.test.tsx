import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import type { LessonOutline, ModuleOutline } from '../../api/training';
import { LessonTile, ModuleTile } from './ModuleTile';
import { detail, fakeLearner, moduleDetail, renderOnSide } from './training-fixtures';

const [gs, tk, kb] = moduleDetail().modules as [ModuleOutline, ModuleOutline, ModuleOutline];
const NOW_YEAR = new Date().getFullYear();

/** No control inside another (a tile is ONE link). */
const NESTED = 'a a, a button, button a, button button, a input, a select';

describe('ModuleTile: a module as one link', () => {
  it('done: number, icon, name, a green tick and the day it was done', () => {
    const { container } = renderOnSide(<ModuleTile module={{ ...gs, doneAt: `${NOW_YEAR}-11-03T08:00:00.000Z` }} index={0} moduleKey="general" to="/training/courses/u1?moduleId=gs" />, { api: fakeLearner() });
    const tile = screen.getByRole('link');
    expect(container.querySelectorAll('a')).toHaveLength(1);
    expect(container.querySelector(NESTED)).toBeNull();
    expect(tile).toHaveAttribute('href', '/training/courses/u1?moduleId=gs');
    expect(tile).toHaveAccessibleName('Module 1: Getting started, Done · 3 Nov');
    expect(tile).toHaveTextContent('1');
    expect(within(tile).getByText('Done · 3 Nov')).toBeInTheDocument();
    expect(tile.querySelector('[data-tile-tick]')).not.toBeNull();
    expect(tile).toHaveAttribute('data-state', 'DONE');
    // The icon is decorative.
    expect(tile.querySelector('svg')!.closest('[aria-hidden="true"]')).not.toBeNull();
  });

  it('in progress: “1 of 3 lessons” and a small bar', () => {
    renderOnSide(<ModuleTile module={tk} index={1} moduleKey="tasks" to="/x" />, { api: fakeLearner() });
    const tile = screen.getByRole('link');
    expect(tile).toHaveAccessibleName('Module 2: Tasks, 1 of 3 lessons');
    expect(within(tile).getByText('1 of 3 lessons')).toBeInTheDocument();
    const bar = tile.querySelector<HTMLElement>('[data-tile-bar] > span')!;
    expect(bar.style.width).toBe('33%');
    expect(tile.querySelector('[data-tile-bar]')).toHaveAttribute('aria-hidden', 'true');
  });

  it('not started: its minutes', () => {
    renderOnSide(<ModuleTile module={kb} index={2} moduleKey="board" to="/x" />, { api: fakeLearner() });
    expect(screen.getByRole('link')).toHaveAccessibleName('Module 3: Kanban board, Not started · 8 min');
  });

  it('new for your role: its chip', () => {
    renderOnSide(<ModuleTile module={{ ...kb, newForRole: true }} index={2} moduleKey="board" to="/x" />, { api: fakeLearner() });
    const tile = screen.getByRole('link');
    expect(within(tile).getByText('New for your role')).toBeInTheDocument();
    expect(tile).toHaveAccessibleName('Module 3: Kanban board, Not started · 8 min, New for your role');
  });

  it('the current module (Up next) stands out in the brand colour and says so', () => {
    renderOnSide(<ModuleTile module={tk} index={1} moduleKey="tasks" to="/x" current />, { api: fakeLearner() });
    const tile = screen.getByRole('link');
    expect(tile).toHaveAttribute('data-current', 'true');
    expect(tile.className).toContain('border-brand');
    expect(tile).toHaveAccessibleName('Module 2: Tasks, 1 of 3 lessons, up next');
  });

  it('a long name wraps inside the tile (no sideways scroll)', () => {
    renderOnSide(<ModuleTile module={{ ...kb, title: 'A very long module name that an administrator typed in one go' }} index={2} moduleKey={null} to="/x" />, { api: fakeLearner() });
    expect(screen.getByText('A very long module name that an administrator typed in one go').closest('.break-words')).not.toBeNull();
  });
});

describe('LessonTile: a plain course’s lesson as a tile', () => {
  const [l1, l2, l3] = detail().lessons as [LessonOutline, LessonOutline, LessonOutline];
  it('done / not started: one link to the lesson, its kind and minutes', () => {
    const { container } = renderOnSide(
      <ol>
        <LessonTile lesson={l1} index={0} to="/training/courses/c1/lessons/l1" />
        <LessonTile lesson={l2} index={1} to="/training/courses/c1/lessons/l2" current />
      </ol>,
      { api: fakeLearner() },
    );
    expect(container.querySelector(NESTED)).toBeNull();
    expect(screen.getByRole('link', { name: 'Lesson 1: Welcome, Done' })).toHaveAttribute('href', '/training/courses/c1/lessons/l1');
    expect(screen.getByRole('link', { name: 'Lesson 2: Make a task, Step-by-step guide · 8 min, up next' })).toHaveAttribute('data-current', 'true');
  });

  it('locked (in order): not a link, and says why', () => {
    const { container } = renderOnSide(<LessonTile lesson={l3} index={2} to="/x" />, { api: fakeLearner() });
    expect(container.querySelector('a')).toBeNull();
    expect(screen.getByText('Locked')).toBeInTheDocument();
    expect(screen.getByText('Finish the lessons before it first.')).toHaveClass('sr-only');
  });
});
