/**
 * An `ApiClient` for tests that records every call (Stage 3). Test-only — nothing in the app
 * imports this folder.
 *
 * Each call is kept as `"<METHOD> <path>"`, or `"<METHOD> <path> <JSON body>"` when it sends a
 * body (`del` is DELETE, `upload` UPLOAD without its form), with its options beside it in `opts`.
 * It answers `{ data: reply(method, path, body) }`, or `{ data: {} }` when there is no reply.
 */
import type { ApiClient, RequestOptions } from '../lib/api-client';

export function fakeApiClient(reply?: (method: string, path: string, body: unknown) => unknown): {
  client: ApiClient;
  calls: string[];
  opts: RequestOptions[];
} {
  const calls: string[] = [];
  const opts: RequestOptions[] = [];
  const call = <T>(method: string, path: string, body: unknown, o: RequestOptions | undefined, shown = body !== undefined): Promise<T> => {
    calls.push(shown ? `${method} ${path} ${JSON.stringify(body)}` : `${method} ${path}`);
    opts.push(o ?? {});
    return Promise.resolve({ data: reply?.(method, path, body) ?? {} } as T);
  };
  const clientFor = (asUser?: string): ApiClient => {
    const o = (x?: RequestOptions): RequestOptions | undefined => (asUser ? { ...x, asUser } : x);
    return {
      get: (path, x) => call('GET', path, undefined, o(x)),
      post: (path, body, x) => call('POST', path, body, o(x)),
      put: (path, body, x) => call('PUT', path, body, o(x)),
      patch: (path, body, x) => call('PATCH', path, body, o(x)),
      del: (path, x) => call('DELETE', path, undefined, o(x)),
      upload: (path, form, x) => call('UPLOAD', path, form, o(x), false),
      refreshSession: () => Promise.resolve('ok'),
      forUser: (userId) => clientFor(userId),
    };
  };
  return { client: clientFor(), calls, opts };
}
