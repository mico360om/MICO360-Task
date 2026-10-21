import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { View, Text, StyleSheet, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useDirectory, useMeeting, useMeetingAttendees, useProjects } from '../core/queries';
import { useSaveMeeting } from '../core/meeting-mutations';
import { useUserId } from '../core/providers';
import { useColors } from '../core/theme';
import { Button, ErrorNote, Loader, TextField } from '../components/ui';
import { KeyboardAwareScrollView } from '../components/KeyboardAware';
import { RecurrenceEditor } from '../components/RecurrenceEditor';
import { CardChoice, ChipChoice, FieldLabel, InlinePicker, Sheet, SheetButtons, SheetMessage } from '../components/meeting/sheet-kit';
import { DescribeMeeting } from '../components/meeting-form/DescribeMeeting';
import { FreeTimes } from '../components/meeting-form/FreeTimes';
import { PeopleField } from '../components/meeting-form/PeopleField';
import { AgendaField } from '../components/meeting-form/AgendaField';
import { WriteDescription } from '../components/meeting-form/WriteDescription';
import { dateZones, subscribeTimeZone } from '../lib/due-date';
import { newIdempotencyKey } from '../lib/idempotency';
import { meetingLoadProblem } from '../lib/meeting-detail';
import {
  afterSaveFailure,
  checkMeetingDraft,
  draftFromMeeting,
  firstMeetingDay,
  firstMeetingNote,
  fromWallClock,
  LOCKED_FORM_NOTE,
  meetingRepeatText,
  meetingRule,
  newMeetingDraft,
  normalizeMeetingLink,
  parseTimeInput,
  repeatProblem,
  saveFailureText,
  saveRequest,
  scopeChoice,
  seriesIdOf,
  statusOptions,
  timesInZone,
  type DraftField,
  type MeetingDraft,
} from '../lib/meeting-form';
import {
  agendaLeads,
  applyDescribed,
  describeBaseline,
  describeFields,
  describeSuggestions,
  descriptionRequest,
  formAgendaRequest,
  freeTimesInput,
  meetingMinutes,
  newMeetingExtras,
  pickedTime,
  withPeople,
  type AgendaDraft,
  type DescribedPatch,
  type MeetingPerson,
} from '../lib/meeting-ai';
import { parseDueDateInput } from '../lib/form-input';
import { recurrenceSummary } from '../lib/recurrence-summary';
import { spacing, fontSize, radius, type Palette } from '../lib/theme';
import { displayName, type AiMeetingDraft, type ApiMeeting, type MeetingStatus, type RecurrenceRule, type SeriesScope } from '../lib/types';
import type { AppScreenProps } from '../navigation/types';

const sameRule = (a: RecurrenceRule | null, b: RecurrenceRule | null) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * Schedule a meeting, or edit one (2b) — the website's meeting form. Start and end are typed and
 * shown in company time and sent with that zone. A meeting can repeat; saving a change to a meeting
 * of a series asks whether it is for this meeting only or for all its upcoming meetings (a new
 * repeat always changes the whole series). Needs a connection.
 *
 * With the website's meeting AI (2c): "Describe the meeting" fills the form from a sentence
 * (reviewed first), free times (three suggestions and who clashes), "Write description", and — for
 * a new meeting — its People and Agenda (with "Draft agenda"), saved with it in the one request.
 */
export function MeetingFormScreen({ route, navigation }: AppScreenProps<'MeetingForm'>) {
  const meetingId = route.params?.meetingId ?? '';
  const editing = !!meetingId;
  const meetingQ = useMeeting(meetingId);
  // The meeting's own read (not a list's copy): it carries the series' repeat.
  const ready = !editing || (!!meetingQ.data && meetingQ.dataUpdatedAt > 0);
  if (editing && !ready) {
    if (meetingQ.isError) {
      const problem = meetingLoadProblem(meetingQ.error);
      return (
        <View style={{ flex: 1, padding: spacing.lg }}>
          <ErrorNote message={problem.message} onRetry={problem.canRetry ? () => void meetingQ.refetch() : undefined} retrying={meetingQ.isFetching} />
        </View>
      );
    }
    return <Loader />;
  }
  return <MeetingForm meeting={editing ? meetingQ.data ?? null : null} projectId={route.params?.projectId ?? null} navigation={navigation} />;
}

