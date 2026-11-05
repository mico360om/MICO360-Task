import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { apiClient } from '../api/client';
import { meetingSeriesApi, type SeriesMeeting } from '../api/meeting-series';
import { Breadcrumbs } from '../components/ui/Breadcrumbs';
import { Button } from '../components/ui/Button';
import { PageProblem, isMissing } from '../components/ui/PageProblem';
import { ProjectAvatar } from '../components/ProjectAvatar';
import { ActionMenu, type ActionMenuItem } from '../components/meeting/ActionMenu';
import { Icon, Section, SectionError } from '../components/meeting/kit';
import { SeriesIcon } from '../components/meeting/series/SeriesLine';
import { CarriedItems } from '../components/meeting/series/CarriedItems';
import { NewMeetingInSeriesForm, SeriesMeetingRow, useCarriedStatus, useNewMeetingInSeries } from '../components/meeting/series/SeriesSection';
import { AddExistingMeetingsDialog, DeleteSeriesDialog, MergeSeriesDialog, RemoveFromSeriesDialog, RenameSeriesDialog } from '../components/meeting/series/SeriesDialogs';
import { seriesDay, splitByNow } from '../lib/meeting-series';
import { useCompanyTimeZone } from '../lib/useCompanyTimeZone';
import { useProjectsWith } from '../lib/useProjectsWith';
import { useCurrentProject } from '../components/CurrentProject';
import { usePageName } from '../lib/page-meta';
import { TOUCH_SQUARE } from '../lib/touch';

type Dialog = 'rename' | 'merge' | 'add' | 'delete' | { remove: SeriesMeeting } | null;

/**
 * 1.23 The Series page (/meetings/series/:id): the series' name (rename), its project, every meeting
 * of it this person may open — coming up and earlier — its open action items, New meeting in this
 * series, Add existing meetings, Remove a meeting, Merge another series into this one, Delete.
 */
