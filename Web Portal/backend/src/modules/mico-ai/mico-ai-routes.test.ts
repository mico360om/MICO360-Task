import { describe, it, expect } from 'vitest';
import { buildApp } from '../../app';
import { createTokenService } from '../auth/token-service';
import { createAuthService } from '../auth/auth-service';
import { createMicoAiService, type MicoAiModel } from './mico-ai-service';
import { createMemoryMicoAiRepository } from './mico-ai-repository';
import { createMicoAiTools } from './mico-ai-tools';
import { createMemoryMicoAiData, company, NOW } from './mico-ai-data.fixture';
import { inspectXlsx } from '../../lib/xlsx-inspect';
import { inspectPdf } from '../../lib/pdf-inspect';

const tokenService = createTokenService({
  accessSecret: 'mico-ai-access',
  refreshSecret: 'mico-ai-refresh',
  accessTtl: 900,
  refreshTtl: 1000,
  refreshStore: { async save() {}, async findValid() { return null; }, async revoke() {}, async revokeAllForUser() {} },
});
const authService = createAuthService({
  users: { async findByIdentifier() { return null; }, async findById() { return null; }, async applyFailedAttempt() {}, async resetFailedAttempts() {} },
  maxAttempts: 5,
});

async function makeApp(opts: { ready?: boolean } = {}) {
  const replies = [
    { action: 'tool', name: 'search_tasks', args: { project: 'RIG', status: 'overdue' } },
    { action: 'answer', text: '**3 tasks** are overdue.', tables: [{ title: 'Overdue tasks', fromResult: 'r1', columns: ['key', 'title', 'assignees', 'due', 'overdueDays'] }] },
  ];
  let i = 0;
  const model: MicoAiModel = {
    ready: async () => opts.ready ?? true,
    chat: async () => JSON.stringify(replies[Math.min(i++, replies.length - 1)]),
    startQuestion: () => {},
  };
  const audit: unknown[] = [];
  const micoAiService = createMicoAiService({
    repo: createMemoryMicoAiRepository(() => NOW),
    tools: createMicoAiTools({ data: createMemoryMicoAiData(company()), timeZone: 'Asia/Muscat', now: () => NOW }),
    model,
    audit: { record: async (e) => void audit.push(e) },
    timeZone: 'Asia/Muscat',
    now: () => NOW,
    userName: async () => 'Omar Said',
  });
  const app = await buildApp({ authService, tokenService, micoAiService });
  const auth = async (id: string, roles = ['EMPLOYEE']) => ({ authorization: `Bearer ${(await tokenService.issueTokens({ id, roles })).accessToken}` });
  return { app, audit, omar: await auth('u-omar'), sara: await auth('u-sara'), admin: await auth('u-admin', ['ADMIN']), micoAiService };
}

