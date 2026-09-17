export interface SettingRecord {
  key: string;
  value: unknown;
}

export interface SettingsRepository {
  getAll(): Promise<SettingRecord[]>;
  set(key: string, value: unknown): Promise<SettingRecord>;
}
