import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { WorkloadCell, WorkloadPerson, WorkloadTask } from '../../lib/planning-api';
import { popoverSub, popoverTasks, popoverTitle, suggestionLabel, suggestionText } from '../../lib/workload';
import { radius, spacing, type Palette } from '../../lib/theme';
import { typeStyle } from '../../lib/typography';
import { useColors } from '../../core/theme';
import type { AppStackParamList } from '../../navigation/types';
import { Sheet } from '../meeting/sheet-kit';
import { Button } from '../ui';

/**
 * One person's day on Workload (the website's WorkloadPopover, as a sheet): how it stands against
 * the limit, the tasks to move with the server's suggestion each (a teammate with room, or a
 * lighter day) when it is over, and the way to the rest. Nothing changes until a suggestion is
 * tapped; while one is saved the others wait. `notice` says what the last tap did.
 */
export function DaySheet({
  person,
  cell,
  week,
  onClose,
  onApply,
  busyTaskId,
  notice,
}: {
  person: WorkloadPerson;
  cell: WorkloadCell;
  week: string;
  onClose: () => void;
  onApply: (task: WorkloadTask) => void;
  /** The task whose suggestion is being applied. */
  busyTaskId: string | null;
  notice?: { ok: boolean; text: string } | null;
}) {
  const c = useColors();
  const s = useMemo(() => makeStyles(c), [c]);
  const navigation = useNavigation<NativeStackNavigationProp<AppStackParamList>>();
  const { shown, more } = popoverTasks(cell);
  const openTask = (task: WorkloadTask) => {
    onClose();
    navigation.navigate('TaskDetail', { taskId: task.id, title: task.title });
  };
  const openRest = () => {
    onClose();
    if (person.me) navigation.navigate('Tabs', { screen: 'MyTasks' });
    else navigation.navigate('Calendar');
  };
  return (
    <Sheet
      visible
      title={popoverTitle(person.name, cell.date)}
      subtitle={popoverSub(cell)}
      onClose={onClose}
      footer={
        <View style={s.footer}>
          <Text style={s.more}>{more > 0 ? `+ ${more} more` : ''}</Text>
          <Button title={person.me ? 'Open in My Tasks' : 'Open in Calendar'} variant="secondary" size="sm" onPress={openRest} />
        </View>
      }
    >
      {shown.length ? (
        shown.map((task) => (
          <View key={task.id} style={s.row}>
            <View style={s.keyBox}>
              <Text style={s.key}>{task.key}</Text>
            </View>
            <Pressable onPress={() => openTask(task)} accessibilityRole="button" accessibilityLabel={`${task.key} ${task.title}`} accessibilityHint="Opens the task" style={s.titleBox}>
              <Text style={s.title} numberOfLines={2}>
                {task.title}
              </Text>
            </Pressable>
            {task.suggestion ? (
              <Button
                title={busyTaskId === task.id ? 'Saving…' : suggestionText(task.suggestion, week)}
                accessibilityLabel={suggestionLabel(task.suggestion, task.key)}
                variant="secondary"
                size="sm"
                onPress={() => (busyTaskId === null ? onApply(task) : undefined)}
              />
            ) : cell.over > 0 ? (
              <Text style={s.noRoom}>No room nearby</Text>
            ) : null}
          </View>
        ))
      ) : (
        <Text style={s.nothing}>Nothing due.</Text>
      )}
      <Text style={[s.notice, notice ? (notice.ok ? s.ok : s.problem) : null]} accessibilityLiveRegion="polite">
        {notice?.text ?? ''}
      </Text>
    </Sheet>
  );
}

function makeStyles(c: Palette) {
  return StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.line2 },
    keyBox: { borderRadius: radius.badge, backgroundColor: c.ground, paddingHorizontal: 6, paddingVertical: 2 },
    key: { ...typeStyle('caption'), fontFamily: 'monospace', color: c.ink2 },
    titleBox: { flex: 1, minHeight: 44, justifyContent: 'center' },
    title: { ...typeStyle('label'), color: c.ink },
    noRoom: { ...typeStyle('caption'), color: c.ink3 },
    nothing: { ...typeStyle('body'), color: c.ink2, paddingVertical: spacing.sm },
    notice: { ...typeStyle('label'), marginTop: spacing.sm },
    ok: { color: c.successText },
    problem: { color: c.dangerText },
    footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
    more: { ...typeStyle('caption'), color: c.ink2 },
  });
}
