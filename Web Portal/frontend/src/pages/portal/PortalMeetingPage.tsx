import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { isNotShared, portalProblem, type PortalMeetingView, type PortalResponse } from '../../api/portal';
import { Button } from '../../components/ui/Button';
import { usePortalApi, usePreviewOff } from '../../components/portal/portal-context';
import { meetingChanged, usePortalMeeting } from '../../components/portal/portal-queries';
import { BackLink, Chip, day, LoadFailed, Loading, MinutesBody, NotShared, OWN_LINES, RESPONSE_TONE, RESPONSE_WORDS, Section, StatusBadge, TOUCH, usePortalPageName } from '../../components/portal/portal-ui';
import { downloadBlob, fileNameOf } from '../../lib/download';
import { NeedsModule, usePortalProjectContext } from './PortalProjectLayout';
import { meetingWhen } from './PortalMeetingsTab';

/**
 * 1.23 One meeting in the Client portal: for a meeting they were invited to, when and where it is,
 * its description and agenda topics, and (with the Reply action) Accept / Maybe / Decline; their own
 * action items from it ("Mark done"); and its approved minutes when shared (with a PDF to download).
 */
export function PortalMeetingPage() {
  return (
    <NeedsModule module="meetings">
      <MeetingPage />
    </NeedsModule>
  );
}

function MeetingPage() {
  const { projectId } = usePortalProjectContext();
  const { meetingId = '' } = useParams();
  const q = usePortalMeeting(projectId, meetingId);
  usePortalPageName(q.data?.meeting.title ?? null);
  const back = `/portal/projects/${encodeURIComponent(projectId)}/meetings`;
  return (
    <div className="flex flex-col gap-4">
      <BackLink to={back}>Meetings &amp; minutes</BackLink>
      {q.isPending ? (
        <Loading what="the meeting" />
      ) : q.isError ? (
        isNotShared(q.error) ? <NotShared backTo={back} backLabel="Back to the meetings" /> : <LoadFailed what="the meeting" onRetry={() => void q.refetch()} />
      ) : (
        <MeetingBody projectId={projectId} view={q.data} />
      )}
    </div>
  );
}

const ANSWERS: { value: Exclude<PortalResponse, 'PENDING'>; label: string }[] = [
  { value: 'ACCEPTED', label: 'Accept' },
  { value: 'TENTATIVE', label: 'Maybe' },
  { value: 'DECLINED', label: 'Decline' },
];

