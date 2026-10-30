import { describe, it, expect } from 'vitest';
import { createRepeatGuard } from './repeat-requests';

const MIN = 60_000;

describe('createRepeatGuard', () => {
  it('lets a key through up to the per-minute limit, then says how many seconds are left (counted from the first)', () => {
    const wait = createRepeatGuard(1);
    expect(wait('ada', 0)).toBeNull();
    expect(wait('ada', 18_000)).toBe(42);
    expect(wait('ada', 59_500)).toBe(1); // never "0 s"
    expect(wait('ada', MIN)).toBeNull(); // a minute on: through again
  });

  it('a turned-away request does not move the wait on', () => {
    const wait = createRepeatGuard(1);
    wait('ada', 0);
    wait('ada', 30_000);
    expect(wait('ada', 40_000)).toBe(20);
  });

  it('keeps each key apart, and allows more than one a minute when the limit says so', () => {
    const wait = createRepeatGuard(2);
    expect(wait('ada', 0)).toBeNull();
    expect(wait('bob', 1_000)).toBeNull();
    expect(wait('ada', 2_000)).toBeNull();
    expect(wait('ada', 3_000)).toBe(57);
    expect(wait('bob', 3_000)).toBeNull();
  });

  it('forgets keys a minute old, so the memory stays small', () => {
    const wait = createRepeatGuard(1);
    for (let i = 0; i < 1000; i++) wait(`k${i}`, i);
    expect(wait.size()).toBe(1000);
    wait('later', 2 * MIN);
    expect(wait.size()).toBe(1);
  });
});
