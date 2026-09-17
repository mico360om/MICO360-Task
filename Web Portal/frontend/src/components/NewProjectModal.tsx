import { useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../api/client';
import { projectsApi, projectStatusLabel, type ProjectStatus } from '../api/projects';
import { usersApi } from '../api/users';
import type { Priority } from '../api/tasks';
import { Button } from './ui/Button';
import { FieldLabel, fieldClass } from './ui/Field';
import { SearchableSelect } from './ui/SearchableSelect';
import { useDialog } from '../hooks/useDialog';

export interface NewProjectModalProps {
  onClose: () => void;
  onCreated?: () => void;
}

const STATUS_OPTIONS: { value: ProjectStatus; label: string }[] = (
  ['PLANNING', 'ACTIVE', 'ON_HOLD', 'COMPLETED'] as ProjectStatus[]
).map((s) => ({ value: s, label: projectStatusLabel(s) }));

const PRIORITY_OPTIONS: { value: Priority; label: string }[] = [
  { value: 'LOW', label: 'Low' },
  { value: 'NORMAL', label: 'Normal' },
  { value: 'HIGH', label: 'High' },
  { value: 'URGENT', label: 'Urgent' },
];

/** Admin dialog to create a new project (code, name, status, priority). */
export function NewProjectModal({ onClose, onCreated }: NewProjectModalProps) {
  const qc = useQueryClient();
  const dialogRef = useDialog(onClose);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [clientName, setClientName] = useState('');
  const [status, setStatus] = useState<ProjectStatus>('PLANNING');
  const [priority, setPriority] = useState<Priority>('NORMAL');
  const [ownerId, setOwnerId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const codeRef = useRef<HTMLInputElement>(null);

  const dirQ = useQuery({ queryKey: ['directory'], queryFn: () => usersApi(apiClient).directory() });
  const ownerOptions = [
    { value: '', label: 'No owner' },
    ...(Array.isArray(dirQ.data) ? dirQ.data : []).map((u) => ({ value: u.id, label: `${u.firstName} ${u.lastName}`.trim() || u.username, hint: `@${u.username}` })),
  ];

  const createMut = useMutation({
    mutationFn: () =>
      projectsApi(apiClient).create({
        code: code.trim().toUpperCase(),
        name: name.trim(),
        description: description.trim() || undefined,
        clientName: clientName.trim() || undefined,
        status,
        priority,
        ownerId: ownerId || null,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['projects'] });
      onCreated?.();
      onClose();
    },
    onError: () => setError('Couldn’t create the project. The code may already be in use.'),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!code.trim() || !name.trim()) {
      setError('A project code and name are both required.');
      codeRef.current?.focus();
      return;
    }
    createMut.mutate();
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4">
      <div className="absolute inset-0 bg-ink/40 animate-fade-in" onClick={onClose} aria-hidden="true" />
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="New project" className="card relative w-full max-w-md animate-scale-in p-6">
        <h2 className="mb-4 font-display text-xl font-bold text-ink">New project</h2>
        {error ? (
          <p role="alert" className="mb-3 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
            {error}
          </p>
        ) : null}
        <form onSubmit={submit} className="flex flex-col gap-3">
          <div className="grid grid-cols-3 gap-3">
            <div className="flex flex-col gap-1.5">
              <FieldLabel htmlFor="np-code" required>Code</FieldLabel>
              <input id="np-code" ref={codeRef} value={code} onChange={(e) => setCode(e.target.value)} maxLength={20} placeholder="MICO" className={fieldClass(false)} />
            </div>
            <div className="col-span-2 flex flex-col gap-1.5">
              <FieldLabel htmlFor="np-name" required>Name</FieldLabel>
              <input id="np-name" value={name} onChange={(e) => setName(e.target.value)} className={fieldClass(false)} />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <FieldLabel htmlFor="np-client">Client</FieldLabel>
            <input id="np-client" value={clientName} onChange={(e) => setClientName(e.target.value)} placeholder="Optional" className={fieldClass(false)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <FieldLabel htmlFor="np-desc">Description</FieldLabel>
            <textarea id="np-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="Optional" className={fieldClass(false)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <FieldLabel>Status</FieldLabel>
              <SearchableSelect ariaLabel="Status" options={STATUS_OPTIONS} value={status} onChange={(v) => setStatus(v as ProjectStatus)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <FieldLabel>Priority</FieldLabel>
              <SearchableSelect ariaLabel="Priority" options={PRIORITY_OPTIONS} value={priority} onChange={(v) => setPriority(v as Priority)} />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <FieldLabel>Owner</FieldLabel>
            <SearchableSelect ariaLabel="Project owner" placeholder="Choose an owner…" options={ownerOptions} value={ownerId} onChange={setOwnerId} />
            <p className="text-xs text-ink-2">New tasks in this project are assigned to the owner by default.</p>
          </div>
          <Button type="submit" loading={createMut.isPending}>
            {createMut.isPending ? 'Creating…' : 'Create project'}
          </Button>
          <button type="button" onClick={onClose} className="w-full rounded-lg py-2 text-sm font-medium text-ink-2 transition-colors hover:bg-ground">
            Cancel
          </button>
        </form>
      </div>
    </div>
  );
}
