import { clockText, dateTimeText } from '../../lib/day-words';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { meetingsApi, type AiDraftState, type FinalMinutes, type FinalMinutesContent } from '../../api/meetings';
import { apiClient } from '../../api/client';
import { Button } from '../ui/Button';
import { fieldClass } from '../ui/Field';
import { LoadError, Section } from './kit';
import { exportMinutes, meetingFailure } from './meeting-actions';
import { MinutesClientSwitch, minutesClientKey } from './MinutesClientSwitch';
import { minutesSendsKey } from './MinutesSentLog';
import { TOUCH_TALL } from '../../lib/touch';

/** The editor's copy: list sections are kept as typed text (one item per line) until saved. */
interface Editing {
  summary: string;
  discussion: Array<{ topic: string; text: string }>;
  decisions: string;
  risks: string;
  nextSteps: string;
}

const toEditing = (c: FinalMinutesContent): Editing => ({
  summary: c.summary,
  discussion: c.discussion.map((d) => ({ ...d })),
  decisions: c.decisions.join('\n'),
  risks: c.risks.join('\n'),
  nextSteps: c.nextSteps.join('\n'),
});
const lines = (text: string) => text.split('\n').map((l) => l.trim()).filter(Boolean);
const toContent = (e: Editing): FinalMinutesContent => ({
  summary: e.summary.trim(),
  discussion: e.discussion.map((d) => ({ topic: d.topic.trim(), text: d.text.trim() })).filter((d) => d.topic || d.text),
  decisions: lines(e.decisions),
  risks: lines(e.risks),
  nextSteps: lines(e.nextSteps),
});
const isEmpty = (c: FinalMinutesContent) => !c.summary && !c.discussion.length && !c.decisions.length && !c.risks.length && !c.nextSteps.length;
/** The AI is drafting (or waiting to try again): the page follows it. */
const isDrafting = (a: AiDraftState | null | undefined): a is Extract<AiDraftState, { status: 'running' | 'waiting' }> => a?.status === 'running' || a?.status === 'waiting';

/**
 * The final minutes of a meeting (the "Final MOM"): the organizer starts from a draft (written by the
 * AI from the meeting's agenda, notes and action items, or put together from the notes), edits it,
 * saves it and marks it final. Final minutes are read-only until reopened, open the minutes PDF (and
 * so the minutes email), marked final with who approved them, and are what attendees see.
 * `footer`: what follows them in the card (the minutes' "Sent" log, for the people who may send).
 *
 * 1.22: "Draft with AI" runs in the background — the card says so ("you can leave this page") and
 * follows it; the AI's text is saved as the draft when nobody wrote anything meanwhile, else it is
 * offered beside what was written: Use it, Compare, Discard. Typing here while it drafts counts as
 * writing too: the draft that arrives is offered, the typing kept.
 */
