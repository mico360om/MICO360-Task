import { afterEach, describe, it, expect } from 'vitest';
import { crc32, deflateSync } from 'node:zlib';
import sharp from 'sharp';
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
    expect(text).toEqual(expect.arrayContaining(['Book the conference room', 'Grace Hopper', '5 Oct 2026', 'High', 'In progress', 'MICO-12']));
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
      expect(text.some((l) => l.includes('5 Oct 2026')), timeZone).toBe(true);
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
    // tpdf: 1.23.11 footer — the company on its own, the website and support address under it (was one "company · website · email" line).
    expect(pages[0]).toContain('MICO360 Softwares'); // footer
    expect(pages[0]).toContain('https://mico360.example  ·  info@mico360.example');
    expect(pages[0]).toContain('MICO360, Muscat, Oman');
    // brand color #8B1E1E → red ≈ 0.545 drives the brand rule/eyebrow fill
    expect(contents[0]).toMatch(/0\.545\d* 0\.117\d* 0\.117\d* scn/);
    // vector logo mark: rounded-tile bezier + clip + white check
    expect(contents[0]).toMatch(/ c\n/);
    expect(contents[0]).toContain('1 1 1 SCN');
  });

  it('lists a project meeting’s project details (code, client, owner, status, timeline) with the meeting’s facts at the top', () => {
    const linked: MinutesData = {
      ...data,
      project: { name: 'Falcon CRM', code: 'FAL', clientName: 'Acme Corp', statusLabel: 'Active', ownerName: 'Grace Hopper', startDate: '2026-01-01T00:00:00.000Z', targetDate: '2026-12-31T00:00:00.000Z' },
    };
    const { pages } = inspectPdf(buildMinutesPdf(linked));
    const top = pages[0]!.slice(0, pages[0]!.indexOf('Attendees present')); // above the summary tiles
    expect(top).toEqual(expect.arrayContaining(['Code', 'FAL', 'Client', 'Acme Corp', 'Owner', 'Grace Hopper', 'Timeline', '1 Jan 2026  –  31 Dec 2026']));
    // Named as the project's, so it isn't read as the meeting's status.
    expect(top).toEqual(expect.arrayContaining(['Project status', 'Active', 'Status', 'Scheduled']));
    // Not a section of its own at the end any more.
    expect(pages.flat()).not.toContain('Project details');
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
  const at = (d: MinutesData) => lines(d).find((t) => /^\d\d:\d\d – /.test(t));
  const saved = process.env.COMPANY_TIMEZONE;
  afterEach(() => {
    if (saved === undefined) delete process.env.COMPANY_TIMEZONE;
    else process.env.COMPANY_TIMEZONE = saved;
  });

  it('uses the meeting\'s own zone when it has one', () => {
    expect(at(data)).toBe('09:00 – 10:30 (UTC)');
    expect(at({ ...data, meeting: { ...data.meeting, timeZone: 'Asia/Dubai' } })).toBe('13:00 – 14:30 (GMT+4)');
  });

  it('falls back to the company zone (Asia/Muscat), not UTC, when the meeting has none', () => {
    delete process.env.COMPANY_TIMEZONE;
    const noZone: MinutesData = { ...data, meeting: { ...data.meeting, timeZone: null } };
    expect(at(noZone)).toBe('13:00 – 14:30 (GMT+4)');
    expect(lines(noZone)).toContain('Thursday 1 October 2026');
  });

  it('honours the company zone passed by the caller, then COMPANY_TIMEZONE, and skips invalid zones', () => {
    const noZone: MinutesData = { ...data, meeting: { ...data.meeting, timeZone: null } };
    expect(at({ ...noZone, companyTimeZone: 'Europe/London' })).toBe('10:00 – 11:30 (GMT+1)');
    process.env.COMPANY_TIMEZONE = 'Asia/Kolkata';
    expect(at(noZone)).toBe('14:30 – 16:00 (GMT+5:30)');
    expect(at({ ...data, meeting: { ...data.meeting, timeZone: 'Not/AZone' }, companyTimeZone: 'Asia/Muscat' })).toBe('13:00 – 14:30 (GMT+4)');
  });

  it('shows the footer’s time in the meeting’s zone', () => {
    delete process.env.COMPANY_TIMEZONE;
    const noZone: MinutesData = { ...data, meeting: { ...data.meeting, timeZone: null } };
    const text = lines(noZone);
    expect(text.some((t) => t.startsWith('Printed 1 Oct 2026, 15:00 by Ada Lovelace'))).toBe(true); // tpdf: 1.23.11 footer words (was "Generated …")
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
    // Its code, number and client are among the facts under the title (not repeated in the header).
    expect(pages[0]).toEqual(expect.arrayContaining(['Code', 'FAL', 'Project no.', 'PDO-2026-014', 'Client', 'Acme Corp']));
    expect(contents[0]).toMatch(/\/I\d+ Do/); // the picture
    expect(contents[0]).not.toContain('1 1 1 SCN'); // no MICO360 logo mark (its white check)
  });

  it('draws the project’s initials on its colour when its picture can’t be printed', () => {
    const webp = Buffer.from('RIFF\u0000\u0000\u0000\u0000WEBPVP8 ', 'latin1');
    const { pages, contents } = inspectPdf(buildMinutesPdf({ ...data, project: { ...project, image: webp } }));
    expect(contents[0]!.match(/\/I\d+ Do/g)).toHaveLength(1); // tpdf: 1.23.11 — the built-in logo only (every header has one), no project picture
    expect(pages[0]).toContain('FC');
    expect(contents[0]).toMatch(/0\.117\d* 0\.352\d* 0\.545\d* scn/); // #1E5A8B tile
  });

  it('never makes a broken PDF from a project picture it can’t print (interlaced, damaged): it shows the icon or the initials', async () => {
    // An interlaced PNG (pdfkit would unpack it after the file is written) and a JPEG pdfkit can't read.
    const interlaced = await sharp({ create: { width: 40, height: 40, channels: 3, background: '#aa3322' } }).png({ progressive: true }).toBuffer();
    const damaged = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), Buffer.alloc(14), Buffer.from([0xff, 0xd9])]);
    for (const [name, image] of [['interlaced PNG', interlaced], ['damaged JPEG', damaged]] as const) {
      const initials = inspectPdf(buildMinutesPdf({ ...data, project: { ...project, image } })); // throws on a broken file
      expect(initials.pages[0], name).toContain('FC');
      expect(initials.contents[0]!.match(/\/I\d+ Do/g), name).toHaveLength(1); // tpdf: 1.23.11 — the built-in logo only
      const icon = inspectPdf(buildMinutesPdf({ ...data, project: { ...project, image, icon: 'rocket' } }));
      expect(icon.pages[0], name).not.toContain('FC');
      expect(icon.contents[0], name).toMatch(/1 1 1 SCN\nS\n/);
    }
  });

  it('draws the project’s icon on its colour when it has an icon and no picture, as the app shows it', () => {
    const { pages, contents } = inspectPdf(buildMinutesPdf({ ...data, project: { ...project, image: null, icon: 'rocket' } }));
    expect(contents[0]!.match(/\/I\d+ Do/g)).toHaveLength(1); // tpdf: 1.23.11 — the built-in logo only
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
    // In order, with no author or time under it (owner, 4 Nov).
    expect(text.indexOf('Site')).toBeLessThan(text.indexOf('Book trucks'));
    expect(text.some((l) => /^Ada Lovelace · \d/.test(l))).toBe(false);
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
    expect(text.some((l) => /FINAL · Approved by Grace Hopper on 2 Oct 2026, 08:00/.test(l))).toBe(true);
    // The Final MOM first, then attendance, agenda, action items and the notes taken.
    const at = (s: string) => text.indexOf(s);
    expect(at('Final Minutes of Meeting')).toBeGreaterThan(-1);
    expect(at('Final Minutes of Meeting')).toBeLessThan(at('Attendees'));
    expect(at('Attendees')).toBeLessThan(at('Agenda'));
    expect(at('Agenda')).toBeLessThan(at('Notes taken during the meeting'));
    // Who prepared and approved them closes the Final MOM (not a page of its own at the end).
    const signed = text.findIndex((l) => /^Prepared by Ada Lovelace .*Approved by Grace Hopper on 2 Oct 2026, 08:00/.test(l));
    expect(signed).toBeGreaterThan(at('Draft the Q4 OKRs — Grace, by Friday'));
    expect(signed).toBeLessThan(at('Attendees'));
    // The notes stay as they were taken (without who wrote them or when — owner, 4 Nov).
    expect(text.some((l) => l.includes('Team aligned on focus areas.'))).toBe(true);
    expect(text.some((l) => l.startsWith('Ada Lovelace · '))).toBe(false);
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
    expect(text.slice(at)).toEqual(expect.arrayContaining(['Book the room — Grace Hopper, by 5 Oct 2026', 'Send the vendor shortlist — unassigned']));
    expect(text.indexOf('Book the room — Grace Hopper, by 5 Oct 2026')).toBeLessThan(text.indexOf('Send the vendor shortlist — unassigned'));
    expect(text.slice(at).some((l) => l.includes('Old item'))).toBe(false);
  });
});

