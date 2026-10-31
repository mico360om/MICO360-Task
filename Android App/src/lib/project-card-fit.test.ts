import { describe, it, expect } from 'vitest';
import { PROJECT_CARD_FIT, figureRoom, figuresFit } from './project-card-fit';
import { spacing } from './theme';
import { appSource as src } from '../testing/web-source';

// Stage 2 fix pass B5: "Next due" was cut off on a 360 dp phone. The three figures sit side by side
// while every value and label fits its column (measured in the real faces), else one under another.
describe('the project card’s three figures', () => {
  it('a 360 dp phone at the normal size: side by side, "Tomorrow" included', () => {
    expect(figureRoom(360)).toBe(92);
    expect(figuresFit(['15', '3', 'Tomorrow'], 360, 1)).toBe(true);
    expect(figuresFit(['1240', '128', 'Wed 28'], 360, 1)).toBe(true);
  });

  it('at a large font (1.3) the longest words stack the figures, so nothing is cut; short ones stay side by side', () => {
    expect(figuresFit(['15', '3', 'Tomorrow'], 360, 1.3)).toBe(false);
    expect(figuresFit(['15', '3', 'Today'], 360, 1.3)).toBe(true);
    expect(figuresFit(['15', '3', 'Wed 28'], 360, 2)).toBe(false);
    // The labels count too: at 330 dp and font 2, "Next due" (92 dp) is wider than its 82 dp.
    expect(figuresFit(['15', '3', '—'], 360, 2)).toBe(true);
    expect(figuresFit(['15', '3', '—'], 330, 2)).toBe(false);
  });

  it('a day in another year stacks them on a 360 dp phone, not on a wider one', () => {
    expect(figuresFit(['15', '3', '15 Jan 2027'], 360, 1)).toBe(false);
    expect(figuresFit(['15', '3', '15 Jan 2027'], 411, 1)).toBe(true);
  });
});

describe('measured the way the card is drawn', () => {
  it('the page padding, the card’s border, the dividers, the figures’ padding and sizes', () => {
    expect(PROJECT_CARD_FIT.pagePadding).toBe(spacing.lg);
    expect(src('screens/ProjectsScreen.tsx')).toMatch(/scroll: \{ padding: spacing\.lg/);
    expect(src('components/ui/Card.tsx')).toMatch(/borderWidth: 1,/);
    const card = src('components/projects/ProjectCard.tsx');
    expect(card).toMatch(/divider: \{ width: PROJECT_CARD_FIT\.divider,/);
    expect(card).toMatch(/figure: \{[^}]*paddingHorizontal: PROJECT_CARD_FIT\.figurePadding/);
    expect(card).toMatch(/figureValue: \{ fontSize: PROJECT_CARD_FIT\.valueSize,[^}]*font\('700', 'display'\)/);
    expect(card).toMatch(/figureLabel: \{ fontSize: PROJECT_CARD_FIT\.labelSize/);
  });

  it('the card measures its own values at the phone’s width and font size, and stacks them when they don’t fit', () => {
    const card = src('components/projects/ProjectCard.tsx');
    expect(card).toMatch(/const \{ width, fontScale \} = useWindowDimensions\(\);/);
    expect(card).toMatch(/figuresFit\(\[String\(p\.stats\.open\), String\(p\.stats\.overdue\), next\.short\], width, fontScale\)/);
    expect(card).toMatch(/style=\{stacked \? s\.figuresStacked : s\.figures\}/);
  });
});
