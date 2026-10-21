import React, { useCallback, useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet, RefreshControl, Pressable } from 'react-native';
import { useProject, useProjectMeetings, useProjectMembers, useProjectProgress, useProjectTasks } from '../core/queries';
import { useOpenProjectChat } from '../core/chat';
import { useColors } from '../core/theme';
import { Card, SectionTitle, Loader, ErrorNote, Pill, Badge, Button } from '../components/ui';
import { displayName, type ApiProjectMeetingsOverview } from '../lib/types';
import { companyTodayKey, formatDueDay } from '../lib/due-date';
import { daysLeftLabel, projectDeadlines, projectMilestones, type MilestoneState } from '../lib/project-dashboard';
import { meetingDayKey } from '../lib/meetings';
import { recurrenceSummary } from '../lib/recurrence-summary';
import { TaskRow } from '../components/TaskRow';
import { MeetingRow } from '../components/MeetingRow';
import type { Tone } from '../lib/tone';
import { spacing, fontSize, radius, type Palette } from '../lib/theme';
import type { AppScreenProps } from '../navigation/types';

/**
 * Project details (A5.1): what the project is, how far along it is, its milestones, the deadlines
 * coming up, its meetings (each opens in the app; "Schedule a meeting" adds one to it) and who is on the team —
 * with shortcuts to its board and its chat channel.
 */
