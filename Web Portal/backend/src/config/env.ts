import 'dotenv/config';
import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  // Interface to listen on: 0.0.0.0 (all, the default) or 127.0.0.1 (this computer only).
  HOST: z.string().default('0.0.0.0'),
  API_BASE_URL: z.string().url().default('http://localhost:4000'),
  DATABASE_URL: z.string().min(1),
  TEST_DATABASE_URL: z.string().optional(),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  // Proxies trusted for the client IP (see parseTrustProxy). 'loopback' fits nginx on the same host.
  TRUST_PROXY: z.string().default('loopback'),
  // Requests per minute per signed-in user (per IP when signed out), and per IP for sign-in routes.
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(600),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(20),
  JWT_ACCESS_SECRET: z.string().min(8),
  JWT_REFRESH_SECRET: z.string().min(8),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  // 30-day refresh token: clients stay signed in for a month via silent refresh (no repeated logins).
  JWT_REFRESH_TTL_SECONDS: z.coerce.number().int().positive().default(60 * 60 * 24 * 30),
  ACCOUNT_LOCK_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  // Minutes a lock lasts after ACCOUNT_LOCK_MAX_ATTEMPTS failures; each further failure doubles it (max 24 h).
  ACCOUNT_LOCK_MINUTES: z.coerce.number().int().positive().default(15),
  // Key for secrets stored in the database (AI provider API keys). Optional: without it a key is
  // derived from JWT_ACCESS_SECRET, so set it before rotating that secret. Use 32+ random characters.
  SECRETS_ENCRYPTION_KEY: z.string().optional().default(''),
  OTP_TTL_SECONDS: z.coerce.number().int().positive().default(600),
  OTP_LENGTH: z.coerce.number().int().min(4).max(10).default(6),
  PASSWORD_RESET_TTL_SECONDS: z.coerce.number().int().positive().default(3600),
  APP_URL: z.string().url().default('http://localhost:5173'),
  SENTRY_DSN: z.string().optional().default(''),
  MAILJET_API_KEY: z.string().optional().default(''),
  MAILJET_SECRET_KEY: z.string().optional().default(''),
  MAILJET_SMTP_HOST: z.string().default('in-v3.mailjet.com'),
  MAILJET_SMTP_PORT: z.coerce.number().int().default(25),
  MAIL_FROM: z.string().default('MICO360 Tasks <no-reply@mico360.example>'),
  MAILJET_WEBHOOK_TOKEN: z.string().optional().default(''),
  // Phone push (FCM HTTP v1): a Firebase service-account key, inline JSON or a file path.
  // Push stays off while neither is set.
  FCM_SERVICE_ACCOUNT_JSON: z.string().optional().default(''),
  FCM_SERVICE_ACCOUNT_FILE: z.string().optional().default(''),
  // Email branding (used by all templates; safe defaults for local dev).
  COMPANY_NAME: z.string().default('MICO360'),
  PRODUCT_NAME: z.string().default('MICO360 Tasks'),
  SUPPORT_EMAIL: z.string().default('support@mico360.example'),
  COMPANY_WEBSITE_URL: z.string().default('https://mico360.example'),
  COMPANY_ADDRESS: z.string().default('MICO360, Muscat, Sultanate of Oman'),
  EMAIL_LOGO_URL: z.string().optional().default(''),
  // IANA time zone treated as the company's single source of truth for date/time display.
  COMPANY_TIMEZONE: z.string().default('Asia/Muscat'),
  UPLOAD_DIR: z.string().default('uploads'),
  // Built web app (Web Portal/frontend/dist) to serve from this server. Blank when a reverse proxy
  // (nginx / LiteSpeed) serves it, as on Hostinger; the self-contained Windows server sets it.
  WEB_ROOT: z.string().optional().default(''),
  UPLOAD_MAX_BYTES: z.coerce.number().int().positive().default(10 * 1024 * 1024),
  UPLOAD_MAX_TOTAL_BYTES_PER_TASK: z.coerce.number().int().positive().default(50 * 1024 * 1024),
  UPLOAD_ALLOWED_MIME: z
    .string()
    .default('image/png,image/jpeg,image/gif,image/webp,application/pdf,text/plain,text/csv,application/zip'),
  // AI providers on private / internal addresses (e.g. Ollama on localhost) are refused unless 'true'.
  AI_ALLOW_PRIVATE_HOSTS: z
    .string()
    .default('false')
    .transform((v) => ['true', '1', 'yes'].includes(v.trim().toLowerCase())),
  // Per-user AI request budget.
  AI_USER_REQUESTS_PER_MINUTE: z.coerce.number().int().positive().default(10),
  AI_USER_REQUESTS_PER_DAY: z.coerce.number().int().positive().default(200),
});

export type Env = z.infer<typeof EnvSchema>;

/**
 * Parse TRUST_PROXY into Fastify's `trustProxy` option: 'true'/'false', a hop count ('1'),
 * or a comma-separated list of IPs / CIDRs / proxy-addr names ('loopback', 'uniquelocal').
 */
export function parseTrustProxy(value: string): boolean | number | string | string[] {
  const v = value.trim();
  if (v === '' || v === 'false') return false;
  if (v === 'true') return true;
  if (/^\d+$/.test(v)) return Number(v);
  const list = v.split(',').map((s) => s.trim()).filter(Boolean);
  return list.length === 1 ? list[0]! : list;
}

/** Parse and validate an environment object, throwing a readable error if invalid. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  // Production secret hardening: fail fast on weak / placeholder / re-used JWT secrets so a
  // deployment can't ship with dev defaults after a key rotation (T19 security).
  if (parsed.data.NODE_ENV === 'production') {
    const weak: string[] = [];
    for (const key of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'] as const) {
      const v = parsed.data[key];
      if (v.length < 32) weak.push(`${key} must be at least 32 characters in production`);
      if (/dev|test|secret|change ?me|placeholder|example/i.test(v)) weak.push(`${key} looks like a placeholder — set a strong random value`);
    }
    if (parsed.data.JWT_ACCESS_SECRET === parsed.data.JWT_REFRESH_SECRET) {
      weak.push('JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must differ');
    }
    const secretsKey = parsed.data.SECRETS_ENCRYPTION_KEY.trim();
    if (secretsKey && secretsKey.length < 32) weak.push('SECRETS_ENCRYPTION_KEY must be at least 32 characters in production');
    if (weak.length) throw new Error(`Insecure production secrets:\n${weak.map((w) => `  - ${w}`).join('\n')}`);
  }
  return parsed.data;
}

let cached: Env | null = null;
export function getEnv(): Env {
  if (!cached) cached = loadEnv();
  return cached;
}
