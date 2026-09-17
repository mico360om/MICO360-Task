import 'dotenv/config';
import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  API_BASE_URL: z.string().url().default('http://localhost:4000'),
  DATABASE_URL: z.string().min(1),
  TEST_DATABASE_URL: z.string().optional(),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  JWT_ACCESS_SECRET: z.string().min(8),
  JWT_REFRESH_SECRET: z.string().min(8),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  // 30-day refresh token: clients stay signed in for a month via silent refresh (no repeated logins).
  JWT_REFRESH_TTL_SECONDS: z.coerce.number().int().positive().default(60 * 60 * 24 * 30),
  ACCOUNT_LOCK_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
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
  UPLOAD_MAX_BYTES: z.coerce.number().int().positive().default(10 * 1024 * 1024),
  UPLOAD_MAX_TOTAL_BYTES_PER_TASK: z.coerce.number().int().positive().default(50 * 1024 * 1024),
  UPLOAD_ALLOWED_MIME: z
    .string()
    .default('image/png,image/jpeg,image/gif,image/webp,application/pdf,text/plain,text/csv,application/zip'),
});

export type Env = z.infer<typeof EnvSchema>;

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
    if (weak.length) throw new Error(`Insecure production secrets:\n${weak.map((w) => `  - ${w}`).join('\n')}`);
  }
  return parsed.data;
}

let cached: Env | null = null;
export function getEnv(): Env {
  if (!cached) cached = loadEnv();
  return cached;
}
