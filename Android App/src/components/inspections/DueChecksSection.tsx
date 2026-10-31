import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useColors } from '../../core/theme';
import { useDueChecks, useStartInspection } from '../../core/inspection-queries';
import { companyTodayKey } from '../../lib/due-date';
import { newIdempotencyKey } from '../../lib/idempotency';
import { INSPECTIONS_TAB_WORDS as W, dueCheckGroups, dueCheckWhen, inspectorsText } from '../../lib/inspection-tab';
import type { DueCheck } from '../../lib/inspection-types';
import { problemText } from '../../lib/inspection-words';
import { radius, spacing } from '../../lib/theme';
import { font, typeStyle } from '../../lib/typography';
import type { AppStackParamList } from '../../navigation/types';
import { Icon } from '../Icon';
import { Button, Card, ErrorNote, SectionTitle, Skeleton } from '../ui';

/** One open check: its task, where, the form, when it is due, who inspects, and Start or Continue. */
function CheckRow({ c, today, canStart, onOpenTask, onStart, starting }: { c: DueCheck; today: string; canStart: boolean; onOpenTask?: (taskId: string) => void; onStart: (c: DueCheck) => void; starting: boolean }) {
  const col = useColors();
  const navigation = useNavigation<NativeStackNavigationProp<AppStackParamList>>();
  const late = c.state === 'LATE';
  const when = dueCheckWhen(c, today);
  const who = inspectorsText(c.assignees);
  return (
    <View style={[s.row, { borderColor: late ? col.danger : col.line, backgroundColor: col.surface }]}>
      <View style={s.main}>
        {onOpenTask ? (
          <Button title={c.title} variant="ghost" size="sm" onPress={() => onOpenTask(c.taskId)} style={s.title} accessibilityHint="Opens the task" />
        ) : (
          <Text style={[typeStyle('bodyStrong'), { color: col.ink }]}>{c.title}</Text>
        )}
        <View style={s.facts}>
          <Text style={[typeStyle('caption'), { color: col.ink2 }]}>{[c.key, c.place].filter(Boolean).join(' · ')}</Text>
          <Icon name="misc.inspection" size={13} color={col.ink3} />
          <Text style={[typeStyle('caption'), { color: col.ink2 }]}>{c.form.title}</Text>
        </View>
        <View style={s.facts}>
          {when.tone === 'danger' ? (
            <View style={[s.late, { backgroundColor: col.dangerSoft }]}>
              <Text style={[typeStyle('caption'), font('600'), { color: col.dangerText }]}>{when.text}</Text>
            </View>
          ) : (
            <Text style={[typeStyle('caption'), when.tone === 'strong' ? font('600') : null, { color: when.tone === 'strong' ? col.ink : col.ink2 }]}>{when.text}</Text>
          )}
          <Text style={[typeStyle('caption'), { color: c.assignees.length ? col.ink2 : col.ink3 }]} accessibilityLabel={who.label}>
            {who.text}
          </Text>
          {c.inProgress ? <Text style={[typeStyle('caption'), { color: col.infoText }]}>{W.doingIt.replace('{name}', c.inProgress.inspector.name)}</Text> : null}
        </View>
        {c.form.deleted ? <Text style={[typeStyle('caption'), { color: col.ink2 }]}>{W.formDeleted}</Text> : null}
      </View>
      <View style={s.action}>
        {c.inProgress ? (
          <Button
            title={W.continue}
            variant="secondary"
            size="sm"
            accessibilityLabel={W.continueLabel.replace('{title}', c.title)}
            onPress={() => navigation.navigate('Inspection', { inspectionId: c.inProgress!.inspectionId, title: c.title })}
          />
        ) : canStart ? (
          <Button title={W.startOne} size="sm" accessibilityLabel={W.startLabel.replace('{title}', c.title)} onPress={() => onStart(c)} loading={starting} />
        ) : null}
      </View>
    </View>
  );
}

/**
 * The project's open checks, as the website: late ones first ("2 days late" in the danger colour),
 * then due today, then upcoming. The list is kept on the phone, so it opens with no signal; a check
 * already started on this phone continues offline, a new Start needs a connection (decision 5).
 */
export function DueChecksSection({ projectId, canStart, onOpenTask }: { projectId: string; canStart: boolean; onOpenTask?: (taskId: string) => void }) {
  const c = useColors();
  const navigation = useNavigation<NativeStackNavigationProp<AppStackParamList>>();
  const today = companyTodayKey();
  const q = useDueChecks(projectId);
  const startM = useStartInspection(projectId);
  const [problem, setProblem] = useState<string | null>(null);
  const [startingId, setStartingId] = useState<string | null>(null);
  const checks = q.data?.checks ?? [];
  const groups = dueCheckGroups(checks, today);

  const start = (check: DueCheck) => {
    setProblem(null);
    setStartingId(check.taskId);
    startM.mutate(
      { formId: check.form.id, taskId: check.taskId, place: check.place, key: newIdempotencyKey() },
      {
        onSuccess: (started) => navigation.navigate('Inspection', { inspectionId: started.id, title: started.title }),
        onError: (e) => setProblem(problemText(e, W.startFailed)),
        onSettled: () => setStartingId(null),
      },
    );
  };

  return (
    <Card>
      <SectionTitle>{`${W.dueChecks}${q.data ? ` (${q.data.total})` : ''}`}</SectionTitle>
      {q.isLoading ? <Skeleton height={64} /> : null}
      {q.isError && !q.data ? <ErrorNote message={problemText(q.error, W.checksLoadFailed)} onRetry={() => void q.refetch()} retrying={q.isFetching} /> : null}
      {problem ? <ErrorNote message={problem} /> : null}
      {q.data && !checks.length ? <Text style={[typeStyle('body'), { color: c.ink2 }]}>{W.noChecks}</Text> : null}
      {(
        [
          [W.late, groups.late],
          [W.dueToday, groups.today],
          [W.upcoming, groups.upcoming],
        ] as const
      ).map(([label, group]) =>
        group.length ? (
          <View key={label} style={s.group}>
            <Text style={[typeStyle('caption'), font('600'), { color: c.ink2 }]} accessibilityRole="header">
              {label}
            </Text>
            {group.map((check) => (
              <CheckRow key={check.taskId} c={check} today={today} canStart={canStart} onOpenTask={onOpenTask} onStart={start} starting={startM.isPending && startingId === check.taskId} />
            ))}
          </View>
        ) : null,
      )}
      {q.data && q.data.total > checks.length ? (
        <Text style={[typeStyle('caption'), s.more, { color: c.ink2 }]}>{W.showingFirst.replace('{n}', String(checks.length)).replace('{total}', String(q.data.total))}</Text>
      ) : null}
    </Card>
  );
}

const s = StyleSheet.create({
  group: { gap: spacing.sm, marginTop: spacing.sm },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, borderWidth: 1, borderRadius: radius.button, padding: spacing.md },
  main: { flexGrow: 1, flexShrink: 1, flexBasis: 200, gap: 4 },
  title: { alignSelf: 'flex-start', paddingHorizontal: 0 },
  facts: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  late: { borderRadius: radius.badge, paddingHorizontal: 6, paddingVertical: 2 },
  action: { justifyContent: 'center' },
  more: { marginTop: spacing.sm },
});
