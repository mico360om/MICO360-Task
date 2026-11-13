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

  it('its size', () => {
    render(<ProgressRing done={1} total={2} size={64} label="1 of 2" />);
    const svg = screen.getByRole('img').querySelector('svg')!;
    expect(svg).toHaveAttribute('width', '64');
    expect(svg).toHaveAttribute('height', '64');
  });
});
