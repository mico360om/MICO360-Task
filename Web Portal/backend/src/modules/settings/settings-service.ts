import type { SettingRecord, SettingsRepository } from './settings-repository';

export interface SettingsServiceDeps {
  settings: SettingsRepository;
}

export function createSettingsService({ settings }: SettingsServiceDeps) {
  async function getAll(): Promise<SettingRecord[]> {
    return settings.getAll();
  }
  async function set(key: string, value: unknown): Promise<SettingRecord> {
    return settings.set(key, value);
  }
  return { getAll, set };
}

export type SettingsService = ReturnType<typeof createSettingsService>;
