import type { ReactNode } from 'react';
import { LEARNING_HUB_ICON, NAV_ICONS } from '../Sidebar';
import { Logo } from '../ui/Logo';

/**
 * An open book: Training's mark (the menu item, Learn this feature) and a module of no feature. Kept here (training-ui
 * passes it on) so the course cards there can draw a ModuleIcon without the two files importing each other.
 */
export const BOOK_PATHS = (
  <>
    <path d="M2 4.5h6a4 4 0 0 1 4 4V21a3 3 0 0 0-3-3H2z" />
    <path d="M22 4.5h-6a4 4 0 0 0-4 4V21a3 3 0 0 1 3-3h7z" />
  </>
);

/**
 * A module's feature as the left menu draws it (13 Nov new look): the menu's own icon object (`NAV_ICONS`, Sidebar's
 * `I`), never a copy. Admin settings is the settings cog, the Client portal the clients icon, the Learning Hub its cap;
 * `general` is the brand mark — given only to Getting started and the one course (`moduleKeyOf`, `courseIconKey`: any
 * other General module or course comes as null); anything else (a module an administrator added, "Other lessons") an
 * open book.
 */
const BY_KEY: Readonly<Record<string, ReactNode>> = {
  tasks: NAV_ICONS.tasks,
  board: NAV_ICONS.board,
  projects: NAV_ICONS.projects,
  calendar: NAV_ICONS.calendar,
  meetings: NAV_ICONS.meetings,
  chat: NAV_ICONS.chat,
  'mico-ai': NAV_ICONS.ai,
  reports: NAV_ICONS.reports,
  management: NAV_ICONS.management,
  admin: NAV_ICONS.settings,
  portal: NAV_ICONS.clients,
  training: LEARNING_HUB_ICON,
};

/** Decorative (aria-hidden): its words are always said beside it. */
export function ModuleIcon({ moduleKey, size = 20, className = '' }: { moduleKey: string | null; size?: number; className?: string }) {
  const common = { width: size, height: size, 'aria-hidden': true as const, focusable: 'false' as const, className: `flex-none ${className}`.trim(), 'data-module-icon': moduleKey ?? 'book' };
  if (moduleKey === 'general') {
    // The brand mark (its own colours), inside a hidden svg like every other module icon.
    return (
      <svg viewBox="0 0 24 24" {...common}>
        <Logo size={24} />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...common}>
      {(moduleKey && Object.prototype.hasOwnProperty.call(BY_KEY, moduleKey) ? BY_KEY[moduleKey] : null) ?? BOOK_PATHS}
    </svg>
  );
}
