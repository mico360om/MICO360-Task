import type { Query } from '@tanstack/react-query';

/**
 * TanStack's keepPreviousData, but only the same person's: while other weeks or filters load, the
 * last figures stay on screen — never someone else's (a Stage 3 key's second part is its person:
 * ['planning' | 'management', userId, …]). No person, nothing kept.
 */
export const samePersonPlaceholder =
  (userId: string) =>
  <T>(previous: T | undefined, previousQuery: Query<T, Error, T, readonly unknown[]> | undefined): T | undefined =>
    userId && previousQuery?.queryKey[1] === userId ? previous : undefined;
