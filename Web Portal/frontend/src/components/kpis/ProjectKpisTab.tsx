import { useId, useRef, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../api/client';
import { KPI_ROOT, kpisApi, projectKpiItemsKey, projectKpisKey, projectTargetsKey, type KpiTile, type TargetChange } from '../../api/kpis';
import { useDialog } from '../../hooks/useDialog';
import { ModalPortal } from '../ui/ModalPortal';
import { Button } from '../ui/Button';
import { LoadError } from '../ui/LoadError';
import { dialogLayer, dialogPanel } from '../ui/dialog-size';
import { ApiError } from '../../lib/api-client';
import { downloadBlob, fileNameOf } from '../../lib/download';
import { TOUCH_TALL } from '../../lib/touch';
import { KpiItemsSheet } from './KpiItemsSheet';
import { KpiTileCard, PeriodPicker, TrendNote, usePeriodParam } from './kpi-ui';
import { CustomKpisSection } from './CustomKpisSection';
import { TargetsEditor } from './TargetsEditor';
import { todayKey } from '../../lib/due-date';
import { useCompanyTimeZone } from '../../lib/company-clock';

/** The project's own targets (whoever runs it): the company's unless set here. */
function ProjectTargetsDialog({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const id = useId();
  const qc = useQueryClient();
  const ref = useDialog<HTMLDivElement>(onClose, { initialFocus: 'container' });
  const q = useQuery({ queryKey: projectTargetsKey(projectId), queryFn: () => kpisApi(apiClient).projectTargets(projectId) });
  const save = useMutation({
    mutationFn: (changes: TargetChange[]) => kpisApi(apiClient).saveProjectTargets(projectId, changes),
    onSuccess: (data) => {
      qc.setQueryData(projectTargetsKey(projectId), data);
      void qc.invalidateQueries({ queryKey: [...KPI_ROOT, 'project', projectId] });
      void qc.invalidateQueries({ queryKey: [...KPI_ROOT, 'management'] });
      onClose();
    },
  });
  return (
    <ModalPortal>
      <div className={dialogLayer('form')}>
        <div className="absolute inset-0 bg-scrim animate-fade-in" onClick={onClose} aria-hidden="true" />
        <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} tabIndex={-1} className={`card relative ${dialogPanel('form')} flex flex-col overflow-y-auto p-5 outline-none animate-scale-in`}>
          <h2 id={`${id}-title`} className="font-display text-lg font-semibold text-ink">
            This project’s targets
          </h2>
          <div className="mt-3">
            {q.isError ? (
              <LoadError what="the targets" onRetry={() => void q.refetch()} />
            ) : q.data ? (
              <TargetsEditor metrics={q.data.metrics} level="project" busy={save.isPending} error={save.error ? (save.error instanceof ApiError ? save.error.message : 'Couldn’t save the targets.') : null} onSave={(c) => save.mutate(c)} onCancel={onClose} />
            ) : (
              <div className="skeleton h-64 rounded-xl" aria-hidden="true" />
            )}
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}

const download = async (make: () => Promise<Blob>, fallback: string, setProblem: (p: string | null) => void, setBusy: (b: string | null) => void, which: string) => {
  setBusy(which);
  setProblem(null);
  try {
    const blob = await make();
    downloadBlob(fileNameOf(blob) ?? fallback, blob);
  } catch {
    setProblem('Couldn’t make the file. Please try again.');
  } finally {
    setBusy(null);
  }
};

/**
 * A project's KPIs tab: each KPI for the period (this month by default; week, quarter or a custom range)
 * with its target, light in words, the facts behind it and its trend — a tile opens the tasks behind its
 * number; the project's own KPIs; the PDF and Excel file; and, for whoever runs the project, its targets.
 */
export function ProjectKpisTab({ projectId, onOpenTask }: { projectId: string; onOpenTask: (id: string) => void }) {
  const [period, setPeriod] = usePeriodParam();
  const [customOpen, setCustomOpen] = useState(false);
  const timeZone = useCompanyTimeZone();
  const q = useQuery({ queryKey: projectKpisKey(projectId, period), queryFn: () => kpisApi(apiClient).project(projectId, period), placeholderData: keepPreviousData, refetchOnWindowFocus: true });
  const data = q.data;
  const [sheet, setSheet] = useState<KpiTile | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const [targets, setTargets] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const today = data?.today ?? todayKey(timeZone);

  return (
    <div className="space-y-4" data-kpis="project">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-display text-lg font-semibold text-ink">KPIs</h2>
          <p className="text-sm text-ink-2" aria-live="polite">
            {data ? data.period.label : 'Loading…'}
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <PeriodPicker value={period} onChange={setPeriod} today={today} customOpen={customOpen} onCustomOpen={setCustomOpen} />
          {data?.can.manage ? (
            <Button size="sm" variant="secondary" onClick={() => setTargets(true)} className={TOUCH_TALL}>
              Targets
            </Button>
          ) : null}
          <Button size="sm" variant="secondary" disabled={!data} loading={busy === 'pdf'} onClick={() => void download(() => kpisApi(apiClient).projectPdf(projectId, period), `project-kpis-${today}.pdf`, setProblem, setBusy, 'pdf')} className={TOUCH_TALL}>
            PDF
          </Button>
          <Button size="sm" variant="secondary" disabled={!data} loading={busy === 'xlsx'} onClick={() => void download(() => kpisApi(apiClient).projectXlsx(projectId, period), `project-kpis-${today}.xlsx`, setProblem, setBusy, 'xlsx')} className={TOUCH_TALL}>
            Excel
          </Button>
        </div>
      </div>
      {problem ? (
        <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
          {problem}
        </p>
      ) : null}
      {q.isError && !data ? (
        <LoadError what="the KPIs" onRetry={() => void q.refetch()} />
      ) : !data ? (
        <div aria-busy="true" aria-label="Loading the KPIs" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="skeleton h-40 rounded-2xl" />
          ))}
        </div>
      ) : (
        <div className={`space-y-4 transition-opacity ${q.isFetching && q.isPlaceholderData ? 'opacity-60' : ''}`}>
          {data.project.archived ? <p className="rounded-lg bg-ground px-3 py-2 text-sm text-ink-2">This project is archived: its KPIs can be read and downloaded, not changed.</p> : null}
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="KPIs">
            {data.tiles.map((t) => (
              <li key={t.metric} className="min-w-0">
                <KpiTileCard
                  tile={t}
                  points={data.trend.points}
                  onOpen={(tile, from) => {
                    opener.current = from;
                    setSheet(tile);
                  }}
                />
              </li>
            ))}
          </ul>
          <TrendNote kind={data.trend.kind} points={data.trend.points} />
          <CustomKpisSection projectId={projectId} custom={data.custom} canManage={data.can.manage} />
        </div>
      )}
      {sheet ? (
        <KpiItemsSheet
          title={sheet.label}
          queryKey={projectKpiItemsKey(projectId, sheet.metric, period)}
          load={() => kpisApi(apiClient).projectItems(projectId, sheet.metric, period)}
          onOpenTask={onOpenTask}
          onClose={() => {
            setSheet(null);
            opener.current?.focus();
          }}
        />
      ) : null}
      {targets ? <ProjectTargetsDialog projectId={projectId} onClose={() => setTargets(false)} /> : null}
    </div>
  );
}
