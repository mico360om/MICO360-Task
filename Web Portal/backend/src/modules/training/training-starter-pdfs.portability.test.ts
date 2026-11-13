import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// The live database writes a statement-based binary log, so this step must not send any isolation
// statement (see merge-service and lib/sql-portability): its transaction runs at the server's own level.
describe('starter PDF removal on the live database', () => {
  it('sends no isolation-level statement', () => {
    const source = readFileSync(join(__dirname, 'training-starter-pdfs.ts'), 'utf8');
    expect(source).not.toMatch(/isolationLevel/);
  });
});
