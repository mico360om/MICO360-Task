import React, { useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { useServices } from '../../core/providers';
import { useColors } from '../../core/theme';
import { useInspectionSchedules } from '../../core/inspection-queries';
import { appTimeZone } from '../../lib/due-date';
import { SCHEDULE_WORDS as W, STALE_SCHEDULE, isStaleSchedule, scheduleLines } from '../../lib/inspection-schedule-form';
import { inspectorsText } from '../../lib/inspection-tab';
import type { InspectionSchedule } from '../../lib/inspection-types';
import { problemText } from '../../lib/inspection-words';
import { radius, spacing } from '../../lib/theme';
import { font, typeStyle } from '../../lib/typography';
import { Icon } from '../Icon';
import { Button, Card, ErrorNote, SectionTitle, Skeleton } from '../ui';
import { ScheduleSheet } from './ScheduleSheet';

/** One schedule: its name, form, place and inspectors; its repeat, next and last check, how many late; Edit and Stop. */
function ScheduleRow({ s, timeZone, canChange, onEdit, onStop, stopping }: { s: InspectionSchedule; timeZone: string; canChange: boolean; onEdit: () => void; onStop: () => void; stopping: boolean }) {
  const c = useColors();
  const lines = scheduleLines(s, timeZone);
  const who = inspectorsText(s.assignees);
  return (
    <View style={[st.row, { borderColor: c.line, backgroundColor: c.surface }]}>
      <View style={st.main}>
        <Text style={[typeStyle('bodyStrong'), { color: c.ink }]}>{s.title}</Text>
        <View style={st.facts}>
          <Icon name="misc.inspection" size={13} color={c.ink3} />
          <Text style={[typeStyle('caption'), { color: c.ink2 }]}>{s.form.title}</Text>
          {s.place ? <Text style={[typeStyle('caption'), { color: c.ink2 }]}>{`· ${s.place}`}</Text> : null}
          <Text style={[typeStyle('caption'), { color: c.ink2 }]} accessibilityLabel={who.label}>{`· ${who.text}`}</Text>
        </View>
        <View style={st.facts}>
          <View style={[st.pill, { backgroundColor: c.brandWash }]}>
            <Text style={[typeStyle('caption'), font('500'), { color: c.brandText }]}>{lines.repeat}</Text>
          </View>
          {lines.next ? <Text style={[typeStyle('caption'), { color: c.ink2 }]}>{lines.next}</Text> : null}
          <Text style={[typeStyle('caption'), { color: c.ink2 }]}>{lines.last}</Text>
          {lines.late ? (
            <View style={[st.late, { backgroundColor: c.dangerSoft }]}>
              <Text style={[typeStyle('caption'), font('600'), { color: c.dangerText }]}>{lines.late}</Text>
            </View>
          ) : null}
        </View>
      </View>
      {canChange ? (
        <View style={st.actions}>
          <Button title={W.edit} variant="secondary" size="sm" onPress={onEdit} accessibilityLabel={W.editLabel.replace('{title}', s.title)} />
          <Button title={W.stop} variant="ghost" size="sm" onPress={onStop} loading={stopping} accessibilityLabel={W.stopLabel.replace('{title}', s.title)} />
        </View>
      ) : null}
    </View>
  );
}

/**
 * The project's schedules (repeating checks), as the website's section: anyone who can start an
 * inspection may schedule one, change it or stop it. Online only, as on the website; a list that is
 * out of date (the repeat moved on, someone changed it) is refused and read again.
 */
export function SchedulesSection({ projectId, canChange }: { projectId: string; canChange: boolean }) {
  const c = useColors();
  const qc = useQueryClient();
  const { resources } = useServices();
  const timeZone = appTimeZone();
  const q = useInspectionSchedules(projectId);
  const [editing, setEditing] = useState<{ schedule: InspectionSchedule | null } | null>(null);
  const [notice, setNotice] = useState<{ text: string; danger?: boolean } | null>(null);
  const [stoppingId, setStoppingId] = useState<string | null>(null);
  const list = q.data?.schedules ?? [];
  const workingDays = q.data?.workingDays ?? [0, 1, 2, 3, 4];

  const stop = async (s: InspectionSchedule) => {
    setStoppingId(s.taskId);
    try {
      // Only on the series' newest copy, as the list showed it.
      await resources.inspections.updateCheckSeries(s.taskId, { recurrenceRule: null, expectedVersion: s.version, requireNewest: true });
      setNotice({ text: W.stopped.replace('{title}', s.title) });
      void qc.invalidateQueries({ queryKey: ['tasks'] });
      void qc.invalidateQueries({ queryKey: ['project-inspections', projectId] });
    } catch (e) {
      if (isStaleSchedule(e)) {
        setNotice({ text: STALE_SCHEDULE });
        void qc.invalidateQueries({ queryKey: ['project-inspections', projectId] });
      } else setNotice({ text: problemText(e, W.stopFailed), danger: true });
    } finally {
      setStoppingId(null);
    }
  };
  const askStop = (s: InspectionSchedule) =>
    Alert.alert(W.stopTitle, W.stopBody.replace('{title}', s.title), [
      { text: 'Keep it', style: 'cancel' },
      { text: W.stopConfirm, style: 'destructive', onPress: () => void stop(s) },
    ]);

  return (
    <Card>
      <View style={st.head}>
        <SectionTitle>{`${W.schedules}${q.data ? ` (${list.length})` : ''}`}</SectionTitle>
        {canChange ? (
          <Button
            title={W.add}
            variant="secondary"
            size="sm"
            onPress={() => {
              setNotice(null);
              setEditing({ schedule: null });
            }}
          />
        ) : null}
      </View>
      {notice ? (
        <Text style={[typeStyle('body'), st.notice, { color: notice.danger ? c.dangerText : c.ink2 }]} accessibilityLiveRegion="polite">
          {notice.text}
        </Text>
      ) : null}
      {q.isLoading ? <Skeleton height={64} /> : null}
      {q.isError && !q.data ? <ErrorNote message={problemText(q.error, W.loadFailed)} onRetry={() => void q.refetch()} retrying={q.isFetching} /> : null}
      {q.data && !list.length ? <Text style={[typeStyle('body'), { color: c.ink2 }]}>{`${W.none}${canChange ? ` ${W.noneCanChange}` : ''}`}</Text> : null}
      {list.length ? (
        <View style={st.rows}>
          {list.map((s) => (
            <ScheduleRow
              key={s.taskId}
              s={s}
              timeZone={timeZone}
              canChange={canChange}
              stopping={stoppingId === s.taskId}
              onEdit={() => {
                setNotice(null);
                setEditing({ schedule: s });
              }}
              onStop={() => askStop(s)}
            />
          ))}
        </View>
      ) : null}
      {editing ? (
        <ScheduleSheet
          projectId={projectId}
          workingDays={workingDays}
          schedule={editing.schedule}
          onClose={() => setEditing(null)}
          onSaved={() => setNotice({ text: editing.schedule ? W.saved : W.scheduled })}
          onStale={() => setNotice({ text: STALE_SCHEDULE })}
        />
      ) : null}
    </Card>
  );
}

const st = StyleSheet.create({
  head: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  notice: { marginBottom: spacing.sm },
  rows: { gap: spacing.sm },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, borderWidth: 1, borderRadius: radius.button, padding: spacing.md },
  main: { flexGrow: 1, flexShrink: 1, flexBasis: 200, gap: 4 },
  facts: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  pill: { borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2 },
  late: { borderRadius: radius.badge, paddingHorizontal: 6, paddingVertical: 2 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
});
