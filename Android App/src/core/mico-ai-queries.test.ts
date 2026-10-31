import { it, expect } from 'vitest';
import { appSource as src } from '../testing/web-source';

/** MICO AI's hooks (Stage 3 Task 12), read from their source — Review Focus 2 and 3. */
const s = src('core/mico-ai-queries.ts');

it('polls like the website: every second, never in the background, read again on coming back', () => {
  expect(s).toMatch(/function useAnswerPoll[^]*refetchInterval: MICO_AI_POLL_MS[^]*refetchIntervalInBackground: false[^]*refetchOnWindowFocus: true[^]*staleTime: 0/);
  expect(src('core/providers.tsx')).toMatch(/followAppState\(AppState\)/);
  expect(s).toMatch(/function useAnswerPoll[^]*gcTime: 0[^]*retry: pollRetry/);
  expect(s).toMatch(/function useAnswerPoll[^]*enabled: !!userId && !!chatId && !!pending && !isGone/);
});

it('a card being made or put back is read again every two seconds, with the same background rule', () => {
  expect(s).toMatch(/function useCardRefresh[^]*status === 'confirming' \|\| status === 'undoing'[^]*refetchInterval: CARD_POLL_MS[^]*refetchIntervalInBackground: false/);
});

it('every request is the person’s own and nothing is kept offline', () => { expect(s.match(/asUser: userId/g)!.length).toBeGreaterThanOrEqual(10); expect(s).not.toMatch(/reads\.read|readCache|queueOnOffline/); expect(s).not.toMatch(/\['mico-ai', '/); });

it('no request goes without the person it is for', () => {
  // Queries wait for a person; actions stop without one (an absent asUser would go with whoever is signed in).
  for (const hook of ['useMicoAiStatus', 'useMicoAiChats', 'useMicoAiChat', 'useAnswerPoll', 'useCardRefresh']) expect(s, hook).toMatch(new RegExp(`function ${hook}[^]*?enabled: !!userId`));
  expect(s).not.toMatch(/asUser: userId \?\?|asUser: undefined/);
});

it('a card action whose answer was lost is read back, not sent again', () => { expect(s).toMatch(/function useCardActions[^]*gate\.run\([^]*catch[^]*resources\.micoAi\.message\(/); expect(s).toMatch(/timeoutMs: MICO_AI_ACTION_TIMEOUT_MS/); expect(s).toMatch(/CHANGED_BY_CARDS\.has\(String\(q\.queryKey\[0\]\)\)/); });

it('one gate per card, and only confirm, cancel and undo go through it', () => {
  expect(s).toMatch(/const gate = useMemo\(\(\) => createActionGate\(\), \[messageId\]\)/);
  expect(s).toMatch(/resources\.micoAi\.confirm\(chatId, messageId, body, /);
  const card = s.slice(s.indexOf('function useCardActions'));
  expect(card.match(/resources\.micoAi\.(confirm|cancel|undo)\(/g)).toHaveLength(3);
});

it('a question whose answer was lost is read back; a chat made for it goes only when it surely never arrived', () => {
  expect(s).toMatch(/const after = afterAskFailed\(err, created\)/);
  expect(s).toMatch(/if \(after\.deleteNewChat[^]*resources\.micoAi\.remove\(/);
  expect(s).toMatch(/if \(after\.reread[^]*invalidateQueries\(\{ queryKey: micoAiChatKey\(userId, id\) \}\)/);
});
