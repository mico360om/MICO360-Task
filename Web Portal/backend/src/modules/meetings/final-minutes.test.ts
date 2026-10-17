import { describe, it, expect } from 'vitest';
import { draftFromNotes, minutesFacts, normalizeFinalMinutes } from './final-minutes';
import type { MinutesData } from './minutes';
import { ValidationError } from '../../lib/http-errors';

const data: MinutesData = {
  brand: { productName: 'MICO360 Tasks', companyName: 'MICO360' },
  project: { name: 'Rig Inspection Portal', code: 'RIG1', number: 'PDO-2026-014' },
  meeting: {
    title: 'Weekly progress review',
    statusLabel: 'Completed',
    organizerName: 'Khurram',
    location: 'Boardroom A',
    onlineLink: null,
    startAt: '2026-10-14T06:00:00.000Z',
    endAt: '2026-10-14T07:00:00.000Z',
    timeZone: 'Asia/Muscat',
    description: 'Review progress and agree next steps.',
  },
  attendees: [
    { name: 'Khurram', roleLabel: 'Organizer', responseLabel: 'Accepted', attendanceLabel: 'Present', external: false, email: null },
    { name: 'Sara', roleLabel: 'Required', responseLabel: 'Maybe', attendanceLabel: 'Absent', external: false, email: null },
  ],
  agenda: [
    { title: 'Progress since last week', presenterName: 'Bilal', expectedMinutes: 15, completed: true },
    { title: 'Go-live plan', presenterName: 'Khurram', expectedMinutes: 15, completed: false },
  ],
  notes: [
    { type: 'DISCUSSION', typeLabel: 'Discussion', body: 'Photo upload is slow on site.', authorName: 'Bilal', createdAt: '2026-10-14T06:10:00.000Z', highlighted: false, agendaTitle: 'Progress since last week' },
    { type: 'DECISION', typeLabel: 'Decision', body: 'Go-live moves to 1 November.', authorName: 'Khurram', createdAt: '2026-10-14T06:40:00.000Z', highlighted: true, agendaTitle: 'Go-live plan' },
    { type: 'ISSUE', typeLabel: 'Issue', body: 'Field tablets may not be updated in time.', authorName: 'Sara', createdAt: '2026-10-14T06:50:00.000Z', highlighted: false },
    { type: 'QUESTION', typeLabel: 'Question', body: 'Who trains the inspectors?', authorName: 'Bilal', createdAt: '2026-10-14T06:52:00.000Z', highlighted: false },
    { type: 'INFORMATION', typeLabel: 'Information', body: 'The client approved the budget.', authorName: 'Khurram', createdAt: '2026-10-14T06:55:00.000Z', highlighted: false },
  ],
  actionItems: [
    { description: 'Send the revised form to the client', ownerName: 'Bilal', dueDate: '2026-10-18', statusLabel: 'Open', priorityLabel: 'High', open: true },
    { description: 'Old task', ownerName: 'Sara', dueDate: '2026-10-01', statusLabel: 'Completed', priorityLabel: 'Low', open: false },
  ],
  generatedAt: '2026-10-14T08:00:00.000Z',
  companyTimeZone: 'Asia/Muscat',
};

describe('draftFromNotes: a first draft without AI', () => {
  it('fills every section from the meeting’s own notes', () => {
    expect(draftFromNotes(data)).toEqual({
      summary: 'Review progress and agree next steps.',
      discussion: [
        { topic: 'Progress since last week', text: 'Photo upload is slow on site.' },
        { topic: 'Other points', text: 'The client approved the budget.' },
      ],
      decisions: ['Go-live moves to 1 November.'],
      risks: ['Field tablets may not be updated in time.', 'Open question: Who trains the inspectors?'],
      nextSteps: ['Send the revised form to the client — Bilal, by Oct 18, 2026'],
    });
  });

  it('writes a plain summary when the meeting has no description', () => {
    const draft = draftFromNotes({ ...data, meeting: { ...data.meeting, description: null } });
    expect(draft.summary).toBe('Weekly progress review on Wednesday, October 14, 2026: 1 of 2 attendees present, 1 of 2 agenda items covered, 1 decision.');
  });
});

describe('minutesFacts: what the AI is given', () => {
  it('lists the meeting, attendance, agenda, notes by agenda item and the action items', () => {
    const facts = minutesFacts(data);
    for (const s of [
      'Meeting: Weekly progress review',
      'Project: Rig Inspection Portal (RIG1, PDO-2026-014)',
      'Present: Khurram',
      'Absent: Sara',
      '1. Progress since last week (presenter Bilal, covered)',
      '2. Go-live plan (presenter Khurram, not covered)',
      '[Decision, agenda "Go-live plan", key point] Go-live moves to 1 November.',
      '[Issue] Field tablets may not be updated in time.',
      'Send the revised form to the client — owner Bilal, due 2026-10-18, Open',
    ]) {
      expect(facts, s).toContain(s);
    }
    expect(facts).not.toContain('Old task'); // done and gone: not a next step
  });
});

describe('Final MOM drafts from formatted notes', () => {
  const rich = {
    ...data,
    notes: [
      { type: 'DECISION', typeLabel: 'Decision', body: '<p><strong>Go-live</strong> moves to <mark>1 November</mark>.</p><ul><li><p>Client agreed</p></li></ul>', format: 'RICH' as const, authorName: 'Khurram', createdAt: '2026-10-14T06:40:00.000Z', highlighted: false, agendaTitle: 'Go-live plan' },
      { type: 'DISCUSSION', typeLabel: 'Discussion', body: '<h3>Site</h3><p>See <a href="https://example.com/plan">the plan</a></p>', format: 'RICH' as const, authorName: 'Bilal', createdAt: '2026-10-14T06:10:00.000Z', highlighted: false },
    ],
  };

  it('takes the words and the list structure, never the markup', () => {
    const d = draftFromNotes(rich);
    expect(d.decisions).toEqual(['Go-live moves to 1 November.\n- Client agreed']);
    expect(d.discussion).toEqual([{ topic: 'Other points', text: 'Site\nSee the plan (https://example.com/plan)' }]);
    const facts = minutesFacts(rich);
    expect(facts).toContain('Go-live moves to 1 November.');
    expect(facts).not.toMatch(/<\/?(p|strong|mark|ul|li|h3|a)\b/);
  });
});

describe('normalizeFinalMinutes', () => {
  it('keeps the sections, trims them, drops blank lines and caps the sizes', () => {
    expect(
      normalizeFinalMinutes({
        summary: '  A good meeting.  ',
        discussion: [{ topic: ' Progress ', text: ' Fine. ' }, { topic: '', text: '' }, { topic: 'x'.repeat(500), text: 'y' }],
        decisions: ['  Ship it  ', '', 42],
        risks: 'Late tablets',
        nextSteps: Array.from({ length: 60 }, (_, i) => `Step ${i}`),
        junk: true,
      }),
    ).toEqual({
      summary: 'A good meeting.',
      discussion: [{ topic: 'Progress', text: 'Fine.' }, { topic: 'x'.repeat(200), text: 'y' }],
      decisions: ['Ship it'],
      risks: ['Late tablets'],
      nextSteps: Array.from({ length: 40 }, (_, i) => `Step ${i}`),
    });
  });

  it('refuses something that isn’t minutes at all', () => {
    expect(() => normalizeFinalMinutes('hello')).toThrow(ValidationError);
    expect(() => normalizeFinalMinutes(null)).toThrow(ValidationError);
  });
});
