import { describe, it, expect, vi } from 'vitest';
import { createApi, ApiError } from './api.js';
import { DOWNLOAD_TIMEOUT_MS, REQUEST_TIMEOUT_MS, UPLOAD_TIMEOUT_MS, AI_TIMEOUT_MS } from './auth.js';
import { createReadCache } from './read-cache.js';
import { fakeStorage } from './test-helpers.js';

function fakeAuth(handler) {
  return { authedFetch: vi.fn(async (path, opts) => handler(path, opts)) };
}
const noCache = { read: async (_key, load) => ({ data: await load(), stale: false }) };
const json = (body, status = 200) => ({ ok: status < 300, status, json: async () => body, headers: { get: () => null } });

describe('api.reports', () => {
  it('reads each report with the filters (always fresh, never from the offline cache)', async () => {
    const auth = fakeAuth((path) => json({ data: path }));
    const cache = { read: vi.fn() };
    const api = createApi({ auth, cache });
    expect(await api.reports.projects({ projectId: 'p1' })).toBe('/reports/projects?projectId=p1');
    expect(await api.reports.status({ userId: 'u1' })).toBe('/reports/status?userId=u1');
    expect(await api.reports.workload({})).toBe('/reports/workload');
    expect(await api.reports.completion({ projectId: 'p1', userId: 'u1' })).toBe('/reports/completion?projectId=p1&userId=u1');
    expect(await api.reports.timeseries({ from: '2026-09-01', to: '2026-09-30', projectId: 'p1' })).toBe('/reports/timeseries?projectId=p1&from=2026-09-01&to=2026-09-30');
    expect(cache.read).not.toHaveBeenCalled();
  });
});

describe('api.version', () => {
  it('reads GET /version and keeps the answer, so the versions still show offline', async () => {
    const store = fakeStorage();
    let online = true;
    const auth = fakeAuth((path) => {
      if (!online) throw new TypeError('Failed to fetch');
      return json({ data: { version: '1.6.0', deployedAt: '2026-10-21T05:00:00Z', path } });
    });
    const api = createApi({ auth, cache: createReadCache(store) });
    expect(await api.version()).toMatchObject({ data: { version: '1.6.0', path: '/version' }, stale: false });
    online = false;
    expect(await api.version()).toMatchObject({ data: { version: '1.6.0' }, stale: true });
  });
});

describe('cached reads only keep real API answers (M6)', () => {
  const saved = () => fakeStorage({ 'cache:projects': { data: [{ id: 'p1', name: 'Ops' }], cachedAt: 1 } });

  it('a 200 page that is not JSON (a Wi-Fi sign-in page or a proxy) is not cached: the saved copy is shown instead', async () => {
    const store = saved();
    const portal = { ok: true, status: 200, headers: { get: (h) => (h.toLowerCase() === 'content-type' ? 'text/html; charset=utf-8' : null) }, json: async () => { throw new SyntaxError('Unexpected token <'); } };
    const api = createApi({ auth: fakeAuth(() => portal), cache: createReadCache(store) });
    const r = await api.projects.list();
    expect(r).toMatchObject({ data: [{ id: 'p1', name: 'Ops' }], stale: true });
    expect(store.data['cache:projects'].data).toEqual([{ id: 'p1', name: 'Ops' }]);
  });

  it('a JSON 200 without the API’s `data` is not cached either', async () => {
    for (const reply of [json({ hello: 'portal' }), { ...json(null), json: async () => { throw new SyntaxError('empty'); } }]) {
      const store = saved();
      const api = createApi({ auth: fakeAuth(() => reply), cache: createReadCache(store) });
      expect(await api.projects.list()).toMatchObject({ stale: true, data: [{ id: 'p1', name: 'Ops' }] });
      expect(store.data['cache:projects'].cachedAt).toBe(1);
    }
  });

  it('a real answer is cached as before', async () => {
    const store = saved();
    const reply = { ...json({ data: [{ id: 'p2' }] }), headers: { get: (h) => (h.toLowerCase() === 'content-type' ? 'application/json; charset=utf-8' : null) } };
    const api = createApi({ auth: fakeAuth(() => reply), cache: createReadCache(store) });
    expect(await api.projects.list()).toMatchObject({ stale: false, data: [{ id: 'p2' }] });
    expect(store.data['cache:projects'].data).toEqual([{ id: 'p2' }]);
  });
});

describe('reads show changes waiting to sync (H3)', () => {
  it('layers this person’s queued changes over the server’s copy, and says how many', async () => {
    const store = fakeStorage();
    const pending = vi.fn(async () => [
      { id: 'q1', kind: 'task.update', userId: 'u1', status: 'pending', payload: { id: 't1', patch: { title: 'Edited offline' }, expectedVersion: 2 } },
    ]);
    const api = createApi({ auth: fakeAuth(() => json({ data: { id: 't1', title: 'Server', version: 2 } })), cache: createReadCache(store), pending });
    const r = await api.tasks.get('t1');
    expect(r).toMatchObject({ data: { id: 't1', title: 'Edited offline', version: 2 }, stale: false, pending: 1 });
    expect(store.data['cache:task:t1'].data.title).toBe('Server'); // the offline copy keeps the server's answer
    const other = await api.tasks.get('t2');
    expect(other.pending).toBeUndefined();
  });
});