describe('MICO AI routes', () => {
  it('needs a signed-in person', async () => {
    const { app } = await makeApp();
    for (const [method, url] of [['GET', '/api/v1/mico-ai/status'], ['GET', '/api/v1/mico-ai/chats'], ['POST', '/api/v1/mico-ai/chats']] as const) {
      expect((await app.inject({ method, url })).statusCode).toBe(401);
    }
    await app.close();
  });

  it('says whether AI is set up', async () => {
    const off = await makeApp({ ready: false });
    expect((await off.app.inject({ method: 'GET', url: '/api/v1/mico-ai/status', headers: off.omar })).json()).toEqual({
      data: { ready: false, message: 'MICO AI isn’t set up yet. An administrator can add the AI service in AI Management.' },
    });
    const chat = (await off.app.inject({ method: 'POST', url: '/api/v1/mico-ai/chats', headers: off.omar, payload: {} })).json().data;
    const asked = await off.app.inject({ method: 'POST', url: `/api/v1/mico-ai/chats/${chat.id}/messages`, headers: off.omar, payload: { text: 'hello' } });
    expect(asked.statusCode).toBe(400);
    expect(asked.json().error.code).toBe('AI_NOT_CONFIGURED');
    await off.app.close();
  });

  it('a whole conversation: new chat, ask (202, pending), follow it, read the chat, download Excel and PDF', async () => {
    const { app, omar, micoAiService, audit } = await makeApp();
    const created = await app.inject({ method: 'POST', url: '/api/v1/mico-ai/chats', headers: omar, payload: {} });
    expect(created.statusCode).toBe(201);
    const chatId = created.json().data.id;
    const asked = await app.inject({ method: 'POST', url: `/api/v1/mico-ai/chats/${chatId}/messages`, headers: omar, payload: { text: 'Which tasks are overdue in Rig Inspection?' } });
    expect(asked.statusCode).toBe(202);
    const { question, answer } = asked.json().data;
    expect(question.role).toBe('user');
    expect(answer.status).toBe('pending');
    await micoAiService.whenDone(answer.id);
    const polled = (await app.inject({ method: 'GET', url: `/api/v1/mico-ai/chats/${chatId}/messages/${answer.id}`, headers: omar })).json().data;
    expect(polled.status).toBe('done');
    expect(polled.answer.tables[0].rows).toHaveLength(3);
    const chat = (await app.inject({ method: 'GET', url: `/api/v1/mico-ai/chats/${chatId}`, headers: omar })).json().data;
    expect(chat.chat.title).toBe('Which tasks are overdue in Rig Inspection?');
    expect(chat.messages.map((m: { role: string }) => m.role)).toEqual(['user', 'assistant']);
    expect(audit).toHaveLength(1);

    const xlsx = await app.inject({ method: 'GET', url: `/api/v1/mico-ai/chats/${chatId}/messages/${answer.id}/tables/1.xlsx`, headers: omar });
    expect(xlsx.statusCode).toBe(200);
    expect(xlsx.headers['content-type']).toContain('spreadsheetml');
    expect(xlsx.headers['content-disposition']).toBe('attachment; filename="mico-ai-overdue-tasks-2026-10-24.xlsx"');
    expect(inspectXlsx(xlsx.rawPayload).text[0]).toEqual(expect.arrayContaining(['RIG-14', 'RIG-9', 'RIG-21', 'Omar Said', 'Sara Ahmed']));

    const pdf = await app.inject({ method: 'GET', url: `/api/v1/mico-ai/chats/${chatId}/messages/${answer.id}/tables/1.pdf`, headers: omar });
    expect(pdf.statusCode).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    const text = inspectPdf(pdf.rawPayload).pages.flat().join('\n');
    expect(text).toContain('5 days');
    expect(text).toContain('Generated 24 Oct 2026, 12:00 (Asia/Muscat) by Omar Said');

    // The whole answer as one PDF report: the question, the words, every table, the sources.
    const report = await app.inject({ method: 'GET', url: `/api/v1/mico-ai/chats/${chatId}/messages/${answer.id}/report.pdf`, headers: omar });
    expect(report.statusCode).toBe(200);
    expect(report.headers['content-type']).toBe('application/pdf');
    expect(report.headers['content-disposition']).toBe('attachment; filename="mico-ai-which-tasks-are-overdue-in-rig-inspection-2026-10-24.pdf"');
    expect(report.headers['cache-control']).toBe('no-store');
    const whole = inspectPdf(report.rawPayload).pages.flat().join('\n');
    for (const s of ['Which tasks are overdue in Rig Inspection?', '3 tasks are overdue.', 'Overdue tasks (3 rows)', 'RIG-14', '5 days']) expect(whole).toContain(s);
    // A question has no report.
    expect((await app.inject({ method: 'GET', url: `/api/v1/mico-ai/chats/${chatId}/messages/${question.id}/report.pdf`, headers: omar })).statusCode).toBe(404);

    expect((await app.inject({ method: 'GET', url: `/api/v1/mico-ai/chats/${chatId}/messages/${answer.id}/tables/2.pdf`, headers: omar })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: `/api/v1/mico-ai/chats/${chatId}/messages/${answer.id}/tables/1.csv`, headers: omar })).statusCode).toBe(404);
    await app.close();
  });

  it('rename, search, delete', async () => {
    const { app, omar, micoAiService } = await makeApp();
    const chatId = (await app.inject({ method: 'POST', url: '/api/v1/mico-ai/chats', headers: omar, payload: { title: 'Rig notes' } })).json().data.id;
    const { answer } = (await app.inject({ method: 'POST', url: `/api/v1/mico-ai/chats/${chatId}/messages`, headers: omar, payload: { text: 'overdue?' } })).json().data;
    await micoAiService.whenDone(answer.id);
    const renamed = await app.inject({ method: 'PATCH', url: `/api/v1/mico-ai/chats/${chatId}`, headers: omar, payload: { title: 'Rig inspection' } });
    expect(renamed.json().data.title).toBe('Rig inspection');
    expect((await app.inject({ method: 'GET', url: '/api/v1/mico-ai/chats?q=inspection', headers: omar })).json().data.map((c: { id: string }) => c.id)).toEqual([chatId]);
    expect((await app.inject({ method: 'GET', url: '/api/v1/mico-ai/chats?q=nothing-like-this', headers: omar })).json().data).toEqual([]);
    expect((await app.inject({ method: 'DELETE', url: `/api/v1/mico-ai/chats/${chatId}`, headers: omar })).statusCode).toBe(204);
    expect((await app.inject({ method: 'GET', url: `/api/v1/mico-ai/chats/${chatId}`, headers: omar })).statusCode).toBe(404);
    await app.close();
  });

  it('another person’s chat is 404 everywhere, for admins too', async () => {
    const { app, omar, sara, admin, micoAiService } = await makeApp();
    const chatId = (await app.inject({ method: 'POST', url: '/api/v1/mico-ai/chats', headers: omar, payload: {} })).json().data.id;
    const { answer } = (await app.inject({ method: 'POST', url: `/api/v1/mico-ai/chats/${chatId}/messages`, headers: omar, payload: { text: 'overdue?' } })).json().data;
    await micoAiService.whenDone(answer.id);
    const base = `/api/v1/mico-ai/chats/${chatId}`;
    for (const who of [sara, admin]) {
      const calls = [
        ['GET', base, undefined],
        ['PATCH', base, { title: 'x' }],
        ['DELETE', base, undefined],
        ['POST', `${base}/messages`, { text: 'hi' }],
        ['GET', `${base}/messages/${answer.id}`, undefined],
        ['POST', `${base}/messages/${answer.id}/stop`, undefined],
        ['GET', `${base}/messages/${answer.id}/tables/1.xlsx`, undefined],
        ['GET', `${base}/messages/${answer.id}/tables/1.pdf`, undefined],
        ['GET', `${base}/messages/${answer.id}/report.pdf`, undefined],
      ] as const;
      for (const [method, url, payload] of calls) {
        const res = await app.inject({ method, url, headers: who, ...(payload ? { payload } : {}) });
        expect(res.statusCode, `${method} ${url}`).toBe(404);
      }
      expect((await app.inject({ method: 'GET', url: '/api/v1/mico-ai/chats', headers: who })).json().data).toEqual([]);
    }
    await app.close();
  });

  it('a chat opens on its latest messages; older ones come a page at a time', async () => {
    const { app, omar, sara, micoAiService } = await makeApp();
    const chatId = (await app.inject({ method: 'POST', url: '/api/v1/mico-ai/chats', headers: omar, payload: {} })).json().data.id;
    const { answer } = (await app.inject({ method: 'POST', url: `/api/v1/mico-ai/chats/${chatId}/messages`, headers: omar, payload: { text: 'overdue?' } })).json().data;
    await micoAiService.whenDone(answer.id);
    const opened = (await app.inject({ method: 'GET', url: `/api/v1/mico-ai/chats/${chatId}`, headers: omar })).json().data;
    expect(opened.hasMore).toBe(false);
    const older = await app.inject({ method: 'GET', url: `/api/v1/mico-ai/chats/${chatId}/messages?before=${opened.messages[1].id}`, headers: omar });
    expect(older.statusCode).toBe(200);
    expect(older.json().data).toEqual({ messages: [expect.objectContaining({ role: 'user', text: 'overdue?' })], hasMore: false });
    expect((await app.inject({ method: 'GET', url: `/api/v1/mico-ai/chats/${chatId}/messages?before=${opened.messages[1].id}`, headers: sara })).statusCode).toBe(404);
    await app.close();
  });

  it('checks what is sent: an empty or very long question, a long title', async () => {
    const { app, omar } = await makeApp();
    const chatId = (await app.inject({ method: 'POST', url: '/api/v1/mico-ai/chats', headers: omar, payload: {} })).json().data.id;
    expect((await app.inject({ method: 'POST', url: `/api/v1/mico-ai/chats/${chatId}/messages`, headers: omar, payload: { text: '   ' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: `/api/v1/mico-ai/chats/${chatId}/messages`, headers: omar, payload: { text: 'x'.repeat(4001) } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'PATCH', url: `/api/v1/mico-ai/chats/${chatId}`, headers: omar, payload: { title: 'x'.repeat(201) } })).statusCode).toBe(400);
    await app.close();
  });
});