export function FinalMinutesSection({
  meetingId,
  meetingTitle,
  canEdit,
  timeZone,
  footer,
  finished = false,
  onEmail,
  pollMs = 3000,
}: {
  meetingId: string;
  meetingTitle: string;
  canEdit: boolean;
  timeZone: string;
  footer?: ReactNode;
  /** The meeting has ended: its next steps lead the card (for the people who may send). */
  finished?: boolean;
  /** Email minutes… (the next step once the minutes are final). */
  onEmail?: () => void;
  /** How often the card reads the minutes again while the AI drafts them (tests pass a short one). */
  pollMs?: number;
}) {
  const qc = useQueryClient();
  const api = meetingsApi(apiClient);
  const key = ['meeting', meetingId, 'final-minutes'];
  // While the AI drafts them, the minutes are read again every few seconds (and on the meeting's live event).
  const q = useQuery({ queryKey: key, queryFn: () => api.getFinalMinutes(meetingId), enabled: !!meetingId, refetchInterval: (query) => (isDrafting(query.state.data?.aiDraft) ? pollMs : false) });
  const fm = q.data;
  const aiDraft = fm?.aiDraft ?? null;
  // The next steps of a finished meeting read its notes and its "Sent" log (the same cached lists).
  const withSteps = finished && canEdit;
  const notesQ = useQuery({ queryKey: ['meeting', meetingId, 'notes'], queryFn: () => api.listNotes(meetingId), enabled: withSteps });
  const sendsQ = useQuery({ queryKey: [...minutesSendsKey(meetingId)], queryFn: () => api.listMinutesSends(meetingId), enabled: withSteps });
  const [editing, setEditing] = useState<Editing | null>(null);
  const [changed, setChanged] = useState(false);
  const [problem, setProblem] = useState<{ text: string; aiFailed?: boolean } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** Changes written here (typing, a draft from the notes): counted, so the AI's draft never goes over them unasked. */
  const edits = useRef(0);
  /** The count when the AI's draft was asked for here ("Replace what is written?" answered yes); null: not asked here. */
  const askedAt = useRef<number | null>(null);
  /** The AI draft that arrived saved while this page had changes typed since: offered here. */
  const [localOffer, setLocalOffer] = useState<{ id: string; content: FinalMinutesContent } | null>(null);
  /** The saved AI drafts this page has already dealt with. */
  const seen = useRef<string | null>(null);
  const [comparing, setComparing] = useState(false);

  // A saved draft opens in the editor (unless you are in the middle of changing it).
  useEffect(() => {
    if (!fm || changed) return;
    setEditing(fm.status === 'DRAFT' && fm.content ? toEditing(fm.content) : null);
  }, [fm, changed]);

  const settle = (next: FinalMinutes, message: string | null) => {
    qc.setQueryData(key, next);
    // Approved or reopened: whether the client sees them may have changed (reopening hides them).
    void qc.invalidateQueries({ queryKey: minutesClientKey(meetingId) });
    setChanged(false);
    setEditing(next.status === 'DRAFT' && next.content ? toEditing(next.content) : null);
    setProblem(null);
    setNotice(message);
    // Saved, approved or reopened: an AI draft offered against the typing no longer stands.
    setLocalOffer(null);
  };
  const edit = (patch: Partial<Editing>) => {
    setEditing((e) => (e ? { ...e, ...patch } : e));
    setChanged(true);
    setNotice(null);
    edits.current += 1;
  };

  // The AI's draft was saved as the draft: it opens in the editor — unless something was typed here
  // since it was asked for: then it is offered beside the typing (owner: keep their edits).
  useEffect(() => {
    if (!fm || aiDraft?.status !== 'saved' || seen.current === aiDraft.id) return;
    seen.current = aiDraft.id;
    const asked = askedAt.current;
    askedAt.current = null;
    if (!changed || !fm.content) return;
    if (asked === null || edits.current > asked) setLocalOffer({ id: aiDraft.id, content: fm.content });
    else {
      // Asked here with "Replace what is written?" answered yes, and nothing written since: it takes its place.
      setEditing(toEditing(fm.content));
      setChanged(false);
    }
  }, [fm, aiDraft, changed]);
  // The offer against the typing holds only while the AI's draft is still the saved one.
  useEffect(() => {
    if (localOffer && !(aiDraft?.status === 'saved' && aiDraft.id === localOffer.id)) setLocalOffer(null);
  }, [aiDraft, localOffer]);

  // From the notes: at once, into the editor (not kept until saved).
  const draftMut = useMutation({
    mutationFn: (source: 'ai' | 'notes') => api.draftFinalMinutes(meetingId, source),
    onMutate: () => { setProblem(null); setNotice(null); },
    onSuccess: (res) => {
      setEditing(toEditing(res.content));
      setChanged(true);
      edits.current += 1; // a draft from the notes is something written here
      setNotice(res.source === 'ai' ? 'Drafted by the AI from the meeting’s agenda, notes and action items. Check it, then save it.' : 'Put together from the meeting’s notes. Edit it, then save it.');
    },
    onError: (err, source) => setProblem({ text: meetingFailure(err, 'Couldn’t make a draft.'), aiFailed: source === 'ai' }),
  });
  // With the AI: in the background (1.22) — answered at once; the card follows it.
  const aiMut = useMutation({
    mutationFn: () => api.draftFinalMinutesWithAi(meetingId),
    onMutate: () => {
      setProblem(null);
      setNotice(null);
      setLocalOffer(null);
      setComparing(false);
      return { at: edits.current };
    },
    onSuccess: (res, _v, ctx) => {
      // Asked (only now: a request that failed asked nothing): what is written now may be replaced.
      askedAt.current = ctx?.at ?? edits.current;
      qc.setQueryData<FinalMinutes>(key, (old) => (old ? { ...old, aiDraft: res.aiDraft } : old));
      void qc.invalidateQueries({ queryKey: key, exact: true });
    },
    onError: (err) => setProblem({ text: meetingFailure(err, 'Couldn’t ask the AI for a draft.'), aiFailed: true }),
  });
  const offerMut = useMutation({
    mutationFn: ({ jobId, use }: { jobId: string; use: boolean }) => (use ? api.useAiDraft(meetingId, jobId) : api.discardAiDraft(meetingId, jobId)),
    onSuccess: (next, { use }) => {
      setComparing(false);
      if (use) settle(next, 'The AI draft is now the draft. Check it, then mark it final.');
      else qc.setQueryData(key, next);
    },
    onError: (err, { use }) => {
      setProblem({ text: meetingFailure(err, use ? 'Couldn’t use the AI draft.' : 'Couldn’t discard the AI draft.') });
      void qc.invalidateQueries({ queryKey: key, exact: true });
    },
  });
  const saveMut = useMutation({
    mutationFn: (content: FinalMinutesContent) => api.saveFinalMinutes(meetingId, content),
    onSuccess: (next) => settle(next, 'Draft saved.'),
    onError: (err) => setProblem({ text: meetingFailure(err, 'Couldn’t save the minutes.') }),
  });
  const approveMut = useMutation({
    mutationFn: (content: FinalMinutesContent) => api.approveFinalMinutes(meetingId, content),
    onSuccess: (next) => { settle(next, 'The Final MOM is approved. The minutes PDF and the minutes email now open with it.'); void qc.invalidateQueries({ queryKey: ['meeting', meetingId], exact: true }); },
    onError: (err) => setProblem({ text: meetingFailure(err, 'Couldn’t mark the minutes as final.') }),
  });
  const reopenMut = useMutation({
    mutationFn: () => api.reopenFinalMinutes(meetingId),
    onSuccess: (next) => settle(next, 'Reopened: the minutes can be changed again. Mark them final when they are ready.'),
    onError: (err) => setProblem({ text: meetingFailure(err, 'Couldn’t reopen the minutes.') }),
  });
  const pdfMut = useMutation({
    mutationFn: () => exportMinutes({ id: meetingId, title: meetingTitle }, 'final'),
    onError: (err) => setProblem({ text: meetingFailure(err, 'Couldn’t download the minutes.') }),
  });
  const busy = draftMut.isPending || aiMut.isPending || offerMut.isPending || saveMut.isPending || approveMut.isPending || reopenMut.isPending;
  /** The AI is drafting them (asked here or elsewhere): asking again would only join it. */
  const aiBusy = aiMut.isPending || isDrafting(aiDraft);

  const startDraft = (source: 'ai' | 'notes') => {
    if (editing && !isEmpty(toContent(editing)) && !confirm(source === 'ai' ? 'Replace what is written with the AI’s draft when it’s ready?' : 'Replace what is written with a new draft?')) return;
    if (source === 'ai') aiMut.mutate();
    else draftMut.mutate(source);
  };
  /** Use the offered AI draft (the server's, or the one saved while this page had changes typed). */
  const useOffer = (offer: { id: string; local: boolean }) => {
    if (editing && changed && !offer.local && !confirm('Replace what is written with the AI draft?')) return;
    if (offer.local && localOffer && fm) {
      setEditing(toEditing(localOffer.content));
      setChanged(false);
      setLocalOffer(null);
      setComparing(false);
      setNotice('The AI draft is now the draft. Check it, then mark it final.');
      return;
    }
    offerMut.mutate({ jobId: offer.id, use: true });
  };
  const discardOffer = (offer: { id: string; local: boolean }) => {
    setComparing(false);
    if (offer.local) setLocalOffer(null);
    else offerMut.mutate({ jobId: offer.id, use: false });
  };
  const offer = aiDraft?.status === 'ready' ? { id: aiDraft.id, local: false, content: aiDraft.content, final: aiDraft.reason === 'final' } : localOffer ? { id: localOffer.id, local: true, content: localOffer.content, final: false } : null;
  const written = editing ? toContent(editing) : fm?.content ?? null;

  /** Mark what is in the editor final (it must say something). */
  const approve = () => {
    const content = editing ? toContent(editing) : null;
    if (!content || isEmpty(content)) return setProblem({ text: 'Write the minutes before marking them final.' });
    approveMut.mutate(content);
  };

  const status = fm?.status ?? 'NONE';
  // A draft says so beside the title; final minutes carry their own Final badge.
  const count = status !== 'FINAL' && (status === 'DRAFT' || editing) ? 'Draft' : undefined;

  return (
    <Section id="final-minutes" title="Final MOM" count={count}>
      {withSteps && fm ? (
        <NextSteps
          notes={Array.isArray(notesQ.data) && notesQ.data.length > 0}
          drafted={status !== 'NONE' || !!editing}
          approved={status === 'FINAL'}
          emailed={Array.isArray(sendsQ.data) && sendsQ.data.some((s) => s.final)}
          busy={busy || aiBusy}
          drafting={aiBusy}
          approving={approveMut.isPending}
          onDraft={() => startDraft('ai')}
          onApprove={approve}
          onEmail={onEmail}
        />
      ) : null}
      {q.isLoading ? <p className="text-sm text-ink-3">Loading…</p> : null}
      {q.isError ? <LoadError what="the final minutes" onRetry={() => void q.refetch()} /> : null}

      {problem ? (
        <div role="alert" className="mb-3 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
          {problem.text}
          {problem.aiFailed ? (
            <>
              {' '}
              <button type="button" className="font-semibold underline" onClick={() => draftMut.mutate('notes')}>Start from the notes</button>
              {' '}instead.
            </>
          ) : null}
        </div>
      ) : null}
      {notice ? <p role="status" className="mb-3 rounded-lg bg-ground px-3 py-2 text-sm text-ink-2">{notice}</p> : null}
      {canEdit && aiDraft ? (
        <AiDraftNote
          state={aiDraft}
          timeZone={timeZone}
          busy={busy}
          onRetry={() => startDraft('ai')}
          onNotes={() => startDraft('notes')}
          onDismiss={() => offerMut.mutate({ jobId: aiDraft.id, use: false })}
        />
      ) : null}
      {canEdit && offer ? (
        <AiOffer
          local={offer.local}
          final={offer.final}
          busy={busy}
          comparing={comparing}
          onUse={() => useOffer(offer)}
          onCompare={() => setComparing((c) => !c)}
          onDiscard={() => discardOffer(offer)}
        >
          {comparing ? <Compare written={written} drafted={offer.content} /> : null}
        </AiOffer>
      ) : null}

      {fm && status === 'FINAL' && fm.content ? (
        <div className="flex flex-col gap-4">
          <FinalView minutes={fm} content={fm.content} timeZone={timeZone} canEdit={canEdit} busy={busy} downloading={pdfMut.isPending} onDownload={() => pdfMut.mutate()} onReopen={() => reopenMut.mutate()} />
          <MinutesClientSwitch meetingId={meetingId} />
        </div>
      ) : editing && canEdit ? (
        <Editor
          value={editing}
          onChange={edit}
          busy={busy}
          saving={saveMut.isPending}
          approving={approveMut.isPending}
          savedAt={fm?.savedAt ?? null}
          changed={changed}
          onSave={() => saveMut.mutate(toContent(editing))}
          onApprove={approve}
          onRedraft={startDraft}
          drafting={aiBusy ? 'ai' : draftMut.isPending ? draftMut.variables ?? null : null}
        />
      ) : fm && canEdit ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-ink-2">
            The minutes you approve and send: a summary, what was discussed under each agenda item, the decisions, risks and next steps.
            Start from a draft, edit it, then mark it final.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" loading={aiBusy} disabled={busy || aiBusy} onClick={() => startDraft('ai')} className={TOUCH_TALL}>
              Draft with AI
            </Button>
            <Button type="button" size="sm" variant="secondary" loading={draftMut.isPending && draftMut.variables === 'notes'} disabled={busy} onClick={() => startDraft('notes')} className={TOUCH_TALL}>
              Start from the notes
            </Button>
          </div>
        </div>
      ) : fm ? (
        <p className="text-sm text-ink-3">The final minutes aren’t ready yet.</p>
      ) : null}
      {footer}
    </Section>
  );
}

