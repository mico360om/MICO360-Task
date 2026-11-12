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
import { FilterField, Glyph, Notice, TARGET_KIND_LABELS, count, dayWords, instantWords, problemText } from './manage-ui';
import { MANAGE_KEY, REPORTS_KEY, manageKeys, tc, useManageCourses } from './manage-queries';
import { AssignDialog } from './AssignDialog';

/** "Due 1 Dec", "Due 14 days after assigned", "No due date". */
export function dueText(a: Pick<AssignmentRow, 'dueDay' | 'dueDays'>): string {
  if (a.dueDay) return `Due ${dayWords(a.dueDay)}`;
  if (a.dueDays) return `Due ${count(a.dueDays, 'day')} after assigned`;
  return 'No due date';
}

/** A New staff only rule's due: "Due 10 days after they join", "No due date". */
export const newStaffDueText = (a: Pick<AssignmentRow, 'dueDays'>): string => (a.dueDays ? `Due ${count(a.dueDays, 'day')} after they join` : 'No due date');

/** "12 people · 5 finished · 2 overdue". */
const peopleText = (n: { people: number; completed: number; overdue: number }) => `${count(n.people, 'person', 'people')} · ${n.completed.toLocaleString('en-US')} finished · ${n.overdue.toLocaleString('en-US')} overdue`;

type NewStaffLine = { kind: 'newStaff'; ruleId: string; rows: AssignmentRow[]; courseTitles: string[]; on: boolean; people: number; completed: number; overdue: number };

/**
 * One line of the Assigned list: an assignment, or a New staff only rule (owner answer 2, 12 Nov) — its
 * assignments (one per course) shown as one row, switched off or on for all its courses at once.
 */
export type AssignedLine = { kind: 'assignment'; row: AssignmentRow } | NewStaffLine;

/** The list's lines, in the server's order (a rule where its first course is). */
export function assignedLines(rows: readonly AssignmentRow[]): AssignedLine[] {
  const out: AssignedLine[] = [];
  const rules = new Map<string, NewStaffLine>();
  for (const row of rows) {
    if (!row.ruleId) {
      out.push({ kind: 'assignment', row });
      continue;
    }
    const line = rules.get(row.ruleId);
    if (line) {
      line.rows.push(row);
      if (!line.courseTitles.includes(row.courseTitle)) line.courseTitles.push(row.courseTitle);
      line.on = line.on && !row.frozen;
      line.people += row.people;
      line.completed += row.completed;
      line.overdue += row.overdue;
    } else {
      const fresh: NewStaffLine = { kind: 'newStaff', ruleId: row.ruleId, rows: [row], courseTitles: [row.courseTitle], on: !row.frozen, people: row.people, completed: row.completed, overdue: row.overdue };
      rules.set(row.ruleId, fresh);
      out.push(fresh);
    }
  }
  return out;
}

const rowButton = '!min-h-[40px] [@media(pointer:coarse)]:!min-h-11';
const them = (n: number, one: string, many: string) => (n === 1 ? one : many);

