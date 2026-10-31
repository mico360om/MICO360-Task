import { describe, it, expect } from 'vitest';
import { hasWeb, readWeb, appSource as src } from '../testing/web-source';

/** The MICO AI screen (Stage 3 Task 13), read from its source: the website's page on a phone. */
const screen = src('screens/MicoAiScreen.tsx');
const view = src('components/mico-ai/MessageView.tsx');
const table = src('components/mico-ai/AnswerTable.tsx');
const composer = src('components/mico-ai/Composer.tsx');
const sheet = src('components/mico-ai/ChatsSheet.tsx');

it('a different person never sees the last one’s chat on screen (Review Focus 2)', () => { expect(screen).toMatch(/<View key=\{userId/); expect(screen).not.toMatch(/asyncStore|AsyncStorage|setItem\(/); });
it('the composer offers Stop while MICO AI is answering, and Send only when it can ask', () => { const c = composer; expect(c).toMatch(/pending \?[^]*title="Stop"/); expect(c).toMatch(/maxLength=\{MAX_QUESTION\}/); expect(screen).toMatch(/const canAsk = ready && !pending && !sending/); });
it('answers: tables with Excel, sources that open screens, the PDF report, Copy and quick replies', () => {
  const m = view, t = table;
  expect(t).toMatch(/cellDisplay\(/); expect(t).toMatch(/accessibilityLabel=\{`Download \$\{table\.title\} as Excel`\}/); expect(t).toMatch(/FIRST_ROWS = 25/);
  expect(m).toMatch(/sourceTarget\(source\)/); expect(m).toContain('PDF report'); expect(m).toMatch(/copyText\(copyTextOf\(message\)\)/); expect(m).toMatch(/accessibilityLabel="Quick replies"/);
});
it('the answer is announced as it arrives', () => expect(screen).toMatch(/accessibilityLiveRegion="polite"[^]*announce\(/));

it('the screen follows the answer being written and says when the chat was deleted', () => {
  expect(screen).toMatch(/const answering = pendingAnswer\(messages\)/);
  expect(screen).toMatch(/useAnswerPoll\(chatId, answering\)/);
  expect(screen).toContain('This chat was deleted.');
  // A chat deleted elsewhere can't take a question: the next one starts a new chat.
  expect(screen).toMatch(/newChat: !!o\.newChat \|\| gone/);
});

it('older messages go above what is shown, and the list keeps its place', () => {
  expect(screen).toMatch(/useEarlierMessages\(chatId\)/);
  expect(screen).toMatch(/withEarlier\(latest, earlier\?\.messages \?\? \[\]\)/);
  expect(screen).toMatch(/loadOlder\(messages\[0\]\.id\)|loadOlder\(first\.id\)/);
  expect(screen).toMatch(/maintainVisibleContentPosition=/);
  expect(screen).toContain('Load earlier messages');
});

it('not set up: the server’s words, and AI Management on the website for administrators', () => {
  expect(screen).toContain('MICO AI isn’t set up yet. An administrator can add the AI service in AI Management.');
  expect(screen).toMatch(/isAdmin \?[^]*Open AI Management[^]*openWebsitePage\(baseUrl, '\/admin\/ai'\)/);
  expect(composer).toContain('MICO AI isn’t set up yet');
  expect(composer).toMatch(/editable=\{ready\}/);
});

it('a new chat greets the person and suggests the website’s questions', () => {
  expect(screen).toMatch(/firstName \? `How can I help, \$\{firstName\}\?` : 'How can I help\?'/);
  expect(screen).toContain('I answer from your tasks, projects, meetings, reports and team chat.');
  expect(screen).toMatch(/suggestedQuestions\(projectName\)[^]*disabled=\{!canAsk\}/);
});

it('the chats: grouped by the person’s day, renamed in place, deleted only after asking', () => {
  expect(sheet).toMatch(/chatGroups\(chats, new Date\(\), calendarTimeZone\(\)\)/);
  expect(sheet).toMatch(/icon="misc\.dots"\s+label=\{`More for \$\{title\}`\}/);
  expect(sheet).toMatch(/Alert\.alert\('Delete this chat\?', `“\$\{title\}” and its messages will be deleted for good\. This can’t be undone\.`/);
  expect(sheet).toContain("'Delete chat'");
  expect(sheet).toMatch(/maxLength=\{CHAT_TITLE_MAX\}/);
  expect(screen).toMatch(/maxLength=\{CHAT_TITLE_MAX\}/);
  for (const w of ['Search chats', 'Rename', 'Delete…', 'New chat', 'Try again']) expect(sheet, w).toContain(w);
  expect(sheet).toMatch(/`No chats match “\$\{q\.trim\(\)\}”\.`/);
});

it('a renamed chat drops extra spaces; an empty or unchanged name changes nothing', () => {
  for (const s of [screen, sheet]) expect(s).toMatch(/replace\(\/\\s\+\/g, ' '\)\.trim\(\)[^]*if \(clean && clean !== /);
});

it('the answer’s words are text with bold runs, never markup', () => {
  expect(view).toMatch(/answerBlocks\(/);
  expect(view).not.toMatch(/dangerouslySetInnerHTML|WebView/);
});

describe.skipIf(!hasWeb('frontend/src/components/mico-ai/ChatList.tsx', 'frontend/src/components/mico-ai/Composer.tsx', 'frontend/src/components/mico-ai/MessageView.tsx', 'frontend/src/components/mico-ai/AnswerParts.tsx'))('the website’s words', () => {
  it('in the chats, composer and answers', () => {
    for (const [file, words] of [['ChatList', ['No chats yet. Ask a question to start one.', 'Your chats couldn’t be loaded.', 'MICO AI only uses what you can see in MICO360 Tasks. Your chats are private to you.']], ['Composer', ['MICO AI answers only from MICO360 data you can see, and links its sources. Check important figures before sharing.', 'Ask MICO AI…']], ['MessageView', ['Stopped.', 'Quick replies']], ['AnswerParts', ['Show fewer rows', 'Sources:']]] as const)
      for (const w of words) expect(readWeb(`frontend/src/components/mico-ai/${file}.tsx`), w).toContain(w);
  });
  it('every word the app copies is still the website’s', () => {
    const web = (f: string) => readWeb(`frontend/src/components/mico-ai/${f}.tsx`);
    for (const w of ['Search chats', 'Rename', 'Delete…', 'New chat', 'Try again', 'No chats match “', 'Answers from your MICO360 data']) expect(web('ChatList'), w).toContain(w);
    for (const w of ['MICO AI isn’t set up yet', 'MICO AI is working…', 'Sending…', 'Stop']) expect(web('Composer'), w).toContain(w);
    for (const w of ['Something went wrong while answering. Try again.', 'Copied', 'Copy', 'Retry', 'PDF report', 'Suggested follow-ups', 'Download this answer as a PDF report']) expect(web('MessageView'), w).toContain(w);
    for (const w of ['Thinking…', 'Excel', 'Show all ', 'Showing ']) expect(web('AnswerParts'), w).toContain(w);
    for (const w of ['Answers from your MICO360 data', 'Download this answer as a PDF report', 'Suggested follow-ups', 'Thinking…', 'MICO AI is working…', 'Sending…']) expect(src('components/mico-ai/ChatsSheet.tsx') + view + table + composer, w).toContain(w);
  });
});

describe.skipIf(!hasWeb('frontend/src/pages/MicoAiPage.tsx'))('the website’s page words', () => {
  it('greeting, not set up, deleted and earlier messages', () => {
    const p = readWeb('frontend/src/pages/MicoAiPage.tsx');
    for (const w of ['How can I help, ', 'How can I help?', 'I answer from your tasks, projects, meetings, reports and team chat.', 'MICO AI isn’t set up yet. An administrator can add the AI service in AI Management.', 'Open AI Management', 'This chat was deleted.', 'Load earlier messages', 'Delete this chat?', 'and its messages will be deleted for good. This can’t be undone.', 'Delete chat', 'Rename this chat', 'Open chats', 'New chat', 'Suggested questions']) expect(p, w).toContain(w);
  });
});

it('the conversation scrolls only as the website’s rule says: never on growth the person caused (final review A1)', () => {
  // A wish is set where the messages change and carried out when the content has its new size.
  expect(screen).toMatch(/const w = scrollWant\(was, now, messages\.length, atEnd\.current\)/);
  expect(screen).toMatch(/\[chatId, firstId, lastId, pending\?\.id, pending\?\.step, messages\.length\]/);
  expect(screen).toMatch(/onContentSizeChange=\{applyWant\}/);
  const apply = screen.slice(screen.indexOf('const applyWant'), screen.indexOf('const applyWant') + 900);
  expect(apply).toMatch(/const w = want\.current;\s+if \(!w/);
  // An answer taller than the view opens at its start.
  expect(screen).toMatch(/box\.height > viewHeight\.current/);
  expect(screen).toMatch(/onLayout=\{\(e\) => onMessageLayout\(m\.id, e\.nativeEvent\.layout\)\}/);
  // The keyboard opening (the view getting shorter) keeps the newest message in view; a drag cancels any wish.
  expect(screen).toMatch(/onLayout=\{onViewLayout\}/);
  expect(screen).toMatch(/onScrollBeginDrag=\{\(\) => \{\s+want\.current = null;/);
  expect(screen).not.toMatch(/if \(atEnd\.current\) scroller\.current\?\.scrollToEnd\(\{ animated: false \}\);\s+\}\}\s+maintainVisibleContentPosition/);
});

it('a chat deleted elsewhere frees the box: no endless dots, no Try again, the next question starts a new chat (final review A2)', () => {
  expect(screen).toMatch(/const gone = pollGone \|\| isGoneError\(chatQ\.error\)/);
  expect(screen).toMatch(/const pending = gone \? null : answering/);
  expect(screen).toMatch(/chatId && chatQ\.isError && !gone \?/);
  expect(src('core/mico-ai-queries.ts')).toMatch(/function useAnswerPoll[^]*isGoneError\(q\.error\)[^]*if \(pending\) putMessage\(qc, userId, chatId, goneCopy\(pending\)\)/);
});
