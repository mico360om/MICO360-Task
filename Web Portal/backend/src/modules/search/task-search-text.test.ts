import { describe, it, expect } from 'vitest';
import { buildSearchDocument, displayText, findRanges, snippetAround, type TaskSearchSource } from './task-search-text';

const source = (over: Partial<TaskSearchSource> = {}): TaskSearchSource => ({
  key: 'OPS-17',
  formerKeys: ['RIG-4'],
  title: 'Check the Scaffold',
  description: 'Before   the\nshift',
  comments: [{ body: 'The permit  expires Friday' }],
  checklist: [{ text: 'Photos of the base plates' }],
  assignees: [{ firstName: 'Bilal', lastName: 'Ahmed', username: 'bilal.a' }],
  contacts: [{ name: 'Ahmed Al Said', company: 'OXY', designation: 'Site lead', email: 'ahmed@oxy.com', phone: '+968 9912 3456', remarks: 'Call before 10' }],
  tags: [{ name: 'Safety' }],
  files: [{ filename: 'Permit-Scan.PDF' }],
  ...over,
});

describe('buildSearchDocument — 1.23.3 checklist titles', () => {
  it('finds a task by the title of one of its checklists', () => {
    expect(buildSearchDocument(source({ lists: [{ title: 'Electrical Panel' }] })).doc.split('\n')).toContain('electrical panel');
  });
});

describe('buildSearchDocument — one normalised text per task', () => {
  it('puts the keys and the title in the head, one key per line', () => {
    expect(buildSearchDocument(source()).head).toBe('\nops-17\nrig-4\ncheck the scaffold');
  });

  it('holds every field, case-folded and with spaces collapsed, one item per line', () => {
    const { doc, head } = buildSearchDocument(source());
    expect(doc.startsWith(`${head}\n`)).toBe(true);
    const lines = doc.slice(head.length + 1).split('\n');
    expect(lines).toEqual([
      'before the shift',
      'the permit expires friday',
      'photos of the base plates',
      'bilal ahmed',
      'bilal.a',
      'ahmed al said',
      'oxy',
      'site lead',
      'ahmed@oxy.com',
      '+968 9912 3456',
      'call before 10',
      'safety',
      'permit-scan.pdf',
    ]);
  });

  it('1.23: keeps the description on its own too (the lead), so a match there ranks above a comment', () => {
    expect(buildSearchDocument(source()).lead).toBe('before the shift');
    expect(buildSearchDocument(source({ description: null })).lead).toBe('');
  });

  it('leaves out what is empty', () => {
    const { doc, head } = buildSearchDocument(source({ description: null, comments: [{ body: '   ' }], contacts: [{ name: 'Sara', company: null, designation: null, email: null, phone: null, remarks: null }], formerKeys: [] }));
    expect(head).toBe('\nops-17\ncheck the scaffold');
    expect(doc.slice(head.length + 1).split('\n')).toEqual(['photos of the base plates', 'bilal ahmed', 'bilal.a', 'sara', 'safety', 'permit-scan.pdf']);
  });

  it('stores Arabic in its normalised spelling, diacritics dropped', () => {
    const { doc } = buildSearchDocument(source({ title: 'إدارة الموقع', comments: [{ body: 'المُدِير في المستشفى' }] }));
    expect(doc).toContain('اداره الموقع');
    expect(doc).toContain('المدير في المستشفي');
  });
});

describe('findRanges — where the words are, in the text as shown', () => {
  it('finds a part of a word, in any case', () => {
    expect(findRanges('The Scaffold permit', ['scaff'])).toEqual([{ start: 4, end: 9 }]);
  });

  it('finds every place each term appears, sorted, overlaps merged', () => {
    expect(findRanges('rig 3 and rig 4', ['rig'])).toEqual([{ start: 0, end: 3 }, { start: 10, end: 13 }]);
    expect(findRanges('scaffolding', ['scaff', 'affold'])).toEqual([{ start: 0, end: 8 }]);
  });

  it('matches Arabic whatever its letter forms, covering the diacritics in between', () => {
    const shown = 'المُدِير أحمد';
    const [a, b] = findRanges(shown, ['مدير', 'احمد']);
    expect(shown.slice(a!.start, a!.end)).toBe('مُدِير');
    expect(shown.slice(b!.start, b!.end)).toBe('أحمد');
  });

  it('finds a phrase only as written (words in that order)', () => {
    expect(findRanges('the scaffold permit', ['scaffold permit'])).toEqual([{ start: 4, end: 19 }]);
    expect(findRanges('permit for the scaffold', ['scaffold permit'])).toEqual([]);
  });

  it('copes with letters that change length when lower-cased', () => {
    const shown = 'İstanbul rig';
    const [r] = findRanges(shown, ['rig']);
    expect(shown.slice(r!.start, r!.end)).toBe('rig');
  });
});

describe('displayText', () => {
  it('shows text on one line, spaces collapsed', () => {
    expect(displayText('  a \n\n b\tc  ')).toBe('a b c');
    expect(displayText(null)).toBe('');
  });
});

describe('snippetAround — about 140 characters around the first match', () => {
  const long = `${'word '.repeat(60)}the scaffold permit ${'more '.repeat(60)}`.trim();

  it('cuts both ends with "…" and moves the ranges with the text', () => {
    const { snippet, ranges } = snippetAround(long, findRanges(long, ['scaff']));
    expect(snippet.startsWith('…')).toBe(true);
    expect(snippet.endsWith('…')).toBe(true);
    expect(snippet.length).toBeLessThanOrEqual(146);
    expect(ranges).toHaveLength(1);
    expect(snippet.slice(ranges[0]!.start, ranges[0]!.end)).toBe('scaff');
  });

  it('keeps a short text whole', () => {
    expect(snippetAround('Short scaffold', [{ start: 6, end: 11 }])).toEqual({ snippet: 'Short scaffold', ranges: [{ start: 6, end: 11 }] });
  });

  it('keeps only the matches inside the window, clipped to it', () => {
    const text = `scaff ${'x'.repeat(400)} scaff`;
    const { snippet, ranges } = snippetAround(text, findRanges(text, ['scaff']));
    expect(ranges).toHaveLength(1);
    expect(snippet.slice(ranges[0]!.start, ranges[0]!.end)).toBe('scaff');
  });

  it('with no match, shows the start of the text', () => {
    const { snippet, ranges } = snippetAround(long, []);
    expect(snippet.startsWith('word word')).toBe(true);
    expect(snippet.endsWith('…')).toBe(true);
    expect(ranges).toEqual([]);
  });
});

describe('snippetAround — never cuts a character in two', () => {
  const lone = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

  it('keeps emoji whole at both cuts', () => {
    for (const pad of [99, 100, 101]) {
      const shown = `${'😀'.repeat(pad)} scaffold ${'😀'.repeat(pad)}`;
      const { snippet, ranges } = snippetAround(shown, findRanges(shown, ['scaffold']));
      expect(lone.test(snippet), `pad ${pad}`).toBe(false);
      expect(snippet.slice(ranges[0]!.start, ranges[0]!.end)).toBe('scaffold');
    }
  });

  it('keeps a letter with its marks', () => {
    const shown = `${'مُدِيرٌ '.repeat(30)}scaffold ${'مُدِيرٌ '.repeat(30)}`;
    for (const width of [139, 140, 141, 142]) {
      const { snippet } = snippetAround(shown, findRanges(shown, ['scaffold']), width);
      expect(/^…\p{M}/u.test(snippet), `width ${width}`).toBe(false);
    }
  });
});
