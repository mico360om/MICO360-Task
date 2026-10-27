import { describe, it, expect } from 'vitest';
import type { InspectionForm } from '../../api/inspections';
import { addItem, addSection, draftFromForm, emptyDraft, itemCount, limitsPreview, move, newItem, removeItem, removeSection, validateDraft, type Draft } from './form-editor';

const filled = (): Draft => {
  const d = emptyDraft();
  d.title = '  Rig daily check ';
  d.description = ' Before the first shift. ';
  d.clientSignature = 'OPTIONAL';
  d.sections[0]!.title = ' Well head ';
  d.sections[0]!.items[0] = { ...d.sections[0]!.items[0]!, label: ' Valves closed ', help: '' };
  d.sections[0]!.items.push({ ...newItem('READING'), label: 'Pressure', unit: ' psi ', min: '0', max: '150.5' });
  return d;
};

describe('a new form', () => {
  it('starts with one section holding one Pass / Fail / N/A item, no extra signatures', () => {
    const d = emptyDraft();
    expect(d).toMatchObject({ title: '', description: '', clientSignature: 'NONE', supervisorSignature: 'NONE' });
    expect(d.sections).toHaveLength(1);
    expect(d.sections[0]!.items.map((i) => i.kind)).toEqual(['CHECK']);
    expect(d.sections[0]!.id).toBeUndefined();
  });
});

describe('validateDraft', () => {
  it('turns a good draft into what the server takes: trimmed, numbers for limits, nulls for empties, no ids for new parts', () => {
    const r = validateDraft(filled());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.input).toEqual({
      title: 'Rig daily check',
      description: 'Before the first shift.',
      clientSignature: 'OPTIONAL',
      supervisorSignature: 'NONE',
      sections: [
        {
          title: 'Well head',
          items: [
            { kind: 'CHECK', label: 'Valves closed', help: null },
            { kind: 'READING', label: 'Pressure', help: null, unit: 'psi', min: 0, max: 150.5 },
          ],
        },
      ],
    });
  });

  it('reads a comma decimal and a negative limit; an empty limit is none', () => {
    const d = filled();
    d.sections[0]!.items[1] = { ...d.sections[0]!.items[1]!, min: '-10,5', max: '' };
    const r = validateDraft(d);
    expect(r.ok && r.input.sections[0]!.items[1]).toMatchObject({ min: -10.5, max: null });
  });

  it('says what is wrong, field by field', () => {
    const d = filled();
    d.title = ' ';
    d.sections[0]!.title = '';
    d.sections[0]!.items[0]!.label = '';
    d.sections[0]!.items[1] = { ...d.sections[0]!.items[1]!, min: '200', max: '150' };
    const r = validateDraft(d);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    const item0 = d.sections[0]!.items[0]!.key;
    const item1 = d.sections[0]!.items[1]!.key;
    expect(r.problems).toEqual({
      title: 'Enter a title.',
      [`section:${d.sections[0]!.key}:title`]: 'Enter the section’s name.',
      [`item:${item0}:label`]: 'Enter the item.',
      [`item:${item1}:min`]: 'The lowest allowed reading must not be above the highest.',
    });
  });

  it('refuses limits that are not numbers, or have more than 6 decimals', () => {
    const d = filled();
    d.sections[0]!.items[1] = { ...d.sections[0]!.items[1]!, min: 'zero', max: '1.1234567' };
    const r = validateDraft(d);
    const key = d.sections[0]!.items[1]!.key;
    expect(!r.ok && r.problems).toMatchObject({ [`item:${key}:min`]: 'Enter a number, or leave it empty.', [`item:${key}:max`]: 'Enter a number, or leave it empty.' });
  });

  it('mirrors the server’s lengths', () => {
    const d = filled();
    d.title = 'x'.repeat(151);
    d.description = 'x'.repeat(2001);
    d.sections[0]!.items[1]!.unit = 'x'.repeat(21);
    d.sections[0]!.items[0]!.help = 'x'.repeat(501);
    const r = validateDraft(d);
    expect(!r.ok && Object.values(r.problems)).toEqual([
      'A title can have at most 150 characters.',
      'A description can have at most 2000 characters.',
      'A hint can have at most 500 characters.',
      'A unit can have at most 20 characters.',
    ]);
  });

  it('needs at least one item in every section, and at most 300 items in all', () => {
    const d = filled();
    d.sections.push({ ...addSection(d).sections.at(-1)!, title: 'Deck', items: [] });
    const r = validateDraft(d);
    expect(!r.ok && r.problems[`section:${d.sections[1]!.key}:items`]).toBe('Add at least one item to this section.');
    const big = filled();
    big.sections[0]!.items = Array.from({ length: 301 }, (_, i) => ({ ...newItem('CHECK'), label: `Item ${i}` }));
    const r2 = validateDraft(big);
    expect(!r2.ok && r2.problems.form).toBe('A form can have at most 300 items.');
  });

  it('keeps the ids of an existing form’s sections and items, so its inspections keep pointing at them', () => {
    const form: InspectionForm = {
      id: 'f1',
      title: 'Rig daily check',
      description: null,
      version: 3,
      sectionCount: 1,
      itemCount: 2,
      createdBy: null,
      updatedAt: '2026-10-27T08:00:00.000Z',
      canEdit: true,
      structure: {
        clientSignature: 'REQUIRED',
        supervisorSignature: 'OPTIONAL',
        sections: [
          {
            id: 's1',
            title: 'Well head',
            items: [
              { id: 'i1', kind: 'READING', label: 'Pressure', help: 'At the gauge', unit: 'psi', min: 0, max: 150 },
              { id: 'i2', kind: 'CHECK', label: 'Valves', help: null },
            ],
          },
        ],
      },
    };
    const d = draftFromForm(form);
    expect(d).toMatchObject({ title: 'Rig daily check', description: '', clientSignature: 'REQUIRED', supervisorSignature: 'OPTIONAL' });
    expect(d.sections[0]!.items[0]).toMatchObject({ id: 'i1', kind: 'READING', label: 'Pressure', help: 'At the gauge', unit: 'psi', min: '0', max: '150' });
    const next = addItem(d, d.sections[0]!.key, 'CHECK');
    next.sections[0]!.items[2]!.label = 'Lights';
    const r = validateDraft(next);
    expect(r.ok && r.input.sections).toEqual([
      {
        id: 's1',
        title: 'Well head',
        items: [
          { id: 'i1', kind: 'READING', label: 'Pressure', help: 'At the gauge', unit: 'psi', min: 0, max: 150 },
          { id: 'i2', kind: 'CHECK', label: 'Valves', help: null },
          { kind: 'CHECK', label: 'Lights', help: null },
        ],
      },
    ]);
  });
});

