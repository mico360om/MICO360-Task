import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '../components/ui/PageHeader';
import { Button } from '../components/ui/Button';
import { CreateUserModal } from '../components/CreateUserModal';
import { EditUserModal } from '../components/EditUserModal';
import { apiClient } from '../api/client';
import { usersApi, type ApiUser, type UserStatus } from '../api/users';
import { useAuthStore } from '../stores/auth-store';

const STATUS_TONE: Record<UserStatus, string> = {
  ACTIVE: 'bg-success-soft text-success',
  INACTIVE: 'bg-ground text-ink-2',
  SUSPENDED: 'bg-danger-soft text-danger',
};

export function UsersPage() {
  const qc = useQueryClient();
  const meId = useAuthStore((s) => s.user?.id);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<ApiUser | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['users'], queryFn: () => usersApi(apiClient).list() });
  const users = q.data ?? [];

  const statusMut = useMutation({
    mutationFn: ({ id, status }: { id: string; status: UserStatus }) => usersApi(apiClient).setStatus(id, status),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });
  const deleteMut = useMutation({
    mutationFn: (id: string) => usersApi(apiClient).remove(id),
    onSuccess: () => {
      setConfirmId(null);
      qc.invalidateQueries({ queryKey: ['users'] });
    },
  });

  return (
    <div>
      <PageHeader
        eyebrow="Admin"
        title="User &amp; Profile Management"
        subtitle="Create and edit accounts, assign roles, control access, and reset passwords."
        actions={<Button onClick={() => setCreating(true)}>+ New user</Button>}
      />
      <div className="card overflow-x-auto">
        {q.isLoading ? (
          <p className="p-4 text-ink-2">Loading…</p>
        ) : q.isError ? (
          <p role="alert" className="p-4 text-danger">Couldn’t load users (admin only).</p>
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
                      <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${STATUS_TONE[u.status]}`}>{u.status}</span>
                    </td>
                    <td className="p-3">
                      <div className="flex items-center justify-end gap-2">
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
                              <span role="alert" className="text-xs font-medium text-danger">Couldn’t delete. Try again.</span>
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
