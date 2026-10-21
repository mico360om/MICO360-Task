import { useQuery } from '@tanstack/react-query';
import { useServices } from './providers';
import { searchEnabled } from '../lib/search';

/**
 * The server's search for the words typed (6b), asked once typing pauses, from 2 letters. Each set
 * of words has its own answer: an older answer that arrives late never shows for newer words.
 */
export function useSearch(words: string) {
  const { resources } = useServices();
  const q = words.trim();
  return useQuery({ queryKey: ['search', q], queryFn: () => resources.search(q), enabled: searchEnabled(q), staleTime: 30_000 });
}

/** The website's version (administrators get the technical details) for About (6b). */
export function useAboutVersion() {
  const { resources } = useServices();
  return useQuery({ queryKey: ['about', 'version'], queryFn: () => resources.about.version(), staleTime: 0 });
}

/** The version history (the server leaves the security lines out for everyone but administrators). */
export function useReleases() {
  const { resources } = useServices();
  return useQuery({ queryKey: ['about', 'releases'], queryFn: () => resources.about.releases(), staleTime: 10 * 60_000 });
}
