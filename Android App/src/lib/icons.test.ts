import { describe, it, expect } from 'vitest';
import { isDeepStrictEqual } from 'node:util';
import {
  CAL_ICONS,
  ICON_NAMES,
  KIT_ICONS,
  MISC_ICONS,
  NAV_ICONS,
  PROJECT_ICONS,
  UI_ICONS,
  iconDef,
  isIconName,
  type CalKey,
  type KitKey,
  type NavKey,
  type ProjectIconKey,
  type Shape,
  type UiKey,
} from './icons';
import { PROJECT_ICON_KEYS } from './project-identity';
import { appSource as src, hasWeb, loadWebTsx, readWeb, svgDrawingsIn, svgShapes } from '../testing/web-source';

/** 'BellOffIcon' → 'bellOff' (an export of chat/icons.tsx → its key in UI_ICONS). */
const uiKey = (name: string) => (name.charAt(0).toLowerCase() + name.slice(1, -'Icon'.length)) as UiKey;

/** Same shapes, in the same order (a missing key and an undefined one are the same; key order doesn't count). */
const plain = (v: unknown): unknown => JSON.parse(JSON.stringify(v));
const isDeepStrictEqualShapes = (a: readonly Shape[], b: readonly Shape[]) => isDeepStrictEqual(plain(a), plain(b));

// Final review L7: a shape the app's Icon can't draw is never skipped quietly.
describe('svgShapes', () => {
  const svg = (...children: unknown[]) => ({ type: 'svg', props: { strokeWidth: 2 }, children });
  it.each(['line', 'polyline', 'polygon', 'ellipse'])('throws on <%s> inside an svg', (el) => {
    expect(() => svgShapes(svg({ type: el, props: {}, children: [] }))).toThrow(new RegExp(`<${el}>`));
  });
  it('reads path, circle and rect, and walks past the HTML around an svg', () => {
    const tree = { type: 'span', props: {}, children: [svg({ type: 'path', props: { d: 'M1 1' }, children: [] }, { type: 'circle', props: { cx: 1, cy: 2, r: 3 }, children: [] })] };
    expect(svgShapes(tree)).toMatchObject({ strokeWidth: 2, shapes: [{ el: 'path', d: 'M1 1' }, { el: 'circle', cx: 1, cy: 2, r: 3 }] });
  });
});

/** How a shape is written in the website's JSX. */
function attrText(s: Shape): string {
  if (s.el === 'circle') return `cx="${s.cx}" cy="${s.cy}" r="${s.r}"`;
  if (s.el === 'rect') return `x="${s.x}" y="${s.y}" width="${s.width}" height="${s.height}"${s.rx !== undefined ? ` rx="${s.rx}"` : ''}`;
  return `d="${s.d}"${s.fill ? ' fill="currentColor"' : ''}${s.fillOpacity !== undefined ? ` fillOpacity="${s.fillOpacity}"` : ''}`;
}

describe.skipIf(!hasWeb('frontend/src/components/Sidebar.tsx', 'frontend/src/components/meeting/kit.tsx', 'frontend/src/components/chat/icons.tsx', 'frontend/src/lib/project-icons.tsx'))('the website’s own icons', () => {
  it('nav = Sidebar.tsx I, same keys and order', () => {
    const I = (loadWebTsx('frontend/src/components/Sidebar.tsx', { expose: ['I'] }).__exposed as { I: Record<string, unknown> }).I;
    expect(Object.keys(NAV_ICONS)).toEqual(Object.keys(I));
    for (const k of Object.keys(I)) expect(NAV_ICONS[k as NavKey].shapes, k).toEqual(svgShapes(I[k]).shapes);
    expect(readWeb('frontend/src/components/Sidebar.tsx')).toMatch(/function NavIcon[^]*?strokeWidth="1\.8"/);
    for (const k of Object.keys(NAV_ICONS)) expect(NAV_ICONS[k as NavKey].strokeWidth, k).toBe(1.8);
  });

  it('kit = meeting/kit.tsx Icon (shapes and stroke)', () => {
    const Icon = loadWebTsx('frontend/src/components/meeting/kit.tsx').Icon as Record<string, unknown>;
    expect(Object.keys(KIT_ICONS)).toEqual(Object.keys(Icon));
    for (const k of Object.keys(Icon)) {
      const w = svgShapes(Icon[k]);
      expect(KIT_ICONS[k as KitKey], k).toMatchObject({ shapes: w.shapes, strokeWidth: w.strokeWidth });
    }
  });

  it('ui = chat/icons.tsx exports, star filled and the ticks included', () => {
    const m = loadWebTsx('frontend/src/components/chat/icons.tsx') as Record<string, (p: object) => unknown>;
    const names = Object.keys(m).filter((n) => n.endsWith('Icon'));
    expect(names.length).toBeGreaterThan(25);
    for (const name of names) {
      const w = svgShapes(m[name]!({}));
      expect(UI_ICONS[uiKey(name)], name).toMatchObject({ shapes: w.shapes, strokeWidth: w.strokeWidth });
    }
    expect(Object.keys(UI_ICONS).sort()).toEqual([...names.map(uiKey), 'starFilled', 'tick', 'tickDouble'].sort());
    expect(UI_ICONS.starFilled).toMatchObject({ shapes: svgShapes(m.StarIcon!({ filled: true })).shapes, filled: true });
    expect(UI_ICONS.star.filled).toBeFalsy();
    expect(UI_ICONS.tick.shapes).toEqual(svgShapes(m.Ticks!({ double: false })).shapes);
    expect(UI_ICONS.tickDouble).toMatchObject({ shapes: svgShapes(m.Ticks!({ double: true })).shapes, viewBox: '0 0 20 12' });
  });

  it('project = PROJECT_ICON_PATHS', () => {
    const web = loadWebTsx('frontend/src/lib/project-icons.tsx') as { PROJECT_ICON_KEYS: string[]; PROJECT_ICON_PATHS: Record<string, string[]> };
    expect(Object.keys(PROJECT_ICONS)).toEqual(web.PROJECT_ICON_KEYS);
    for (const k of web.PROJECT_ICON_KEYS) expect(PROJECT_ICONS[k as ProjectIconKey].shapes.map((s) => (s as { d: string }).d), k).toEqual(web.PROJECT_ICON_PATHS[k]);
  });

  // Final review L7: exactly one of the source file's own <svg>s — every shape, in order, its stroke
  // width and fill — not shapes found anywhere in the file.
  it('misc: each icon is exactly one of the drawings in its source file', () => {
    for (const [k, def] of Object.entries(MISC_ICONS)) {
      const drawings = svgDrawingsIn(`frontend/src/${def.source}`);
      expect(drawings.length, k).toBeGreaterThan(0);
      const same = drawings.filter((d) => isDeepStrictEqualShapes(d.shapes, def.shapes) && d.strokeWidth === (def.strokeWidth > 0 ? def.strokeWidth : undefined) && !!d.filled === !!def.filled);
      expect(same.length, `${k} (${def.source})`).toBeGreaterThan(0);
      for (const s of def.shapes) expect(readWeb(`frontend/src/${def.source}`), k).toContain(attrText(s)); // written as the app writes it, too
    }
  });
});

