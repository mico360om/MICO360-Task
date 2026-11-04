import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  meetingsApi,
  ATTENDANCE_LABELS,
  RESPONSE_LABELS,
  type Attendee,
  type AttendanceStatus,
  type AttendeeRole,
  type InvitationResponse,
  type Meeting,
} from '../../api/meetings';
import type { DirectoryUser } from '../../api/users';
import { apiClient } from '../../api/client';
import { ApiError } from '../../lib/api-client';
import { useAuthStore } from '../../stores/auth-store';
import { Avatar } from '../ui/Avatar';
import { Badge, badgeToneClass, type BadgeTone } from '../ui/Badge';
import { attendanceTone } from '../../lib/meetingFormat';
import { TOUCH_TALL } from '../../lib/touch';
import { Button } from '../ui/Button';
import { fieldClass } from '../ui/Field';
import { SearchableSelect } from '../ui/SearchableSelect';
import { ActionMenu } from './ActionMenu';
import { ConfirmRemoveButton, LoadError, Section, SectionError, userName } from './kit';
import { meetingFailure } from './meeting-actions';
import { responseSummary } from '../../lib/meeting-flow';
import { useInviteCandidates } from '../meeting-form/invite-candidates';
import { colleaguesOf } from '../../lib/people';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ATTENDANCE: AttendanceStatus[] = ['INVITED', 'PRESENT', 'LATE', 'ABSENT', 'EXCUSED'];
const RESPONSE_TONE: Record<InvitationResponse, BadgeTone> = { ACCEPTED: 'success', TENTATIVE: 'warning', DECLINED: 'danger', PENDING: 'neutral' };
/** People shown before "Show all". */
const FIRST = 12;

function personName(dir: DirectoryUser[], a: Attendee): string {
  if (a.userId) return userName(dir, a.userId) ?? 'Unknown member';
  return a.externalName ?? 'Guest';
}

/**
 * Who is coming. Three separate things per person: the role (required / optional), their answer
 * to the invitation, and — once the meeting is under way — whether they attended.
 */
