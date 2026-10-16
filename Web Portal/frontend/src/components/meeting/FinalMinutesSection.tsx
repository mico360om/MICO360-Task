import { useEffect, useId, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { meetingsApi, type FinalMinutes, type FinalMinutesContent } from '../../api/meetings';
import { apiClient } from '../../api/client';
import { Button } from '../ui/Button';
import { fieldClass } from '../ui/Field';
import { LoadError, Section } from './kit';
import { exportMinutes, meetingFailure } from './meeting-actions';

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

/**
 * The final minutes of a meeting (the "Final MOM"): the organizer starts from a draft (written by the
 * AI from the meeting's agenda, notes and action items, or put together from the notes), edits it,
 * saves it and marks it final. Final minutes are read-only until reopened, are what the PDF "Final
 * MOM" and the minutes email carry, and are what attendees see.
 */
export function FinalMinutesSection({ meetingId, meetingTitle, canEdit, timeZone }: { meetingId: string; meetingTitle: string; canEdit: boolean; timeZone: string }) {
  const qc = useQueryClient();
  const api = meetingsApi(apiClient);
  const key = ['meeting', meetingId, 'final-minutes'];
  const q = useQuery({ queryKey: key, queryFn: () => api.getFinalMinutes(meetingId), enabled: !!meetingId });
  const fm = q.data;
  const [editing, setEditing] = useState<Editing | null>(null);
  const [changed, setChanged] = useState(false);
  const [problem, setProblem] = useState<{ text: string; aiFailed?: boolean } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // A saved draft opens in the editor (unless you are in the middle of changing it).
  useEffect(() => {
    if (!fm || changed) return;
    setEditing(fm.status === 'DRAFT' && fm.content ? toEditing(fm.content) : null);
  }, [fm, changed]);

  const settle = (next: FinalMinutes, message: string | null) => {
    qc.setQueryData(key, next);
    setChanged(false);
    setEditing(next.status === 'DRAFT' && next.content ? toEditing(next.content) : null);
    setProblem(null);
    setNotice(message);
  };
  const edit = (patch: Partial<Editing>) => {
    setEditing((e) => (e ? { ...e, ...patch } : e));
    setChanged(true);
    setNotice(null);
  };

  const draftMut = useMutation({
    mutationFn: (source: 'ai' | 'notes') => api.draftFinalMinutes(meetingId, source),
    onMutate: () => { setProblem(null); setNotice(null); },
    onSuccess: (res) => {
      setEditing(toEditing(res.content));
      setChanged(true);
      setNotice(res.source === 'ai' ? 'Drafted by the AI from the meeting’s agenda, notes and action items. Check it, then save it.' : 'Put together from the meeting’s notes. Edit it, then save it.');
    },
    onError: (err, source) => setProblem({ text: meetingFailure(err, 'Couldn’t make a draft.'), aiFailed: source === 'ai' }),
  });
  const saveMut = useMutation({
    mutationFn: (content: FinalMinutesContent) => api.saveFinalMinutes(meetingId, content),
    onSuccess: (next) => settle(next, 'Draft saved.'),
    onError: (err) => setProblem({ text: meetingFailure(err, 'Couldn’t save the minutes.') }),
  });
  const approveMut = useMutation({
    mutationFn: (content: FinalMinutesContent) => api.approveFinalMinutes(meetingId, content),
    onSuccess: (next) => { settle(next, 'The minutes are final. The PDF and the minutes email now carry this version.'); void qc.invalidateQueries({ queryKey: ['meeting', meetingId], exact: true }); },
    onError: (err) => setProblem({ text: meetingFailure(err, 'Couldn’t mark the minutes as final.') }),
  });
  const reopenMut = useMutation({
    mutationFn: () => api.reopenFinalMinutes(meetingId),
    onSuccess: (next) => settle(next, 'Reopened: the minutes can be changed again. Mark them final when they are ready.'),
    onError: (err) => setProblem({ text: meetingFailure(err, 'Couldn’t reopen the minutes.') }),
  });
  const pdfMut = useMutation({
    mutationFn: () => exportMinutes({ id: meetingId, title: meetingTitle }, 'final'),
    onError: (err) => setProblem({ text: meetingFailure(err, 'Couldn’t download the final minutes.') }),
  });
  const busy = draftMut.isPending || saveMut.isPending || approveMut.isPending || reopenMut.isPending;

  const startDraft = (source: 'ai' | 'notes') => {
    if (editing && !isEmpty(toContent(editing)) && !confirm('Replace what is written with a new draft?')) return;
    draftMut.mutate(source);
  };

  const status = fm?.status ?? 'NONE';
  // A draft says so beside the title; final minutes carry their own Final badge.
  const count = status !== 'FINAL' && (status === 'DRAFT' || editing) ? 'Draft' : undefined;

  return (
    <Section id="final-minutes" title="Final minutes" count={count}>
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

      {fm && status === 'FINAL' && fm.content ? (
        <FinalView minutes={fm} content={fm.content} timeZone={timeZone} canEdit={canEdit} busy={busy} downloading={pdfMut.isPending} onDownload={() => pdfMut.mutate()} onReopen={() => reopenMut.mutate()} />
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
          onApprove={() => {
            const content = toContent(editing);
            if (isEmpty(content)) return setProblem({ text: 'Write the minutes before marking them final.' });
            approveMut.mutate(content);
          }}
          onRedraft={startDraft}
          drafting={draftMut.isPending ? draftMut.variables ?? null : null}
        />
      ) : fm && canEdit ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-ink-2">
            The minutes you approve and send: a summary, what was discussed under each agenda item, the decisions, risks and next steps.
            Start from a draft, edit it, then mark it final.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" loading={draftMut.isPending && draftMut.variables === 'ai'} disabled={busy} onClick={() => startDraft('ai')}>
              Draft with AI
            </Button>
            <Button type="button" size="sm" variant="secondary" loading={draftMut.isPending && draftMut.variables === 'notes'} disabled={busy} onClick={() => startDraft('notes')}>
              Start from the notes
            </Button>
          </div>
        </div>
      ) : fm ? (
        <p className="text-sm text-ink-3">The final minutes aren’t ready yet.</p>
      ) : null}
    </Section>
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
          <button type="button" disabled={busy} onClick={() => onRedraft('ai')} className="font-semibold text-brand hover:underline disabled:opacity-60">
            {drafting === 'ai' ? 'Drafting…' : 'Redraft with AI'}
          </button>
          <button type="button" disabled={busy} onClick={() => onRedraft('notes')} className="font-semibold text-brand hover:underline disabled:opacity-60">
            {drafting === 'notes' ? 'Drafting…' : 'Start again from the notes'}
          </button>
        </span>
      </div>
    </div>
  );
}

function FinalView({
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
    ? new Intl.DateTimeFormat(undefined, { timeZone, day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(minutes.approvedAt))
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
      {content.summary ? <p dir="auto" className="whitespace-pre-line text-sm text-ink">{content.summary}</p> : null}
      {content.discussion.length ? (
        <div>
          <h3 className="text-sm font-semibold text-ink">Discussion</h3>
          <dl className="mt-1 space-y-2">
            {content.discussion.map((d, i) => (
              <div key={i}>
                <dt dir="auto" className="text-sm font-medium text-ink">{d.topic}</dt>
                <dd dir="auto" className="whitespace-pre-line text-sm text-ink-2">{d.text}</dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}
      {list('Decisions', content.decisions)}
      {list('Risks & open issues', content.risks)}
      {list('Next steps', content.nextSteps)}
      <div className="flex flex-wrap gap-2 border-t border-line pt-3">
        <Button type="button" size="sm" variant="secondary" loading={downloading} onClick={onDownload}>Download Final MOM (PDF)</Button>
        {canEdit ? <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={onReopen}>Reopen</Button> : null}
      </div>
    </div>
  );
}
