import { useId, useMemo, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { REPORT_BY, type ReportBy, type ReportQuery, type ReportRow, type TrainingReport } from '../../../api/training';
import { downloadBlob, fileNameOf } from '../../../lib/download';
import { useMediaQuery } from '../../../lib/useMediaQuery';
import { useCompanyTimeZone } from '../../../lib/useCompanyTimeZone';
import { OVERDUE_CLASS } from '../../../lib/colour-classes';
import { StatTile } from '../../StatTile';
import { Badge } from '../../ui/Badge';
import { Button } from '../../ui/Button';
import { LoadError } from '../../ui/LoadError';
import { fieldClass } from '../../ui/Field';
import { ManageDialog } from './ManageDialog';
import { FilterField, Glyph, Notice, SectionCard, count, dayWords, instantWords, pct, problemText } from './manage-ui';
import { manageKeys, tc, useManageCourses } from './manage-queries';

const BY_LABELS: Record<ReportBy, string> = { course: 'Course', person: 'Person', department: 'Department', role: 'Role', company: 'Company', project: 'Project' };
const SCOPE_LABELS: Record<TrainingReport['scope'], string> = { ALL: 'All people', COMPANIES: 'Your companies', TEAM: 'Your team' };
const PHONE_QUERY = '(max-width: 47.9375em)';

/** The report's question as the API takes it (empty filters left out). */
export function reportQuery(by: ReportBy, courseId: string, from: string, to: string): ReportQuery {
  return { by, ...(courseId ? { courseId } : {}), ...(from ? { from } : {}), ...(to ? { to } : {}) };
}

const COLUMNS: { key: keyof ReportRow; label: string; show: (r: ReportRow) => string }[] = [
  { key: 'people', label: 'People', show: (r) => r.people.toLocaleString('en-US') },
  { key: 'assigned', label: 'Assigned', show: (r) => r.assigned.toLocaleString('en-US') },
  { key: 'started', label: 'Started', show: (r) => r.started.toLocaleString('en-US') },
  { key: 'completed', label: 'Completed', show: (r) => r.completed.toLocaleString('en-US') },
  { key: 'overdue', label: 'Overdue', show: (r) => r.overdue.toLocaleString('en-US') },
  { key: 'completionRate', label: 'Completion rate', show: (r) => pct(r.completionRate) },
  { key: 'averageScore', label: 'Average score', show: (r) => pct(r.averageScore) },
];

/**
 * Training reports (owner request; R5): participation, completion, overdue, certificates expiring and quiz
 * results, grouped by course, person, department, role, company or project, for a course and a period (the
 * days people got the course); Excel and PDF. Administrators see everyone, Training managers their companies,
 * a project manager their team (`readOnly`: no Training Center calls).
 */
export function ReportsTab({ readOnly = false }: { readOnly?: boolean }) {
  const timeZone = useCompanyTimeZone();
  const phone = useMediaQuery(PHONE_QUERY);
  const ids = { by: useId(), course: useId(), from: useId(), to: useId(), rows: useId() };
  const [by, setBy] = useState<ReportBy>('course');
  const [courseId, setCourseId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [exporting, setExporting] = useState<'xlsx' | 'pdf' | null>(null);
  const [exportProblem, setExportProblem] = useState<string | null>(null);
  const [drill, setDrill] = useState<{ lessonId: string; title: string; courseTitle: string } | null>(null);
  const periodProblem = from && to && from > to ? 'The period ends before it starts.' : null;
  const query = reportQuery(by, courseId, from, to);
  const reportQ = useQuery({ queryKey: manageKeys.report(query), queryFn: () => tc().report(query), enabled: !periodProblem, placeholderData: keepPreviousData });
  // Course choices: a manager's course list; a project manager's own report by course (no Training Center calls).
  const managerCourses = useManageCourses({}, !readOnly);
  const teamCourses = useQuery({ queryKey: manageKeys.report({ by: 'course' }), queryFn: () => tc().report({ by: 'course' }), enabled: readOnly });
  const courseOptions = useMemo(
    () => (readOnly ? (teamCourses.data?.rows ?? []).map((r) => ({ id: r.key, title: r.label })) : (managerCourses.data?.courses ?? []).map((c) => ({ id: c.id, title: c.title }))),
    [readOnly, teamCourses.data, managerCourses.data],
  );
  const r = reportQ.data;

  async function exportFile(format: 'xlsx' | 'pdf') {
    setExporting(format);
    setExportProblem(null);
    try {
      const blob = await tc().reportFile(query, format);
      downloadBlob(fileNameOf(blob) ?? `training-report-by-${by}.${format}`, blob);
    } catch (err) {
      setExportProblem(`Couldn’t make the ${format === 'xlsx' ? 'Excel' : 'PDF'} file. ${problemText(err)}`);
    } finally {
      setExporting(null);
    }
  }

  return (
    <section aria-label="Training reports" className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <FilterField label="Group by" htmlFor={ids.by} className="min-w-[9rem] flex-1 sm:max-w-[12rem]">
          <select id={ids.by} value={by} onChange={(e) => setBy(e.target.value as ReportBy)} className={fieldClass(false, 'w-full')}>
            {REPORT_BY.map((b) => <option key={b} value={b}>{BY_LABELS[b]}</option>)}
          </select>
        </FilterField>
        <FilterField label="Course" htmlFor={ids.course} className="min-w-[12rem] flex-[2_1_12rem] sm:max-w-sm">
          <select id={ids.course} value={courseId} onChange={(e) => setCourseId(e.target.value)} className={fieldClass(false, 'w-full')}>
            <option value="">All courses</option>
            {courseOptions.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
          </select>
        </FilterField>
        <FilterField label="From" htmlFor={ids.from} className="min-w-[9rem] flex-1 sm:max-w-[11rem]">
          <input id={ids.from} type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} aria-invalid={periodProblem ? true : undefined} className={fieldClass(!!periodProblem, 'w-full')} />
        </FilterField>
        <FilterField label="To" htmlFor={ids.to} className="min-w-[9rem] flex-1 sm:max-w-[11rem]">
          <input id={ids.to} type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} aria-invalid={periodProblem ? true : undefined} className={fieldClass(!!periodProblem, 'w-full')} />
        </FilterField>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => void exportFile('xlsx')} loading={exporting === 'xlsx'} disabled={!!periodProblem || exporting !== null} className="!min-h-[44px]">
            {Glyph.download}
            Excel
          </Button>
          <Button variant="secondary" onClick={() => void exportFile('pdf')} loading={exporting === 'pdf'} disabled={!!periodProblem || exporting !== null} className="!min-h-[44px]">
            {Glyph.download}
            PDF
          </Button>
        </div>
      </div>
      <p className="-mt-2 text-xs text-ink-2">The period is the days people got the course; quiz results count the days they were handed in.</p>
      {periodProblem ? <Notice>{periodProblem}</Notice> : null}
      {exportProblem ? <Notice>{exportProblem}</Notice> : null}

      {reportQ.isError ? (
        <LoadError what="the report" onRetry={() => void reportQ.refetch()} />
      ) : !r ? (
        <div className="skeleton h-72 rounded-2xl" role="status" aria-label="Loading the report" />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-ink-2">Showing</span>
            <Badge tone="brand">{SCOPE_LABELS[r.scope]}</Badge>
          </div>
          <div role="group" aria-label="Totals" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile label="People" value={r.totals.people} hint={`${r.totals.started.toLocaleString('en-US')} started`} />
            <StatTile label="Completed" value={pct(r.totals.completionRate)} hint={`${r.totals.completed.toLocaleString('en-US')} of ${r.totals.people.toLocaleString('en-US')}`} tone="done" />
            <StatTile label="Overdue" value={r.totals.overdue} tone="overdue" />
            <StatTile label="Certificates expiring" value={r.expiring.length} hint="In the next 30 days" tone="soon" />
          </div>

          <SectionCard id={ids.rows} title={`By ${BY_LABELS[r.by].toLowerCase()}`}>
            {r.rows.length === 0 ? (
              <p className="text-sm text-ink-2">Nobody has these courses in this period.</p>
            ) : phone ? (
              <ul aria-labelledby={ids.rows} className="flex flex-col gap-2">
                {r.rows.map((row) => (
                  <li key={row.key} className="rounded-xl border border-line p-3">
                    <p dir="auto" className="font-semibold text-ink [overflow-wrap:anywhere]">{row.label}</p>
                    <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                      {COLUMNS.map((c) => (
                        <div key={c.key} className="flex min-w-0 justify-between gap-2">
                          <dt className="text-ink-2">{c.label}</dt>
                          <dd className="font-medium text-ink">{c.show(row)}</dd>
                        </div>
                      ))}
                    </dl>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="-mx-1 overflow-x-auto px-1">
                <table aria-labelledby={ids.rows} className="w-full min-w-[40rem] text-sm">
                  <thead>
                    <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-2">
                      <th scope="col" className="py-2 pe-3 font-semibold">{BY_LABELS[r.by]}</th>
                      {COLUMNS.map((c) => <th key={c.key} scope="col" className="px-2 py-2 text-right font-semibold">{c.label}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {r.rows.map((row) => (
                      <tr key={row.key} className="border-b border-line last:border-0">
                        <th scope="row" dir="auto" className="py-2 pe-3 text-left font-medium text-ink [overflow-wrap:anywhere]">{row.label}</th>
                        {COLUMNS.map((c) => <td key={c.key} className="px-2 py-2 text-right tabular-nums text-ink">{c.show(row)}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>

          <div className="grid min-w-0 gap-4 lg:grid-cols-2">
            <SectionCard id="tc-rep-overdue" title="Overdue">
              {r.overdue.length === 0 ? (
                <p className="text-sm text-ink-2">Nothing overdue.</p>
              ) : (
                <ul className="divide-y divide-line">
                  {r.overdue.map((o) => (
                    <li key={`${o.userId}-${o.courseId}`} className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1 py-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span dir="auto" className="font-medium text-ink">{o.name}</span>
                          {o.client ? <Badge tone="info">Client</Badge> : null}
                        </div>
                        <p dir="auto" className="text-sm text-ink-2 [overflow-wrap:anywhere]">{o.courseTitle}</p>
                        <p className={`text-xs font-medium ${OVERDUE_CLASS.text}`}>{`Due ${dayWords(o.dueDay)} · ${count(o.daysLate, 'day')} late`}</p>
                      </div>
                      <Badge tone={o.mandatory ? 'brand' : 'neutral'}>{o.mandatory ? 'Mandatory' : 'Optional'}</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </SectionCard>
            <SectionCard id="tc-rep-expiring" title="Certificates expiring in 30 days">
              {r.expiring.length === 0 ? (
                <p className="text-sm text-ink-2">None in the next 30 days.</p>
              ) : (
                <ul className="divide-y divide-line">
                  {r.expiring.map((x) => (
                    <li key={x.certificateId} className="py-2">
                      <span dir="auto" className="font-medium text-ink">{x.name}</span>
                      <p dir="auto" className="text-sm text-ink-2 [overflow-wrap:anywhere]">{x.courseTitle}</p>
                      <p className="text-xs text-ink-2">{`Expires ${instantWords(x.expiresAt, timeZone)}`}</p>
                    </li>
                  ))}
                </ul>
              )}
            </SectionCard>
          </div>

          <SectionCard id="tc-rep-quizzes" title="Quiz results">
            {r.quizzes.length === 0 ? (
              <p className="text-sm text-ink-2">No quiz was handed in.</p>
            ) : (
              <ul className="divide-y divide-line">
                {r.quizzes.map((z) => (
                  <li key={z.lessonId} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2">
                    <div className="min-w-0 flex-1">
                      <span dir="auto" className="font-medium text-ink">{z.title}</span>
                      <p dir="auto" className="text-sm text-ink-2 [overflow-wrap:anywhere]">{z.courseTitle}</p>
                      <p className="text-xs text-ink-2">{z.attempts ? `${count(z.attempts, 'attempt')} · ${pct(z.passRate)} passed · average ${pct(z.averageScore)}` : 'No attempts yet'}</p>
                    </div>
                    <Button variant="secondary" size="sm" aria-label={`Questions in “${z.title}”`} onClick={() => setDrill({ lessonId: z.lessonId, title: z.title, courseTitle: z.courseTitle })} className="[@media(pointer:coarse)]:!min-h-11">
                      Questions
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
        </>
      )}
      {drill ? <QuizDrillDialog {...drill} onClose={() => setDrill(null)} /> : null}
    </section>
  );
}

/** One quiz's questions: how many people answered each, and how many got it right. */
function QuizDrillDialog({ lessonId, title, courseTitle, onClose }: { lessonId: string; title: string; courseTitle: string; onClose: () => void }) {
  const q = useQuery({ queryKey: manageKeys.quizReport(lessonId), queryFn: () => tc().quizReport(lessonId) });
  const d = q.data;
  return (
    <ManageDialog title={title} eyebrow={courseTitle} onClose={onClose}>
      {q.isError ? (
        <LoadError what="the quiz results" onRetry={() => void q.refetch()} />
      ) : !d ? (
        <div className="skeleton h-40 rounded-xl" role="status" aria-label="Loading the quiz results" />
      ) : (
        <>
          <p className="text-sm text-ink-2">{`${count(d.attempts, 'attempt')} by ${count(d.people, 'person', 'people')} · ${pct(d.passRate)} passed · average ${pct(d.averageScore)}`}</p>
          {d.questions.length === 0 ? (
            <p className="text-sm text-ink-2">No questions answered yet.</p>
          ) : (
            <ol className="flex flex-col gap-3">
              {d.questions.map((x, i) => (
                <li key={x.id} className="min-w-0">
                  <p dir="auto" className="text-sm font-medium text-ink [overflow-wrap:anywhere]">
                    <span className="me-1 text-ink-2">{i + 1}.</span>
                    <span>{x.prompt}</span>
                  </p>
                  <div className="mt-1 flex items-center gap-3">
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-ground" aria-hidden="true">
                      <div className="h-full rounded-full bg-brand" style={{ width: `${x.rightPct ?? 0}%` }} />
                    </div>
                    <span className="flex-none text-xs text-ink-2">{`${pct(x.rightPct)} right · ${count(x.answered, 'answer')}`}</span>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </>
      )}
    </ManageDialog>
  );
}
