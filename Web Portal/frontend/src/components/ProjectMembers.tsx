import { useState } from 'react';
import { Link } from 'react-router-dom';
import { FieldLabel } from './ui/Field';
import { Avatar } from './ui/Avatar';
import { TOUCH_SQUARE, TOUCH_TALL } from '../lib/touch';

export type ProjectMemberRole = 'MEMBER' | 'MANAGER';

export interface MemberRef {
  id: string;
  name: string;
  role: ProjectMemberRole;
  /** companies: false when they're in none of the project's companies any more (they can't see it). Missing: they can. */
  hasAccess?: boolean;
}

export interface ProjectMembersProps {
  members: MemberRef[];
  addableUsers: MemberRef[];
  canManage: boolean;
  onAdd: (userId: string) => void;
  onRemove: (userId: string) => void;
  /** Promote/demote a member (per-project manager grant, T2.7). */
  onSetRole?: (userId: string, role: ProjectMemberRole) => void;
  /** Project KPIs: where a member's performance opens (for whoever runs the project); none: no link. */
  performanceHref?: (userId: string) => string;
}

/** Per-project team management with manager grants (T9.3 / T2.7). */
export function ProjectMembers({ members, addableUsers, canManage, onAdd, onRemove, onSetRole, performanceHref }: ProjectMembersProps) {
  const [toAdd, setToAdd] = useState('');
  // Removing takes the person off the project at once: the first press asks, the second removes.
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const memberIds = new Set(members.map((m) => m.id));
  const addable = addableUsers.filter((u) => !memberIds.has(u.id));

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-1">
        {members.length === 0 ? (
          <li className="text-sm text-ink-2">No members yet.</li>
        ) : (
          members.map((m) => (
            <li key={m.id} className="flex min-h-[2.75rem] items-center gap-2 rounded-lg border border-line bg-surface px-3 py-1.5 text-sm">
              <Avatar name={m.name} size="sm" />
              <span dir="auto" className="min-w-0 truncate text-ink" title={m.name}>{m.name}</span>
              {m.role === 'MANAGER' ? (
                <span className="rounded-full bg-brand/10 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-brand">Manager</span>
              ) : null}
              {m.hasAccess === false ? (
                <span className="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
                  <span className="flex-none rounded-full bg-warning-soft px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-warning">No access</span>
                  <span className="text-xs text-ink-2">Not in any of this project’s companies any more.</span>
                </span>
              ) : null}
              {performanceHref ? (
                <Link to={performanceHref(m.id)} aria-label={`${m.name}: performance`} className={`ml-auto flex-none rounded px-1.5 text-xs font-medium text-ink-2 hover:bg-ground hover:text-brand ${TOUCH_TALL}`}>
                  Performance
                </Link>
              ) : null}
              {canManage && onSetRole ? (
                m.role === 'MANAGER' ? (
                  <button onClick={() => onSetRole(m.id, 'MEMBER')} aria-label={`Make ${m.name} a member`} className={`${performanceHref ? '' : 'ml-auto '}flex-none rounded px-1.5 text-xs font-medium text-ink-2 hover:bg-ground hover:text-brand ${TOUCH_TALL}`}>
                    Make member
                  </button>
                ) : (
                  <button onClick={() => onSetRole(m.id, 'MANAGER')} aria-label={`Make ${m.name} a manager`} className={`${performanceHref ? '' : 'ml-auto '}flex-none rounded px-1.5 text-xs font-medium text-ink-2 hover:bg-ground hover:text-brand ${TOUCH_TALL}`}>
                    Make manager
                  </button>
                )
              ) : null}
              {canManage ? (
                confirmRemove === m.id ? (
                  <span className={`${(canManage && onSetRole) || performanceHref ? '' : 'ml-auto'} flex flex-none items-center gap-1.5 text-xs`}>
                    <span className="text-ink-2">Remove?</span>
                    <button onClick={() => { setConfirmRemove(null); onRemove(m.id); }} className={`rounded px-1.5 py-0.5 font-semibold text-danger hover:bg-danger-soft ${TOUCH_TALL}`}>Yes, remove</button>
                    <button onClick={() => setConfirmRemove(null)} className={`rounded px-1.5 py-0.5 text-ink-2 hover:bg-ground ${TOUCH_TALL}`}>Keep</button>
                  </span>
                ) : (
                  <button
                    onClick={() => setConfirmRemove(m.id)}
                    aria-label={`Remove ${m.name}`}
                    className={`${(canManage && onSetRole) || performanceHref ? '' : 'ml-auto'} grid h-7 w-7 flex-none place-items-center rounded text-base text-ink-2 hover:bg-ground hover:text-danger ${TOUCH_SQUARE}`}
                  >
                    ×
                  </button>
                )
              ) : null}
            </li>
          ))
        )}
      </ul>

      {canManage && addable.length > 0 ? (
        <div className="flex flex-col gap-1">
          <FieldLabel htmlFor="add-member-select" required>
            Add a member
          </FieldLabel>
          <div className="flex items-center gap-2">
            <select
              id="add-member-select"
              required
              aria-required="true"
              value={toAdd}
              onChange={(e) => setToAdd(e.target.value)}
              className="h-10 min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 [@media(pointer:coarse)]:h-11"
            >
              <option value="">Select a teammate…</option>
              {addable.map((u) => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
            <button
              onClick={() => { if (toAdd) { onAdd(toAdd); setToAdd(''); } }}
              disabled={!toAdd}
              className="h-10 flex-none rounded-lg border border-line px-4 text-sm font-semibold text-brand hover:border-brand disabled:opacity-50 [@media(pointer:coarse)]:!h-11"
            >
              Add
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
