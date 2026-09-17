import { createApiClient } from '../lib/api-client';
import { useAuthStore, type Session } from '../stores/auth-store';

const baseUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:4000/api/v1';

/** Origin that serves uploaded files (the API origin, without the /api/v1 prefix). */
export const assetOrigin = baseUrl.replace(/\/api\/v1\/?$/, '');
/** Absolute URL for a server-relative asset path (e.g. /uploads/<key>); undefined for empty input. */
export const assetUrl = (path: string | null | undefined): string | undefined => (path ? `${assetOrigin}${path}` : undefined);

/** Exchange the stored refresh token for a fresh session; false if it can't (→ logout). */
async function refreshTokens(): Promise<boolean> {
  const { refreshToken } = useAuthStore.getState();
  if (!refreshToken) return false;
  try {
    const res = await fetch(`${baseUrl}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    if (!res.ok) return false;
    const json = (await res.json()) as { data: Session };
    useAuthStore.getState().setSession(json.data);
    return true;
  } catch {
    return false;
  }
}

/** Shared API client — base URL from env, bearer token from the auth store, with silent refresh on 401. */
export const apiClient = createApiClient({
  baseUrl,
  getToken: () => useAuthStore.getState().accessToken,
  refreshTokens,
  onUnauthorized: () => useAuthStore.getState().logout(), // session truly expired → back to login
});