export function ProjectDetailScreen({ route, navigation }: AppScreenProps<'ProjectDetail'>) {
  const { projectId } = route.params;
  const c = useColors();
  const styles = useMemo(() => makeStyles(c), [c]);
  const projectQ = useProject(projectId);
  const progressQ = useProjectProgress(projectId);
  const membersQ = useProjectMembers(projectId);
  const tasksQ = useProjectTasks(projectId);
  const meetingsQ = useProjectMeetings(projectId);
  const today = companyTodayKey();
  const milestones = useMemo(() => projectMilestones(tasksQ.data ?? [], today), [tasksQ.data, today]);
  const deadlines = useMemo(() => projectDeadlines(tasksQ.data ?? [], today), [tasksQ.data, today]);
  // The project's channel: at once when the inbox knows it (offline too), read as it opens (3a).
  const goToChat = useCallback(
    (conversationId: string, name: string) => navigation.navigate('ChatThread', { conversationId, title: name }),
    [navigation],
  );
  const chat = useOpenProjectChat(goToChat);
  const chatError = chat.error;
  const openingChat = chat.opening === projectId;

  const project = projectQ.data;
  const progress = progressQ.data;
  const members = [...(membersQ.data ?? [])].sort((a, b) => (a.role === b.role ? displayName(a).localeCompare(displayName(b)) : a.role === 'MANAGER' ? -1 : 1));
  const refreshing = projectQ.isRefetching || progressQ.isRefetching || membersQ.isRefetching || tasksQ.isRefetching || meetingsQ.isRefetching;
  const openTask = (t: { id: string; title: string }) => navigation.navigate('TaskDetail', { taskId: t.id, title: t.title });

  function openChat() {
    if (project) void chat.open(projectId, project.name);
  }

  if (projectQ.isLoading) return <Loader />;
  if (!project) {
    return (
      <View style={styles.safe}>
        <ErrorNote message="Couldn’t load this project." onRetry={() => void projectQ.refetch()} retrying={projectQ.isRefetching} />
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.safe}
      contentContainerStyle={styles.scroll}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            void projectQ.refetch();
            void progressQ.refetch();
            void membersQ.refetch();
            void tasksQ.refetch();
            void meetingsQ.refetch();
          }}
        />
      }
    >
      <Card>
        <View style={styles.headRow}>
          <Text style={styles.code}>
            {project.code}
            {project.number ? <Text style={styles.number}>{`  ·  Project no. ${project.number}`}</Text> : null}
          </Text>
          <Pill label={project.status} />
        </View>
        <Text style={styles.name}>{project.name}</Text>
        {project.clientName ? <Text style={styles.meta}>Client: {project.clientName}</Text> : null}
        {project.startDate || project.targetDate ? (
          <Text style={styles.meta}>
            {project.startDate ? `Starts ${project.startDate.slice(0, 10)}` : ''}
            {project.startDate && project.targetDate ? ' · ' : ''}
            {project.targetDate ? `Target ${project.targetDate.slice(0, 10)}` : ''}
          </Text>
        ) : null}
        {project.description ? <Text style={styles.desc}>{project.description}</Text> : null}
        <View style={styles.actions}>
          <Button title="Open board" onPress={() => navigation.navigate('Board', { projectId, projectName: project.name })} style={styles.action} />
          <Button title="Project chat" variant="secondary" onPress={() => void openChat()} loading={openingChat} style={styles.action} />
        </View>
        {/* New task in this project (4a, the website's project page). */}
        <Button title="New task" variant="secondary" onPress={() => navigation.navigate('NewTask', { projectId })} style={{ marginTop: spacing.sm }} />
        {chatError ? <Text style={styles.error} accessibilityRole="alert">{chatError}</Text> : null}
      </Card>

      <Card>
        <SectionTitle>Progress{progress ? ` · ${progress.completionPct}%` : ''}</SectionTitle>
        {progress ? (
          <>
            <View style={styles.bar} importantForAccessibility="no-hide-descendants">
              <View style={[styles.barFill, { width: `${Math.min(100, Math.max(0, progress.completionPct))}%` }]} />
            </View>
            <View style={styles.stats}>
              <Stat label="Done" value={progress.completed} styles={styles} />
              <Stat label="In progress" value={progress.inProgress} styles={styles} />
              <Stat label="To do" value={progress.todo} styles={styles} />
              <Stat label="Overdue" value={progress.overdue} styles={styles} danger={progress.overdue > 0} />
            </View>
          </>
        ) : progressQ.isError ? (
          <Text style={styles.meta}>Progress isn’t available right now.</Text>
        ) : (
          <Loader />
        )}
      </Card>

      {milestones.length > 0 ? (
        <Card>
          <SectionTitle>Milestones · {milestones.filter((m) => m.state === 'done').length} of {milestones.length} done</SectionTitle>
          {milestones.map((m) => (
            <Pressable
              key={m.task.id}
              onPress={() => openTask(m.task)}
              accessibilityRole="button"
              accessibilityLabel={`Milestone ${m.task.title}, ${m.due ? `due ${formatDueDay(m.due)}` : 'no date'}, ${milestoneText(m.state, m.daysLeft)}`}
              style={({ pressed }) => [styles.line, pressed && styles.pressed]}
            >
              <Text style={styles.flag} importantForAccessibility="no">🏁</Text>
              <View style={styles.lineText}>
                <Text style={[styles.lineTitle, m.state === 'done' && styles.doneTitle]} numberOfLines={2}>{m.task.title}</Text>
                {m.due ? <Text style={styles.lineSub}>{formatDueDay(m.due)}</Text> : null}
              </View>
              <Badge label={milestoneText(m.state, m.daysLeft)} tone={MILESTONE_TONE[m.state]} />
            </Pressable>
          ))}
        </Card>
      ) : null}

      <Card>
        <SectionTitle>Deadlines · late or due within two weeks</SectionTitle>
        {tasksQ.isError && !tasksQ.data ? (
          <Text style={styles.meta}>The project’s tasks aren’t available right now.</Text>
        ) : !tasksQ.data ? (
          <Loader />
        ) : deadlines.length === 0 ? (
          <Text style={styles.meta}>Nothing late and nothing due in the next two weeks.</Text>
        ) : (
          <View style={styles.list}>
            {deadlines.slice(0, 6).map((d) => (
              <TaskRow key={d.task.id} task={d.task} onPress={() => openTask(d.task)} />
            ))}
            {deadlines.length > 6 ? <Text style={styles.meta}>+ {deadlines.length - 6} more on the board</Text> : null}
          </View>
        )}
      </Card>

      {meetingsQ.data === null ? null : (
        <Card>
          <SectionTitle>Meetings</SectionTitle>
          {meetingsQ.isError && !meetingsQ.data ? (
            <Text style={styles.meta}>The project’s meetings aren’t available right now.</Text>
          ) : !meetingsQ.data ? (
            <Loader />
          ) : (
            <ProjectMeetings overview={meetingsQ.data} styles={styles} onOpen={(meetingId, title) => navigation.navigate('MeetingDetail', { meetingId, title: title ?? undefined })} />
          )}
          <Button title="Schedule a meeting" variant="secondary" onPress={() => navigation.navigate('MeetingForm', { projectId })} />
        </Card>
      )}

      <Card>
        <SectionTitle>Team · {members.length}</SectionTitle>
        {membersQ.isError && members.length === 0 ? (
          <Text style={styles.meta}>The team list isn’t available right now.</Text>
        ) : members.length === 0 ? (
          <Text style={styles.meta}>No members yet.</Text>
        ) : (
          members.map((m) => (
            <View key={m.id} style={styles.member} accessible accessibilityLabel={`${displayName(m)}${m.role === 'MANAGER' ? ', project manager' : ''}`}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{displayName(m).slice(0, 2).toUpperCase()}</Text>
              </View>
              <View style={styles.memberText}>
                <Text style={styles.memberName}>{displayName(m)}</Text>
                <Text style={styles.memberSub}>@{m.username}</Text>
              </View>
              {m.role === 'MANAGER' ? <Badge label="Manager" tone="brand" /> : null}
            </View>
          ))
        )}
      </Card>
    </ScrollView>
  );
}

