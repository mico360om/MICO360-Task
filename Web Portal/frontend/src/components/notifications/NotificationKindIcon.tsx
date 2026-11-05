import type { ReactNode } from 'react';

/** Each notification type's icon and its name (said to screen readers before the title). */
interface KindLook {
  /** For tests and styling hooks (data-kind-icon). */
  id: string;
  name: string;
  /** The icon's tint, on a soft disc of the same colour. */
  tone: string;
  paths: ReactNode;
}

const SPARKLE = <><path d="M12 3l1.8 4.9L19 9.7l-5.2 1.8L12 16.4l-1.8-4.9L5 9.7l5.2-1.8z" /><path d="M19 15l.7 1.8 1.8.7-1.8.7L19 20l-.7-1.8-1.8-.7 1.8-.7z" /></>;

const LOOKS: Record<string, KindLook> = {
  MENTION: { id: 'mention', name: 'Mention', tone: 'text-brand bg-brand/10', paths: <><circle cx="12" cy="12" r="4" /><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8" /></> },
  CHAT_MENTION: { id: 'mention', name: 'Mention in chat', tone: 'text-brand bg-brand/10', paths: <><circle cx="12" cy="12" r="4" /><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8" /></> },
  TASK_ASSIGNED: { id: 'assigned', name: 'Assigned to you', tone: 'text-info bg-info-soft', paths: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M19 8v6M22 11h-6" /></> },
  TASK_DUE_SOON: { id: 'due', name: 'Due soon', tone: 'text-warning bg-warning-soft', paths: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></> },
  TASK_OVERDUE: { id: 'overdue', name: 'Overdue', tone: 'text-danger bg-danger-soft', paths: <><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /><path d="M12 9v4M12 17h.01" /></> },
  TASK_ESCALATION: { id: 'overdue', name: 'Escalation', tone: 'text-danger bg-danger-soft', paths: <><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /><path d="M12 9v4M12 17h.01" /></> },
  TASK_COMMENT: { id: 'comment', name: 'Comment', tone: 'text-info bg-info-soft', paths: <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /> },
  TASK_APPROVAL: { id: 'approval', name: 'Approval', tone: 'text-success bg-success-soft', paths: <><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><path d="m9 12 2 2 4-4" /></> },
  MEETING_REMINDER: { id: 'meeting', name: 'Meeting', tone: 'text-brand bg-brand/10', paths: <><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></> },
  TASK_STATUS: { id: 'status', name: 'Status change', tone: 'text-ink-2 bg-ground', paths: <><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></> },
  CHAT_MESSAGE: { id: 'message', name: 'Message', tone: 'text-info bg-info-soft', paths: <><path d="M14 9a2 2 0 0 1-2 2H6l-3 3V4a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2z" /><path d="M18 9h1a2 2 0 0 1 2 2v10l-3-3h-6a2 2 0 0 1-2-2v-1" /></> },
  PROJECT_ADDED: { id: 'project', name: 'Added to a project', tone: 'text-success bg-success-soft', paths: <><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.7-.9l-.8-1.2A2 2 0 0 0 7.9 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2z" /><path d="M12 10v6M9 13h6" /></> },
  TASK_DIGEST: { id: 'digest', name: 'Daily digest', tone: 'text-ink-2 bg-ground', paths: <><path d="M8 6h13M8 12h13M8 18h13" /><path d="M3 6h.01M3 12h.01M3 18h.01" /></> },
  // 1.22 (§10): AI work finished in the background — the minutes' AI draft, a MICO AI answer.
  AI_DRAFT_READY: { id: 'ai', name: 'AI draft ready', tone: 'text-brand bg-brand/10', paths: SPARKLE },
  AI_DRAFT_FAILED: { id: 'ai-failed', name: 'AI draft failed', tone: 'text-danger bg-danger-soft', paths: SPARKLE },
  MICO_AI_ANSWER: { id: 'ai', name: 'MICO AI answer', tone: 'text-brand bg-brand/10', paths: SPARKLE },
  MICO_AI_FAILED: { id: 'ai-failed', name: 'MICO AI couldn’t answer', tone: 'text-danger bg-danger-soft', paths: SPARKLE },
};
const OTHER: KindLook = { id: 'other', name: 'Notification', tone: 'text-ink-2 bg-ground', paths: <><path d="M18 8.5a6 6 0 1 0-12 0c0 6.5-2.5 7.5-2.5 7.5h17S18 15 18 8.5" /><path d="M10.3 20a2 2 0 0 0 3.4 0" /></> };

export function notificationKindLook(type: string): Pick<KindLook, 'id' | 'name'> {
  const look = LOOKS[type] ?? OTHER;
  return { id: look.id, name: look.name };
}

/** A notification's kind as a small round icon. Decorative: its name is said with the title. */
export function NotificationKindIcon({ type }: { type: string }) {
  const look = LOOKS[type] ?? OTHER;
  return (
    // 28px in compact rows (1.23.0, lib/density), as the faces in rows shrink.
    <span data-kind-icon={look.id} aria-hidden="true" className={`grid h-8 w-8 flex-none place-items-center rounded-full compact:h-7 compact:w-7 ${look.tone}`}>
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        {look.paths}
      </svg>
    </span>
  );
}