/**
 * Manage → Assigned: every assignment (a Training manager counts only the people in her companies), filtered by
 * course; "Assign a course" (with a live preview) and Withdraw (finished courses are kept, unfinished ones
 * withdrawn). New staff only rows are switched off (nobody new gets it, nobody loses anything) — never deleted here.
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
  const [switchingOff, setSwitchingOff] = useState<NewStaffLine | null>(null);
  const [switchProblem, setSwitchProblem] = useState<string | null>(null);
  const coursesQ = useManageCourses();
  const listQ = useQuery({ queryKey: manageKeys.assignments(courseId), queryFn: () => tc().assignments(courseId || undefined) });
  const lines = assignedLines(listQ.data?.assignments ?? []);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: MANAGE_KEY });
    void qc.invalidateQueries({ queryKey: REPORTS_KEY });
  };

  const withdraw = useMutation({
    mutationFn: (id: string) => tc().withdraw(id),
    onSuccess: () => {
      setWithdrawing(null);
      setDone('Withdrawn. Finished courses are kept.');
      refresh();
    },
  });
  const switchRule = useMutation({
    mutationFn: ({ ruleId, on }: { ruleId: string; on: boolean }) => tc().updateRule(ruleId, { active: on }),
    onMutate: () => setSwitchProblem(null),
    onSuccess: (_r, v) => {
      setSwitchingOff(null);
      setDone(v.on ? 'Switched on. People who join from now on get it.' : 'Switched off. Nobody new gets it; nobody loses anything.');
      refresh();
    },
    onError: (err, v) => {
      if (v.on) setSwitchProblem(`Couldn’t switch it on. ${problemText(err)}`);
    },
  });

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
          Assign a course
        </Button>
      </div>
      {done ? <Notice tone="ok">{done}</Notice> : null}
      {switchProblem ? <Notice>{switchProblem}</Notice> : null}

      {listQ.isError ? (
        <LoadError what="the assigned courses" onRetry={() => void listQ.refetch()} />
      ) : listQ.isLoading ? (
        <div className="skeleton h-48 rounded-2xl" role="status" aria-label="Loading the assigned courses" />
      ) : lines.length === 0 ? (
        <EmptyState title="Nothing assigned yet" description="Assign a published course to a person, a group, a department, a company or a project’s team." />
      ) : (
        <ul aria-label="Assigned" className="card divide-y divide-line overflow-hidden">
          {lines.map((line) => {
            if (line.kind === 'assignment') {
              const a = line.row;
              return (
                <li key={a.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-2.5">
                  <div className="min-w-0 flex-[1_1_18rem]">
                    <div className="flex flex-wrap items-center gap-2">
                      <span dir="auto" className="font-semibold text-ink [overflow-wrap:anywhere]">{a.courseTitle}</span>
                      <Badge tone={a.mandatory ? 'brand' : 'neutral'}>{a.mandatory ? 'Mandatory' : 'Optional'}</Badge>
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
                    className={rowButton}
                  >
                    Withdraw
                  </Button>
                </li>
              );
            }
            const first = line.rows[0]!;
            return (
              <li key={`rule-${line.ruleId}`} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-2.5">
                <div className="min-w-0 flex-[1_1_18rem]">
                  <div className="flex flex-wrap items-center gap-2">
                    <span dir="auto" className="font-semibold text-ink [overflow-wrap:anywhere]">{line.courseTitles.join(', ')}</span>
                    <Badge tone="info">New staff only</Badge>
                    <Badge tone={first.mandatory ? 'brand' : 'neutral'}>{first.mandatory ? 'Mandatory' : 'Optional'}</Badge>
                    {line.on ? null : <Badge tone="neutral">Switched off</Badge>}
                  </div>
                  <p dir="auto" className="mt-0.5 text-sm text-ink [overflow-wrap:anywhere]">{`${TARGET_KIND_LABELS[first.targetKind]}: ${first.targetLabel}`}</p>
                  <p className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-ink-2">
                    <span>{newStaffDueText(first)}</span>
                    <span>{peopleText(line)}</span>
                  </p>
                </div>
                {line.on ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      switchRule.reset();
                      setSwitchingOff(line);
                    }}
                    className={rowButton}
                  >
                    Switch off
                  </Button>
                ) : (
                  <Button variant="secondary" size="sm" loading={switchRule.isPending && switchRule.variables?.ruleId === line.ruleId} onClick={() => switchRule.mutate({ ruleId: line.ruleId, on: true })} className={rowButton}>
                    Switch on
                  </Button>
                )}
              </li>
            );
          })}
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
          onAssigned={(reach, newStaff) => setDone(newStaff ? 'Done. People who join from now on get it.' : reach === null ? 'Assigned.' : `Assigned. It reaches ${count(reach, 'person', 'people')}.`)}
        />
      ) : null}
      {withdrawing ? (
        <ConfirmDialog
          title="Withdraw this assignment?"
          confirmLabel="Withdraw"
          keepLabel="Keep it"
          busy={withdraw.isPending}
          error={withdraw.isError ? `Couldn’t withdraw it. ${problemText(withdraw.error)}` : null}
          onConfirm={() => withdraw.mutate(withdrawing.id)}
          onClose={() => setWithdrawing(null)}
        >
          <p dir="auto">{`“${withdrawing.courseTitle}” for ${TARGET_KIND_LABELS[withdrawing.targetKind].toLowerCase()} ${withdrawing.targetLabel}.`}</p>
          <p className="mt-2">Finished courses are kept. Unfinished courses from it are withdrawn, unless the person has the course another way.</p>
        </ConfirmDialog>
      ) : null}
      {switchingOff ? (
        <ConfirmDialog
          title="Switch off New staff only?"
          confirmLabel="Switch off"
          keepLabel="Keep it on"
          busy={switchRule.isPending}
          error={switchRule.isError ? `Couldn’t switch it off. ${problemText(switchRule.error)}` : null}
          onConfirm={() => switchRule.mutate({ ruleId: switchingOff.ruleId, on: false })}
          onClose={() => setSwitchingOff(null)}
        >
          <p dir="auto">{`${switchingOff.courseTitles.join(', ')} for ${TARGET_KIND_LABELS[switchingOff.rows[0]!.targetKind].toLowerCase()} ${switchingOff.rows[0]!.targetLabel}.`}</p>
          <p className="mt-2">
            {`Nobody new gets ${them(switchingOff.courseTitles.length, 'it', 'them')} from now on. Nobody loses anything: people who have ${them(switchingOff.courseTitles.length, 'it', 'them')} keep ${them(switchingOff.courseTitles.length, 'it', 'them')}. You can switch it on again.`}
          </p>
        </ConfirmDialog>
      ) : null}
    </div>
  );
}
