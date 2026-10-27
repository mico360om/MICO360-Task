import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { ZodError } from 'zod';
import { createSettingsService, DEFAULT_DAILY_LIMIT, DEFAULT_WORKING_HOURS } from './settings-service';
import { registerSettingsRoutes } from './settings-routes';
import { createAuthGuard } from '../auth/auth-guard';
import { createTokenService } from '../auth/token-service';
import { HttpError } from '../../lib/http-errors';
import type { SettingRecord, SettingsRepository } from './settings-repository';
import type { AuditService } from '../audit/audit-service';

function inMemory(initial: Record<string, unknown> = {}): SettingsRepository {
  const map = new Map<string, unknown>(Object.entries(initial));
  return {
    async getAll() {
      return [...map.entries()].map(([key, value]): SettingRecord => ({ key, value }));
    },
    async set(key, value) {
      map.set(key, value);
      return { key, value };
    },
  };
}

const DEFAULT_STATUSES = ['BACKLOG', 'TODO', 'IN_PROGRESS', 'BLOCKED', 'REVIEW'];
const AI_CONFIG = { providers: [{ id: 'p1', apiKey: 'sk-live-SECRET' }], models: [], defaults: {} };

describe('SettingsService', () => {
  it('sets and reads back allow-listed system settings', async () => {
    const svc = createSettingsService({ settings: inMemory() });
    await svc.set('carryForward.enabled', false);
    await svc.set('carryForward.statuses', ['TODO', 'TODO', 'BLOCKED']);
    const all = await svc.getAll();
    expect(all).toHaveLength(2);
    expect(all.find((s) => s.key === 'carryForward.enabled')?.value).toBe(false);
    expect(all.find((s) => s.key === 'carryForward.statuses')?.value).toEqual(['TODO', 'BLOCKED']);
  });

  it('never lists ai.* (API keys) or any other non-allow-listed row', async () => {
    const svc = createSettingsService({ settings: inMemory({ 'ai.config': AI_CONFIG, 'carryForward.enabled': true, legacy: 'x' }) });
    const all = await svc.getAll();
    expect(all.map((s) => s.key)).toEqual(['carryForward.enabled']);
    expect(JSON.stringify(all)).not.toContain('sk-live');
  });

  it('refuses unknown keys, including ai.config', async () => {
    const svc = createSettingsService({ settings: inMemory() });
    await expect(svc.set('ai.config', AI_CONFIG)).rejects.toMatchObject({ code: 'UNKNOWN_SETTING', status: 400 });
    await expect(svc.set('companyName', 'x')).rejects.toMatchObject({ code: 'UNKNOWN_SETTING' });
  });

  it('validates each key with its own schema', async () => {
    const svc = createSettingsService({ settings: inMemory() });
    await expect(svc.set('carryForward.enabled', 'false')).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(svc.set('carryForward.enabled', undefined)).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(svc.set('carryForward.statuses', ['DONE'])).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(svc.set('carryForward.statuses', 'TODO')).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('reads the carry-forward config with safe defaults (the string "false" means off)', async () => {
    expect(await createSettingsService({ settings: inMemory() }).getCarryForward(DEFAULT_STATUSES)).toEqual({ enabled: true, statuses: DEFAULT_STATUSES });
    const legacy = createSettingsService({ settings: inMemory({ 'carryForward.enabled': 'false', 'carryForward.statuses': 'junk' }) });
    expect(await legacy.getCarryForward(DEFAULT_STATUSES)).toEqual({ enabled: false, statuses: DEFAULT_STATUSES });
    const set = createSettingsService({ settings: inMemory({ 'carryForward.enabled': false, 'carryForward.statuses': ['TODO'] }) });
    expect(await set.getCarryForward(DEFAULT_STATUSES)).toEqual({ enabled: false, statuses: ['TODO'] });
  });
});

describe('SettingsService: meeting working hours', () => {
  it('workingHours() returns the default when unset: Sunday to Thursday, 08:00 to 17:00', async () => {
    const svc = createSettingsService({ settings: inMemory() });
    expect(DEFAULT_WORKING_HOURS).toEqual({ days: [0, 1, 2, 3, 4], start: '08:00', end: '17:00' });
    expect(await svc.workingHours()).toEqual(DEFAULT_WORKING_HOURS);
  });

  it('accepts Sun–Thu 07:30–16:00 and reads it back', async () => {
    const svc = createSettingsService({ settings: inMemory() });
    await svc.set('meetings.workingHours', { days: [4, 0, 1, 2, 3, 3], start: '07:30', end: '16:00' });
    expect(await svc.workingHours()).toEqual({ days: [0, 1, 2, 3, 4], start: '07:30', end: '16:00' });
  });

  it('refuses an end before the start, an empty day list and a malformed time', async () => {
    const svc = createSettingsService({ settings: inMemory() });
    await expect(svc.set('meetings.workingHours', { days: [0], start: '17:00', end: '08:00' })).rejects.toMatchObject({ code: 'VALIDATION', status: 400 });
    await expect(svc.set('meetings.workingHours', { days: [], start: '08:00', end: '17:00' })).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(svc.set('meetings.workingHours', { days: [0], start: '8am', end: '17:00' })).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('falls back to the default when the stored value is broken', async () => {
    const svc = createSettingsService({ settings: inMemory({ 'meetings.workingHours': { days: 'weekdays' } }) });
    expect(await svc.workingHours()).toEqual(DEFAULT_WORKING_HOURS);
  });
});

describe('SettingsService: workload daily limit', () => {
  it('dailyLimit() is 5 until an admin sets it', async () => {
    const svc = createSettingsService({ settings: inMemory() });
    expect(DEFAULT_DAILY_LIMIT).toBe(5);
    expect(await svc.dailyLimit()).toBe(5);
  });

  it('takes a whole number from 1 to 50 and reads it back', async () => {
    const svc = createSettingsService({ settings: inMemory() });
    await svc.set('workload.dailyLimit', 8);
    expect(await svc.dailyLimit()).toBe(8);
    await svc.set('workload.dailyLimit', 1);
    expect(await svc.dailyLimit()).toBe(1);
    await svc.set('workload.dailyLimit', 50);
    expect(await svc.dailyLimit()).toBe(50);
  });

  it('refuses 0, 51, a fraction and text', async () => {
    const svc = createSettingsService({ settings: inMemory() });
    for (const bad of [0, 51, 2.5, '6', null]) {
      await expect(svc.set('workload.dailyLimit', bad)).rejects.toMatchObject({ code: 'VALIDATION', status: 400 });
    }
  });

  it('falls back to 5 when the stored value is broken', async () => {
    const svc = createSettingsService({ settings: inMemory({ 'workload.dailyLimit': 'lots' }) });
    expect(await svc.dailyLimit()).toBe(5);
  });

  it('is listed with the other system settings', async () => {
    const svc = createSettingsService({ settings: inMemory({ 'workload.dailyLimit': 7 }) });
    expect(await svc.getAll()).toEqual([{ key: 'workload.dailyLimit', value: 7 }]);
  });
});

describe('settings routes', () => {
  const tokenService = createTokenService({
    accessSecret: 'set-access',
    refreshSecret: 'set-refresh',
    accessTtl: 900,
    refreshTtl: 1000,
    refreshStore: { async save() {}, async findValid() { return null; }, async revoke() {}, async revokeAllForUser() {} },
  });

  async function makeApp() {
    const audited: Record<string, unknown>[] = [];
    const audit = { async record(d: Record<string, unknown>) { audited.push(d); return {} as never; }, async list() { return []; } } as unknown as AuditService;
    const app = Fastify();
    app.setErrorHandler((err, _req, reply) => {
      if (err instanceof HttpError) return reply.status(err.status).send({ error: { code: err.code } });
      if (err instanceof ZodError) return reply.status(400).send({ error: { code: 'VALIDATION' } });
      return reply.status(500).send({ error: { code: 'INTERNAL' } });
    });
    const settingsService = createSettingsService({ settings: inMemory({ 'ai.config': AI_CONFIG, 'carryForward.enabled': true }) });
    await registerSettingsRoutes(app, { settingsService, guard: createAuthGuard(tokenService), audit });
    const admin = { authorization: `Bearer ${(await tokenService.issueTokens({ id: 'admin1', roles: ['ADMIN'] })).accessToken}` };
    return { app, audited, admin };
  }

  it('GET never returns the AI provider keys', async () => {
    const { app, admin } = await makeApp();
    const res = await app.inject({ method: 'GET', url: '/system-settings', headers: admin });
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain('sk-live');
    expect(res.json().data.map((s: { key: string }) => s.key)).toEqual(['carryForward.enabled']);
    await app.close();
  });

  it('PUT validates, stores and audits the change', async () => {
    const { app, admin, audited } = await makeApp();
    const res = await app.inject({ method: 'PUT', url: '/system-settings/carryForward.enabled', headers: admin, payload: { value: false } });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual({ key: 'carryForward.enabled', value: false });
    expect(audited).toEqual([
      { userId: 'admin1', ip: '127.0.0.1', module: 'settings', action: 'setting.update', entityId: 'carryForward.enabled', oldValue: true, newValue: false },
    ]);
    await app.close();
  });

  it('PUT rejects a missing value, a bad value and a non-allow-listed key (400, not 500)', async () => {
    const { app, admin, audited } = await makeApp();
    expect((await app.inject({ method: 'PUT', url: '/system-settings/carryForward.enabled', headers: admin, payload: {} })).statusCode).toBe(400);
    expect((await app.inject({ method: 'PUT', url: '/system-settings/carryForward.enabled', headers: admin, payload: { value: 'false' } })).statusCode).toBe(400);
    const ai = await app.inject({ method: 'PUT', url: '/system-settings/ai.config', headers: admin, payload: { value: {} } });
    expect(ai.statusCode).toBe(400);
    expect(ai.json().error.code).toBe('UNKNOWN_SETTING');
    expect(audited).toHaveLength(0);
    await app.close();
  });

  it('is admin-only', async () => {
    const { app } = await makeApp();
    const employee = { authorization: `Bearer ${(await tokenService.issueTokens({ id: 'e1', roles: ['EMPLOYEE'] })).accessToken}` };
    expect((await app.inject({ method: 'GET', url: '/system-settings', headers: employee })).statusCode).toBe(403);
    await app.close();
  });
});

describe('SettingsService: the company week and the weekly management summary', () => {
  it('companyWeekStart() is Sunday (0) until an admin picks Monday (1) or Saturday (6)', async () => {
    const svc = createSettingsService({ settings: inMemory() });
    expect(await svc.companyWeekStart()).toBe(0);
    await svc.set('company.weekStart', 1);
    expect(await svc.companyWeekStart()).toBe(1);
    await svc.set('company.weekStart', 6);
    expect(await svc.companyWeekStart()).toBe(6);
    for (const bad of [2, 7, -1, '1', null]) {
      await expect(svc.set('company.weekStart', bad)).rejects.toMatchObject({ code: 'VALIDATION', status: 400 });
    }
    expect(await createSettingsService({ settings: inMemory({ 'company.weekStart': 'monday' }) }).companyWeekStart()).toBe(0);
  });

  it('companySettings(): both in one read, for the public /config', async () => {
    let reads = 0;
    const repo = inMemory({ 'company.weekStart': 1, 'weeklySummary.enabled': false });
    const counted = { ...repo, getAll: async () => { reads += 1; return repo.getAll(); } };
    expect(await createSettingsService({ settings: counted }).companySettings()).toEqual({ weekStart: 1, weeklySummaryEnabled: false });
    expect(reads).toBe(1);
    expect(await createSettingsService({ settings: inMemory() }).companySettings()).toEqual({ weekStart: 0, weeklySummaryEnabled: true });
  });

  it('weeklySummaryEnabled() is on until an admin turns it off', async () => {
    const svc = createSettingsService({ settings: inMemory() });
    expect(await svc.weeklySummaryEnabled()).toBe(true);
    await svc.set('weeklySummary.enabled', false);
    expect(await svc.weeklySummaryEnabled()).toBe(false);
    await expect(svc.set('weeklySummary.enabled', 'no')).rejects.toMatchObject({ code: 'VALIDATION' });
    // A broken stored value never turns it off by accident.
    expect(await createSettingsService({ settings: inMemory({ 'weeklySummary.enabled': 'off' }) }).weeklySummaryEnabled()).toBe(true);
  });
});
