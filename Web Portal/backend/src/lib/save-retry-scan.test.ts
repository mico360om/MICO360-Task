import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * 1.23.29 — the server's client tries a save conflict again (lib/save-retry). Two kinds of code stay out of it,
 * each by the named opt-out `withoutSaveRetry`:
 * - code with its OWN retry loop for save conflicts: its tries stay its own (never 4 × 3);
 * - a transaction whose work does something a re-run would repeat (files, a stream read once, statements
 *   that commit on their own).
 * This scan keeps both honest: every own retry loop opts out, and the list of opt-outs is exactly this one —
 * a new one is a decision, made here with its reason.
 */
const SRC = join(__dirname, '..');
const OPTED_OUT: Record<string, string> = {
  'lib/sentinel-lock.ts': 'own loop: withRowLock / withSentinelLock, 4 tries',
  'modules/chat/prisma-chat-repository.ts': 'own loop: retried(), 4 tries (and an upsert’s lost insert race)',
  'modules/task-merge/merge-service.ts': 'own loops: merge and undo, 5 tries (and task-number clashes)',
  'modules/training/training-starter.ts': 'own loop: a starter course, 3 tries (its files are copied again per try)',
  'modules/training/training-starter-pdfs.ts': 'own loop: the old how-to PDFs, 3 tries (and P2028 / lock wait)',
  'modules/notify-policy/policy-service.ts': 'own loop: a company’s first notification set-up, 3 tries (and unique clashes)',
  'modules/backups/sql-runner.ts': 'effects: a backup writes its table files during the transaction; a restore reads its upload stream once and DROP TABLE commits on its own',
};

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.ts$/.test(name) && !/\.test\.ts$|\.d\.ts$/.test(name) ? [path] : [];
  });
}
/** The code without its comments (comments may name the errors). */
const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

describe('the save retry layer’s opt-outs (1.23.29)', () => {
  const files = sourceFiles(SRC)
    .map((path) => ({ rel: relative(SRC, path).replace(/\\/g, '/'), text: code(readFileSync(path, 'utf8')) }))
    .filter((f) => f.rel !== 'lib/save-retry.ts');

  it('every own retry loop for save conflicts runs its tries outside the layer', () => {
    const ownLoops = files.filter((f) => /isRetryableTxError\(|['"]P2034['"]/.test(f.text)).map((f) => f.rel);
    expect(ownLoops.length).toBeGreaterThan(0);
    expect(ownLoops.filter((rel) => !files.find((f) => f.rel === rel)!.text.includes('withoutSaveRetry('))).toEqual([]);
  });

  it('the opt-outs are exactly the listed ones, each with its reason', () => {
    expect(files.filter((f) => f.text.includes('withoutSaveRetry(')).map((f) => f.rel).sort()).toEqual(Object.keys(OPTED_OUT).sort());
  });

  it('no transaction anywhere sets an isolation level other than the server’s own (REPEATABLE READ)', () => {
    // READ COMMITTED writes are refused by the live binary log (error 1665).
    expect(files.filter((f) => /isolationLevel\s*:(?!\s*Prisma\.TransactionIsolationLevel\.RepeatableRead\b)/.test(f.text)).map((f) => f.rel)).toEqual([]);
  });
});
