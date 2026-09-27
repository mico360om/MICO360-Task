import { afterEach, describe, it, expect } from 'vitest';
import { buildMinutesPdf, resolveMinutesTimeZone, DEFAULT_COMPANY_TIMEZONE, type MinutesData } from './minutes';
import { inspectPdf } from '../../lib/pdf-inspect';

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

/** All drawn lines (logical text) of the minutes, across pages. */
const lines = (d: MinutesData): string[] => inspectPdf(buildMinutesPdf(d)).pages.flat();

describe('buildMinutesPdf', () => {
  it('produces a valid multi-object PDF envelope titled after the meeting', () => {
    const pdf = buildMinutesPdf(data).toString('latin1');
    expect(pdf.startsWith('%PDF-1.')).toBe(true);
    expect(pdf.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(pdf).toContain('startxref');
    expect(pdf).toContain('Q4 Planning Sync'); // document /Title
  });

  it('renders the meeting title, section headings and content', () => {
    const text = lines(data);
    expect(text).toEqual(expect.arrayContaining(['Q4 Planning Sync', 'Attendees', 'Agenda', 'Decisions', 'Action Items']));
    // decisions and action items are pulled out of the note stream
    expect(text).toContain('Adopt a two-week sprint cadence.');
    expect(text).toContain('Draft the Q4 OKRs by Friday.');
  });

  it('marks a standalone meeting and lists attendees with attendance', () => {
    const text = lines(data);
    expect(text).toContain('Standalone meeting');
    expect(text).toContain('Ada Lovelace  —  Required · Present');
    expect(text).toContain('Guest Visitor  <guest@ext.co>  —  Guest · Optional · Invited'); // external attendee tagged
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
    const text = lines(empty);
    expect(text).toContain('Q4 Planning Sync');
    expect(text).toContain('Falcon CRM');
    expect(text).toContain('No agenda items were recorded.');
    expect(text).toContain('No discussion notes were recorded.');
    // no Decisions/Action Items headings when there are none
    expect(text).not.toContain('Decisions');
    expect(text).not.toContain('Action Items');
  });

  it('renders the branded header and footer (product, eyebrow, company, website)', () => {
    const { pages, contents } = inspectPdf(buildMinutesPdf(data));
    expect(pages[0]).toContain('MINUTES OF MEETING'); // eyebrow
    expect(pages[0]).toContain('MICO360 Tasks'); // product name in the masthead
    expect(pages[0]).toContain('MICO360 Softwares  ·  https://mico360.example  ·  support@mico360.example'); // footer
    expect(pages[0]).toContain('MICO360, Muscat, Oman');
    // brand color #8B1E1E → red ≈ 0.545 drives the brand rule/eyebrow fill
    expect(contents[0]).toMatch(/0\.545\d* 0\.117\d* 0\.117\d* scn/);
    // vector logo mark: rounded-tile bezier + clip + white check
    expect(contents[0]).toMatch(/ c\n/);
    expect(contents[0]).toContain('1 1 1 SCN');
  });

  it('renders a Project details section for a project-linked meeting', () => {
    const linked: MinutesData = {
      ...data,
      project: { name: 'Falcon CRM', code: 'FAL', clientName: 'Acme Corp', statusLabel: 'Active', ownerName: 'Grace Hopper', startDate: '2026-01-01T00:00:00.000Z', targetDate: '2026-12-31T00:00:00.000Z' },
    };
    const text = lines(linked);
    expect(text).toContain('Project details');
    expect(text).toContain('Acme Corp'); // client
    expect(text).toContain('Grace Hopper'); // owner
    expect(text).toContain('FAL'); // code
    expect(text).toContain('Jan 1, 2026  –  Dec 31, 2026'); // timeline
  });

  it('keeps parentheses and backslashes in note text intact', () => {
    const tricky: MinutesData = {
      ...data,
      notes: [{ typeLabel: 'Discussion', type: 'DISCUSSION', body: 'Weigh option (A) vs (B)\\C', authorName: 'X', createdAt: '2026-10-01T09:05:00.000Z', highlighted: false }],
    };
    expect(lines(tricky)).toContain('[Discussion] Weigh option (A) vs (B)\\C');
  });

  it('prints Arabic titles, names and notes as Arabic text (no "?"), with mixed lines kept whole', () => {
    const arabic: MinutesData = {
      ...data,
      meeting: { ...data.meeting, title: 'اجتماع مراجعة الميزانية', organizerName: 'خالد البلوشي', location: 'قاعة الاجتماعات (الطابق الثاني)', description: 'مراجعة الميزانية التشغيلية' },
      attendees: [{ name: 'سالم الراشدي', roleLabel: 'Optional', attendanceLabel: 'Absent', external: true, email: 'salem@ext.om' }],
      agenda: [{ title: 'مراجعة نتائج الربع الثالث', presenterName: 'خالد البلوشي', expectedMinutes: 20, completed: true }],
      notes: [
        { typeLabel: 'Decision', type: 'DECISION', body: 'الموعد 10:30 in Room B', authorName: 'خالد البلوشي', createdAt: '2026-10-01T09:15:00.000Z', highlighted: false },
        { typeLabel: 'Discussion', type: 'DISCUSSION', body: 'ناقش الفريق خطة التوظيف للعام القادم.', authorName: 'Fatima', createdAt: '2026-10-01T09:05:00.000Z', highlighted: false },
      ],
      generatedByName: 'خالد البلوشي',
    };
    const pdf = buildMinutesPdf(arabic);
    const text = inspectPdf(pdf).pages.flat();
    expect(text).toContain('اجتماع مراجعة الميزانية');
    expect(text).toContain('خالد البلوشي');
    expect(text).toContain('قاعة الاجتماعات (الطابق الثاني)');
    expect(text).toContain('مراجعة الميزانية التشغيلية');
    expect(text).toContain('سالم الراشدي  <salem@ext.om>  —  Guest · Optional · Absent');
    expect(text).toContain('مراجعة نتائج الربع الثالث  (خالد البلوشي · 20 min · done)');
    expect(text).toContain('الموعد 10:30 in Room B');
    expect(text).toContain('[Discussion] ناقش الفريق خطة التوظيف للعام القادم.');
    expect(text.join('\n')).not.toMatch(/\?{2,}/);
    // the Arabic glyphs come from the embedded Naskh font
    expect(pdf.toString('latin1')).toMatch(/\/FontName \/[A-Z]{6}\+NotoNaskhArabic-(Bold|Regular)/);
  });
});

describe('minutes time zone (MTG-01)', () => {
  const at = (d: MinutesData) => lines(d).find((t) => /\d:\d\d [AP]M – /.test(t));
  const saved = process.env.COMPANY_TIMEZONE;
  afterEach(() => {
    if (saved === undefined) delete process.env.COMPANY_TIMEZONE;
    else process.env.COMPANY_TIMEZONE = saved;
  });

  it('uses the meeting\'s own zone when it has one', () => {
    expect(at(data)).toBe('9:00 AM – 10:30 AM (UTC)');
    expect(at({ ...data, meeting: { ...data.meeting, timeZone: 'Asia/Dubai' } })).toBe('1:00 PM – 2:30 PM (GMT+4)');
  });

  it('falls back to the company zone (Asia/Muscat), not UTC, when the meeting has none', () => {
    delete process.env.COMPANY_TIMEZONE;
    const noZone: MinutesData = { ...data, meeting: { ...data.meeting, timeZone: null } };
    expect(at(noZone)).toBe('1:00 PM – 2:30 PM (GMT+4)');
    expect(lines(noZone)).toContain('Thursday, October 1, 2026');
  });

  it('honours the company zone passed by the caller, then COMPANY_TIMEZONE, and skips invalid zones', () => {
    const noZone: MinutesData = { ...data, meeting: { ...data.meeting, timeZone: null } };
    expect(at({ ...noZone, companyTimeZone: 'Europe/London' })).toBe('10:00 AM – 11:30 AM (GMT+1)');
    process.env.COMPANY_TIMEZONE = 'Asia/Kolkata';
    expect(at(noZone)).toBe('2:30 PM – 4:00 PM (GMT+5:30)');
    expect(at({ ...data, meeting: { ...data.meeting, timeZone: 'Not/AZone' }, companyTimeZone: 'Asia/Muscat' })).toBe('1:00 PM – 2:30 PM (GMT+4)');
  });

  it('shows note and footer timestamps in the same zone', () => {
    delete process.env.COMPANY_TIMEZONE;
    const noZone: MinutesData = { ...data, meeting: { ...data.meeting, timeZone: null } };
    const text = lines(noZone);
    expect(text).toContain('— Ada Lovelace · Oct 1, 1:15 PM'); // 09:15Z decision in Muscat
    expect(text.some((t) => t.startsWith('Generated Oct 1, 3:00 PM by Ada Lovelace'))).toBe(true);
  });

  it('resolveMinutesTimeZone: meeting → caller company zone → env → Asia/Muscat', () => {
    delete process.env.COMPANY_TIMEZONE;
    expect(resolveMinutesTimeZone('Europe/Paris', 'Asia/Muscat')).toBe('Europe/Paris');
    expect(resolveMinutesTimeZone(null, 'Asia/Riyadh')).toBe('Asia/Riyadh');
    expect(resolveMinutesTimeZone('', undefined)).toBe(DEFAULT_COMPANY_TIMEZONE);
    expect(resolveMinutesTimeZone('bogus', 'also-bogus')).toBe('Asia/Muscat');
    process.env.COMPANY_TIMEZONE = 'Asia/Bahrain';
    expect(resolveMinutesTimeZone(null, null)).toBe('Asia/Bahrain');
  });
});
