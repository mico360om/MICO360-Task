import { describe, it, expect, vi } from 'vitest';
import sharp from 'sharp';
import { taskSheets, taskPdf, describeActivity, withPictures, commentRuns, MAX_PICTURES, type TaskExportData, type TaskExportAttachment } from './task-export';
import { inspectPdf, type DrawnLine } from '../../lib/pdf-inspect';
import { layoutStyledText } from '../../lib/pdf-text';
import { blankPng } from '../../lib/test-images';

const ctx = { generatedAt: new Date('2026-10-01T06:00:00Z'), timeZone: 'Asia/Muscat', generatedBy: 'Aisha Khan' };

const task = (over: Partial<TaskExportData> = {}): TaskExportData => ({
  key: 'MICO-42',
  title: 'مراجعة تقرير المبيعات الشهري — monthly sales review',
  description: 'Gather the figures from finance.\nCompare with last month and flag anything over 10%.',
  projectName: 'MICO360 Platform',
  projectCode: 'MICO',
  projectNumber: 'PDO-2026-014',
  projectColor: '#1E5A8B',
  projectIcon: null,
  status: 'In progress',
  category: 'IN_PROGRESS',
  priority: 'HIGH',
  startDate: new Date('2026-09-28T05:00:00Z'),
  dueDate: new Date('2026-10-05T00:00:00Z'),
  completedAt: null,
  createdAt: new Date('2026-09-28T05:00:00Z'),
  updatedAt: new Date('2026-09-30T10:00:00Z'),
  progress: 40,
  estimatedHours: 6,
  actualHours: 2.5,
  createdBy: 'Aisha Khan',
  assignees: ['Omar Ahmed', 'Sara Ahmed'],
  watchers: ['Bilal Ahmed'],
  tags: ['finance', 'monthly'],
  repeat: 'Repeats every month on the last Friday',
  overdue: false,
  isMilestone: false,
  meeting: null,
  checklist: [
    { text: 'Collect figures', done: true },
    { text: 'Write the summary', done: false },
  ],
  blockedBy: [{ key: 'MICO-40', title: 'Close the books', status: 'Done' }],
  blocks: [],
  attachments: [file('sales-sep.xlsx', { sizeBytes: 48_213 })],
  comments: [{ id: 'c1', parentId: null, author: 'Omar Ahmed', at: new Date('2026-09-29T08:20:00Z'), body: 'Figures attached. أرقام سبتمبر جاهزة.', edited: false }],
  mentionable: ['omar', 'aisha', 'sara'],
  activity: [
    { at: new Date('2026-09-28T05:00:00Z'), who: 'Aisha Khan', action: 'CREATED', meta: { title: 'x' } },
    { at: new Date('2026-09-29T07:00:00Z'), who: 'Aisha Khan', action: 'ASSIGNED', meta: { assignee: 'Omar Ahmed' } },
    { at: new Date('2026-09-30T10:00:00Z'), who: 'Omar Ahmed', action: 'MOVED', meta: { from: 'To do', to: 'In progress' } },
  ],
  ...over,
});

function file(filename: string, over: Partial<TaskExportAttachment> = {}): TaskExportAttachment {
  const picture = /\.(jpe?g|png|gif|webp)$/i.test(filename);
  return {
    filename,
    sizeBytes: 2048,
    uploadedBy: 'Omar Ahmed',
    uploadedAt: new Date('2026-09-29T08:15:00Z'),
    mimeType: picture ? `image/${filename.endsWith('png') ? 'png' : 'jpeg'}` : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    storageKey: `key-${filename}`,
    ...over,
  };
}

const photo = (width = 40, height = 30) => sharp({ create: { width, height, channels: 3, background: '#336699' } }).jpeg().toBuffer();

const linesOf = (pdf: Buffer): DrawnLine[] => inspectPdf(pdf).lines.flat();
const textOf = (pdf: Buffer): string[] => inspectPdf(pdf).pages.flat();
const count = (list: string[], t: string) => list.filter((x) => x === t).length;

