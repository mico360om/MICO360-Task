import type { ApiClient } from '../lib/api-client';

export interface SearchResults {
  tasks: { id: string; key: string; title: string; projectId: string }[];
  projects: { id: string; code: string; name: string }[];
  users: { id: string; username: string; email: string; firstName: string; lastName: string }[];
  meetings: { id: string; title: string; projectId: string | null; snippet: string }[];
}

export function searchApi(client: ApiClient) {
  return {
    search: (q: string) =>
      client.get<{ data: SearchResults }>(`/search?q=${encodeURIComponent(q)}`).then((r) => r.data),
  };
}
