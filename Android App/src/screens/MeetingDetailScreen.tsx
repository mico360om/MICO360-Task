import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, FlatList, StyleSheet, RefreshControl, Pressable, Alert, InteractionManager, type ListRenderItem } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useIsFocused } from '@react-navigation/native';
import { useQueryClient } from '@tanstack/react-query';
import {
  useDirectory,
  useFinalMinutes,
  useMeeting,
  useMeetingActionItems,
  useMeetingAgenda,
  useMeetingAttendees,
  useMeetingNotes,
  useProjects,
  useRespondToMeeting,
} from '../core/queries';
import { useAgendaMutations, useFinalMinutesMutations, useMeetingActions, useNoteMutations } from '../core/meeting-mutations';
import { useMyQueuedChanges, useServices, useUserId } from '../core/providers';
import { SyncStatus } from '../components/SyncStatus';
import { isMeetingChange, isWaitingRow, withWaitingChanges } from '../lib/meeting-waiting';
import type { QueuedMutation } from '../lib/sync-queue';
import { useColors } from '../core/theme';
import { Loader, ErrorNote, Button } from '../components/ui';
import {
  AboutCard,
  ActionRow,
  AgendaRow,
  MeetingHeaderCard,
  MinutesRow,
  MoreRow,
  NoteFiltersRow,
  NoteRow,
  PersonRow,
  RsvpCard,
  SectionTitleRow,
  StateRow,
  type RowPlace,
} from '../components/meeting/MeetingDetailParts';
import { ActionsSheet, ConfirmScopeSheet, InviteSheet, MinutesEmailSheet } from '../components/meeting/MeetingSheets';
import { AgendaDraftSheet } from '../components/meeting/AgendaDraftSheet';
import { ActionItemSheet, AddPersonSheet, AgendaItemSheet, NoteSheet, NoteTaskSheet, PersonSheet } from '../components/meeting/PartSheets';
import { openJoinLink, useMinuteNow, usePullRefresh } from '../components/meeting/live';
import { isNetworkError } from '../lib/api-client';
import { keptTryText } from '../lib/pending-keys';
import { keptOnPhoneText } from '../lib/write-order';
import { appTimeZone } from '../lib/due-date';
import { afterMeetingDeleted } from '../lib/meeting-cache';
import { agendaTiming, agendaTimingText, answerAfterTap, canAnswer, meetingLoadProblem, myInvitation, responseLine, responseSummary } from '../lib/meeting-detail';
import { PRIMARY_LABEL, cancelDialog, deleteDialog, meetingFailure, meetingMenu, minutesFileName, primaryAction, statusNotice, type MenuKey, type PrimaryAction } from '../lib/meeting-flow';
import { canChangeNoteText, canManageNote, canRemoveActionItem, canTickAgendaItem, personFlags } from '../lib/meeting-parts';
import { minutesSaveFailure } from '../lib/meeting-minutes';
import { meetingDetailRows, type DetailRow, type NoteFilter, type Section } from '../lib/meeting-screen';
import { failureText } from '../lib/task-detail';
import { displayName, type ApiActionItem, type ApiAgendaItem, type ApiMeetingNote, type InvitationResponse, type MeetingStatus, type SeriesScope } from '../lib/types';
import { spacing, fontSize, radius, type Palette } from '../lib/theme';
import type { AppScreenProps } from '../navigation/types';

const WHAT: Record<Section, string> = { agenda: 'the agenda', people: 'the people', notes: 'the notes', actions: 'the action items', minutes: 'the final minutes' };

type Sheet =
  | { kind: 'actions' }
  | { kind: 'cancel' }
  | { kind: 'delete' }
  | { kind: 'invite' }
  | { kind: 'minutesEmail' }
  | { kind: 'addPerson' }
  | { kind: 'person'; attendeeId: string }
  | { kind: 'agenda'; item: ApiAgendaItem | null }
  | { kind: 'note'; note: ApiMeetingNote | null }
  | { kind: 'noteTask'; note: ApiMeetingNote }
  | { kind: 'action'; item: ApiActionItem | null }
  | { kind: 'agendaDraft' };