/**
 * 1.22: what the AI is doing with the minutes — drafting (you can leave the page), waiting to try
 * again, saved as the draft, or failed for good (Try again, Start from the notes, Dismiss).
 */
function AiDraftNote({
  state,
  timeZone,
  busy,
  onRetry,
  onNotes,
  onDismiss,
}: {
  state: AiDraftState;
  timeZone: string;
  busy: boolean;
  onRetry: () => void;
  onNotes: () => void;
  onDismiss: () => void;
}) {
  if (state.status === 'running' || state.status === 'waiting') {
    const who = state.mine ? null : state.requestedBy.name ?? 'Someone';
    const tryAgain =
      state.status === 'waiting' && state.nextTryAt
        ? ` The AI service didn’t answer, so it will try again at ${clockText(state.nextTryAt, timeZone)} (try ${state.attempt} of ${state.maxAttempts}).`
        : '';
    return (
      <div role="status" data-ai-draft={state.status} className="mb-3 flex items-start gap-2 rounded-lg border border-brand/30 bg-brand/5 px-3 py-2 text-sm text-ink">
        <span aria-hidden="true" className="mt-1 inline-block h-3 w-3 flex-none animate-spin rounded-full border-2 border-brand border-t-transparent motion-reduce:animate-none" />
        <p>
          <span className="font-semibold">{who ? `${who} asked the AI for a draft.` : 'Drafting with AI…'}</span>
          {tryAgain}{' '}
          {who
            ? 'It will be saved as the draft when it’s ready, unless the minutes are changed meanwhile.'
            : 'You can leave this page — it will be saved as the draft and you’ll be told when it’s ready.'}
        </p>
      </div>
    );
  }
  if (state.status === 'saved') {
    return (
      <p role="status" data-ai-draft="saved" className="mb-3 rounded-lg bg-ground px-3 py-2 text-sm text-ink-2">
        Drafted by the AI and saved as the draft on {dateTimeText(state.finishedAt, timeZone)}. Check it, then mark it final.
      </p>
    );
  }
  if (state.status === 'failed') {
    return (
      <div role="alert" data-ai-draft="failed" className="mb-3 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
        <p>
          <span className="font-semibold">Couldn’t draft with AI.</span> {state.error}
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={onRetry} className={TOUCH_TALL}>Try again</Button>
          <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={onNotes} className={TOUCH_TALL}>Start from the notes</Button>
          <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={onDismiss} className={TOUCH_TALL}>Dismiss</Button>
        </div>
      </div>
    );
  }
  return null;
}

