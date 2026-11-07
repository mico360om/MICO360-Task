import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../api/client';
import { systemSettingsApi } from '../../api/system-settings';
import type { TemporaryPasswordStyle } from '../../api/users';
import { DEFAULT_INVITATION_DAYS, INVITATION_DAY_CHOICES, lifetimeText } from '../../lib/onboarding';
import { fieldClass } from '../ui/Field';
import { Button } from '../ui/Button';

/**
 * 1.23.6 Invitation & temporary password security, the website's pieces: how long an invitation (or
 * an unused temporary password) lasts, which kind of temporary password to make, and the one-time
 * view of a made password (Copy, New one) — the only time anyone sees it.
 */

/** System Settings → Accounts, "Invitation links last" (7 days until an administrator changes it). */
export function useInvitationDays(): number {
  const q = useQuery({ queryKey: ['system-settings'], queryFn: () => systemSettingsApi(apiClient).list(), staleTime: 60_000 });
  const v = Array.isArray(q.data) ? q.data.find((s) => s.key === 'accounts.invitationDays')?.value : undefined;
  return typeof v === 'number' && (INVITATION_DAY_CHOICES as readonly number[]).includes(v) ? v : DEFAULT_INVITATION_DAYS;
}

/** "Lasts: 1 day · 3 days · 7 days · 14 days" as a select. */
export function LifetimeSelect({ id, value, onChange, describedBy, disabled }: { id: string; value: number; onChange: (days: number) => void; describedBy?: string; disabled?: boolean }) {
  return (
    <select id={id} value={value} onChange={(e) => onChange(Number(e.target.value))} aria-describedby={describedBy} disabled={disabled} className={`${fieldClass(false)} [@media(pointer:coarse)]:min-h-11`}>
      {INVITATION_DAY_CHOICES.map((d) => (
        <option key={d} value={d}>
          {lifetimeText(d)}
        </option>
      ))}
    </select>
  );
}

const STYLES: { value: TemporaryPasswordStyle; label: string; hint: string }[] = [
  { value: 'words', label: 'Four words and a number', hint: 'Easy to read out, like Kite-Mango-Ripple-Fern-472' },
  { value: 'characters', label: '16 characters', hint: 'Letters and digits, nothing that looks alike' },
];

/** Which kind of temporary password to make. */
export function StyleChoice({ name, value, onChange, disabled }: { name: string; value: TemporaryPasswordStyle; onChange: (s: TemporaryPasswordStyle) => void; disabled?: boolean }) {
  return (
    <fieldset className="flex flex-col gap-1.5" aria-describedby={`${name}-hint`}>
      <legend className="mb-1 text-sm font-medium text-ink">Kind of password</legend>
      <div className="flex flex-wrap gap-2">
        {STYLES.map((s) => (
          <label
            key={s.value}
            className={`inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm font-medium focus-within:ring-2 focus-within:ring-brand/40 sm:min-h-9 [@media(pointer:coarse)]:min-h-11 ${value === s.value ? 'border-brand bg-brand/10 text-brand' : 'border-line text-ink hover:bg-ground'}`}
          >
            <input type="radio" name={name} value={s.value} checked={value === s.value} onChange={() => onChange(s.value)} disabled={disabled} className="accent-[rgb(var(--c-brand))]" />
            {s.label}
          </label>
        ))}
      </div>
      <p id={`${name}-hint`} className="text-xs text-ink-2">
        {STYLES.find((s) => s.value === value)?.hint}
      </p>
    </fieldset>
  );
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function dayOf(iso: string, timeZone: string): string {
  const p = new Intl.DateTimeFormat('en-US', { timeZone, month: 'numeric', day: 'numeric' }).formatToParts(new Date(iso));
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? '';
  return `${Number(get('day'))} ${MONTHS[Number(get('month')) - 1] ?? ''}`;
}

/**
 * The made password, once: big and selectable, Copy, and (optionally) "New one". Never kept by the page
 * after it closes; never sent anywhere but the clipboard.
 */
export function TemporaryPasswordReveal({
  idPrefix,
  password,
  personName,
  expiresAt,
  timeZone,
  onNewOne,
  renewing,
}: {
  idPrefix: string;
  password: string;
  personName: string;
  expiresAt: string | null;
  timeZone: string;
  onNewOne?: () => void;
  renewing?: boolean;
}) {
  const [copied, setCopied] = useState<'yes' | 'no' | null>(null);
  async function copy() {
    try {
      await navigator.clipboard.writeText(password);
      setCopied('yes');
    } catch {
      setCopied('no');
    }
  }
  return (
    <section aria-labelledby={`${idPrefix}-title`} data-temporary-password className="flex flex-col gap-3 rounded-xl border border-brand/40 bg-brand/5 p-4">
      <h3 id={`${idPrefix}-title`} className="text-sm font-semibold text-ink">
        Temporary password for {personName}
      </h3>
      <p
        id={`${idPrefix}-value`}
        data-password-value
        aria-label="Temporary password"
        className="select-all break-all rounded-lg border border-line bg-surface px-3 py-2.5 text-center font-mono text-lg font-semibold tracking-wide text-ink"
        translate="no"
      >
        {password}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={() => void copy()} aria-describedby={`${idPrefix}-value`} className="[@media(pointer:coarse)]:!min-h-11">
          Copy
        </Button>
        {onNewOne ? (
          <Button type="button" variant="ghost" size="sm" onClick={() => { setCopied(null); onNewOne(); }} loading={renewing} className="[@media(pointer:coarse)]:!min-h-11">
            New one
          </Button>
        ) : null}
        <span role="status" className="self-center text-xs text-ink-2">
          {copied === 'yes' ? 'Copied.' : copied === 'no' ? 'Couldn’t copy — select it and copy it yourself.' : ''}
        </span>
      </div>
      <p className="text-xs text-ink-2">
        Give it to them yourself — not by email. {expiresAt ? `It works until ${dayOf(expiresAt, timeZone)}; ` : ''}at their first sign-in they choose their own. You
        won’t see it again after you close this.
      </p>
    </section>
  );
}