/**
 * One meeting: when, where and Join; your answer to the invitation; what it is about; its agenda,
 * people and their answers, Live notes, action items and final minutes (2a) — and, for whoever
 * runs it (the server's `canEdit`), everything the website does to run it (2b): the next step for
 * its status (invite, start, end, email the minutes), editing it, people and invitations, the
 * agenda, the final minutes, the minutes PDF and email, cancelling, copying and deleting. Anyone on
 * it can add notes and action items, make a note a task, and record their own attendance. It stays
 * current through the meeting's live events (one app-wide socket); pull down to load it again.
 */
export function MeetingDetailScreen({ route, navigation }: AppScreenProps<'MeetingDetail'>) {
  const { meetingId } = route.params;
  const c = useColors();
  const styles = useMemo(() => makeStyles(c), [c]);
  const qc = useQueryClient();
  const { exporter, resources } = useServices();
  const myId = useUserId();
  const meetingQ = useMeeting(meetingId);
  const peopleQ = useMeetingAttendees(meetingId);
  const agendaQ = useMeetingAgenda(meetingId);
  const notesQ = useMeetingNotes(meetingId);
  const actionsQ = useMeetingActionItems(meetingId);
  const minutesQ = useFinalMinutes(meetingId);
  const projectsQ = useProjects();
  const dirQ = useDirectory();
  const respond = useRespondToMeeting(meetingId);
  const lifecycle = useMeetingActions(meetingId);
  const agendaM = useAgendaMutations(meetingId);
  const notesM = useNoteMutations(meetingId);
  const minutesM = useFinalMinutesMutations(meetingId);
  const [showAllPeople, setShowAllPeople] = useState(false);
  const [noteFilter, setNoteFilter] = useState<NoteFilter>('ALL');
  const [rsvpError, setRsvpError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [scope, setScope] = useState<SeriesScope>('one');
  const [scopeError, setScopeError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [undoNoteId, setUndoNoteId] = useState<string | null>(null);
  const timeZone = appTimeZone();
  // "Under way" and "overdue" move on each minute only while this screen is in view.
  const now = useMinuteNow(useIsFocused());
  const closing = useRef(false);

  const meeting = meetingQ.data;
  useEffect(() => {
    if (meeting?.title && meeting.title !== route.params.title) navigation.setOptions({ title: meeting.title });
  }, [meeting?.title, route.params.title, navigation]);

  // A deleted note can be brought back for a few seconds.
  useEffect(() => {
    if (!undoNoteId) return;
    const t = setTimeout(() => setUndoNoteId(null), 10_000);
    return () => clearTimeout(t);
  }, [undoNoteId]);

  const directory = useMemo(() => dirQ.data ?? [], [dirQ.data]);
  const people = useMemo(() => new Map(directory.map((u) => [u.id, displayName(u)])), [directory]);
  const nameOf = useCallback((id: string) => people.get(id) ?? null, [people]);
  const projectName = meeting?.projectId ? (projectsQ.data ?? []).find((p) => p.id === meeting.projectId)?.name ?? null : null;
  const mine = myInvitation(peopleQ.data ?? [], myId);
  const taskKeys = useMemo(() => new Map((actionsQ.data ?? []).flatMap((i) => (i.taskId && i.taskKey ? [[i.taskId, i.taskKey] as const] : []))), [actionsQ.data]);
  const openTask = useCallback((taskId: string) => navigation.navigate('TaskDetail', { taskId }), [navigation]);
  const canEdit = meeting?.canEdit === true;
  const viewer = { canEdit, myId };
  const attendanceTime = meeting?.status === 'IN_PROGRESS' || meeting?.status === 'COMPLETED';

  // What this phone took down and hasn't sent yet shows on the lists, "Waiting to sync" — and stays
  // over a list that loads again before the sync (meeting-waiting).
  const { pending: queued } = useMyQueuedChanges();
  const shown = useMemo(
    () => withWaitingChanges({ agenda: agendaQ.data, attendees: peopleQ.data, notes: notesQ.data, actions: actionsQ.data }, queued, { meetingId, myId }),
    [agendaQ.data, peopleQ.data, notesQ.data, actionsQ.data, queued, meetingId, myId],
  );
  const onlyThisMeeting = useCallback((m: QueuedMutation) => isMeetingChange(m, meetingId), [meetingId]);

  const part = <T,>(q: { data?: T; isLoading: boolean; isError: boolean }, data: T | undefined = q.data) => ({ data, loading: q.isLoading, failed: q.isError && data === undefined });
  // A few hundred rows at most, built again on each render (cheap); the list draws only what is on screen.
  const rows = meeting
    ? meetingDetailRows({
        meeting,
        canRsvp: !!mine && canAnswer(meeting),
        canEdit,
        agenda: part(agendaQ, shown.agenda),
        people: part(peopleQ, shown.attendees),
        notes: part(notesQ, shown.notes),
        actions: part(actionsQ, shown.actions),
        minutes: part(minutesQ),
        showAllPeople,
        noteFilter,
      })
    : [];

  const answer = (tapped: InvitationResponse) => {
    if (!mine) return;
    setRsvpError(null);
    respond.mutate(
      { attendeeId: mine.id, response: answerAfterTap(mine.response, tapped) },
      { onError: (e) => setRsvpError(failureText(e, 'Couldn’t save your answer. Please try again.')) },
    );
  };

  // ── Running it ──
  const say = (text: string, error = false) => setNotice({ text, error });
  const setStatus = (status: MeetingStatus) =>
    lifecycle.setStatus.mutate(status, {
      onSuccess: (saved) => say(statusNotice(saved.status)),
      onError: (e) => say(meetingFailure(e, 'Couldn’t change the meeting’s status.'), true),
    });
  /** Download the minutes PDF and open the share sheet; resolves with why it couldn't, or null. */
  const downloadPdf = async (): Promise<string | null> => {
    if (!meeting || downloading) return null;
    setDownloading(true);
    try {
      await exporter.exportFile(resources.meetings.minutesPdfPath(meeting.id), minutesFileName(meeting.title, minutesQ.data?.status === 'FINAL'), 'Minutes of the meeting');
      return null;
    } catch (e) {
      return isNetworkError(e) ? 'The minutes PDF needs a connection — check your connection and try again.' : meetingFailure(e, 'Couldn’t export the minutes.');
    } finally {
      setDownloading(false);
    }
  };
  const exportPdf = async () => {
    const problem = await downloadPdf();
    if (problem) say(problem, true);
  };
  // A copy whose try got no answer keeps its key (in the hook), so tapping again can't make a second copy.
  const duplicate = () =>
    lifecycle.duplicate.mutate(undefined, {
      onSuccess: (copy) => navigation.navigate('MeetingDetail', { meetingId: copy.id, title: copy.title }),
      onError: (e) => say(keptTryText(e, 'Couldn’t duplicate the meeting.', 'Duplicate', meetingFailure), true),
    });
  const run = (key: PrimaryAction | MenuKey) => {
    setSheet(null);
    setNotice(null);
    switch (key) {
      case 'edit':
        navigation.navigate('MeetingForm', { meetingId });
        return;
      case 'schedule':
      case 'invite':
        setSheet({ kind: 'invite' });
        return;
      case 'schedule-quietly':
        setStatus('SCHEDULED');
        return;
      case 'start':
        setStatus('IN_PROGRESS');
        return;
      case 'end':
        setStatus('COMPLETED');
        return;
      case 'email-minutes':
        setSheet({ kind: 'minutesEmail' });
        return;
      case 'export-minutes':
        void exportPdf();
        return;
      case 'duplicate':
        duplicate();
        return;
      case 'cancel':
      case 'delete':
        setScope('one');
        setScopeError(null);
        setSheet({ kind: key });
        return;
    }
  };
  const confirmScope = () => {
    if (!meeting || !sheet) return;
    setScopeError(null);
    if (sheet.kind === 'cancel') {
      lifecycle.cancel.mutate(scope, {
        onSuccess: () => {
          setSheet(null);
          say(cancelDialog(meeting, scope).done);
        },
        onError: (e) => setScopeError(meetingFailure(e, scope === 'series' ? 'Couldn’t cancel the meetings.' : 'Couldn’t cancel the meeting.')),
      });
    } else if (sheet.kind === 'delete') {
      closing.current = true;
      lifecycle.remove.mutate(scope, {
        onSuccess: () => {
          setSheet(null);
          if (navigation.canGoBack()) navigation.goBack();
          else navigation.navigate('Tabs', { screen: 'Meetings' });
          // Its data goes once its screen has closed (so it doesn't say "not found" on the way out).
          InteractionManager.runAfterInteractions(() => afterMeetingDeleted(qc, meetingId, scope));
        },
        onError: (e) => {
          closing.current = false;
          setScopeError(meetingFailure(e, scope === 'series' ? 'Couldn’t delete the meetings.' : 'Couldn’t delete the meeting.'));
        },
      });
    }
  };

  const toggleCovered = (item: ApiAgendaItem) =>
    agendaM.covered.mutate({ itemId: item.id, completed: !item.completed }, { onError: (e) => say(isNetworkError(e) ? keptOnPhoneText(e) : meetingFailure(e, 'Couldn’t update the agenda item.'), !isNetworkError(e)) });
  const toggleKey = (note: ApiMeetingNote) => notesM.update.mutate({ noteId: note.id, patch: { highlighted: !note.highlighted } }, { onError: (e) => say(meetingFailure(e, 'Couldn’t change the key point.'), true) });
  const deleteNote = (note: ApiMeetingNote) =>
    Alert.alert('Delete this note?', 'You can bring it back for a few seconds after.', [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => notesM.remove.mutate(note.id, { onSuccess: () => setUndoNoteId(note.id), onError: (e) => say(meetingFailure(e, 'Couldn’t delete the note.'), true) }),
      },
    ]);
  const restoreNote = () => {
    if (!undoNoteId) return;
    notesM.restore.mutate(undoNoteId, { onSuccess: () => setUndoNoteId(null), onError: (e) => say(meetingFailure(e, 'Couldn’t restore the note.'), true) });
  };
  const reopenMinutes = () =>
    minutesM.reopen.mutate(undefined, {
      onSuccess: () => say('Reopened: the minutes can be changed again. Mark them final when they are ready.'),
      onError: (e) => say(minutesSaveFailure(e, 'Couldn’t reopen the minutes.'), true),
    });

  const retry: Record<Section, () => void> = {
    agenda: () => void agendaQ.refetch(),
    people: () => void peopleQ.refetch(),
    notes: () => void notesQ.refetch(),
    actions: () => void actionsQ.refetch(),
    minutes: () => void minutesQ.refetch(),
  };
  const pull = usePullRefresh(() =>
    Promise.all([meetingQ.refetch(), agendaQ.refetch(), peopleQ.refetch(), notesQ.refetch(), actionsQ.refetch(), minutesQ.refetch()]),
  );

  const primary = meeting ? primaryAction(meeting, canEdit) : null;
  const menu = meeting ? meetingMenu(meeting, canEdit) : [];
  const primaryBusy = lifecycle.setStatus.isPending || lifecycle.duplicate.isPending || (primary === 'export-minutes' && downloading);

  const titleAction = (section: Section): { label: string; a11y: string; onPress: () => void } | null => {
    if (!meeting) return null;
    switch (section) {
      case 'agenda':
        return canEdit ? { label: '＋ Add', a11y: 'Add an agenda item', onPress: () => setSheet({ kind: 'agenda', item: null }) } : null;
      case 'people':
        return canEdit ? { label: '＋ Add', a11y: 'Add people', onPress: () => setSheet({ kind: 'addPerson' }) } : null;
      case 'notes':
        return { label: '＋ Note', a11y: 'Add a note', onPress: () => setSheet({ kind: 'note', note: null }) };
      case 'actions':
        return { label: '＋ Add', a11y: 'Add an action item', onPress: () => setSheet({ kind: 'action', item: null }) };
      default:
        return null;
    }
  };

  const renderItem: ListRenderItem<DetailRow> = ({ item, index }) => {
    if (!meeting) return null;
    const next = rows[index + 1];
    const section = 'section' in item ? item.section : null;
    const place: RowPlace = { last: !!section && (!next || !('section' in next) || next.section !== section) };
    switch (item.kind) {
      case 'header':
        return (
          <MeetingHeaderCard
            meeting={meeting}
            projectName={projectName}
            nameOf={nameOf}
            timeZone={timeZone}
            now={now}
            onJoin={openJoinLink}
            primary={primary ? { label: PRIMARY_LABEL[primary], onPress: () => run(primary), busy: primaryBusy } : null}
            onMore={menu.length ? () => setSheet({ kind: 'actions' }) : null}
          />
        );
      case 'rsvp':
        return <RsvpCard response={mine?.response} busy={respond.isPending} error={rsvpError} onAnswer={answer} />;
      case 'about':
        return <AboutCard meeting={meeting} nameOf={nameOf} />;
      case 'title': {
        const aside =
          item.section === 'agenda' && agendaQ.data?.length
            ? agendaTimingText(agendaTiming(agendaQ.data, meeting.startAt, meeting.endAt))
            : item.section === 'people' && peopleQ.data?.length
              ? responseLine(responseSummary(peopleQ.data))
              : null;
        return (
          <SectionTitleRow
            title={item.title}
            count={item.count}
            aside={aside}
            action={titleAction(item.section)}
            // Draft agenda (AI): proposed items, reviewed before anything is added.
            secondary={item.section === 'agenda' && canEdit ? { label: '✨ Draft', a11y: 'Draft agenda with AI', onPress: () => setSheet({ kind: 'agendaDraft' }) } : null}
          />
        );
      }
      case 'loading':
        return <StateRow kind="loading" text="" place={place} />;
      case 'failed':
        return <StateRow kind="failed" text={`Couldn’t load ${WHAT[item.section]}.`} onRetry={retry[item.section]} place={place} />;
      case 'empty':
        return <StateRow kind="empty" text={item.text} place={place} />;
      case 'agenda':
        return (
          <AgendaRow
            item={item.item}
            index={item.index}
            nameOf={nameOf}
            place={place}
            onToggle={canTickAgendaItem(item.item, viewer) ? () => toggleCovered(item.item) : null}
            onOpen={canEdit ? () => setSheet({ kind: 'agenda', item: item.item }) : null}
            waiting={shown.waiting.has(item.item.id)}
          />
        );
      case 'person': {
        const own = !!item.attendee.userId && item.attendee.userId === myId;
        return (
          <PersonRow
            attendee={item.attendee}
            nameOf={nameOf}
            myId={myId}
            showAttendance={attendanceTime}
            place={place}
            flags={canEdit ? personFlags(item.attendee, meeting) : null}
            onOpen={canEdit || (own && attendanceTime) ? () => setSheet({ kind: 'person', attendeeId: item.attendee.id }) : null}
            waiting={shown.waiting.has(item.attendee.id)}
          />
        );
      }
      case 'more':
        return <MoreRow total={item.total} expanded={item.expanded} onToggle={() => setShowAllPeople((v) => !v)} place={place} />;
      case 'noteFilters':
        return <NoteFiltersRow notes={shown.notes ?? []} filter={noteFilter} onFilter={setNoteFilter} place={place} />;
      case 'note': {
        const n = item.note;
        // A note taken on this phone and not sent yet can't be changed until the server has it.
        const notSent = isWaitingRow(n.id);
        return (
          <NoteRow
            note={n}
            nameOf={nameOf}
            timeZone={timeZone}
            taskKey={n.taskId ? taskKeys.get(n.taskId) ?? null : null}
            onOpenTask={openTask}
            place={place}
            waiting={shown.waiting.has(n.id)}
            actions={
              notSent
                ? undefined
                : {
                    onTask: n.taskId ? null : () => setSheet({ kind: 'noteTask', note: n }),
                    onStar: canManageNote(n, viewer) ? () => toggleKey(n) : null,
                    onEdit: canChangeNoteText(n, myId) ? () => setSheet({ kind: 'note', note: n }) : null,
                    onDelete: canManageNote(n, viewer) ? () => deleteNote(n) : null,
                  }
            }
          />
        );
      }
      case 'action':
        return (
          <ActionRow
            item={item.item}
            nameOf={nameOf}
            now={now}
            onOpenTask={openTask}
            place={place}
            // One added on this phone and not sent yet can be changed once the server has it.
            onOpen={isWaitingRow(item.item.id) ? null : () => setSheet({ kind: 'action', item: item.item })}
            waiting={shown.waiting.has(item.item.id)}
          />
        );
      case 'minutes':
        return (
          <MinutesRow
            minutes={item.minutes}
            timeZone={timeZone}
            place={place}
            actions={{
              onDraft: canEdit ? (source) => navigation.navigate('FinalMinutes', { meetingId, start: source }) : null,
              onContinue: canEdit ? () => navigation.navigate('FinalMinutes', { meetingId }) : null,
              onReopen: canEdit ? reopenMinutes : null,
              reopening: minutesM.reopen.isPending,
              onDownload: () => void exportPdf(),
              downloading,
            }}
          />
        );
      default:
        return null;
    }
  };

  // Deleted, or no longer yours to see: say so, even when a list's copy of it is still here.
  const problem = meetingQ.isError ? meetingLoadProblem(meetingQ.error) : null;
  if (!meeting || (problem && !problem.canRetry)) {
    if (closing.current) return <Loader />;
    if (!meeting && meetingQ.isLoading) return <Loader />;
    if (!problem) return <Loader />;
    return (
      <View style={styles.problem}>
        <ErrorNote message={problem.message} onRetry={problem.canRetry ? () => void meetingQ.refetch() : undefined} retrying={meetingQ.isFetching} />
        <Button title="Back to meetings" variant="secondary" onPress={() => navigation.navigate('Tabs', { screen: 'Meetings' })} />
      </View>
    );
  }

  const header = (
    <View style={styles.headerStack}>
      {meetingQ.isError ? <Text style={styles.stale}>Showing what this phone last loaded — pull down to load it again.</Text> : null}
      {notice ? (
        <Pressable
          onPress={() => setNotice(null)}
          accessibilityRole="button"
          accessibilityLabel={`${notice.text} Dismiss`}
          accessibilityLiveRegion={notice.error ? 'assertive' : 'polite'}
          style={[styles.notice, notice.error ? styles.noticeError : styles.noticeOk]}
        >
          <Text style={[styles.noticeText, notice.error ? styles.noticeTextError : styles.noticeTextOk]}>{notice.text}</Text>
          <Text style={styles.dismiss} importantForAccessibility="no">
            ✕
          </Text>
        </Pressable>
      ) : null}
      {/* This meeting's changes still on this phone, and any the server refused (Retry / Discard). */}
      <SyncStatus only={onlyThisMeeting} />
      {undoNoteId ? (
        <View style={styles.undo} accessibilityLiveRegion="polite">
          <Text style={styles.undoText}>Note deleted.</Text>
          <Button title="Undo" variant="ghost" onPress={restoreNote} loading={notesM.restore.isPending} style={styles.undoButton} />
        </View>
      ) : null}
    </View>
  );

  const personSheet = sheet?.kind === 'person' ? (shown.attendees ?? []).find((a) => a.id === sheet.attendeeId) ?? null : null;
  const dialog = sheet?.kind === 'cancel' ? cancelDialog(meeting, scope) : sheet?.kind === 'delete' ? deleteDialog(meeting, scope) : null;
  const close = () => setSheet(null);

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <FlatList
        data={rows}
        keyExtractor={(r) => r.key}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        initialNumToRender={12}
        windowSize={9}
        ListHeaderComponent={header}
        refreshControl={<RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} />}
      />

      <ActionsSheet
        visible={sheet?.kind === 'actions'}
        items={menu}
        onPick={(i) => {
          // This sheet slides away before the next one (or the share sheet) opens.
          close();
          setTimeout(() => run(i.key), 250);
        }}
        onClose={close}
      />
      <ConfirmScopeSheet
        visible={!!dialog}
        dialog={dialog}
        scope={scope}
        onScope={setScope}
        busy={lifecycle.cancel.isPending || lifecycle.remove.isPending}
        error={scopeError}
        onConfirm={confirmScope}
        onClose={close}
      />
      {canEdit ? <InviteSheet meeting={meeting} visible={sheet?.kind === 'invite'} onClose={close} /> : null}
      {canEdit ? <MinutesEmailSheet meeting={meeting} visible={sheet?.kind === 'minutesEmail'} onClose={close} onDownload={downloadPdf} downloading={downloading} /> : null}
      {canEdit ? <AddPersonSheet meetingId={meetingId} attendees={peopleQ.data ?? []} directory={directory} visible={sheet?.kind === 'addPerson'} onClose={close} /> : null}
      {personSheet ? <PersonSheet meeting={meeting} attendee={personSheet} nameOf={nameOf} canEdit={canEdit} myId={myId} onClose={close} /> : null}
      {canEdit ? (
        <AgendaItemSheet meetingId={meetingId} items={agendaQ.data ?? []} item={sheet?.kind === 'agenda' ? sheet.item : null} directory={directory} visible={sheet?.kind === 'agenda'} onClose={close} />
      ) : null}
      {canEdit ? (
        <AgendaDraftSheet
          meeting={meeting}
          attendees={peopleQ.data ?? []}
          nameOf={nameOf}
          visible={sheet?.kind === 'agendaDraft'}
          onClose={close}
          onAdded={(n) => say(n === 1 ? 'Added 1 item to the agenda.' : `Added ${n} items to the agenda.`)}
        />
      ) : null}
      <NoteSheet meetingId={meetingId} note={sheet?.kind === 'note' ? sheet.note : null} visible={sheet?.kind === 'note'} onClose={close} />
      <NoteTaskSheet meetingId={meetingId} meetingProjectId={meeting.projectId} note={sheet?.kind === 'noteTask' ? sheet.note : null} onClose={close} onOpenTask={openTask} />
      <ActionItemSheet
        meetingId={meetingId}
        item={sheet?.kind === 'action' ? sheet.item : null}
        directory={directory}
        canRemove={sheet?.kind === 'action' && sheet.item ? canRemoveActionItem(sheet.item, viewer) : false}
        visible={sheet?.kind === 'action'}
        onClose={close}
        onOpenTask={openTask}
      />
    </SafeAreaView>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: c.ground },
    list: { padding: spacing.lg },
    problem: { flex: 1, backgroundColor: c.ground, padding: spacing.lg, gap: spacing.md },
    headerStack: { gap: spacing.sm },
    stale: { fontSize: fontSize.sm, color: c.ink2, marginBottom: spacing.sm },
    notice: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, marginBottom: spacing.sm, minHeight: 44 },
    noticeOk: { backgroundColor: c.successSoft },
    noticeError: { backgroundColor: c.dangerSoft },
    noticeText: { flex: 1, fontSize: fontSize.sm, fontWeight: '600' },
    noticeTextOk: { color: c.success },
    noticeTextError: { color: c.danger },
    dismiss: { fontSize: fontSize.sm, color: c.ink3 },
    undo: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1, borderColor: c.line, backgroundColor: c.surface, borderRadius: radius.md, paddingLeft: spacing.md, marginBottom: spacing.sm },
    undoText: { fontSize: fontSize.sm, color: c.ink2 },
    undoButton: { minHeight: 44 },
  });
