import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CardMenu } from './CardMenu';

afterEach(() => vi.restoreAllMocks());

describe('A board card’s ⋯ menu', () => {
  it('takes focus on its first item only once it is placed and shown (a browser won’t focus a hidden element)', async () => {
    const seen: { visibility: string; top: string }[] = [];
    const focus = HTMLElement.prototype.focus;
    vi.spyOn(HTMLElement.prototype, 'focus').mockImplementation(function (this: HTMLElement, options?: FocusOptions) {
      const menu = this.closest<HTMLElement>('[role="menu"]');
      if (menu) seen.push({ visibility: menu.style.visibility, top: menu.style.top });
      return focus.call(this, options);
    });
    render(<CardMenu taskKey="RIG-4" items={[{ label: 'Move to another project…', onSelect: vi.fn() }]} />);
    await userEvent.click(screen.getByRole('button', { name: 'More actions for RIG-4' }));
    expect(screen.getByRole('menuitem', { name: 'Move to another project…' })).toHaveFocus();
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((s) => s.visibility !== 'hidden' && s.top !== '')).toBe(true);
  });

  it('is a 44px target on a touch screen', () => {
    render(<CardMenu taskKey="RIG-4" items={[{ label: 'Move to another project…', onSelect: vi.fn() }]} />);
    const button = screen.getByRole('button', { name: 'More actions for RIG-4' });
    expect(button.className).toContain('[@media(pointer:coarse)]:h-11');
    expect(button.className).toContain('[@media(pointer:coarse)]:w-11');
  });
});
