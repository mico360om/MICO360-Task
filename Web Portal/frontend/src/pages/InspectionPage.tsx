import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../api/client';
import { inspectionsApi, type InspectionDetail, type SignatureInput } from '../api/inspections';
import { membersApi } from '../api/members';
import { projectsApi } from '../api/projects';
import { tasksApi } from '../api/tasks';
import { downloadBlob, fileNameOf } from '../lib/download';
import { useCompanyTimeZone } from '../lib/company-clock';
import { usePageName } from '../lib/page-meta';
import { detailView, type DraftView } from '../lib/inspection-outbox';
import { refreshInspectionQueries, useInspectionDraft } from '../lib/inspection-sync';
import { SIGNATURE_LABEL } from '../lib/inspection-rules';
import { Breadcrumbs } from '../components/ui/Breadcrumbs';
import { Button } from '../components/ui/Button';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { PageProblem, isMissing } from '../components/ui/PageProblem';
import { InspectionItem, type ItemAnswer } from '../components/inspections/InspectionItem';
import { SyncBanner } from '../components/inspections/SyncBanner';
import { SignFinishDialog } from '../components/inspections/SignFinishDialog';
import { InspectionClientSwitch } from '../components/inspections/InspectionClientSwitch';
import { dateTimeText, InspectIcon, OutcomePill, problemText } from '../components/inspections/inspection-ui';

const api = () => inspectionsApi(apiClient);
type Confirm = 'reopen' | 'take-over' | 'delete' | 'discard' | null;
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
  const q = useQuery({ queryKey: ['inspection', id], queryFn: () => api().get(id), enabled: !!id });

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
    onSuccess: () => {
      if (ownerId) outbox.ackFinished(ownerId, id);
      setNotice('The task is marked done.');
      void qc.invalidateQueries({ queryKey: ['task-inspections'] });
    },
    onError: (e) => setProblem(problemText(e, 'Couldn’t mark the task done. You can do it from the task.')),
  });

  // Nothing to show: say which problem it is.
  if (!shown || !d) {
    if (q.isError) {
      const missing = isMissing(q.error);
      return (
        <PageProblem
          title={missing ? 'Inspection not found' : 'Couldn’t load this inspection'}
          message={missing ? 'It may have been deleted, or the link is wrong.' : 'Check your connection and try again. (An inspection you have opened on this phone before opens without signal.)'}
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
  const archived = projectQ.data?.status === 'ARCHIVED';
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
    void send().then((state) => {
      if (state === 'sent') setNotice(itemIds.length === 1 ? 'Follow-up task made.' : `${itemIds.length} follow-up tasks made.`);
    });
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
    if (state === 'sent') setNotice('Finished. The report is ready.');
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
                <Link to={`?task=${encodeURIComponent(d.task.id)}`} className="text-brand hover:underline">
                  For <span className="font-mono">{d.task.key}</span>
                </Link>
              </>
            ) : null}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {finished ? (
            <Button variant="secondary" size="sm" onClick={() => void download()} loading={downloading}>
              {InspectIcon.download}
              <span className="ms-1">Report (PDF)</span>
            </Button>
          ) : null}
          {p.canTakeOver ? (
            <Button variant="secondary" size="sm" onClick={() => setConfirm('take-over')}>
              Take over
            </Button>
          ) : null}
          {p.canReopen ? (
            <Button variant="secondary" size="sm" onClick={() => setConfirm('reopen')}>
              Reopen
            </Button>
          ) : null}
          {p.canDelete ? (
            <Button variant="ghost" size="sm" onClick={() => setConfirm('delete')}>
              Delete
            </Button>
          ) : null}
        </div>
      </div>

      <div className="sticky top-14 z-20 mt-3">
        <SyncBanner
          view={view}
          sync={sync}
          online={online}
          onRetry={() => {
            if (ownerId) outbox.clearProblem(ownerId, id);
            void send();
          }}
          onDiscard={() => setConfirm('discard')}
          onLookAgain={() => {
            if (ownerId) outbox.clearProblem(ownerId, id);
            void q.refetch();
          }}
        />
        {view && q.isError && !q.data ? (
          <p role="status" className="rounded-xl border border-info/30 bg-info-soft px-3 py-2 text-sm text-info">
            No signal: showing the copy saved on this phone.
          </p>
        ) : null}
      </div>

      {problem ? (
        <p role="alert" className="mt-3 flex items-start justify-between gap-3 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
          <span>{problem}</span>
          <button type="button" onClick={() => setProblem(null)} aria-label="Dismiss" className="shrink-0 rounded px-1 opacity-80 hover:opacity-100">
            ✕
          </button>
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="mt-3 flex items-start justify-between gap-3 rounded-lg bg-success-soft px-3 py-2 text-sm text-success">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss" className="shrink-0 rounded px-1 opacity-80 hover:opacity-100">
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
            <Button size="sm" onClick={() => makeFollowUps(failedWithout)} disabled={!failedWithout.length}>
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
                  followUp={f || waitingFollowUps.has(item.id) ? { task: f?.task ?? null, pending: f?.pending ?? false, queued: waitingFollowUps.has(item.id) } : null}
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
              <Button variant="secondary" size="sm" onClick={() => ownerId && outbox.cancelFinish(ownerId, id)}>
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
                <Button onClick={startSigning} disabled={!canAnswer}>
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
            <InspectionClientSwitch inspectionId={id} clientVisible={d.clientVisible} canChange={p.canShowToClient} onChanged={refresh} />
          </div>
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
          Its answers can be changed again. The signatures come off (it is signed again when it’s finished), and it leaves the client page if it was shown there.
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
