import { z } from 'zod';
import { HttpError } from '../../lib/http-errors';
import { generateTemporaryPassword, TEMPORARY_PASSWORD_STYLES, type TemporaryPasswordStyle } from '../../lib/temporary-password';
import { DEFAULT_INVITATION_DAYS, invitationDaysSchema } from '../settings/settings-service';
import type { TemporaryPasswordMark } from './user-repository';

/**
 * 1.23.6 Invitation & temporary password security: how a new person gets in — ONE way, never both.
 *
 *   sendWelcome        an emailed invitation link (the default on the website)
 *   generatePassword   a temporary password made here ('words' or 'characters'), returned once
 *   password           a typed one (the Android app, the API): accepted, always treated as temporary
 *
 * Any temporary password must be changed at the first sign-in and stops working unused after the
 * lifetime (`inviteDays`, else System Settings' "Invitation links last", else 7 days).
 */
export const wayInFields = {
  password: z.string().max(200).optional(),
  sendWelcome: z.boolean().optional(),
  generatePassword: z.enum(TEMPORARY_PASSWORD_STYLES).optional(),
  inviteDays: invitationDaysSchema.optional(),
};

export interface WayIn {
  password?: string;
  sendWelcome?: boolean;
  generatePassword?: TemporaryPasswordStyle;
  inviteDays?: number;
}

export class OneWayInError extends HttpError {
  constructor() {
    super('Choose one way in: an invitation link or a temporary password — not both.', 'ONE_WAY_IN', 400);
  }
}

/**
 * One way in, from every caller. An invitation with a typed password (the live Android app's New user
 * screen sends both by default) becomes exactly an invitation — the safer way: the typed password is
 * ignored (never stored), and the answer and the audit log say so. A password made here together with
 * anything else can't be resolved that way and is refused (ONE_WAY_IN). The website never sends both.
 */
export function resolveWayIn<T extends WayIn>(b: T): T & { ignoredPassword: boolean } {
  if (b.generatePassword && (b.sendWelcome === true || !!b.password)) throw new OneWayInError();
  if (b.sendWelcome === true && b.password) return { ...b, password: undefined, ignoredPassword: true };
  return { ...b, ignoredPassword: false };
}

/** Said in the answer when a typed password was ignored for an invitation. */
export function ignoredPasswordMessage(welcome: { sent: boolean; why?: string } | null): string {
  if (welcome?.sent) return 'We sent an invitation link; the typed password wasn’t used (one way in).';
  return `The typed password wasn’t used (one way in), and the invitation couldn’t be sent${welcome?.why ? `: ${welcome.why}` : ''}. Resend it, or set a temporary password.`;
}

/** The audit entry for an ignored typed password (never its value). */
export const IGNORED_PASSWORD_AUDIT = { action: 'user.password.ignored', newValue: { note: 'temporary password ignored — invitation sent instead' } } as const;

const DAY_MS = 24 * 3600 * 1000;

/** The lifetime in days: this one's, else the setting's, else 7. */
export async function lifetimeDays(chosen: number | undefined, setting?: () => Promise<number>): Promise<number> {
  if (chosen !== undefined) return chosen;
  const fromSetting = setting ? await setting().catch(() => undefined) : undefined;
  return fromSetting ?? DEFAULT_INVITATION_DAYS;
}

/**
 * The temporary password for a new account or a reset, when that is the way in: a generated one (to
 * return once) or the typed one, with its mark (who, when, until when). Undefined: an invitation link.
 */
export async function temporaryPasswordFor(
  b: WayIn,
  opts: { setById: string | null; now?: Date; setting?: () => Promise<number> },
): Promise<{ password: string; generated: boolean; mark: TemporaryPasswordMark } | undefined> {
  const password = b.generatePassword ? generateTemporaryPassword(b.generatePassword) : b.password;
  if (!password) return undefined;
  const at = opts.now ?? new Date();
  const days = await lifetimeDays(b.inviteDays, opts.setting);
  return { password, generated: !!b.generatePassword, mark: { at, setById: opts.setById, expiresAt: new Date(at.getTime() + days * DAY_MS) } };
}
