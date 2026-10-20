import { afterEach, describe, it, expect } from 'vitest';
import { crc32, deflateSync } from 'node:zlib';
import { buildMinutesPdf, resolveMinutesTimeZone, DEFAULT_COMPANY_TIMEZONE, type MinutesData } from './minutes';
import { inspectPdf } from '../../lib/pdf-inspect';

const data: MinutesData = {
  brand: {
    productName: 'MICO360 Tasks',
    companyName: 'MICO360 Softwares',
    tagline: 'Project & task management for teams',
    websiteUrl: 'https://mico360.example',
    supportEmail: 'info@mico360.example',
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
    { name: 'Ada Lovelace', roleLabel: 'Required', responseLabel: 'Accepted', attendanceLabel: 'Present', external: false, email: null },
    { name: 'Guest Visitor', roleLabel: 'Optional', responseLabel: 'No response', attendanceLabel: 'Not recorded', external: true, email: 'guest@ext.co' },
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

  it('tables the meeting’s action items: owner, due day, priority, status and linked task', () => {
    const text = lines({
      ...data,
      actionItems: [
        { description: 'Book the conference room', ownerName: 'Grace Hopper', dueDate: '2026-10-05', statusLabel: 'In progress', priorityLabel: 'High', taskKey: 'MICO-12' },
        { description: 'Send the vendor shortlist', ownerName: null, dueDate: null, statusLabel: 'Open', priorityLabel: 'Normal' },
      ],
    });
    expect(text).toContain('Action Items');
    expect(text).toEqual(expect.arrayContaining(['Action', 'Owner', 'Due', 'Priority', 'Status', 'Task']));
    expect(text).toEqual(expect.arrayContaining(['Book the conference room', 'Grace Hopper', 'Oct 5, 2026', 'High', 'In progress', 'MICO-12']));
    // No owner or date: say so rather than leave a gap.
    expect(text).toEqual(expect.arrayContaining(['Send the vendor shortlist', 'Unassigned', '—', 'Open']));
    // An action note that isn't tracked as an item is still there.
    expect(text).toContain('Draft the Q4 OKRs by Friday.');
  });

  it('doesn’t repeat an action note that is already tracked as an action item', () => {
    const text = lines({
      ...data,
      notes: [{ typeLabel: 'Action Item', type: 'ACTION', body: 'Book the conference room', authorName: 'Ada Lovelace', createdAt: '2026-10-01T09:20:00.000Z', highlighted: false, trackedAsActionItem: true }],
      actionItems: [{ description: 'Book the conference room', ownerName: 'Grace Hopper', dueDate: null, statusLabel: 'Open', priorityLabel: 'Normal' }],
    });
    expect(text.filter((l) => l === 'Book the conference room')).toHaveLength(1);
  });

  it('opens with a summary: attendance, agenda covered, decisions and open action items', () => {
    const text = lines({ ...data, actionItems: [{ description: 'Book the room', ownerName: null, dueDate: null, statusLabel: 'Open', priorityLabel: 'Normal', open: true }] });
    expect(text).toEqual(expect.arrayContaining(['Attendees present', '1/2', 'Agenda items covered', 'Decisions made', 'Open action items']));
  });

  it('shows the meeting’s time zone by name', () => {
    expect(lines({ ...data, meeting: { ...data.meeting, timeZone: 'Asia/Dubai' } })).toEqual(expect.arrayContaining(['Time zone', 'Asia/Dubai']));
  });

  it('tables the agenda with presenters and planned time, and totals it against the meeting length', () => {
    const text = lines(data);
    expect(text).toEqual(expect.arrayContaining(['#', 'Item', 'Presenter', 'Planned', 'Covered']));
    expect(text).toEqual(expect.arrayContaining(['Review Q3 outcomes', 'Ada Lovelace', '20 min', 'Yes']));
    expect(text).toContain('Planned time: 20 min of a 90 min meeting');
  });

  it('groups the discussion by kind and marks key points', () => {
    const text = lines({
      ...data,
      notes: [
        { typeLabel: 'Discussion', type: 'DISCUSSION', body: 'Aligned on focus.', authorName: 'Ada Lovelace', createdAt: '2026-10-01T09:05:00.000Z', highlighted: true },
        { typeLabel: 'Issue', type: 'ISSUE', body: 'Vendor is late.', authorName: 'Ada Lovelace', createdAt: '2026-10-01T09:06:00.000Z', highlighted: false },
        { typeLabel: 'Question', type: 'QUESTION', body: 'Who signs off?', authorName: 'Ada Lovelace', createdAt: '2026-10-01T09:07:00.000Z', highlighted: false },
        { typeLabel: 'Information', type: 'INFORMATION', body: 'Budget is approved.', authorName: 'Ada Lovelace', createdAt: '2026-10-01T09:08:00.000Z', highlighted: false },
      ],
    });
    const at = (s: string) => text.indexOf(s);
    expect(at('Issues')).toBeGreaterThan(-1);
    expect(at('Questions')).toBeGreaterThan(at('Issues'));
    expect(at('Information')).toBeGreaterThan(at('Questions'));
    expect(at('Vendor is late.')).toBeGreaterThan(at('Issues'));
    expect(text.some((l) => l.includes('Key point'))).toBe(true);
  });

  it('has an Action Items section for action items alone (no note of that type)', () => {
    const text = lines({
      ...data,
      notes: data.notes.filter((n) => n.type !== 'ACTION'),
      actionItems: [{ description: 'Book the conference room', ownerName: 'Grace Hopper', dueDate: '2026-10-05', statusLabel: 'Open', priorityLabel: 'Normal' }],
    });
    expect(text).toContain('Action Items');
    expect(text).toContain('Book the conference room');
  });

  it('keeps the due date on its calendar day whatever the meeting’s time zone', () => {
    const item = { description: 'File the report', ownerName: 'Ada Lovelace', dueDate: '2026-10-05', statusLabel: 'Open', priorityLabel: 'Normal' };
    for (const timeZone of ['Pacific/Honolulu', 'Asia/Muscat', 'Pacific/Kiritimati']) {
      const text = lines({ ...data, meeting: { ...data.meeting, timeZone }, actionItems: [item] });
      expect(text.some((l) => l.includes('Oct 5, 2026')), timeZone).toBe(true);
    }
  });

  it('marks a standalone meeting and tables attendees: role, invitation response and attendance apart', () => {
    const text = lines(data);
    expect(text).toContain('Standalone meeting');
    expect(text).toEqual(expect.arrayContaining(['Name', 'Email', 'Role', 'Response', 'Attendance']));
    expect(text).toEqual(expect.arrayContaining(['Ada Lovelace', 'Required', 'Accepted', 'Present']));
    expect(text).toEqual(expect.arrayContaining(['Guest Visitor', 'guest@ext.co', 'Optional · Guest', 'No response', 'Not recorded']));
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
    expect(pages[0]).toContain('MICO360 Softwares  ·  https://mico360.example  ·  info@mico360.example'); // footer
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
    // Named as the project's, so it isn't read as the meeting's status.
    expect(text).toContain('Project status');
    expect(text.indexOf('Project status')).toBeGreaterThan(text.indexOf('Project details'));
  });

  it('keeps parentheses and backslashes in note text intact', () => {
    const tricky: MinutesData = {
      ...data,
      notes: [{ typeLabel: 'Discussion', type: 'DISCUSSION', body: 'Weigh option (A) vs (B)\\C', authorName: 'X', createdAt: '2026-10-01T09:05:00.000Z', highlighted: false }],
    };
    expect(lines(tricky)).toContain('Weigh option (A) vs (B)\\C');
  });

  it('prints Arabic titles, names and notes as Arabic text (no "?"), with mixed lines kept whole', () => {
    const arabic: MinutesData = {
      ...data,
      meeting: { ...data.meeting, title: 'اجتماع مراجعة الميزانية', organizerName: 'خالد البلوشي', location: 'قاعة الاجتماعات (الطابق الثاني)', description: 'مراجعة الميزانية التشغيلية' },
      attendees: [{ name: 'سالم الراشدي', roleLabel: 'Optional', responseLabel: 'Declined', attendanceLabel: 'Absent', external: true, email: 'salem@ext.om' }],
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
    expect(text).toEqual(expect.arrayContaining(['سالم الراشدي', 'salem@ext.om', 'Declined', 'Absent']));
    expect(text).toEqual(expect.arrayContaining(['مراجعة نتائج الربع الثالث', '20 min']));
    expect(text).toContain('الموعد 10:30 in Room B');
    expect(text).toContain('ناقش الفريق خطة التوظيف للعام القادم.');
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

describe('buildMinutesPdf: project header and layout', () => {
  /** A small half-transparent PNG, the kind the app's picture cropper makes for a logo. */
  function logoPng(): Buffer {

    const chunk = (type: string, body: Buffer) => {
      const len = Buffer.alloc(4);
      len.writeUInt32BE(body.length);
      const tb = Buffer.concat([Buffer.from(type, 'latin1'), body]);
      const crc = Buffer.alloc(4);
      crc.writeUInt32BE(crc32(tb) >>> 0);
      return Buffer.concat([len, tb, crc]);
    };
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(4, 0);
    ihdr.writeUInt32BE(4, 4);
    ihdr[8] = 8;
    ihdr[9] = 6;
    const row = Buffer.from([0, ...Array.from({ length: 4 }, () => [30, 90, 139, 200]).flat()]);
    return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.concat([row, row, row, row]))), chunk('IEND', Buffer.alloc(0))]);
  }
  const project = { name: 'Falcon CRM', code: 'FAL', number: 'PDO-2026-014', clientName: 'Acme Corp', color: '#1E5A8B' };

  it('puts the project’s picture, name, code and number at the top instead of the MICO360 masthead', () => {
    const pdf = buildMinutesPdf({ ...data, project: { ...project, image: logoPng() } });
    expect(pdf.toString('latin1').trimEnd().endsWith('%%EOF')).toBe(true);
    const { pages, contents } = inspectPdf(pdf);
    expect(pages[0]).toContain('MINUTES OF MEETING');
    expect(pages[0]).toContain('Falcon CRM');
    expect(pages[0]).toContain('FAL  ·  Project no. PDO-2026-014  ·  Acme Corp');
    expect(contents[0]).toMatch(/\/I\d+ Do/); // the picture
    expect(contents[0]).not.toContain('1 1 1 SCN'); // no MICO360 logo mark (its white check)
  });

  it('draws the project’s initials on its colour when its picture can’t be printed', () => {
    const webp = Buffer.from('RIFF\u0000\u0000\u0000\u0000WEBPVP8 ', 'latin1');
    const { pages, contents } = inspectPdf(buildMinutesPdf({ ...data, project: { ...project, image: webp } }));
    expect(contents[0]).not.toMatch(/\/I\d+ Do/);
    expect(pages[0]).toContain('FC');
    expect(contents[0]).toMatch(/0\.117\d* 0\.352\d* 0\.545\d* scn/); // #1E5A8B tile
  });

  it('draws the project’s icon on its colour when it has an icon and no picture, as the app shows it', () => {
    const { pages, contents } = inspectPdf(buildMinutesPdf({ ...data, project: { ...project, image: null, icon: 'rocket' } }));
    expect(contents[0]).not.toMatch(/\/I\d+ Do/);
    expect(pages[0]).not.toContain('FC'); // no initials
    expect(contents[0]).toMatch(/0\.117\d* 0\.352\d* 0\.545\d* scn/); // #1E5A8B tile
    expect(contents[0]).toMatch(/1 1 1 SCN/); // drawn in white…
    expect(contents[0]).toMatch(/SCN\nS\n/); // …as outlines
  });

  it('prints the initials for an icon it doesn’t know', () => {
    const { pages } = inspectPdf(buildMinutesPdf({ ...data, project: { ...project, image: null, icon: 'no-such-icon' } }));
    expect(pages[0]).toContain('FC');
  });

  it('keeps the MICO360 masthead for a meeting without a project', () => {
    const { pages } = inspectPdf(buildMinutesPdf({ ...data, project: null }));
    expect(pages[0]).toContain('MICO360 Tasks');
  });

  it('prints a formatted note with its formatting: faces, highlight, lists and the link with its address', () => {
    const note = {
      type: 'DISCUSSION', typeLabel: 'Discussion', format: 'RICH' as const, authorName: 'Ada Lovelace', createdAt: '2026-10-01T09:05:00.000Z', highlighted: false,
      body: '<h3>Site</h3><p>Pour the <strong>slab</strong> on <em>Monday</em>, <mark>no rain</mark>. See <a href="https://example.com/plan">the plan</a>.</p>' +
        '<ol><li><p>Book trucks</p></li><li><p>Call the pump</p><ul><li><p>Backup pump</p></li></ul></li></ol>',
    };
    const { pages, contents, objects } = inspectPdf(buildMinutesPdf({ ...data, notes: [note] }));
    const text = pages.flat();
    expect(text).toEqual(expect.arrayContaining(['Site', 'Pour the slab on Monday, no rain. See the plan (https://example.com/plan).', 'Book trucks', 'Call the pump', 'Backup pump', '1.', '2.']));
    // In order, and attributed like any note.
    expect(text.indexOf('Site')).toBeLessThan(text.indexOf('Book trucks'));
    expect(text.indexOf('Backup pump')).toBeLessThan(text.findIndex((l) => l.startsWith('— Ada Lovelace')));
    const dicts = [...objects.values()].join('\n');
    expect(dicts).toMatch(/IBMPlexSans-Italic/); // italics in the italic face
    expect(dicts).toMatch(/\/URI \(https:\/\/example\.com\/plan\)/); // the link can be clicked
    expect(contents.join('\n')).toMatch(/0\.992\d* 0\.90196\d* 0\.5411\d* (rg|scn)/); // the highlight is drawn
    // Not one tag in the document.
    expect(text.join(' ')).not.toMatch(/<\/?(p|strong|em|mark|ol|ul|li|h3|a)\b/);
  });

  it('marks the minutes as a draft until there is an approved Final MOM', () => {
    expect(inspectPdf(buildMinutesPdf(data)).pages[0]).toContain('DRAFT');
    expect(lines(data)).not.toContain('Final Minutes of Meeting');
  });

  const finalContent = {
    summary: 'Q4 priorities were agreed.',
    discussion: [{ topic: 'Sprint cadence', text: 'Two weeks suits both teams.' }],
    decisions: ['Adopt a two-week sprint cadence.'],
    risks: ['Hiring may slip.'],
    nextSteps: ['Draft the Q4 OKRs — Grace, by Friday'],
  };

  it('is one document: an approved Final MOM comes first, marked FINAL with who approved it, then the meeting record', () => {
    const pdf = buildMinutesPdf({ ...data, final: { content: finalContent, status: 'FINAL', approvedByName: 'Grace Hopper', approvedAt: '2026-10-02T08:00:00.000Z' } });
    const { pages } = inspectPdf(pdf);
    expect(pages[0]).toContain('FINAL');
    const text = pages.flat();
    expect(text).toEqual(expect.arrayContaining(['Final Minutes of Meeting', 'Q4 priorities were agreed.', 'Sprint cadence', 'Two weeks suits both teams.', 'Hiring may slip.', 'Draft the Q4 OKRs — Grace, by Friday']));
    expect(text.some((l) => /FINAL · Approved by Grace Hopper on Oct 2/.test(l))).toBe(true);
    // The Final MOM first, then attendance, agenda, action items and the notes taken.
    const at = (s: string) => text.indexOf(s);
    expect(at('Final Minutes of Meeting')).toBeGreaterThan(-1);
    expect(at('Final Minutes of Meeting')).toBeLessThan(at('Attendees'));
    expect(at('Attendees')).toBeLessThan(at('Agenda'));
    expect(at('Agenda')).toBeLessThan(at('Notes taken during the meeting'));
    // Who prepared and approved them closes the Final MOM (not a page of its own at the end).
    const signed = text.findIndex((l) => /^Prepared by Ada Lovelace .*Approved by Grace Hopper on Oct 2/.test(l));
    expect(signed).toBeGreaterThan(at('Draft the Q4 OKRs — Grace, by Friday'));
    expect(signed).toBeLessThan(at('Attendees'));
    // The notes stay as they were taken, with who wrote them.
    expect(text.some((l) => l.includes('Team aligned on focus areas.'))).toBe(true);
    expect(text.some((l) => l.startsWith('— Ada Lovelace'))).toBe(true);
  });

  it('prints a Final MOM that is still a draft, marked as not yet approved', () => {
    const text = lines({ ...data, final: { content: finalContent, status: 'DRAFT', approvedByName: null, approvedAt: null } });
    expect(text).toContain('Final Minutes of Meeting');
    expect(text.some((l) => /DRAFT · Not yet approved/.test(l))).toBe(true);
    expect(text).toContain('DRAFT');
    expect(text).not.toContain('FINAL');
  });

  it('lists the project number among the project details', () => {
    const text = lines({ ...data, project });
    expect(text).toEqual(expect.arrayContaining(['Project no.', 'PDO-2026-014']));
  });

  it('puts risks and open issues in a section of their own, before the discussion', () => {
    const text = lines({
      ...data,
      notes: [
        { typeLabel: 'Discussion', type: 'DISCUSSION', body: 'Aligned on focus.', authorName: 'Ada', createdAt: '2026-10-01T09:05:00.000Z', highlighted: false },
        { typeLabel: 'Issue', type: 'ISSUE', body: 'Vendor is late.', authorName: 'Ada', createdAt: '2026-10-01T09:06:00.000Z', highlighted: false },
      ],
    });
    expect(text.indexOf('Risks & Open Issues')).toBeGreaterThan(-1);
    expect(text.indexOf('Vendor is late.')).toBeGreaterThan(text.indexOf('Risks & Open Issues'));
    expect(text.indexOf('Discussion & Notes')).toBeGreaterThan(text.indexOf('Vendor is late.'));
    expect(text.indexOf('Aligned on focus.')).toBeGreaterThan(text.indexOf('Discussion & Notes'));
  });

  it('ends with the next steps: the open action items by due date, with their owners', () => {
    const text = lines({
      ...data,
      actionItems: [
        { description: 'Send the vendor shortlist', ownerName: null, dueDate: null, statusLabel: 'Open', priorityLabel: 'Normal' },
        { description: 'Book the room', ownerName: 'Grace Hopper', dueDate: '2026-10-05', statusLabel: 'Open', priorityLabel: 'High' },
        { description: 'Old item', ownerName: 'Ada', dueDate: '2026-09-01', statusLabel: 'Completed', priorityLabel: 'Low' },
      ],
    });
    const at = text.indexOf('Next Steps');
    expect(at).toBeGreaterThan(text.indexOf('Discussion & Notes'));
    expect(text.slice(at)).toEqual(expect.arrayContaining(['Book the room — Grace Hopper, by Oct 5, 2026', 'Send the vendor shortlist — unassigned']));
    expect(text.indexOf('Book the room — Grace Hopper, by Oct 5, 2026')).toBeLessThan(text.indexOf('Send the vendor shortlist — unassigned'));
    expect(text.slice(at).some((l) => l.includes('Old item'))).toBe(false);
  });
});