describe('buildMinutesPdf: dates as the other PDFs write them, and late action items', () => {
  const late: MinutesData = {
    ...data,
    project: { name: 'Falcon CRM', code: 'FAL', startDate: '2026-09-01T00:00:00.000Z', targetDate: '2026-12-31T00:00:00.000Z' },
    // Made on 10 Oct (UTC, the meeting's zone): an open item due on 5 Oct is late; one due today is not yet.
    generatedAt: '2026-10-10T08:00:00.000Z',
    actionItems: [
      { description: 'Book the room', ownerName: 'Grace Hopper', dueDate: '2026-10-05', statusLabel: 'Open', priorityLabel: 'High', open: true },
      { description: 'Send the agenda', ownerName: 'Ada Lovelace', dueDate: '2026-10-10', statusLabel: 'In progress', priorityLabel: 'Normal', open: true },
      { description: 'Order the badges', ownerName: null, dueDate: '2026-10-20', statusLabel: 'Open', priorityLabel: 'Low', open: true },
      { description: 'Old item', ownerName: 'Ada', dueDate: '2026-09-01', statusLabel: 'Completed', priorityLabel: 'Low', open: false },
    ],
  };
  const MONTH_FIRST = /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d{1,2}(,|\b)/;
  const TWELVE_HOUR = /\d{1,2}:\d{2}\s?[AP]M\b/;

  it('writes every date day-month-year and every time on the 24-hour clock, as the task and Management PDFs do', () => {
    const final = { content: { summary: 'Agreed.', discussion: [], decisions: ['Go'], risks: [], nextSteps: [] }, status: 'FINAL' as const, approvedByName: 'Grace Hopper', approvedAt: '2026-10-02T08:00:00.000Z' };
    for (const d of [late, { ...late, final }]) {
      const text = lines(d);
      expect(text).toContain('Thursday 1 October 2026');
      expect(text).toContain('09:00 – 10:30 (UTC)');
      expect(text).toEqual(expect.arrayContaining(['1 Sep 2026  –  31 Dec 2026']));
      expect(text.some((l) => l.startsWith('Printed 10 Oct 2026, 08:00 by Ada Lovelace'))).toBe(true); // tpdf: 1.23.11 footer words
      expect(text.filter((l) => MONTH_FIRST.test(l)), 'month-first dates').toEqual([]);
      expect(text.filter((l) => TWELVE_HOUR.test(l)), '12-hour times').toEqual([]);
    }
  });

  it('marks an open action item past its due day "Overdue" beside its date, in words (not by colour alone)', () => {
    const text = lines(late);
    expect(text).toContain('5 Oct 2026 · Overdue');
    // Due today is not late yet; later, or already done, never.
    expect(text).toEqual(expect.arrayContaining(['10 Oct 2026', '20 Oct 2026', '1 Sep 2026']));
    expect(text.filter((l) => /Overdue/.test(l) && !/^Open action items/.test(l))).toEqual(['5 Oct 2026 · Overdue', 'Book the room — Grace Hopper, by 5 Oct 2026 · Overdue']);
    // The summary tile counts them too.
    expect(text).toEqual(expect.arrayContaining(['Open action items', '3', '1 overdue']));
  });

  it('keeps the meeting record’s action items marked in a Final MOM’s PDF too', () => {
    const text = lines({ ...late, final: { content: { summary: 'Agreed.', discussion: [], decisions: [], risks: [], nextSteps: [] }, status: 'FINAL', approvedByName: 'Grace Hopper', approvedAt: '2026-10-02T08:00:00.000Z' } });
    expect(text).toContain('5 Oct 2026 · Overdue');
  });

  it('says nothing about late items when none is late', () => {
    const text = lines({ ...late, generatedAt: '2026-10-01T11:00:00.000Z' });
    expect(text.some((l) => /overdue/i.test(l))).toBe(false);
  });
});

