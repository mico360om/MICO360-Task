import { useState } from 'react';
import { Link } from 'react-router-dom';
import { portal, portalProblem, type PortalTaskItem } from '../../api/portal';
import { Button } from '../../components/ui/Button';
import { Chip, day, KeyChip, ProgressBar, Section, StatusBadge, TimelineBar, TOUCH } from '../../components/portal/portal-ui';
import { downloadBlob, fileNameOf } from '../../lib/download';
import { NeedsModule, usePortalProjectContext } from './PortalProjectLayout';

/** 1.23 The "Progress & tasks" tab: how far along the project is, its milestones and the tasks shared with the client. */
export function PortalProgressTab() {
  return (
    <NeedsModule module="progress">
      <Progress />
    </NeedsModule>
  );
}

function Progress() {
  const { projectId, view } = usePortalProjectContext();
  const progress = view.progress;
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  if (!progress) return null;
  const canSignOff = view.actions.signOff;

  const download = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const blob = await portal.taskListPdf(projectId);
      downloadBlob(fileNameOf(blob) ?? `${view.project.code}-task-list.pdf`, blob);
    } catch (err) {
      setProblem(portalProblem(err, 'Couldn’t download the task list.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-5 md:grid-cols-2">
        <Section title="Progress">
          <p className="font-display text-4xl font-bold text-ink">{progress.percentDone}%</p>
          <p className="text-sm text-ink-2">of the project’s work is done</p>
          <div className="mt-3">
            <ProgressBar percent={progress.percentDone} label="Project progress" />
          </div>
        </Section>
        <Section title="Timeline">
          <TimelineBar start={progress.timeline.startDate} target={progress.timeline.targetDate} today={progress.timeline.today} elapsed={progress.timeline.elapsedPercent} />
        </Section>
      </div>

      <Section title="Milestones">
        <TaskList projectId={projectId} items={progress.milestones} empty="No milestones have been shared yet." milestone canSignOff={canSignOff} />
      </Section>

      <Section
        title="Tasks"
        aside={
          view.actions.download ? (
            <Button type="button" variant="secondary" size="sm" className={TOUCH} loading={busy} onClick={() => void download()}>
              Download task list (PDF)
            </Button>
          ) : null
        }
      >
        {problem ? <p role="alert" className="mb-3 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{problem}</p> : null}
        <TaskList projectId={projectId} items={progress.tasks} empty="No tasks have been shared yet." canSignOff={canSignOff} />
      </Section>
    </div>
  );
}

function TaskList({ projectId, items, empty, milestone = false, canSignOff }: { projectId: string; items: PortalTaskItem[]; empty: string; milestone?: boolean; canSignOff: boolean }) {
  if (items.length === 0) return <p className="text-sm text-ink-2">{empty}</p>;
  return (
    <ul className="-mx-2 divide-y divide-line">
      {items.map((t) => (
        <li key={t.id}>
          <Link
            to={`/portal/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(t.id)}`}
            className="flex min-h-11 items-start gap-3 rounded-xl px-2 py-3 outline-none transition-colors hover:bg-ground focus-visible:ring-2 focus-visible:ring-brand/40"
          >
            {milestone ? (
              <span aria-hidden="true" className="mt-1.5 block h-2.5 w-2.5 flex-none rotate-45 rounded-[2px] bg-brand" />
            ) : (
              <span aria-hidden="true" className="mt-1.5 block h-2.5 w-2.5 flex-none rounded-full border-2 border-ink-3" />
            )}
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <KeyChip value={t.key} />
                {/* bdi: an Arabic title reads right-to-left but starts on the row's side. */}
                <span className="break-words text-sm font-medium text-ink"><bdi>{t.title}</bdi></span>
              </span>
              <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-2">
                <span>{t.dueDate ? `Due ${day(t.dueDate)}` : 'No due date'}</span>
                {t.acceptedOn ? <Chip tone="success">Accepted {day(t.acceptedOn)}</Chip> : null}
                {t.awaitingSignOff && canSignOff ? <Chip tone="brand">Waiting for your sign-off</Chip> : null}
              </span>
            </span>
            <span className="flex flex-none flex-col items-end gap-1">
              <StatusBadge label={t.status} />
              {/* Past its due day and not done — in words, not by colour alone. */}
              {t.late ? <Chip tone="danger">Late</Chip> : null}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
