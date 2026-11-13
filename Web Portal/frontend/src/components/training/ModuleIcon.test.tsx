import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LEARNING_HUB_ICON, NAV_ICONS } from '../Sidebar';
import { ModuleIcon } from './ModuleIcon';
import { BOOK_PATHS } from './training-ui';

/** The drawing inside an <svg> (its shapes' markup). */
const shapes = (el: Element) => el.innerHTML;
const markup = (node: ReactNode) => renderToStaticMarkup(<>{node}</>);

describe('ModuleIcon: a module’s feature icon, the left menu’s own', () => {
  it('a decorative svg (hidden from screen readers), sized and classed by the caller', () => {
    const { container } = render(<ModuleIcon moduleKey="tasks" size={24} className="text-brand" />);
    const svg = container.querySelector('svg')!;
    expect(container.children).toHaveLength(1);
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg).toHaveAttribute('width', '24');
    expect(svg).toHaveAttribute('height', '24');
    expect(svg.getAttribute('class')).toContain('text-brand');
  });

  it.each([
    ['tasks', NAV_ICONS.tasks],
    ['board', NAV_ICONS.board],
    ['projects', NAV_ICONS.projects],
    ['calendar', NAV_ICONS.calendar],
    ['meetings', NAV_ICONS.meetings],
    ['chat', NAV_ICONS.chat],
    ['mico-ai', NAV_ICONS.ai],
    ['reports', NAV_ICONS.reports],
    ['management', NAV_ICONS.management],
    ['admin', NAV_ICONS.settings],
    ['portal', NAV_ICONS.clients],
    ['training', LEARNING_HUB_ICON],
  ])('%s: the same drawing as its menu item', (key, icon) => {
    const { container } = render(<ModuleIcon moduleKey={key} />);
    expect(shapes(container.querySelector('svg')!)).toBe(markup(icon));
  });

  it('Getting started (general): the brand mark, still hidden', () => {
    const { container } = render(<ModuleIcon moduleKey="general" size={20} />);
    const outer = container.querySelector('svg')!;
    expect(outer).toHaveAttribute('aria-hidden', 'true');
    expect(outer.querySelector('svg[aria-label="MICO360 Tasks"]')).not.toBeNull();
  });

  it('a module with no feature (an admin’s own, “Other lessons”) or none: the neutral book', () => {
    for (const key of [null, 'something-new']) {
      const { container, unmount } = render(<ModuleIcon moduleKey={key} />);
      expect(shapes(container.querySelector('svg')!)).toBe(markup(BOOK_PATHS));
      unmount();
    }
  });

  it('the Sidebar keeps its icon object: NAV_ICONS is the same `I` (the Android app copies it)', () => {
    expect(Object.keys(NAV_ICONS)).toEqual(expect.arrayContaining(['tasks', 'board', 'settings', 'clients', 'ai']));
  });
});