describe('describeActivity', () => {
  it('turns stored actions into sentences', () => {
    expect(describeActivity('CREATED', { recurring: true })).toBe('Created the task (next copy of a repeating task)');
    expect(describeActivity('ASSIGNED', { assignee: 'Omar Ahmed' })).toBe('Assigned Omar Ahmed');
    expect(describeActivity('MOVED', { from: 'To do', to: 'In progress' })).toBe('Moved from To do to In progress');
    expect(describeActivity('COMPLETED', { from: 'Review', to: 'Done' })).toBe('Completed (Review → Done)');
    expect(describeActivity('REOPENED', { from: 'Done', to: 'To do' })).toBe('Reopened (Done → To do)');
    expect(describeActivity('task.something_else', null)).toBe('Task something else');
  });
});

describe('taskSheets', () => {
  it('puts the details on the first sheet and each list on its own sheet', () => {
    const sheets = taskSheets(task(), ctx);
    expect(sheets.map((s) => s.name)).toEqual(['Task', 'Checklist', 'Comments', 'Attachments', 'Dependencies', 'Activity']);
    const details = sheets[0]!;
    expect(details.title).toBe('MICO-42 · مراجعة تقرير المبيعات الشهري — monthly sales review');
    const field = (name: string) => details.rows.find((r) => r[0] === name)?.[1];
    expect(field('Project')).toBe('MICO360 Platform');
    expect(field('Status')).toBe('In progress');
    expect(field('Priority')).toBe('High');
    expect(field('Due')).toBe('5 Oct 2026');
    expect(field('Assignees')).toBe('Omar Ahmed, Sara Ahmed');
    expect(field('Repeat')).toBe('Repeats every month on the last Friday');
    expect(field('Progress')).toBe('40%');
    expect(field('Description')).toContain('Compare with last month');
    expect(sheets[1]!.rows).toEqual([['Done', 'Collect figures'], ['', 'Write the summary']]);
    expect(sheets[2]!.rows[0]).toEqual([{ date: '2026-09-29 12:20' }, 'Omar Ahmed', 'Figures attached. أرقام سبتمبر جاهزة.']);
    expect(sheets[3]!.rows[0]).toEqual(['sales-sep.xlsx', '47.1 KB', 'Omar Ahmed', { date: '2026-09-29 12:15' }]);
    expect(sheets[4]!.rows[0]).toEqual(['Blocked by', 'MICO-40', 'Close the books', 'Done']);
    expect(sheets[5]!.rows.map((r) => r[2])).toEqual(['Created the task', 'Assigned Omar Ahmed', 'Moved from To do to In progress']);
  });
});

