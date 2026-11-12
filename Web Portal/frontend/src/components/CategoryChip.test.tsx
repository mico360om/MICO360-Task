import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CategoryChip, CategoryChips } from './CategoryChip';
import { CATEGORY_TONES } from '../lib/task-categories';

const cats = [
  { id: 'a', name: 'Civil', color: 'teal', retired: false },
  { id: 'b', name: 'Electrical', color: 'gold', retired: false },
  { id: 'c', name: 'HSE', color: 'pink', retired: true },
];

describe('CategoryChip (1.24)', () => {
  it('names the category, says it is a category and carries its colours for light and dark', () => {
    render(<CategoryChip category={cats[0]!} />);
    const chip = screen.getByText('Civil').closest('[data-category-chip]') as HTMLElement;
    expect(chip).toHaveAttribute('data-category-chip', 'a');
    expect(chip).toHaveAccessibleName('Category: Civil');
    expect(chip.style.getPropertyValue('--cat-light-text')).toBe(CATEGORY_TONES.teal.light.text);
    expect(chip.style.getPropertyValue('--cat-dark-soft')).toBe(CATEGORY_TONES.teal.dark.soft);
  });
  it('marks a retired one', () => {
    render(<CategoryChip category={cats[2]!} />);
    expect(screen.getByText('HSE').closest('[data-category-chip]')).toHaveAccessibleName('Category: HSE (retired)');
  });
  it('a row shows as many as its density allows and "+N" for the rest, which names them', () => {
    render(<CategoryChips categories={cats} density="comfortable" />);
    expect(screen.getAllByText(/Civil|Electrical|HSE/).map((e) => e.textContent)).toEqual(['Civil', 'Electrical']);
    expect(screen.getByText('+1')).toHaveAttribute('title', 'HSE');
  });
  it('nothing for none', () => {
    const { container } = render(<CategoryChips categories={[]} density="detailed" />);
    expect(container).toBeEmptyDOMElement();
  });
});
