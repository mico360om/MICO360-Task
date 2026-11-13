import { useRef, type KeyboardEvent } from 'react';
import { Link } from 'react-router-dom';
import { useTrainingAccess } from './training-queries';

/**
 * The Learning Hub's tabs (owner, 11 Nov night: one page look): My learning and All courses for everyone; Manage (the
 * courses, assignments, onboarding rules, feedback, certificates and settings) for administrators and Training managers;
 * Reports for them and for people who run a project (their team's). Real links (each tab has its own address), the open
 * one marked; arrow keys, Home and End move along them. On a phone the row scrolls inside itself, never the page.
 */
export type HubTab = 'mine' | 'catalogue' | 'manage' | 'reports';

interface HubLink {
  key: HubTab;
  label: string;
  to: string;
}

const MINE: HubLink = { key: 'mine', label: 'My learning', to: '/training' };
const CATALOGUE: HubLink = { key: 'catalogue', label: 'All courses', to: '/training?tab=catalogue' };
const MANAGE: HubLink = { key: 'manage', label: 'Manage', to: '/training/manage' };
const REPORTS: HubLink = { key: 'reports', label: 'Reports', to: '/training/manage?tab=reports' };

/** The tabs this person has (before the server answers: the two everyone has). */
export function hubTabs(access: { manager?: boolean; teamReports?: boolean } | undefined): HubLink[] {
  const manager = access?.manager === true;
  return [MINE, CATALOGUE, ...(manager ? [MANAGE] : []), ...(manager || access?.teamReports === true ? [REPORTS] : [])];
}

export function LearningHubTabs({ current }: { current: HubTab | null }) {
  const tabs = hubTabs(useTrainingAccess().data);
  const links = useRef(new Map<HubTab, HTMLAnchorElement>());

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft' && e.key !== 'Home' && e.key !== 'End') return;
    const at = tabs.findIndex((t) => links.current.get(t.key) === document.activeElement);
    if (at < 0) return;
    e.preventDefault();
    const n = tabs.length;
    const to = e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : (at + (e.key === 'ArrowRight' ? 1 : -1) + n) % n;
    links.current.get(tabs[to]!.key)?.focus();
  };

  return (
    <nav aria-label="Learning Hub" onKeyDown={onKeyDown} className="-mb-px flex min-w-0 gap-1 overflow-x-auto border-b border-line">
      {tabs.map((t) => {
        const here = t.key === current;
        return (
          <Link
            key={t.key}
            ref={(el) => {
              if (el) links.current.set(t.key, el);
              else links.current.delete(t.key);
            }}
            to={t.to}
            aria-current={here ? 'page' : undefined}
            data-hub-tab={t.key}
            className={`inline-flex !min-h-[44px] flex-none items-center whitespace-nowrap border-b-2 px-4 py-2 text-sm font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand/40 ${
              here ? 'border-brand text-brand' : 'border-transparent text-ink-2 hover:text-ink'
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
