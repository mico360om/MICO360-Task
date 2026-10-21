import React, { useMemo } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useColors } from '../../core/theme';
import { MeetingRow } from '../MeetingRow';
import { Button, ErrorNote, Loader } from '../ui';
import { EmptyNote, SectionCard } from './parts';
import { formatDueDay } from '../../lib/due-date';
import { meetingDayKey } from '../../lib/meetings';
import { recurrenceSummary } from '../../lib/recurrence-summary';
import type { ApiProjectMeetingsOverview } from '../../lib/types';
import { spacing, fontSize, type Palette } from '../../lib/theme';

/** "Tue, Oct 20" for a 'YYYY-MM-DD' day, never shifted by the phone's time zone. */
export function meetingDayLabel(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString(undefined, { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' });
}

/**
 * The project's meetings (the Meetings tab): counts, the next few, its repeating series, open action
 * items and recent decisions — each opens its meeting — and "Schedule a meeting" while the project is
 * still open (not completed or archived), as on the website.
 */
export function MeetingsTab({
  overview,
  loading,
  failed,
  onRetry,
  retrying,
  onOpen,
  onSchedule,
}: {
  overview: ApiProjectMeetingsOverview | null | undefined;
  loading: boolean;
  failed: boolean;
  onRetry: () => void;
  retrying: boolean;
  onOpen: (meetingId: string, title?: string | null) => void;
  onSchedule?: () => void;
}) {
  const c = useColors();
  const s = useMemo(() => makeStyles(c), [c]);
  if (overview === null) return <EmptyNote>Meetings aren’t available on this server.</EmptyNote>;
  return (
    <SectionCard title="Meetings">
      {failed && !overview ? (
        <ErrorNote message="The project’s meetings aren’t available right now." onRetry={onRetry} retrying={retrying} />
      ) : loading || !overview ? (
        <Loader />
      ) : (
        <ProjectMeetings overview={overview} s={s} onOpen={onOpen} />
      )}
      {onSchedule ? <Button title="Schedule a meeting" variant="secondary" onPress={onSchedule} /> : null}
    </SectionCard>
  );
}

type Styles = ReturnType<typeof makeStyles>;

/** A line of the meetings card; it opens its meeting when it has one. */
function MeetingLine({ onPress, s, children, label }: { onPress?: () => void; s: Styles; children: React.ReactNode; label: string }) {
  if (!onPress) {
    return (
      <View style={s.line} accessible accessibilityLabel={label}>
        {children}
      </View>
    );
  }
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} accessibilityHint="Opens the meeting" style={({ pressed }) => [s.line, pressed && s.pressed]}>
      {children}
    </Pressable>
  );
}

