import { describe, it, expect } from 'vitest';
import postcss from 'postcss';
import tailwind from 'tailwindcss';

// 1.23.8: the `detailed:` variant (Detailed rows, every screen) and the `rail:` variant (the side menu as
// its icon rail: a tablet always, a desktop when the person folded it). tailwind.config.js.
const configPath: string = '../../tailwind.config.js';
const config = ((await import(/* @vite-ignore */ configPath)) as { default: Record<string, unknown> }).default;

async function cssFor(classes: string): Promise<string> {
  const result = await postcss([tailwind({ ...config, content: [{ raw: `<div class="${classes}"></div>`, extension: 'html' }] })]).process('@tailwind utilities;', { from: undefined });
  return result.css.replace(/\s+/g, ' ');
}
/** A rule's selector, found by its class, and its weight in classes / attributes / pseudo-classes. */
const selectorIn = (css: string, escapedClass: string, from = 0) => {
  const at = css.indexOf(escapedClass, from);
  const start = Math.max(css.lastIndexOf('}', at), css.lastIndexOf('{', at)) + 1;
  return css.slice(start, css.indexOf('{', at)).trim();
};
const weight = (selector: string) => (selector.replace(/\\./g, '_').match(/\.[\w-]+|\[[^\]]+\]|:(?!:)[\w-]+/g) ?? []).length;

describe('the detailed: variant', () => {
  it('applies with <html data-density="detailed"> on every screen (no width or pointer media)', async () => {
    const css = await cssFor('line-clamp-2 detailed:line-clamp-none');
    expect(css).toContain(':root[data-density="detailed"] .detailed\\:line-clamp-none {');
    const before = css.slice(0, css.indexOf(':root[data-density="detailed"]'));
    expect(before.lastIndexOf('@media')).toBeLessThan(before.lastIndexOf('}'));
    expect(weight(selectorIn(css, '.detailed\\:line-clamp-none'))).toBeGreaterThan(weight(selectorIn(css, '.line-clamp-2')));
  });
});

describe('the rail: variant', () => {
  it('is the rail on a tablet (768–1023px) always, and from 1024px only when folded', async () => {
    const css = await cssFor('w-16 lg:w-60 rail:w-16');
    expect(css).toMatch(/@media \(min-width: 48em\) \{ @media not all and \(min-width: 64em\) \{ \.rail\\:w-16 \{ width: 4rem \} \} \}/);
    expect(css).toMatch(/@media \(min-width: 64em\) \{ :root\[data-sidebar="collapsed"\] \.rail\\:w-16 \{ width: 4rem \}/);
  });

  it('a folded desktop menu outranks the open one (lg:w-60)', async () => {
    const css = await cssFor('lg:w-60 rail:w-16');
    const folded = selectorIn(css, '.rail\\:w-16', css.indexOf('data-sidebar'));
    expect(folded).toBe(':root[data-sidebar="collapsed"] .rail\\:w-16');
    expect(weight(folded)).toBeGreaterThan(weight(selectorIn(css, '.lg\\:w-60')));
  });
});

describe('the scheme’s colours as classes', () => {
  it('a fill, its soft tint, and its words in the text tone', async () => {
    const css = await cssFor('bg-status-progress bg-prio-high-soft text-status-progress text-overdue border-overdue bg-health-risk');
    expect(css).toContain('.bg-status-progress { --tw-bg-opacity: 1; background-color: rgb(var(--c-status-progress) / var(--tw-bg-opacity, 1)) }');
    expect(css).toContain('.bg-prio-high-soft { --tw-bg-opacity: 1; background-color: rgb(var(--c-prio-high-soft) / var(--tw-bg-opacity, 1)) }');
    expect(css).toContain('.text-status-progress { --tw-text-opacity: 1; color: rgb(var(--c-status-progress-text) / var(--tw-text-opacity, 1)) }');
    expect(css).toContain('.text-overdue { --tw-text-opacity: 1; color: rgb(var(--c-overdue-text) / var(--tw-text-opacity, 1)) }');
    expect(css).toContain('.border-overdue { --tw-border-opacity: 1; border-color: rgb(var(--c-overdue) / var(--tw-border-opacity, 1)) }');
    expect(css).toContain('background-color: rgb(var(--c-health-risk) /');
  });
});