describe('buildMinutesPdf: the compact layout (1.22.1)', () => {
  const TEAMS =
    'https://teams.microsoft.com/meet/23131866900591?p=qZNhVdSqajkkz7EM7R%20Meeting%20ID:%20231%20318%20669%20005%2091%20Passcode:%20rb9AH9kT';
  const drawn = (d: MinutesData) => inspectPdf(buildMinutesPdf(d)).lines.flat();
  const line = (d: MinutesData, text: string) => {
    const found = drawn(d).find((l) => l.text === text);
    expect(found, `"${text}" is drawn`).toBeDefined();
    return found!;
  };
  const project = { name: 'Falcon CRM', code: 'FAL', clientName: 'Acme Corp', statusLabel: 'Active', ownerName: 'Grace Hopper' };

  // tpdf: 1.23.11 — the minutes' compact look became every PDF's standard (owner, 10 Nov): a 15.5 pt
  // title, an 11 pt project name in the slim header, 9.5 pt notes, 8.5 pt tables and facts, 11 pt headings,
  // 10.5 pt strip values, 14 mm margins (was 14.5 / 12.5 / 9 / 8 / 10.5 / 11 pt and 16 mm).
  it('sets the minutes on the PDF standard: a 15.5 pt title, an 11 pt project name, 9.5 pt notes, 8.5 pt tables and facts', () => {
    const d: MinutesData = { ...data, project };
    expect(line(d, 'Q4 Planning Sync').size).toBe(15.5);
    expect(line(d, 'Falcon CRM').size).toBe(11); // the header's project name (drawn first)
    expect(line(d, 'Team aligned on focus areas.').size).toBe(9.5); // a note
    expect(line(d, 'Boardroom A').size).toBe(8.5); // a fact
    expect(line(d, 'Guest Visitor').size).toBe(8.5); // a table cell
    for (const heading of ['Attendees', 'Agenda', 'Decisions']) expect(line(d, heading).size, heading).toBe(11);
    // One slim summary strip: values at 10.5 pt.
    expect(line(d, '1/2').size).toBe(10.5);
  });

  it('uses the standard’s 14 mm side margins', () => {
    const x = line(data, 'Q4 Planning Sync').x;
    expect((x / 72) * 25.4).toBeCloseTo(14, 1);
  });

  it('shows a long online link as a short label that can still be clicked, never the address over many lines', () => {
    const pdf = buildMinutesPdf({ ...data, meeting: { ...data.meeting, onlineLink: TEAMS } });
    const { pages, objects } = inspectPdf(pdf);
    const text = pages.flat();
    expect(text).toContain('Microsoft Teams — join link');
    expect(text.filter((l) => /teams\.microsoft|%20/.test(l))).toEqual([]);
    // The whole address is kept behind the label.
    const uris = [...objects.values()].join('\n');
    expect(uris).toContain('/URI (https://teams.microsoft.com/meet/23131866900591?p=qZNhVdSqajkkz7EM7R%20Meeting');
  });

  it('names other online links by their host, and prints text that is not a link as written', () => {
    expect(lines(data)).toContain('meet.example.com — join link');
    expect(lines({ ...data, meeting: { ...data.meeting, onlineLink: 'https://us02web.zoom.us/j/8123456789?pwd=abc' } })).toContain('Zoom — join link');
    expect(lines({ ...data, meeting: { ...data.meeting, onlineLink: 'https://meet.google.com/abc-defg-hij' } })).toContain('Google Meet — join link');
    const text = lines({ ...data, meeting: { ...data.meeting, onlineLink: 'Dial in: +968 2400 0000' } });
    expect(text).toContain('Dial in: +968 2400 0000');
  });

  // Owner (4 Nov, 1.22.2): the minutes never print who wrote a note or when — "it should not be there".
  it('prints no author or time under any note; a key point still says so at the end of its line', () => {
    const d: MinutesData = {
      ...data,
      notes: [
        { typeLabel: 'Discussion', type: 'DISCUSSION', body: 'Team aligned on focus areas.', authorName: 'Ada Lovelace', createdAt: '2026-10-01T09:05:00.000Z', highlighted: false },
        { typeLabel: 'Discussion', type: 'DISCUSSION', body: 'Written up the next morning.', authorName: 'Grace Hopper', createdAt: '2026-10-02T07:30:00.000Z', highlighted: true },
        { typeLabel: 'Discussion', type: 'DISCUSSION', body: 'Added in the new year.', authorName: 'Ada Lovelace', createdAt: '2027-01-04T08:00:00.000Z', highlighted: false },
      ],
    };
    const all = drawn(d);
    const texts = all.map((l) => l.text);
    expect(texts.some((t) => /^(Ada Lovelace|Grace Hopper) · /.test(t))).toBe(false); // no "Name · time" line
    expect(texts.some((t) => /· 09:05|2 Oct, 07:30|4 Jan 2027, 08:00/.test(t))).toBe(false); // nor the times
    expect(texts.some((t) => t.startsWith('— '))).toBe(false);
    const note = all.find((l) => l.text === 'Written up the next morning.')!;
    const key = all.find((l) => l.text === 'Key point')!;
    expect(key, 'the key point mark').toBeDefined();
    expect(key.y).toBeCloseTo(note.y, 1); // on the note's own line…
    expect(key.x).toBeGreaterThan(note.x + 200); // …at its end
    expect(key.size).toBeLessThan(note.size);
    expect(texts.filter((t) => t === 'Key point')).toHaveLength(1); // only the highlighted one
  });

  it('sets an Arabic key point’s mark at the left end of its line, with no author', () => {
    const all = drawn({ ...data, notes: [{ typeLabel: 'Discussion', type: 'DISCUSSION', body: 'ناقش الفريق خطة التوظيف.', authorName: 'خالد البلوشي', createdAt: '2026-10-01T09:05:00.000Z', highlighted: true }] });
    const note = all.find((l) => l.text === 'ناقش الفريق خطة التوظيف.')!;
    const key = all.find((l) => l.text === 'Key point')!;
    expect(key).toBeDefined();
    expect(key.x).toBeLessThan(note.x);
    expect(all.some((l) => l.text.includes('خالد البلوشي'))).toBe(false);
  });

  it('marks a draft with one slim line, and opens each part with a heading, not a filled band', () => {
    const final = { content: { summary: 'Agreed.', discussion: [], decisions: [], risks: [], nextSteps: [] }, status: 'DRAFT' as const, approvedByName: null, approvedAt: null };
    const d: MinutesData = { ...data, final };
    expect(line(d, 'DRAFT · Not yet approved — these minutes may still change').size).toBeLessThanOrEqual(8.5);
    expect(line(d, 'Final Minutes of Meeting').size).toBeLessThanOrEqual(12);
    expect(line(d, 'Meeting record').size).toBeLessThanOrEqual(12);
  });

  it('fits a monthly meeting like the owner’s sample (6 attendees, 3 action items, 9 notes) on two pages', () => {
    const rich = (title: string, rest: string) => `<p><strong>${title}:</strong> ${rest}</p>`;
    const note = (body: string, minute: number): MinutesData['notes'][number] => ({
      type: 'DISCUSSION', typeLabel: 'Discussion', format: 'RICH', body, authorName: 'Sam Admin', createdAt: `2026-11-04T13:${String(minute).padStart(2, '0')}:00.000Z`, highlighted: false,
    });
    const sample: MinutesData = {
      ...data,
      project: { name: 'Site IT Support', code: 'SITEIT', clientName: 'Gulf Energy Co.', statusLabel: 'Active', ownerName: 'Sam Admin', color: '#1E5A8B' },
      meeting: { ...data.meeting, title: '2nd Client & Contractor Monthly Meeting - 3rd Nov, 2026', statusLabel: 'Draft', organizerName: 'Sam Admin', location: 'Client HQ', onlineLink: TEAMS, startAt: '2026-11-03T10:00:00.000Z', endAt: '2026-11-03T11:00:00.000Z', timeZone: 'Asia/Muscat', description: null },
      attendees: ['Mariam Al Hinai', 'Yusuf Al Rashdi', 'Fahad Al Harthy', 'Abdul Karim Al Lawati', 'Sam Admin', 'Rina Mathew'].map((name, i) => ({
        name, roleLabel: 'Required', responseLabel: i === 5 ? 'No response' : 'Accepted', attendanceLabel: 'Not recorded', external: i < 4, email: null,
      })),
      agenda: [],
      actionItems: [
        { description: 'Revise the KPI framework to include simplified quarterly evaluations.', ownerName: 'Sam Admin', dueDate: null, statusLabel: 'Open', priorityLabel: 'Normal' },
        { description: 'Contractor to share the shortlisted candidate soon', ownerName: 'Sam Admin', dueDate: null, statusLabel: 'Open', priorityLabel: 'Normal' },
        { description: 'Follow up with the in-country value team', ownerName: 'Sam Admin', dueDate: null, statusLabel: 'Open', priorityLabel: 'Normal' },
      ],
      notes: [
        note(rich('Driving Licence Requirements', 'The team reviewed the ministry requirements for expatriate staff and discussed the eligibility of expatriate employees for a driving licence.'), 45),
        note(rich('Onboarding & Training', 'The client to share onboarding and orientation materials, if possible. The contractor to prepare the 2027 training plan covering technical skills, soft skills, and IT certifications (CCNA, CCNP & ITIL)'), 45),
        note(rich('KPI & Performance Evaluation', 'The annual KPI framework will be retained with the addition of simplified quarterly evaluations for recognition. Team leads shall nominate top performers. The contractor will share the new quarterly KPI sheet.'), 46),
        note(rich('Knowledge Transfer', 'Discussed the shift overlap for knowledge transfer and proper handover.'), 46),
        note(rich('Site Visits', 'Contractor management site visits'), 46),
        note(
          '<p><strong>Standby Resources &amp; Recruitment</strong></p><p>• Discussed the driving training needs and site familiarisation.</p><p><strong>Four positions open:</strong></p>' +
            '<ul><li><p>IT Support Specialist – MCT – Omani</p></li><li><p>IT Asset and Logistics Coordinator – MCT – Omani</p></li><li><p>Sr. Network &amp; Telecom Position – Field – Omani</p></li><li><p>Network and Telecom – MCT – Omani</p></li><li><p>Network and Telecom – Field – EXP</p></li></ul>' +
            '<p>The contractor to share the shortlisted candidate soon</p>',
          56,
        ),
        note(rich('Contract Compliance', '90-day notice period for new employees and probation clauses in employee contracts.'), 57),
        note(rich('In-country value', 'Waiting for an update from the in-country value team'), 58),
        note(rich('Retention & Benefits', 'A minimum 5% salary increment for 2026 was proposed, subject to internal approval by November, alongside ongoing discussions on family medical insurance. Potential employee relocation to Muscat if required.'), 59),
      ],
      final: { content: { summary: '', discussion: [], decisions: [], risks: [], nextSteps: [] }, status: 'DRAFT', approvedByName: null, approvedAt: null },
      generatedAt: '2026-11-04T14:04:00.000Z',
    };
    const { pages } = inspectPdf(buildMinutesPdf(sample));
    expect(pages.length).toBeLessThanOrEqual(2);
    // Everything is still there.
    const text = pages.flat();
    expect(text).toEqual(expect.arrayContaining(['Final Minutes of Meeting', 'Meeting record', 'Attendees', 'Agenda', 'Action Items', 'Notes taken during the meeting', 'Network and Telecom – Field – EXP', 'Code', 'SITEIT', 'Owner', 'Project status']));
    expect(text.some((l) => l.startsWith('Sam Admin ·'))).toBe(false); // no author or time under the notes
  });
});
