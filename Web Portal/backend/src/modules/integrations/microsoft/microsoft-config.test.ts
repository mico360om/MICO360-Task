import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { microsoftConfigFromEnv, type MicrosoftEnv } from './microsoft-config';

const TENANT = '11111111-2222-3333-4444-555555555555';
const OTHER = '99999999-8888-7777-6666-555555555555';
const CLIENT = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const base: MicrosoftEnv = {
  NODE_ENV: 'production',
  API_BASE_URL: 'https://task.mico360.com',
  MS_CLIENT_ID: CLIENT,
  MS_CLIENT_SECRET: 'stand-in-secret-value',
  MS_TENANT_ID: TENANT,
  MS_ALLOWED_TENANTS: '',
  MS_TOKEN_KEY: randomBytes(32).toString('base64'),
  MS_REDIRECT_URI: '',
  MS_LOGIN_BASE_URL: '',
  MS_GRAPH_BASE_URL: '',
};

describe('Microsoft Teams settings from the environment', () => {
  it('is off, quietly, when nothing is set (the feature is hidden and nothing breaks)', () => {
    const r = microsoftConfigFromEnv({ ...base, MS_CLIENT_ID: '', MS_CLIENT_SECRET: '', MS_TENANT_ID: '', MS_TOKEN_KEY: '' });
    expect(r.config).toBeNull();
    expect(r.problems).toEqual([]);
  });

  it('is off with a plain reason when only some settings are there', () => {
    const r = microsoftConfigFromEnv({ ...base, MS_TOKEN_KEY: '' });
    expect(r.config).toBeNull();
    expect(r.problems.join(' ')).toMatch(/MS_TOKEN_KEY/);
    const s = microsoftConfigFromEnv({ ...base, MS_CLIENT_SECRET: '' });
    expect(s.config).toBeNull();
    expect(s.problems.join(' ')).toMatch(/MS_CLIENT_SECRET/);
  });

  it('a single company tenant: the Directory (tenant) ID; Microsoft’s own addresses; the callback on this site', () => {
    const { config } = microsoftConfigFromEnv(base);
    expect(config).not.toBeNull();
    expect(config!.tenant).toEqual({ mode: 'single', tenantId: TENANT });
    expect(config!.authority).toBe(TENANT);
    expect(config!.loginBase).toBe('https://login.microsoftonline.com');
    expect(config!.graphBase).toBe('https://graph.microsoft.com/v1.0');
    expect(config!.redirectUri).toBe('https://task.mico360.com/api/v1/integrations/microsoft/callback');
    expect(config!.tokenKey.length).toBe(32);
  });

  it('several tenants: MS_TENANT_ID=organizations, with an optional allow-list', () => {
    const open = microsoftConfigFromEnv({ ...base, MS_TENANT_ID: 'organizations' }).config!;
    expect(open.tenant).toEqual({ mode: 'multi', allowed: null });
    expect(open.authority).toBe('organizations');
    const listed = microsoftConfigFromEnv({ ...base, MS_TENANT_ID: 'Organizations', MS_ALLOWED_TENANTS: `${TENANT}, ${OTHER.toUpperCase()}` }).config!;
    expect(listed.tenant).toEqual({ mode: 'multi', allowed: [TENANT, OTHER] });
  });

  it('refuses a tenant, client id or allow-list that is not a directory id (a domain name, a typo)', () => {
    expect(microsoftConfigFromEnv({ ...base, MS_TENANT_ID: 'contoso.onmicrosoft.com' }).config).toBeNull();
    expect(microsoftConfigFromEnv({ ...base, MS_CLIENT_ID: 'not-a-guid' }).config).toBeNull();
    expect(microsoftConfigFromEnv({ ...base, MS_TENANT_ID: 'organizations', MS_ALLOWED_TENANTS: 'contoso.com' }).config).toBeNull();
  });

  it('refuses a token key that is not 32 random bytes', () => {
    const r = microsoftConfigFromEnv({ ...base, MS_TOKEN_KEY: 'my-password' });
    expect(r.config).toBeNull();
    expect(r.problems.join(' ')).toMatch(/MS_TOKEN_KEY/);
  });

  it('takes stand-in addresses (tests), but on a production server only https ones', () => {
    const dev = microsoftConfigFromEnv({ ...base, NODE_ENV: 'development', MS_LOGIN_BASE_URL: 'http://127.0.0.1:4785/', MS_GRAPH_BASE_URL: 'http://127.0.0.1:4785/v1.0/' }).config!;
    expect(dev.loginBase).toBe('http://127.0.0.1:4785');
    expect(dev.graphBase).toBe('http://127.0.0.1:4785/v1.0');
    expect(microsoftConfigFromEnv({ ...base, MS_LOGIN_BASE_URL: 'http://127.0.0.1:4785' }).config).toBeNull();
  });

  it('a redirect address can be given (it must be the one registered in Microsoft Entra)', () => {
    const { config } = microsoftConfigFromEnv({ ...base, MS_REDIRECT_URI: 'https://tasks.example.com/api/v1/integrations/microsoft/callback' });
    expect(config!.redirectUri).toBe('https://tasks.example.com/api/v1/integrations/microsoft/callback');
  });
});
