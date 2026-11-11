import { useId, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AssignmentRow } from '../../../api/training';
import { Badge } from '../../ui/Badge';
import { Button } from '../../ui/Button';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import { EmptyState } from '../../ui/EmptyState';
import { LoadError } from '../../ui/LoadError';
import { fieldClass } from '../../ui/Field';
import { useCompanyTimeZone } from '../../../lib/useCompanyTimeZone';
import { FilterField, Glyph, Notice, TARGET_KIND_LABELS, count, dayWords, errorCode, instantWords, problemText } from './manage-ui';
import { MANAGE_KEY, REPORTS_KEY, manageKeys, tc, useManageCourses } from './manage-queries';
import { AssignDialog } from './AssignDialog';

/** "Due 1 Dec", "Due 14 days after assigned", "No due date". */
export function dueText(a: Pick<AssignmentRow, 'dueDay' | 'dueDays'>): string {
  if (a.dueDay) return `Due ${dayWords(a.dueDay)}`;
  if (a.dueDays) return `Due ${count(a.dueDays, 'day')} after assigned`;
  return 'No due date';
}

/** "12 people · 5 completed · 2 overdue". */
const peopleText = (a: AssignmentRow) => `${count(a.people, 'person', 'people')} · ${a.completed.toLocaleString('en-US')} completed · ${a.overdue.toLocaleString('en-US')} overdue`;

/**
 * The Assignments tab: every assignment (a Training manager counts only the people in her companies), filtered
 * by course; Assign (with a live preview) and Withdraw (finished training is kept, unfinished is withdrawn; an
 * onboarding rule's assignment is changed through its rule).
 */
export function AssignmentsTab() {
  const qc = useQueryClient();
  const timeZone = useCompanyTimeZone();
  const filterId = useId();
  const [params, setParams] = useSearchParams();
  const [courseId, setCourseId] = useState(params.get('course') ?? '');
  const [assigning, setAssigning] = useState(params.get('assign') === '1');
  const [done, setDone] = useState<string | null>(null);
  const [withdrawing, setWithdrawing] = useState<AssignmentRow | null>(null);
  const coursesQ = useManageCourses();
  const listQ = useQuery({ queryKey: manageKeys.assignments(courseId), queryFn: () => tc().assignments(courseId || undefined) });
  const rows = listQ.data?.assignments ?? [];

  const withdraw = useMutation({
    mutationFn: (id: string) => tc().withdraw(id),
    onSuccess: () => {
      setWithdrawing(null);
      setDone('Withdrawn. Completed training is kept.');
      void qc.invalidateQueries({ queryKey: MANAGE_KEY });
      void qc.invalidateQueries({ queryKey: REPORTS_KEY });
    },
  });
  const ruleRefusal = withdraw.isError && errorCode(withdraw.error) === 'RULE_ASSIGNMENT';

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <FilterField label="Course" htmlFor={filterId} className="min-w-[12rem] max-w-md flex-1">
          <select id={filterId} value={courseId} onChange={(e) => setCourseId(e.target.value)} className={fieldClass(false, 'w-full')}>
            <option value="">All courses</option>
            {(coursesQ.data?.courses ?? []).map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
          </select>
        </FilterField>
        <Button
          onClick={() => {
            setDone(null);
            setAssigning(true);
          }}
          className="!min-h-[44px]"
        >
          {Glyph.plus}
          Assign
        </Button>
      </div>
      {done ? <Notice tone="ok">{done}</Notice> : null}

      {listQ.isError ? (
        <LoadError what="the assignments" onRetry={() => void listQ.refetch()} />
      ) : listQ.isLoading ? (
        <div className="skeleton h-48 rounded-2xl" role="status" aria-label="Loading assignments" />
      ) : rows.length === 0 ? (
        <EmptyState title="No assignments yet" description="Assign a published course to people, a group, a department, a company or a project’s team." />
      ) : (
        <ul aria-label="Assignments" className="card divide-y divide-line overflow-hidden">
          {rows.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-2.5">
              <div className="min-w-0 flex-[1_1_18rem]">
                <div className="flex flex-wrap items-center gap-2">
                  <span dir="auto" className="font-semibold text-ink [overflow-wrap:anywhere]">{a.courseTitle}</span>
                  <Badge tone={a.mandatory ? 'brand' : 'neutral'}>{a.mandatory ? 'Mandatory' : 'Optional'}</Badge>
                  {a.ruleId ? <Badge tone="info">From an onboarding rule</Badge> : null}
                  {a.frozen ? <Badge tone="neutral">Rule switched off</Badge> : null}
                </div>
                <p dir="auto" className="mt-0.5 text-sm text-ink [overflow-wrap:anywhere]">{`${TARGET_KIND_LABELS[a.targetKind]}: ${a.targetLabel}`}</p>
                <p className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-ink-2">
                  <span>{dueText(a)}</span>
                  <span>{peopleText(a)}</span>
                  <span>{a.createdByName ? `By ${a.createdByName} · ${instantWords(a.createdAt, timeZone)}` : `Added ${instantWords(a.createdAt, timeZone)}`}</span>
                </p>
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  withdraw.reset();
                  setWithdrawing(a);
                }}
                className="!min-h-[40px] [@media(pointer:coarse)]:!min-h-11"
              >
                Withdraw
              </Button>
            </li>
          ))}
        </ul>
      )}

      {assigning ? (
        <AssignDialog
          initialCourseIds={courseId ? [courseId] : []}
          onClose={() => {
            setAssigning(false);
            if (params.get('assign')) {
              const next = new URLSearchParams(params);
              next.delete('assign');
              setParams(next, { replace: true });
            }
          }}
          onAssigned={(reach) => setDone(reach === null ? 'Assigned.' : `Assigned. It reaches ${count(reach, 'person', 'people')}.`)}
        />
      ) : null}
      {withdrawing ? (
        <ConfirmDialog
          title="Withdraw this assignment?"
          confirmLabel="Withdraw"
          keepLabel="Keep it"
          busy={withdraw.isPending}
          confirmDisabled={ruleRefusal}
          error={withdraw.isError && !ruleRefusal ? `Couldn’t withdraw it. ${problemText(withdraw.error)}` : null}
          onConfirm={() => withdraw.mutate(withdrawing.id)}
          onClose={() => setWithdrawing(null)}
        >
          <p dir="auto">{`“${withdrawing.courseTitle}” for ${TARGET_KIND_LABELS[withdrawing.targetKind].toLowerCase()} ${withdrawing.targetLabel}.`}</p>
          <p className="mt-2">Completed training is kept. Unfinished training from it is withdrawn, unless the person has the course another way.</p>
          {ruleRefusal ? (
            <div className="mt-3 rounded-lg bg-info-soft px-3 py-2 text-sm text-info">
              <p role="alert">This assignment comes from an onboarding rule. Change the onboarding rule instead.</p>
              <button
                type="button"
                onClick={() => {
                  setWithdrawing(null);
                  setParams({ tab: 'rules' }, { replace: true });
                }}
                className="mt-1 font-semibold underline [@media(pointer:coarse)]:!min-h-11"
              >
                Open onboarding rules
              </button>
            </div>
          ) : null}
        </ConfirmDialog>
      ) : null}
    </div>
  );
}
