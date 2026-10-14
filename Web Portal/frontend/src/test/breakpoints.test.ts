import { describe, it, expect } from 'vitest';

// The Tailwind config is plain JavaScript without type declarations: load it as data.
const configPath: string = '../../tailwind.config.js';
const config = ((await import(/* @vite-ignore */ configPath)) as { default: { theme: { screens?: Record<string, string> } } }).default;

/**
 * Sizes in the app are in rem, so they grow when a reader raises the browser's default text size.
 * The breakpoints must grow with them (em), or a laptop with large text keeps the desktop layout
 * with a third less room: text is cut, controls overlap, buttons are squeezed. In em, larger text
 * simply gets the tablet or phone layout — the same thing page zoom does.
 */
describe('responsive breakpoints', () => {
  const screens = config.theme.screens ?? {};

  it('are the usual widths, expressed in em', () => {
    expect(screens).toEqual({ sm: '40em', md: '48em', lg: '64em', xl: '80em', '2xl': '96em' });
  });

  it('equal the familiar pixel widths at the default text size (16px)', () => {
    const px = Object.fromEntries(Object.entries(screens).map(([name, value]) => [name, parseFloat(value) * 16]));
    expect(px).toEqual({ sm: 640, md: 768, lg: 1024, xl: 1280, '2xl': 1536 });
  });
});