describe('taskPdf: header', () => {
  it('opens with the project’s initials badge on its colour, its name and number, the task key, the title and who made the PDF', () => {
    const pdf = taskPdf(task({ title: 'Monthly sales review' }), ctx);
    const { pages, contents } = inspectPdf(pdf);
    for (const t of ['MP', 'TASK', 'MICO360 Platform', 'MICO  ·  Project no. PDO-2026-014', 'MICO-42', 'Monthly sales review', 'Generated 1 Oct 2026, 10:00 (Asia/Muscat) by Aisha Khan']) {
      expect(pages[0], t).toContain(t);
    }
    expect(contents[0]).toMatch(/0\.117\d* 0\.352\d* 0\.545\d* scn/); // the #1E5A8B tile
    expect(contents[0]).not.toMatch(/\/I\d+ Do/); // no uploaded logo, no company logo: the project's badge
    expect(pages[0]!.indexOf('MICO-42')).toBeLessThan(pages[0]!.indexOf('Monthly sales review'));
  });

  it('draws the project’s icon on its colour instead of its initials when it has one', () => {
    const { pages, contents } = inspectPdf(taskPdf(task({ projectIcon: 'rocket' }), ctx));
    expect(pages[0]).not.toContain('MP');
    expect(contents[0]).toMatch(/1 1 1 SCN/); // white outlines
  });

  it('shows the project’s uploaded picture as its badge; a see-through logo is set on white, so the PDF stays whole', async () => {
    const logo = await sharp({ create: { width: 48, height: 48, channels: 4, background: { r: 200, g: 40, b: 30, alpha: 0.5 } } }).png().toBuffer();
    const { pages, contents, objects } = inspectPdf(taskPdf(task({ projectIcon: 'rocket', projectImage: logo }), ctx));
    const images = [...objects.values()].filter((d) => /\/Subtype \/Image/.test(d) && /\/Width 48\b/.test(d));
    expect(images).toHaveLength(1);
    expect([...objects.values()].some((d) => /\/Type \/XObject/.test(d) && !/\/Subtype/.test(d))).toBe(false); // no half-written picture
    expect(contents[0]).toMatch(/\/I\d+ Do/);
    expect(inspectPdf(taskPdf(task({ projectImage: logo }), ctx)).contents[0]).toBe(contents[0]); // the picture, not the icon over it
    expect(pages[0]).not.toContain('MP');
  });

  it('never makes a broken PDF from a project picture it can’t print (interlaced, damaged): it shows the icon or the initials', async () => {
    const interlaced = await sharp({ create: { width: 48, height: 48, channels: 3, background: '#aa3322' } }).png({ progressive: true }).toBuffer();
    const noSize = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), Buffer.alloc(14), Buffer.from([0xff, 0xd9])]); // a JPEG pdfkit can't read
    for (const [name, projectImage] of [['interlaced PNG', interlaced], ['damaged JPEG', noSize]] as const) {
      const initials = inspectPdf(taskPdf(task({ projectImage }), ctx)); // throws on a broken file
      expect(initials.pages[0], name).toContain('MP');
      expect(initials.contents[0], name).not.toMatch(/\/I\d+ Do/);
      const icon = inspectPdf(taskPdf(task({ projectImage, projectIcon: 'rocket' }), ctx));
      expect(icon.pages[0], name).not.toContain('MP');
      expect(icon.contents[0], name).toMatch(/1 1 1 SCN/);
    }
  });

  it('sets the title from its start edge (left for English, right for Arabic), smaller as it gets longer', () => {
    const titleLines = (title: string) => linesOf(taskPdf(task({ title }), ctx)).filter((l) => title.includes(l.text) && l.text.length > 2 && l.size >= 13);
    const short = titleLines('Monthly sales review');
    expect(short.map((l) => [l.x, l.size])).toEqual([[54, 20]]);

    const long = 'Prepare the vendor onboarding pack for the new drilling contractor, collect every signed document and insurance certificate, and get it all approved before the kickoff on Sunday';
    const lines = titleLines(long);
    expect(lines.map((l) => l.text).join(' ')).toBe(long);
    expect(lines.length).toBeLessThanOrEqual(4);
    for (const l of lines) {
      expect(l.x).toBe(54);
      expect(l.size).toBeLessThan(20);
    }

    const arabic = titleLines('مراجعة تقرير المبيعات الشهري');
    expect(arabic).toHaveLength(1);
    expect(arabic[0]!.x).toBeGreaterThan(200);
  });
});

describe('taskPdf: summary and details', () => {
  it('shows status, priority, due and progress once, as cards; the details don’t repeat them', () => {
    const text = textOf(taskPdf(task({ overdue: true, blockedBy: [] }), ctx));
    for (const t of ['Status', 'Priority', 'Due', 'Progress', 'In progress', 'High', '5 Oct 2026', '40%']) expect(count(text, t), t).toBe(1);
    expect(text).toContain('Overdue');
  });

  it('lists people, dates, time against the estimate, repeat, milestone and the meeting the task came from', () => {
    const done = task({
      category: 'DONE',
      status: 'Done',
      completedAt: new Date('2026-10-01T05:30:00Z'),
      isMilestone: true,
      meeting: { id: 'm1', title: 'اجتماع العمليات الأسبوعي', startAt: new Date('2026-09-27T06:00:00Z') },
    });
    const text = textOf(taskPdf(done, ctx));
    const joined = text.join(' ');
    const pairs: Array<[string, string]> = [
      ['Project', 'MICO360 Platform'],
      ['Assignees', 'Omar Ahmed, Sara Ahmed'],
      ['Watchers', 'Bilal Ahmed'],
      ['Tags', 'finance, monthly'],
      ['Start', '28 Sep 2026'],
      ['Completed', '1 Oct 2026, 09:30'],
      ['Time', '6 h estimated · 2.5 h spent'],
      ['Repeat', 'Repeats every month on the last Friday'],
      ['Milestone', 'Yes, a key date of this project'],
      ['From meeting', 'اجتماع العمليات الأسبوعي · 27 Sep 2026'],
      ['Created', '28 Sep 2026, 09:00 by Aisha Khan'],
      ['Last updated', '30 Sep 2026, 14:00'],
    ];
    for (const [label, value] of pairs) {
      expect(text, label).toContain(label);
      expect(joined, value).toContain(value); // a long value may wrap within its column
    }
  });

  it('says only that the task came from a meeting when the reader can’t see that meeting', () => {
    const text = textOf(taskPdf(task({ meeting: { id: 'm1', title: null, startAt: null } }), ctx));
    const at = text.indexOf('From meeting');
    expect(at).toBeGreaterThan(-1);
    expect(text.join(' ')).toContain('A meeting you’re not part of');
  });

  it('leaves out what a task doesn’t have: no milestone, no meeting, no completed date', () => {
    const text = textOf(taskPdf(task({ watchers: [], tags: [], estimatedHours: null, actualHours: 3 }), ctx));
    for (const t of ['Milestone', 'From meeting', 'Completed', 'Watchers', 'Tags']) expect(text, t).not.toContain(t);
    expect(text).toContain('3 h spent');
  });
});