describe('api.download', () => {
  it('fetches a file with the session and returns it with the server’s file name', async () => {
    const blob = new Blob(['%PDF']);
    const auth = fakeAuth(() => ({ ok: true, status: 200, blob: async () => blob, headers: { get: (h) => (h.toLowerCase() === 'content-disposition' ? 'attachment; filename="tasks-report-2026-10-01.pdf"' : null) } }));
    const api = createApi({ auth, cache: noCache });
    const out = await api.download('/reports/export.pdf');
    expect(auth.authedFetch).toHaveBeenCalledWith('/reports/export.pdf', expect.objectContaining({ method: 'GET' }));
    expect(out).toEqual({ blob, fileName: 'tasks-report-2026-10-01.pdf' });
  });

  it('M4: waits longer for a file than for other calls (a large report on a slow server)', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    const auth = fakeAuth(() => ({ ok: true, status: 200, blob: async () => new Blob(['x']), headers: { get: () => null } }));
    await createApi({ auth, cache: noCache }).download('/tasks/t1/export.xlsx');
    expect(timeout).toHaveBeenCalledWith(DOWNLOAD_TIMEOUT_MS);
    expect(DOWNLOAD_TIMEOUT_MS).toBeGreaterThan(REQUEST_TIMEOUT_MS * 10);
    expect(auth.authedFetch.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
    timeout.mockRestore();
  });

  it('throws an ApiError with the server’s message when the download is refused', async () => {
    const auth = fakeAuth(() => json({ error: { code: 'FORBIDDEN', message: 'Admins only.' } }, 403));
    const api = createApi({ auth, cache: noCache });
    await expect(api.download('/reports/export.xlsx')).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });
    await expect(api.download('/reports/export.xlsx')).rejects.toBeInstanceOf(ApiError);
  });
});

describe('quick capture calls (Stage 2)', () => {
  it('reads a project’s team through the offline cache (people a new task can be assigned to)', async () => {
    const store = fakeStorage();
    const auth = fakeAuth(() => json({ data: [{ id: 'u1', firstName: 'Mariam', lastName: 'Al Hinai', username: 'mariam' }] }));
    const api = createApi({ auth, cache: createReadCache(store) });
    expect((await api.projects.members('p1')).data).toEqual([{ id: 'u1', firstName: 'Mariam', lastName: 'Al Hinai', username: 'mariam' }]);
    expect(auth.authedFetch).toHaveBeenCalledWith('/projects/p1/members', undefined);
    expect(store.data['cache:members:p1'].data).toHaveLength(1);
  });

  it('uploads a file to a task as multipart form data, with a longer wait, and returns the attachment', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    const file = new File(['png-bytes'], 'Pasted image 2026-10-21 10.00.00.png', { type: 'image/png' });
    const auth = fakeAuth(() => json({ data: { id: 'a1', filename: file.name } }, 201));
    const api = createApi({ auth, cache: noCache });
    expect(await api.attachments.upload('t1', file)).toEqual({ id: 'a1', filename: file.name });
    const [path, init] = auth.authedFetch.mock.calls[0];
    expect(path).toBe('/tasks/t1/attachments');
    expect(init.method).toBe('POST');
    expect(init.body).toBeInstanceOf(FormData);
    const sent = init.body.get('file');
    expect(sent.name).toBe(file.name);
    expect(sent.type).toBe('image/png');
    expect(timeout).toHaveBeenCalledWith(UPLOAD_TIMEOUT_MS);
    timeout.mockRestore();
  });

  it('a refused upload throws the server’s answer (e.g. 413 too large)', async () => {
    const auth = fakeAuth(() => json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'File too large' } }, 413));
    const api = createApi({ auth, cache: noCache });
    await expect(api.attachments.upload('t1', new File(['x'], 'big.zip'))).rejects.toMatchObject({ status: 413 });
  });

  it('"Describe it" asks POST /ai/parse-task with the company’s today, and waits for the AI', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    const draft = { title: 'Send the site report', dueDate: '2026-10-26', priority: 'HIGH', recurrence: null, project: null };
    const auth = fakeAuth(() => json({ data: draft }));
    const api = createApi({ auth, cache: noCache });
    expect(await api.ai.parseTask('Send the site report on Monday, urgent-ish', '2026-10-21')).toEqual(draft);
    const [path, init] = auth.authedFetch.mock.calls[0];
    expect(path).toBe('/ai/parse-task');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ text: 'Send the site report on Monday, urgent-ish', today: '2026-10-21' });
    expect(timeout).toHaveBeenCalledWith(AI_TIMEOUT_MS);
    expect(AI_TIMEOUT_MS).toBeGreaterThanOrEqual(120000);
    timeout.mockRestore();
  });

  it('"Describe it" without AI set up rejects with the server’s own message', async () => {
    const message = 'AI is not configured yet — an admin needs to add a provider and enable a chat model in AI Management.';
    const auth = fakeAuth(() => json({ error: { code: 'VALIDATION_ERROR', message } }, 400));
    const api = createApi({ auth, cache: noCache });
    await expect(api.ai.parseTask('anything', '2026-10-21')).rejects.toMatchObject({ status: 400, serverMessage: message });
  });
});