const MILESTONE_TONE: Record<MilestoneState, Tone> = { done: 'success', overdue: 'danger', upcoming: 'brand', undated: 'neutral' };

function milestoneText(state: MilestoneState, daysLeft: number | null): string {
  if (state === 'done') return 'Done';
  if (state === 'undated' || daysLeft === null) return 'No date';
  return daysLeftLabel(daysLeft);
}

/** "Tue, Oct 20" for a 'YYYY-MM-DD' day, never shifted by the phone's time zone. */
function dayLabel(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString(undefined, { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' });
}

/** A line of the meetings card; it opens its meeting when it has one. */
function MeetingLine({ onPress, styles, children, label }: { onPress?: () => void; styles: ReturnType<typeof makeStyles>; children: React.ReactNode; label?: string }) {
  if (!onPress) {
    return (
      <View style={styles.line} accessible>
        {children}
      </View>
    );
  }
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} accessibilityHint="Opens the meeting" style={({ pressed }) => [styles.line, pressed && styles.pressed]}>
      {children}
    </Pressable>
  );
}

/** The project's meetings: counts, the next few, its repeating series, open action items and decisions — each opens its meeting. */
function ProjectMeetings({
  overview,
  styles,
  onOpen,
}: {
  overview: ApiProjectMeetingsOverview;
  styles: ReturnType<typeof makeStyles>;
  onOpen: (meetingId: string, title?: string | null) => void;
}) {
  const next = overview.meetings
    .filter((m) => m.phase === 'upcoming' || m.phase === 'ongoing')
    .sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt))
    .slice(0, 3);
  const actions = overview.actionItems.slice(0, 5);
  const decisions = overview.decisions.slice(0, 3);
  const { stats } = overview;
  if (overview.meetings.length === 0 && overview.actionItems.length === 0) {
    return <Text style={styles.meta}>No meetings for this project yet.</Text>;
  }
  return (
    <View style={styles.list}>
      <View style={styles.stats}>
        <Stat label="Upcoming" value={stats.upcoming + stats.ongoing} styles={styles} />
        <Stat label="Held" value={stats.completed} styles={styles} />
        <Stat label="Open actions" value={stats.openActionItems} styles={styles} danger={stats.overdueActionItems > 0} />
        <Stat label="Decisions" value={stats.decisions} styles={styles} />
      </View>

      <Text style={styles.subhead} accessibilityRole="header">Next meetings</Text>
      {next.length === 0 ? (
        <Text style={styles.meta}>No meetings coming up.</Text>
      ) : (
        next.map((m) => <MeetingRow key={m.id} meeting={m} showDate={dayLabel(meetingDayKey(m))} onPress={() => onOpen(m.id, m.title)} />)
      )}

      {overview.series.length > 0 ? (
        <>
          <Text style={styles.subhead} accessibilityRole="header">Repeating meetings</Text>
          {overview.series.map((s) => {
            const when = `${recurrenceSummary(s.rule)}${s.nextStartAt ? ` · next ${dayLabel(meetingDayKey({ startAt: s.nextStartAt }))}` : ' · nothing coming up'}`;
            const nextId = s.nextMeetingId;
            return (
              <MeetingLine key={s.id} styles={styles} onPress={nextId ? () => onOpen(nextId, s.title) : undefined} label={`${s.title}, ${when}`}>
                <Text style={styles.flag} importantForAccessibility="no">🔁</Text>
                <View style={styles.lineText}>
                  <Text style={styles.lineTitle} numberOfLines={2}>{s.title}</Text>
                  <Text style={styles.lineSub}>{when}</Text>
                </View>
              </MeetingLine>
            );
          })}
        </>
      ) : null}

      {actions.length > 0 ? (
        <>
          <Text style={styles.subhead} accessibilityRole="header">
            Open action items{stats.overdueActionItems > 0 ? ` · ${stats.overdueActionItems} overdue` : ''}
          </Text>
          {actions.map((a) => {
            const sub = [a.assignee?.name ?? 'Unassigned', a.dueDate ? `${a.overdue ? 'overdue, was due' : 'due'} ${formatDueDay(a.dueDate)}` : null, a.meetingTitle].filter(Boolean).join(' · ');
            const meetingId = a.meetingId;
            return (
              <MeetingLine key={a.id} styles={styles} onPress={meetingId ? () => onOpen(meetingId, a.meetingTitle) : undefined} label={`${a.description}, ${sub}`}>
                <Text style={styles.flag} importantForAccessibility="no">☐</Text>
                <View style={styles.lineText}>
                  <Text style={styles.lineTitle} numberOfLines={3}>{a.description}</Text>
                  <Text style={[styles.lineSub, a.overdue && styles.overdue]}>{sub}</Text>
                </View>
              </MeetingLine>
            );
          })}
          {stats.openActionItems > actions.length ? <Text style={styles.meta}>+ {stats.openActionItems - actions.length} more</Text> : null}
        </>
      ) : null}

      {decisions.length > 0 ? (
        <>
          <Text style={styles.subhead} accessibilityRole="header">Recent decisions</Text>
          {decisions.map((d) => (
            <MeetingLine key={d.id} styles={styles} onPress={() => onOpen(d.meetingId, d.meetingTitle)} label={[d.text, d.meetingTitle].filter(Boolean).join(', ')}>
              <Text style={styles.flag} importantForAccessibility="no">✔</Text>
              <View style={styles.lineText}>
                <Text style={styles.lineTitle}>{d.text}</Text>
                {d.meetingTitle ? <Text style={styles.lineSub}>{d.meetingTitle}</Text> : null}
              </View>
            </MeetingLine>
          ))}
        </>
      ) : null}
    </View>
  );
}

