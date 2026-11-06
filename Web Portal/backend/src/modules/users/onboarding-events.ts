import { maskEmail } from '../../lib/sign-in-code';
import type { CreateAuditData } from '../audit/audit-repository';
import type { EmailChangedParams, TemplateOptions } from '../email/email-templates';
import type { VerifiedHow } from '../auth/email-verification';

/**
 * Onboarding: what the rest of the server does when a set-password link is used, and when an
 * administrator changes someone's email address. Every step is bookkeeping around a change that has
 * already happened, so none of it is ever thrown back at the person.
 */
export interface OnboardingEventDeps {
  verification: { confirm(userId: string, how: VerifiedHow, opts?: { email?: string; actorId?: string | null; ip?: string | null }): Promise<unknown> };
  /** The account became theirs (activatedAt, when it is still empty). */
  activate: (userId: string) => Promise<void>;
  /** End the person's open sign-in challenges (a code sent to the old address must not count). */
  endChallenges?: (userId: string) => Promise<void>;
  audit?: { record(entry: CreateAuditData): Promise<unknown> };
  mailer?: { isConfigured(): boolean; sendEmailChanged(email: string, params: EmailChangedParams, opts?: TemplateOptions): Promise<unknown> };
  /** Their greeting name (first name, else username). */
  firstNameOf: (userId: string) => Promise<string>;
  emailOptions?: (userId: string) => Promise<TemplateOptions | undefined>;
  logger?: { warn(msg: string, ctx?: Record<string, unknown>): void };
}

export function createOnboardingEvents(deps: OnboardingEventDeps) {
  const warn = (msg: string, userId: string, err: unknown) => deps.logger?.warn(msg, { userId, error: err instanceof Error ? err.message : String(err) });

  /** A link from an email was used: the address is theirs; an invitation makes the account theirs too. */
  async function linkUsed(userId: string, purpose: 'PASSWORD_RESET' | 'WELCOME'): Promise<void> {
    await deps.verification.confirm(userId, purpose === 'WELCOME' ? 'invitation' : 'reset link', { actorId: userId });
    await deps.activate(userId);
    await deps.audit?.record({ userId, ip: null, module: 'users', action: purpose === 'WELCOME' ? 'user.invitation.used' : 'user.password.reset_used', entityId: userId });
  }

  /**
   * An administrator changed the address (it is already back to not verified, and links sent to the
   * old one are ended): end open codes, record from → to, and tell the OLD address — the new one masked.
   */
  async function emailChanged(userId: string, from: string, to: string, actor: { id: string; ip: string | null } | null): Promise<void> {
    try {
      await deps.endChallenges?.(userId);
    } catch (err) {
      warn('could not end sign-in codes after an email change', userId, err);
    }
    await deps.audit?.record({ userId: actor?.id ?? null, ip: actor?.ip ?? null, module: 'users', action: 'user.email.changed', entityId: userId, newValue: { from, to } });
    if (!deps.mailer?.isConfigured()) return;
    try {
      const [firstName, brand] = await Promise.all([deps.firstNameOf(userId), deps.emailOptions?.(userId).catch(() => undefined)]);
      await deps.mailer.sendEmailChanged(from, { firstName, newEmailMasked: maskEmail(to) }, brand);
    } catch (err) {
      warn('could not tell the old address about an email change', userId, err);
    }
  }

  return { linkUsed, emailChanged };
}

export type OnboardingEvents = ReturnType<typeof createOnboardingEvents>;
