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

  it('a quiz score: its own words in the middle and the result’s colour', () => {
    const { rerender } = render(<ProgressRing done={50} total={100} text="50%" tone="danger" size={64} label="Score 50%, pass mark 75%" />);
    const ring = screen.getByRole('img', { name: 'Score 50%, pass mark 75%' });
    expect(ring).toHaveTextContent('50%');
    expect(ring).not.toHaveTextContent('/');
    expect(drawn(ring)).toBeCloseTo(length(ring) / 2, 3);
    expect(ring.querySelector('[data-ring-arc]')!.getAttribute('class')).toContain('stroke-danger');
    rerender(<ProgressRing done={80} total={100} text="80%" tone="success" label="Score 80%" />);
    expect(screen.getByRole('img').querySelector('[data-ring-arc]')!.getAttribute('class')).toContain('stroke-success');
  });

  // 1.23.36: the owner saw "a small black mark" on a 100% score — the pass mark's notch. The pass mark is said in words
  // beside the ring ("4 of 4 right · pass mark 70%"); the ring draws only its track and its arc, and nothing at its start.
  it.each([0, 50, 100])('no stray mark at %i%%: only the track and (when there is one) the arc', (pct) => {
    render(<ProgressRing done={pct} total={100} text={`${pct}%`} tone={pct >= 70 ? 'success' : 'danger'} size={64} label={`Score ${pct}%`} />);
    const svg = screen.getByRole('img').querySelector('svg')!;
    expect(svg.querySelector('[data-ring-mark]')).toBeNull();
    expect(svg.querySelectorAll('line, path, rect, polyline')).toHaveLength(0);
    const arc = svg.querySelector('[data-ring-arc]');
    // Nothing drawn at 0 (a round cap alone would be a dot); a full ring has no caps to overlap.
    if (pct === 0) expect(arc).toBeNull();
    else expect(arc).not.toBeNull();
    if (pct === 100) expect(arc!.getAttribute('stroke-linecap')).toBe('butt');
    expect(svg.querySelectorAll('circle')).toHaveLength(pct === 0 ? 1 : 2);
  });

  it('its size', () => {
    render(<ProgressRing done={1} total={2} size={64} label="1 of 2" />);
    const svg = screen.getByRole('img').querySelector('svg')!;
    expect(svg).toHaveAttribute('width', '64');
    expect(svg).toHaveAttribute('height', '64');
  });
});
