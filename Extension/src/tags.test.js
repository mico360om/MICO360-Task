import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { MAX_TAGS, normalizeTagName, normalizeTagNames, withTag, withoutTag, tagRecords, tagChoices, mergeTagChange } from './tags.js';

describe('task tags — the server’s rules, said before sending', () => {
  it('tidies a name as the server does: trimmed, single spaces, at most 40 characters', () => {
    expect(normalizeTagName('  site   visit ')).toBe('site visit');
    expect(normalizeTagName('x'.repeat(50))).toHaveLength(40);
  });

  it('adds a tag once (any case), refuses a blank one and an eleventh', () => {
    expect(withTag(['Urgent'], ' client ')).toEqual({ names: ['Urgent', 'client'] });
    expect(withTag(['Urgent'], 'URGENT')).toEqual({ names: ['Urgent'], already: 'Urgent' });
    expect(withTag(['Urgent'], '   ')).toEqual({ names: ['Urgent'], error: 'Type a tag name first.' });
    const ten = Array.from({ length: MAX_TAGS }, (_, i) => `t${i}`);
    expect(withTag(ten, 'more')).toEqual({ names: ten, error: 'A task can have at most 10 tags.' });
  });

  it('takes a tag off by its name, whatever its case', () => {
    expect(withoutTag(['Urgent', 'client'], 'CLIENT')).toEqual(['Urgent']);
  });

  it('shows a tag saved on this device with the colour it already has, or none yet', () => {
    const known = [{ id: 'g1', name: 'Urgent', color: '#8B1E1E' }];
    expect(tagRecords(['urgent', 'New one'], known)).toEqual([
      { id: 'g1', name: 'Urgent', color: '#8B1E1E' },
      { id: 'tmp-tag:new one', name: 'New one', color: null },
    ]);
  });

  it('a change made from an older list keeps what someone else changed meanwhile', () => {
    // Urgent taken off [Urgent, Client] on this device; someone else added Audit meanwhile.
    expect(mergeTagChange(['Audit', 'Client', 'Urgent'], ['Urgent', 'Client'], ['Client'])).toEqual(['Audit', 'Client']);
    // Site added here; someone else took Client off meanwhile: it stays off.
    expect(mergeTagChange(['Urgent'], ['Urgent', 'Client'], ['Urgent', 'Client', 'Site'])).toEqual(['Urgent', 'Site']);
    // Nothing changed here: the task's tags as they are.
    expect(mergeTagChange(['A', 'B'], ['A'], ['A'])).toEqual(['A', 'B']);
  });

  it('compares names as the server does (tidied, any case) and lists none twice', () => {
    expect(mergeTagChange(['Urgent', 'Client visit'], ['URGENT'], [])).toEqual(['Client visit']);
    expect(mergeTagChange(['Client visit'], [], ['  client   VISIT '])).toEqual(['Client visit']);
    expect(mergeTagChange([], [], ['New', 'new'])).toEqual(['New']);
  });

  it('suggests the workspace’s tags the task doesn’t have yet', () => {
    const catalog = [{ id: 'a', name: 'Urgent' }, { id: 'b', name: 'Client' }, { id: 'c', name: 'Audit' }];
    expect(tagChoices(catalog, ['client'])).toEqual(['Audit', 'Urgent']);
    expect(tagChoices(null, [])).toEqual([]);
  });
});

// The server owns the rules (Web Portal/backend/src/modules/tasks/tag-service.ts). Both run over the
// same names and this fails when they drift (skipped where the server isn't checked out).
const repo = resolve(__dirname, '../..');
const SERVER = resolve(repo, 'Web Portal/backend/src/modules/tasks/tag-service.ts');
const server = existsSync(SERVER) ? await import(pathToFileURL(SERVER).href) : null;

describe.skipIf(!server)('tag names: src/tags.js matches the server (tag-service.ts)', () => {
  const outcome = (fn, names) => {
    try {
      return { names: fn(names) };
    } catch (e) {
      return { error: e.message };
    }
  };
  it('cleans the same lists the same way, and refuses the same ones with the same words', () => {
    const LISTS = [
      [], ['a'], [' a ', 'A', 'b'], ['  site   visit ', 'Site Visit'], ['x'.repeat(60)], ['x'.repeat(45), `${'x'.repeat(40)}yz`], [''], ['ok', '   '],
      Array.from({ length: 10 }, (_, i) => `t${i}`), Array.from({ length: 11 }, (_, i) => `t${i}`), [...Array.from({ length: 10 }, (_, i) => `t${i}`), 'T1'],
      ['\tTabbed\nname'], ['عاجل', 'عاجل '], ['Ünïcode', 'ünïcode'],
    ];
    for (const list of LISTS) expect(outcome(normalizeTagNames, list), JSON.stringify(list)).toEqual(outcome(server.normalizeTagNames, list));
  });
});