describe('editing helpers', () => {
  it('moves within bounds and leaves the list alone at the ends', () => {
    expect(move(['a', 'b', 'c'], 0, 1)).toEqual(['b', 'a', 'c']);
    expect(move(['a', 'b', 'c'], 2, 1)).toEqual(['a', 'b', 'c']);
    expect(move(['a', 'b', 'c'], 0, -1)).toEqual(['a', 'b', 'c']);
  });
  it('adds and removes items and sections without changing the draft it was given', () => {
    const d = emptyDraft();
    const two = addItem(d, d.sections[0]!.key, 'READING');
    expect(d.sections[0]!.items).toHaveLength(1);
    expect(two.sections[0]!.items.map((i) => i.kind)).toEqual(['CHECK', 'READING']);
    expect(removeItem(two, two.sections[0]!.items[0]!.key).sections[0]!.items.map((i) => i.kind)).toEqual(['READING']);
    const s2 = addSection(two);
    expect(s2.sections).toHaveLength(2);
    expect(removeSection(s2, s2.sections[0]!.key).sections).toHaveLength(1);
    expect(itemCount(s2)).toBe(3);
  });
  it('previews the limits as the inspector will read them', () => {
    expect(limitsPreview({ ...newItem('READING'), unit: 'psi', min: '0', max: '150' })).toBe('Allowed: 0–150 psi. A reading outside this fails.');
    expect(limitsPreview({ ...newItem('READING'), unit: '°C', min: '-10', max: '5' })).toBe('Allowed: -10 to 5 °C. A reading outside this fails.');
    expect(limitsPreview({ ...newItem('READING'), unit: 'bar', min: '', max: '' })).toBe('No limits: every reading is recorded as a pass.');
    expect(limitsPreview({ ...newItem('READING'), min: 'x', max: '' })).toBeNull();
  });
});
