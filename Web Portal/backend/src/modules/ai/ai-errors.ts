import { ValidationError } from '../../lib/http-errors';
import { isMico360Provider, readRefusal } from './ai-network';

/**
 * A provider refused a request. `message` is what anyone may see; `detail` is the provider's own
 * explanation (which can name models or accounts), shown to admins only (the model test).
 * `providerStatus` is the provider's HTTP status; our own answer stays 400 (`status`), so a
 * provider's 401 or 429 never reads as the user's session expiring or their own rate limit.
 * MICO360 AI (b10): `correlationId` and `jobId` follow the request through the platform; they go to
 * the log and the Error log's details, never to the person.
 */
export class ProviderRefusedError extends ValidationError {
  constructor(
    public readonly providerStatus: number,
    public readonly detail: string | null,
    /** A 429 for a used-up quota (MICO360 AI), not a busy moment: trying again soon may not help. */
    public readonly quota = false,
    /** The answer's Retry-After in seconds, when it gave one as a number. */
    public readonly retryAfterSeconds: number | null = null,
    /** MICO360 AI: the platform's own words for this status (b9) — clearer than the general ones. */
    mico360 = false,
    public readonly correlationId: string | null = null,
    public readonly jobId: string | null = null,
  ) {
    super(quota ? QUOTA_MESSAGE : (mico360 && MICO360_MESSAGES[providerStatus]) || refusalMessage(providerStatus));
  }
}

const QUOTA_MESSAGE =
  'The AI service’s usage allowance is used up for now (HTTP 429). It starts again when its period resets — an admin can check the key’s quota in MICO360 Connect.';

/**
 * b9: what MICO360 AI's 401, 403 and 502 mean (its guide, §8 and §9), said so a person knows who can
 * fix it. Other providers keep the general words.
 */
const MICO360_MESSAGES: Record<number, string> = {
  401: 'MICO360 AI did not accept the API key (HTTP 401): it may be wrong, disabled, expired or deleted. An admin can check it in AI Management.',
  403: 'MICO360 AI’s key may not be used for this (HTTP 403). An admin can allow it in MICO360 Connect, under Applications & keys (Chat, Vision, Embedding or Ocr, and the allowed models).',
  502: 'MICO360 AI’s model failed while answering (HTTP 502). Try again in a moment.',
};

/**
 * MICO360 AI's 429 is one of three (its guide, §2, §5, §8): the key's concurrency (Retry-After: 1), its
 * rate limit (until the minute ends) or a quota — "Quota exceeded: …", with a Retry-After until the
 * period resets (an hour, a day, a month). A quota is said as one; the others are "busy".
 */
const QUOTA_RETRY_AFTER_SECONDS = 60;

/** The provider's refusal, read from its answer: the reason it gives, and (MICO360 AI) whether it is a quota. */
export async function providerRefusal(res: Response, provider: { preset?: string | null; apiBaseUrl?: string | null }): Promise<ProviderRefusedError> {
  const { detail, jobId, correlationId } = await readRefusal(res);
  const header = res.headers.get('retry-after')?.trim();
  const seconds = header && /^\d+$/.test(header) ? Number(header) : null;
  const mico = isMico360Provider(provider);
  const quota = mico && res.status === 429 && (/^\s*quota exceeded/i.test(detail ?? '') || (seconds !== null && seconds > QUOTA_RETRY_AFTER_SECONDS));
  return new ProviderRefusedError(res.status, detail, quota, seconds, mico, mico ? correlationId : null, mico ? jobId : null);
}

/** What a person is told for a provider's answer: the plain cause where the status says it. */
export function refusalMessage(status: number): string {
  switch (status) {
    case 429:
      return 'The AI service is busy right now (HTTP 429). Try again in a moment.';
    case 503:
      return 'The AI service has no model available right now (HTTP 503). Try again in a minute, or ask an admin to check AI Management.';
    case 504:
      return 'The AI service took too long to answer (HTTP 504). Try again.';
    case 413:
      return 'That is too long for the AI service to read (HTTP 413).';
    default:
      return `The AI provider rejected the request (HTTP ${status}).`;
  }
}
