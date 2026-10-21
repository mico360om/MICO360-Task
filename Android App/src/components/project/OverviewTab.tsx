import React, { useMemo } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useColors } from '../../core/theme';
import { Badge, Button } from '../ui';
import { MeetingRow } from '../MeetingRow';
import { AiSummaryCard } from './AiSummaryCard';
import { EmptyNote, LinkButton, ProgressBar, SectionCard } from './parts';
import { meetingDayLabel } from './MeetingsTab';
import { categoryColorOf, spacing, radius, fontSize, type Palette } from '../../lib/theme';
import { meetingDayKey } from '../../lib/meetings';
import { projectPriorityLabel, projectStatusLabel, projectStatusTone } from '../../lib/project-identity';
import { teamManagers } from '../../lib/project-team';
import {
  dayText,
  meetingsLine,
  milestoneNote,
  priorityLine,
  projectDeadlines,
  projectMilestones,
  projectTimeline,
  relativeDays,
  timelineText,
  workDoneText,
  workload,
  type MilestoneState,
  type SummaryRequest,
  type TaskFilter,
  type TaskGroup,
  type TaskStats,
} from '../../lib/project-dashboard';
import type { ApiMember, ApiProject, ApiProjectMeetingsOverview, ApiTask } from '../../lib/types';
import { displayName } from '../../lib/types';
import type { Tone } from '../../lib/tone';

const MILESTONE_TONE: Record<MilestoneState, Tone> = { done: 'success', overdue: 'danger', upcoming: 'brand', undated: 'neutral' };

export interface OverviewProps {
  project: ApiProject;
  tasks: ApiTask[];
  groups: TaskGroup[];
  stats: TaskStats;
  statsReady: boolean;
  today: string;
  members: ApiMember[];
  ownerName: string;
  /** The owner picker (administrators), shown instead of the owner's name. */
  ownerControl: React.ReactNode | null;
  meetings: ApiProjectMeetingsOverview | null | undefined;
  meetingsLoading: boolean;
  onOpenTask: (task: { id: string; title: string }) => void;
  onOpenMeeting: (meetingId: string, title?: string | null) => void;
  onShow: (tab: 'tasks' | 'meetings' | 'team', filter?: TaskFilter) => void;
  onOpenBoard: () => void;
  onOpenChat: () => void;
  chatBusy: boolean;
  chatError: string | null;
  onNewMeeting?: () => void;
  summaryRequest: () => SummaryRequest;
}

/**
 * The project at a glance (the Overview tab), as on the website: its details and dates, the work
 * done and the time gone, milestones, deadlines coming up, the AI status summary, who runs it and
 * who has what, the next meeting, and the tasks by status.
 */
