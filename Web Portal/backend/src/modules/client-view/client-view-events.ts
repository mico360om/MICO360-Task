import type { CreateAuditData } from '../audit/audit-repository';
import type { ClientMinutesHidden } from '../meetings/prisma-meeting-repository';

type AuditSink = { record(entry: CreateAuditData): Promise<unknown> };

/**
 * A meeting re-filed under another project took its minutes off the old project's client page (the
 * meeting repository does it in the same write): the audit log says so. The move itself has no
 * person attached at that level, so the line is the system's.
 */
export function auditMinutesMovedAway(audit: AuditSink): (hidden: ClientMinutesHidden) => void {
  return (h) => {
    void audit
      .record({
        userId: null,
        ip: null,
        module: 'client-view',
        action: 'client-view.minutes.hidden',
        entityId: h.meetingId,
        newValue: { reason: 'moved', fromProjectId: h.fromProjectId, toProjectId: h.toProjectId },
      })
      .catch(() => undefined);
  };
}
