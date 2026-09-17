import type { ApiClient } from '../lib/api-client';

export interface ApiSetting {
  key: string;
  value: unknown;
}

export function systemSettingsApi(client: ApiClient) {
  return {
    list: () => client.get<{ data: ApiSetting[] }>('/system-settings').then((r) => r.data),
    set: (key: string, value: unknown) => client.put<{ data: ApiSetting }>(`/system-settings/${key}`, { value }).then((r) => r.data),
  };
}
