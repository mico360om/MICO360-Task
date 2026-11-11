import { describe, it, expect } from 'vitest';
import type { KanbanColumnData } from '../components/KanbanColumn';
import type { TaskCardTask } from '../components/TaskCard';
import {
  BOARD_SEARCH_FIELDS,
  boardSearchDocs,
  findOnCard,
  matchesBoardSearch,
  readBoardSearch,
  searchBoard,
  type BoardSearchField,
} from './board-search';

const card = (key: string, title: string, more: Partial<TaskCardTask> = {}): TaskCardTask => ({
  key,
  title,
  priority: 'NORMAL',
  progress: 0,
  assignees: [],
  ...more,
});
const read = (text: string) => readBoardSearch(text)!;
const matches = (c: TaskCardTask, text: string, project?: { name: string; code: string }) => matchesBoardSearch(c, read(text), { project });

describe('readBoardSearch', () => {
  it('is nothing for empty words', () => {
    expect(readBoardSearch('')).toBeNull();
    expect(readBoardSearch('   ')).toBeNull();
    expect(readBoardSearch('""')).toBeNull();
  });

  it('reads words as the top-bar search does: folded, repeats dropped, a quoted phrase kept whole', () => {
    expect(read('  Pump   RIG pump ').terms).toEqual(['pump', 'rig']);
    expect(read('"gas leak" valve').terms).toEqual(['gas leak', 'valve']);
    expect(read('Pump rig').text).toBe('Pump rig');
  });
});

describe('matchesBoardSearch', () => {
  it('finds a part of a word in the title, in any case', () => {
    expect(matches(card('MICO-1', 'Scaffold permit'), 'SCAFF')).toBe(true);
    expect(matches(card('MICO-1', 'Scaffold permit'), 'fence')).toBe(false);
  });

  it('folds Arabic letter forms and diacritics on both sides', () => {
    expect(matches(card('MICO-1', 'تقرير أحمد'), 'احمد')).toBe(true);
    expect(matches(card('MICO-1', 'زيارة المدرسة'), 'مدرسه')).toBe(true);
    expect(matches(card('MICO-1', 'مراجعة محمد'), 'مُحَمَّد')).toBe(true);
    expect(matches(card('MICO-1', 'مستشفى'), 'مستشفي')).toBe(true);
  });

  it('needs every word somewhere on the task (AND), across fields', () => {
    const c = card('MICO-1', 'Pump overhaul', { description: 'On rig 3 before Friday' });
    expect(matches(c, 'pump rig')).toBe(true);
    expect(matches(c, 'pump crane')).toBe(false);
  });

  it('matches the description on its plain text, never its markup', () => {
    const c = card('MICO-1', 'Inspection', { description: '<p>Check the <strong>valve</strong></p>' });
    expect(matches(c, 'valve')).toBe(true);
    expect(matches(c, 'strong')).toBe(false);
  });

  it('finds the people on it, its project (name or code) and its tags', () => {
    const c = card('RIG-4', 'Weekly check', {
      assignees: [{ id: 'u1', name: 'Bilal Khan' }],
      project: { name: 'Rig Operations', code: 'RIG' },
      tags: [{ id: 'g1', name: 'Safety', color: '#f00' }],
    });
    expect(matches(c, 'bilal')).toBe(true);
    expect(matches(c, 'operations')).toBe(true);
    expect(matches(c, 'rig')).toBe(true);
    expect(matches(c, 'safety')).toBe(true);
    expect(matches(c, 'sara')).toBe(false);
  });

  it('on a one-project board, the board’s project counts as each card’s', () => {
    expect(matches(card('MICO-1', 'Weekly check'), 'platform', { name: 'MICO360 Platform', code: 'MICO' })).toBe(true);
    expect(matches(card('MICO-1', 'Weekly check'), 'platform')).toBe(false);
  });

  it('a task number matches exactly, however it is typed', () => {
    const twelve = card('MICO-12', 'Pump');
    const hundredTwenty = card('MICO-120', 'Pump');
    for (const typed of ['MICO-12', 'mico-12', 'mico 12', 'mico12', 'MICO_12', '#MICO-12']) {
      expect(matches(twelve, typed), typed).toBe(true);
      expect(matches(hundredTwenty, typed), typed).toBe(false);
    }
  });

  it('a number alone matches the task numbered …-N (never …-N0), or the number in its text', () => {
    expect(matches(card('MICO-12', 'Pump'), '12')).toBe(true);
    expect(matches(card('MICO-12', 'Pump'), '#12')).toBe(true);
    expect(matches(card('MICO-120', 'Pump'), '12')).toBe(false);
    expect(matches(card('MICO-7', 'Replace 12 inch pipe'), '12')).toBe(true);
  });

  it('a number among other words is one of the words', () => {
    expect(matches(card('MICO-12', 'Pump overhaul'), 'pump 12')).toBe(true);
    expect(matches(card('MICO-12', 'Crane'), 'pump 12')).toBe(false);
  });

  it('matches a number the task had before it moved project', () => {
    expect(matches(card('OPS-17', 'Moved one', { formerKeys: ['RIG-4'] } as Partial<TaskCardTask>), 'rig-4')).toBe(true);
  });

  it('takes extra fields without changing the matcher', () => {
    // tgc: 1.24 — guests and categories are default fields now (below); an extra field is still taken as is.
    const crew: BoardSearchField = { name: 'crew', texts: (c) => ((c as TaskCardTask & { crew?: string[] }).crew ?? []) };
    const c = { ...card('MICO-1', 'Site visit'), crew: ['Omar Rashid'] } as unknown as TaskCardTask;
    expect(matchesBoardSearch(c, read('omar'), {})).toBe(false);
    expect(matchesBoardSearch(c, read('omar'), { fields: [...BOARD_SEARCH_FIELDS, crew] })).toBe(true);
  });

  it('1.24: finds a card by its guests (name or company) and its categories', () => {
    const c = { ...card('MICO-1', 'Site visit'), guests: [{ id: 'g1', name: 'Ahmed Al Harthy', company: 'OXY' }], categories: [{ id: 'k1', name: 'Electrical', color: 'gold', retired: false }] } as TaskCardTask;
    expect(matchesBoardSearch(c, read('harthy'), {})).toBe(true);
    expect(matchesBoardSearch(c, read('oxy'), {})).toBe(true);
    expect(matchesBoardSearch(c, read('electric'), {})).toBe(true);
    expect(matchesBoardSearch(c, read('civil'), {})).toBe(false);
  });
});