describe('taskPdf: description and checklist', () => {
  const url = 'https://drive.example.com/folders/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/contracts/2026/vendor-onboarding/signed-copies?usp=sharing&resourcekey=0-abcdefghijklmnop';
  const longItem = 'Confirm with the vendor that the signed contract, the insurance certificate and the HSE plan are all uploaded to the shared folder before the kickoff meeting on Sunday, and chase anyone who has not sent theirs';
  const arabicItem = 'مراجعة العقد مع المورد قبل الاجتماع والتأكد من التوقيعات';

  it('prints a long checklist item and a long link in full, never cut', () => {
    const permit = 'https://sharepoint.example.org/sites/operations/Shared%20Documents/HSE/2026/permits/permit-to-work-register-final-version-7-signed-by-all-parties.pdf';
    const t = task({
      description: `Shared folder:\n${url}`,
      checklist: [
        { text: longItem, done: false },
        { text: permit, done: true },
        { text: arabicItem, done: false },
      ],
    });
    const text = textOf(taskPdf(t, ctx));
    expect(text.filter((l) => longItem.includes(l)).join(' ')).toBe(longItem);
    expect(text.filter((l) => url.includes(l) && l.length > 3).join('')).toBe(url);
    expect(text.filter((l) => permit.includes(l) && l.length > 3).join('')).toBe(permit);
    expect(text).toContain('1 of 3 done');
    expect(text).toContain(arabicItem);
  });

  it('sets each description paragraph and checklist item in its own direction: Arabic from the right, English from the left', () => {
    const t = task({
      description: 'Gather the figures from finance.\nيرجى مراجعة الأرقام مع قسم المالية\nThen compare with last month.',
      checklist: [{ text: 'Collect figures', done: true }, { text: arabicItem, done: false }],
    });
    const lines = linesOf(taskPdf(t, ctx));
    const at = (s: string) => lines.find((l) => l.text === s)!;
    expect(at('Gather the figures from finance.').x).toBe(54);
    expect(at('Then compare with last month.').x).toBe(54);
    expect(at('يرجى مراجعة الأرقام مع قسم المالية').x).toBeGreaterThan(250);
    expect(at('Collect figures').x).toBeGreaterThan(54); // after its box
    expect(at('Collect figures').x).toBeLessThan(80);
    expect(at(arabicItem).x).toBeGreaterThan(200);
  });

  it('draws the checklist boxes, ticking the done items', () => {
    const t = task({ checklist: [{ text: 'One', done: true }, { text: 'Two', done: true }, { text: 'Three', done: false }] });
    const { pages, contents } = inspectPdf(taskPdf(t, ctx));
    expect(pages.flat()).toContain('2 of 3 done');
    expect(pages.flat().join(' ')).not.toMatch(/[☐☑✓]|\bOpen\b/);
    expect(contents.join('\n').match(/1 1 1 SCN/g)).toHaveLength(2); // a white tick in each done box
  });
});