export function AttendeesPanel({
  meeting,
  attendees,
  directory,
  loading,
  loadError,
  onRetry,
  canEdit,
}: {
  meeting: Meeting;
  attendees: Attendee[];
  directory: DirectoryUser[];
  loading: boolean;
  loadError: boolean;
  onRetry: () => void;
  canEdit: boolean;
}) {
  const qc = useQueryClient();
  const myId = useAuthStore((s) => s.user?.id);
  const [mode, setMode] = useState<'member' | 'guest'>('member');
  const [pickUser, setPickUser] = useState('');
  const [role, setRole] = useState<AttendeeRole>('REQUIRED');
  const [extName, setExtName] = useState('');
  const [extEmail, setExtEmail] = useState('');
  const [addError, setAddError] = useState<string | null>(null);
  const [opError, setOpError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['meeting', meeting.id, 'attendees'] });
    void qc.invalidateQueries({ queryKey: ['meetings'] });
  };
  const attendanceTime = meeting.status === 'IN_PROGRESS' || meeting.status === 'COMPLETED';
  const mine = attendees.find((a) => a.userId && a.userId === myId);
  const summary = responseSummary(attendees);

  const addMut = useMutation({
    mutationFn: () =>
      mode === 'member'
        ? meetingsApi(apiClient).addAttendee(meeting.id, { userId: pickUser, role })
        : meetingsApi(apiClient).addAttendee(meeting.id, { externalName: extName.trim(), externalEmail: extEmail.trim() || null, role }),
    onSuccess: () => {
      setPickUser('');
      setExtName('');
      setExtEmail('');
      setAddError(null);
      refresh();
    },
    onError: (err) => {
      if (err instanceof ApiError && err.status === 409) setAddError(mode === 'member' ? 'That person is already on the list.' : 'That guest is already on the list.');
      else if (err instanceof ApiError && err.status === 400 && mode === 'guest') setAddError('Check the guest’s details — the email address doesn’t look valid.');
      else setAddError(meetingFailure(err, 'Couldn’t add the attendee.'));
    },
  });
  const patchMut = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: { attendance?: AttendanceStatus; response?: InvitationResponse; role?: AttendeeRole } }) =>
      meetingsApi(apiClient).updateAttendee(meeting.id, id, patch),
    onSuccess: refresh,
    onError: (err) => setOpError(meetingFailure(err, 'Couldn’t save the change.')),
  });
  const removeMut = useMutation({
    mutationFn: (attendeeId: string) => meetingsApi(apiClient).removeAttendee(meeting.id, attendeeId),
    onSuccess: refresh,
    onError: (err) => setOpError(meetingFailure(err, 'Couldn’t remove the attendee.')),
  });
  // "Add email" for a guest with none: an address in place, checked here and by the server.
  const [emailFor, setEmailFor] = useState<string | null>(null);
  const [emailDraft, setEmailDraft] = useState('');
  const [emailError, setEmailError] = useState<string | null>(null);
  const emailMut = useMutation({
    mutationFn: ({ id, email }: { id: string; email: string }) => meetingsApi(apiClient).updateAttendee(meeting.id, id, { externalEmail: email }),
    onSuccess: () => {
      setEmailFor(null);
      refresh();
    },
    onError: (err) => setEmailError(err instanceof ApiError && err.status === 409 ? 'That address is already on the list.' : meetingFailure(err, 'Couldn’t save the email address.')),
  });
  // "Required" says something only when someone is optional.
  const someOptional = attendees.some((a) => a.role === 'OPTIONAL');

  // companies: with two or more on the site, the people the server says can be invited to this meeting.
  const candidates = useInviteCandidates({ projectId: meeting.projectId, companyId: meeting.companyId }, canEdit);
  const onList = new Set(attendees.map((a) => a.userId).filter(Boolean));
  const memberOptions = (candidates ?? colleaguesOf(directory))
    .filter((u) => !onList.has(u.id))
    .map((u) => ({ value: u.id, label: `${u.firstName} ${u.lastName}`.trim() || u.username, hint: `@${u.username}` }));

  function submitAdd(e: FormEvent) {
    e.preventDefault();
    setAddError(null);
    if (mode === 'member') {
      if (!pickUser) return setAddError('Choose a person to add.');
    } else {
      const email = extEmail.trim().toLowerCase();
      if (!extName.trim()) return setAddError('Enter the guest’s name.');
      if (email && !EMAIL_RE.test(email)) return setAddError('Enter a valid email address for the guest (for example name@company.com), or leave it blank.');
      if (email && attendees.some((a) => a.externalEmail?.toLowerCase() === email)) return setAddError('That guest is already on the list.');
    }
    addMut.mutate();
  }

  const visible = showAll ? attendees : attendees.slice(0, FIRST);

  return (
    <Section
      id="people"
      title="People"
      count={attendees.length || undefined}
      aside={
        attendees.length ? (
          <span className="text-xs text-ink-3">
            {summary.ACCEPTED} accepted · {summary.TENTATIVE} maybe · {summary.DECLINED} declined · {summary.PENDING} no response
          </span>
        ) : null
      }
    >
      <SectionError message={opError} onDismiss={() => setOpError(null)} />

      {mine && meeting.status !== 'CANCELLED' && meeting.status !== 'COMPLETED' ? (
        <div role="group" aria-label="Your response" className="mb-3 flex flex-wrap items-center gap-1.5 rounded-lg bg-ground/60 p-2">
          <span className="mr-1 text-xs font-medium text-ink-2">Going?</span>
          {(['ACCEPTED', 'TENTATIVE', 'DECLINED'] as InvitationResponse[]).map((r) => (
            <button
              key={r}
              type="button"
              aria-pressed={mine.response === r}
              onClick={() => patchMut.mutate({ id: mine.id, patch: { response: mine.response === r ? 'PENDING' : r } })}
              className={`min-h-8 rounded-md border px-2.5 text-xs font-medium transition-colors ${
                mine.response === r ? 'border-brand/40 bg-brand/10 text-brand' : 'border-line bg-surface text-ink-2 hover:text-ink'
              }`}
            >
              {r === 'ACCEPTED' ? 'Accept' : r === 'TENTATIVE' ? 'Maybe' : 'Decline'}
            </button>
          ))}
        </div>
      ) : null}

      {loading ? (
        <div className="skeleton h-16 w-full" />
      ) : loadError ? (
        <LoadError what="the attendees" onRetry={onRetry} />
      ) : attendees.length === 0 ? (
        <p className="text-sm text-ink-2">{canEdit ? 'Nobody yet. Add team members or guests below.' : 'Nobody has been added yet.'}</p>
      ) : (
        <>
          <ul className="flex flex-col divide-y divide-line">
            {visible.map((a) => {
              const name = personName(directory, a);
              const response = a.response ?? 'PENDING';
              // A guest without an address can't be emailed, so they aren't "waiting" for an invitation.
              const noEmail = !a.userId && !a.externalEmail;
              const notInvited = !noEmail && !!meeting.invitesSentAt && !a.invitedAt && meeting.status !== 'CANCELLED';
              const own = !!a.userId && a.userId === myId;
              // One row: face, name, answer, Guest mark (and Required/Optional only when someone is
              // optional), attendance once the meeting is under way, then the person's options.
              return (
                <li key={a.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 py-1.5">
                  <Avatar size="sm" name={name} src={a.userId ? directory.find((d) => d.id === a.userId)?.avatarUrl : null} />
                  <span className="min-w-0 flex-[1_1_7rem]">
                    <span title={name} className="block truncate text-sm font-medium text-ink"><bdi>{name}</bdi></span>
                    {a.externalEmail ? <span title={a.externalEmail} className="block truncate text-xs text-ink-3" dir="ltr">{a.externalEmail}</span> : null}
                  </span>
                  <Badge tone={RESPONSE_TONE[response]}>{RESPONSE_LABELS[response]}</Badge>
                  {!a.userId ? <Badge tone="neutral">Guest</Badge> : null}
                  {someOptional ? <Badge tone={a.role === 'OPTIONAL' ? 'neutral' : 'info'}>{a.role === 'OPTIONAL' ? 'Optional' : 'Required'}</Badge> : null}
                  {notInvited ? <span className="text-[11px] font-medium text-warning">Not invited yet</span> : null}
                  {noEmail ? (
                    canEdit ? (
                      emailFor === a.id ? null : (
                        <button
                          type="button"
                          aria-label={`Add email for ${name}`}
                          onClick={() => { setEmailFor(a.id); setEmailDraft(''); setEmailError(null); }}
                          className={`rounded-md px-1.5 text-[11px] font-semibold text-brand hover:underline ${TOUCH_TALL} min-h-7`}
                        >
                          Add email
                        </button>
                      )
                    ) : (
                      <span className="text-[11px] text-ink-3">No email address</span>
                    )
                  ) : null}
                  {attendanceTime ? (
                    canEdit || own ? (
                      <SearchableSelect
                        size="chip"
                        ariaLabel={`Attendance for ${name}: ${ATTENDANCE_LABELS[a.attendance]}`}
                        options={ATTENDANCE.map((s) => ({ value: s, label: ATTENDANCE_LABELS[s] }))}
                        value={a.attendance}
                        onChange={(v) => patchMut.mutate({ id: a.id, patch: { attendance: v as AttendanceStatus } })}
                        chipClassName={a.attendance === 'INVITED' ? 'bg-ground text-ink-3' : badgeToneClass(attendanceTone(a.attendance))}
                      />
                    ) : (
                      <span className="text-xs text-ink-3">Attendance: {ATTENDANCE_LABELS[a.attendance]}</span>
                    )
                  ) : null}
                  <span className="ms-auto flex items-center">
                    {canEdit ? (
                      <ActionMenu
                        label={`Options for ${name}`}
                        items={[
                          { label: a.role === 'OPTIONAL' ? 'Make required' : 'Make optional', onSelect: () => patchMut.mutate({ id: a.id, patch: { role: a.role === 'OPTIONAL' ? 'REQUIRED' : 'OPTIONAL' } }) },
                          ...(!a.userId
                            ? (['ACCEPTED', 'TENTATIVE', 'DECLINED', 'PENDING'] as InvitationResponse[])
                                .filter((r) => r !== response)
                                .map((r) => ({ label: `Record answer: ${RESPONSE_LABELS[r]}`, onSelect: () => patchMut.mutate({ id: a.id, patch: { response: r } }) }))
                            : []),
                        ]}
                      />
                    ) : null}
                    {canEdit ? <ConfirmRemoveButton label={`Remove ${name}`} onConfirm={() => removeMut.mutate(a.id)} disabled={removeMut.isPending} /> : null}
                  </span>
                  {emailFor === a.id ? (
                    <form
                      noValidate
                      onSubmit={(e) => {
                        e.preventDefault();
                        const email = emailDraft.trim();
                        if (!EMAIL_RE.test(email)) return setEmailError('Enter a valid email address, for example name@company.com.');
                        setEmailError(null);
                        emailMut.mutate({ id: a.id, email });
                      }}
                      className="flex w-full flex-wrap items-center gap-1.5 pl-[2.375rem]"
                    >
                      <input
                        aria-label={`Email address for ${name}`}
                        type="email"
                        inputMode="email"
                        dir="ltr"
                        autoFocus
                        value={emailDraft}
                        onChange={(e) => { setEmailDraft(e.target.value); setEmailError(null); }}
                        placeholder="name@company.com"
                        className={`${fieldClass(!!emailError)} !min-h-9 min-w-0 flex-[1_1_10rem] !py-1 text-xs [@media(pointer:coarse)]:!min-h-11`}
                      />
                      <Button type="submit" size="sm" aria-label={`Save email for ${name}`} loading={emailMut.isPending} className={TOUCH_TALL}>Save</Button>
                      <Button type="button" size="sm" variant="ghost" onClick={() => setEmailFor(null)} className={TOUCH_TALL}>Cancel</Button>
                      {emailError ? <p role="alert" className="w-full text-xs font-medium text-danger">{emailError}</p> : null}
                    </form>
                  ) : null}
                </li>
              );
            })}
          </ul>
          {attendees.length > FIRST ? (
            <button type="button" onClick={() => setShowAll((s) => !s)} className="mt-2 min-h-9 text-sm font-medium text-brand hover:underline">
              {showAll ? 'Show fewer' : `Show all ${attendees.length}`}
            </button>
          ) : null}
        </>
      )}

      {canEdit ? (
        <form onSubmit={submitAdd} noValidate className="mt-3 flex flex-col gap-2 border-t border-line pt-3">
          <div role="radiogroup" aria-label="Add" className="inline-flex self-start rounded-lg border border-line bg-surface p-0.5 text-xs">
            {(['member', 'guest'] as const).map((m) => (
              <label key={m} className={`flex min-h-8 cursor-pointer items-center rounded-md px-2.5 font-medium transition-colors focus-within:ring-2 focus-within:ring-brand/40 ${mode === m ? 'bg-brand-gradient text-white' : 'text-ink-2 hover:text-ink'}`}>
                <input type="radio" name="attendee-kind" checked={mode === m} onChange={() => { setMode(m); setAddError(null); }} className="sr-only" />
                {m === 'member' ? 'Team member' : 'Guest'}
              </label>
            ))}
          </div>
          {mode === 'member' ? (
            <SearchableSelect ariaLabel="Team member to add" placeholder="Search people…" options={memberOptions} value={pickUser} onChange={setPickUser} emptyText="Everyone is already on the list" />
          ) : (
            <>
              <input aria-label="Guest name" dir="auto" value={extName} onChange={(e) => setExtName(e.target.value)} placeholder="Guest name" className={fieldClass(false)} />
              <input aria-label="Guest email" type="email" dir="ltr" value={extEmail} onChange={(e) => setExtEmail(e.target.value)} placeholder="Email (for the invitation)" className={fieldClass(false)} />
            </>
          )}
          <div className="flex items-center gap-2">
            <select aria-label="Role" value={role} onChange={(e) => setRole(e.target.value as AttendeeRole)} className={`${fieldClass(false)} flex-1`}>
              <option value="REQUIRED">Required</option>
              <option value="OPTIONAL">Optional</option>
            </select>
            <Button type="submit" size="sm" loading={addMut.isPending}>Add attendee</Button>
          </div>
          {addError ? <p role="alert" className="text-xs font-medium text-danger">{addError}</p> : null}
        </form>
      ) : null}
    </Section>
  );
}
