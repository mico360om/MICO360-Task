import { describe, it, expect } from 'vitest';
import { answerBlocks, cellDisplay, chatGroups, chatTitle, copyTextOf, suggestedQuestions } from './mico-ai';
import { ANSWER, CHATS, NOW } from '../testing/mico-ai-fixtures';
import { hasWeb, loadWebTs } from '../testing/web-source';

/** MICO AI's answer rules are a copy of the website's lib/mico-ai.ts (Stage 3 Task 11). */
it('an answer is plain runs: paragraphs, bullets and bold, never markup', () => {
  expect(answerBlocks(ANSWER.text)).toEqual([
    { kind: 'p', lines: [[{ text: 'You have ', bold: false }, { text: '3 overdue', bold: true }, { text: ' tasks.', bold: false }], [{ text: 'Two are in Rig 3.', bold: false }]] },
    { kind: 'ul', items: [[{ text: 'RIG-3', bold: true }, { text: ' Pump check', bold: false }], [{ text: 'RIG-7 <b>Valve</b> swap', bold: false }], [{ text: 'Site walk', bold: false }]] },
    { kind: 'p', lines: [[{ text: 'Ask me to move them if you like.', bold: false }]] },
  ]);
});

it('cells in the website’s words, chats grouped by the person’s day', () => {
  expect(cellDisplay('date', '2026-10-19')).toBe('Mon 19 Oct');
  expect(cellDisplay('datetime', '2026-10-28T09:05:00')).toBe('Wed 28 Oct, 09:05');
  expect(cellDisplay('days', 1)).toBe('1 day');
  expect(cellDisplay('percent', 40)).toBe('40%');
  expect(cellDisplay('number', null)).toBe('');
  expect(chatGroups(CHATS, NOW, 'Asia/Muscat').map((g) => [g.label, g.chats.map((c) => c.id)])).toEqual([
    ['Today', ['c-today', 'c-late']],
    ['Yesterday', ['c-yesterday']],
    ['Previous 7 days', ['c-3days']],
    ['Older', ['c-old']],
  ]);
  expect(chatTitle({ title: '  ' })).toBe('New chat');
  expect(suggestedQuestions(null).at(-1)).toBe('Which projects need attention?');
});

describe.skipIf(!hasWeb('frontend/src/lib/mico-ai.ts'))('the website’s answer rules', () => {
  const web = loadWebTs('frontend/src/lib/mico-ai.ts', { './due-date': 'frontend/src/lib/due-date.ts' }) as Record<string, (...a: never[]) => unknown>;
  it('agree on blocks, cells, groups, copy text and suggestions', () => {
    expect(answerBlocks(ANSWER.text)).toEqual(web.answerBlocks!(ANSWER.text as never));
    for (const col of ANSWER.answer!.tables[0]!.columns.map((c, i) => [c.kind, i] as const)) for (const row of ANSWER.answer!.tables[0]!.rows) expect(cellDisplay(col[0], row.cells[col[1]]!)).toBe(web.cellDisplay!(col[0] as never, row.cells[col[1]] as never));
    const now = new Date('2026-10-30T08:00:00Z'); expect(chatGroups(CHATS, now, 'Asia/Muscat')).toEqual(web.chatGroups!(CHATS as never, now as never, 'Asia/Muscat' as never));
    expect(copyTextOf(ANSWER)).toBe(web.copyTextOf!(ANSWER as never));
    for (const n of ['Rig 3', null]) expect(suggestedQuestions(n)).toEqual(web.suggestedQuestions!(n as never));
    expect(chatTitle({ title: '  ' })).toBe('New chat');
  });
});
