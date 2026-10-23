import { describe, it, expect } from 'vitest';
import { highestKeyNumberIn } from './task-keys';

describe('The highest number among task keys', () => {
  it('compares numbers, not text: RIG-10 is after RIG-9', () => {
    expect(highestKeyNumberIn(['RIG-9', 'RIG-10', 'RIG-2'])).toBe(10);
    expect(highestKeyNumberIn(['RIG-100', 'RIG-99'])).toBe(100);
  });

  it('reads the number after the last dash, whatever the code', () => {
    expect(highestKeyNumberIn(['OLD-CODE-12', 'NEW-3'])).toBe(12);
  });

  it('is 0 for none, and ignores keys without a number', () => {
    expect(highestKeyNumberIn([])).toBe(0);
    expect(highestKeyNumberIn(['RIG', 'RIG-x', 'RIG-'])).toBe(0);
  });
});
