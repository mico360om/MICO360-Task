import type { ApiClient } from '../lib/api-client';

export function authApi(client: ApiClient) {
  return {
    forgotPassword: (identifier: string) =>
      client.post<{ data: { sent: true } }>('/auth/password/forgot', { identifier }).then((r) => r.data),
    resetPassword: (token: string, password: string) =>
      client.post<{ data: { reset: true } }>('/auth/password/reset', { token, password }).then((r) => r.data),
  };
}
