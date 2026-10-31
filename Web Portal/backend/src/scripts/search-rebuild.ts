import 'dotenv/config';
import { prisma } from '../lib/prisma';
import { createTaskSearchIndex } from '../modules/search/task-search-index';

/**
 * Rebuild the task search index from scratch: every live task is read and indexed again (deleted
 * tasks' entries are dropped). Safe while the server runs — each task's entry is simply rewritten.
 * The server heals the index by itself at startup and in its sweeps; this is for after restoring a
 * database by hand, or to be sure.
 *
 *   npm run search:rebuild          (after `npm run build`)
 *   npx tsx src/scripts/search-rebuild.ts
 */
async function main(): Promise<void> {
  const started = Date.now();
  const indexed = await createTaskSearchIndex({ prisma, logger: { error: (message, meta) => console.error(message, meta) } }).rebuildAll();
  console.log(JSON.stringify({ indexed, seconds: Math.round((Date.now() - started) / 100) / 10 }));
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
