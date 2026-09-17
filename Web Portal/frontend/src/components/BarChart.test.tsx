import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BarChart } from './BarChart';

function barPct(el: Element): number {
  const w = (el as HTMLElement).style.width; // e.g. "66.6667%"
  return parseFloat(w);
}

describe('BarChart', () => {
  const data = [
    { label: 'To Do', value: 4 },
    { label: 'In Progress', value: 2 },
    { label: 'Done', value: 6 },
  ];

  it('renders a labelled bar with its value for each datum', () => {
    render(<BarChart data={data} />);
    expect(screen.getByText('To Do')).toBeInTheDocument();
    expect(screen.getByText('Done')).toBeInTheDocument();
    expect(screen.getByText('6')).toBeInTheDocument();
    // one bar fill per datum
    const bars = document.querySelectorAll('[data-bar]');
    expect(bars.length).toBe(3);
  });

  it('scales bar widths (as a percentage of the max) to the maximum value', () => {
    render(<BarChart data={data} />);
    const bars = [...document.querySelectorAll('[data-bar]')];
    const [todo, inProgress, done] = bars.map(barPct);
    // Done (6, max) is widest at 100%; In Progress (2) is the narrowest
    expect(done).toBe(100);
    expect(inProgress).toBeLessThan(todo!);
    expect(inProgress).toBeGreaterThan(0);
  });

  it('appends the unit to each value label', () => {
    render(<BarChart data={[{ label: 'MICO', value: 40 }]} unit="%" />);
    expect(screen.getByText('40%')).toBeInTheDocument();
  });

  it('renders an empty-state message when there is no data', () => {
    render(<BarChart data={[]} />);
    expect(screen.getByText(/no data/i)).toBeInTheDocument();
  });
});
