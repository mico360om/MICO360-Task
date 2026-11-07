import { describe, it, expect } from 'vitest';
import { checklistTreeSchema } from './checklist-tree-schema';

describe('checklistTreeSchema (the New task form, templates)', () => {
  it('takes titles and nesting, trimmed; a blank title becomes "Checklist"', () => {
    const tree = checklistTreeSchema.parse([{ title: ' Electrical ', items: [{ text: ' Panel ', children: [{ text: 'Label' }] }] }, { title: '', items: [] }]);
    expect(tree).toEqual([
      { title: 'Electrical', items: [{ text: 'Panel', children: [{ text: 'Label' }] }] },
      { title: 'Checklist', items: [] },
    ]);
  });
  it('refuses blank or overlong items and anything past the limits', () => {
    expect(checklistTreeSchema.safeParse([{ title: 'A', items: [{ text: '  ' }] }]).success).toBe(false);
    expect(checklistTreeSchema.safeParse([{ title: 'A', items: [{ text: 'x'.repeat(192) }] }]).success).toBe(false);
    const many = [{ title: 'A', items: Array.from({ length: 501 }, (_, i) => ({ text: `i${i}` })) }];
    expect(checklistTreeSchema.safeParse(many).error?.issues[0]?.message).toMatch(/500/);
  });
  it('refuses a tree deeper than 20 levels — even a very deep one, without falling over', () => {
    const nest = (n: number) => {
      let node: { text: string; children?: unknown[] } = { text: 'leaf' };
      for (let i = 0; i < n; i++) node = { text: `l${i}`, children: [node] };
      return [{ title: 'Deep', items: [node] }];
    };
    expect(checklistTreeSchema.safeParse(nest(19)).success).toBe(true);
    expect(checklistTreeSchema.safeParse(nest(20)).error?.issues[0]?.message).toMatch(/20 levels/);
    expect(checklistTreeSchema.safeParse(nest(50_000)).success).toBe(false);
  });
});