export function OverviewTab(p: OverviewProps) {
  const c = useColors();
  const s = useMemo(() => makeStyles(c), [c]);
  const { project, tasks, today, stats } = p;
  const timeline = projectTimeline(project.startDate, project.targetDate, today);
  const marks = projectMilestones(tasks, today);
  const soon = projectDeadlines(tasks, today, 14);
  const people = workload(tasks, today);
  const managers = teamManagers(p.members, p.ownerName);
  const live = p.meetings?.meetings.find((m) => m.phase === 'ongoing') ?? null;
  const next = p.meetings?.stats.nextMeetingId ? p.meetings.meetings.find((m) => m.id === p.meetings!.stats.nextMeetingId) ?? null : null;
  const focus = live ?? next;

  return (
    <View style={s.stack}>
      <SectionCard title="Project details">
        <Text style={s.body}>{project.description || 'No description yet.'}</Text>
        <View style={s.details}>
          <Detail label="Status" s={s}>
            <Badge label={projectStatusLabel(project.status)} tone={projectStatusTone(project.status)} />
          </Detail>
          <Detail label="Priority" s={s} text={projectPriorityLabel(project.priority)} />
          <Detail label="Client" s={s} text={project.clientName || '—'} />
          <Detail label="Start date" s={s} text={dayText(project.startDate)} />
          <Detail label="Target date" s={s} text={dayText(project.targetDate)} />
          <Detail label="Project number" s={s} text={project.number || '—'} />
        </View>
        <View style={s.owner}>
          <Text style={s.detailLabel}>Owner</Text>
          {p.ownerControl ?? <Text style={s.detailValue}>{p.ownerName}</Text>}
          <Text style={s.note}>New tasks default-assign to the owner.</Text>
        </View>

        <View style={s.bars}>
          <View style={s.barBlock}>
            <View style={s.barHead}>
              <Text style={s.barTitle}>Work done</Text>
              <Text style={s.barText}>{workDoneText(stats, p.statsReady)}</Text>
            </View>
            <ProgressBar value={p.statsReady ? stats.avgProgress : 0} label="Work done" tone="success" />
          </View>
          <View style={s.barBlock}>
            <View style={s.barHead}>
              <Text style={s.barTitle}>Time</Text>
              <Text style={[s.barText, timeline?.state === 'late' && s.late]}>{timelineText(timeline)}</Text>
            </View>
            <ProgressBar value={timeline?.elapsedPct ?? 0} label="Time gone" tone={timeline?.state === 'late' ? 'danger' : 'brand'} />
          </View>
        </View>

        <View style={s.actions}>
          <Button title="Open board" onPress={p.onOpenBoard} style={s.action} />
          <Button title="Project chat" variant="secondary" onPress={p.onOpenChat} loading={p.chatBusy} style={s.action} />
          <Button title="View all tasks" variant="secondary" onPress={() => p.onShow('tasks')} style={s.action} />
          <Button title="Meetings" variant="secondary" onPress={() => p.onShow('meetings')} style={s.action} />
        </View>
        {p.chatError ? (
          <Text style={s.error} accessibilityRole="alert">
            {p.chatError}
          </Text>
        ) : null}
      </SectionCard>

      <SectionCard title="Milestones" action={marks.length ? <LinkButton label={`All ${marks.length}`} a11y={`All ${marks.length} milestones`} onPress={() => p.onShow('tasks', 'milestones')} /> : null}>
        {!p.statsReady ? (
          <Text style={s.note}>Loading…</Text>
        ) : marks.length === 0 ? (
          <EmptyNote>No milestones yet. Tick “Milestone” on a task to list it here.</EmptyNote>
        ) : (
          marks.slice(0, 6).map((m) => {
            const note = `${m.due ? `${dayText(m.due)} · ` : ''}${milestoneNote(m.state, m.daysLeft)}`;
            return (
              <Pressable
                key={m.task.id}
                onPress={() => p.onOpenTask(m.task)}
                accessibilityRole="button"
                accessibilityLabel={`Milestone ${m.task.title}, ${note}`}
                style={({ pressed }) => [s.line, pressed && s.pressed]}
              >
                <Text style={[s.flag, { color: toneColor(c, MILESTONE_TONE[m.state]) }]} importantForAccessibility="no">
                  🏁
                </Text>
                <View style={s.lineText}>
                  <Text style={[s.lineTitle, m.state === 'done' && s.done]} numberOfLines={2}>
                    {m.task.title}
                  </Text>
                  <Text style={[s.lineSub, m.state === 'overdue' && s.late]}>{note}</Text>
                </View>
              </Pressable>
            );
          })
        )}
      </SectionCard>

      <SectionCard title="Upcoming deadlines" action={soon.length ? <LinkButton label="Overdue tasks" onPress={() => p.onShow('tasks', 'overdue')} /> : null}>
        {!p.statsReady ? (
          <Text style={s.note}>Loading…</Text>
        ) : soon.length === 0 ? (
          <EmptyNote>Nothing due in the next two weeks.</EmptyNote>
        ) : (
          soon.slice(0, 6).map((d) => {
            const when = d.daysLeft < 0 ? `Late · ${dayText(d.due)}` : relativeDays(d.daysLeft);
            return (
              <Pressable
                key={d.task.id}
                onPress={() => p.onOpenTask(d.task)}
                accessibilityRole="button"
                accessibilityLabel={`${d.task.key}, ${d.task.title}, ${d.daysLeft < 0 ? `late, was due ${dayText(d.due)}` : `due ${when}`}`}
                style={({ pressed }) => [s.line, pressed && s.pressed]}
              >
                <Text style={s.key}>{d.task.key}</Text>
                <Text style={[s.lineTitle, s.flex]} numberOfLines={2}>
                  {d.task.title}
                </Text>
                <Text style={[s.when, d.daysLeft < 0 ? s.late : d.daysLeft <= 2 ? s.soon : null]}>{when}</Text>
              </Pressable>
            );
          })
        )}
      </SectionCard>

      <AiSummaryCard projectId={project.id} ready={p.statsReady} request={p.summaryRequest} />

      <SectionCard title="Team" action={<LinkButton label="Manage team" onPress={() => p.onShow('team')} />}>
        <Text style={s.detailLabel}>Project manager</Text>
        <Text style={s.detailValue}>{managers.text}</Text>
        <Text style={[s.detailLabel, s.gap]}>Members · {p.members.length}</Text>
        {p.members.length ? (
          <View style={s.faces} accessible accessibilityLabel={`Members: ${p.members.map((m) => displayName(m)).join(', ')}`}>
            {p.members.slice(0, 10).map((m) => (
              <View key={m.id} style={s.face}>
                <Text style={s.faceText} allowFontScaling={false}>
                  {displayName(m).slice(0, 2).toUpperCase()}
                </Text>
              </View>
            ))}
            {p.members.length > 10 ? (
              <View style={[s.face, s.faceMore]}>
                <Text style={s.faceMoreText} allowFontScaling={false}>
                  +{p.members.length - 10}
                </Text>
              </View>
            ) : null}
          </View>
        ) : (
          <Text style={s.note}>Nobody yet.</Text>
        )}
        {people.length ? (
          <>
            <Text style={[s.detailLabel, s.gap]}>Who has what</Text>
            {people.slice(0, 5).map((w) => (
              <View key={w.id} style={s.who} accessible accessibilityLabel={`${w.name}: ${w.open} open${w.overdue ? `, ${w.overdue} late` : ''}`}>
                <Text style={[s.whoName, s.flex]} numberOfLines={1}>
                  {w.name}
                </Text>
                <Text style={s.whoNum}>{w.open} open</Text>
                {w.overdue ? <Text style={[s.whoNum, s.late]}>{w.overdue} late</Text> : null}
              </View>
            ))}
          </>
        ) : null}
      </SectionCard>

      <SectionCard title={live ? 'Meeting under way' : 'Next meeting'} action={<LinkButton label="All meetings" onPress={() => p.onShow('meetings')} />}>
        {p.meetings === null ? (
          <EmptyNote>Meetings aren’t available on this server.</EmptyNote>
        ) : p.meetingsLoading && !p.meetings ? (
          <Text style={s.note}>Loading…</Text>
        ) : focus ? (
          <MeetingRow meeting={focus} showDate={meetingDayLabel(meetingDayKey(focus))} onPress={() => p.onOpenMeeting(focus.id, focus.title)} />
        ) : (
          <EmptyNote>No meeting planned.</EmptyNote>
        )}
        {p.meetings ? <Text style={s.note}>{meetingsLine(p.meetings.stats)}</Text> : null}
        {p.onNewMeeting ? <Button title="+ New meeting" accessibilityLabel="New meeting" variant="secondary" onPress={p.onNewMeeting} /> : null}
      </SectionCard>

      <SectionCard title="Tasks by status">
        {!p.statsReady ? (
          <Text style={s.note}>Loading…</Text>
        ) : stats.total === 0 ? (
          <EmptyNote>No tasks in this project yet.</EmptyNote>
        ) : (
          <>
            {p.groups.map((g) => {
              const pct = stats.total ? Math.round((g.tasks.length / stats.total) * 100) : 0;
              const color = g.color ?? (g.category ? categoryColorOf(c, g.category) : c.ink3);
              return (
                <View key={g.id} style={s.statusRow} accessible accessibilityLabel={`${g.name}: ${g.tasks.length} ${g.tasks.length === 1 ? 'task' : 'tasks'}`}>
                  <View style={[s.dot, { backgroundColor: color }]} />
                  <Text style={s.statusName} numberOfLines={2}>
                    {g.name}
                  </Text>
                  <View style={s.statusTrack}>
                    <View style={[s.statusFill, { width: `${pct}%`, backgroundColor: color }]} />
                  </View>
                  <Text style={s.statusNum}>{g.tasks.length}</Text>
                </View>
              );
            })}
            <Text style={s.note}>{priorityLine(stats)}</Text>
          </>
        )}
      </SectionCard>
    </View>
  );
}

