import { describe, it, expect } from 'vitest';
import { buildMinutesPdf, type MinutesData } from './minutes';
import { minutesFacts } from './final-minutes';
import { inspectPdf } from '../../lib/pdf-inspect';

// 1.23 Meeting series in the minutes: "Series: …" among the facts (no meeting number), and a section
// "Open from earlier meetings" with the series' open action items as of when the PDF is made.
const base: MinutesData = {
  brand: { productName: 'MICO360 Tasks', companyName: 'MICO360', colors: {} },
  project: null,
  meeting: {
    title: 'Monthly 3', statusLabel: 'Completed', organizerName: 'Ada', location: null, onlineLink: null,
    startAt: '2026-11-03T06:00:00.000Z', endAt: '2026-11-03T07:00:00.000Z', timeZone: 'Asia/Muscat', description: null,
  },
  attendees: [],
  agenda: [],
  notes: [],
  actionItems: [{ description: 'This meeting’s own item', ownerName: 'Ada', dueDate: null, statusLabel: 'Open', priorityLabel: 'Normal', open: true }],
  generatedAt: '2026-11-04T08:00:00.000Z',
  generatedByName: 'Ada',
};
const series: MinutesData['series'] = {
  name: 'Monthly site review',
  openFromEarlier: [
    { description: 'Send the drawings', ownerName: 'Bilal', dueDate: '2026-10-20', statusLabel: 'In progress', priorityLabel: 'High', open: true, meetingStartAt: '2026-10-06T06:00:00.000Z' },
    { description: 'Book the crane', ownerName: null, dueDate: null, statusLabel: 'Open', priorityLabel: 'Normal', open: true, meetingStartAt: '2026-09-01T06:00:00.000Z' },
  ],
};
const text = (d: MinutesData) => inspectPdf(buildMinutesPdf(d)).pages.flat().join('\n');

describe('the minutes PDF of a meeting in a series', () => {
  it('names the series among the facts, without a meeting number', () => {
    const t = text({ ...base, series });
    expect(t).toContain('Series');
    expect(t).toContain('Monthly site review');
    expect(t).not.toMatch(/meeting 3|Meeting 3 of/);
  });

  it('lists the open items of earlier meetings, with the meeting each came from', () => {
    const t = text({ ...base, series });
    expect(t).toContain('Open from earlier meetings');
    expect(t).toContain('Send the drawings');
    expect(t).toContain('6 Oct 2026');
    expect(t).toContain('Book the crane');
    expect(t).toContain('1 Sep 2026'); // the site's day format
    expect(t).toContain('Overdue'); // due 20 Oct, made 4 Nov
  });

  it('prints the section in the Final MOM’s meeting record too', () => {
    const t = text({ ...base, series, final: { content: { summary: 'Agreed.', discussion: [], decisions: [], risks: [], nextSteps: [] }, status: 'FINAL', approvedByName: 'Ada', approvedAt: '2026-11-03T08:00:00.000Z' } });
    expect(t).toContain('Open from earlier meetings');
    expect(t).toContain('Send the drawings');
  });

  it('leaves both out for a meeting in no series, and the section when nothing is open', () => {
    expect(text(base)).not.toContain('Open from earlier meetings');
    expect(text(base)).not.toContain('Monthly site review');
    const none = text({ ...base, series: { name: 'Monthly site review', openFromEarlier: [] } });
    expect(none).toContain('Monthly site review');
    expect(none).not.toContain('Open from earlier meetings');
  });
});

describe('the AI Final MOM draft of a meeting in a series', () => {
  it('is given the series and its open items from earlier meetings', () => {
    const facts = minutesFacts({ ...base, series });
    expect(facts).toContain('Series: Monthly site review');
    expect(facts).toContain('Open action items from earlier meetings of the series:');
    expect(facts).toContain('- Send the drawings — owner Bilal, due 2026-10-20, In progress (from the meeting of 6 Oct 2026)');
    expect(facts).toContain('- Book the crane — owner unassigned, due none, Open (from the meeting of 1 Sep 2026)');
  });

  it('says nothing of a series for a meeting in none', () => {
    expect(minutesFacts(base)).not.toContain('Series:');
  });
});
