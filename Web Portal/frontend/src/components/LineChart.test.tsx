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