describe('findOnCard (what the card marks)', () => {
  it('marks the words in the title, in the title’s own positions', () => {
    const found = findOnCard(card('MICO-1', 'Pump  and pump room'), read('pump'));
    expect(found.title).toEqual([{ start: 0, end: 4 }, { start: 10, end: 14 }]);
    expect(found.snippet).toBeNull();
  });

  it('marks Arabic words as written (diacritics inside the mark)', () => {
    const found = findOnCard(card('MICO-1', 'تقرير أحمد'), read('احمد'));
    expect(found.title).toEqual([{ start: 6, end: 10 }]);
  });

  it('shows a line of the description when a word is only there', () => {
    const description = `${'Background words that go on for a while. '.repeat(4)}Check the relief valve on rig 3.\nSecond line.`;
    const found = findOnCard(card('MICO-1', 'Pump overhaul', { description }), read('pump valve'));
    expect(found.title).toEqual([{ start: 0, end: 4 }]);
    expect(found.snippet).not.toBeNull();
    const { text, ranges } = found.snippet!;
    expect(text.startsWith('…')).toBe(true);
    expect(text).toContain('relief valve');
    expect(text.length).toBeLessThanOrEqual(122);
    expect(ranges.map((r) => text.slice(r.start, r.end))).toContain('valve');
  });

  it('review: a word its number already answers needs no description line ("12" on MICO-12 never marks "2012")', () => {
    const found = findOnCard(card('MICO-12', 'Pump', { description: 'Report for 2012' }), read('12'));
    expect(found.key).toBe(true);
    expect(found.snippet).toBeNull();
  });

  it('shows no description line when the title has every word', () => {
    expect(findOnCard(card('MICO-1', 'Valve', { description: 'the valve' }), read('valve')).snippet).toBeNull();
  });

  it('marks the people, the project and the tags that hold a word, and a number match', () => {
    const c = card('RIG-4', 'Weekly check', {
      assignees: [{ id: 'u1', name: 'Bilal Khan' }, { id: 'u2', name: 'Sara Nasser' }],
      project: { name: 'Rig Operations', code: 'RIG' },
      tags: [{ id: 'g1', name: 'Safety', color: '#f00' }, { id: 'g2', name: 'Weekly', color: '#0f0' }],
    });
    const found = findOnCard(c, read('sara operations safety'));
    expect(found.people).toEqual([{ id: 'u2', ranges: [{ start: 0, end: 4 }] }]);
    expect(found.project).toEqual([{ start: 4, end: 14 }]);
    expect(found.tags).toEqual(['g1']);
    expect(found.key).toBe(false);
    expect(findOnCard(c, read('rig-4')).key).toBe(true);
  });

  it('marks the whole project name when only its code matched', () => {
    const c = card('PRL-4', 'Weekly check', { project: { name: 'Prolens Rig', code: 'PRL' } });
    expect(findOnCard(c, read('prl')).project).toEqual([{ start: 0, end: 11 }]);
  });
});

