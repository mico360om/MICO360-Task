import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Toggle } from './Toggle';

describe('Toggle', () => {
  it('is a named switch that reports its state and calls onChange', () => {
    const onChange = vi.fn();
    render(<Toggle on={false} onChange={onChange} label="Show to client" />);
    const sw = screen.getByRole('switch', { name: 'Show to client' });
    expect(sw).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(sw);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  // A finger needs a bigger target than the 24px track: on touch screens the switch's button is
  // 44px tall around the same-size track (the drawn track and thumb stay as they are).
  it('keeps the drawn track inside a button that grows to 44px on touch screens', () => {
    render(<Toggle on label="Weekly summary" onChange={() => {}} />);
    const sw = screen.getByRole('switch', { name: 'Weekly summary' });
    expect(sw.className).toContain('[@media(pointer:coarse)]:min-h-11');
    const track = sw.querySelector('[data-switch-track]');
    expect(track).not.toBeNull();
    expect(track!.className).toContain('h-6');
    expect(track!.className).toContain('bg-brand');
  });
});
