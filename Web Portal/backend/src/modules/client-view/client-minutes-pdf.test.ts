import { describe, it, expect } from 'vitest';
import { buildClientMinutesPdf, type ClientMinutesPdfData } from './client-minutes-pdf';
import { inspectPdf } from '../../lib/pdf-inspect';

const data: ClientMinutesPdfData = {
  brand: {
    productName: 'MICO360 Tasks',
    companyName: 'MICO360 Softwares',
    websiteUrl: 'https://mico360.example',
    supportEmail: 'info@mico360.example',
    companyAddress: 'MICO360, Muscat, Oman',
    colors: { brand: '#8B1E1E', ink: '#211B1A', muted: '#6C625F', line: '#E6DFDC' },
  },
  project: { name: 'Rig 7 Inspection', code: 'RIG', number: 'OD-2231', clientName: 'Oman Drilling Co.', color: '#1E6B8B', icon: null, image: null },
  meeting: { title: 'Kick-off', startAt: '2026-10-05T06:00:00.000Z', endAt: '2026-10-05T07:00:00.000Z', timeZone: 'Asia/Muscat' },
  approvedAt: '2026-10-06T06:00:00.000Z',
  content: {
    summary: 'Agreed the inspection plan for the three rigs.',
    discussion: [{ topic: 'Scope', text: 'Three rigs, two weeks each.' }],
    decisions: ['Start on 1 October'],
    risks: ['Weather in November'],
    nextSteps: ['Site survey by 10 October'],
  },
  generatedAt: '2026-10-26T08:00:00.000Z',
};

const lines = (d: ClientMinutesPdfData) => inspectPdf(buildClientMinutesPdf(d)).pages.flat();

describe('the client copy of the minutes PDF', () => {
  it('is a PDF titled after the meeting, headed by the project', () => {
    const pdf = buildClientMinutesPdf(data).toString('latin1');
    expect(pdf.startsWith('%PDF-1.')).toBe(true);
    expect(pdf).toContain('Kick-off');
    const text = lines(data);
    expect(text).toEqual(expect.arrayContaining(['Rig 7 Inspection', 'Kick-off', 'MINUTES OF MEETING']));
  });

  it('carries the approved final minutes: summary, discussion, decisions, risks and next steps', () => {
    const text = lines(data).join('\n');
    for (const part of ['Summary', 'Agreed the inspection plan for the three rigs.', 'Discussion', 'Scope', 'Three rigs, two weeks each.', 'Decisions', 'Start on 1 October', 'Risks & Open Issues', 'Weather in November', 'Next Steps', 'Site survey by 10 October']) {
      expect(text).toContain(part);
    }
    expect(text).toMatch(/FINAL · Approved on Oct 6/);
    expect(text).toContain('Monday, October 5, 2026');
  });

  it('names nobody and leaves out the meeting record (attendance, agenda, notes, action items)', () => {
    const text = lines(data).join('\n');
    for (const internal of ['Approved by', 'Prepared by', 'Organizer', 'Attendees', 'Agenda', 'Action Items', 'Notes taken', 'Meeting record', 'Generated', 'Owner', 'Location', 'Online']) {
      expect(text).not.toContain(internal);
    }
  });

  it('says in its footer that it was shared with the reader, never who made it', () => {
    const text = lines(data).join('\n');
    expect(text).toContain('MICO360 Softwares');
    expect(text).toContain('Shared with you through MICO360 Tasks');
    expect(text).not.toMatch(/(Generated|Prepared|Approved|Made|Shared) by/i);
  });

  it('sets Arabic minutes with real joined right-to-left text', () => {
    const text = lines({ ...data, content: { ...data.content, summary: 'تم الاتفاق على خطة التفتيش' } }).join('\n');
    expect(text).toContain('تم الاتفاق على خطة التفتيش');
  });

  it('leaves out empty sections', () => {
    const text = lines({ ...data, content: { summary: 'Only a summary.', discussion: [], decisions: [], risks: [], nextSteps: [] } }).join('\n');
    expect(text).toContain('Only a summary.');
    for (const heading of ['Discussion', 'Decisions', 'Risks & Open Issues', 'Next Steps']) expect(text).not.toContain(heading);
  });
});
