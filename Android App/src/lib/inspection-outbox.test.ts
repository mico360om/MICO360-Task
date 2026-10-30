import { afterEach, describe, it, expect, vi } from 'vitest';
import { appSource as src, hasWeb, normalise, readWeb } from '../testing/web-source';
import { DETAIL, SIG_DRAWN, fakeInspectionServer } from '../testing/inspection-fixtures';
import { ApiError, NetworkError, sessionChangedError } from './api-client';
import { createInspectionOutbox, memoryDraftStorage } from './inspection-outbox';

/** The website's inspection outbox, copied into the app with three edits (Stage 4 Task 3). */

const CHANGED = 'the website changed this part of the outbox: update the copy and this test';

/** Where `find` is in `text`; it must be there exactly once. */
function once(text: string, find: string, from = 0): number {
  const at = text.indexOf(find, from);
  if (at < 0 || text.indexOf(find, at + 1) >= 0) throw new Error(`${CHANGED} (${JSON.stringify(find.slice(0, 40))})`);
  return at;
}

/**
 * The app's outbox made from the website's: (1) the types come from './inspection-types' and the
 * finish ids from './idempotency'; (2) no localStorage storage (the app's is draft-storage.ts);
 * (3) the default id without crypto.randomUUID (Hermes has none).
 */
function appOutboxFromWeb(web: string): string {
  const types = "from '../api/inspections';";
  once(web, types);
  let out = web.replace(types, "from './inspection-types';\nimport { newIdempotencyKey } from './idempotency';");

  const storageStart = once(out, 'export const localDraftStorage: DraftStorage = {');
  const storageEnd = once(out, '\n};\n\n/**\n * Removes every inspection record', storageStart);
  out = out.slice(0, storageStart) + out.slice(storageEnd + '\n};\n\n'.length);

  const idStart = once(out, '  const newId =\n');
  const idEnd = out.indexOf('    });\n', idStart);
  if (idEnd < 0 || !out.slice(idStart, idEnd).includes('crypto.randomUUID()')) throw new Error(CHANGED);
  return out.slice(0, idStart) + '  const newId = deps.newId ?? (() => newIdempotencyKey());\n' + out.slice(idEnd + '    });\n'.length);
}

describe.skipIf(!hasWeb('frontend/src/lib/inspection-outbox.ts'))('a copy of the website’s outbox', () => {
  it('is the website’s file with only the three app edits', () =>
    expect(normalise(src('lib/inspection-outbox.ts'))).toBe(appOutboxFromWeb(normalise(readWeb('frontend/src/lib/inspection-outbox.ts')))));
});

it('reads the app’s errors as the website reads its own', async () => {
  const cases = [
    [new NetworkError('Network request failed.'), 'offline'],
    [new NetworkError('The server took too long to respond.', { timedOut: true }), 'offline'],
    [sessionChangedError(), 'signed-out'],
    [new ApiError(503, 'UNAVAILABLE', 'Down'), 'unreachable'],
    [new ApiError(500, 'INTERNAL', 'Oops'), 'retry'],
    [new ApiError(409, 'INSPECTION_FINISHED', 'Finished'), 'problem'],
  ] as const;
  for (const [error, state] of cases) {
    const o = createInspectionOutbox({
      storage: memoryDraftStorage(),
      api: {
        answer: async () => {
          throw error;
        },
        finish: vi.fn(),
        makeFollowUps: vi.fn(),
      },
    });
    o.remember('u1', DETAIL);
    o.saveAnswer('u1', 'i1', { itemId: 'a', result: 'PASS', reading: null, note: null });
    expect((await o.flush('u1', 'i1')).state, error.message).toBe(state);
    expect(o.view('u1', 'i1')!.pending.answers).toBe(1); // nothing is lost, whatever the reason
  }
});

describe('on Hermes (no crypto)', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('mints finish ids as version-4 ids', () => {
    vi.stubGlobal('crypto', undefined);
    const o = createInspectionOutbox({ storage: memoryDraftStorage(), api: fakeInspectionServer().api });
    o.remember('u1', DETAIL);
    o.queueFinish('u1', 'i1', [SIG_DRAWN]);
    expect(o.draft('u1', 'i1')!.finish!.finishId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
