import { it, expect } from 'vitest';
import { hasWeb, readWeb, appSource as src } from '../testing/web-source';

/** MICO AI's proposal card (Stage 3 Task 14), read from its source — Review Focus 3. */
const s = src('components/mico-ai/ProposalCard.tsx');

it('Confirm goes through the card’s one gate and follows the card’s status', () => {
  expect(s).toMatch(/useCardActions\(chatId, message\.id\)/); expect(s).toMatch(/cardControls\(proposal, left\)/); expect(s).toMatch(/useCardRefresh\(chatId, message\)/);
  expect(s).toMatch(/disabled=\{busy \|\| ticked === 0 \|\| !!badTime\}/); expect(s).toMatch(/confirmBody\(proposal\.items, ticks, edits, invite\)/);
});

it('only the buttons the card’s status allows are shown', () => {
  expect(s).toMatch(/controls\.confirm \?/); expect(s).toMatch(/controls\.cancel \?/); expect(s).toMatch(/controls\.undo \?/);
  expect(s).toMatch(/controls\.undoGone \?[^]*Undo is no longer available\./);
  expect(s).toMatch(/accessibilityLabel=\{busy \? undefined : confirmA11y\(ticked\)\}/);
});

it('the Undo countdown follows the server’s clock, ticking every second', () => {
  expect(s).toMatch(/undoLeft\(proposal\.undoUntil, proposal\.serverNow, receivedAt, now\)/);
  expect(s).toMatch(/const receivedAt = useMessageReceivedAt\(chatId, message\.id, proposal\.serverNow\)/);
  expect(s).toMatch(/setInterval\(/);
});

it('a change that needs putting right can’t be ticked; a locked one has no tick box', () => {
  expect(s).toMatch(/remainingNeeds\(/);
  expect(s).toMatch(/`Put right first: \$\{needs\.map\(\(n\) => n\.message\)\.join\(' '\)\}`/);
  expect(s).toMatch(/`Can’t do: \$\{item\.problem \?\? 'this change can’t be made\.'\}`/);
  expect(s).toMatch(/<CheckRow[^>]*disabled=\{busy \|\| needs\.length > 0\}/);
});

it('a done change opens on the phone, unless Undo removed it', () => {
  expect(s).toMatch(/linkTarget\(result\.link\.url\)/);
  expect(s).toMatch(/!gone/);
  expect(s).toMatch(/applyNavAction\(/);
});

it('what happened is announced once', () => {
  for (const w of ['`Changes made: ${resultSummary(p.items)}.`', '`Undo: ${undoSummary(p.items)}.`', 'CANCELLED']) expect(s, w).toContain(w);
  expect(s).toMatch(/accessibilityLiveRegion="polite"/);
});

it('the answer shows its card once it is written', () => {
  expect(src('components/mico-ai/MessageView.tsx')).toMatch(/a\?\.kind === 'proposal' && a\.proposal && done && chatId \? <ProposalCard chatId=\{chatId\} message=\{message\} \/>/);
  expect(src('screens/MicoAiScreen.tsx')).toMatch(/<MessageView chatId=\{chatId\} message=\{m\}/);
});

it('each kind’s summary shows everything Confirm will write', () => {
  const r = src('components/mico-ai/ProposalSummary.tsx');
  for (const w of ['Untitled task', 'No project', 'No due date', 'No one was named, so it goes to the project’s owner, as any new task does.', 'Saved as a draft for review on the meeting page — never final or emailed.', 'Untitled meeting', 'Invited', 'Agenda', 'Description', 'Risks and open questions', 'Next steps', 'Decisions', 'Show all', 'Show less']) expect(r, w).toContain(w);
  expect(r).toMatch(/meetingWhen\(/); expect(r).toMatch(/lengthLabel\(/); expect(r).toMatch(/shortDay\(/);
  if (hasWeb('frontend/src/components/mico-ai/proposal-rows.tsx')) {
    const w = readWeb('frontend/src/components/mico-ai/proposal-rows.tsx');
    for (const t of ['Untitled task', 'No project', 'No due date', 'No one was named, so it goes to the project’s owner, as any new task does.', 'Saved as a draft for review on the meeting page — never final or emailed.', 'Untitled meeting', 'Invited', 'Risks and open questions', 'Assigned people', 'People invited']) expect(w, t).toContain(t);
  }
});

it('a meeting time typed wrong stays on the card and holds Confirm back (final review A3)', () => {
  expect(s).toMatch(/const badTime = timeProblem\(times\)/);
  expect(s).toMatch(/badTime \? <Text style=\{s\.problemText\}>\{badTime\}<\/Text> : null\}/);
  expect(s).toMatch(/<ProposalEditor item=\{item\} onEdit=\{[^}]*\}[^>]*draftTime=\{times\[item\.id\]\} onDraftTime=\{/);
  const e = src('components/mico-ai/ProposalEditor.tsx');
  // Android's own keyboard with ":" (numbers-and-punctuation is iOS only); the HH:MM hint says how.
  expect(e).not.toMatch(/numbers-and-punctuation/);
  expect(e).toMatch(/function TimeField[^]*keyboardType="default"[^]*placeholder="HH:MM"/);
  expect(e).toMatch(/value=\{draftTime \?\? value \?\? ''\}/);
});

it('a second tap while an action runs changes nothing on the card, not even its busy words (final review A5)', () => {
  const run = s.slice(s.indexOf('async function run('));
  expect(run).toMatch(/^async function run\(.*\) \{\s+if \(running\.current\) return;\s+running\.current = true;/);
  expect(run).toMatch(/finally \{\s+running\.current = false;/);
  expect(s).toMatch(/const running = useRef\(false\)/);
});

it('a card shown from the phone’s copy counts down from when that copy arrived, and stops when Undo closes (final review A8)', () => {
  const q = src('core/mico-ai-queries.ts');
  expect(q).toMatch(/export function useMessageReceivedAt[^]*getQueryState<ChatView>\(micoAiChatKey\(userId, chatId\)\)[^]*dataUpdatedAt[^]*\[qc, userId, chatId, messageId, serverNow\]/);
  expect(s).toMatch(/const deadline = undoDeadline\(proposal\.undoUntil, proposal\.serverNow, receivedAt\)/);
  expect(s).toMatch(/useNow\(canUndoNow, deadline\)/);
  expect(s).toMatch(/if \(deadline !== null && t >= deadline\) clearInterval\(timer\)/);
});
