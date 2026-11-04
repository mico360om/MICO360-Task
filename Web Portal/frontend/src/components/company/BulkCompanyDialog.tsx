import { useId, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../api/client';
import type { CompanyPeopleChange } from '../../api/companies';
import { usersApi } from '../../api/users';
import { useDialog } from '../../hooks/useDialog';
import { Button } from '../ui/Button';
import { ModalPortal } from '../ui/ModalPortal';
import { dialogLayer, dialogPanel } from '../ui/dialog-size';
import { CompanyTickList } from './CompanyTickList';
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
      <div className={dialogLayer('small')}>
        <div className="absolute inset-0 bg-scrim animate-fade-in" onClick={mut.isPending ? undefined : onClose} aria-hidden="true" />
        <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={`${fieldId}-title`} className={`card relative flex ${dialogPanel('small')} animate-scale-in flex-col overflow-hidden`}>
          {/* The companies scroll (a site can have many); the title and the buttons stay in view. */}
          <div className="flex-none px-5 pt-5">
            <h2 id={`${fieldId}-title`} className="font-display text-lg font-semibold text-ink">{title}</h2>
            {problem ? <p role="alert" className="mt-3 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{problem}</p> : null}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-1 pt-4">
            <CompanyTickList single legend="Company" companies={offered} value={companyId ? [companyId] : []} onChange={(ids) => setCompanyId(ids[0] ?? '')} />
          </div>
          <div className="flex flex-none flex-col-reverse gap-2 px-5 pb-5 pt-4 sm:flex-row sm:justify-end">
            <Button variant="secondary" onClick={onClose} disabled={mut.isPending} shortcut="cancel" className="[@media(pointer:coarse)]:!min-h-11">Cancel</Button>
            <Button variant={mode === 'add' ? 'primary' : 'danger'} onClick={send} loading={mut.isPending} className="[@media(pointer:coarse)]:!min-h-11">{mode === 'add' ? 'Add' : 'Remove'}</Button>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}