/** 1.22: an AI draft ready beside what was written (owner: keep their edits) — Use it, Compare, Discard. */
function AiOffer({
  local,
  final,
  busy,
  comparing,
  onUse,
  onCompare,
  onDiscard,
  children,
}: {
  local: boolean;
  final: boolean;
  busy: boolean;
  comparing: boolean;
  onUse: () => void;
  onCompare: () => void;
  onDiscard: () => void;
  children?: ReactNode;
}) {
  const why = final
    ? 'These minutes were marked final while the AI was drafting, so they were kept. Reopen them to use the AI draft.'
    : local
      ? 'It was saved as the draft while you were writing here. Your changes aren’t saved yet: use the AI draft, or discard it and keep writing (saving replaces it).'
      : 'The minutes were changed while the AI was drafting, so they were kept as they are.';
  return (
    <section aria-label="AI draft ready" data-ai-offer={local ? 'local' : 'server'} className="mb-4 rounded-xl border border-brand/40 bg-brand/5 p-3">
      <p className="text-sm font-semibold text-ink">An AI draft is ready</p>
      <p className="mt-0.5 text-sm text-ink-2">{why}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {final ? null : <Button type="button" size="sm" disabled={busy} onClick={onUse} className={TOUCH_TALL}>Use it</Button>}
        <Button type="button" size="sm" variant="secondary" aria-expanded={comparing} disabled={busy} onClick={onCompare} className={TOUCH_TALL}>{comparing ? 'Hide comparison' : 'Compare'}</Button>
        <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={onDiscard} className={TOUCH_TALL}>Discard</Button>
      </div>
      {children}
    </section>
  );
}

