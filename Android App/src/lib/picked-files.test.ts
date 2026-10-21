import { describe, it, expect, vi } from 'vitest';
import { createPickedFiles, isPickedCopy } from './picked-files';

const CACHE = 'file:///data/user/0/com.mico360.tasks/cache/';

describe('the picker’s copies of picked files (3b review fix 7)', () => {
  it('knows its own copies — in the app cache’s DocumentPicker folder — and nothing else', () => {
    expect(isPickedCopy(`${CACHE}DocumentPicker/1b2c.jpg`, CACHE)).toBe(true);
    expect(isPickedCopy(`${CACHE}DocumentPicker/a/../../exports/report.pdf`, CACHE)).toBe(false);
    expect(isPickedCopy(`${CACHE}exports/report.pdf`, CACHE)).toBe(false);
    expect(isPickedCopy('content://com.android.providers.media.documents/document/image%3A12', CACHE)).toBe(false);
    expect(isPickedCopy('file:///storage/emulated/0/DCIM/photo.jpg', CACHE)).toBe(false);
    expect(isPickedCopy(`${CACHE}DocumentPicker/x.jpg`, null)).toBe(false);
  });

  it('forgets a copy once it is sent or discarded — never the person’s own file — and a failure to delete is quiet', async () => {
    const deleteAsync = vi.fn(async () => {});
    const files = createPickedFiles({ deleteAsync }, CACHE);
    await files.forget(`${CACHE}DocumentPicker/1b2c.jpg`);
    await files.forget('content://media/external/images/12');
    await files.forget(undefined);
    expect(deleteAsync).toHaveBeenCalledTimes(1);
    expect(deleteAsync).toHaveBeenCalledWith(`${CACHE}DocumentPicker/1b2c.jpg`, { idempotent: true });
    const broken = createPickedFiles({ deleteAsync: vi.fn(async () => Promise.reject(new Error('busy'))) }, CACHE);
    await expect(broken.forget(`${CACHE}DocumentPicker/1b2c.jpg`)).resolves.toBeUndefined();
  });

  it('at sign-out every copy goes (the whole folder)', async () => {
    const deleteAsync = vi.fn(async () => {});
    await createPickedFiles({ deleteAsync }, CACHE).clearAll();
    expect(deleteAsync).toHaveBeenCalledWith(`${CACHE}DocumentPicker/`, { idempotent: true });
    const none = vi.fn(async () => {});
    await createPickedFiles({ deleteAsync: none }, null).clearAll();
    expect(none).not.toHaveBeenCalled();
  });
});
