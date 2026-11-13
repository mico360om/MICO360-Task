import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ProgressRing } from './ProgressRing';

/** The arc drawn of the ring's length (stroke-dasharray "drawn rest"). */
const drawn = (el: HTMLElement) => {
  const arc = el.querySelector('[data-ring-arc]');
  if (!arc) return 0;
  const [on] = (arc.getAttribute('stroke-dasharray') ?? '0 0').split(' ').map(Number);
  return on;
};
const length = (el: HTMLElement) => Number(el.querySelector('[data-ring-track]')!.getAttribute('data-length'));

describe('ProgressRing', () => {
  it('one image with its words for screen readers; shows “done / total”', () => {
    render(<ProgressRing done={1} total={8} label="1 of 8 modules done" />);
    const ring = screen.getByRole('img', { name: '1 of 8 modules done' });
    expect(ring).toHaveTextContent('1 / 8');
    // Its drawing and digits are inside the image (not read twice).
    expect(ring.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  it('nothing done: only the track', () => {
    render(<ProgressRing done={0} total={8} label="0 of 8 modules done" />);
    const ring = screen.getByRole('img');
    expect(ring).toHaveTextContent('0 / 8');
    expect(drawn(ring)).toBe(0);
  });

  it('part done: that share of the ring, in the brand colour', () => {
    render(<ProgressRing done={2} total={8} label="2 of 8 modules done" />);
    const ring = screen.getByRole('img');
    expect(drawn(ring)).toBeCloseTo(length(ring) / 4, 3);
    expect(ring.querySelector('[data-ring-arc]')!.getAttribute('class')).toContain('stroke-brand');
  });

  it('all done: the whole ring, in the Done green', () => {
    render(<ProgressRing done={8} total={8} label="8 of 8 modules done" />);
    const ring = screen.getByRole('img');
    expect(drawn(ring)).toBeCloseTo(length(ring), 3);
    expect(ring.querySelector('[data-ring-arc]')!.getAttribute('class')).toContain('stroke-status-done');
    expect(ring).toHaveAttribute('data-complete', 'true');
  });

  it('never more than full, never less than empty; a course with nothing to count draws nothing', () => {
    const { rerender } = render(<ProgressRing done={9} total={8} label="all" />);
    expect(drawn(screen.getByRole('img'))).toBeCloseTo(length(screen.getByRole('img')), 3);
    rerender(<ProgressRing done={0} total={0} label="none" />);
    expect(drawn(screen.getByRole('img'))).toBe(0);
    expect(screen.getByRole('img')).toHaveTextContent('0 / 0');
  });

  it('a quiz score (13 Nov): its own words in the middle, the pass mark as a notch, the result’s colour', () => {
    const { rerender } = render(<ProgressRing done={50} total={100} text="50%" mark={0.75} tone="danger" size={64} label="Score 50%, pass mark 75%" />);
    const ring = screen.getByRole('img', { name: 'Score 50%, pass mark 75%' });
    expect(ring).toHaveTextContent('50%');
    expect(ring).not.toHaveTextContent('/');
    expect(drawn(ring)).toBeCloseTo(length(ring) / 2, 3);
    expect(ring.querySelector('[data-ring-arc]')!.getAttribute('class')).toContain('stroke-danger');
    // The notch sits three quarters of the way round (the drawing starts at the top, clockwise).
    const notch = ring.querySelector('[data-ring-mark]')!;
    expect(notch).not.toBeNull();
    expect(Number(notch.getAttribute('x1'))).toBeCloseTo(32, 0);
    expect(Number(notch.getAttribute('y1'))).toBeLessThan(32);
    rerender(<ProgressRing done={80} total={100} text="80%" tone="success" label="Score 80%" />);
    expect(screen.getByRole('img').querySelector('[data-ring-arc]')!.getAttribute('class')).toContain('stroke-success');
    expect(screen.getByRole('img').querySelector('[data-ring-mark]')).toBeNull();
  });

  it('its size', () => {
    render(<ProgressRing done={1} total={2} size={64} label="1 of 2" />);
    const svg = screen.getByRole('img').querySelector('svg')!;
    expect(svg).toHaveAttribute('width', '64');
    expect(svg).toHaveAttribute('height', '64');
  });
});