export function MeetingSeriesPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const timeZone = useCompanyTimeZone();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['meeting-series', id], queryFn: () => meetingSeriesApi(apiClient).get(id), enabled: !!id });
  const page = q.data;
  usePageName(page?.series.name);
  useCurrentProject(page?.series.projectId);
  const { projects } = useProjectsWith(page?.series.projectId);
  const newMeeting = useNewMeetingInSeries(page?.series.id ?? null);
  const status = useCarriedStatus([['meeting-series', id]]);

  if (q.isLoading) {
    return (
      <div key="loading" aria-busy="true">
        <div className="skeleton h-4 w-32" />
        <div className="skeleton mt-4 h-8 w-80 max-w-full" />
        <div className="skeleton mt-6 h-64 w-full" />
      </div>
    );
  }
  if (q.isError || !page) {
    const missing = !q.isError || isMissing(q.error);
    return (
      <PageProblem
        title={missing ? 'Series not found' : 'Couldn’t load this series'}
        message={missing ? 'It may have been deleted, or you don’t have access to it.' : 'Check your connection and try again.'}
        backTo="/meetings"
        backLabel="Back to meetings"
        onRetry={missing ? undefined : () => void q.refetch()}
        retrying={q.isFetching}
      />
    );
  }

  const { series } = page;
  const project = series.projectId ? projects.find((p) => p.id === series.projectId) ?? null : null;
  const { earlier, upcoming } = splitByNow(page.meetings);
  const removable = new Set(page.removable);
  const menu: ActionMenuItem[] = [];
  if (page.canManage) menu.push({ label: 'Rename…', onSelect: () => setDialog('rename') });
  if (page.canManage && page.mergeOptions.length) menu.push({ label: 'Merge another series into this one…', onSelect: () => setDialog('merge') });
  if (page.canDelete) menu.push({ label: 'Delete series…', danger: true, onSelect: () => setDialog('delete') });

  const row = (m: SeriesMeeting) => (
    <SeriesMeetingRow
      key={m.id}
      m={m}
      timeZone={timeZone}
      now={new Date()}
      actions={
        removable.has(m.id) ? (
          <button
            type="button"
            onClick={() => setDialog({ remove: m })}
            aria-label={`Remove ${m.title}, ${seriesDay(m.startAt, timeZone)}, from the series`}
            title="Remove from the series"
            className={`grid h-9 w-9 flex-none place-items-center rounded-md text-xs text-ink-3 transition-colors compact:h-7 compact:w-7 hover:bg-danger-soft hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 ${TOUCH_SQUARE}`}
          >
            ✕
          </button>
        ) : null
      }
    />
  );
  const list = (title: string, sectionId: string, items: SeriesMeeting[], empty: string) => (
    <Section id={sectionId} title={title} count={items.length ? String(items.length) : undefined}>
      {items.length ? <ul className="flex flex-col">{items.map(row)}</ul> : <p className="text-sm text-ink-3">{empty}</p>}
    </Section>
  );

  return (
    <div>
      <header className="mb-4">
        <Breadcrumbs items={[{ label: 'Meetings', to: '/meetings' }, { label: <bdi>{series.name}</bdi> }]} />
        <div className="mt-1.5 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-3">
              <SeriesIcon /> Meeting series
            </p>
            <h1 className="mt-0.5 break-words font-display text-xl font-bold leading-tight text-ink sm:text-2xl">
              <bdi>{series.name}</bdi>
            </h1>
            <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5 text-sm text-ink-2">
              <li className="flex min-w-0 items-center gap-1.5">
                <span className="shrink-0 text-ink-3">{project ? <ProjectAvatar project={project} size="xs" /> : Icon.folder}</span>
                <span className="min-w-0 truncate">{project ? <bdi>{project.name}</bdi> : series.projectId ? 'Project' : 'Meetings without a project'}</span>
              </li>
              <li className="flex items-center gap-1.5">
                <span className="text-ink-3">{Icon.calendar}</span>
                {page.meetings.length} {page.meetings.length === 1 ? 'meeting' : 'meetings'}
              </li>
              {page.openActionItems.length ? (
                <li className="flex items-center gap-1.5">
                  <span className="text-ink-3">{Icon.task}</span>
                  {page.openActionItems.length} open action {page.openActionItems.length === 1 ? 'item' : 'items'}
                </li>
              ) : null}
            </ul>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {page.canAdd ? (
              <>
                <Button onClick={newMeeting.open} loading={newMeeting.busy}>+ New meeting in this series</Button>
                <Button variant="secondary" onClick={() => setDialog('add')}>Add existing meetings</Button>
              </>
            ) : null}
            {menu.length ? (
              <ActionMenu
                label="More series actions"
                items={menu}
                align="start-below-lg"
                buttonClassName="grid h-10 w-10 place-items-center rounded-xl border border-line bg-surface text-ink-2 transition-colors hover:border-brand/30 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
              />
            ) : null}
          </div>
        </div>
      </header>

      {notice ? (
        <div role="status" className="mb-4 flex items-center justify-between gap-3 rounded-lg bg-success-soft px-3 py-2 text-sm text-success">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss" className="shrink-0 rounded px-1 opacity-80 hover:opacity-100">✕</button>
        </div>
      ) : null}
      <SectionError message={newMeeting.error} onDismiss={newMeeting.clearError} />
      {page.keepsRepeat && page.canManage ? (
        <p className="mb-4 rounded-lg bg-info-soft px-3 py-2 text-sm text-info">
          This series holds a repeating meeting, which is always in a series — so it can’t be deleted. You can rename it, or merge another series into it.
        </p>
      ) : null}

      <div className="grid gap-4 lg:gap-5 xl:grid-cols-[minmax(0,1fr)_26rem]">
        <div className="flex min-w-0 flex-col gap-4 lg:gap-5">
          {list('Coming up', 'series-upcoming', upcoming, 'No meetings coming up.')}
          {list('Earlier', 'series-earlier', [...earlier].reverse(), 'No earlier meetings.')}
        </div>
        <aside className="flex min-w-0 flex-col gap-4 lg:gap-5" aria-label="Series action items">
          <Section id="series-actions" title="Open action items" count={page.openActionItems.length ? String(page.openActionItems.length) : undefined}>
            <SectionError message={status.error} onDismiss={status.clearError} />
            {page.openActionItems.length ? (
              <CarriedItems items={page.openActionItems} timeZone={timeZone} busy={status.busy} onStatus={status.change} />
            ) : (
              <p className="text-sm text-ink-3">Nothing open in this series’ meetings.</p>
            )}
          </Section>
        </aside>
      </div>

      {newMeeting.prefill ? <NewMeetingInSeriesForm prefill={newMeeting.prefill} onClose={newMeeting.close} /> : null}
      {dialog === 'rename' ? <RenameSeriesDialog series={series} onClose={() => setDialog(null)} /> : null}
      {dialog === 'merge' ? <MergeSeriesDialog page={page} onClose={() => setDialog(null)} onDone={(name) => setNotice(`“${name}” is merged into this series.`)} /> : null}
      {dialog === 'add' ? (
        <AddExistingMeetingsDialog seriesId={series.id} seriesName={series.name} timeZone={timeZone} onClose={() => setDialog(null)} onDone={(n) => setNotice(n === 1 ? 'The meeting is added.' : `${n} meetings are added.`)} />
      ) : null}
      {dialog === 'delete' ? <DeleteSeriesDialog page={page} onClose={() => setDialog(null)} onDone={() => navigate('/meetings')} /> : null}
      {dialog && typeof dialog === 'object' ? (
        <RemoveFromSeriesDialog series={series} meetingId={dialog.remove.id} repeats={dialog.remove.repeats} onClose={() => setDialog(null)} onDone={() => setNotice('Removed from the series.')} />
      ) : null}
    </div>
  );
}
