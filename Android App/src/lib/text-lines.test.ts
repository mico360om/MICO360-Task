import { it, expect } from 'vitest';
import { lineCap } from './text-lines';
import { appSource as src, appSources } from '../testing/web-source';

/**
 * Device check C (31 Oct): at the phone's largest font size a title cut to two lines lost its "…"
 * ("Al Khuwair Tower — Si.", "footing — Block.."). Android keeps room for the "…" at the text's
 * unenlarged size in its plain system font, then draws it enlarged in the brand face, so its dots
 * run past the edge. Text cut after a few lines is cut only at the normal font size; when the phone's
 * font is enlarged it is shown in full, so there is no "…" to lose.
 */
it('a few-line cap holds at the normal font size and is lifted when the font is enlarged', () => {
  expect(lineCap(2, 1)).toBe(2);
  expect(lineCap(3, 0.85)).toBe(3);
  expect(lineCap(2, 1.15)).toBeUndefined();
  expect(lineCap(2, 2)).toBeUndefined();
});

it('capLines reads the phone’s font scale', () => {
  const s = src('components/ui/text-lines.ts');
  expect(s).toMatch(/export function capLines\(lines: number\): number \| undefined \{\s*return lineCap\(lines, PixelRatio\.getFontScale\(\)\);/);
  expect(src('components/ui/index.ts')).toMatch(/export \{ capLines \} from '\.\/text-lines';/);
});

/** Each `numberOfLines={<2 or more>}` given to a text (not a text box, where it is the box's rows). */
function bareCaps(): string[] {
  const found: string[] = [];
  for (const [file, text] of appSources().filter(([f]) => f.endsWith('.tsx'))) {
    for (const m of text.matchAll(/numberOfLines=\{([2-9])\}/g)) {
      const tag = /<(\w+)[^<]*$/.exec(text.slice(0, m.index))?.[1] ?? '';
      if (tag !== 'TextField' && tag !== 'TextInput') found.push(`${file}: <${tag}> ${m[1]} lines`);
    }
  }
  return found;
}

it('no text is cut after two or more lines without capLines (the project card’s name, To approve, every card title…)', () => {
  expect(bareCaps()).toEqual([]);
  expect(src('components/projects/ProjectCard.tsx')).toMatch(/<Text style=\{s\.name\} numberOfLines=\{capLines\(2\)\}>/);
  expect(src('components/approvals/ToApproveSection.tsx')).toMatch(/<Text style=\{s\.taskTitle\} numberOfLines=\{capLines\(2\)\}>/);
});