it('the project icons are the app’s project-icon keys, in the same order', () => {
  expect(Object.keys(PROJECT_ICONS)).toEqual([...PROJECT_ICON_KEYS]);
});

describe.skipIf(!hasWeb('frontend/src/components/calendar/calendar-ui.tsx'))('the website’s calendar status icons', () => {
  it('cal = calendar-ui.tsx STATUS_META icons, every status, same shapes and stroke', () => {
    const meta = loadWebTsx('frontend/src/components/calendar/calendar-ui.tsx').STATUS_META as Record<string, { icon: unknown }>;
    expect(Object.keys(CAL_ICONS)).toEqual(Object.keys(meta));
    for (const k of Object.keys(meta)) {
      const w = svgShapes(meta[k]!.icon);
      expect(w.shapes.length, k).toBeGreaterThan(0);
      expect(CAL_ICONS[k as CalKey], k).toMatchObject({ shapes: w.shapes, strokeWidth: w.strokeWidth });
    }
    expect(CAL_ICONS['in-progress'].shapes.some((sh) => sh.el === 'path' && sh.fill)).toBe(true); // the half-filled circle
  });
});

it('the calendar draws each status with the website’s calendar icon', () => {
  const row = src('components/calendar/CalendarTaskRow.tsx');
  expect(row).toContain('<Icon name={`cal.${item.status}`}');
  expect(row).not.toMatch(/kit\.lock|s\.ring/);
  for (const k of ['overdue', 'blocked', 'in-progress', 'todo', 'done', 'projected']) expect(isIconName(`cal.${k}`), k).toBe(true);
});

it('every name resolves and nothing else does', () => {
  expect(ICON_NAMES.length).toBe(Object.keys(NAV_ICONS).length + Object.keys(KIT_ICONS).length + Object.keys(UI_ICONS).length + Object.keys(PROJECT_ICONS).length + Object.keys(MISC_ICONS).length + Object.keys(CAL_ICONS).length);
  for (const n of ICON_NAMES) expect(iconDef(n).shapes.length, n).toBeGreaterThan(0);
  expect(iconDef('kit.chat')).toBe(KIT_ICONS.chat);
  expect(isIconName('nav.dashboard')).toBe(true);
  expect(isIconName('misc.dots')).toBe(true);
  expect(isIconName('nav.nope')).toBe(false);
  expect(isIconName('🏠')).toBe(false);
  expect(isIconName(undefined)).toBe(false);
  expect(MISC_ICONS.dots).toMatchObject({ filled: true, shapes: [{ el: 'circle', cx: 5, cy: 12, r: 1.8 }, { el: 'circle', cx: 12, cy: 12, r: 1.8 }, { el: 'circle', cx: 19, cy: 12, r: 1.8 }] });
});

it('Icon draws the shapes with react-native-svg and stays out of TalkBack without a label', () => {
  const s = src('components/Icon.tsx');
  expect(s).toMatch(/from 'react-native-svg'/);
  expect(s).toMatch(/importantForAccessibility=\{label \? 'yes' : 'no-hide-descendants'\}/);
  expect(s).toMatch(/accessibilityRole=\{label \? 'image' : undefined\}/);
  expect(s).toMatch(/strokeLinecap="round"/);
  expect(s).toMatch(/strokeLinejoin="round"/);
});
