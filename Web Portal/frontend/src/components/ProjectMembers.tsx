import { useState } from 'react';
import { FieldLabel } from './ui/Field';

export type ProjectMemberRole = 'MEMBER' | 'MANAGER';

export interface MemberRef {
  id: string;
  name: string;
  role: ProjectMemberRole;
}

export interface ProjectMembersProps {
  members: MemberRef[];
  addableUsers: MemberRef[];
  canManage: boolean;
  onAdd: (userId: string) => void;
  onRemove: (userId: string) => void;
  /** Promote/demote a member (per-project manager grant, T2.7). */
  onSetRole?: (userId: string, role: ProjectMemberRole) => void;
}

/** Per-project team management with manager grants (T9.3 / T2.7). */
export function ProjectMembers({ members, addableUsers, canManage, onAdd, onRemove, onSetRole }: ProjectMembersProps) {
  const [toAdd, setToAdd] = useState('');
  const memberIds = new Set(members.map((m) => m.id));
  const addable = addableUsers.filter((u) => !memberIds.has(u.id));

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-1">
        {members.length === 0 ? (
          <li className="text-sm text-ink-2">No members yet.</li>
        ) : (
          members.map((m) => (
            <li key={m.id} className="flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-1.5 text-sm">
              <span className="text-ink">{m.name}</span>
              {m.role === 'MANAGER' ? (
                <span className="rounded-full bg-brand/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand">Manager</span>
              ) : null}
              {canManage && onSetRole ? (
                m.role === 'MANAGER' ? (
                  <button onClick={() => onSetRole(m.id, 'MEMBER')} aria-label={`Make ${m.name} a member`} className="ml-auto text-xs font-medium text-ink-2 hover:text-brand">
                    Make member
                  </button>
                ) : (
                  <button onClick={() => onSetRole(m.id, 'MANAGER')} aria-label={`Make ${m.name} a manager`} className="ml-auto text-xs font-medium text-ink-2 hover:text-brand">
                    Make manager
                  </button>
                )
              ) : null}
              {canManage ? (
                <button
                  onClick={() => onRemove(m.id)}
                  aria-label={`Remove ${m.name}`}
                  className={`${canManage && onSetRole ? '' : 'ml-auto'} rounded px-1 text-ink-2 hover:bg-ground hover:text-danger`}
                >
                  ×
                </button>
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
              className="min-w-0 flex-1 rounded-md border border-line bg-surface px-2 py-1 text-sm text-ink"
            >
              <option value="">Select a teammate…</option>
              {addable.map((u) => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
            <button
              onClick={() => { if (toAdd) { onAdd(toAdd); setToAdd(''); } }}
              disabled={!toAdd}
              className="rounded-md border border-line px-3 py-1 text-sm font-medium text-brand hover:border-brand disabled:opacity-50"
            >
              Add
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
