import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { onlineManager, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../lib/api-client';
import { shouldRetryQuery } from '../lib/queryRetry';
import { apiClient } from '../api/client';
import { inspectionsApi, type InspectionDetail, type SignatureInput } from '../api/inspections';
import { membersApi } from '../api/members';
import { projectsApi } from '../api/projects';
import { tasksApi } from '../api/tasks';
import { invalidateTaskQueries } from '../lib/task-cache';
import { downloadBlob, fileNameOf } from '../lib/download';
import { useCompanyTimeZone } from '../lib/company-clock';
import { usePageName } from '../lib/page-meta';
import { detailView, type DraftView } from '../lib/inspection-outbox';
import { refreshInspectionQueries, useInspectionDraft } from '../lib/inspection-sync';
import { SIGNATURE_LABEL } from '../lib/inspection-rules';
import { useProjectRealtime } from '../lib/useProjectRealtime';
import { Breadcrumbs } from '../components/ui/Breadcrumbs';
import { Button } from '../components/ui/Button';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { PageProblem, isMissing } from '../components/ui/PageProblem';
import { InspectionItem, type ItemAnswer } from '../components/inspections/InspectionItem';
import { SyncAnnouncer, SyncBanner } from '../components/inspections/SyncBanner';
import { SignFinishDialog } from '../components/inspections/SignFinishDialog';
import { InspectionClientSwitch } from '../components/inspections/InspectionClientSwitch';
import { dateTimeText, dayText, followUpNotice, InspectIcon, OutcomePill, problemText } from '../components/inspections/inspection-ui';
import { TOUCH_SQUARE, TOUCH_TALL } from '../lib/touch';

const api = () => inspectionsApi(apiClient);
type Confirm = 'reopen' | 'take-over' | 'delete' | 'discard' | null;
/** A request that never reached a server while the browser says there's no signal. */
const noSignal = (e: unknown) => !(e instanceof ApiError) && (!onlineManager.isOnline() || (typeof navigator !== 'undefined' && navigator.onLine === false));
/**
 * What another person's change means for the one looking, after the page refreshed for it: taken
 * over from them, or reopened (null: nothing worth saying; the page simply shows the new state).
 */
function changedElsewhere(before: InspectionDetail | undefined, after: InspectionDetail | undefined, me: string | null): string | null {
  if (!before || !after || !me) return null;
  if (before.inspector.id === me && after.inspector.id !== me && after.status === 'IN_PROGRESS') {
    return `${after.inspector.name} took this inspection over: only they can answer and sign it now. Anything still saved on this phone for it isn’t sent.`;
  }
  if ((after.revision ?? 0) > (before.revision ?? 0) && after.reopened && after.reopened.by.id !== me) {
    return `${after.reopened.by.name} reopened this inspection: its answers can be changed again, and it is signed again when it’s finished.`;
  }
  return null;
}

const memberName = (m: { firstName: string; lastName: string; username: string }) => [m.firstName, m.lastName].filter(Boolean).join(' ') || m.username;

/**
 * One inspection, to carry out on a phone or at a desk. Every answer is saved on this device first
 * and sent from there (see lib/inspection-outbox), so a started inspection keeps working with no
 * signal; the banner says where the changes are. Signing finishes it (or waits for a signal), after
 * which it is read-only; failed items become follow-up tasks; a finished report downloads as a PDF
 * and, for those who run the project, can be shown to the client.
 */
export function InspectionPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const timeZone = useCompanyTimeZone();
  const { ownerId, view, sync, online, send, sendSoon, outbox } = useInspectionDraft(id);
  // Asked even when the browser says there's no signal (the library would wait, and with no copy on
  // this phone the page would never load): it fails at once, and the page says what it has.
  const q = useQuery({
    queryKey: ['inspection', id],
    queryFn: () => api().get(id),
    enabled: !!id,
    networkMode: 'always',
    retry: (count, e) => !noSignal(e) && shouldRetryQuery(count, e),
  });

  // The server's copy is kept on this device (so the page opens without signal), under any changes waiting here.
  useEffect(() => {
    if (q.data && ownerId) outbox.remember(ownerId, q.data);
  }, [q.data, ownerId, outbox]);

  const shown: DraftView | null = view ?? (q.data ? detailView(q.data) : null);
  const d: InspectionDetail | null = shown?.snapshot ?? null;
  usePageName(d?.title);

  const projectQ = useQuery({ queryKey: ['project', d?.projectId], queryFn: () => projectsApi(apiClient).get(d!.projectId), enabled: !!d?.projectId, retry: false });
  const membersQ = useQuery({ queryKey: ['members', d?.projectId], queryFn: () => membersApi(apiClient).list(d!.projectId), enabled: !!d?.projectId && !!d.permissions.canMakeFollowUps, retry: false });

  const [confirm, setConfirm] = useState<Confirm>(null);
  const [signing, setSigning] = useState(false);
  const [signError, setSignError] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [needAnswers, setNeedAnswers] = useState<string[] | null>(null);
  const [assignee, setAssignee] = useState<string>('~default');
  const [downloading, setDownloading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [changeNote, setChangeNote] = useState<string | null>(null);

  // Changed by someone else (or on another device) while open: refresh, and say so when it matters here.
  const latest = useRef(q.data);
  latest.current = q.data;
  useProjectRealtime(d?.projectId, (change, payload) => {
    if (!(change === 'all' || (change === 'inspections' && payload?.id === id))) return;
    const before = latest.current;
    void q.refetch().then((r) => {
      const note = changedElsewhere(before, r.data, ownerId);
      if (note) setChangeNote(note);
    });
  });

  // A finish (now, or sent later from this phone) that completed its check says so, once.
  const completed = shown?.finishedCompleted ?? null;
  const completedNote = useRef<string | null>(null);
  useEffect(() => {
    if (!completed || !ownerId) return;
    completedNote.current = `Finished. Task ${completed.key} completed.`;
    setNotice(completedNote.current);
    outbox.ackFinished(ownerId, id);
    // Every view of the task shows it done now (sent from here, or later from the outbox).
    void invalidateTaskQueries(qc);
    void qc.invalidateQueries({ queryKey: ['task', completed.id] });
    void qc.invalidateQueries({ queryKey: ['task-inspections'] });
  }, [completed, ownerId, id, outbox, qc]);

  // What became of follow-up tasks asked for here (now, or sent later from this phone): said once.
  const report = shown?.followUpReport ?? null;
  useEffect(() => {
    if (!report || !ownerId || !d) return;
    setNotice(followUpNotice(report, d.structure.sections.flatMap((s) => s.items)));
    outbox.ackFollowUpReport(ownerId, id);
  }, [report, ownerId, id, outbox, d]);

  const answers = useMemo(() => new Map((shown?.answers ?? []).map((a) => [a.itemId, a])), [shown?.answers]);
  const followUps = useMemo(() => new Map((d?.followUps ?? []).map((f) => [f.itemId, f])), [d?.followUps]);
  const waitingFollowUps = useMemo(() => new Set(shown?.followUpsWaiting ?? []), [shown?.followUpsWaiting]);

  const refresh = () => refreshInspectionQueries(qc, id, d?.projectId);
  const actionM = useMutation({
    mutationFn: async (what: Exclude<Confirm, 'discard' | null>) => {
      if (what === 'reopen') return api().reopen(id);
      if (what === 'take-over') return api().takeOver(id);
      await api().remove(id);
      return null;
    },
    onMutate: () => setProblem(null),
    onSuccess: (result, what) => {
      setConfirm(null);
      if (what === 'delete') {
        if (ownerId) outbox.discard(ownerId, id);
        navigate(d ? `/projects/${encodeURIComponent(d.projectId)}?tab=inspections` : '/projects', { replace: true });
        return;
      }
      if (result && ownerId) outbox.remember(ownerId, result);
      refresh();
    },
    onError: (e) => setProblem(problemText(e, 'That didn’t work. Check your connection and try again.')),
  });
  const doneM = useMutation({
    mutationFn: (offer: NonNullable<DraftView['finishedOffer']>) => tasksApi(apiClient).move(offer.id, offer.doneColumnId),
    onSuccess: (_r, offer) => {
      if (ownerId) outbox.ackFinished(ownerId, id);
      setNotice('The task is marked done.');
      void invalidateTaskQueries(qc);
      void qc.invalidateQueries({ queryKey: ['task', offer.id] });
      void qc.invalidateQueries({ queryKey: ['task-inspections'] });
    },
    onError: (e) => setProblem(problemText(e, 'Couldn’t mark the task done. You can do it from the task.')),
  });

  // Nothing to show: say which problem it is.
  if (!shown || !d) {
    if (q.isError && noSignal(q.error)) {
      return (
        <PageProblem
          title="No signal"
          message="This inspection hasn’t been opened on this phone yet, so there’s no copy saved here. It opens once there’s a signal. (An inspection keeps working without signal, even if the page reloads, once you’ve opened it here.)"
          backTo="/projects"
          backLabel="Back to projects"
          onRetry={() => void q.refetch()}
          retrying={q.isFetching}
        />
      );
    }
    if (q.isError) {
      const missing = isMissing(q.error);
      return (
        <PageProblem
          title={missing ? 'Inspection not found' : 'Couldn’t load this inspection'}
          message={missing ? 'It may have been deleted, or the link is wrong.' : 'Check your connection and try again. (An inspection keeps working without signal, even if the page reloads, once you’ve opened it here.)'}
          backTo="/projects"
          backLabel="Back to projects"
          onRetry={missing ? undefined : () => void q.refetch()}
          retrying={q.isFetching}
        />
      );
    }
    return <div className="skeleton h-40 rounded-xl" aria-label="Loading inspection" />;
  }

  const p = d.permissions;
  const finished = shown.status === 'FINISHED';
  const archived = d.projectArchived ?? projectQ.data?.status === 'ARCHIVED';
  const answersBlocked = !!shown.problem && shown.problem.stage === 'answers';
  const canAnswer = p.canAnswer && !finished && !shown.locked && !answersBlocked;
  const items = d.structure.sections.flatMap((s) => s.items);
  const failedIds = items.filter((i) => answers.get(i.id)?.result === 'FAIL').map((i) => i.id);
  const failedWithout = failedIds.filter((itemId) => !followUps.get(itemId)?.task && !waitingFollowUps.has(itemId) && !followUps.get(itemId)?.pending);
  const offline = !online || sync === 'offline';
  let number = 0;

  const saveAnswer = (itemId: string, value: ItemAnswer) => {
    if (!ownerId) return;
    try {
      outbox.saveAnswer(ownerId, id, { itemId, ...value });
      sendSoon();
    } catch (e) {
      setProblem(problemText(e, 'That answer couldn’t be saved.'));
    }
  };

  const makeFollowUps = (itemIds: string[]) => {
    if (!ownerId || !itemIds.length) return;
    try {
      outbox.queueFollowUps(ownerId, id, itemIds, assignee === '~default' ? undefined : assignee === '~nobody' ? null : assignee, d);
    } catch (e) {
      setProblem(problemText(e, 'The follow-up tasks couldn’t be saved. Please try again.'));
      return;
    }
    // What became of each is said once they're sent (see the follow-up report above).
    void send();
  };

  const startSigning = () => {
    const unanswered = items.filter((i) => !answers.get(i.id)?.result).map((i) => i.id);
    if (unanswered.length) {
      setNeedAnswers(unanswered);
      return;
    }
    setNeedAnswers(null);
    setSignError(null);
    setSigning(true);
  };

  const sign = async (signatures: SignatureInput[]) => {
    if (!ownerId) return;
    outbox.queueFinish(ownerId, id, signatures);
    setSigning(false);
    const state = await send();
    if (state === 'sent') {
      const done = outbox.view(ownerId, id)?.finishedCompleted;
      setNotice(done ? `Finished. Task ${done.key} completed.` : (completedNote.current ?? 'Finished. The report is ready.'));
    }
    else if (state === 'offline' || state === 'signed-out' || state === 'retry') setNotice('Signed on this phone. It finishes when it can reach the server, and the report is made then.');
  };

  const download = async () => {
    setDownloading(true);
    setProblem(null);
    try {
      const blob = await api().reportPdf(id);
      downloadBlob(fileNameOf(blob) ?? 'inspection-report.pdf', blob);
    } catch (e) {
      setProblem(problemText(e, 'Couldn’t download the report. Check your connection and try again.'));
    } finally {
      setDownloading(false);
    }
  };

  const members = Array.isArray(membersQ.data) ? membersQ.data : [];
  const projectOwnerId = projectQ.data?.ownerId ?? null;
  const projectOwner = members.find((m) => m.id === projectOwnerId);

  return (
    <div className="mx-auto max-w-5xl">
      <Breadcrumbs
        items={[
          { label: 'Projects', to: '/projects' },
          { label: projectQ.data ? <bdi>{projectQ.data.name}</bdi> : 'Project', to: `/projects/${encodeURIComponent(d.projectId)}?tab=inspections` },
          { label: <bdi>{d.title}</bdi> },
        ]}
      />

      <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 dir="auto" className="min-w-0 break-words font-display text-2xl font-bold text-ink">
              {d.title}
            </h1>
            <OutcomePill status={shown.status} failed={shown.counts.failed} result={finished ? d.result : ''} />
            {shown.locked ? <span className="inline-flex rounded-md bg-warning-soft px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-warning">Signed · waiting to finish</span> : null}
          </div>
          <p className="mt-0.5 flex flex-wrap gap-x-2 text-sm text-ink-2">
            {d.place ? <span dir="auto">{d.place}</span> : null}
            {d.place ? <span aria-hidden="true">·</span> : null}
            <span>Started {dateTimeText(d.startedAt, timeZone)}</span>
            <span aria-hidden="true">·</span>
            <span>
              Inspector: <bdi>{d.inspector.name}</bdi>
            </span>
            {d.task ? (
              <>
                <span aria-hidden="true">·</span>
                <Link to={`?task=${encodeURIComponent(d.task.id)}`} className={`tap text-brand hover:underline ${TOUCH_TALL}`}>
                  For <span className="font-mono">{d.task.key}</span>
                </Link>
              </>
            ) : null}
          </p>
          {d.reopened ? (
            <p className="mt-0.5 text-xs font-semibold text-ink-2">
              Revision {(d.revision ?? 0) + 1} · reopened on {dayText(d.reopened.at, timeZone)} by <bdi>{d.reopened.by.name}</bdi>
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {finished ? (
            <Button variant="secondary" size="sm" onClick={() => void download()} loading={downloading} className={TOUCH_TALL}>
              {InspectIcon.download}
              <span className="ms-1">Report (PDF)</span>
            </Button>
          ) : null}
          {p.canTakeOver ? (
            <Button variant="secondary" size="sm" onClick={() => setConfirm('take-over')} className={TOUCH_TALL}>
              Take over
            </Button>
          ) : null}
          {p.canReopen ? (
            <Button variant="secondary" size="sm" onClick={() => setConfirm('reopen')} className={TOUCH_TALL}>
              Reopen
            </Button>
          ) : null}
          {p.canDelete ? (
            <Button variant="ghost" size="sm" onClick={() => setConfirm('delete')} className={`!text-danger hover:!text-danger ${TOUCH_TALL}`}>
              Delete
            </Button>
          ) : null}
        </div>
      </div>

      <SyncAnnouncer view={view} sync={sync} online={online} />
      <div className="sticky top-14 z-20 mt-3">
        <SyncBanner
          view={view}
          sync={sync}
          online={online}
          onRetry={() => {
            if (ownerId) outbox.clearProblem(ownerId, id);
            void send({ force: true });
          }}
          onDiscard={() => setConfirm('discard')}
          onLookAgain={() => {
            if (ownerId) outbox.clearProblem(ownerId, id);
            void q.refetch();
          }}
          onDismiss={() => ownerId && outbox.clearProblem(ownerId, id)}
        />
        {view && !q.data && (q.isError || q.failureCount > 0) ? (
          <p role="status" className="rounded-xl border border-info/30 bg-info-soft px-3 py-2 text-sm text-info">
            No signal: showing the copy saved on this phone.
          </p>
        ) : null}
      </div>

      {changeNote ? (
        <p role="alert" className="mt-3 flex items-start justify-between gap-3 rounded-lg border border-warning/30 bg-warning-soft px-3 py-2 text-sm text-warning">
          <span>{changeNote}</span>
          <button type="button" onClick={() => setChangeNote(null)} aria-label="Dismiss" className={`grid shrink-0 place-items-center rounded px-1 opacity-80 hover:opacity-100 ${TOUCH_SQUARE}`}>
            ✕
          </button>
        </p>
      ) : null}
      {problem ? (
        <p role="alert" className="mt-3 flex items-start justify-between gap-3 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
          <span>{problem}</span>
          <button type="button" onClick={() => setProblem(null)} aria-label="Dismiss" className={`grid shrink-0 place-items-center rounded px-1 opacity-80 hover:opacity-100 ${TOUCH_SQUARE}`}>
            ✕
          </button>
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="mt-3 flex items-start justify-between gap-3 rounded-lg bg-success-soft px-3 py-2 text-sm text-success">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss" className={`grid shrink-0 place-items-center rounded px-1 opacity-80 hover:opacity-100 ${TOUCH_SQUARE}`}>
            ✕
          </button>
        </p>
      ) : null}

      {/* Progress */}
      <section aria-label="Progress" className="card mt-4 p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-sm text-ink">
            <span className="font-display text-xl font-bold">{shown.counts.answered}</span>
            <span className="text-ink-2"> of {shown.counts.total} answered</span>
          </p>
          <p className="flex flex-wrap gap-x-3 text-sm">
            <span className="text-success">✓ {shown.counts.passed} passed</span>
            <span className={shown.counts.failed ? 'font-semibold text-danger' : 'text-ink-2'}>✕ {shown.counts.failed} failed</span>
            <span className="text-ink-2">– {shown.counts.na} N/A</span>
          </p>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-ground" role="progressbar" aria-label="Answered" aria-valuemin={0} aria-valuemax={shown.counts.total} aria-valuenow={shown.counts.answered}>
          <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${shown.counts.total ? (shown.counts.answered / shown.counts.total) * 100 : 0}%` }} />
        </div>
        {d.description ? (
          <p dir="auto" className="mt-3 whitespace-pre-line text-sm text-ink-2">
            {d.description}
          </p>
        ) : null}
      </section>

      {/* Follow-up tasks for failed items */}
      {failedIds.length && p.canMakeFollowUps && !archived ? (
        <section aria-labelledby="followups-h" className="card mt-4 p-4">
          <h2 id="followups-h" className="text-sm font-semibold text-ink">
            Failed items ({failedIds.length})
          </h2>
          <p className="mt-0.5 text-xs text-ink-2">Each failed item can become a task in this project, linked back to this inspection.</p>
          <div className="mt-2 flex flex-wrap items-end gap-2">
            <label className="flex flex-col text-xs text-ink-2">
              Give new tasks to
              <select value={assignee} onChange={(e) => setAssignee(e.target.value)} className="mt-0.5 h-10 rounded-lg border border-line bg-surface px-2 text-sm text-ink sm:h-9">
                <option value="~default">The project owner{projectOwner ? ` (${memberName(projectOwner)})` : ''}</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {memberName(m)}
                  </option>
                ))}
                <option value="~nobody">Nobody yet</option>
              </select>
            </label>
            <Button size="sm" onClick={() => makeFollowUps(failedWithout)} disabled={!failedWithout.length} className={TOUCH_TALL}>
              {failedWithout.length ? `Create tasks for all failed items (${failedWithout.length})` : 'Every failed item has a task'}
            </Button>
          </div>
        </section>
      ) : null}

      {/* The checklist */}
      {d.structure.sections.map((s) => (
        <section key={s.id} aria-labelledby={`sec-${s.id}`} className="card mt-4 p-4">
          <h2 id={`sec-${s.id}`} dir="auto" className="mb-3 font-display text-base font-semibold text-ink">
            {s.title}
          </h2>
          <ol className="divide-y divide-line">
            {s.items.map((item) => {
              number += 1;
              const f = followUps.get(item.id);
              return (
                <InspectionItem
                  key={item.id}
                  item={item}
                  number={number}
                  answer={answers.get(item.id)}
                  readOnly={!canAnswer}
                  onAnswer={(v) => saveAnswer(item.id, v)}
                  followUp={f || waitingFollowUps.has(item.id) ? { task: f?.task ?? null, pending: f?.pending ?? false, queued: waitingFollowUps.has(item.id), moved: f?.moved === true } : null}
                  canMakeFollowUp={p.canMakeFollowUps && !archived}
                  onMakeFollowUp={() => makeFollowUps([item.id])}
                />
              );
            })}
          </ol>
        </section>
      ))}

      {/* Signing */}
      {!finished && p.canFinish ? (
        <section aria-labelledby="finish-h" className="card mt-4 p-4">
          <h2 id="finish-h" className="text-sm font-semibold text-ink">
            Finish
          </h2>
          {shown.locked ? (
            <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-sm text-ink-2">
              <p>Signed on this phone. It finishes as soon as it reaches the server.</p>
              <Button variant="secondary" size="sm" onClick={() => ownerId && outbox.cancelFinish(ownerId, id)} className={TOUCH_TALL}>
                Take the signatures back
              </Button>
            </div>
          ) : (
            <>
              <p className="mt-0.5 text-xs text-ink-2">
                The inspector signs{d.signatureRoles.allowed.length > 1 ? `, then ${d.signatureRoles.allowed.slice(1).map((r) => `the ${SIGNATURE_LABEL[r].toLowerCase()}${d.signatureRoles.required.includes(r) ? '' : ' (optional)'}`).join(' and ')}` : ''}. After that it can’t be changed, and the report is made.
              </p>
              {needAnswers ? (
                <div role="alert" className="mt-2 rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning">
                  <p className="font-semibold">Answer these first ({needAnswers.length}):</p>
                  <ul className="mt-1 list-disc ps-5">
                    {needAnswers.slice(0, 8).map((itemId) => (
                      <li key={itemId}>
                        <a href={`#item-${itemId}`} className="underline">
                          {items.find((i) => i.id === itemId)?.label}
                        </a>
                      </li>
                    ))}
                    {needAnswers.length > 8 ? <li>and {needAnswers.length - 8} more</li> : null}
                  </ul>
                </div>
              ) : null}
              <div className="mt-3">
                <Button onClick={startSigning} disabled={!canAnswer} className={TOUCH_TALL}>
                  Sign and finish
                </Button>
              </div>
            </>
          )}
        </section>
      ) : null}

      {/* Signatures and the client page, once finished */}
      {finished ? (
        <section aria-labelledby="sig-h" className="card mt-4 p-4">
          <h2 id="sig-h" className="text-sm font-semibold text-ink">
            Signatures
          </h2>
          <ul className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {d.signatures.map((s) => (
              <li key={s.role} className="rounded-lg border border-line p-2">
                <div className="grid h-20 place-items-center rounded-md bg-white">
                  {s.image ? (
                    <img src={s.image} alt={`${SIGNATURE_LABEL[s.role]} signature of ${s.name}`} className="max-h-16 max-w-full object-contain" />
                  ) : (
                    <span aria-hidden="true" dir="auto" className="font-serif text-xl italic text-[#1C1A17]">
                      {s.name}
                    </span>
                  )}
                </div>
                <p className="mt-1 text-sm text-ink">
                  <span className="font-semibold">{SIGNATURE_LABEL[s.role]}:</span> <bdi>{s.name}</bdi>
                </p>
                <p className="text-xs text-ink-2">
                  Signed {dateTimeText(s.signedAt, timeZone)}
                  {s.method === 'TYPED' ? ' · typed name' : ''}
                </p>
              </li>
            ))}
            {d.signatureRoles.allowed
              .filter((r) => !d.signatures.some((s) => s.role === r))
              .map((r) => (
                <li key={r} className="rounded-lg border border-dashed border-line p-2 text-sm text-ink-2">
                  <span className="font-semibold">{SIGNATURE_LABEL[r]}:</span> Not signed
                </li>
              ))}
          </ul>
          {d.finishedAt ? <p className="mt-2 text-xs text-ink-2">Finished {dateTimeText(d.finishedAt, timeZone)}</p> : null}
          <div className="mt-3">
            <InspectionClientSwitch inspectionId={id} clientVisible={d.clientVisible} canChange={p.canShowToClient} archived={archived} onChanged={refresh} />
          </div>
        </section>
      ) : null}

      {d.earlierRevisions?.length ? (
        <section aria-labelledby="earlier-h" className="card mt-4 p-4">
          <h2 id="earlier-h" className="text-sm font-semibold text-ink">
            Earlier signed revisions
          </h2>
          <p className="mt-0.5 text-xs text-ink-2">Signatures a reopen took off. Kept here and in the staff report; the client sees only the current one.</p>
          <ul className="mt-2 flex flex-col gap-2">
            {d.earlierRevisions.map((r) => (
              <li key={r.number} className="rounded-lg border border-line px-3 py-2 text-sm">
                <p className="font-semibold text-ink">
                  Revision {r.number} <span className="font-normal text-ink-2">· reopened on {dayText(r.reopenedAt, timeZone)}</span>
                </p>
                <ul className="mt-0.5 text-xs text-ink-2">
                  {r.signatures.map((s) => (
                    <li key={s.role}>
                      {SIGNATURE_LABEL[s.role]}: <bdi>{s.name}</bdi> · signed {dateTimeText(s.signedAt, timeZone)}
                      {s.method === 'TYPED' ? ' · typed name' : ''}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {signing ? (
        <SignFinishDialog
          allowed={d.signatureRoles.allowed}
          required={d.signatureRoles.required}
          inspectorName={d.inspector.name}
          online={!offline}
          busy={false}
          error={signError}
          onSubmit={(sigs) => void sign(sigs)}
          onClose={() => setSigning(false)}
        />
      ) : null}

      {shown.finishedOffer ? (
        <ConfirmDialog
          title={`Mark ${shown.finishedOffer.key} done?`}
          confirmLabel="Mark it done"
          keepLabel="Not now"
          tone="primary"
          busy={doneM.isPending}
          onConfirm={() => doneM.mutate(shown.finishedOffer!)}
          onClose={() => ownerId && outbox.ackFinished(ownerId, id)}
        >
          This inspection was carried out for the task <bdi>“{shown.finishedOffer.title}”</bdi>. It’s finished now — mark the task done too?
        </ConfirmDialog>
      ) : null}

      {confirm === 'reopen' ? (
        <ConfirmDialog title="Reopen this inspection?" confirmLabel="Reopen" tone="primary" busy={actionM.isPending} error={problem} onConfirm={() => actionM.mutate('reopen')} onClose={() => setConfirm(null)}>
          Its answers can be changed again. The signatures come off (they’re kept as an earlier revision, and it is signed again when it’s finished), and it leaves the client page if it was shown there.
        </ConfirmDialog>
      ) : null}
      {confirm === 'take-over' ? (
        <ConfirmDialog title="Take over this inspection?" confirmLabel="Take over" tone="primary" busy={actionM.isPending} error={problem} onConfirm={() => actionM.mutate('take-over')} onClose={() => setConfirm(null)}>
          You become its inspector: only you can answer, sign and finish it. <bdi>{d.inspector.name}</bdi> can no longer change it (anything they still have on their phone isn’t sent).
        </ConfirmDialog>
      ) : null}
      {confirm === 'delete' ? (
        <ConfirmDialog title="Delete this inspection?" confirmLabel="Delete" busy={actionM.isPending} error={problem} onConfirm={() => actionM.mutate('delete')} onClose={() => setConfirm(null)}>
          Its answers, signatures and report go with it (follow-up tasks already made stay). This can’t be undone.
        </ConfirmDialog>
      ) : null}
      {confirm === 'discard' ? (
        <ConfirmDialog
          title="Throw away what’s on this phone?"
          confirmLabel="Throw it away"
          onConfirm={() => {
            if (ownerId) outbox.discard(ownerId, id);
            setConfirm(null);
            void q.refetch();
          }}
          onClose={() => setConfirm(null)}
        >
          The changes saved on this phone for this inspection are removed. Nothing on the server changes.
        </ConfirmDialog>
      ) : null}
    </div>
  );
}
