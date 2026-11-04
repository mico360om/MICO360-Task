import { Prisma, type PrismaClient } from '@prisma/client';

/** The vocabulary of the spelling-mistake pass in search_words (1.23): read whole, added to as items are indexed. */
export function createPrismaSearchWords(prisma: PrismaClient, { maxWords = 300_000 }: { maxWords?: number } = {}) {
  return {
    async load(): Promise<string[]> {
      return (await prisma.$queryRaw<{ word: string }[]>`SELECT word FROM search_words LIMIT ${maxWords}`).map((r) => r.word);
    },
    async store(words: string[]): Promise<void> {
      const fit = words.filter((w) => w.length > 0 && w.length <= 64);
      for (let i = 0; i < fit.length; i += 500) {
        await prisma.$executeRaw`INSERT IGNORE INTO search_words (word) VALUES ${Prisma.join(fit.slice(i, i + 500).map((w) => Prisma.sql`(${w})`))}`;
      }
    },
  };
}
