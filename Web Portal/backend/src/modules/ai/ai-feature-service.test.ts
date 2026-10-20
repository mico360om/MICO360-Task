import { describe, it, expect, vi } from 'vitest';
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
      description: null,
      dueDate: '2026-09-18',
      priority: 'HIGH',
      recurrence: null,
      project: null,
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

describe('AiFeatureService: which model answers', () => {
  function capturing(cfg: AiConfig) {
    const used: string[] = [];
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      used.push(JSON.parse(String(init!.body)).model);
      return new Response(JSON.stringify({ choices: [{ message: { content: '["a","b","c"]' } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;
    return { svc: createAiFeatureService({ repo: createMemoryAiConfigRepository(cfg), fetchImpl }), used };
  }
  const two: AiConfig = {
    ...config,
    models: [
      { ...config.models[0]!, id: 'big', modelKey: 'gpt-4o' },
      { ...config.models[0]!, id: 'mini', modelKey: 'gpt-4o-mini' },
    ],
  };

  it('uses the recommended model when no default is chosen (not just the first one listed)', async () => {
    const { svc, used } = capturing({ ...two, defaults: {} });
    await svc.breakdownTask({ title: 'X' });
    expect(used).toEqual(['gpt-4o-mini']);
  });

  it('uses the chosen default while it is usable', async () => {
    const { svc, used } = capturing({ ...two, defaults: { chat: 'big' } });
    await svc.breakdownTask({ title: 'X' });
    expect(used).toEqual(['gpt-4o']);
  });
});

describe('AiFeatureService: describing a task in plain English', () => {
  const projects = [
    { id: 'p1', code: 'RIG1', number: 'PDO-2026-014', name: 'Rig Inspection Portal', status: 'ACTIVE' as const },
    { id: 'p2', code: 'WEB', number: null, name: 'Company Website', status: 'ACTIVE' as const },
    { id: 'p3', code: 'OLD', number: '1999', name: 'Old Archive Project', status: 'ARCHIVED' as const },
  ];
  function describing(answer: Record<string, unknown>, opts: { withProjects?: boolean } = {}) {
    const prompts: string[] = [];
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init!.body));
      prompts.push(body.messages.map((m: { content: string }) => m.content).join('\n'));
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(answer) } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;
    const svc = createAiFeatureService({
      repo: createMemoryAiConfigRepository(config),
      fetchImpl,
      ...(opts.withProjects === false ? {} : { listProjectsFor: async () => projects }),
    });
    return { svc, prompts };
  }
  const me = { userId: 'u1', roles: ['EMPLOYEE'] };

  it('suggests a description and a repeat as well as the title, date and priority', async () => {
    const { svc } = describing({
      title: 'Send the weekly site report',
      description: 'Include the inspection photos and the open defects list.',
      dueDate: '2026-09-21',
      priority: 'HIGH',
      repeat: { freq: 'WEEKLY', interval: 1, weekdays: [1] },
      project: null,
    });
    expect(await svc.parseTask({ text: 'send the site report every monday with photos and open defects, important', today: '2026-09-14' }, me)).toEqual({
      title: 'Send the weekly site report',
      description: 'Include the inspection photos and the open defects list.',
      dueDate: '2026-09-21',
      priority: 'HIGH',
      recurrence: { freq: 'WEEKLY', interval: 1, weekdays: [1] },
      project: null,
    });
  });

  it('keeps only a repeat the app can use', async () => {
    const parse = async (repeat: unknown) => (await describing({ title: 'X', repeat }).svc.parseTask({ text: 'x', today: '2026-09-14' }, me)).recurrence;
    expect(await parse({ freq: 'HOURLY', interval: 1 })).toBeNull();
    expect(await parse({ freq: 'MONTHLY', interval: 0 })).toBeNull();
    expect(await parse('every week')).toBeNull();
    expect(await parse({ freq: 'MONTHLY', interval: 1, dayOfMonth: 31, until: '2026-12-31', paused: true, junk: 'x' })).toEqual({ freq: 'MONTHLY', interval: 1, dayOfMonth: 31, until: '2026-12-31' });
    expect(await parse({ freq: 'WEEKLY', interval: 2, weekdays: [5, 1, 1, 9], count: 6, until: 'soon' })).toEqual({ freq: 'WEEKLY', interval: 2, weekdays: [1, 5], count: 6 });
    expect(await parse({ freq: 'DAILY', interval: 500 })).toEqual({ freq: 'DAILY', interval: 99 });
  });

  it('leaves the description out when it only repeats the title', async () => {
    const { svc } = describing({ title: 'Call the client', description: 'Call the client.' });
    expect((await svc.parseTask({ text: 'call the client', today: '2026-09-14' }, me)).description).toBeNull();
  });

  it('shows the AI the person’s own projects (code, number and name), not archived ones', async () => {
    const { svc, prompts } = describing({ title: 'X' });
    await svc.parseTask({ text: 'x', today: '2026-09-14' }, me);
    expect(prompts[0]).toContain('RIG1');
    expect(prompts[0]).toContain('PDO-2026-014');
    expect(prompts[0]).toContain('Company Website');
    expect(prompts[0]).not.toContain('Old Archive Project');
  });

  it('suggests the project the AI names, by code, number or name', async () => {
    for (const named of ['RIG1', 'pdo-2026-014', 'Rig Inspection Portal']) {
      const { svc } = describing({ title: 'Check the forms', project: named });
      expect((await svc.parseTask({ text: 'check the forms', today: '2026-09-14' }, me)).project, named).toEqual({ id: 'p1', code: 'RIG1', number: 'PDO-2026-014', name: 'Rig Inspection Portal' });
    }
  });

  it('suggests the project whose code or number is written in the note, even when the AI misses it', async () => {
    const byNumber = describing({ title: 'Check the forms', project: null });
    expect((await byNumber.svc.parseTask({ text: 'check the forms for PDO-2026-014 by friday', today: '2026-09-14' }, me)).project?.id).toBe('p1');
    const byCode = describing({ title: 'Fix the header', project: 'RIG1' });
    expect((await byCode.svc.parseTask({ text: 'WEB: fix the header', today: '2026-09-14' }, me)).project?.id).toBe('p2');
    // A code is matched as written (in capitals): the word "web" in a note is not the WEB project.
    const word = describing({ title: 'Update the web form', project: null });
    expect((await word.svc.parseTask({ text: 'update the web form', today: '2026-09-14' }, me)).project).toBeNull();
  });

  it('never suggests a project the person can’t add tasks to', async () => {
    for (const named of ['SECRET', 'OLD', '1999']) {
      const { svc } = describing({ title: 'X', project: named });
      expect((await svc.parseTask({ text: 'about project 1999', today: '2026-09-14' }, me)).project, named).toBeNull();
    }
  });

  it('works without a project list', async () => {
    const { svc, prompts } = describing({ title: 'X', project: 'RIG1' }, { withProjects: false });
    expect((await svc.parseTask({ text: 'x', today: '2026-09-14' }, me)).project).toBeNull();
    expect(prompts[0]).not.toContain('Projects');
  });
});

describe('AiFeatureService: drafting final minutes', () => {
  it('asks the model for the sections from the meeting’s facts only, and returns its JSON', async () => {
    const sent: Array<{ system: string; user: string; max: number }> = [];
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init!.body));
      sent.push({ system: body.messages[0].content, user: body.messages[1].content, max: body.max_completion_tokens ?? body.max_tokens });
      const answer = { summary: 'Progress was reviewed.', discussion: [{ topic: 'Go-live plan', text: 'Moved to November.' }], decisions: ['Go-live on 1 November.'], risks: [], nextSteps: [] };
      return new Response(JSON.stringify({ choices: [{ message: { content: '```json\n' + JSON.stringify(answer) + '\n```' } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;
    const svc = createAiFeatureService({ repo: createMemoryAiConfigRepository(config), fetchImpl });
    const draft = await svc.draftMinutes('Meeting: Weekly review\nNotes:\n[Decision] Go-live moves to 1 November.', { userId: 'u1' });
    expect(draft).toEqual({ summary: 'Progress was reviewed.', discussion: [{ topic: 'Go-live plan', text: 'Moved to November.' }], decisions: ['Go-live on 1 November.'], risks: [], nextSteps: [] });
    expect(sent[0]!.user).toContain('Go-live moves to 1 November.');
    expect(sent[0]!.system).toMatch(/only the facts/i);
    expect(sent[0]!.system).toContain('"nextSteps"');
    expect(sent[0]!.max).toBeGreaterThanOrEqual(2000);
  });

  it('says so when the model’s answer can’t be read as minutes', async () => {
    const svc = serviceWith('Sorry, I cannot help with that.');
    await expect(svc.draftMinutes('Meeting: X', { userId: 'u1' })).rejects.toThrow(/couldn’t be read/i);
  });
});

describe('AiFeatureService on MICO360 AI (its API guide)', () => {
  const micoConfig: AiConfig = {
    providers: [{ id: 'pr1', name: 'MICO360 AI', kind: 'custom', preset: 'mico360', apiBaseUrl: 'http://ai.mico360.com:5310/v1', apiKey: 'mico_x', enabled: true, createdAt: '', updatedAt: '' }],
    models: [{ id: 'm1', providerId: 'pr1', modelKey: 'llama3.1:latest', displayName: 'Llama 3.1', capabilities: ['chat'], parameters: {}, concurrencyLimit: 4, enabled: true, available: true, createdAt: '', updatedAt: '' }],
    defaults: { chat: 'm1' },
  };
  const recorder = (content: string) => {
    const bodies: Array<Record<string, unknown>> = [];
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init!.body)));
      return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;
    return { bodies, svc: createAiFeatureService({ repo: createMemoryAiConfigRepository(micoConfig), fetchImpl }) };
  };

  it('the features that read JSON ask for a JSON answer; the summary (plain text) does not', async () => {
    const { bodies, svc } = recorder('{"steps":["A","B","C"],"title":"T","priority":"HIGH","reason":"r","summary":"s"}');
    await svc.breakdownTask({ title: 'X' });
    await svc.parseTask({ text: 'call the bank', today: '2026-10-20' });
    await svc.suggestPriority({ title: 'X' });
    await svc.draftMinutes('Meeting: X', { userId: 'u1' });
    for (const body of bodies) expect(body.response_format).toEqual({ type: 'json_object' });
    const plain = recorder('All good.');
    await plain.svc.summarizeProject({ name: 'P', stats: { total: 1, completed: 0, inProgress: 0, overdue: 0 } });
    expect(plain.bodies[0]).not.toHaveProperty('response_format');
  });

  it('a checklist is asked for as {"steps": [...]} (a JSON answer is an object) and read from it', async () => {
    const { bodies, svc } = recorder('{"steps":["Gather figures","Draft the report","Send it"]}');
    expect(await svc.breakdownTask({ title: 'Monthly report' })).toEqual(['Gather figures', 'Draft the report', 'Send it']);
    expect((bodies[0]!.messages as Array<{ content: string }>)[0]!.content).toContain('{"steps"');
  });

  it('waits up to 2 minutes for an answer (a model may be loading), and 3 for the minutes draft (a long answer)', async () => {
    const waits: number[] = [];
    const real = AbortSignal.timeout.bind(AbortSignal);
    const spy = vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms: number) => {
      waits.push(ms);
      return real(ms);
    });
    try {
      const { svc } = recorder('{"steps":["A"],"summary":"s"}');
      await svc.breakdownTask({ title: 'X' });
      await svc.draftMinutes('Meeting: X', { userId: 'u1' });
      expect(waits).toEqual([120_000, 180_000]);
    } finally {
      spy.mockRestore();
    }
  });
});
