import { describe, it, expect } from 'vitest';
import { answerBlocks, cellDisplay, chatGroups, chatTitle, copyTextOf, suggestedQuestions } from './mico-ai';
import type { MicoAiChat, MicoAiMessage } from '../api/mico-ai';

describe('MICO AI answer text (a small Markdown subset, never HTML)', () => {
  it('paragraphs, bold and bullets', () => {
    expect(answerBlocks('**4 tasks** in Rig Inspection Portal are overdue:\n\nTwo meetings mention it:\n- **Weekly review** — Omar to finish\n• Site visit — moved')).toEqual([
      { kind: 'p', lines: [[{ text: '4 tasks', bold: true }, { text: ' in Rig Inspection Portal are overdue:', bold: false }]] },
      { kind: 'p', lines: [[{ text: 'Two meetings mention it:', bold: false }]] },
      { kind: 'ul', items: [[{ text: 'Weekly review', bold: true }, { text: ' — Omar to finish', bold: false }], [{ text: 'Site visit — moved', bold: false }]] },
    ]);
  });

  it('keeps line breaks inside a paragraph, and an unclosed ** as it is', () => {
    expect(answerBlocks('Line one\nLine **two')).toEqual([{ kind: 'p', lines: [[{ text: 'Line one', bold: false }], [{ text: 'Line **two', bold: false }]] }]);
  });

  it('HTML is only text', () => {
    expect(answerBlocks('<img src=x onerror="alert(1)"> **<b>hi</b>**')).toEqual([
      { kind: 'p', lines: [[{ text: '<img src=x onerror="alert(1)"> ', bold: false }, { text: '<b>hi</b>', bold: true }]] },
    ]);
  });
});

describe('MICO AI table cells', () => {
  it('days, dates, times and percentages read as the app writes them', () => {
    expect(cellDisplay('date', '2026-10-19')).toBe('Mon 19 Oct');
    expect(cellDisplay('datetime', '2026-10-21 10:05')).toBe('Wed 21 Oct, 10:05');
    expect(cellDisplay('days', 5)).toBe('5 days');
    expect(cellDisplay('days', 1)).toBe('1 day');
    expect(cellDisplay('percent', 62)).toBe('62%');
    expect(cellDisplay('number', 0)).toBe('0');
    expect(cellDisplay('text', null)).toBe('');
    expect(cellDisplay('key', 'RIG-14')).toBe('RIG-14');
  });
});

const chat = (id: string, lastMessageAt: string, title = id): MicoAiChat => ({ id, title, createdAt: lastMessageAt, updatedAt: lastMessageAt, lastMessageAt, match: null });

describe('MICO AI chat list', () => {
  it('groups chats by their last message: Today, Yesterday, Previous 7 days, Older (in the person’s time zone)', () => {
    const now = new Date('2026-10-24T08:00:00Z'); // Sat 24 Oct, 12:00 in Muscat
    const groups = chatGroups(
      [
        chat('a', '2026-10-24T07:00:00Z'),
        chat('b', '2026-10-23T21:00:00Z'), // 01:00 on the 24th in Muscat: today
        chat('c', '2026-10-23T10:00:00Z'),
        chat('d', '2026-10-19T10:00:00Z'),
        chat('e', '2026-10-01T10:00:00Z'),
      ],
      now,
      'Asia/Muscat',
    );
    expect(groups.map((g) => [g.label, g.chats.map((c) => c.id)])).toEqual([
      ['Today', ['a', 'b']],
      ['Yesterday', ['c']],
      ['Previous 7 days', ['d']],
      ['Older', ['e']],
    ]);
  });

  it('an unnamed chat is “New chat”', () => {
    expect(chatTitle(chat('a', '2026-10-24T07:00:00Z', ''))).toBe('New chat');
    expect(chatTitle(chat('a', '2026-10-24T07:00:00Z', 'Rig'))).toBe('Rig');
  });
});

describe('MICO AI copy and suggestions', () => {
  it('Copy gives the plain answer, its tables as tab-separated rows, and its sources', () => {
    const m: MicoAiMessage = {
      id: 'm1',
      role: 'assistant',
      status: 'done',
      text: '**2 tasks** are overdue.\n- Omar has one.',
      createdAt: '',
      step: null,
      answer: {
        kind: 'answer',
        unavailable: false,
        options: [],
        followUps: [],
        sources: [{ type: 'task', id: 't14', label: 'RIG-14', url: '?task=t14' }],
        tables: [
          {
            title: 'Overdue tasks',
            fromResult: 'r1',
            columns: [{ key: 'key', label: 'Task', kind: 'key' }, { key: 'due', label: 'Due', kind: 'date' }, { key: 'overdueDays', label: 'Overdue', kind: 'days' }],
            rows: [{ ref: null, cells: ['RIG-14', '2026-10-19', 5] }],
          },
        ],
      },
    };
    expect(copyTextOf(m)).toBe('2 tasks are overdue.\n• Omar has one.\n\nOverdue tasks\nTask\tDue\tOverdue\nRIG-14\tMon 19 Oct\t5 days\n\nSources: RIG-14');
  });

  it('four suggested questions, the last about one of the person’s projects', () => {
    expect(suggestedQuestions('Falcon CRM')).toEqual(['Which of my tasks are overdue?', 'Summarize this week’s meetings', 'Workload report for my team this week', 'What changed in Falcon CRM yesterday?']);
    expect(suggestedQuestions(null)[3]).toBe('Which projects need attention?');
  });
});