describe('searchBoard', () => {
  const columns: KanbanColumnData[] = [
    { id: 'c1', name: 'To do', color: '', tasks: [card('MICO-1', 'Pump overhaul'), card('MICO-2', 'Crane hire'), card('MICO-3', 'Pump spares')] },
    { id: 'c2', name: 'Doing', color: '', tasks: [card('MICO-4', 'Fence repair')] },
    { id: 'c3', name: 'Done', color: '', tasks: [] },
  ];

  it('keeps every column, each with only its matching cards and how many it had', () => {
    const out = searchBoard(columns, read('pump'));
    expect(out.columns.map((c) => c.id)).toEqual(['c1', 'c2', 'c3']);
    expect(out.columns.map((c) => c.tasks.map((t) => t.key))).toEqual([['MICO-1', 'MICO-3'], [], []]);
    expect(out.columns.map((c) => c.total)).toEqual([3, 1, 0]);
    expect(out.shown).toBe(2);
    expect(out.total).toBe(4);
  });

  it('gives each shown card what it marks', () => {
    const out = searchBoard(columns, read('pump'));
    expect(out.columns[0]!.tasks[0]!.found?.title).toEqual([{ start: 0, end: 4 }]);
  });

  it('is the board as it is without words', () => {
    const out = searchBoard(columns, null);
    expect(out.columns).toBe(columns);
    expect(out.shown).toBe(4);
    expect(out.total).toBe(4);
  });

  it('reads each card’s text once (the docs can be kept between keystrokes)', () => {
    const docs = boardSearchDocs(columns);
    expect(docs.size).toBe(4);
    expect(docs.get('MICO-1')).toContain('pump overhaul');
    expect(searchBoard(columns, read('crane'), { docs }).shown).toBe(1);
  });

  it('keeps up with a thousand cards', () => {
    const many: KanbanColumnData[] = [0, 1, 2, 3].map((c) => ({
      id: `c${c}`,
      name: `C${c}`,
      color: '',
      tasks: Array.from({ length: 300 }, (_, i) =>
        card(`MICO-${c * 300 + i + 1}`, `Task ${i} ${i % 7 === 0 ? 'pump' : 'crane'} زيارة`, {
          description: 'A fairly long description of the work to be done on the site, with notes. '.repeat(5),
          assignees: [{ id: 'u1', name: 'Bilal Khan' }],
          tags: [{ id: 'g', name: 'Safety', color: '' }],
        }),
      ),
    }));
    const docs = boardSearchDocs(many);
    const t0 = performance.now();
    for (const words of ['p', 'pu', 'pum', 'pump', 'pump bil', 'زيار']) searchBoard(many, read(words), { docs });
    expect(performance.now() - t0).toBeLessThan(400);
  });
});
