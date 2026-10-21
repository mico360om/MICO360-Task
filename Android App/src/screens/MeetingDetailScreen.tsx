import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, FlatList, StyleSheet, RefreshControl, type ListRenderItem } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
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
import { useUserId } from '../core/providers';
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
import { openJoinLink, useMinuteNow, usePullRefresh } from '../components/meeting/live';
import { appTimeZone } from '../lib/due-date';
import { agendaTiming, agendaTimingText, answerAfterTap, canAnswer, meetingLoadProblem, myInvitation, responseLine, responseSummary } from '../lib/meeting-detail';
import { meetingDetailRows, type DetailRow, type NoteFilter, type Section } from '../lib/meeting-screen';
import { failureText } from '../lib/task-detail';
import { displayName, type InvitationResponse } from '../lib/types';
import { spacing, fontSize, type Palette } from '../lib/theme';
import type { AppScreenProps } from '../navigation/types';

const WHAT: Record<Section, string> = { agenda: 'the agenda', people: 'the people', notes: 'the notes', actions: 'the action items', minutes: 'the final minutes' };

/**
 * One meeting (2a, taking part): when, where and Join; your answer to the invitation; what it is
 * about; its agenda, people and their answers, Live notes, action items and final minutes — all
 * read-only apart from your answer. It stays current through the meeting's live events (one app-wide
 * socket); pull down to load it again. Running the meeting is on the website.
 */
export function MeetingDetailScreen({ route, navigation }: AppScreenProps<'MeetingDetail'>) {
  const { meetingId } = route.params;
  const c = useColors();
  const styles = useMemo(() => makeStyles(c), [c]);
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
  const [showAllPeople, setShowAllPeople] = useState(false);
  const [noteFilter, setNoteFilter] = useState<NoteFilter>('ALL');
  const [rsvpError, setRsvpError] = useState<string | null>(null);
  const timeZone = appTimeZone();
  const now = useMinuteNow();

  const meeting = meetingQ.data;
  useEffect(() => {
    if (meeting?.title && meeting.title !== route.params.title) navigation.setOptions({ title: meeting.title });
  }, [meeting?.title, route.params.title, navigation]);

  const people = useMemo(() => new Map((dirQ.data ?? []).map((u) => [u.id, displayName(u)])), [dirQ.data]);
  const nameOf = useCallback((id: string) => people.get(id) ?? null, [people]);
  const projectName = meeting?.projectId ? (projectsQ.data ?? []).find((p) => p.id === meeting.projectId)?.name ?? null : null;
  const mine = myInvitation(peopleQ.data ?? [], myId);
  const taskKeys = useMemo(() => new Map((actionsQ.data ?? []).flatMap((i) => (i.taskId && i.taskKey ? [[i.taskId, i.taskKey] as const] : []))), [actionsQ.data]);
  const openTask = useCallback((taskId: string) => navigation.navigate('TaskDetail', { taskId }), [navigation]);

  const part = <T,>(q: { data?: T; isLoading: boolean; isError: boolean }) => ({ data: q.data, loading: q.isLoading, failed: q.isError && q.data === undefined });
  // A few hundred rows at most, built again on each render (cheap); the list draws only what is on screen.
  const rows = meeting
    ? meetingDetailRows({
        meeting,
        canRsvp: !!mine && canAnswer(meeting),
        agenda: part(agendaQ),
        people: part(peopleQ),
        notes: part(notesQ),
        actions: part(actionsQ),
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

  const renderItem: ListRenderItem<DetailRow> = ({ item, index }) => {
    if (!meeting) return null;
    const next = rows[index + 1];
    const section = 'section' in item ? item.section : null;
    const place: RowPlace = { last: !!section && (!next || !('section' in next) || next.section !== section) };
    switch (item.kind) {
      case 'header':
        return <MeetingHeaderCard meeting={meeting} projectName={projectName} nameOf={nameOf} timeZone={timeZone} now={now} onJoin={openJoinLink} />;
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
        return <SectionTitleRow title={item.title} count={item.count} aside={aside} />;
      }
      case 'loading':
        return <StateRow kind="loading" text="" place={place} />;
      case 'failed':
        return <StateRow kind="failed" text={`Couldn’t load ${WHAT[item.section]}.`} onRetry={retry[item.section]} place={place} />;
      case 'empty':
        return <StateRow kind="empty" text={item.text} place={place} />;
      case 'agenda':
        return <AgendaRow item={item.item} index={item.index} nameOf={nameOf} place={place} />;
      case 'person':
        return (
          <PersonRow attendee={item.attendee} nameOf={nameOf} myId={myId} showAttendance={meeting.status === 'IN_PROGRESS' || meeting.status === 'COMPLETED'} place={place} />
        );
      case 'more':
        return <MoreRow total={item.total} expanded={item.expanded} onToggle={() => setShowAllPeople((v) => !v)} place={place} />;
      case 'noteFilters':
        return <NoteFiltersRow notes={notesQ.data ?? []} filter={noteFilter} onFilter={setNoteFilter} place={place} />;
      case 'note':
        return <NoteRow note={item.note} nameOf={nameOf} timeZone={timeZone} taskKey={item.note.taskId ? taskKeys.get(item.note.taskId) ?? null : null} onOpenTask={openTask} place={place} />;
      case 'action':
        return <ActionRow item={item.item} nameOf={nameOf} now={now} onOpenTask={openTask} place={place} />;
      case 'minutes':
        return <MinutesRow minutes={item.minutes} timeZone={timeZone} place={place} />;
      case 'footer':
        return meeting.canEdit ? <Text style={styles.footer}>To change this meeting, its agenda, notes or minutes, open it on the website.</Text> : null;
      default:
        return null;
    }
  };

  // Deleted, or no longer yours to see: say so, even when a list's copy of it is still here.
  const problem = meetingQ.isError ? meetingLoadProblem(meetingQ.error) : null;
  if (!meeting || (problem && !problem.canRetry)) {
    if (!meeting && meetingQ.isLoading) return <Loader />;
    if (!problem) return <Loader />;
    return (
      <View style={styles.problem}>
        <ErrorNote message={problem.message} onRetry={problem.canRetry ? () => void meetingQ.refetch() : undefined} retrying={meetingQ.isFetching} />
        <Button title="Back to meetings" variant="secondary" onPress={() => navigation.navigate('Tabs', { screen: 'Meetings' })} />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <FlatList
        data={rows}
        keyExtractor={(r) => r.key}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        initialNumToRender={12}
        windowSize={9}
        ListHeaderComponent={
          meetingQ.isError ? <Text style={styles.stale}>Showing what this phone last loaded — pull down to load it again.</Text> : null
        }
        refreshControl={<RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} />}
      />
    </SafeAreaView>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: c.ground },
    list: { padding: spacing.lg },
    problem: { flex: 1, backgroundColor: c.ground, padding: spacing.lg, gap: spacing.md },
    stale: { fontSize: fontSize.sm, color: c.ink2, marginBottom: spacing.sm },
    footer: { fontSize: fontSize.xs, color: c.ink3, textAlign: 'center', marginTop: spacing.xs },
  });
