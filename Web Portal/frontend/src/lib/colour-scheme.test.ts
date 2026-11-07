import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  HEALTH_LEVELS,
  HEALTH_TOKEN,
  PRIORITY_LEVELS,
  PRIORITY_TONES,
  STATUS_KINDS,
  STATUS_TOKEN,
  STATUS_TONES,
  allTokens,
  healthLevel,
  statusTones,
  type Tone,
} from './colour-scheme';
import { HEALTH_CLASS, PRIORITY_CLASS, STATUS_CLASS, healthClass, priorityClass, statusClass, statusColour } from './colour-classes';
import { STATUS_META, STATUS_ORDER } from './taskStatus';

const css = readFileSync(resolve(__dirname, '../index.css'), 'utf8').replace(/\r\n/g, '\n');

/** The `--c-*: r g b;` values of one block of index.css. */
function block(selector: string): Map<string, string> {
  const start = css.indexOf(selector);
  expect(start, selector).toBeGreaterThanOrEqual(0);
  const body = css.slice(start, css.indexOf('}', start + selector.length));
  return new Map([...body.matchAll(/--c-([a-z0-9-]+):\s*(\d+)\s+(\d+)\s+(\d+)\s*;/g)].map(([, n, r, g, b]) => [n!, `${r} ${g} ${b}`]));
}
const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(' ');
const LIGHT = block(':root {');
const DARK_SYSTEM = block(":root:not([data-theme='light']) {");
const DARK = block(":root[data-theme='dark'] {");

const channel = (v: number) => {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const luminance = (triple: string) => {
  const [r, g, b] = triple.split(' ').map(Number) as [number, number, number];
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
};
const contrast = (a: string, b: string) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
};

describe('the colour scheme (1.23.8)', () => {
  it('index.css says exactly the scheme, in light and in both dark blocks', () => {
    for (const [name, tones] of allTokens()) {
      for (const [palette, tone] of [[LIGHT, tones.light], [DARK_SYSTEM, tones.dark], [DARK, tones.dark]] as const) {
        expect(palette.get(name), `--c-${name}`).toBe(rgb(tone.fill));
        expect(palette.get(`${name}-text`), `--c-${name}-text`).toBe(rgb(tone.text));
        expect(palette.get(`${name}-soft`), `--c-${name}-soft`).toBe(rgb(tone.soft));
      }
    }
    // The old per-category names are gone (one scheme, one set of names).
    expect(css).not.toMatch(/--c-cat-/);
  });

  it('reaches WCAG AA in light and dark: words 4.5:1 on cards, the page and their own tint; marks 3:1', () => {
    const problems: string[] = [];
    for (const [theme, palette, tone] of [
      ['light', LIGHT, (t: { light: Tone }) => t.light],
      ['dark', DARK, (t: { dark: Tone }) => t.dark],
    ] as const) {
      const grounds = ['surface', 'surface-2', 'ground'].map((g) => palette.get(g)!);
      for (const [name, tones] of allTokens()) {
        const t = tone(tones as never) as Tone;
        for (const g of [...grounds, rgb(t.soft)]) {
          const r = contrast(rgb(t.text), g);
          if (r < 4.5) problems.push(`${theme} ${name}-text on ${g}: ${r.toFixed(2)}`);
        }
        for (const g of grounds) {
          const r = contrast(rgb(t.fill), g);
          if (r < 3) problems.push(`${theme} ${name} on ${g}: ${r.toFixed(2)}`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it('tells the six statuses apart, and the four priorities, in each theme', () => {
    for (const theme of ['light', 'dark'] as const) {
      expect(new Set(STATUS_KINDS.map((k) => STATUS_TONES[k][theme].fill)).size).toBe(6);
      expect(new Set(PRIORITY_LEVELS.map((p) => PRIORITY_TONES[p][theme].fill)).size).toBe(4);
    }
  });

  it('owner’s scheme: To do slate, In progress blue, Blocked red, Review purple, Done green, Backlog grey', () => {
    const hue = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      if (max === min) return { h: 0, s: 0 };
      const d = max - min;
      const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
      return { h: (h * 60 + 360) % 360, s: d / (1 - Math.abs(max + min - 1)) };
    };
    const light = (k: (typeof STATUS_KINDS)[number]) => hue(STATUS_TONES[k].light.fill);
    expect(light('BLOCKED').h < 20 || light('BLOCKED').h > 340).toBe(true); // red
    expect(light('DONE').h).toBeGreaterThan(100);
    expect(light('DONE').h).toBeLessThan(170); // green
    expect(light('IN_PROGRESS').h).toBeGreaterThan(195);
    expect(light('IN_PROGRESS').h).toBeLessThan(230); // blue
    expect(light('REVIEW').h).toBeGreaterThan(250);
    expect(light('REVIEW').h).toBeLessThan(290); // purple
    expect(light('TODO').s).toBeLessThan(0.25); // slate: a grey-blue
    expect(light('TODO').h).toBeGreaterThan(200);
    expect(light('BACKLOG').s).toBeLessThan(0.1); // grey
    // Priorities: Urgent red, High orange.
    expect(hue(PRIORITY_TONES.HIGH.light.fill).h).toBeGreaterThan(15);
    expect(hue(PRIORITY_TONES.HIGH.light.fill).h).toBeLessThan(35);
  });

  it('health has its own names (not statuses) and reads the Management and Timeline words', () => {
    for (const h of HEALTH_LEVELS) expect(Object.values(STATUS_TOKEN)).not.toContain(HEALTH_TOKEN[h]);
    expect(healthLevel('GREEN')).toBe('ON_TRACK');
    expect(healthLevel('on-track')).toBe('ON_TRACK');
    expect(healthLevel('AMBER')).toBe('AT_RISK');
    expect(healthLevel('at-risk')).toBe('AT_RISK');
    expect(healthLevel('RED')).toBe('LATE');
    expect(healthLevel('late')).toBe('LATE');
    expect(healthLevel('no-target')).toBeNull();
    expect(healthClass('AMBER')).toBe(HEALTH_CLASS.AT_RISK);
    expect(healthClass('no-target')).toBeNull();
  });

  it('unknown kinds read as To do (statuses) and Normal (priorities)', () => {
    expect(statusTones('SOMETHING')).toBe(STATUS_TONES.TODO);
    expect(statusTones(null)).toBe(STATUS_TONES.TODO);
    expect(statusClass(undefined)).toBe(STATUS_CLASS.TODO);
    expect(priorityClass('???')).toBe(PRIORITY_CLASS.NORMAL);
    expect(statusColour('IN_PROGRESS')).toBe('rgb(var(--c-status-progress))');
    expect(statusColour('nope')).toBe('rgb(var(--c-status-todo))');
  });

  it('the status metadata (written out for the Android drift tests) says the scheme’s colours', () => {
    for (const k of STATUS_ORDER) expect(STATUS_META[k]!.color, k).toBe(statusColour(k));
  });
});

describe('dueTone (1.23.8)', () => {
  it('red when late, amber when soon, else as given', async () => {
    const { dueTone } = await import('./colour-classes');
    expect(dueTone({ late: true, soon: true })).toBe('font-semibold text-overdue');
    expect(dueTone({ late: false, soon: true })).toBe('font-semibold text-soon');
    expect(dueTone({ late: false })).toBe('text-ink-2');
    expect(dueTone({ late: false, soon: false }, 'text-ink')).toBe('text-ink');
  });
});
