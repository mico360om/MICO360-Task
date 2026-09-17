import { describe, it, expect } from 'vitest';
import { createSettingsService } from './settings-service';
import type { SettingRecord, SettingsRepository } from './settings-repository';

function inMemory(): SettingsRepository {
  const map = new Map<string, unknown>();
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

describe('SettingsService', () => {
  it('sets and reads back system settings', async () => {
    const svc = createSettingsService({ settings: inMemory() });
    await svc.set('companyName', 'MICO Energy');
    await svc.set('defaultTimezone', 'Asia/Karachi');
    const all = await svc.getAll();
    expect(all).toHaveLength(2);
    expect(all.find((s) => s.key === 'companyName')?.value).toBe('MICO Energy');
  });
});
