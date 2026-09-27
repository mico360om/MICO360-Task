import { describe, it, expect } from 'vitest';
import { createAiFeatureService, parseStringArray, parseJsonObject } from './ai-feature-service';
import { createMemoryAiConfigRepository } from './ai-config-repository';
import { emptyConfig, type AiConfig } from './ai-config';
import { ValidationError } from '../../lib/http-errors';

const config: AiConfig = {
  providers: [{ id: 'pr1', name: 'OpenAI', kind: 'openai', apiBaseUrl: 'https://api.openai.com/v1', apiKey: 'sk-x', enabled: true, createdAt: '', updatedAt: '' }],
  models: [{ id: 'm1', providerId: 'pr1', modelKey: 'gpt-4o', displayName: 'GPT-4o', capabilities: ['chat'], parameters: {}, concurrencyLimit: 1, enabled: true, available: true, createdAt: '', updatedAt: '' }],
  defaults: { chat: 'm1' },
};

function serviceWith(content: string, cfg: AiConfig = config) {
  const repo = createMemoryAiConfigRepository(cfg);
  const fetchImpl = (async () =>
    new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch;
  return createAiFeatureService({ repo, fetchImpl });
}

describe('AiFeatureService', () => {
  it('breaks a task into checklist items from a JSON array', async () => {
    const svc = serviceWith('["Gather figures","Draft the report","Review and send"]');
    expect(await svc.breakdownTask({ title: 'Monthly report', description: '' })).toEqual(['Gather figures', 'Draft the report', 'Review and send']);
  });

  it('tolerates fenced / prose-wrapped JSON when breaking down a task', async () => {
    const svc = serviceWith('Sure! Here you go:\n```json\n["A step","Another step","Final step"]\n```');
    expect(await svc.breakdownTask({ title: 'X' })).toEqual(['A step', 'Another step', 'Final step']);
  });

  it('parses a natural-language note into a structured task', async () => {
    const svc = serviceWith('{"title":"Review the quarterly report","dueDate":"2026-09-18","priority":"HIGH"}');
    expect(await svc.parseTask({ text: 'review the quarterly report by Friday, high priority', today: '2026-09-14' })).toEqual({
      title: 'Review the quarterly report',
      dueDate: '2026-09-18',
      priority: 'HIGH',
    });
  });

  it('suggests a priority with a reason', async () => {
    const svc = serviceWith('{"priority":"URGENT","reason":"Overdue and client-facing"}');
    expect(await svc.suggestPriority({ title: 'Fix outage', dueDate: '2026-09-01' })).toEqual({ priority: 'URGENT', reason: 'Overdue and client-facing' });
  });

  it('summarizes a project as text', async () => {
    const svc = serviceWith('The project is roughly 40% complete with two tasks overdue; momentum is steady.');
    const s = await svc.summarizeProject({ name: 'MICO', stats: { total: 10, completed: 4, inProgress: 2, overdue: 2 } });
    expect(s).toMatch(/40%/);
  });

  it('throws a helpful error when AI is not configured', async () => {
    const svc = serviceWith('[]', emptyConfig());
    await expect(svc.breakdownTask({ title: 'X' })).rejects.toBeInstanceOf(ValidationError);
    await expect(svc.breakdownTask({ title: 'X' })).rejects.toThrow(/not configured/i);
  });

  it('defaults "today" to the company-local date, not the UTC date', async () => {
    let prompt = '';
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      prompt = JSON.parse(String(init!.body)).messages[0].content;
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"title":"x","dueDate":null,"priority":null}' } }] }), { status: 200 });
    }) as unknown as typeof fetch;
    // 01:30 in Muscat on the 27th is still the 26th in UTC.
    const svc = createAiFeatureService({ repo: createMemoryAiConfigRepository(config), fetchImpl, timeZone: 'Asia/Muscat', now: () => new Date('2026-09-26T21:30:00Z') });
    await svc.parseTask({ text: 'call Ali tomorrow' });
    expect(prompt).toContain('Today is 2026-09-27');
  });

  it('rate-limits each user (per minute and per day)', async () => {
    const repo = createMemoryAiConfigRepository(config);
    const fetchImpl = (async () => new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200 })) as unknown as typeof fetch;
    const svc = createAiFeatureService({ repo, fetchImpl, limits: { perMinute: 2, perDay: 100 } });
    const summary = () => svc.summarizeProject({ name: 'P', stats: { total: 1, completed: 0, inProgress: 0, overdue: 0 } }, { userId: 'u1' });
    await summary();
    await summary();
    await expect(summary()).rejects.toMatchObject({ code: 'AI_RATE_LIMITED', status: 429 });
    await expect(svc.summarizeProject({ name: 'P', stats: { total: 1, completed: 0, inProgress: 0, overdue: 0 } }, { userId: 'u2' })).resolves.toBe('ok');
  });

  it('enforces the model’s concurrency limit', async () => {
    let inFlight = 0;
    let peak = 0;
    const fetchImpl = (async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 15));
      inFlight--;
      return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const svc = createAiFeatureService({ repo: createMemoryAiConfigRepository(config), fetchImpl }); // concurrencyLimit: 1
    const calls = Array.from({ length: 4 }, (_, i) =>
      svc.summarizeProject({ name: 'P', stats: { total: 1, completed: 0, inProgress: 0, overdue: 0 } }, { userId: `u${i}` }),
    );
    await Promise.all(calls);
    expect(peak).toBe(1);
  });

  it('falls back to line parsing / defaults for messy output', () => {
    expect(parseStringArray('- one\n- two\n3. three')).toEqual(['one', 'two', 'three']);
    expect(parseJsonObject('here: {"priority":"LOW"} ok')).toEqual({ priority: 'LOW' });
    expect(parseJsonObject('no json here')).toEqual({});
  });
});