/** Only a web address opens as a link (never javascript: or other schemes). */
const webLink = (url: string | null) => (url && /^https?:\/\//i.test(url.trim()) ? url.trim() : null);

function MeetingBody({ projectId, view }: { projectId: string; view: PortalMeetingView }) {
  const { meeting: m, agenda, minutes, actionItems, can } = view;
  const qc = useQueryClient();
  const api = usePortalApi();
  const off = usePreviewOff();
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadProblem, setDownloadProblem] = useState<string | null>(null);

  const respond = useMutation({
    mutationFn: (answer: Exclude<PortalResponse, 'PENDING'>) => api.respond(projectId, m.id, answer),
    onSuccess: (fresh) => {
      meetingChanged(qc, projectId, fresh);
      setNotice(fresh.meeting.response ? `Your answer is saved: ${RESPONSE_WORDS[fresh.meeting.response]}.` : 'Your answer is saved.');
    },
    onError: (err) => setProblem(portalProblem(err, 'Couldn’t save your answer.')),
  });
  const markDone = useMutation({
    mutationFn: (itemId: string) => api.markDone(projectId, itemId),
    onSuccess: (fresh) => {
      meetingChanged(qc, projectId, fresh);
      setNotice('Marked done. The project team can see it.');
    },
    onError: (err) => setProblem(portalProblem(err, 'Couldn’t mark it done.')),
  });
  const download = async () => {
    setDownloading(true);
    setDownloadProblem(null);
    try {
      const blob = await api.minutesPdf(projectId, m.id);
      downloadBlob(fileNameOf(blob) ?? `minutes-${m.date}.pdf`, blob);
    } catch (err) {
      setDownloadProblem(portalProblem(err, 'Couldn’t download the minutes.'));
    } finally {
      setDownloading(false);
    }
  };
  const link = webLink(m.onlineLink);

  return (
    <>
      <article aria-labelledby="portal-meeting-title" className="card card-pad">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge label={m.status} />
          {m.invited && m.response ? <Chip tone={RESPONSE_TONE[m.response]}>{RESPONSE_WORDS[m.response]}</Chip> : null}
          {m.hasMinutes ? <Chip tone="info">Minutes</Chip> : null}
        </div>
        <h2 id="portal-meeting-title" dir="auto" className="mt-2 break-words font-display text-xl font-bold text-ink sm:text-2xl">{m.title}</h2>
        {m.cancelled ? <p className="mt-2 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">This meeting was cancelled.</p> : null}
        <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs text-ink-2">When</dt>
            <dd className="font-semibold text-ink">{meetingWhen(m)}</dd>
            <dd className="text-xs text-ink-2">Times in {m.timeZone}</dd>
          </div>
          {m.location ? (
            <div>
              <dt className="text-xs text-ink-2">Where</dt>
              <dd dir="auto" className="break-words font-semibold text-ink">{m.location}</dd>
            </div>
          ) : null}
          {m.onlineLink ? (
            <div className="sm:col-span-2">
              <dt className="text-xs text-ink-2">Online meeting</dt>
              <dd className="break-all">
                {link ? (
                  <a href={link} target="_blank" rel="noopener noreferrer" className={`${TOUCH} inline-flex items-center font-semibold text-brand underline-offset-2 hover:underline`}>
                    {link}
                  </a>
                ) : (
                  <span className="text-ink">{m.onlineLink}</span>
                )}
              </dd>
            </div>
          ) : null}
        </dl>
        {m.description ? (
          <div className="mt-4 border-t border-line pt-4">
            <h3 className="text-sm font-semibold text-ink">About this meeting</h3>
            <p className={`mt-1 max-w-[75ch] whitespace-pre-line break-words text-sm text-ink ${OWN_LINES}`}>{m.description}</p>
          </div>
        ) : null}
        {agenda.length ? (
          <div className="mt-4 border-t border-line pt-4">
            <h3 className="text-sm font-semibold text-ink">Agenda</h3>
            <ol className="mt-1 list-decimal space-y-1 ps-5 text-sm text-ink">
              {agenda.map((a, i) => (
                <li key={i}>
                  <bdi>{a.title}</bdi>
                  {a.minutes ? <span className="text-ink-2"> · {a.minutes} min</span> : null}
                </li>
              ))}
            </ol>
          </div>
        ) : null}
      </article>

      {notice ? <p role="status" className="rounded-lg bg-success-soft px-3 py-2 text-sm text-success">{notice}</p> : null}
      {problem ? <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{problem}</p> : null}

      {can.respond ? (
        <Section title="Will you attend?">
          <div role="group" aria-label="Your answer" className="flex flex-col gap-2 sm:flex-row">
            {ANSWERS.map((a) => {
              const chosen = m.response === a.value;
              return (
                <Button
                  key={a.value}
                  type="button"
                  variant={chosen ? 'primary' : 'secondary'}
                  aria-pressed={chosen}
                  className={`${TOUCH} ${off.className}`}
                  disabled={off.disabled}
                  title={off.title}
                  loading={respond.isPending && respond.variables === a.value}
                  onClick={() => {
                    setProblem(null);
                    setNotice(null);
                    respond.mutate(a.value);
                  }}
                >
                  {a.label}
                </Button>
              );
            })}
          </div>
          <p className="mt-2 text-xs text-ink-2">{m.response && m.response !== 'PENDING' ? `Your answer: ${RESPONSE_WORDS[m.response]}. You can change it.` : 'You haven’t answered yet.'}</p>
        </Section>
      ) : null}

      {actionItems.length ? (
        <Section title="Your action items">
          <ul className="divide-y divide-line">
            {actionItems.map((a) => (
              <li key={a.id} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <p className={`break-words text-sm font-medium ${a.done || a.cancelled ? 'text-ink-2' : 'text-ink'}`}><bdi>{a.description}</bdi></p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-ink-2">
                    <span>{a.dueDate ? `Due ${day(a.dueDate)}` : 'No due date'}</span>
                    {a.done ? <Chip tone="success">Done</Chip> : a.cancelled ? <Chip>Cancelled</Chip> : <Chip tone="brand">Open</Chip>}
                  </p>
                </div>
                {can.markDone && !a.done && !a.cancelled ? (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className={`${TOUCH} self-start sm:self-center ${off.className}`}
                    disabled={off.disabled}
                    title={off.title}
                    loading={markDone.isPending && markDone.variables === a.id}
                    aria-label={`Mark done: ${a.description}`}
                    onClick={() => {
                      setProblem(null);
                      setNotice(null);
                      markDone.mutate(a.id);
                    }}
                  >
                    Mark done
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {minutes ? (
        <Section
          title="Minutes"
          aside={
            can.downloadMinutes ? (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className={`${TOUCH} ${off.className}`}
                disabled={off.disabled}
                title={off.title}
                loading={downloading}
                onClick={() => void download()}
              >
                Download minutes (PDF)
              </Button>
            ) : null
          }
        >
          {minutes.approvedOn ? <p className="mb-3 text-xs text-ink-2">Approved {day(minutes.approvedOn)}</p> : null}
          {downloadProblem ? <p role="alert" className="mb-3 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{downloadProblem}</p> : null}
          <MinutesBody content={minutes.content} />
        </Section>
      ) : null}
    </>
  );
}