function Stat({ label, value, styles, danger }: { label: string; value: number; styles: ReturnType<typeof makeStyles>; danger?: boolean }) {
  return (
    <View style={styles.stat} accessible accessibilityLabel={`${label}: ${value}`}>
      <Text style={[styles.statValue, danger && styles.statDanger]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: c.ground },
    scroll: { padding: spacing.lg, gap: spacing.md },
    headRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    code: { fontSize: fontSize.xs, fontWeight: '700', color: c.brand, letterSpacing: 1, flexShrink: 1 },
    number: { color: c.ink2, letterSpacing: 0 },
    list: { gap: spacing.sm },
    subhead: { fontSize: fontSize.sm, fontWeight: '800', color: c.ink2, marginTop: spacing.sm },
    line: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm, borderTopWidth: 1, borderTopColor: c.line, minHeight: 48 },
    pressed: { opacity: 0.7 },
    flag: { fontSize: fontSize.md, width: 22, textAlign: 'center', color: c.ink2 },
    lineText: { flex: 1 },
    lineTitle: { fontSize: fontSize.md, fontWeight: '600', color: c.ink },
    doneTitle: { textDecorationLine: 'line-through', color: c.ink2 },
    lineSub: { fontSize: fontSize.xs, color: c.ink2, marginTop: 2 },
    overdue: { color: c.danger, fontWeight: '700' },
    name: { fontSize: fontSize.xl, fontWeight: '800', color: c.ink, marginTop: spacing.xs },
    meta: { fontSize: fontSize.sm, color: c.ink2, marginTop: spacing.xs },
    desc: { fontSize: fontSize.md, color: c.ink, marginTop: spacing.sm, lineHeight: 22 },
    actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg },
    action: { flex: 1 },
    error: { color: c.danger, fontSize: fontSize.sm, marginTop: spacing.sm },
    bar: { height: 8, borderRadius: 4, backgroundColor: c.line, overflow: 'hidden', marginTop: spacing.sm },
    barFill: { height: 8, borderRadius: 4, backgroundColor: c.success },
    stats: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.md },
    stat: { alignItems: 'center', flex: 1 },
    statValue: { fontSize: fontSize.xl, fontWeight: '800', color: c.ink },
    statDanger: { color: c.danger },
    statLabel: { fontSize: fontSize.xs, color: c.ink3, marginTop: 2 },
    member: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm, borderTopWidth: 1, borderTopColor: c.line },
    avatar: { width: 36, height: 36, borderRadius: radius.pill, backgroundColor: c.brand, alignItems: 'center', justifyContent: 'center' },
    avatarText: { color: c.onBrand, fontWeight: '700', fontSize: fontSize.xs },
    memberText: { flex: 1 },
    memberName: { fontSize: fontSize.md, fontWeight: '600', color: c.ink },
    memberSub: { fontSize: fontSize.xs, color: c.ink3 },
  });