describe('taskPdf: comments', () => {
  const at = (h: number) => new Date(Date.UTC(2026, 8, 29, h));
  const comments = [
    { id: 'c1', parentId: null, author: 'Omar Ahmed', at: at(5), body: 'Figures attached, @aisha please review', edited: false },
    { id: 'c3', parentId: null, author: 'Sara Ahmed', at: at(6), body: 'I will draft the summary', edited: false },
    { id: 'c2', parentId: 'c1', author: 'Aisha Khan', at: at(7), body: 'Thanks @omar, looks good. Ask @stranger too', edited: true },
    { id: 'c4', parentId: 'c2', author: 'سارة البلوشي', at: at(8), body: 'تمت المراجعة', edited: false },
    { id: 'c5', parentId: 'gone', author: 'Bilal Ahmed', at: at(9), body: 'Answering a deleted comment', edited: false },
  ];

  it('puts each reply under the comment it answers, indented one step further', () => {
    const lines = linesOf(taskPdf(task({ comments }), ctx));
    const body = (s: string) => lines.find((l) => l.text === s)!;
    const order = ['Figures attached, @aisha please review', 'Thanks @omar, looks good. Ask @stranger too', 'تمت المراجعة', 'I will draft the summary', 'Answering a deleted comment'];
    const ys = order.map((s) => lines.indexOf(body(s)));
    expect(ys).toEqual([...ys].sort((a, b) => a - b));
    expect(body('Figures attached, @aisha please review').x).toBe(54);
    expect(body('Thanks @omar, looks good. Ask @stranger too').x).toBe(72);
    expect(body('I will draft the summary').x).toBe(54);
    expect(body('Answering a deleted comment').x).toBe(54);
    // The author and time head each comment, indented with it; an edited one says so.
    expect(lines.find((l) => l.text === 'Aisha Khan · 29 Sep 2026, 11:00 · edited')!.x).toBe(72);
    expect(lines.find((l) => l.text === 'سارة البلوشي · 29 Sep 2026, 12:00')!.x).toBe(90);
  });

  it('keeps an @mention whole inside an Arabic comment ("@aisha", not "aisha@")', () => {
    const [line] = layoutStyledText(commentRuns('تم التواصل مع شركة التأمين. @aisha', ['aisha']), { size: 10 });
    expect(line!.rtl).toBe(true);
    expect(line!.segments.map((s) => s.logical).join('')).toContain('@aisha');
    expect(line!.text).toBe('تم التواصل مع شركة التأمين. @aisha');
  });

  it('prints @mentions of people on the task in bold, and nothing else', () => {
    const lines = linesOf(taskPdf(task({ comments }), ctx));
    const reply = lines.find((l) => l.text === 'Thanks @omar, looks good. Ask @stranger too')!;
    expect(reply.fonts).toEqual(['IBMPlexSans-Regular', 'IBMPlexSans-SemiBold', 'IBMPlexSans-Regular']);
    const first = lines.find((l) => l.text === 'Figures attached, @aisha please review')!;
    expect(first.fonts).toEqual(['IBMPlexSans-Regular', 'IBMPlexSans-SemiBold', 'IBMPlexSans-Regular']);
  });
});

describe('taskPdf: attachments', () => {
  it(`shows up to ${MAX_PICTURES} pictures, three to a row, and lists further pictures and other files with size, who and when`, async () => {
    const picture = await photo();
    const pictures = Array.from({ length: 14 }, (_, i) => file(`photo-${i + 1}.jpg`, { sizeBytes: (i + 1) * 1024, picture }));
    const pdf = taskPdf(task({ attachments: [...pictures, file('sales-sep.xlsx', { sizeBytes: 48_213 })] }), ctx);
    const { objects } = inspectPdf(pdf);
    expect([...objects.values()].filter((d) => /\/Subtype \/Image/.test(d) && /\/Width 40\b/.test(d))).toHaveLength(12);
    const lines = linesOf(pdf);
    const text = lines.map((l) => l.text);
    expect(text).toContain('15 files · 12 pictures shown');
    for (let i = 1; i <= 14; i++) expect(text, `photo-${i}.jpg`).toContain(`photo-${i}.jpg`);
    // Captions sit three to a row.
    const cap = (n: number) => lines.find((l) => l.text === `photo-${n}.jpg`)!;
    expect(cap(1).y).toBe(cap(3).y);
    expect(cap(1).x).toBeLessThan(cap(2).x);
    expect(cap(2).x).toBeLessThan(cap(3).x);
    expect(cap(4).x).toBe(cap(1).x);
    // Only the listed files show their size.
    expect(text).toContain('13 KB');
    expect(text).toContain('14 KB');
    expect(text).toContain('47.1 KB');
    expect(text).not.toContain('1 KB');
    expect(text).not.toContain('12 KB');
  });

  it('lists a picture it can’t show instead of failing', async () => {
    const webp = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#336699' } }).webp().toBuffer();
    const attachments = [
      file('broken.jpg', { picture: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]) }),
      file('unreadable.jpg', { picture: null }),
      file('modern.webp', { mimeType: 'image/webp', picture: webp }),
      file('good.jpg', { picture: await photo() }),
    ];
    const pdf = taskPdf(task({ attachments }), ctx);
    const text = textOf(pdf);
    expect(text).toContain('4 files · 1 picture shown');
    for (const name of ['broken.jpg', 'unreadable.jpg', 'modern.webp']) expect(text, name).toContain(`${name} (picture could not be shown)`);
    expect(text).toContain('good.jpg');
  });

  it('lists pictures that were not read (no storage) like any other file', () => {
    const text = textOf(taskPdf(task({ attachments: [file('site.jpg'), file('plan.xlsx')] }), ctx));
    expect(text).toContain('2 files');
    expect(text).toContain('site.jpg');
    expect(text).toContain('plan.xlsx');
  });
});