function ProjectMeetings({ overview, s, onOpen }: { overview: ApiProjectMeetingsOverview; s: Styles; onOpen: (meetingId: string, title?: string | null) => void }) {
  const next = overview.meetings
    .filter((m) => m.phase === 'upcoming' || m.phase === 'ongoing')
    .sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt))
    .slice(0, 3);
  const actions = overview.actionItems.slice(0, 5);
  const decisions = overview.decisions.slice(0, 3);
  const { stats } = overview;
  if (overview.meetings.length === 0 && overview.actionItems.length === 0) {
    return <EmptyNote>No meetings for this project yet.</EmptyNote>;
  }
  return (
    <View style={s.list}>
      <View style={s.stats}>
        <Stat label="Upcoming" value={stats.upcoming + stats.ongoing} s={s} />
        <Stat label="Held" value={stats.completed} s={s} />
        <Stat label="Open actions" value={stats.openActionItems} s={s} danger={stats.overdueActionItems > 0} />
        <Stat label="Decisions" value={stats.decisions} s={s} />
      </View>

      <Text style={s.subhead} accessibilityRole="header">
        Next meetings
      </Text>
      {next.length === 0 ? (
        <Text style={s.meta}>No meetings coming up.</Text>
      ) : (
        next.map((m) => <MeetingRow key={m.id} meeting={m} showDate={meetingDayLabel(meetingDayKey(m))} onPress={() => onOpen(m.id, m.title)} />)
      )}

      {overview.series.length > 0 ? (
        <>
          <Text style={s.subhead} accessibilityRole="header">
            Repeating meetings
          </Text>
          {overview.series.map((sr) => {
            const when = `${recurrenceSummary(sr.rule)}${sr.nextStartAt ? ` · next ${meetingDayLabel(meetingDayKey({ startAt: sr.nextStartAt }))}` : ' · nothing coming up'}`;
            const nextId = sr.nextMeetingId;
            return (
              <MeetingLine key={sr.id} s={s} onPress={nextId ? () => onOpen(nextId, sr.title) : undefined} label={`${sr.title}, ${when}`}>
                <Text style={s.flag} importantForAccessibility="no">🔁</Text>
                <View style={s.lineText}>
                  <Text style={s.lineTitle} numberOfLines={2}>{sr.title}</Text>
                  <Text style={s.lineSub}>{when}</Text>
                </View>
              </MeetingLine>
            );
          })}
        </>
      ) : null}

      {actions.length > 0 ? (
        <>
          <Text style={s.subhead} accessibilityRole="header">
            Open action items{stats.overdueActionItems > 0 ? ` · ${stats.overdueActionItems} overdue` : ''}
          </Text>
          {actions.map((a) => {
            const sub = [a.assignee?.name ?? 'Unassigned', a.dueDate ? `${a.overdue ? 'overdue, was due' : 'due'} ${formatDueDay(a.dueDate)}` : null, a.meetingTitle].filter(Boolean).join(' · ');
            const meetingId = a.meetingId;
            return (
              <MeetingLine key={a.id} s={s} onPress={meetingId ? () => onOpen(meetingId, a.meetingTitle) : undefined} label={`${a.description}, ${sub}`}>
                <Text style={s.flag} importantForAccessibility="no">☐</Text>
                <View style={s.lineText}>
                  <Text style={s.lineTitle} numberOfLines={3}>{a.description}</Text>
                  <Text style={[s.lineSub, a.overdue && s.overdue]}>{sub}</Text>
                </View>
              </MeetingLine>
            );
          })}
          {stats.openActionItems > actions.length ? <Text style={s.meta}>+ {stats.openActionItems - actions.length} more</Text> : null}
        </>
      ) : null}

      {decisions.length > 0 ? (
        <>
          <Text style={s.subhead} accessibilityRole="header">
            Recent decisions
          </Text>
          {decisions.map((d) => (
            <MeetingLine key={d.id} s={s} onPress={() => onOpen(d.meetingId, d.meetingTitle)} label={[d.text, d.meetingTitle].filter(Boolean).join(', ')}>
              <Text style={s.flag} importantForAccessibility="no">✔</Text>
              <View style={s.lineText}>
                <Text style={s.lineTitle}>{d.text}</Text>
                {d.meetingTitle ? <Text style={s.lineSub}>{d.meetingTitle}</Text> : null}
              </View>
            </MeetingLine>
          ))}
        </>
      ) : null}
    </View>
  );
}

function Stat({ label, value, s, danger }: { label: string; value: number; s: Styles; danger?: boolean }) {
  return (
    <View style={s.stat} accessible accessibilityLabel={`${label}: ${value}`}>
      <Text style={[s.statValue, danger && s.statDanger]}>{value}</Text>
      <Text style={s.statLabel}>{label}</Text>
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    list: { gap: spacing.sm },
    subhead: { fontSize: fontSize.sm, fontWeight: '800', color: c.ink2, marginTop: spacing.sm },
    line: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm, borderTopWidth: 1, borderTopColor: c.line, minHeight: 48 },
    pressed: { opacity: 0.7 },
    flag: { fontSize: fontSize.md, width: 22, textAlign: 'center', color: c.ink2 },
    lineText: { flex: 1 },
    lineTitle: { fontSize: fontSize.md, fontWeight: '600', color: c.ink },
    lineSub: { fontSize: fontSize.xs, color: c.ink2, marginTop: 2 },
    overdue: { color: c.danger, fontWeight: '700' },
    meta: { fontSize: fontSize.sm, color: c.ink2 },
    stats: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: spacing.sm },
    stat: { alignItems: 'center', flexGrow: 1, flexBasis: '22%', minWidth: 72 },
    statValue: { fontSize: fontSize.xl, fontWeight: '800', color: c.ink },
    statDanger: { color: c.danger },
    statLabel: { fontSize: fontSize.xs, color: c.ink3, marginTop: 2, textAlign: 'center' },
  });