function toneColor(c: Palette, tone: Tone): string {
  return tone === 'success' ? c.success : tone === 'danger' ? c.danger : tone === 'brand' ? c.brand : c.ink3;
}

function Detail({ label, text, children, s }: { label: string; text?: string; children?: React.ReactNode; s: ReturnType<typeof makeStyles> }) {
  return (
    <View style={s.detail} accessible accessibilityLabel={text !== undefined ? `${label}: ${text}` : undefined}>
      <Text style={s.detailLabel}>{label}</Text>
      {children ?? <Text style={s.detailValue}>{text}</Text>}
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    stack: { gap: spacing.md },
    flex: { flex: 1 },
    gap: { marginTop: spacing.sm },
    pressed: { opacity: 0.7 },
    body: { fontSize: fontSize.md, color: c.ink2, lineHeight: 22 },
    details: { flexDirection: 'row', flexWrap: 'wrap', rowGap: spacing.sm, marginTop: spacing.sm },
    detail: { flexBasis: '50%', flexGrow: 1, paddingRight: spacing.sm, gap: 2 },
    detailLabel: { fontSize: fontSize.xs, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase', color: c.ink3 },
    detailValue: { fontSize: fontSize.md, fontWeight: '600', color: c.ink },
    owner: { borderTopWidth: 1, borderTopColor: c.line, paddingTop: spacing.md, marginTop: spacing.sm, gap: spacing.xs },
    note: { fontSize: fontSize.sm, color: c.ink2 },
    bars: { borderTopWidth: 1, borderTopColor: c.line, paddingTop: spacing.md, marginTop: spacing.sm, gap: spacing.md },
    barBlock: { gap: spacing.xs },
    barHead: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: spacing.xs },
    barTitle: { fontSize: fontSize.md, fontWeight: '700', color: c.ink },
    barText: { fontSize: fontSize.sm, color: c.ink2, flexShrink: 1 },
    late: { color: c.danger, fontWeight: '700' },
    soon: { color: c.warning, fontWeight: '700' },
    actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md },
    action: { flexGrow: 1, flexBasis: '45%' },
    error: { color: c.danger, fontSize: fontSize.sm },
    line: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm, borderTopWidth: 1, borderTopColor: c.line, minHeight: 48 },
    flag: { fontSize: fontSize.md, width: 22, textAlign: 'center' },
    lineText: { flex: 1 },
    lineTitle: { fontSize: fontSize.md, fontWeight: '600', color: c.ink },
    lineSub: { fontSize: fontSize.xs, color: c.ink2, marginTop: 2 },
    done: { textDecorationLine: 'line-through', color: c.ink2 },
    key: { fontSize: fontSize.xs, fontWeight: '700', color: c.ink3, minWidth: 52 },
    when: { fontSize: fontSize.xs, color: c.ink2, maxWidth: '35%', textAlign: 'right' },
    faces: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
    face: { width: 28, height: 28, borderRadius: 14, backgroundColor: c.brand, alignItems: 'center', justifyContent: 'center' },
    faceText: { color: c.onBrand, fontSize: 10, fontWeight: '700' },
    faceMore: { backgroundColor: c.ground, borderWidth: 1, borderColor: c.line },
    faceMoreText: { color: c.ink2, fontSize: 10, fontWeight: '700' },
    who: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 32 },
    whoName: { fontSize: fontSize.md, color: c.ink },
    whoNum: { fontSize: fontSize.sm, color: c.ink2 },
    statusRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 32 },
    dot: { width: 10, height: 10, borderRadius: 5 },
    statusName: { fontSize: fontSize.sm, color: c.ink, width: '32%' },
    statusTrack: { flex: 1, height: 8, borderRadius: radius.pill, backgroundColor: c.ground, overflow: 'hidden' },
    statusFill: { height: 8, borderRadius: radius.pill },
    statusNum: { fontSize: fontSize.sm, fontWeight: '700', color: c.ink2, minWidth: 24, textAlign: 'right' },
  });
