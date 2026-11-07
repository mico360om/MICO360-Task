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

/** Both ways at once are refused, from every caller (the website, the Android app, the API). */
export function checkOneWayIn(b: WayIn): void {
  const ways = [b.sendWelcome === true, !!b.password, !!b.generatePassword].filter(Boolean).length;
  if (ways > 1) throw new OneWayInError();
}

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
