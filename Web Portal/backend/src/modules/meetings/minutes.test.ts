import { describe, it, expect } from 'vitest';
import { buildMinutesPdf, type MinutesData } from './minutes';

const data: MinutesData = {
  brand: {
    productName: 'MICO360 Tasks',
    companyName: 'MICO360 Softwares',
    tagline: 'Project & task management for teams',
    websiteUrl: 'https://mico360.example',
    supportEmail: 'support@mico360.example',
    companyAddress: 'MICO360, Muscat, Oman',
    colors: { brand: '#8B1E1E', ink: '#211B1A', muted: '#6C625F', line: '#E6DFDC' },
  },
  project: null,
  meeting: {
    title: 'Q4 Planning Sync',
    statusLabel: 'Scheduled',
    organizerName: 'Ada Lovelace',
    location: 'Boardroom A',
    onlineLink: 'https://meet.example.com/q4',
    startAt: '2026-10-01T09:00:00.000Z',
    endAt: '2026-10-01T10:30:00.000Z',
    timeZone: 'UTC',
    description: 'Review Q3 outcomes and lock Q4 priorities.',
  },
  attendees: [
    { name: 'Ada Lovelace', roleLabel: 'Required', attendanceLabel: 'Present', external: false, email: null },
    { name: 'Guest Visitor', roleLabel: 'Optional', attendanceLabel: 'Invited', external: true, email: 'guest@ext.co' },
  ],
  agenda: [
    { title: 'Review Q3 outcomes', presenterName: 'Ada Lovelace', expectedMinutes: 20, completed: true },
    { title: 'Lock Q4 priorities', presenterName: null, expectedMinutes: null, completed: false },
  ],
  notes: [
    { typeLabel: 'Decision', type: 'DECISION', body: 'Adopt a two-week sprint cadence.', authorName: 'Ada Lovelace', createdAt: '2026-10-01T09:15:00.000Z', highlighted: false },
    { typeLabel: 'Action Item', type: 'ACTION', body: 'Draft the Q4 OKRs by Friday.', authorName: 'Grace Hopper', createdAt: '2026-10-01T09:20:00.000Z', highlighted: true },
    { typeLabel: 'Discussion', type: 'DISCUSSION', body: 'Team aligned on focus areas.', authorName: 'Ada Lovelace', createdAt: '2026-10-01T09:05:00.000Z', highlighted: false },
  ],
  generatedAt: '2026-10-01T11:00:00.000Z',
  generatedByName: 'Ada Lovelace',
};

describe('buildMinutesPdf', () => {
  it('produces a valid multi-object PDF envelope', () => {
    const pdf = buildMinutesPdf(data).toString('latin1');
    expect(pdf.startsWith('%PDF-1.')).toBe(true);
    expect(pdf.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(pdf).toContain('startxref');
  });

  it('renders the meeting title, section headings and content', () => {
    const pdf = buildMinutesPdf(data).toString('latin1');
    expect(pdf).toContain('(Q4 Planning Sync) Tj');
    expect(pdf).toContain('(Attendees) Tj');
    expect(pdf).toContain('(Agenda) Tj');
    expect(pdf).toContain('(Decisions) Tj');
    expect(pdf).toContain('(Action Items) Tj');
    // decisions and action items are pulled out of the note stream
    expect(pdf).toContain('Adopt a two-week sprint cadence.');
    expect(pdf).toContain('Draft the Q4 OKRs by Friday.');
  });

  it('marks a standalone meeting and lists attendees with attendance', () => {
    const pdf = buildMinutesPdf(data).toString('latin1');
    expect(pdf).toContain('Standalone');
    expect(pdf).toContain('Ada Lovelace');
    expect(pdf).toContain('Present');
    expect(pdf).toContain('Guest'); // external attendee tagged
  });

  it('shows a friendly section when a meeting has no notes or agenda', () => {
    const empty: MinutesData = {
      ...data,
      agenda: [],
      notes: [],
      attendees: [],
      project: { name: 'Falcon CRM', code: 'FAL' },
      meeting: { ...data.meeting, description: null },
    };
    const pdf = buildMinutesPdf(empty).toString('latin1');
    expect(pdf).toContain('(Q4 Planning Sync) Tj');
    expect(pdf).toContain('Falcon CRM');
    // no Decisions/Action Items headings when there are none
    expect(pdf).not.toContain('(Decisions) Tj');
    expect(pdf).not.toContain('(Action Items) Tj');
  });

  it('renders the branded header and footer (product, eyebrow, company, website)', () => {
    const pdf = buildMinutesPdf(data).toString('latin1');
    expect(pdf).toContain('(MINUTES OF MEETING) Tj'); // eyebrow
    expect(pdf).toContain('(MICO360 Tasks) Tj'); // product name in the masthead
    expect(pdf).toContain('MICO360 Softwares'); // company in the footer
    expect(pdf).toContain('mico360.example'); // website in the footer
    // brand color #8B1E1E → red ≈ 0.55 drives the brand rule/eyebrow fill
    expect(pdf).toContain('0.55 ');
    // vector logo mark: rounded-tile bezier + clip + white check
    expect(pdf).toContain(' c\n');
    expect(pdf).toContain('1 1 1 RG');
  });

  it('renders a Project details section for a project-linked meeting', () => {
    const linked: MinutesData = {
      ...data,
      project: { name: 'Falcon CRM', code: 'FAL', clientName: 'Acme Corp', statusLabel: 'Active', ownerName: 'Grace Hopper', startDate: '2026-01-01T00:00:00.000Z', targetDate: '2026-12-31T00:00:00.000Z' },
    };
    const pdf = buildMinutesPdf(linked).toString('latin1');
    expect(pdf).toContain('(Project details) Tj');
    expect(pdf).toContain('Acme Corp'); // client
    expect(pdf).toContain('Grace Hopper'); // owner
    expect(pdf).toContain('FAL'); // code
  });

  it('escapes parentheses so note text cannot corrupt the stream', () => {
    const tricky: MinutesData = {
      ...data,
      notes: [{ typeLabel: 'Discussion', type: 'DISCUSSION', body: 'Weigh option (A) vs (B)\\C', authorName: 'X', createdAt: '2026-10-01T09:05:00.000Z', highlighted: false }],
    };
    const pdf = buildMinutesPdf(tricky).toString('latin1');
    expect(pdf).toContain('option \\(A\\) vs \\(B\\)\\\\C');
  });
});
