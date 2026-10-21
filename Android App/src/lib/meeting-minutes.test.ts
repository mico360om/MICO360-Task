import { describe, it, expect } from 'vitest';
import { ApiError, NetworkError } from './api-client';
import { draftFailure, draftNotice, isEmptyContent, linesOf, minutesSaveFailure, toContent, toEditing, type MinutesEditing } from './meeting-minutes';
import type { FinalMinutesContent } from './types';

const content: FinalMinutesContent = {
  summary: 'Progress was reviewed.',
  discussion: [{ topic: 'Go-live', text: 'The client needs time.' }],
  decisions: ['Go-live moves to 1 November.', 'Weekly check-ins.'],
  risks: [],
  nextSteps: ['Send the form — Bilal, by 18 Oct'],
};

describe('editing the final minutes (the Final MOM)', () => {
  it('keeps each list as typed text, one item per line, and reads it back trimmed', () => {
    const e = toEditing(content);
    expect(e.decisions).toBe('Go-live moves to 1 November.\nWeekly check-ins.');
    expect(e.risks).toBe('');
    expect(toContent(e)).toEqual(content);
    const typed: MinutesEditing = {
      summary: '  A short meeting.  ',
      discussion: [{ topic: ' Budget ', text: ' Agreed. ' }, { topic: ' ', text: '' }],
      decisions: ' One \n\n  Two  \n',
      risks: '\n',
      nextSteps: 'Call the client',
    };
    expect(toContent(typed)).toEqual({ summary: 'A short meeting.', discussion: [{ topic: 'Budget', text: 'Agreed.' }], decisions: ['One', 'Two'], risks: [], nextSteps: ['Call the client'] });
    expect(linesOf(' a \n b\r\n\n')).toEqual(['a', 'b']);
  });

  it('knows empty minutes (they can’t be marked final)', () => {
    expect(isEmptyContent(toContent({ summary: ' ', discussion: [{ topic: '', text: ' ' }], decisions: '', risks: '\n', nextSteps: '' }))).toBe(true);
    expect(isEmptyContent(content)).toBe(false);
  });

  it('says where a draft came from', () => {
    expect(draftNotice('ai')).toBe('Drafted by the AI from the meeting’s agenda, notes and action items. Check it, then save it.');
    expect(draftNotice('notes')).toBe('Put together from the meeting’s notes. Edit it, then save it.');
  });

  it('says a slow AI is slow (not offline), and offers the notes instead', () => {
    expect(draftFailure(new NetworkError('slow', { timedOut: true }), 'ai')).toEqual({
      text: 'The AI is taking longer than usual. Try again in a minute, or start from the notes.',
      offerNotes: true,
    });
    expect(draftFailure(new ApiError(400, 'VALIDATION', 'AI is not configured yet.'), 'ai')).toEqual({ text: 'Couldn’t make a draft. AI is not configured yet.', offerNotes: true });
    expect(draftFailure(new NetworkError('offline'), 'notes')).toEqual({ text: 'Couldn’t make a draft. You’re offline — this needs a connection.', offerNotes: false });
  });

  it('says final minutes are locked until reopened', () => {
    expect(minutesSaveFailure(new ApiError(409, 'FINAL_MINUTES_LOCKED', 'These minutes are final. Reopen them to make changes.'), 'Couldn’t save the minutes.')).toBe(
      'These minutes were marked final meanwhile. Reopen them to make changes.',
    );
    expect(minutesSaveFailure(new ApiError(400, 'VALIDATION', 'Write the final minutes before marking them final.'), 'Couldn’t mark the minutes as final.')).toBe(
      'Couldn’t mark the minutes as final. Write the final minutes before marking them final.',
    );
  });
});