function MeetingForm({ meeting, projectId, navigation }: { meeting: ApiMeeting | null; projectId: string | null; navigation: AppScreenProps<'MeetingForm'>['navigation'] }) {
  const c = useColors();
  const s = useMemo(() => makeStyles(c), [c]);
  // Company time, followed live: the zone may arrive from the server after the form opened.
  const timeZone = useSyncExternalStore(subscribeTimeZone, dateZones, dateZones).company;
  const editing = !!meeting;
  // The meeting as the form opened it: a series change sends only what was changed from this.
  const [opened] = useState(meeting);
  const seriesId = opened ? seriesIdOf(opened) : null;
  const openedRule = opened ? meetingRule(opened) : null;
  const [draft, setDraft] = useState<MeetingDraft>(() => (opened ? draftFromMeeting(opened, timeZone) : newMeetingDraft(timeZone, new Date(), projectId)));
  // A new meeting's people and agenda (an existing meeting's are on its page).
  const [people, setPeople] = useState<MeetingPerson[]>([]);
  const [agenda, setAgenda] = useState<AgendaDraft[]>([]);
  // The last sentence given to "Describe the meeting": Draft agenda and Write description use it too.
  const [sentence, setSentence] = useState('');
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<{ field: DraftField | null; message: string } | null>(null);
  const [askScope, setAskScope] = useState<SeriesScope | null>(null);
  // A new meeting whose try may be on the server: the form can't change until a definite answer
  // (afterSaveFailure) — the retry goes under the same key, which the server matches, not the form.
  const [locked, setLocked] = useState(false);
  const projectsQ = useProjects();
  const dirQ = useDirectory();
  const attendeesQ = useMeetingAttendees(editing ? opened!.id : '');
  const organizerId = useUserId();
  const save = useSaveMeeting();
  const key = useRef(newIdempotencyKey());
  const saved = useRef(false);
  // Times typed, picked or filled in are the person's own: a zone arriving later doesn't move them,
  // and Describe's suggestions don't start ticked over them.
  const timesTouched = useRef(false);
  const zoneUsed = useRef(timeZone);

  const set = (patch: Partial<MeetingDraft>) => {
    if (locked) return;
    if ('startDay' in patch || 'startTime' in patch || 'endDay' in patch || 'endTime' in patch) timesTouched.current = true;
    setDraft((d) => ({ ...d, ...patch }));
    setTouched(true);
    if (error) setError(null);
  };

  // If the company zone arrives after the form opened (a cold start), untouched times show in it.
  useEffect(() => {
    if (zoneUsed.current === timeZone) return;
    zoneUsed.current = timeZone;
    if (!timesTouched.current && !locked) setDraft((d) => timesInZone(d, opened, timeZone));
  }, [timeZone, opened, locked]);

  const ruleChanged = !sameRule(draft.rule, openedRule);
  const startDay = parseDueDateInput(draft.startDay);
  const startKey = startDay.ok && startDay.value ? startDay.value : '';
  const startTime = parseTimeInput(draft.startTime);
  const startIso = startKey && startTime.ok && startTime.value ? fromWallClock(startKey, startTime.value, timeZone) : null;
  const untilProblem = draft.rule && (!seriesId || ruleChanged) && startKey ? repeatProblem(draft.rule, firstMeetingDay(startKey, draft.rule)) : null;
  const firstNote = draft.rule && !seriesId && startKey ? firstMeetingNote(startKey, draft.rule) : null;
  const summary = draft.rule ? (startIso ? meetingRepeatText(draft.rule, startIso, timeZone) : recurrenceSummary(draft.rule)) : '';

  // ── People, leads, length and free times ──
  const directory = useMemo(() => dirQ.data ?? [], [dirQ.data]);
  const me = directory.find((u) => u.id === organizerId);
  const leads = useMemo(() => agendaLeads(organizerId, me ? displayName(me) : null, people), [organizerId, me, people]);
  const lengthMinutes = meetingMinutes(draft, timeZone);
  // Free times are checked for the organizer and the invited team members (an existing meeting's
  // are on its page).
  const freeInput = freeTimesInput({
    organizerId: editing ? opened!.organizerId : organizerId,
    userIds: editing ? (attendeesQ.data ?? []).flatMap((a) => (a.userId ? [a.userId] : [])) : people.flatMap((p) => (p.kind === 'user' ? [p.id] : [])),
    startAt: startIso,
    minutes: lengthMinutes,
    rule: draft.rule,
    seriesId,
    meetingId: opened?.id,
  });
  const changePeople = (next: MeetingPerson[]) => {
    if (locked) return;
    // Someone taken off the list no longer leads their agenda items.
    const r = withPeople(next, agenda, organizerId);
    setPeople(r.people);
    setAgenda(r.agenda);
    setTouched(true);
  };
  const changeAgenda = (next: AgendaDraft[]) => {
    if (locked) return;
    setAgenda(next);
    setTouched(true);
  };
  /** A suggested time: the start moves there and an end set keeps the meeting's length. */
  const pickTime = (iso: string) => {
    if (locked) return;
    timesTouched.current = true;
    setDraft((d) => pickedTime(d, iso, timeZone));
    setTouched(true);
  };

  // ── Describe the meeting ──
  const openProjects = useMemo(() => (projectsQ.data ?? []).map((p) => ({ id: p.id, name: p.name, code: p.code, number: p.number ?? null })), [projectsQ.data]);
  const suggest = useCallback(
    (d: AiMeetingDraft) =>
      describeSuggestions(d, {
        current: describeFields(draft),
        initial: describeBaseline(draft, { editing, timesTouched: timesTouched.current }),
        withPeopleAndAgenda: !editing,
        projects: openProjects,
        people,
        timeZone,
      }),
    [draft, editing, openProjects, people, timeZone],
  );
  /** "Use selected details": the ticked suggestions go into the form (people and agenda points are added). */
  const applyFound = (patch: DescribedPatch) => {
    if (locked) return;
    if (patch.start !== undefined || patch.minutes !== undefined) timesTouched.current = true;
    const next = applyDescribed({ draft, people, agenda }, patch, { timeZone, organizerId });
    setDraft(next.draft);
    setPeople(next.people);
    setAgenda(next.agenda);
    setTouched(true);
    if (error) setError(null);
  };

  // Leaving with changes not saved asks first.
  useEffect(
    () =>
      navigation.addListener('beforeRemove', (e) => {
        if (!touched || saved.current) return;
        e.preventDefault();
        if (locked) {
          Alert.alert('Leave without finishing?', 'The meeting may already be scheduled — check Meetings before scheduling it again.', [
            { text: 'Stay', style: 'cancel' },
            { text: 'Leave', style: 'destructive', onPress: () => navigation.dispatch(e.data.action) },
          ]);
          return;
        }
        Alert.alert('Discard your changes?', editing ? 'Your changes to this meeting aren’t saved.' : 'This meeting isn’t scheduled yet.', [
          { text: 'Keep editing', style: 'cancel' },
          { text: 'Discard', style: 'destructive', onPress: () => navigation.dispatch(e.data.action) },
        ]);
      }),
    [navigation, touched, editing, locked],
  );

  const projects = useMemo(
    () => [
      { value: '', label: 'No project (standalone)' },
      ...[...(projectsQ.data ?? [])].sort((a, b) => a.name.localeCompare(b.name)).map((p) => ({ value: p.id, label: p.name, hint: p.code })),
    ],
    [projectsQ.data],
  );

  function submit(scope: SeriesScope | null) {
    setError(null);
    const check = checkMeetingDraft(draft, { timeZone, seriesId, ruleChanged });
    if (!check.ok) {
      setError({ field: check.field, message: check.message });
      return;
    }
    if (check.link && check.link !== draft.onlineLink.trim() && !locked) setDraft((d) => ({ ...d, onlineLink: check.link! })); // show what will be saved
    if (editing && seriesId && !scope) {
      setAskScope(scopeChoice(ruleChanged).scope);
      return;
    }
    let request = saveRequest({ payload: check.payload, meeting: opened, scope: scope ?? 'one', ruleChanged, rule: draft.rule, timeZone });
    if (request.kind === 'none') {
      saved.current = true;
      navigation.goBack();
      return;
    }
    // A new meeting's people and agenda go in the same request (one key), so nothing is half-created.
    if (request.kind === 'create') request = { ...request, input: { ...request.input, ...newMeetingExtras(people, agenda) } };
    save.mutate(
      { id: opened?.id, request, idempotencyKey: key.current },
      {
        onSuccess: (meeting) => {
          saved.current = true;
          setAskScope(null);
          // A series change can land on the series' next meeting (the new schedule had no place for
          // the one edited): that one opens.
          if (editing && meeting.id === opened?.id) navigation.goBack();
          else navigation.replace('MeetingDetail', { meetingId: meeting.id, title: meeting.title });
        },
        onError: (e) => {
          setAskScope(null);
          // A refusal is kept under its key by the server: the next try (once fixed) is a new one,
          // and the form can be fixed. With no answer yet, the key stays and the form is locked.
          const f = afterSaveFailure(e, editing);
          if (!f.keepKey) key.current = newIdempotencyKey();
          setLocked(f.lock);
          setError({ field: null, message: f.message });
        },
      },
    );
  }

  const fieldError = (field: DraftField) => (error?.field === field ? error.message : null);
  const scopeInfo = scopeChoice(ruleChanged);

  return (
    <SafeAreaView style={s.safe} edges={['bottom']}>
      <KeyboardAwareScrollView contentContainerStyle={s.body}>
        {error && !error.field ? <ErrorNote message={error.message} /> : null}
        {locked ? (
          <Text style={s.lockNote} accessibilityLiveRegion="polite">
            🔒 {LOCKED_FORM_NOTE}
          </Text>
        ) : null}
        <DescribeMeeting timeZone={timeZone} withPeopleAndAgenda={!editing} suggest={suggest} onApply={applyFound} onSentence={setSentence} disabled={locked} />
        <TextField editable={!locked} label="Title" required value={draft.title} onChangeText={(title) => set({ title })} placeholder="Weekly project sync" error={fieldError('title')} maxLength={191} />

        <FieldLabel>Starts *</FieldLabel>
        <View style={s.row}>
          <View style={s.grow}>
            <TextField
              editable={!locked}
              accessibilityLabel="Start date"
              required
              value={draft.startDay}
              onChangeText={(startDay) => set({ startDay })}
              placeholder="YYYY-MM-DD"
              keyboardType="numbers-and-punctuation"
              maxLength={10}
              error={fieldError('start')}
            />
          </View>
          <View style={s.time}>
            <TextField
              editable={!locked}
              accessibilityLabel="Start time"
              required
              value={draft.startTime}
              onChangeText={(startTime) => set({ startTime })}
              onBlur={() => {
                const r = parseTimeInput(draft.startTime);
                if (r.ok && r.value !== draft.startTime) setDraft((d) => ({ ...d, startTime: r.value }));
              }}
              placeholder="HH:MM"
              keyboardType="numbers-and-punctuation"
              maxLength={5}
            />
          </View>
        </View>
        <FieldLabel>Ends</FieldLabel>
        <View style={s.row}>
          <View style={s.time}>
            <TextField
              editable={!locked}
              accessibilityLabel="End time"
              value={draft.endTime}
              onChangeText={(endTime) => set({ endTime })}
              onBlur={() => {
                const r = parseTimeInput(draft.endTime);
                if (r.ok && r.value !== draft.endTime) setDraft((d) => ({ ...d, endTime: r.value }));
              }}
              placeholder="HH:MM"
              keyboardType="numbers-and-punctuation"
              maxLength={5}
              error={fieldError('end')}
            />
          </View>
          <View style={s.grow}>
            <TextField
              editable={!locked}
              accessibilityLabel="End date, if it isn’t the start date"
              value={draft.endDay}
              onChangeText={(endDay) => set({ endDay })}
              placeholder="Same day (or YYYY-MM-DD)"
              keyboardType="numbers-and-punctuation"
              maxLength={10}
            />
          </View>
        </View>
        <Text style={s.hint}>Times are in company time ({timeZone.replace(/_/g, ' ')}).</Text>
        <FreeTimes input={freeInput} timeZone={timeZone} onPick={pickTime} disabled={locked} />

        <View style={s.group}>
          <FieldLabel>Repeat</FieldLabel>
          {seriesId ? <Text style={s.hint}>This meeting is part of a repeating series.</Text> : null}
          {draft.rule ? <Text style={s.summary}>🔁 {summary}</Text> : null}
          <RecurrenceEditor kind="meeting" disabled={locked} value={draft.rule} onChange={(rule) => set({ rule })} dueDate={startKey || null} />
          {untilProblem ? (
            <Text style={s.problem} accessibilityRole="alert">
              {untilProblem}
            </Text>
          ) : null}
          {firstNote ? <Text style={s.note}>{firstNote}</Text> : null}
          {draft.rule ? <Text style={s.hint}>{seriesId ? 'A new repeat applies to all upcoming meetings of the series.' : 'Each meeting is created for the next three months, and more follow as time goes on.'}</Text> : null}
          {fieldError('repeat') ? (
            <Text style={s.problem} accessibilityRole="alert">
              {fieldError('repeat')}
            </Text>
          ) : null}
        </View>

        <InlinePicker label="Project" disabled={locked} options={projects} value={draft.projectId} onChange={(projectId) => set({ projectId })} placeholder="No project (standalone)" />
        <Text style={s.hint}>Optional — leave blank for a standalone meeting.</Text>

        <TextField editable={!locked} label="Location" value={draft.location} onChangeText={(location) => set({ location })} placeholder="Room 2 / Office" />
        <TextField
          editable={!locked}
          label="Online link"
          value={draft.onlineLink}
          onChangeText={(onlineLink) => set({ onlineLink })}
          onBlur={() => {
            const n = normalizeMeetingLink(draft.onlineLink);
            if (n && n !== draft.onlineLink) setDraft((d) => ({ ...d, onlineLink: n }));
          }}
          placeholder="https://…"
          keyboardType="url"
          autoCapitalize="none"
          autoCorrect={false}
          error={fieldError('link')}
        />

        <ChipChoice<MeetingStatus> disabled={locked} label="Status" options={statusOptions(editing)} value={draft.status} onChange={(status) => set({ status })} />

        <TextField editable={!locked} label="Description" value={draft.description} onChangeText={(description) => set({ description })} placeholder="Optional agenda summary" multiline numberOfLines={3} style={s.multiline} />
        <WriteDescription current={draft.description} request={descriptionRequest({ title: draft.title, agenda, sentence })} onUse={(description) => set({ description })} disabled={locked} />

        {!editing ? (
          <>
            <PeopleField people={people} onChange={changePeople} directory={directory} organizerId={organizerId} disabled={locked} />
            <AgendaField
              agenda={agenda}
              onChange={changeAgenda}
              leads={leads}
              minutes={lengthMinutes}
              draftRequest={formAgendaRequest({ draft, timeZone, sentence, leads })}
              disabled={locked}
            />
          </>
        ) : null}
      </KeyboardAwareScrollView>
      <View style={s.footer}>
        <Button title="Cancel" variant="ghost" onPress={() => navigation.goBack()} disabled={save.isPending} style={s.grow} />
        <Button
          title={save.isPending ? (editing ? 'Saving…' : 'Scheduling…') : editing ? 'Save changes' : 'Schedule meeting'}
          onPress={() => submit(null)}
          loading={save.isPending && !askScope}
          style={s.wide}
        />
      </View>

      <Sheet
        visible={askScope !== null}
        title="Save changes to a repeating meeting?"
        onClose={() => setAskScope(null)}
        footer={<SheetButtons cancel="Go back" onCancel={() => setAskScope(null)} confirm="Save" onConfirm={() => submit(askScope ?? 'one')} busy={save.isPending} />}
      >
        <CardChoice<SeriesScope>
          legend="Which meetings?"
          value={askScope ?? 'one'}
          onChange={setAskScope}
          options={[
            { value: 'one', label: 'This meeting only', hint: scopeInfo.oneDisabled ?? 'The other meetings of the series stay as they are.', disabled: !!scopeInfo.oneDisabled },
            { value: 'series', label: 'All upcoming meetings in the series', hint: 'Meetings already held stay as they were.' },
          ]}
        />
        <SheetMessage text={save.isError ? saveFailureText(save.error, true) : null} />
      </Sheet>
    </SafeAreaView>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: c.ground },
    body: { padding: spacing.lg, gap: spacing.xs, paddingBottom: spacing.xxl },
    row: { flexDirection: 'row', gap: spacing.sm },
    grow: { flex: 1 },
    wide: { flex: 2 },
    time: { width: 110 },
    group: { gap: spacing.sm, marginBottom: spacing.md, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: radius.lg, padding: spacing.md },
    hint: { fontSize: fontSize.xs, color: c.ink2, marginBottom: spacing.sm },
    summary: { fontSize: fontSize.sm, fontWeight: '700', color: c.ink },
    note: { fontSize: fontSize.xs, fontWeight: '600', color: c.ink },
    problem: { fontSize: fontSize.xs, fontWeight: '700', color: c.danger },
    lockNote: { fontSize: fontSize.sm, color: c.ink2, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm },
    multiline: { minHeight: 76, paddingTop: spacing.sm, textAlignVertical: 'top' },
    footer: { flexDirection: 'row', gap: spacing.sm, padding: spacing.md, borderTopWidth: 1, borderTopColor: c.line, backgroundColor: c.surface },
  });
