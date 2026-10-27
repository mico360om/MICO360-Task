import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LineChart } from './LineChart';

describe('LineChart', () => {
  it('renders an accessible chart that plots each series with a legend', () => {
    render(
      <LineChart
        ariaLabel="Completion trend"
        labels={['Mon', 'Tue', 'Wed']}
        series={[
          { name: 'Completed', color: 'rgb(10,10,10)', values: [1, 2, 3] },
          { name: 'Created', color: 'rgb(20,20,20)', values: [0, 4, 1] },
        ]}
      />,
    );
    const chart = screen.getByRole('img', { name: /completion trend/i });
    expect(chart).toBeInTheDocument();
    // a polyline is drawn per series
    expect(chart.querySelectorAll('polyline').length).toBe(2);
    // legend names both series
    expect(screen.getByText('Completed')).toBeInTheDocument();
    expect(screen.getByText('Created')).toBeInTheDocument();
  });

  it('shows an empty state when there is nothing to plot', () => {
    render(<LineChart ariaLabel="Burndown" labels={[]} series={[]} />);
    expect(screen.getByText(/no data/i)).toBeInTheDocument();
  });

  it('supports a dashed reference series (e.g. ideal burndown)', () => {
    render(
      <LineChart
        ariaLabel="Burndown"
        labels={['d1', 'd2']}
        series={[
          { name: 'Remaining', color: 'rgb(1,1,1)', values: [5, 3] },
          { name: 'Ideal', color: 'rgb(2,2,2)', values: [5, 0], dashed: true },
        ]}
      />,
    );
    const chart = screen.getByRole('img', { name: /burndown/i });
    const dashed = [...chart.querySelectorAll('polyline')].some((p) => p.getAttribute('stroke-dasharray'));
    expect(dashed).toBe(true);
    expect(screen.getByText('Ideal')).toBeInTheDocument();
  });
});

describe('LineChart: edges and gaps', () => {
  it('keeps the first and last axis labels inside the chart (anchored to their edge, not centred past it)', () => {
    render(<LineChart ariaLabel="Weeks" labels={['4 Oct', '11 Oct', '18 Oct', '25 Oct']} series={[{ name: 'Late', color: 'rgb(1,1,1)', values: [1, 2, 3, 4] }]} maxTicks={4} />);
    const ticks = [...screen.getByRole('img', { name: 'Weeks' }).querySelectorAll('text')].filter((t) => /Oct/.test(t.textContent ?? ''));
    expect(ticks.map((t) => [t.textContent, t.getAttribute('text-anchor')])).toEqual([
      ['4 Oct', 'start'],
      ['11 Oct', 'middle'],
      ['18 Oct', 'middle'],
      ['25 Oct', 'end'],
    ]);
  });

  it('leaves a gap (no line, no point) where a value is missing, so charts of the same weeks line up', () => {
    render(<LineChart ariaLabel="Pass rate" labels={['a', 'b', 'c', 'd', 'e']} series={[{ name: 'Pass rate', color: 'rgb(1,1,1)', values: [null, 100, null, 80, 90] }]} unit="%" />);
    const chart = screen.getByRole('img', { name: 'Pass rate' });
    const lines = [...chart.querySelectorAll('polyline')].map((p) => p.getAttribute('points')!.trim().split(' ').length);
    // 100 stands alone (a dot), then 80–90 is one line.
    expect(lines).toEqual([2]);
    expect(chart.querySelectorAll('circle[data-point]').length).toBe(3);
  });

  it('shows the empty note when every value is missing', () => {
    render(<LineChart ariaLabel="None" labels={['a', 'b']} series={[{ name: 'x', color: 'rgb(1,1,1)', values: [null, null] }]} />);
    expect(screen.getByText(/no data/i)).toBeInTheDocument();
  });
});
