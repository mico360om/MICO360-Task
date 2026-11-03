/**
 * Companies: the rules the website, the Android app and the Chrome extension share about the
 * company picker. The app (`Android App/src/lib/companies.ts`) and the extension
 * (`Extension/src/companies.js`) keep copies of this file, checked by drift tests that read it, so
 * it imports nothing and changes only together with them.
 *
 * - The picker shows only for people with two or more companies ("All my companies" or one company).
 * - The pick goes with every request as `X-Company-Id`; absent = all my companies.
 * - A pick the server refuses (403 COMPANY_NOT_AVAILABLE) is cleared, with a notice.
 */

export const ALL_COMPANIES_LABEL = 'All my companies';
/** The per-person name the pick is saved under on this device. */
export const COMPANY_PICK_PREF = 'company.pick';
export const COMPANY_HEADER = 'X-Company-Id';
/** The server's code for a pick the person can no longer use. */
export const COMPANY_GONE_CODE = 'COMPANY_NOT_AVAILABLE';
export const ARCHIVED_NOTICE = 'Your company is archived — ask an administrator.';

export interface CompanyLike {
  id: string;
  name: string;
}

/** The picker shows only for two or more companies; with one, nothing changes. */
export function showCompanyPicker(companies: readonly CompanyLike[]): boolean {
  return companies.length >= 2;
}

/** The pick if it is one of my companies, else null ("All my companies"). */
export function validPick(pick: string | null, companies: readonly CompanyLike[]): string | null {
  return pick !== null && companies.some((c) => c.id === pick) ? pick : null;
}

/** The request headers for a pick: none for "All my companies". */
export function companyHeaders(pick: string | null): Record<string, string> {
  return pick ? { [COMPANY_HEADER]: pick } : {};
}

/** The picker button's words: the picked company's name, else "All my companies". */
export function pickLabel(pick: string | null, companies: readonly CompanyLike[]): string {
  return companies.find((c) => c.id === pick)?.name ?? ALL_COMPANIES_LABEL;
}

/**
 * The company whose settings a page uses: the picked one, else the person's primary company, else
 * their only company, else none (the site's settings). Only companies in the list count.
 */
export function effectiveCompanyId(pick: string | null, companies: readonly CompanyLike[], primaryId: string | null): string | null {
  const picked = validPick(pick, companies);
  if (picked) return picked;
  if (primaryId !== null && companies.some((c) => c.id === primaryId)) return primaryId;
  return companies.length === 1 ? companies[0]!.id : null;
}

/** The notice shown when a picked company was taken away. */
export function pickGoneNotice(name: string | null): string {
  return `You no longer have access to ${name ?? 'that company'}. Showing all your companies.`;
}

/** Is this the server refusing the picked company? */
export function isCompanyGone(err: { status?: number; code?: string } | null | undefined): boolean {
  return err?.status === 403 && err.code === COMPANY_GONE_CODE;
}

/** A key part that names the scope a list was read in. */
export function scopeKey(pick: string | null): string {
  return pick ?? 'all';
}