describe('taskPdf: dependencies and activity', () => {
  it('shows Blocked by and Blocks as two tables', () => {
    const t = task({ blockedBy: [{ key: 'MICO-40', title: 'Close the books', status: 'Done' }], blocks: [{ key: 'MICO-50', title: 'Publish the report', status: 'To do' }] });
    const text = textOf(taskPdf(t, ctx));
    const i = (s: string) => text.indexOf(s);
    expect(i('Blocked by')).toBeGreaterThan(-1);
    expect(i('Blocks')).toBeGreaterThan(i('Close the books'));
    expect(i('MICO-50')).toBeGreaterThan(i('Blocks'));
    expect(count(text, 'Task')).toBe(2); // each table has its own header row
    // The title comes last, so an Arabic title ends at the page's edge instead of against another column.
    expect(text.slice(i('Blocked by') + 1, i('Blocked by') + 4)).toEqual(['Task', 'Status', 'Title']);
  });

  it('says when one side is empty, and when there are none at all', () => {
    expect(textOf(taskPdf(task({ blocks: [] }), ctx))).toContain('No other task waits for this one.');
    expect(textOf(taskPdf(task({ blockedBy: [], blocks: [] }), ctx))).toContain('No dependencies.');
  });

  it('shows the latest 50 changes, newest first, and says how many earlier ones are not shown', () => {
    const activity = Array.from({ length: 60 }, (_, i) => ({ at: new Date(Date.UTC(2026, 8, 1, 0, i)), who: 'Omar Ahmed', action: `STEP_${i + 1}`, meta: null }));
    const text = textOf(taskPdf(task({ activity }), ctx));
    expect(text.indexOf('Step 60')).toBeLessThan(text.indexOf('Step 59'));
    expect(text.indexOf('Step 12')).toBeLessThan(text.indexOf('Step 11'));
    for (let i = 1; i <= 10; i++) expect(text).not.toContain(`Step ${i}`);
    expect(text).toContain('10 earlier changes not shown');
    // When only the latest were loaded, the count comes from the task's total.
    expect(textOf(taskPdf(task({ activity, activityTotal: 75 }), ctx))).toContain('25 earlier changes not shown');
    expect(textOf(taskPdf(task(), ctx)).join(' ')).not.toContain('earlier change');
  });
});

describe('taskPdf: flow', () => {
  it('flows a long description and many comments onto further pages without losing any', () => {
    const many = task({
      description: Array.from({ length: 60 }, (_, i) => `Paragraph ${i + 1}: a sentence about the work that needs doing.`).join('\n'),
      comments: Array.from({ length: 40 }, (_, i) => ({ id: `c${i}`, parentId: null, author: 'Omar Ahmed', at: new Date('2026-09-29T08:20:00Z'), body: `Comment ${i + 1}`, edited: false })),
    });
    const { pages } = inspectPdf(taskPdf(many, ctx));
    expect(pages.length).toBeGreaterThan(2);
    const all = pages.flat();
    for (let i = 1; i <= 60; i++) expect(all.some((t) => t.startsWith(`Paragraph ${i}:`))).toBe(true);
    for (let i = 1; i <= 40; i++) expect(all).toContain(`Comment ${i}`);
    for (const p of pages.slice(1)) expect(p).toContain('MICO-42 · MICO360 Platform');
    expect(all.some((t) => /^Page 1 of \d+$/.test(t))).toBe(true);
  });

  it('says when a list is empty', () => {
    const text = textOf(taskPdf(task({ description: null, checklist: [], comments: [], attachments: [], blockedBy: [], activity: [] }), ctx));
    for (const t of ['No description.', 'No checklist items.', 'No comments yet.', 'No attachments.', 'No dependencies.', 'No activity yet.']) expect(text, t).toContain(t);
  });
});

