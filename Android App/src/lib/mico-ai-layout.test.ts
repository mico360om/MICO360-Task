import { it, expect } from 'vitest';
import { answerColumnWidth, changeLabelWidth } from './mico-ai-layout';
import { ANSWER } from '../testing/mico-ai-fixtures';
import { appSource as src } from '../testing/web-source';

/** MICO AI's widths grow with the phone's font size (final review A10). */
const table = ANSWER.answer!.tables[0]!;

it('a table column is as wide as what it holds, and grows with the font', () => {
  const at1 = table.columns.map((_, j) => answerColumnWidth(table, j, 1));
  expect(at1.every((w) => w >= 72 && w <= 260)).toBe(true);
  // "Waiting on parts" (16 letters) is wider than "Hours".
  expect(answerColumnWidth(table, 7, 1)).toBeGreaterThan(answerColumnWidth(table, 4, 1));
  const at2 = table.columns.map((_, j) => answerColumnWidth(table, j, 2));
  at2.forEach((w, j) => expect(w, table.columns[j]!.label).toBeGreaterThan(at1[j]!));
  // The text grows, the padding doesn't: twice the font, a little less than twice the width.
  expect(answerColumnWidth(table, 7, 2)).toBe(Math.round(16 * 7.5 * 2 + 28));
  // A smaller font keeps the default widths.
  expect(table.columns.map((_, j) => answerColumnWidth(table, j, 0.85))).toEqual(at1);
});

it('the before → after labels’ column grows with the font', () => {
  expect(changeLabelWidth(1)).toBe(64);
  expect(changeLabelWidth(2)).toBe(128);
  expect(changeLabelWidth(0.85)).toBe(64);
});

it('the table and the summaries use the phone’s font size', () => {
  const t = src('components/mico-ai/AnswerTable.tsx');
  expect(t).toMatch(/const \{ fontScale \} = useWindowDimensions\(\)/);
  expect(t).toMatch(/answerColumnWidth\(table, j, fontScale\)/);
  const r = src('components/mico-ai/ProposalSummary.tsx');
  expect(r).toMatch(/\{ width: changeLabelWidth\(fontScale\) \}/);
  expect(r).not.toMatch(/width: 64/);
});
