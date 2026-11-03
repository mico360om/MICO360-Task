import { useId, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../api/client';
import type { CompanyPeopleChange } from '../../api/companies';
import { usersApi } from '../../api/users';
import { useDialog } from '../../hooks/useDialog';
import { Button } from '../ui/Button';
import { FieldLabel, fieldClass } from '../ui/Field';
import { ModalPortal } from '../ui/ModalPortal';
import { peopleCount, problemText, refreshCompanies, useCompanyChoices } from './company-admin';

export interface BulkCompanyDialogProps {
  mode: 'add' | 'remove';
  /** The people ticked on User Management. */
  userIds: string[];
  onClose: () => void;
  /** Sent: how many changed, and who couldn't be (with why). */
  onDone: (result: CompanyPeopleChange) => void;
}

/**
 * User Management's bulk assign: "Add 3 people to a company" (an active one) or "Remove 3 people
 * from a company" (any, archived ones too). The server changes each person on their own and says
 * who it couldn't change, and why (an employee keeps at least one company).
 */
export function BulkCompanyDialog({ mode, userIds, onClose, onDone }: BulkCompanyDialogProps) {
  const qc = useQueryClient();
  const fieldId = useId();
  const { companies } = useCompanyChoices(2);
  const offered = mode === 'add' ? companies.filter((c) => c.status === 'ACTIVE') : companies;
  const [companyId, setCompanyId] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const title = mode === 'add' ? `Add ${peopleCount(userIds.length)} to a company` : `Remove ${peopleCount(userIds.length)} from a company`;

  const mut = useMutation({
    mutationFn: (id: string) => usersApi(apiClient).assignCompanies({ userIds, ...(mode === 'add' ? { addCompanyIds: [id] } : { removeCompanyIds: [id] }) }),
    onSuccess: (result) => {
      refreshCompanies(qc);
      onDone(result);
    },
    onError: (err) => setProblem(problemText(err, 'Couldn’t change their companies. Please try again.')),
  });
  // While it is being sent, Escape and the backdrop keep it open (as ConfirmDialog does).
  const dialogRef = useDialog(mut.isPending ? () => {} : onClose);

  function send() {
    setProblem(null);
    // The server's words when no company is chosen.
    if (!companyId) return setProblem('Choose a company to add or remove.');
    mut.mutate(companyId);
  }

  return (
    <ModalPortal>
      <div className="fixed inset-0 z-50 grid place-items-center p-4">
        <div className="absolute inset-0 bg-scrim animate-fade-in" onClick={mut.isPending ? undefined : onClose} aria-hidden="true" />
        <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={`${fieldId}-title`} className="card relative w-full max-w-sm animate-scale-in p-5">
          <h2 id={`${fieldId}-title`} className="font-display text-lg font-semibold text-ink">{title}</h2>
          {problem ? <p role="alert" className="mt-3 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{problem}</p> : null}
          <div className="mt-4 flex flex-col gap-1.5">
            <FieldLabel htmlFor={fieldId}>Company</FieldLabel>
            <select id={fieldId} value={companyId} onChange={(e) => setCompanyId(e.target.value)} className={fieldClass(false, '[@media(pointer:coarse)]:min-h-11')}>
              <option value="">Choose a company</option>
              {offered.map((c) => (
                <option key={c.id} value={c.id}>{c.status === 'ARCHIVED' ? `${c.name} (archived)` : c.name}</option>
              ))}
            </select>
          </div>
          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="secondary" onClick={onClose} disabled={mut.isPending} shortcut="cancel">Cancel</Button>
            <Button variant={mode === 'add' ? 'primary' : 'danger'} onClick={send} loading={mut.isPending}>{mode === 'add' ? 'Add' : 'Remove'}</Button>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}