describe('withPictures (reading a task’s pictures for its PDF)', () => {
  it(`reads the first ${MAX_PICTURES} pictures only, as small thumbnails, and leaves other files alone`, async () => {
    const thumb = await photo(12, 9);
    const read = vi.fn(async (key: string) => Buffer.from(`raw ${key}`));
    const thumbnail = vi.fn(async () => thumb);
    const pictures = Array.from({ length: 14 }, (_, i) => file(`photo-${i + 1}.jpg`));
    const out = await withPictures(task({ attachments: [file('plan.xlsx'), ...pictures] }), { read, thumbnail });
    expect(read).toHaveBeenCalledTimes(12);
    expect(read.mock.calls.map((c) => c[0])).toEqual(pictures.slice(0, 12).map((p) => p.storageKey));
    expect(out.attachments[0]!.picture).toBeUndefined();
    expect(out.attachments.slice(1, 13).every((a) => a.picture === thumb)).toBe(true);
    expect(out.attachments.slice(13).every((a) => a.picture === undefined)).toBe(true);
  });

  it('uses a printable picture as it is when there is no thumbnail maker, and marks one it can’t read', async () => {
    const jpeg = await photo();
    const read = async (key: string) => {
      if (key === 'key-gone.jpg') throw new Error('ENOENT');
      if (key === 'key-empty.jpg') return null;
      if (key === 'key-odd.webp') return Buffer.from('RIFF....WEBPVP8 ');
      return jpeg;
    };
    const out = await withPictures(task({ attachments: [file('ok.jpg'), file('gone.jpg'), file('empty.jpg'), file('odd.webp', { mimeType: 'image/webp' })] }), { read });
    expect(out.attachments.map((a) => (a.picture ? 'picture' : a.picture))).toEqual(['picture', null, null, null]);
  });

  it(`tries the next picture when one can’t be read, so up to ${MAX_PICTURES} still show (and gives up after a few)`, async () => {
    const jpeg = await photo();
    const pictures = Array.from({ length: 16 }, (_, i) => file(`photo-${i + 1}.jpg`));
    const broken = new Set(['key-photo-2.jpg', 'key-photo-5.jpg']);
    const read = vi.fn(async (key: string) => (broken.has(key) ? null : jpeg));
    const out = await withPictures(task({ attachments: pictures }), { read });
    expect(out.attachments.filter((a) => a.picture).length).toBe(12);
    expect(out.attachments.filter((a) => a.picture === null).map((a) => a.filename)).toEqual(['photo-2.jpg', 'photo-5.jpg']);
    expect(read).toHaveBeenCalledTimes(14);

    const nothing = vi.fn(async () => null);
    await withPictures(task({ attachments: Array.from({ length: 40 }, (_, i) => file(`p${i}.jpg`)) }), { read: nothing });
    expect(nothing).toHaveBeenCalledTimes(24);
  });

  it('falls back to the stored picture when the thumbnail maker fails', async () => {
    const jpeg = await photo();
    const out = await withPictures(task({ attachments: [file('ok.jpg')] }), { read: async () => jpeg, thumbnail: async () => { throw new Error('libvips'); } });
    expect(out.attachments[0]!.picture).toBe(jpeg);
  });

  it('shows a picture the thumbnail maker turns down only when the PDF can print it as stored (a JPEG, an opaque PNG); anything else is listed, never unpacked here', async () => {
    const stored: Record<string, Buffer> = {
      'key-a.jpg': await photo(),
      'key-b.png': await sharp({ create: { width: 8, height: 8, channels: 3, background: '#336699' } }).png().toBuffer(),
      'key-c.png': await sharp({ create: { width: 8, height: 8, channels: 4, background: { r: 30, g: 90, b: 140, alpha: 0.5 } } }).png().toBuffer(),
      'key-d.png': await blankPng(64, 64, { unpacked: 64 * 1024 * 1024, brokenChecksum: true }),
    };
    const out = await withPictures(task({ attachments: [file('a.jpg'), file('b.png'), file('c.png'), file('d.png')] }), { read: async (k) => stored[k]!, thumbnail: async () => null });
    expect(out.attachments.map((a) => (a.picture === stored[a.storageKey] ? 'as stored' : a.picture === null ? null : 'unpacked here'))).toEqual(['as stored', 'as stored', null, null]);
  });
});
