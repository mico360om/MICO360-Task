import { describe, it, expect } from 'vitest';
import { FOOTER_NOTE, KIND_BADGE, cardControls, confirmA11y, confirmLabel, resultLine, undoButtonText, undoLine } from './mico-ai-card';
import type { MicoAiProposal, ProposalStatus } from './mico-ai-api';
import { resultSummary, undoSummary } from './mico-ai-proposal';
import { PROPOSALS } from '../testing/mico-ai-fixtures';
import { hasWeb, readWeb } from '../testing/web-source';

/** MICO AI's card in words and buttons (Stage 3 Task 14) — Review Focus 3. */
const card = (status: ProposalStatus, extra: Partial<MicoAiProposal> = {}) => ({ ...PROPOSALS.find((p) => p.status === status)!, ...extra });

it('the buttons follow the card: while it is being made nothing can be tapped again', () => {
  expect(cardControls(card('proposed'), 0)).toMatchObject({ confirm: true, cancel: true, undo: false, footer: null });
  expect(cardControls(card('confirming'), 0)).toEqual({ confirm: false, cancel: false, undo: false, undoGone: false, footer: 'Making these changes…' });
  expect(cardControls(card('superseded'), 0)).toMatchObject({ confirm: false, cancel: false, undo: false, footer: 'Replaced by a newer answer — nothing was changed.' });
  expect(cardControls(card('done', { canUndo: true }), 60_000)).toMatchObject({ confirm: false, undo: true });
  expect(cardControls(card('done', { canUndo: true }), 0)).toMatchObject({ undo: false, undoGone: true });
});

it('every status, with the summaries the website shows', () => {
  expect(cardControls(card('proposed'), 0)).toEqual({ confirm: true, cancel: true, undo: false, undoGone: false, footer: null });
  expect(cardControls(card('undoing'), 60_000)).toEqual({ confirm: false, cancel: false, undo: false, undoGone: false, footer: 'Putting these changes back…' });
  expect(cardControls(card('cancelled'), 0)).toEqual({ confirm: false, cancel: false, undo: false, undoGone: false, footer: 'Cancelled — nothing was changed.' });
  expect(cardControls(card('done', { canUndo: true }), 60_000)).toEqual({ confirm: false, cancel: false, undo: true, undoGone: false, footer: resultSummary(card('done').items) });
  expect(cardControls(card('undone'), 0)).toEqual({ confirm: false, cancel: false, undo: false, undoGone: false, footer: undoSummary(card('undone').items) });
  // Undo can't be offered: no undo window, or the server says no — and nothing was done, nothing to say.
  expect(cardControls(card('done', { canUndo: true, undoUntil: null }), 60_000)).toMatchObject({ undo: false, undoGone: false });
  expect(cardControls(card('done', { canUndo: false }), 60_000)).toMatchObject({ undo: false, undoGone: true });
  const nothingDone = card('done', { canUndo: true, items: card('done').items.map((i) => ({ ...i, result: { status: 'failed' as const, message: null, link: null } })) });
  expect(cardControls(nothingDone, 0)).toMatchObject({ undo: false, undoGone: false });
});

it('result and undo lines, labels and the 15-minute countdown', () => {
  expect(resultLine({ status: 'failed', message: null, link: null })).toBe('Failed: This change couldn’t be made.'); expect(resultLine({ status: 'refused', message: 'RIG-3 was deleted since.', link: null })).toBe('Refused: RIG-3 was deleted since.');
  expect(undoLine({ status: 'undone', message: null })).toBe('Undone: put back as it was.');
  expect(confirmLabel(2)).toBe('Confirm (2)'); expect(undoButtonText(872_000)).toBe('Undo (14:32)');
  expect(resultLine({ status: 'started', message: null, link: null })).toBe('Being made…');
  expect(resultLine({ status: 'skipped', message: null, link: null })).toBe('Skipped (not ticked).');
  expect(resultLine({ status: 'done', message: 'Created RIG-31.', link: { label: 'RIG-31', url: '?task=t31' } })).toBe('Created RIG-31.');
  expect(resultLine({ status: 'done', message: null, link: null })).toBe('');
  expect(undoLine({ status: 'started', message: null })).toBe('Being put back…');
  expect(undoLine({ status: 'refused', message: 'Sara changed it since.' })).toBe('Not undone: Sara changed it since.');
  expect(undoLine({ status: 'failed', message: null })).toBe('Not undone: it couldn’t be put back.');
  expect(confirmA11y(1)).toBe('Confirm 1 change'); expect(confirmA11y(3)).toBe('Confirm 3 changes');
  expect(KIND_BADGE).toEqual({ create_task: 'New task', update_task: 'Change', draft_minutes: 'Final minutes', schedule_meeting: 'Meeting' });
});

describe.skipIf(!hasWeb('frontend/src/components/mico-ai/ProposalCard.tsx'))('the website’s words', () => {
  it('footers, lines and buttons', () => { const w = readWeb('frontend/src/components/mico-ai/ProposalCard.tsx') + readWeb('frontend/src/components/mico-ai/proposal-rows.tsx'); for (const t of ['Making these changes…', 'Putting these changes back…', 'Cancelled — nothing was changed.', 'Replaced by a newer answer — nothing was changed.', 'Undo is no longer available.', FOOTER_NOTE, 'Skipped (not ticked).', 'Being put back…', 'Email the invitations', 'Making the changes…', 'Undoing…', ...Object.values(KIND_BADGE)]) expect(w, t).toContain(t); });
  it('the lines’ own words', () => { const w = readWeb('frontend/src/components/mico-ai/ProposalCard.tsx'); for (const t of ['Being made…', 'This change couldn’t be made.', "'Refused' : 'Failed'", 'Undone: ${undo.message ?? \'put back as it was.\'}', 'Not undone: ${undo.message ?? \'it couldn’t be put back.\'}', 'Confirm (${ticked})', "ticked === 1 ? 'change' : 'changes'", 'Undo (${countdown(left)})']) expect(w, t).toContain(t); });
});
