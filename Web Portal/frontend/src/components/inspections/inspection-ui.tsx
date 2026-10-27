import type { ReactNode } from 'react';
import type { ItemResult } from '../../lib/inspection-rules';

/** Small shared pieces of the inspection screens: result chips, dates, icons. */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function parts(iso: string, timeZone: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  let f: Intl.DateTimeFormat;
  try {
    f = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  } catch {
    f = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  }
  return Object.fromEntries(f.formatToParts(d).map((p) => [p.type, p.value])) as Record<string, string>;
}

/** "27 Oct 2026" in the company's time zone. */
export function dayText(iso: string | null | undefined, timeZone: string): string {
  const p = iso ? parts(iso, timeZone) : null;
  return p ? `${Number(p.day)} ${MONTHS[Number(p.month) - 1]} ${p.year}` : '';
}

/** "27 Oct 2026, 14:05" in the company's time zone. */
export function dateTimeText(iso: string | null | undefined, timeZone: string): string {
  const p = iso ? parts(iso, timeZone) : null;
  return p ? `${Number(p.day)} ${MONTHS[Number(p.month) - 1]} ${p.year}, ${p.hour}:${p.minute}` : '';
}

/** 'YYYY-MM-DD' → "27 Oct 2026" (a calendar day, never shifted). */
export function calendarDayText(key: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(key);
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : key;
}

const ICON = { width: 14, height: 14, fill: 'none', stroke: 'currentColor', strokeWidth: 2.2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

export const InspectIcon = {
  pass: (
    <svg viewBox="0 0 24 24" {...ICON} aria-hidden="true">
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </svg>
  ),
  fail: (
    <svg viewBox="0 0 24 24" {...ICON} aria-hidden="true">
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  ),
  na: (
    <svg viewBox="0 0 24 24" {...ICON} aria-hidden="true">
      <path d="M6 12h12" />
    </svg>
  ),
  clipboard: (
    <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="5" y="4" width="14" height="17" rx="2" />
      <path d="M9 4V3h6v1M9 11l2 2 4-4M9 17h6" />
    </svg>
  ),
  phone: (
    <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="7" y="2.5" width="10" height="19" rx="2" />
      <path d="M11 18.5h2" />
    </svg>
  ),
  cloud: (
    <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M7 18a4.5 4.5 0 0 1-.4-9A6 6 0 0 1 18 9.5a4 4 0 0 1-.5 8.5z" />
      <path d="m9.5 13.5 2 2 3.5-3.5" />
    </svg>
  ),
  alert: (
    <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3 2 20h20L12 3z" />
      <path d="M12 10v4M12 17.5v.01" />
    </svg>
  ),
  download: (
    <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 4v11m0 0-4-4m4 4 4-4M5 19h14" />
    </svg>
  ),
};

const RESULT_STYLE: Record<ItemResult, { text: string; cls: string; icon: ReactNode }> = {
  PASS: { text: 'Pass', cls: 'bg-success-soft text-success', icon: InspectIcon.pass },
  FAIL: { text: 'Fail', cls: 'bg-danger-soft text-danger', icon: InspectIcon.fail },
  NA: { text: 'N/A', cls: 'bg-ground text-ink-2', icon: InspectIcon.na },
};

/** A result in words with its own mark (never colour alone): ✓ Pass, ✕ Fail, – N/A. */
export function ResultChip({ result, className = '' }: { result: ItemResult | null; className?: string }) {
  if (!result) return <span className={`inline-flex items-center rounded-md bg-ground px-1.5 py-0.5 text-xs font-medium text-ink-3 ${className}`}>Not answered</span>;
  const s = RESULT_STYLE[result];
  return (
    <span className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-bold uppercase tracking-wide ${s.cls} ${className}`}>
      {s.icon}
      {s.text}
    </span>
  );
}

/** "Passed" / "2 failed" / "In progress" as a badge-like pill. */
export function OutcomePill({ status, failed, result }: { status: 'IN_PROGRESS' | 'FINISHED'; failed: number; result: string }) {
  if (status === 'IN_PROGRESS') return <span className="inline-flex items-center rounded-md bg-info-soft px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-info">In progress</span>;
  const bad = failed > 0;
  return (
    <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${bad ? 'bg-danger-soft text-danger' : 'bg-success-soft text-success'}`}>
      {bad ? InspectIcon.fail : InspectIcon.pass}
      {result}
    </span>
  );
}

/** The words of a refused request (the server's, unless they are the generic fallback). */
export function problemText(err: unknown, fallback: string): string {
  const m = err && typeof err === 'object' && 'message' in err ? String((err as { message: unknown }).message) : '';
  return m && !/^Request failed/.test(m) && !/Failed to fetch|NetworkError|Network request failed/i.test(m) ? m : fallback;
}

/** What became of follow-up tasks asked for, item by item, in the form's order. */
export function followUpNotice(report: Array<{ itemId: string; status: 'created' | 'exists' | 'pending' | 'not-failed'; taskKey: string | null }>, order: Array<{ id: string; label: string }>): string {
  const at = new Map(order.map((i, n) => [i.id, n]));
  const sorted = [...report].sort((a, b) => (at.get(a.itemId) ?? 1e9) - (at.get(b.itemId) ?? 1e9));
  if (!sorted.length) return '';
  if (sorted.every((r) => r.status === 'created')) {
    const keys = sorted.map((r) => r.taskKey).filter(Boolean).join(', ');
    return sorted.length === 1 ? `Follow-up task made${keys ? `: ${keys}` : ''}.` : `${sorted.length} follow-up tasks made${keys ? `: ${keys}` : ''}.`;
  }
  const label = (id: string) => order.find((i) => i.id === id)?.label ?? 'An item';
  const what = (r: (typeof sorted)[number]) =>
    r.status === 'created'
      ? `made${r.taskKey ? ` (${r.taskKey})` : ''}`
      : r.status === 'exists'
        ? `already had one${r.taskKey ? ` (${r.taskKey})` : ''}`
        : r.status === 'pending'
          ? 'already being made'
          : 'not made, it no longer fails';
  return `Follow-up tasks: ${sorted.map((r) => `${label(r.itemId)}: ${what(r)}.`).join(' ')}`;
}
