import { describe, it, expect } from 'vitest';
import { ApiError, NetworkError } from './api-client';
import {
  CARD_POLL_MS,
  CHANGED_BY_CARDS,
  CHAT_TITLE_MAX,
  MAX_QUESTION,
  MICO_AI_ACTION_TIMEOUT_MS,
  MICO_AI_POLL_MS,
  afterAskFailed,
  announce,
  createActionGate,
  errorText,
  linkTarget,
  micoAiChatKey,
  micoAiChatsKey,
  micoAiChatsRoot,
  micoAiEarlierKey,
  micoAiMessageKey,
  micoAiRoot,
  micoAiStatusKey,
  pendingAnswer,
  pollRetry,
  sourceTarget,
  withEarlier,
  withMessage,
} from './mico-ai-chat';
import { copyTextOf } from './mico-ai';
import { ANSWER, CLARIFY, PENDING, PROPOSALS, QUESTION, proposalMessage } from '../testing/mico-ai-fixtures';
import { hasWeb, readWeb } from '../testing/web-source';

/** MICO AI's chat state (Stage 3 Task 12): what the website's MicoAiPage does, for the phone. */
it('the website’s limits and the phone’s waits', () => {
  expect([MICO_AI_POLL_MS, CARD_POLL_MS, MAX_QUESTION, CHAT_TITLE_MAX, MICO_AI_ACTION_TIMEOUT_MS]).toEqual([1000, 2000, 4000, 200, 120_000]);
});

it('one answer is polled: the first pending one', () => { expect(pendingAnswer([QUESTION, PENDING])).toBe(PENDING); expect(pendingAnswer([QUESTION, ANSWER])).toBeNull(); expect(pendingAnswer([{ ...QUESTION, status: 'pending' }])).toBeNull(); });
it('earlier messages go above, never twice', () => expect(withEarlier([QUESTION, ANSWER], [{ ...QUESTION, id: 'old' }, QUESTION]).map((m) => m.id)).toEqual(['old', QUESTION.id, ANSWER.id]));

it('a polled message replaces its copy, and nothing is rewritten when nothing changed', () => {
  const view = { chat: { id: 'c1', title: '', createdAt: '', updatedAt: '', lastMessageAt: '', match: null }, messages: [QUESTION, PENDING] };
  expect(withMessage(view, { ...PENDING, answer: undefined })).toBe(view);
  expect(withMessage(view, { ...ANSWER, id: 'nope' })).toBe(view);
  expect(withMessage(undefined, PENDING)).toBeUndefined();
  const stepped = withMessage(view, { ...PENDING, step: 'Writing…' })!;
  expect(stepped).not.toBe(view); expect(stepped.messages[1]!.step).toBe('Writing…'); expect(stepped.messages[0]).toBe(QUESTION); expect(stepped.chat).toBe(view.chat);
  const done = withMessage(view, { ...ANSWER, id: PENDING.id })!;
  expect(done.messages[1]!.status).toBe('done');
  const card = proposalMessage(PROPOSALS[0]!);
  const withCard = { ...view, messages: [card] };
  expect(withMessage(withCard, JSON.parse(JSON.stringify(card)))).toBe(withCard);
  expect(withMessage(withCard, proposalMessage({ ...PROPOSALS[0]!, status: 'confirming' }, card.id))).not.toBe(withCard);
});

it('each person’s chats are kept apart (Review Focus 2)', () => {
  expect(micoAiChatsKey('u1', '')).not.toEqual(micoAiChatsKey('u2', '')); expect(micoAiChatKey('u1', 'c1')).not.toEqual(micoAiChatKey('u2', 'c1'));
  expect(micoAiMessageKey('u1', 'c1', 'm1').slice(0, 2)).toEqual(['mico-ai', 'u1']);
  expect(micoAiRoot('u1')).toEqual(['mico-ai', 'u1']);
  expect(micoAiStatusKey('u1')).toEqual(['mico-ai', 'u1', 'status']);
  expect(micoAiChatsKey('u1', ' pump ')).toEqual(['mico-ai', 'u1', 'chats', 'pump']);
  expect(micoAiChatsRoot('u1')).toEqual(micoAiChatsKey('u1', '').slice(0, 3));
  expect(micoAiChatKey('u1', 'c1')).toEqual(['mico-ai', 'u1', 'chat', 'c1']);
  expect(micoAiEarlierKey('u1', 'c1')).toEqual(['mico-ai', 'u1', 'earlier', 'c1']);
  expect(micoAiMessageKey('u1', 'c1', 'm1')).toEqual(['mico-ai', 'u1', 'message', 'c1', 'm1']);
});

it('a deleted chat stops the poll; a lost answer is tried twice', () => { expect(pollRetry(0, new ApiError(404, 'NOT_FOUND', 'x'))).toBe(false); expect(pollRetry(1, new NetworkError('x'))).toBe(true); expect(pollRetry(2, new NetworkError('x'))).toBe(false); expect(pollRetry(0, new ApiError(500, 'ERROR', 'x'))).toBe(true); });

it('a card action runs once, however often it is tapped (Review Focus 3)', async () => {
  const gate = createActionGate(); let calls = 0; let release!: () => void;
  const fn = () => { calls += 1; return new Promise<string>((r) => { release = () => r('done'); }); };
  const first = gate.run(fn); const second = gate.run(fn); expect(gate.busy).toBe(true);
  release(); expect(await first).toBe('done'); expect(await second).toBeUndefined(); expect(calls).toBe(1);
  expect(await gate.run(async () => 'again')).toBe('again'); expect(gate.busy).toBe(false);
});

