import 'dotenv/config';
import { prisma } from '../lib/prisma';
import { createTaskSearchIndex } from '../modules/search/task-search-index';
import { createSearchIndex } from '../modules/search/search-index';
import { createVocabulary } from '../modules/search/search-fuzzy';
import { createPrismaSearchWords } from '../modules/search/prisma-search-words';

/**
 * Rebuild the search indexes from scratch: every live task (task_search_index) and — 1.23 — every
 * project, meeting, meeting note, final minutes, task file and inspection (search_index) is read and
 * indexed again (gone items' entries are dropped), with their words for the spelling-mistake pass.
 * Safe while the server runs — each entry is simply rewritten. The server heals the indexes by itself
 * at startup and in its sweeps; this is for after restoring a database by hand, or to be sure. The
 * text inside files is read by the server in the background (it isn't read again here).
 *
 *   npm run search:rebuild          (after `npm run build`)
 *   npx tsx src/scripts/search-rebuild.ts
 */
async function main(): Promise<void> {
  const started = Date.now();
  const logger = { error: (message: string, meta?: Record<string, unknown>) => console.error(message, meta) };
  const words = createPrismaSearchWords(prisma);
  const vocabulary = createVocabulary({ load: words.load, store: words.store });
  const indexed = await createTaskSearchIndex({ prisma, logger, words: vocabulary }).rebuildAll();
  const items = await createSearchIndex({ prisma, logger, words: vocabulary }).rebuildAll();
  console.log(JSON.stringify({ indexed, items, seconds: Math.round((Date.now() - started) / 100) / 10 }));
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
