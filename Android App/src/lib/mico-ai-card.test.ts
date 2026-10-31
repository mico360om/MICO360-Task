import { describe, it, expect } from 'vitest';
import { FIELD_MAX, FOOTER_NOTE, KIND_BADGE, LENGTH_CHOICES, applyEdit, cardControls, confirmA11y, confirmLabel, effectiveChange, lengthChoices, resultLine, timeProblem, undoDeadline, undoButtonText, undoLine } from './mico-ai-card';
import type { MicoAiProposal, ProposalChange, ProposalStatus } from './mico-ai-api';
import { resultSummary, undoSummary } from './mico-ai-proposal';
import { PROPOSALS } from '../testing/mico-ai-fixtures';
import { hasWeb, loadWebTsx, readWeb } from '../testing/web-source';

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

it('editing what a change needed ticks it; editing something else leaves it unticked', () => {
  const item = PROPOSALS[0]!.items.find((i) => i.needs.length > 0)!; const field = item.needs[0]!.fields[0]!;
  expect(applyEdit({}, item, { [field]: 'x' })).toMatchObject({ tick: item.needs.length === 1, edits: { [item.id]: { [field]: 'x' } } });
  expect(applyEdit({}, item, { somethingElse: 1 }).tick).toBe(false);
});

it('edits pile up per change, and a change with two needs ticks once both are edited', () => {
  const meeting = PROPOSALS[0]!.items.find((i) => i.type === 'schedule_meeting')!;
  const first = applyEdit({ c1: { projectId: 'p1' } }, meeting, { time: '10:30' });
  expect(first).toEqual({ edits: { c1: { projectId: 'p1' }, [meeting.id]: { time: '10:30' } }, tick: false });
  expect(applyEdit(first.edits, meeting, { title: 'Review' })).toEqual({ edits: { c1: { projectId: 'p1' }, [meeting.id]: { time: '10:30', title: 'Review' } }, tick: true });
});

it('the website’s lengths, the limits, and the current length kept in the choice', () => {
  expect(LENGTH_CHOICES).toEqual([15, 30, 45, 60, 90, 120]);
  expect(lengthChoices(30)).toEqual([15, 30, 45, 60, 90, 120]);
  expect(lengthChoices(75)).toEqual([15, 30, 45, 60, 75, 90, 120]);
  expect(FIELD_MAX).toEqual({ taskTitle: 190, meetingTitle: 200, text: 4000 });
});

it('the card shows a change with the person’s edits in it', () => {
  const [create, update, minutes, meeting] = PROPOSALS[0]!.items as [ProposalChange, ProposalChange, ProposalChange, ProposalChange];
  expect(effectiveChange(create, undefined, undefined)).toBe(create);
  const c = effectiveChange(create, { projectId: 'p1', title: 'Order pumps' }, { project: 'Rig 3' });
  expect(c).toMatchObject({ fields: { projectId: 'p1', title: 'Order pumps' }, labels: { project: 'Rig 3' } });
  // A task change keeps only the fields it changes.
  expect(effectiveChange(update, { due: '2026-11-02', title: 'x', columnId: 'c9' }, { column: 'Done' })).toMatchObject({ fields: { due: '2026-11-02', priority: 'HIGH' }, labels: { column: 'Done' } });
  expect((effectiveChange(update, { title: 'x' }, undefined) as { fields: object }).fields).not.toHaveProperty('title');
  const content = { summary: 'New', discussion: [], decisions: ['A'], risks: [], nextSteps: [] };
  expect(effectiveChange(minutes, { content }, undefined)).toMatchObject({ fields: { content } });
  expect(effectiveChange(meeting, { minutes: 45 }, { attendees: [] })).toMatchObject({ fields: { minutes: 45 }, labels: { attendees: [] } });
});

describe.skipIf(!hasWeb('frontend/src/components/mico-ai/ProposalCard.tsx'))('the website’s card', () => {
  it('shows edits the same way', () => {
    const web = (loadWebTsx('frontend/src/components/mico-ai/ProposalCard.tsx', { expose: ['effective'] }).__exposed as { effective: (...a: unknown[]) => unknown }).effective;
    const cases: Array<[Record<string, unknown> | undefined, Record<string, unknown> | undefined]> = [
      [undefined, undefined],
      [{ title: 'T', projectId: 'p2', due: null, assigneeIds: ['u1'] }, { project: 'Rig 3', assignees: [{ id: 'u1', name: 'Omar' }] }],
      [{ due: '2026-11-02', title: 'x', columnId: 'c9', priority: 'LOW' }, { column: 'Done' }],
      [{ content: { summary: 'S2', discussion: [], decisions: [], risks: ['R'], nextSteps: [] } }, undefined],
      [{ projectId: null }, { project: null }],
      [undefined, { attendees: [{ id: 'u2', name: 'Sara' }] }],
    ];
    for (const p of PROPOSALS) for (const item of p.items) for (const [e, sh] of cases) expect(effectiveChange(item, e, sh), `${item.type} ${JSON.stringify(e)}`).toEqual(web(item, e, sh));
  });
  it('edits tick a change as the website’s edit does', () => { const w = readWeb('frontend/src/components/mico-ai/ProposalCard.tsx'); expect(w).toContain('const next = { ...edits[item.id], ...patch };'); expect(w).toContain('[item.id]: remainingNeeds(item, next).length === 0'); expect(readWeb('frontend/src/components/mico-ai/proposal-rows.tsx')).toContain('const LENGTHS = [15, 30, 45, 60, 90, 120];'); });
});

it('a meeting time typed wrong holds Confirm back, and says why (final review A3)', () => {
  expect(timeProblem({})).toBeNull();
  expect(timeProblem({ c4: '10:30', c5: '9.15' })).toBeNull();
  expect(timeProblem({ c4: '25:00' })).toBe('Put the meeting time right first: enter it as HH:MM, e.g. 09:30.');
  expect(timeProblem({ c4: '10:30', c5: 'ten' })).not.toBeNull();
  // Emptied: the time it had would still be sent, so it holds Confirm back too.
  expect(timeProblem({ c4: ' ' })).not.toBeNull();
});

it('Undo closes when the server says, on the phone’s clock (final review A8)', () => {
  // Read at 08:00 server time, 07:59:30 on the phone (30 s behind): it closes at 08:14:30 phone time.
  const receivedAt = Date.parse('2026-10-30T07:59:30Z');
  expect(undoDeadline('2026-10-30T08:15:00Z', '2026-10-30T08:00:00Z', receivedAt)).toBe(Date.parse('2026-10-30T08:14:30Z'));
  expect(undoDeadline(null, '2026-10-30T08:00:00Z', receivedAt)).toBeNull();
  expect(undoDeadline('nonsense', '2026-10-30T08:00:00Z', receivedAt)).toBeNull();
});
