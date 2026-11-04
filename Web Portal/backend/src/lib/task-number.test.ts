import { describe, it, expect } from 'vitest';
import { matchedTaskNumber, matchesTaskNumber, pickByTaskNumber, readTaskNumber, taskNumberKeys } from './task-number';

describe('readTaskNumber: a task number however it is typed', () => {
  it('reads MICO-142, mico-142, MICO142, mico 142, MICO_142 and #MICO-142 as the same number', () => {
    for (const q of ['MICO-142', 'mico-142', 'Mico-142', 'mico 142', 'MICO_142', 'mico_142', '#MICO-142', '# mico-142', '  MICO-142  ', 'MICO - 142', 'MICO   142', '#mico 142']) {
      expect(readTaskNumber(q), q).toEqual({ keys: ['MICO-142'], number: null });
    }
    // Run together: MICO-142 first, then the codes that end in digits (MICO1-42, MICO14-2).
    expect(readTaskNumber('MICO142')).toEqual({ keys: ['MICO-142', 'MICO1-42', 'MICO14-2'], number: null });
    expect(readTaskNumber('mico142')?.keys[0]).toBe('MICO-142');
  });

  it('a run-together number tries every split, for codes that end in digits', () => {
    expect(taskNumberKeys('HR214')).toEqual(['HR-214', 'HR2-14', 'HR21-4']);
    expect(taskNumberKeys('#hr214')).toEqual(['HR-214', 'HR2-14', 'HR21-4']);
    // A number never starts with 0: HR2-014 is not a split of HR2014.
    expect(taskNumberKeys('HR2014')).toEqual(['HR-2014', 'HR20-14', 'HR201-4']);
    // A code is 2–10 characters: "H" is too short to be one.
    expect(taskNumberKeys('H5')).toEqual([]);
    expect(taskNumberKeys('AB5')).toEqual(['AB-5']);
  });

  it('accepts the dashes phones and word processors type, and full-width characters', () => {
    for (const q of ['MICO–142', 'MICO—142', 'MICO‑142', 'MICO−142', 'ＭＩＣＯ－１４２', '＃MICO-142']) expect(taskNumberKeys(q), q).toEqual(['MICO-142']);
  });

  it('a code written with a separator is read as written (its digits stay in the code)', () => {
    expect(taskNumberKeys('MICO2-14')).toEqual(['MICO2-14']);
    expect(taskNumberKeys('mico2 14')).toEqual(['MICO2-14']);
    expect(taskNumberKeys('rig 3')).toEqual(['RIG-3']);
    // Leading zeros of a number written apart are dropped.
    expect(taskNumberKeys('MICO-0142')).toEqual(['MICO-142']);
  });

  it('a bare number ("142", "#142") is any task numbered …-142', () => {
    expect(readTaskNumber('142')).toEqual({ keys: [], number: '142' });
    expect(readTaskNumber(' #142 ')).toEqual({ keys: [], number: '142' });
    expect(readTaskNumber('0142')).toEqual({ keys: [], number: '142' });
    expect(taskNumberKeys('142')).toEqual([]);
  });

  it('anything else is not a number: normal search is unchanged', () => {
    for (const q of ['', '   ', '#', '0', 'MICO-0', 'MICO', 'MICO-', '-142', 'scaffold', 'scaffold permit', 'al-hassan', 'policy_2026x', 'f_n', '50%', 'MICO-142 scaffold', 'check 142 valves', 'A-1', 'TOOLONGCODE1-5', 'MICO-1234567890', '1234567890', 'إدارة 12', 'é-12', 'MICO-14.2', 'MICO--142', null, undefined]) {
      expect(readTaskNumber(q as string), String(q)).toBeNull();
    }
  });
});

describe('matching a task by its number', () => {
  it('matches the current number or an old one, whatever the form', () => {
    expect(matchesTaskNumber('mico142', 'MICO-142')).toBe(true);
    expect(matchesTaskNumber('mico 142', 'MICO-142')).toBe(true);
    expect(matchesTaskNumber('MICO_142', 'MICO-142')).toBe(true);
    expect(matchesTaskNumber('rig 4', 'OPS-17', ['RIG-4'])).toBe(true);
    expect(matchedTaskNumber('rig4', 'OPS-17', ['RIG-4'])).toBe('RIG-4');
    expect(matchedTaskNumber('ops17', 'OPS-17', ['RIG-4'])).toBe('OPS-17');
    expect(matchesTaskNumber('MICO-14', 'MICO-142')).toBe(false); // exactly that number, never a longer one
    expect(matchesTaskNumber('mico142', 'MICO-1420')).toBe(false);
    expect(matchesTaskNumber('scaffold', 'MICO-142')).toBe(false);
  });

  it('a bare number matches the tasks numbered …-N exactly (current or old)', () => {
    expect(matchesTaskNumber('142', 'MICO-142')).toBe(true);
    expect(matchesTaskNumber('142', 'HR2-142')).toBe(true);
    expect(matchesTaskNumber('#142', 'OPS-9', ['RIG-142'])).toBe(true);
    expect(matchedTaskNumber('142', 'OPS-9', ['RIG-142'])).toBe('RIG-142');
    expect(matchesTaskNumber('142', 'MICO-1142')).toBe(false);
    expect(matchesTaskNumber('142', 'MICO-1420')).toBe(false);
    expect(matchesTaskNumber('42', 'MICO-142')).toBe(false);
  });

  it('pickByTaskNumber: the task with that number now, else the one that had it before it moved', () => {
    const tasks = [
      { id: 'a', key: 'MICO-1420', formerKeys: [] },
      { id: 'b', key: 'OPS-17', formerKeys: ['MICO-142'] },
      { id: 'c', key: 'HR2-14' },
      { id: 'd', key: 'HR-214' },
    ];
    expect(pickByTaskNumber(tasks, ['MICO-142'])?.id).toBe('b');
    expect(pickByTaskNumber(tasks, ['OPS-17'])?.id).toBe('b');
    // Several candidates: the first that is a task's number now, in the order given.
    expect(pickByTaskNumber(tasks, taskNumberKeys('hr214'))?.id).toBe('d');
    expect(pickByTaskNumber(tasks, ['HR2-14', 'HR-214'])?.id).toBe('c');
    expect(pickByTaskNumber(tasks, ['mico-142'])?.id).toBe('b'); // any case
    expect(pickByTaskNumber(tasks, ['MICO-14'])).toBeNull();
    expect(pickByTaskNumber(tasks, [])).toBeNull();
  });
});
