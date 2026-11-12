import { afterEach, describe, expect, it } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import { TaskCard, type TaskCardTask } from './TaskCard';
import { useDensityStore } from '../lib/density';
import { findOnCard, readBoardSearch } from '../lib/board-search';

// Board search (10 Nov): what a found card marks.
afterEach(() => {
  act(() => useDensityStore.getState().set('comfortable'));
});

const base: TaskCardTask = {
  key: 'MICO-12',
  title: 'Pump overhaul',
  priority: 'NORMAL',
  progress: 0,
  description: 'First line of the work.\nCheck the relief valve on rig 3.',
  assignees: [
    { id: 'u1', name: 'Ada Lovelace' },
    { id: 'u2', name: 'Bob Stone' },
    { id: 'u3', name: 'Cy Young' },
    { id: 'u4', name: 'Sara Nasser' },
  ],
  tags: [
    { id: 'g1', name: 'Safety', color: '#0a0' },
    { id: 'g2', name: 'Weekly', color: '#00a' },
  ],
  project: { name: 'Rig Operations', code: 'RIG' },
};
const found = (words: string, task: TaskCardTask = base): TaskCardTask => ({ ...task, found: findOnCard(task, readBoardSearch(words)!) });
const marks = (el: HTMLElement) => Array.from(el.querySelectorAll('mark')).map((m) => m.textContent);

describe('TaskCard: board search marks', () => {
  it('marks the words in the title and the project, and the number when it was searched for', () => {
    const { container } = render(<TaskCard task={found('pump operations')} />);
    expect(marks(container)).toEqual(['Operations', 'Pump']);
    expect(container.querySelector('[data-task-key]')).not.toHaveAttribute('data-marked');
    const again = render(<TaskCard task={found('mico-12')} />);
    expect(again.container.querySelector('[data-task-key]')).toHaveAttribute('data-marked');
  });

  it('a word only in the description: the line it is in, under the title — in place of the first line on detailed cards', () => {
    act(() => useDensityStore.getState().set('detailed'));
    render(<TaskCard task={found('valve')} />);
    const line = screen.getByTestId('card-found');
    expect(line).toHaveTextContent('Check the relief valve on rig 3.');
    expect(marks(line)).toEqual(['valve']);
    expect(screen.queryByTestId('card-description')).toBeNull();
  });

  it('a tag found: its chip, marked — shown even on cards that otherwise show no tags', () => {
    const { container } = render(<TaskCard task={found('safety')} />);
    const tags = within(container).getByTestId('card-tags');
    expect(tags).toHaveTextContent('Safety');
    expect(tags).not.toHaveTextContent('Weekly');
    expect(tags.querySelector('[data-marked]')).toHaveTextContent('Safety');
  });

  it('a person found: their face comes first among the three shown, ringed; on detailed cards their name is marked', () => {
    const { container } = render(<TaskCard task={found('sara')} />);
    const faces = Array.from(container.querySelectorAll('[aria-label="Sara Nasser"], [aria-label="Ada Lovelace"], [aria-label="Bob Stone"], [aria-label="Cy Young"]')).map((el) => el.getAttribute('aria-label'));
    expect(faces).toEqual(['Sara Nasser', 'Ada Lovelace', 'Bob Stone']);
    expect(container.querySelector('[data-marked] [aria-label="Sara Nasser"]')).not.toBeNull();
    act(() => useDensityStore.getState().set('detailed'));
    const detailed = render(<TaskCard task={found('sara')} />);
    expect(marks(detailed.getAllByTestId('card-people').at(-1)!)).toEqual(['Sara']);
  });

  it('without a search nothing is marked', () => {
    const { container } = render(<TaskCard task={base} />);
    expect(container.querySelector('mark')).toBeNull();
    expect(container.querySelector('[data-marked]')).toBeNull();
    expect(screen.queryByTestId('card-found')).toBeNull();
  });
});
