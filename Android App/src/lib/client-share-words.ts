import { instantDayText } from './day-words';
import { relativeTime } from './relative-time';
import type { ClientShare } from './client-share';

/**
 * The Share with client panel's words (the website's `ClientSharePanel.tsx`, verbatim) and its small
 * rules: the add form's checks, the notices, and each client's "last looked" line.
 */
export const SHARE_WORDS = {
  title: 'Share with client',
  intro1: 'A client follows this project on a private, read-only page. Their link opens only with a code we email to them.',
  intro2: 'They see the project’s progress and timeline, and only what is marked “Show to client”:',
  sees1: 'milestones and tasks: the title, status and due date, and “Late” once one is past its due date and not done;',
  sees2: 'approved meeting minutes: as written, without who owns each next step;',
  sees3: 'inspection reports: the results, the inspector’s notes on each item, and the signatures with the signers’ names — the inspector’s too.',
  never: 'They never see the team or who is assigned, comments, files, task descriptions or the notes taken in meetings.',
  archived:
    'This project is archived, so its client page is closed and it can’t be shared. You can still remove clients; if the project is reopened, the clients still listed here can view it again.',
  name: 'Client’s name',
  email: 'Email address',
  share: 'Share',
  emailOff: 'Email isn’t set up on this server, so a client could never get their code. Ask an administrator to set up email first.',
  nameMissing: 'Enter the client’s name.',
  emailInvalid: 'Enter a valid email address.',
  clients: 'Clients',
  resendExplains: 'Resend emails a new link. The old link stops working, and devices signed in with it are signed out.',
  loading: 'Loading…',
  loadFailed: 'Couldn’t load the clients.',
  retry: 'Retry',
  none: 'Not shared with anyone yet.',
  notViewed: 'Not viewed yet',
  resend: 'Resend',
  resendTo: 'Resend the link to {name}',
  remove: 'Remove',
  removeWho: 'Remove {name}',
  removeTitle: 'Remove {name}’s access?',
  removeBody: 'Their link stops working, and any device signed in to the page is signed out at once. You can share with them again later.',
  removeConfirm: 'Remove access',
  removeKeep: 'Keep access',
  addFailed: 'Couldn’t share the project. Please try again.',
  resendFailed: 'Couldn’t send a new link. Please try again.',
  removeFailed: 'Couldn’t remove their access. Please try again.',
} as const;

/** The project header's action: what TalkBack says for it (the website's title). */
export const SHARE_ACTION_LABEL = 'Share this project with a client (read-only)';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The add form's check, as the website's (name first, then the address). */
export function checkShare(name: string, email: string): { field: 'name' | 'email'; message: string } | null {
  if (!name.trim()) return { field: 'name', message: SHARE_WORDS.nameMissing };
  if (!EMAIL.test(email.trim())) return { field: 'email', message: SHARE_WORDS.emailInvalid };
  return null;
}

/** What the panel says after a change. */
export function shareNotice(kind: 'added' | 'resent' | 'removed', s: { name: string; email: string }): string {
  if (kind === 'added') return `Invitation sent to ${s.email}.`;
  if (kind === 'resent') return `A new link was sent to ${s.email}. The old link no longer works, and devices signed in with it were signed out.`;
  return `${s.name} can no longer view this project.`;
}

/** "Last viewed 3h ago" / "Not viewed yet", then " · Link sent 30 Oct 2026" (the company's day). */
export function shareSeen(s: ClientShare, timeZone: string, now: number = Date.now()): string {
  const seen = s.lastViewedAt ? `Last viewed ${relativeTime(s.lastViewedAt, now, timeZone)}` : SHARE_WORDS.notViewed;
  const sent = s.linkSentAt ? instantDayText(s.linkSentAt, timeZone) : '';
  return sent ? `${seen} · Link sent ${sent}` : seen;
}

/** The remove dialog's title. */
export const removeTitle = (name: string): string => SHARE_WORDS.removeTitle.replace('{name}', name);
