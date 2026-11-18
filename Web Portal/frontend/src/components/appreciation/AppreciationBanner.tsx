import { useRef, useState } from 'react';
import { useCompanyTimeZone } from '../../lib/company-clock';
import { Link } from 'react-router-dom';
import { themeGradient } from '../../lib/appreciation';
import type { ApiAppreciation } from '../../api/appreciations';
import { AppreciationIconSvg, CompanyMark } from './AppreciationArt';
import { AcceptNoteDialog } from './AcceptNote';

/** "09:14" in the company time zone (as My appreciations and the history say it). */
const timeWords = (iso: string, timeZone: string) => new Date(iso).toLocaleTimeString('en-GB', { timeZone, hour: '2-digit', minute: '2-digit' });

/**
 * Employee Appreciation (1.24.0): the Dashboard's banner on the day — the newest of today's appreciations, with
 * the message, who sent it and the template's icon; "Accept" while it isn't accepted (also after closing the
 * popup), "Accepted" after. Nothing at all for anyone without an appreciation today (the Dashboard is unchanged).
 * 1.24.1: "Accept" opens a small window with the optional note for the manager.
 */
export function AppreciationBanner({ a, more, onAccept, problem }: { a: ApiAppreciation; more: number; onAccept: (id: string, note?: string | null) => Promise<boolean>; problem: string | null }) {
  const [asking, setAsking] = useState(false);
  const timeZone = useCompanyTimeZone();
  // After Accept the button becomes words: focus moves to the banner's heading rather than being lost.
  const heading = useRef<HTMLHeadingElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  return (
    <section
      aria-labelledby="appreciation-banner-title"
      data-appreciation-banner={a.id}
      data-theme-name={a.theme}
      className="relative overflow-hidden rounded-2xl px-5 py-4 text-white shadow-soft animate-fade-in-up sm:px-6"
      style={{ backgroundImage: themeGradient(a.theme) }}
    >
      {a.animation === 'shimmer' ? <span className="appreciation-shimmer" aria-hidden="true" /> : null}
      <div className="relative flex flex-wrap items-start gap-4">
        <CompanyMark company={a.company} />
        <div className="min-w-0 flex-1 basis-60">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-white/90">
            <AppreciationIconSvg icon={a.icon} size={14} />
            You’ve been appreciated
          </p>
          <h2 ref={heading} tabIndex={-1} id="appreciation-banner-title" dir="auto" className="mt-0.5 outline-none font-display text-xl font-extrabold tracking-tightish">
            {a.title}
          </h2>
          <p dir="auto" className="mt-1 whitespace-pre-line text-sm text-white">
            {a.message}
          </p>
          <p className="mt-1.5 text-xs text-white/90">
            From <bdi className="font-semibold">{a.sender.name}</bdi>
            {more > 0 ? (
              <>
                {' · '}
                <Link to="/appreciations/mine" className="font-semibold underline underline-offset-2 focus-visible:outline-white">
                  {more} more today
                </Link>
              </>
            ) : null}
          </p>
          {problem ? (
            <p role="alert" className="mt-2 rounded-lg bg-white px-3 py-1.5 text-sm text-danger">
              {problem}
            </p>
          ) : null}
        </div>
        <div className="flex flex-none items-center self-center">
          {a.acceptedAt ? (
            <span data-accepted role="status" className="inline-flex items-center gap-1.5 rounded-xl bg-white/15 px-3 py-2 text-sm font-semibold">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M5 12.5l4.5 4.5L19 7.5" />
              </svg>
              Accepted {timeWords(a.acceptedAt, timeZone)}
            </span>
          ) : (
            <button
              ref={button}
              type="button"
              aria-haspopup="dialog"
              onClick={() => setAsking(true)}
              className="inline-flex !min-h-[44px] items-center rounded-xl bg-white px-4 py-2 text-sm font-semibold text-[#1F1A19] shadow-soft transition-all hover:-translate-y-0.5 hover:shadow-lift focus-visible:outline-white disabled:opacity-70"
            >
              Accept
            </button>
          )}
        </div>
      </div>
      {asking && !a.acceptedAt ? (
        <AcceptNoteDialog
          a={a}
          onClose={() => {
            setAsking(false);
            window.setTimeout(() => button.current?.focus(), 0);
          }}
          onAccept={async (note) => {
            const ok = await onAccept(a.id, note);
            setAsking(false);
            if (ok) window.setTimeout(() => heading.current?.focus(), 0);
          }}
        />
      ) : null}
    </section>
  );
}
