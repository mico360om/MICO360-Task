import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '../components/ui/PageHeader';
import { Button } from '../components/ui/Button';
import { CreateUserModal } from '../components/CreateUserModal';
import { EditUserModal } from '../components/EditUserModal';
import { apiClient } from '../api/client';
import { usersApi, type ApiUser, type UserStatus } from '../api/users';
import { ApiError } from '../lib/api-client';
import { useAuthStore } from '../stores/auth-store';

const STATUS_TONE: Record<UserStatus, string> = {
  ACTIVE: 'bg-success-soft text-success',
  INACTIVE: 'bg-ground text-ink-2',
  SUSPENDED: 'bg-danger-soft text-danger',
};

/** The server's reason for a rejected change (e.g. "the last administrator can't be removed"), else our fallback. */
function reason(err: unknown, fallback: string): string {
  if (err instanceof ApiError && err.status >= 400 && err.status < 500 && err.message && !/^Request failed/.test(err.message)) return err.message;
  return fallback;
}

export function UsersPage() {
  const qc = useQueryClient();
  const meId = useAuthStore((s) => s.user?.id);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<ApiUser | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null);
  const q = useQuery({ queryKey: ['users'], queryFn: () => usersApi(apiClient).list() });
  const users = Array.isArray(q.data) ? q.data : [];
  const lockedCount = users.filter((u) => u.locked).length;

  const statusMut = useMutation({
    mutationFn: ({ id, status }: { id: string; status: UserStatus }) => usersApi(apiClient).setStatus(id, status),
    onSuccess: () => { setNotice(null); void qc.invalidateQueries({ queryKey: ['users'] }); },
    onError: (err) => setNotice({ text: reason(err, 'Couldn’t change the account status.'), error: true }),
  });
  const deleteMut = useMutation({
    mutationFn: (id: string) => usersApi(apiClient).remove(id),
    onSuccess: () => {
      setConfirmId(null);
      void qc.invalidateQueries({ queryKey: ['users'] });
    },
  });
  const unlockMut = useMutation({
    mutationFn: (u: ApiUser) => usersApi(apiClient).unlock(u.id),
    onSuccess: (_r, u) => {
      setNotice({ text: `${u.username} can sign in again.` });
      void qc.invalidateQueries({ queryKey: ['users'] });
    },
    onError: (err, u) => setNotice({ text: reason(err, `Couldn’t unlock ${u.username}.`), error: true }),
  });

  return (
    <div>
      <PageHeader
        eyebrow="Admin"
        title="User &amp; Profile Management"
        subtitle="Create and edit accounts, assign roles, control access, and reset passwords."
        actions={<Button onClick={() => setCreating(true)}>+ New user</Button>}
      />

      {notice ? (
        <div
          role={notice.error ? 'alert' : 'status'}
          className={`mb-4 flex items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm ${notice.error ? 'bg-danger-soft text-danger' : 'bg-success-soft text-success'}`}
        >
          <span>{notice.text}</span>
          <button onClick={() => setNotice(null)} aria-label="Dismiss" className="shrink-0 opacity-80 hover:opacity-100">✕</button>
        </div>
      ) : null}

      {lockedCount > 0 ? (
        <p className="mb-4 rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning">
          {lockedCount} account{lockedCount === 1 ? ' is' : 's are'} locked after too many failed sign-in attempts. Unlock {lockedCount === 1 ? 'it' : 'them'} below once you’ve checked it was the account owner.
        </p>
      ) : null}

      <div className="card overflow-x-auto">
        {q.isLoading ? (
          <p className="p-4 text-ink-2">Loading…</p>
        ) : q.isError ? (
          <p role="alert" className="p-4 text-danger">
            Couldn’t load users (admin only).{' '}
            <button type="button" onClick={() => void q.refetch()} className="font-semibold underline">Retry</button>
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-2">
                <th className="p-3">User</th>
                <th className="p-3">Email</th>
                <th className="p-3">Roles</th>
                <th className="p-3">Status</th>
                <th className="p-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const isSelf = u.id === meId;
                return (
                  <tr key={u.id} className="border-b border-line last:border-0">
                    <td className="p-3 font-medium text-ink">{u.username}</td>
                    <td className="p-3 text-ink-2">{u.email}</td>
                    <td className="p-3 text-ink-2">{u.roles.join(', ') || '—'}</td>
                    <td className="p-3">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${STATUS_TONE[u.status]}`}>{u.status}</span>
                        {u.locked ? (
                          <span className="rounded-md bg-warning-soft px-2 py-0.5 text-xs font-semibold text-warning" title="Locked after too many failed sign-in attempts">
                            🔒 Locked
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td className="p-3">
                      <div className="flex items-center justify-end gap-2">
                        {u.locked ? (
                          <button
                            onClick={() => unlockMut.mutate(u)}
                            disabled={unlockMut.isPending}
                            aria-label={`Unlock ${u.username}`}
                            className="rounded-lg border border-warning/40 px-2 py-1 text-xs font-semibold text-warning transition-colors hover:bg-warning-soft disabled:opacity-50"
                          >
                            Unlock
                          </button>
                        ) : null}
                        <button
                          onClick={() => setEditing(u)}
                          className="rounded-lg border border-line px-2 py-1 text-xs font-medium text-ink-2 transition-colors hover:border-brand/30 hover:bg-ground hover:text-ink"
                        >
                          Edit
                        </button>
                        <select
                          aria-label={`Status for ${u.username}`}
                          value={u.status}
                          disabled={isSelf || statusMut.isPending}
                          title={isSelf ? 'You can’t change your own status' : undefined}
                          onChange={(e) => statusMut.mutate({ id: u.id, status: e.target.value as UserStatus })}
                          className="rounded-lg border border-line bg-surface px-2 py-1 text-xs text-ink outline-none transition-colors focus:border-brand focus:ring-2 focus:ring-brand/20 disabled:opacity-50"
                        >
                          <option value="ACTIVE">Active</option>
                          <option value="INACTIVE">Inactive</option>
                          <option value="SUSPENDED">Suspended</option>
                        </select>
                        {confirmId === u.id ? (
                          <span className="flex items-center gap-1">
                            <button
                              onClick={() => deleteMut.mutate(u.id)}
                              disabled={deleteMut.isPending}
                              className="rounded-lg bg-danger px-2 py-1 text-xs font-semibold text-white hover:brightness-95 disabled:opacity-50"
                            >
                              {deleteMut.isPending ? 'Deleting…' : 'Confirm'}
                            </button>
                            <button onClick={() => { setConfirmId(null); deleteMut.reset(); }} className="rounded-lg px-2 py-1 text-xs text-ink-2 hover:bg-ground">
                              No
                            </button>
                            {deleteMut.isError ? (
                              <span role="alert" className="text-xs font-medium text-danger">{reason(deleteMut.error, 'Couldn’t delete. Try again.')}</span>
                            ) : null}
                          </span>
                        ) : (
                          <button
                            onClick={() => { deleteMut.reset(); setConfirmId(u.id); }}
                            disabled={isSelf}
                            title={isSelf ? 'You can’t delete your own account' : 'Delete user'}
                            className="rounded-lg border border-line px-2 py-1 text-xs text-danger transition-colors hover:bg-danger-soft disabled:opacity-40"
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {creating ? <CreateUserModal onClose={() => setCreating(false)} /> : null}
      {editing ? <EditUserModal user={editing} onClose={() => setEditing(null)} /> : null}
    </div>
  );
}
