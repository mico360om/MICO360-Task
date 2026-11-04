import { useEffect, useState, type KeyboardEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { meetingsApi, type Meeting, type MinutesAddressee, type MinutesCopy, type MinutesSend } from '../../api/meetings';
import { apiClient } from '../../api/client';
import { usersApi } from '../../api/users';
import { useDialog } from '../../hooks/useDialog';
import { ModalPortal } from '../ui/ModalPortal';
import { Button } from '../ui/Button';
import { fieldClass } from '../ui/Field';
import { SearchableSelect } from '../ui/SearchableSelect';
import { useInviteCandidates } from '../meeting-form/invite-candidates';
import { colleaguesOf } from '../../lib/people';
import { TOUCH_SQUARE, TOUCH_TALL } from '../../lib/touch';
import { meetingFailure, exportMinutes } from './meeting-actions';
import { SendResults } from './InviteDialog';
import { minutesSendsKey } from './MinutesSentLog';

const people = (n: number) => `${n} ${n === 1 ? 'person' : 'people'}`;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** The most addresses one send may go to (as the server: Mailjet takes 50 per email). */
export const MAX_ADDRESSES = 50;

/** Someone added to To or Cc: a colleague picked by name, or an address (typed, suggested, or from an earlier send). */
type Added = { kind: 'user'; userId: string; name: string } | { kind: 'address'; email: string; name: string | null };
const keyOf = (a: Added) => (a.kind === 'user' ? `u:${a.userId}` : `e:${a.email.toLowerCase()}`);
const labelOf = (a: Added) => (a.kind === 'user' ? a.name : a.name || a.email);
const addresseeOf = (a: Added): MinutesAddressee => (a.kind === 'user' ? { userId: a.userId } : { email: a.email });

/** Why one of the meeting's people gets their own email, or nothing. */
const COPY_NOTE: Partial<Record<MinutesCopy, string>> = {
  own: 'Their own email (another company)',
  later: 'Gets the minutes once they’re final',
  none: 'Can’t open this meeting',
};
const canGet = (copy: MinutesCopy | undefined) => copy !== 'later' && copy !== 'none';

/** To and Cc of an earlier send, to start from (Send again). */
export type MinutesPrefill = Pick<MinutesSend, 'to' | 'cc'>;

/**
 * Email the minutes PDF: ONE email with real To and Cc lines — everyone on it sees who got it. To
 * starts with the meeting's people, ticked; colleagues and typed addresses can be added to To or Cc
 * (typed addresses get the email only, they aren't added to the meeting). An address is on it once:
 * To wins over Cc. Someone invited from another company gets their own email with their own copy.
 * Shows the email as it will arrive (its To and Cc lines, subject, body and attachment).
 */
export function MinutesEmailDialog({ meeting, onClose, prefill }: { meeting: Meeting; onClose: () => void; prefill?: MinutesPrefill }) {
  const qc = useQueryClient();
  const api = meetingsApi(apiClient);
  const dialogRef = useDialog(onClose);
  const previewQ = useQuery({ queryKey: ['meeting', meeting.id, 'minutes-preview'], queryFn: () => api.previewMinutes(meeting.id), staleTime: 0, gcTime: 0 });
  const suggestionsQ = useQuery({ queryKey: ['meeting', meeting.id, 'minutes-suggestions'], queryFn: () => api.minutesSuggestions(meeting.id), staleTime: 60_000 });
  const dirQ = useQuery({ queryKey: ['directory'], queryFn: () => usersApi(apiClient).directory() });
  const candidates = useInviteCandidates({ projectId: meeting.projectId, companyId: meeting.companyId });
  const preview = previewQ.data;
  const roster = preview?.recipients ?? [];

  const [left, setLeft] = useState<Set<string>>(new Set());
  const [addedTo, setAddedTo] = useState<Added[]>([]);
  const [cc, setCc] = useState<Added[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);

  // Send again: the earlier send's To and Cc, once the meeting's people are known.
  const [prefilled, setPrefilled] = useState(!prefill);
  useEffect(() => {
    if (prefilled || !preview || !prefill) return;
    const onMeeting = new Set(preview.recipients.map((r) => r.email.toLowerCase()));
    const wasTo = new Set(prefill.to.map((a) => a.email.toLowerCase()));
    const asAdded = (a: { email: string; name: string | null }): Added => ({ kind: 'address', email: a.email, name: a.name });
    setLeft(new Set(preview.recipients.filter((r) => !wasTo.has(r.email.toLowerCase())).map((r) => r.email.toLowerCase())));
    setAddedTo(prefill.to.filter((a) => !onMeeting.has(a.email.toLowerCase())).map(asAdded));
    setCc(prefill.cc.filter((a) => !wasTo.has(a.email.toLowerCase())).map(asAdded));
    setPrefilled(true);
  }, [prefilled, preview, prefill]);

  const ticked = roster.filter((r) => canGet(r.copy) && !left.has(r.email.toLowerCase()));
  const toKeys = new Set([...ticked.flatMap((r) => [`e:${r.email.toLowerCase()}`, ...(r.userId ? [`u:${r.userId}`] : [])]), ...addedTo.map(keyOf)]);
  const ccKeys = new Set(cc.map(keyOf));
  const toCount = ticked.length + addedTo.length;
  const count = toCount + cc.length;
  const tooMany = count > MAX_ADDRESSES;
  const ownCopies = ticked.filter((r) => r.copy === 'own');

  const send = useMutation({
    mutationFn: () => api.sendMinutes(meeting.id, { to: [...ticked.map((r) => ({ email: r.email })), ...addedTo.map(addresseeOf)], cc: cc.map(addresseeOf) }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: [...minutesSendsKey(meeting.id)] }),
    onError: (err) => setError(meetingFailure(err, 'Couldn’t email the minutes.')),
  });

  const toggle = (email: string) =>
    setLeft((s) => {
      const next = new Set(s);
      const key = email.toLowerCase();
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  /** On To: off Cc (To wins). Returns a problem, or null. */
  const addToTo = (a: Added): string | null => {
    const key = keyOf(a);
    if (toKeys.has(key)) return 'That’s already on To.';
    const mine = a.kind === 'address' ? roster.find((r) => r.email.toLowerCase() === a.email.toLowerCase()) : undefined;
    if (mine) {
      if (!canGet(mine.copy)) return `${mine.name} can’t get these minutes.`;
      // One of the meeting's people: tick them rather than adding them twice.
      setLeft((s) => new Set([...s].filter((e) => e !== mine.email.toLowerCase())));
    } else setAddedTo((list) => [...list, a]);
    setCc((list) => list.filter((x) => keyOf(x) !== key));
    return null;
  };
  const addToCc = (a: Added): string | null => {
    const key = keyOf(a);
    if (toKeys.has(key)) return 'That’s already on To.';
    if (ccKeys.has(key)) return 'That’s already on Cc.';
    setCc((list) => [...list, a]);
    return null;
  };

  // Colleagues the invite picker offers (inactive accounts can't be), not already on the email.
  const directory = Array.isArray(dirQ.data) ? dirQ.data : [];
  const colleagues = (candidates ?? colleaguesOf(directory)).filter((u) => (u as { active?: boolean }).active !== false);
  const nameOf = (u: { firstName: string; lastName: string; username: string }) => `${u.firstName} ${u.lastName}`.trim() || u.username;
  const colleagueOptions = (taken: (key: string) => boolean) =>
    colleagues.filter((u) => !taken(`u:${u.id}`)).map((u) => ({ value: `u:${u.id}`, label: nameOf(u), hint: `@${u.username}` }));
  const onMeetingAsUser = new Set(roster.flatMap((r) => (r.userId ? [`u:${r.userId}`] : [])));
  const toOptions = colleagueOptions((k) => toKeys.has(k) || onMeetingAsUser.has(k));
  const suggestions = (Array.isArray(suggestionsQ.data) ? suggestionsQ.data : []).filter((s) => !toKeys.has(`e:${s.email.toLowerCase()}`) && !ccKeys.has(`e:${s.email.toLowerCase()}`));
  const ccOptions = [
    ...suggestions.map((s) => ({ value: `e:${s.email}`, label: s.name || s.email, hint: s.name ? s.email : 'Used before' })),
    ...colleagueOptions((k) => toKeys.has(k) || ccKeys.has(k)),
  ];
  const fromOption = (value: string): Added | null => {
    if (value.startsWith('u:')) {
      const u = colleagues.find((c) => c.id === value.slice(2));
      return u ? { kind: 'user', userId: u.id, name: nameOf(u) } : null;
    }
    const email = value.slice(2);
    return { kind: 'address', email, name: suggestions.find((x) => x.email === email)?.name ?? null };
  };

  const shownLine = (list: string[]) => (list.length ? list.join(', ') : '—');
  const toLine = [...ticked.filter((r) => r.copy !== 'own').map((r) => r.name), ...addedTo.map(labelOf)];

  return (
    <ModalPortal>
      <div className="above-keyboard fixed inset-0 z-50 grid place-items-center p-4">
        <div className="absolute inset-0 bg-scrim animate-fade-in" onClick={send.isPending ? undefined : onClose} aria-hidden="true" />
        <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="minutes-title" className="card relative flex max-h-[calc(var(--visible-height)-2rem)] w-full max-w-2xl animate-scale-in flex-col overflow-hidden">
          <div className="border-b border-line px-5 py-4">
            <h2 id="minutes-title" className="font-display text-lg font-semibold text-ink">Email the minutes</h2>
            <p className="mt-0.5 text-sm text-ink-2">
              {preview?.final ? 'The final minutes go' : 'The minutes (not marked final yet) go'} as a PDF attachment, in one email: everyone on it sees who got it.
            </p>
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-4">
            {send.isSuccess ? (
              <SendResults report={send.data} what="Minutes" />
            ) : previewQ.isLoading ? (
              <div className="flex flex-col gap-2" aria-busy="true">
                <div className="skeleton h-4 w-1/2" />
                <div className="skeleton h-40 w-full" />
              </div>
            ) : previewQ.isError || !preview ? (
              <p role="alert" className="text-sm text-danger">
                {meetingFailure(previewQ.error, 'Couldn’t prepare the email.')}{' '}
                <button type="button" onClick={() => void previewQ.refetch()} className="font-semibold underline">Retry</button>
              </p>
            ) : (
              <div className="flex flex-col gap-4">
                <fieldset className="min-w-0 rounded-xl border border-line p-3">
                  <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-ink-3">To ({toCount})</legend>
                  <div className="mb-1 flex gap-3 text-xs">
                    <button type="button" onClick={() => setLeft(new Set())} className={`font-medium text-brand hover:underline ${TOUCH_TALL}`}>All</button>
                    <button type="button" onClick={() => setLeft(new Set(roster.map((r) => r.email.toLowerCase())))} className={`font-medium text-brand hover:underline ${TOUCH_TALL}`}>None</button>
                  </div>
                  <ul className="flex max-h-56 flex-col overflow-y-auto">
                    {roster.map((r) => {
                      const able = canGet(r.copy);
                      const note = r.copy ? COPY_NOTE[r.copy] : undefined;
                      return (
                        <li key={r.email}>
                          <label className={`flex min-h-10 items-start gap-2 rounded px-1 py-1.5 text-sm [@media(pointer:coarse)]:!min-h-11 ${able ? 'hover:bg-ground' : 'opacity-70'}`}>
                            <input
                              type="checkbox"
                              checked={able && !left.has(r.email.toLowerCase())}
                              disabled={!able}
                              onChange={() => toggle(r.email)}
                              className="mt-0.5 h-4 w-4 shrink-0 accent-[color:rgb(var(--c-brand))]"
                            />
                            <span className="min-w-0">
                              <bdi className="block truncate font-medium text-ink">{r.name}</bdi>
                              <span title={r.email} className="block truncate text-xs text-ink-3" dir="ltr">{r.email}</span>
                              {note ? <span className="block text-xs text-ink-2">{note}</span> : null}
                            </span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                  {preview.missingEmail.length ? (
                    <p className="mt-1 text-xs text-ink-2">No email address: {preview.missingEmail.map((m) => m.name).join(', ')}.</p>
                  ) : null}
                  <Chips list={addedTo} onRemove={(a) => setAddedTo((list) => list.filter((x) => keyOf(x) !== keyOf(a)))} label="Also on To" />
                  <AddRow
                    line="To"
                    pickLabel="Add a colleague to To"
                    pickPlaceholder="Add a colleague…"
                    options={toOptions}
                    onPick={(v) => {
                      const a = fromOption(v);
                      return a ? addToTo(a) : null;
                    }}
                    onAddress={(email) => addToTo({ kind: 'address', email, name: null })}
                  />
                </fieldset>

                <fieldset className="min-w-0 rounded-xl border border-line p-3">
                  <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-ink-3">Cc ({cc.length})</legend>
                  <Chips list={cc} onRemove={(a) => setCc((list) => list.filter((x) => keyOf(x) !== keyOf(a)))} label="On Cc" />
                  <AddRow
                    line="Cc"
                    pickLabel="Add a colleague or a recent address to Cc"
                    pickPlaceholder="Add a colleague or a recent address…"
                    options={ccOptions}
                    onPick={(v) => {
                      const a = fromOption(v);
                      return a ? addToCc(a) : null;
                    }}
                    onAddress={(email) => addToCc({ kind: 'address', email, name: null })}
                  />
                </fieldset>
                <p className="-mt-2 text-xs text-ink-3">Typed addresses get the email only — they aren’t added to the meeting.</p>

                <section aria-label="Email preview" className="flex min-w-0 flex-col gap-2">
                  <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                    <dt className="text-ink-3">To</dt>
                    <dd className="min-w-0 break-words text-ink"><bdi>{shownLine(toLine)}</bdi></dd>
                    {cc.length ? (
                      <>
                        <dt className="text-ink-3">Cc</dt>
                        <dd className="min-w-0 break-words text-ink"><bdi>{shownLine(cc.map(labelOf))}</bdi></dd>
                      </>
                    ) : null}
                    <dt className="text-ink-3">Subject</dt>
                    <dd className="min-w-0 font-medium text-ink"><bdi>{preview.subject}</bdi></dd>
                    <dt className="text-ink-3">Attached</dt>
                    <dd className="flex min-w-0 flex-wrap items-center gap-2 text-ink">
                      <span>{preview.attachmentName}</span>
                      <button
                        type="button"
                        onClick={() => { setPdfError(null); void exportMinutes(meeting).catch((err) => setPdfError(meetingFailure(err, 'Couldn’t open the PDF.'))); }}
                        className={`text-xs font-medium text-brand hover:underline ${TOUCH_TALL}`}
                      >
                        Download to check
                      </button>
                    </dd>
                  </dl>
                  {ownCopies.length ? (
                    <p className="text-xs text-ink-2">
                      {ownCopies.map((r, i) => (
                        <span key={r.email}>{i ? ', ' : ''}<bdi>{r.name}</bdi></span>
                      ))}{' '}
                      {ownCopies.length === 1 ? 'gets their own email' : 'get their own emails'} (another company), with their own copy of the minutes.
                    </p>
                  ) : null}
                  {pdfError ? <p role="alert" className="text-xs text-danger">{pdfError}</p> : null}
                  {/* The real email, sandboxed: no scripts, no navigation. */}
                  <iframe title="Email preview" sandbox="" srcDoc={preview.html} className="h-64 w-full rounded-lg border border-line bg-white" />
                </section>
              </div>
            )}
            {error && !send.isSuccess ? <p role="alert" className="mt-3 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p> : null}
          </div>

          <div className="flex flex-col gap-2 border-t border-line px-5 py-3 sm:flex-row sm:items-center sm:justify-end">
            {preview && !send.isSuccess && (toCount === 0 || tooMany) ? (
              <p className="text-xs text-danger sm:mr-auto">{toCount === 0 ? 'Add at least one person to To.' : `At most ${MAX_ADDRESSES} addresses per send.`}</p>
            ) : null}
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <Button variant="secondary" onClick={onClose} disabled={send.isPending}>{send.isSuccess ? 'Done' : 'Cancel'}</Button>
              {send.isSuccess ? null : (
                <Button onClick={() => { setError(null); send.mutate(); }} loading={send.isPending} disabled={!preview || !prefilled || toCount === 0 || tooMany}>
                  Send to {people(count)}
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}

/** The people added to a line, each with ✕ to take them off. */
function Chips({ list, onRemove, label }: { list: Added[]; onRemove: (a: Added) => void; label: string }) {
  if (!list.length) return null;
  return (
    <ul aria-label={label} className="mt-2 flex flex-wrap gap-1.5">
      {list.map((a) => (
        <li key={keyOf(a)} className="flex min-h-9 max-w-full items-center gap-1.5 rounded-full border border-line bg-surface py-0.5 pl-3 pr-0.5 text-sm">
          <bdi className="truncate text-ink">{labelOf(a)}</bdi>
          {a.kind === 'address' && a.name ? <span className="truncate text-xs text-ink-3" dir="ltr">{a.email}</span> : null}
          <button
            type="button"
            aria-label={`Remove ${labelOf(a)}`}
            onClick={() => onRemove(a)}
            className={`grid h-8 w-8 flex-none place-items-center rounded-full text-ink-3 hover:bg-ground hover:text-ink ${TOUCH_SQUARE}`}
          >
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Add to a line: a colleague (or a recent address) from the list, or an address typed in. The callbacks return a problem, or null. */
function AddRow({
  line,
  pickLabel,
  pickPlaceholder,
  options,
  onPick,
  onAddress,
}: {
  line: 'To' | 'Cc';
  pickLabel: string;
  pickPlaceholder: string;
  options: { value: string; label: string; hint?: string }[];
  onPick: (value: string) => string | null;
  onAddress: (email: string) => string | null;
}) {
  const [email, setEmail] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const add = () => {
    const e = email.trim();
    if (!EMAIL_RE.test(e)) return setProblem('Enter a valid email address, for example name@company.com.');
    const why = onAddress(e);
    setProblem(why);
    if (!why) setEmail('');
  };
  const onEnter = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    add();
  };
  return (
    <div className="mt-2 flex flex-col gap-2">
      <SearchableSelect ariaLabel={pickLabel} placeholder={pickPlaceholder} options={options} value="" onChange={(v) => setProblem(onPick(v))} emptyText="Nobody else to add" />
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto]">
        <input
          aria-label={`Email address for ${line}`}
          type="email"
          inputMode="email"
          dir="ltr"
          value={email}
          onChange={(e) => { setEmail(e.target.value); setProblem(null); }}
          onKeyDown={onEnter}
          placeholder="Or type an email address"
          className={fieldClass(!!problem)}
        />
        <button type="button" onClick={add} className="min-h-[44px] rounded-xl border border-line px-4 text-sm font-semibold text-ink hover:bg-ground">
          Add to {line}
        </button>
      </div>
      {problem ? <p role="alert" className="text-xs font-medium text-danger">{problem}</p> : null}
    </div>
  );
}
