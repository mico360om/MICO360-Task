import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PORTAL, appPath, appSource, appSources, hasWeb, loadWebTs, readWeb, sha256, webPath } from './web-source';

describe('the app’s own files', () => {
  it('appPath is under Android App, appSource reads a file under src (and ../ reaches the app folder)', () => {
    expect(appPath('package.json')).toBe(resolve(__dirname, '../../package.json'));
    expect(appSource('lib/theme.ts')).toContain('export const lightColors');
    expect(appSource('../App.tsx')).toContain('export default');
  });

  it('appSources lists every .ts/.tsx under src by its path from src, without tests or src/testing', () => {
    const files = appSources().map(([f]) => f);
    expect(files).toContain('lib/theme.ts');
    expect(files.some((f) => f.endsWith('.tsx'))).toBe(true);
    expect(files.filter((f) => f.endsWith('.test.ts') || f.startsWith('testing/') || f.includes('\\'))).toEqual([]);
    const [, text] = appSources().find(([f]) => f === 'lib/theme.ts')!;
    expect(text).toBe(appSource('lib/theme.ts'));
  });

  it('sha256 is the hex digest of the file’s bytes', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'web-source-')), 'abc.txt');
    writeFileSync(file, 'abc');
    expect(sha256(file)).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('the website next to the app', () => {
  it('PORTAL is the Web Portal folder beside Android App; webPath resolves under it', () => {
    expect(PORTAL).toBe(resolve(__dirname, '../../../Web Portal'));
    expect(webPath('frontend/src/index.css')).toBe(resolve(PORTAL, 'frontend/src/index.css'));
  });

  it('hasWeb is false when any one of the files is missing', () => {
    expect(hasWeb('frontend/no-such-file.ts')).toBe(false);
    expect(hasWeb('frontend/src/index.css', 'frontend/no-such-file.ts')).toBe(false);
  });

  describe.skipIf(!hasWeb('frontend/src/index.css', 'backend/src/modules/tasks/task-status.ts', 'backend/src/lib/due-date.ts'))('with the website present', () => {
    it('hasWeb and readWeb see its files', () => {
      expect(hasWeb('frontend/src/index.css')).toBe(true);
      expect(readWeb('frontend/src/index.css')).toContain('--c-brand:');
    });

    it('loadWebTs runs a website module; only the imports it is given are loaded, any other is empty', () => {
      const now = new Date('2026-10-31T08:00:00Z');
      const late = { dueDate: '2026-10-01' };
      const due = loadWebTs('backend/src/lib/due-date.ts') as { shiftDayKey: (k: string, d: number) => string };
      expect(due.shiftDayKey('2026-10-30', 1)).toBe('2026-10-31');
      const alone = loadWebTs('backend/src/modules/tasks/task-status.ts') as { isTaskLate: (t: object, tz: string, now: Date) => boolean };
      expect(() => alone.isTaskLate(late, 'Asia/Muscat', now)).toThrow(TypeError);
      const mapped = loadWebTs('backend/src/modules/tasks/task-status.ts', { '../../lib/due-date': 'backend/src/lib/due-date.ts' }) as typeof alone;
      expect(mapped.isTaskLate(late, 'Asia/Muscat', now)).toBe(true);
    });
  });
});