it('a failed action opens the gate again', async () => {
  const gate = createActionGate();
  await expect(gate.run(() => Promise.reject(new Error('lost')))).rejects.toThrow('lost');
  expect(gate.busy).toBe(false);
  await expect(gate.run(() => { throw new Error('at once'); })).rejects.toThrow('at once');
  expect(await gate.run(async () => 1)).toBe(1);
});

it('a question whose answer was lost is read back, never asked again or deleted', () => {
  expect(afterAskFailed(new NetworkError('x', { timedOut: true }), true)).toEqual({ reread: true, deleteNewChat: false, restoreDraft: false });
  expect(afterAskFailed(new NetworkError('x', { mayHaveArrived: false }), true)).toEqual({ reread: false, deleteNewChat: true, restoreDraft: true });
  expect(afterAskFailed(new ApiError(409, 'MICO_AI_BUSY', 'MICO AI is still answering.'), true)).toEqual({ reread: true, deleteNewChat: false, restoreDraft: true });
  expect(afterAskFailed(new ApiError(400, 'VALIDATION', 'Too long.'), false)).toEqual({ reread: false, deleteNewChat: false, restoreDraft: true });
  expect(errorText(new NetworkError('x'))).toBe('Couldn’t reach the server. Check your connection and try again.'); expect(errorText(new ApiError(409, 'MICO_AI_BUSY', 'MICO AI is still answering.'))).toBe('MICO AI is still answering.');
  expect(errorText(new ApiError(400, 'ERROR', 'Request failed (400)'))).toBe('Something went wrong. Try again.');
  expect(errorText(new ApiError(503, 'ERROR', 'The AI service is down.'))).toBe('Something went wrong. Try again.');
  expect(errorText(new Error('x'))).toBe('Something went wrong. Try again.');
  // The exporter's own placeholder (lib/exporter) is no reason of the server's either.
  expect(errorText(new ApiError(404, 'ERROR', 'Export failed (404)'))).toBe('Something went wrong. Try again.');
});

it('sources open the app’s screens', () => {
  expect(sourceTarget({ type: 'task', id: 't1', label: 'RIG-3', url: '?task=t1' })).toMatchObject({ screen: 'TaskDetail', params: { taskId: 't1' } });
  expect(sourceTarget({ type: 'chat', id: 'm9', label: 'x', url: '/chat?conversation=c4' })).toMatchObject({ screen: 'ChatThread', params: { conversationId: 'c4' } });
  expect(sourceTarget({ type: 'person', id: 'u1', label: 'Omar', url: null })).toBeNull(); expect(sourceTarget({ type: 'project', id: 'x', label: 'x', url: '/projects/..%2Fx' })).toBeNull();
  expect(linkTarget('/meetings/m2')).toMatchObject({ screen: 'MeetingDetail', params: { meetingId: 'm2' } }); expect(linkTarget('https://evil.example/x')).toBeNull();
  expect(linkTarget('/projects/p1')).toEqual({ type: 'stack', screen: 'ProjectDetail', params: { projectId: 'p1' } });
  expect(linkTarget('/my-tasks?task=t9')).toEqual({ type: 'stack', screen: 'TaskDetail', params: { taskId: 't9' } });
  for (const bad of ['/reports', '/chat', '//evil.example/projects/p1', '?task=', '/meetings/m2/../../x', 'javascript:alert(1)']) expect(linkTarget(bad), bad).toBeNull();
});

it('what a screen reader hears', () => {
  expect(announce(PENDING)).toBe('MICO AI is working on your question…');
  expect(announce(QUESTION)).toBeNull();
  expect(announce({ ...PENDING, status: 'stopped' })).toBe('MICO AI stopped.');
  expect(announce({ ...PENDING, status: 'error', error: 'The model is busy.' })).toBe('MICO AI couldn’t answer: The model is busy.');
  expect(announce(proposalMessage(PROPOSALS[0]!))).toBe('MICO AI suggests changes: Here is what I would change. Nothing changes until you confirm them.');
  expect(announce(ANSWER)).toBe(`MICO AI answered: ${copyTextOf(ANSWER).slice(0, 400)}`);
  expect(announce(CLARIFY)).toBe('MICO AI answered: Which Omar do you mean?');
});

it('what a confirmed card can change is read again: the app’s own lists', () => {
  for (const root of ['tasks', 'task', 'meetings', 'meeting', 'project', 'projects', 'action-items', 'dashboard', 'planning', 'management', 'activity']) expect(CHANGED_BY_CARDS.has(root), root).toBe(true);
  expect(CHANGED_BY_CARDS.has('mico-ai')).toBe(false);
});

describe.skipIf(!hasWeb('frontend/src/pages/MicoAiPage.tsx'))('the website’s words', () => {
  it('errors and announcements', () => { const p = readWeb('frontend/src/pages/MicoAiPage.tsx'); for (const w of ['Couldn’t reach the server. Check your connection and try again.', 'Something went wrong. Try again.', 'MICO AI is working on your question…', 'Nothing changes until you confirm them.', 'MICO AI stopped.', 'MICO AI couldn’t answer: ', 'MICO AI suggests changes: ', 'MICO AI answered: ', 'const MAX_QUESTION = 4000;', 'maxLength={200}']) expect(p, w).toContain(w); });
});
