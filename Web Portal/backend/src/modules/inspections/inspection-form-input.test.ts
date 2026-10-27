import { describe, it, expect } from 'vitest';
import { ZodError } from 'zod';
import { parseFormInput, readStructure } from './inspection-form-input';

let n = 0;
const newId = () => `new${++n}`;

const body = (over: Record<string, unknown> = {}) => ({
  title: '  Rig daily check  ',
  description: 'Before the first shift.',
  clientSignature: 'OPTIONAL',
  supervisorSignature: 'NONE',
  sections: [
    {
      title: 'Well head',
      items: [
        { kind: 'READING', label: 'Pressure', unit: 'psi', min: 0, max: 150 },
        { kind: 'CHECK', label: 'Valves closed', help: 'All four.' },
      ],
    },
  ],
  ...over,
});

describe('parseFormInput', () => {
  it('trims, fills the defaults and gives every new section and item an id', () => {
    n = 0;
    const f = parseFormInput(body(), { newId });
    expect(f.title).toBe('Rig daily check');
    expect(f.description).toBe('Before the first shift.');
    expect(f.structure).toEqual({
      clientSignature: 'OPTIONAL',
      supervisorSignature: 'NONE',
      sections: [
        {
          id: 'new1',
          title: 'Well head',
          items: [
            { id: 'new2', kind: 'READING', label: 'Pressure', help: null, unit: 'psi', min: 0, max: 150 },
            { id: 'new3', kind: 'CHECK', label: 'Valves closed', help: 'All four.' },
          ],
        },
      ],
    });
  });

  it('keeps the ids of items it already has (an edit), and replaces unknown or repeated ones', () => {
    n = 0;
    const known = new Set(['s1', 'i1', 'i2']);
    const f = parseFormInput(
      body({
        sections: [
          { id: 's1', title: 'A', items: [{ id: 'i1', kind: 'CHECK', label: 'One' }, { id: 'i1', kind: 'CHECK', label: 'Copy' }, { id: 'hacked', kind: 'CHECK', label: 'X' }] },
        ],
      }),
      { newId, knownIds: known },
    );
    expect(f.structure.sections[0]!.id).toBe('s1');
    expect(f.structure.sections[0]!.items.map((i) => i.id)).toEqual(['i1', 'new1', 'new2']);
  });

  it('takes decimal limits and an empty unit; one limit is enough', () => {
    const f = parseFormInput(body({ sections: [{ title: 'A', items: [{ kind: 'READING', label: 'Gap', unit: '', min: 0.25 }] }] }), { newId });
    expect(f.structure.sections[0]!.items[0]).toMatchObject({ unit: null, min: 0.25, max: null });
  });

  it('refuses a minimum above the maximum, an empty form and over-long text', () => {
    expect(() => parseFormInput(body({ sections: [{ title: 'A', items: [{ kind: 'READING', label: 'P', min: 10, max: 5 }] }] }), { newId })).toThrow(ZodError);
    expect(() => parseFormInput(body({ sections: [] }), { newId })).toThrow(ZodError);
    expect(() => parseFormInput(body({ sections: [{ title: 'A', items: [] }] }), { newId })).toThrow(ZodError);
    expect(() => parseFormInput(body({ title: ' ' }), { newId })).toThrow(ZodError);
    expect(() => parseFormInput(body({ title: 'x'.repeat(151) }), { newId })).toThrow(ZodError);
    expect(() => parseFormInput(body({ sections: [{ title: 'A', items: [{ kind: 'CHECK', label: 'x'.repeat(201) }] }] }), { newId })).toThrow(ZodError);
    expect(() => parseFormInput(body({ sections: [{ title: 'A', items: [{ kind: 'READING', label: 'P', min: 1e13 }] }] }), { newId })).toThrow(ZodError);
    expect(() => parseFormInput(body({ clientSignature: 'ALWAYS' }), { newId })).toThrow(ZodError);
  });

  it('refuses more than 300 items in all', () => {
    const items = Array.from({ length: 151 }, (_, i) => ({ kind: 'CHECK', label: `Item ${i}` }));
    expect(() => parseFormInput(body({ sections: [{ title: 'A', items }, { title: 'B', items }] }), { newId })).toThrow(/300/);
    expect(() => parseFormInput(body({ sections: [{ title: 'A', items }, { title: 'B', items: items.slice(2) }] }), { newId })).not.toThrow();
  });
});

describe('readStructure: a stored structure read back defensively', () => {
  it('reads what was stored', () => {
    const f = parseFormInput(body(), { newId });
    expect(readStructure(JSON.parse(JSON.stringify(f.structure)))).toEqual(f.structure);
  });
  it('drops what it cannot read instead of failing', () => {
    expect(readStructure(null)).toEqual({ sections: [], clientSignature: 'NONE', supervisorSignature: 'NONE' });
    expect(readStructure({ sections: [{ id: 's', title: 'T', items: [{ id: 'x', kind: 'WEIRD', label: 'L' }, { id: 'y', kind: 'CHECK', label: 'Ok' }] }], clientSignature: 'REQUIRED' })).toEqual({
      sections: [{ id: 's', title: 'T', items: [{ id: 'y', kind: 'CHECK', label: 'Ok', help: null }] }],
      clientSignature: 'REQUIRED',
      supervisorSignature: 'NONE',
    });
  });
});
