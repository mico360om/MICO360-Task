import { parseTokenKey } from './token-crypto';

/**
 * 1.23 automatic Teams links: the server's Microsoft settings (docs/microsoft-teams-setup.md). Without
 * MS_CLIENT_ID, MS_CLIENT_SECRET, MS_TENANT_ID and MS_TOKEN_KEY the feature is off and hidden everywhere.
 */
export interface MicrosoftEnv {
  NODE_ENV: string;
  API_BASE_URL: string;
  MS_CLIENT_ID: string;
  MS_CLIENT_SECRET: string;
  /** The Directory (tenant) ID — or "organizations" for several companies' tenants. */
  MS_TENANT_ID: string;
  /** Several tenants: only these directory ids (blank: any work or school tenant). */
  MS_ALLOWED_TENANTS: string;
  MS_TOKEN_KEY: string;
  /** Blank: API_BASE_URL + /api/v1/integrations/microsoft/callback. */
  MS_REDIRECT_URI: string;
  /** Blank: Microsoft's own. A stand-in's address in tests; https only on a production server. */
  MS_LOGIN_BASE_URL: string;
  MS_GRAPH_BASE_URL: string;
}

export type TenantRule = { mode: 'single'; tenantId: string } | { mode: 'multi'; allowed: string[] | null };

export interface MicrosoftConfig {
  clientId: string;
  clientSecret: string;
  tenant: TenantRule;
  /** The tenant part of the sign-in addresses: the tenant id, or "organizations". */
  authority: string;
  tokenKey: Buffer;
  redirectUri: string;
  loginBase: string;
  graphBase: string;
}

export const MS_SCOPES = ['OnlineMeetings.ReadWrite', 'User.Read', 'offline_access'] as const;
export const CALLBACK_PATH = '/api/v1/integrations/microsoft/callback';
const LOGIN_BASE = 'https://login.microsoftonline.com';
const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isTenantId = (v: string) => GUID.test(v);

function baseUrl(value: string, fallback: string, production: boolean, name: string, problems: string[]): string {
  const v = value.trim().replace(/\/+$/, '');
  if (!v) return fallback;
  let url: URL;
  try {
    url = new URL(v);
  } catch {
    problems.push(`${name} is not a web address.`);
    return fallback;
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && !production)) problems.push(`${name} must be an https address on a production server.`);
  return v;
}

/** The settings, or null with the reasons when they are incomplete or wrong (no reasons when none are set). */
export function microsoftConfigFromEnv(env: MicrosoftEnv): { config: MicrosoftConfig | null; problems: string[] } {
  const clientId = env.MS_CLIENT_ID.trim();
  const clientSecret = env.MS_CLIENT_SECRET.trim();
  const tenantRaw = env.MS_TENANT_ID.trim();
  const keyRaw = env.MS_TOKEN_KEY.trim();
  if (!clientId && !clientSecret && !tenantRaw && !keyRaw) return { config: null, problems: [] };
  const problems: string[] = [];
  for (const [name, v] of [['MS_CLIENT_ID', clientId], ['MS_CLIENT_SECRET', clientSecret], ['MS_TENANT_ID', tenantRaw], ['MS_TOKEN_KEY', keyRaw]] as const) {
    if (!v) problems.push(`${name} is missing.`);
  }
  if (clientId && !GUID.test(clientId)) problems.push('MS_CLIENT_ID must be the Application (client) ID from Microsoft Entra.');
  let tenant: TenantRule | null = null;
  if (tenantRaw) {
    if (GUID.test(tenantRaw)) tenant = { mode: 'single', tenantId: tenantRaw.toLowerCase() };
    else if (/^organizations$/i.test(tenantRaw)) {
      const list = env.MS_ALLOWED_TENANTS.split(/[\s,;]+/).map((t) => t.trim()).filter(Boolean);
      const bad = list.filter((t) => !GUID.test(t));
      if (bad.length) problems.push('MS_ALLOWED_TENANTS must list Directory (tenant) IDs, separated by commas.');
      tenant = { mode: 'multi', allowed: list.length ? [...new Set(list.map((t) => t.toLowerCase()))] : null };
    } else problems.push('MS_TENANT_ID must be the Directory (tenant) ID from Microsoft Entra, or "organizations".');
  }
  const tokenKey = keyRaw ? parseTokenKey(keyRaw) : null;
  if (keyRaw && !tokenKey) problems.push('MS_TOKEN_KEY must be 32 random bytes written as base64 (see docs/microsoft-teams-setup.md).');
  const production = env.NODE_ENV === 'production';
  const loginBase = baseUrl(env.MS_LOGIN_BASE_URL, LOGIN_BASE, production, 'MS_LOGIN_BASE_URL', problems);
  const graphBase = baseUrl(env.MS_GRAPH_BASE_URL, GRAPH_BASE, production, 'MS_GRAPH_BASE_URL', problems);
  const redirectUri = env.MS_REDIRECT_URI.trim() || `${env.API_BASE_URL.replace(/\/+$/, '')}${CALLBACK_PATH}`;
  if (problems.length || !tenant || !tokenKey) return { config: null, problems: problems.map((p) => `Teams links are off: ${p}`) };
  return {
    config: {
      clientId,
      clientSecret,
      tenant,
      authority: tenant.mode === 'single' ? tenant.tenantId : 'organizations',
      tokenKey,
      redirectUri,
      loginBase,
      graphBase,
    },
    problems: [],
  };
}
