import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The first company. The backfill migration creates it when the site has no company yet (an upgrade
 * from 1.20 or a fresh install) and puts every person and project there in it. The owner can rename
 * it, and change its code, on the Companies page; the id never changes.
 */
export const DEFAULT_COMPANY = { id: 'company_prolens', name: 'Prolens Projects LLC', code: 'PPL' } as const;

/** The backfill migration's folder (data only; safe to run again). */
export const BACKFILL_MIGRATION = '20261031200100_multi_company_backfill';

/** The backfill migration file, from the source tree (src/…) or the build (dist/src/…). */
export const BACKFILL_SQL_PATH: string = (() => {
  const file = ['prisma', 'migrations', BACKFILL_MIGRATION, 'migration.sql'];
  const candidates = [resolve(__dirname, '..', '..', '..', ...file), resolve(__dirname, '..', '..', '..', '..', ...file)];
  return candidates.find((p) => existsSync(p)) ?? candidates[0]!;
})();
