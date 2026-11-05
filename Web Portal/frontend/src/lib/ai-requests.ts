/**
 * The website's requests that wait on the AI (1.23.0): the Error log counts them as slow only after a
 * minute (SLOW.aiApiMs) — the AI provider may take minutes — while every other request stays at 10 s.
 * One list, by method and the server's route (`:param` = any one part of the address). ai-requests.test.ts
 * checks it against the code: every request the website's API modules make into a server route that is
 * handed the AI is either here or named there as one that doesn't wait on it.
 */
export interface AiRequest {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  /** Where on the site (for whoever reads the list). */
  what: string;
}

export const AI_REQUESTS: readonly AiRequest[] = [
  { method: 'POST', path: '/ai/parse-task', what: 'New task: Describe the task' },
  { method: 'POST', path: '/ai/parse-meeting', what: 'New meeting: Describe the meeting' },
  { method: 'POST', path: '/ai/draft-agenda', what: 'Meeting form: Draft agenda' },
  { method: 'POST', path: '/ai/write-meeting-description', what: 'Meeting form: Write description' },
  { method: 'POST', path: '/ai/breakdown', what: 'Task: break it into steps' },
  { method: 'POST', path: '/ai/summary', what: 'Project: AI summary' },
  { method: 'POST', path: '/ai/suggest-priority', what: 'Task: suggest a priority' },
  { method: 'POST', path: '/meetings/:id/final-minutes/draft', what: 'Final MOM: Draft with AI' },
  { method: 'POST', path: '/mico-ai/chats/:chatId/messages', what: 'MICO AI: a question and its answer' },
  { method: 'POST', path: '/mico-ai/chats/:chatId/messages/:messageId/confirm', what: 'MICO AI: doing what it proposed (a Final MOM draft asks the AI)' },
  { method: 'POST', path: '/search/ai', what: 'Search results: the AI panel' },
  { method: 'POST', path: '/ai/models/:id/test', what: 'AI Management: Test' },
  { method: 'POST', path: '/ai/providers', what: 'AI Management: add a provider (its models are loaded from it)' },
  { method: 'PUT', path: '/ai/providers/:id', what: 'AI Management: change a provider (a new key or address loads its models)' },
  { method: 'POST', path: '/ai/providers/:id/sync', what: 'AI Management: load the provider’s models again' },
];

const partsOf = (path: string) => path.split(/[?#]/)[0]!.replace(/^\/api\/v1(?=\/)/, '').split('/').filter(Boolean);
const LIST = AI_REQUESTS.map((r) => ({ method: r.method, parts: partsOf(r.path) }));

/** Does this request (its method and its address, as the API client sends it) wait on the AI? */
export function isAiRequest(method: string, path: string): boolean {
  const m = method.toUpperCase();
  const parts = partsOf(path);
  return LIST.some((r) => r.method === m && r.parts.length === parts.length && r.parts.every((p, i) => p.startsWith(':') || p === parts[i]));
}
