import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { zodMessages } from './zod-messages';

/**
 * The API's words for a failed check are zod 3's (see zod-messages.ts and the 400 pins in
 * validation-errors.test.ts). The server must load them itself — the tests load them by their
 * setup file, so this checks the server's own entry points do too.
 */
describe('zod messages', () => {
  it('the server loads them: app.ts and config/env.ts import the module', () => {
    for (const file of ['../app.ts', '../config/env.ts']) {
      const src = fs.readFileSync(path.join(__dirname, file), 'utf8');
      expect(src, file).toMatch(/^import '\.{1,2}\/(lib\/)?zod-messages';$/m);
    }
  });

  it('are what zod uses for a check without words of its own', () => {
    expect(z.object({ a: z.string() }).safeParse({}).error!.issues[0]!.message).toBe('Required');
    expect(z.string().min(2, 'Two at least.').safeParse('a').error!.issues[0]!.message).toBe('Two at least.');
  });

  it('an error made by hand for the API is a real Error (it keeps its stack for the logs)', async () => {
    const { badCursor } = await import('../modules/search/search-routes');
    const err = badCursor();
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(z.ZodError);
    expect(err.issues).toEqual([{ code: 'custom', path: ['cursor'], message: 'Invalid cursor.' }]);
  });

  it('a problem zod 3 had no words for keeps zod’s own', () => {
    expect(zodMessages({ code: 'invalid_element', origin: 'set', key: 1, issues: [], input: new Set() } as never)).toBeUndefined();
  });
});
