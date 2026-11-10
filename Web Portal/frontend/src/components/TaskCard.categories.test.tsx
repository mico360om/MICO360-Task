import { describe, it, expect, afterEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { TaskCard, type TaskCardTask } from './TaskCard';
import { useDensityStore } from '../lib/density';

afterEach(() => act(() => useDensityStore.getState().set('comfortable')));

const base: TaskCardTask = { key: 'RIG-1', title: 'Check the panel', priority: 'NORMAL', progress: 0, assignees: [] };
const cats = [
  { id: 'c1', name: 'Electrical', color: 'teal', retired: false },
  { id: 'c2', name: 'HSE', color: 'pink', retired: false },
  { id: 'c3', name: 'Civil', color: 'gold', retired: true },
];
const chips = () => [...document.querySelectorAll('[data-category-chip]')].map((el) => el.getAttribute('aria-label'));

describe('TaskCard: categories (1.24)', () => {
  it('Comfortable: up to two chips, then “+1” naming the rest', () => {
    render(<TaskCard task={{ ...base, categories: cats }} />);
    expect(chips()).toEqual(['Category: Electrical', 'Category: HSE']);
    expect(screen.getByLabelText('and 1 more: Civil')).toHaveTextContent('+1');
  });

  it('Compact: one chip; Detailed: every one (a retired one says so)', () => {
    act(() => useDensityStore.getState().set('compact'));
    const { unmount } = render(<TaskCard task={{ ...base, categories: cats }} />);
    expect(chips()).toEqual(['Category: Electrical']);
    expect(screen.getByLabelText('and 2 more: HSE, Civil')).toBeInTheDocument();
    unmount();
    act(() => useDensityStore.getState().set('detailed'));
    render(<TaskCard task={{ ...base, categories: cats }} />);
    expect(chips()).toEqual(['Category: Electrical', 'Category: HSE', 'Category: Civil (retired)']);
  });

  it('none: no chips', () => {
    render(<TaskCard task={{ ...base, categories: [] }} />);
    expect(chips()).toEqual([]);
  });

  it('“Needs a category”: a small mark in words when its project asks for one and it has none', () => {
    const { unmount } = render(<TaskCard task={{ ...base, categories: [], needsCategory: true }} />);
    expect(screen.getByText('Needs a category')).toBeInTheDocument();
    unmount();
    render(<TaskCard task={{ ...base, categories: [] }} />);
    expect(screen.queryByText('Needs a category')).toBeNull();
  });
});
