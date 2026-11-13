import { describe, it, expect, vi } from 'vitest';
import { removeStoredFile, storedKeyOf } from './stored-files';

describe('removeStoredFile (review fix #23: a stored file goes after its record, and a failure is never silent)', () => {
  it('removes the file', async () => {
    const remove = vi.fn(async () => undefined);
    expect(await removeStoredFile({ remove }, 'a.pdf', { pauseMs: 0 })).toBe(true);
    expect(remove).toHaveBeenCalledWith('a.pdf');
  });

  it('tries again when the disk refuses for a moment (a file still open elsewhere)', async () => {
    let n = 0;
    const remove = vi.fn(async () => {
      if (++n < 3) throw Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY' });
    });
    const warn = vi.fn();
    expect(await removeStoredFile({ remove }, 'b.pdf', { pauseMs: 0, logger: { warn } })).toBe(true);
    expect(remove).toHaveBeenCalledTimes(3);
    expect(warn).not.toHaveBeenCalled();
  });

  it('a file that can’t be deleted is logged with its key and what it was — never thrown', async () => {
    const remove = vi.fn(async () => {
      throw new Error('EPERM: operation not permitted');
    });
    const warn = vi.fn();
    expect(await removeStoredFile({ remove }, 'c.pdf', { pauseMs: 0, logger: { warn }, what: 'a deleted chat message’s file' })).toBe(false);
    expect(remove).toHaveBeenCalledTimes(3);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toMatch(/could not be deleted/i);
    expect(warn.mock.calls[0]![1]).toMatchObject({ storageKey: 'c.pdf', what: 'a deleted chat message’s file' });
  });

  it('without a logger it still never throws', async () => {
    const remove = vi.fn(async () => {
      throw new Error('gone wrong');
    });
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await expect(removeStoredFile({ remove }, 'd.pdf', { pauseMs: 0 })).resolves.toBe(false);
    spy.mockRestore();
  });
});

describe('storedKeyOf', () => {
  it('is the key of one of our /uploads addresses, else null', () => {
    expect(storedKeyOf('/uploads/0f8fad5b-d9cb-469f-a165-70867728950e.png')).toBe('0f8fad5b-d9cb-469f-a165-70867728950e.png');
    expect(storedKeyOf(null)).toBeNull();
    expect(storedKeyOf('https://elsewhere.example/x.png')).toBeNull();
    expect(storedKeyOf('/uploads/')).toBeNull();
    expect(storedKeyOf('/uploads/../secret')).toBeNull();
    expect(storedKeyOf('/uploads/faces/a.png.webp')).toBeNull();
  });
});
