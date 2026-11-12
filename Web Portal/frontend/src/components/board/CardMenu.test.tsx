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

  it('stays on screen: a card near the bottom of the window opens its menu above the ⋯ (gate: on a phone it opened below the screen)', async () => {
    const realRect = HTMLElement.prototype.getBoundingClientRect;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.getAttribute('aria-label') === 'More actions for RIG-4') return { top: 760, bottom: 804, left: 300, right: 344, width: 44, height: 44, x: 300, y: 760, toJSON() {} } as DOMRect;
      if (this.getAttribute('role') === 'menu') return { top: 0, bottom: 120, left: 0, right: 256, width: 256, height: 120, x: 0, y: 0, toJSON() {} } as DOMRect;
      return realRect.call(this);
    });
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(812);
    render(<CardMenu taskKey="RIG-4" items={[{ label: 'Duplicate…', onSelect: vi.fn() }, { label: 'Move to another project…', onSelect: vi.fn() }]} />);
    await userEvent.click(screen.getByRole('button', { name: 'More actions for RIG-4' }));
    const menu = screen.getByRole('menu', { name: 'Actions for RIG-4' });
    // Above the button (760 - 4 - 120 = 636), not below it (808 + 120 > 812).
    expect(menu.style.top).toBe('636px');
    expect(screen.getByRole('menuitem', { name: 'Duplicate…' })).toHaveFocus();
  });

  it('a card near the top keeps its menu below the ⋯', async () => {
    const realRect = HTMLElement.prototype.getBoundingClientRect;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.getAttribute('aria-label') === 'More actions for RIG-4') return { top: 100, bottom: 144, left: 300, right: 344, width: 44, height: 44, x: 300, y: 100, toJSON() {} } as DOMRect;
      if (this.getAttribute('role') === 'menu') return { top: 0, bottom: 120, left: 0, right: 256, width: 256, height: 120, x: 0, y: 0, toJSON() {} } as DOMRect;
      return realRect.call(this);
    });
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(812);
    render(<CardMenu taskKey="RIG-4" items={[{ label: 'Duplicate…', onSelect: vi.fn() }]} />);
    await userEvent.click(screen.getByRole('button', { name: 'More actions for RIG-4' }));
    expect(screen.getByRole('menu', { name: 'Actions for RIG-4' }).style.top).toBe('148px');
  });
});