/** What is written now beside the AI's draft, section by section (one column on a phone). */
function Compare({ written, drafted }: { written: FinalMinutesContent | null; drafted: FinalMinutesContent }) {
  return (
    <div className="mt-3 grid gap-3 md:grid-cols-2">
      <div className="min-w-0 rounded-lg border border-line bg-surface p-3">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-3">Written now</h3>
        {written && !isEmpty(written) ? <ContentView content={written} /> : <p className="text-sm text-ink-3">Nothing written yet.</p>}
      </div>
      <div className="min-w-0 rounded-lg border border-brand/40 bg-surface p-3">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-brand">AI draft</h3>
        <ContentView content={drafted} />
      </div>
    </div>
  );
}

/** Minutes, read: each part with its items (as the final view shows them). */
function ContentView({ content }: { content: FinalMinutesContent }) {
  const list = (title: string, items: string[]) =>
    items.length ? (
      <div>
        <h4 className="text-sm font-semibold text-ink">{title}</h4>
        <ul className="mt-1 list-disc space-y-0.5 ps-5 text-sm text-ink">{items.map((t, i) => <li key={i} dir="auto">{t}</li>)}</ul>
      </div>
    ) : null;
  return (
    <div className="flex flex-col gap-3 text-sm">
      {content.summary ? <p className="whitespace-pre-line text-start text-ink [unicode-bidi:plaintext]">{content.summary}</p> : null}
      {content.discussion.length ? (
        <div>
          <h4 className="text-sm font-semibold text-ink">Discussion</h4>
          <dl className="mt-1 space-y-1.5">
            {content.discussion.map((d, i) => (
              <div key={i}>
                <dt dir="auto" className="font-medium text-ink">{d.topic}</dt>
                <dd className="whitespace-pre-line text-start text-ink-2 [unicode-bidi:plaintext]">{d.text}</dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}
      {list('Decisions', content.decisions)}
      {list('Risks & open issues', content.risks)}
      {list('Next steps', content.nextSteps)}
    </div>
  );
}

const STEPS = ['Notes', 'Final MOM', 'Approved', 'Emailed'] as const;

/**
 * Where a finished meeting's minutes are (owner, 1.22): Notes → Final MOM → Approved → Emailed (the
 * final minutes, from the "Sent" log), the current step marked, and the one next button.
 */
function NextSteps({
  notes,
  drafted,
  approved,
  emailed,
  busy,
  drafting,
  approving,
  onDraft,
  onApprove,
  onEmail,
}: {
  notes: boolean;
  drafted: boolean;
  approved: boolean;
  emailed: boolean;
  busy: boolean;
  drafting: boolean;
  approving: boolean;
  onDraft: () => void;
  onApprove: () => void;
  onEmail?: () => void;
}) {
  const done = [notes || drafted, drafted, approved, approved && emailed];
  const current = done.indexOf(false);
  const next =
    current === -1 ? null : current <= 1 ? (
      <Button type="button" size="sm" loading={drafting} disabled={busy} onClick={onDraft} className={TOUCH_TALL}>Draft with AI</Button>
    ) : current === 2 ? (
      <Button type="button" size="sm" loading={approving} disabled={busy} onClick={onApprove} className={TOUCH_TALL}>Approve</Button>
    ) : onEmail ? (
      <Button type="button" size="sm" onClick={onEmail} className={TOUCH_TALL}>Email minutes…</Button>
    ) : null;
  return (
    <nav aria-label="Next steps" className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-ground/50 px-3 py-2">
      <ol className="flex flex-wrap items-center gap-x-1 gap-y-1 text-xs">
        {STEPS.map((label, i) => (
          <li
            key={label}
            aria-current={i === current ? 'step' : undefined}
            className={`inline-flex items-center gap-1 rounded-full px-2 py-1 ${done[i] ? 'text-success' : i === current ? 'bg-brand/10 font-semibold text-brand' : 'text-ink-3'}`}
          >
            <span aria-hidden="true" className="tabular-nums">{done[i] ? '✓' : i + 1}</span>
            {label}
            {done[i] ? <span className="sr-only"> (done)</span> : null}
            {i < STEPS.length - 1 ? <span aria-hidden="true" className="ms-1 text-ink-3">→</span> : null}
          </li>
        ))}
      </ol>
      {current === -1 ? <p className="text-xs font-medium text-success">All done — the final minutes were emailed.</p> : next}
    </nav>
  );
}

function Editor({
  value,
  onChange,
  busy,
  saving,
  approving,
  savedAt,
  changed,
  onSave,
  onApprove,
  onRedraft,
  drafting,
}: {
  value: Editing;
  onChange: (patch: Partial<Editing>) => void;
  busy: boolean;
  saving: boolean;
  approving: boolean;
  savedAt: string | null;
  changed: boolean;
  onSave: () => void;
  onApprove: () => void;
  onRedraft: (source: 'ai' | 'notes') => void;
  drafting: 'ai' | 'notes' | null;
}) {
  const id = useId();
  const area = `${fieldClass(false)} block w-full resize-y leading-relaxed`;
  const setTopic = (i: number, patch: Partial<{ topic: string; text: string }>) =>
    onChange({ discussion: value.discussion.map((d, j) => (j === i ? { ...d, ...patch } : d)) });
  const listField = (key: 'decisions' | 'risks' | 'nextSteps', label: string, hint: string) => (
    <div>
      <label htmlFor={`${id}-${key}`} className="text-sm font-semibold text-ink">{label} <span className="text-xs font-normal text-ink-3">— one per line</span></label>
      <textarea id={`${id}-${key}`} dir="auto" rows={3} value={value[key]} onChange={(e) => onChange({ [key]: e.target.value })} placeholder={hint} className={`${area} mt-1`} />
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      <div>
        <label htmlFor={`${id}-summary`} className="text-sm font-semibold text-ink">Summary</label>
        <textarea id={`${id}-summary`} dir="auto" rows={3} value={value.summary} onChange={(e) => onChange({ summary: e.target.value })} placeholder="What the meeting was for and what came of it." className={`${area} mt-1`} />
      </div>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 text-sm font-semibold text-ink">Discussion</legend>
        {value.discussion.length === 0 ? <p className="text-xs text-ink-3">No topics yet.</p> : null}
        {value.discussion.map((d, i) => (
          <div key={i} className="rounded-xl border border-line p-3">
            <div className="flex items-center gap-2">
              <input
                aria-label={`Topic ${i + 1}`}
                dir="auto"
                value={d.topic}
                onChange={(e) => setTopic(i, { topic: e.target.value })}
                placeholder="Agenda item or topic"
                className={`${fieldClass(false)} min-w-0 flex-1 font-semibold`}
              />
              <button
                type="button"
                aria-label={`Remove topic ${i + 1}`}
                onClick={() => onChange({ discussion: value.discussion.filter((_, j) => j !== i) })}
                className="rounded px-2 text-lg leading-none text-ink-3 hover:bg-ground hover:text-danger"
              >
                ×
              </button>
            </div>
            <textarea
              aria-label={`What was discussed under topic ${i + 1}`}
              dir="auto"
              rows={2}
              value={d.text}
              onChange={(e) => setTopic(i, { text: e.target.value })}
              className={`${area} mt-2`}
            />
          </div>
        ))}
        <button type="button" onClick={() => onChange({ discussion: [...value.discussion, { topic: '', text: '' }] })} className="self-start text-sm font-semibold text-brand hover:underline">
          + Add a topic
        </button>
      </fieldset>

      {listField('decisions', 'Decisions', 'e.g. Go-live moves to 1 November.')}
      {listField('risks', 'Risks & open issues', 'e.g. Field tablets may not be updated in time.')}
      {listField('nextSteps', 'Next steps', 'e.g. Send the revised form to the client — Bilal, by 18 Oct')}

      <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
        <Button type="button" size="sm" variant="secondary" loading={saving} disabled={busy} onClick={onSave}>Save draft</Button>
        <Button type="button" size="sm" loading={approving} disabled={busy} onClick={onApprove}>Mark as final</Button>
        <span className="text-xs text-ink-3">{changed ? 'Not saved yet.' : savedAt ? 'Saved.' : ''}</span>
        <span className="ms-auto flex flex-wrap gap-3 text-sm">
          <button type="button" disabled={busy || drafting === 'ai'} onClick={() => onRedraft('ai')} className={`font-semibold text-brand hover:underline disabled:opacity-60 ${TOUCH_TALL}`}>
            {drafting === 'ai' ? 'Drafting…' : 'Redraft with AI'}
          </button>
          <button type="button" disabled={busy} onClick={() => onRedraft('notes')} className={`font-semibold text-brand hover:underline disabled:opacity-60 ${TOUCH_TALL}`}>
            {drafting === 'notes' ? 'Drafting…' : 'Start again from the notes'}
          </button>
        </span>
      </div>
    </div>
  );
}

/** Approved minutes, read: who approved them and when, their parts, the PDF (and Reopen for an editor). */
export function FinalView({
  minutes,
  content,
  timeZone,
  canEdit,
  busy,
  downloading,
  onDownload,
  onReopen,
}: {
  minutes: FinalMinutes;
  content: FinalMinutesContent;
  timeZone: string;
  canEdit: boolean;
  busy: boolean;
  downloading: boolean;
  onDownload: () => void;
  onReopen: () => void;
}) {
  const when = minutes.approvedAt
    ? dateTimeText(minutes.approvedAt, timeZone)
    : null;
  const list = (title: string, items: string[]) =>
    items.length ? (
      <div>
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
        <ul className="mt-1 list-disc space-y-0.5 ps-5 text-sm text-ink">
          {items.map((t, i) => <li key={i} dir="auto">{t}</li>)}
        </ul>
      </div>
    ) : null;
  return (
    <div className="flex flex-col gap-4">
      <p className="flex flex-wrap items-center gap-2 text-sm text-ink-2">
        <span className="rounded-full bg-success-soft px-2 py-0.5 text-xs font-semibold text-success">Final</span>
        Approved by {minutes.approvedBy?.name ?? 'someone'}{when ? ` on ${when}` : ''}.
      </p>
      {/* A readable measure on a wide screen: about 75 characters a line (ch of the text's own size). */}
      <div className="flex max-w-[75ch] flex-col gap-4 text-sm">
        {/* Each line takes its own direction, so English and Arabic lines sit side by side (as in the notes). */}
        {content.summary ? <p className="whitespace-pre-line text-start text-sm text-ink [unicode-bidi:plaintext]">{content.summary}</p> : null}
        {content.discussion.length ? (
          <div>
            <h3 className="text-sm font-semibold text-ink">Discussion</h3>
            <dl className="mt-1 space-y-2">
              {content.discussion.map((d, i) => (
                <div key={i}>
                  <dt dir="auto" className="text-sm font-medium text-ink">{d.topic}</dt>
                  <dd className="whitespace-pre-line text-start text-sm text-ink-2 [unicode-bidi:plaintext]">{d.text}</dd>
                </div>
              ))}
            </dl>
          </div>
        ) : null}
        {list('Decisions', content.decisions)}
        {list('Risks & open issues', content.risks)}
        {list('Next steps', content.nextSteps)}
      </div>
      <div className="flex flex-wrap gap-2 border-t border-line pt-3">
        <Button type="button" size="sm" variant="secondary" loading={downloading} onClick={onDownload}>Download minutes (PDF)</Button>
        {canEdit ? <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={onReopen}>Reopen</Button> : null}
      </div>
    </div>
  );
}