describe('Stage 5: notification preferences and chat calls', () => {
  it('reads and saves the notification preferences (the whole muted list and reminder time)', async () => {
    const auth = fakeAuth((path, opts) => json({ data: { path, method: opts?.method || 'GET', body: opts?.body ? JSON.parse(opts.body) : null } }));
    const api = createApi({ auth, cache: noCache });
    expect((await api.notifications.preferences()).data).toMatchObject({ path: '/notifications/preferences', method: 'GET' });
    expect(await api.notifications.setPreferences({ muted: ['MENTION'], reminderLeadMinutes: 60 })).toEqual({ path: '/notifications/preferences', method: 'PUT', body: { muted: ['MENTION'], reminderLeadMinutes: 60 } });
  });

  it('"Send me a test now": POST /notifications/daily-emails/test, never from the offline cache; the server’s refusal comes back', async () => {
    const auth = fakeAuth((path, opts) => json({ data: { pending: 'sent', completed: 'empty', path, method: opts?.method } }));
    const cache = { read: vi.fn() };
    const api = createApi({ auth, cache });
    expect(await api.notifications.sendDailyTest()).toEqual({ pending: 'sent', completed: 'empty', path: '/notifications/daily-emails/test', method: 'POST' });
    expect(cache.read).not.toHaveBeenCalled();
    const message = 'A test was just sent. Wait a minute before sending another.';
    const refused = createApi({ auth: fakeAuth(() => json({ error: { code: 'TOO_SOON', message } }, 429)), cache });
    await expect(refused.notifications.sendDailyTest()).rejects.toMatchObject({ status: 429, serverMessage: message });
  });

  it('pages of history: the newest kept for offline; older ones (?before=) read fresh', async () => {
    const auth = fakeAuth((path) => json({ data: [{ id: 'm1', body: path, deletedAt: null }] }));
    const cache = { read: vi.fn(async (_key, load) => ({ data: await load(), stale: false })) };
    const api = createApi({ auth, cache });
    expect((await api.chat.messages('c1')).data[0].body).toBe('/conversations/c1/messages');
    expect(cache.read).toHaveBeenCalledWith('messages:c1', expect.any(Function));
    expect(await api.chat.older('c1', '2026-10-20T09:00:00.000Z')).toEqual([{ id: 'm1', body: '/conversations/c1/messages?before=2026-10-20T09%3A00%3A00.000Z&limit=50', deletedAt: null }]);
    expect(cache.read).toHaveBeenCalledTimes(1);
  });

  it('starts a direct conversation, changes a conversation’s own settings, says messages arrived', async () => {
    const seen = [];
    const auth = fakeAuth((path, opts) => { seen.push([opts?.method, path, opts?.body ? JSON.parse(opts.body) : undefined]); return path.endsWith('/delivered') ? { ok: true, status: 204, json: async () => ({}), headers: { get: () => null } } : json({ data: { id: 'c9', favorite: true } }); });
    const api = createApi({ auth, cache: noCache });
    expect(await api.chat.startDirect('u2')).toEqual({ id: 'c9', favorite: true });
    expect(await api.chat.setPrefs('c9', { favorite: true })).toEqual({ id: 'c9', favorite: true });
    await api.chat.markDelivered('c9');
    expect(seen).toEqual([
      ['POST', '/conversations/direct', { userId: 'u2' }],
      ['PUT', '/conversations/c9/prefs', { favorite: true }],
      ['POST', '/conversations/c9/delivered', {}],
    ]);
  });

  it('sends a file as a message: its clientId and caption go before the file, with the upload timeout', async () => {
    let sent;
    const auth = fakeAuth((path, opts) => { sent = { path, opts }; return json({ data: { id: 'm2' } }); });
    const api = createApi({ auth, cache: noCache });
    const file = new File(['x'], 'gauge.png', { type: 'image/png' });
    expect(await api.chat.upload('c1', file, { clientId: 'k1', body: 'The gauge' })).toEqual({ id: 'm2' });
    expect(sent.path).toBe('/conversations/c1/attachments');
    expect(sent.opts.method).toBe('POST');
    expect([...sent.opts.body.keys()]).toEqual(['clientId', 'body', 'file']);
    expect(sent.opts.body.get('clientId')).toBe('k1');
    expect(sent.opts.signal).toBeTruthy();
  });
});
