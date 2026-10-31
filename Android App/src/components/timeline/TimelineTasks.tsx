import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { TimelineTask } from '../../lib/planning-api';
import { phoneTaskParts, tasksFooter } from '../../lib/timeline';
import { companyTodayKey } from '../../lib/due-date';
import { spacing, type Palette } from '../../lib/theme';
import { font, typeStyle } from '../../lib/typography';
import { useColors } from '../../core/theme';
import { useTimelineTasks } from '../../core/planning-queries';
import type { AppStackParamList } from '../../navigation/types';
import { Avatar } from '../ui';
import { Icon } from '../Icon';

/** Who has a task: up to two faces and "+N"; TalkBack hears the names with the row. */
function People({ people }: { people: TimelineTask['assignees'] }) {
  const c = useColors();
  if (people.length === 0) return null;
  return (
    <View style={styles.people} importantForAccessibility="no-hide-descendants">
      {people.slice(0, 2).map((p) => (
        <Avatar key={p.id} name={p.name} size="sm" />
      ))}
      {people.length > 2 ? (
        <View style={[styles.more, { backgroundColor: c.ground }]}>
          <Text style={[styles.moreText, { color: c.ink2 }]} allowFontScaling={false}>
            +{people.length - 2}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const STATE_WORDS = { done: ', done', waiting: ', waiting for approval', overdue: ', overdue' } as const;

/**
 * A project's tasks on a phone (the website's PhoneTaskList): each with its due day, done, waiting
 * for approval or overdue as the server says, and who has it; a row opens the task. Read when the
 * project's row is opened, and again as the weeks change.
 */
export function TimelineTasks({ projectId, projectName, range }: { projectId: string; projectName: string; range: { from: string; to: string } }) {
  const c = useColors();
  const s = useMemo(() => makeStyles(c), [c]);
  const navigation = useNavigation<NativeStackNavigationProp<AppStackParamList>>();
  const today = companyTodayKey();
  const q = useTimelineTasks(projectId, range, true);

  if (q.isLoading) {
    return (
      <View style={s.list} accessibilityLabel={`Tasks of ${projectName}`}>
        <Text style={s.note}>Loading tasks…</Text>
      </View>
    );
  }
  if (q.isError || !q.data) {
    return (
      <View style={[s.list, s.noteRow]}>
        <Text style={s.note}>Couldn’t load these tasks.</Text>
        <Pressable onPress={() => void q.refetch()} accessibilityRole="button" hitSlop={8} style={s.link}>
          <Text style={s.linkText}>Try again</Text>
        </Pressable>
      </View>
    );
  }
  const data = q.data;
  const footer = tasksFooter(data);
  const openProject = () => navigation.navigate('ProjectDetail', { projectId, projectName });
  return (
    <View style={s.list}>
      {data.tasks.map((task) => {
        const parts = phoneTaskParts(task, today);
        const names = task.assignees.map((a) => a.name).join(', ');
        const label = `${task.key} ${task.title}, ${parts.due}${parts.state ? STATE_WORDS[parts.state] : ''}${names ? `, assigned to ${names}` : ''}`;
        return (
          <Pressable
            key={task.id}
            onPress={() => navigation.navigate('TaskDetail', { taskId: task.id, title: task.title })}
            accessibilityRole="button"
            accessibilityLabel={label}
            accessibilityHint="Opens the task"
            style={({ pressed }) => [s.row, pressed && s.pressed]}
          >
            <View style={s.flex}>
              <Text style={[s.title, { color: task.done ? c.ink3 : c.ink }]} numberOfLines={1}>
                <Text style={s.key}>{task.key}</Text> {task.title}
              </Text>
              <View style={s.whenRow}>
                <Text style={[s.when, parts.state === 'overdue' && s.overdue]}>{parts.due}</Text>
                {parts.state === 'done' ? (
                  <>
                    <Text style={s.when}> · </Text>
                    <Icon name="misc.check" size={12} color={c.successText} />
                    <Text style={s.when}> done</Text>
                  </>
                ) : parts.state === 'waiting' ? (
                  <Text style={s.when}> · waiting for approval</Text>
                ) : parts.state === 'overdue' ? (
                  <Text style={[s.when, s.overdue]}> · overdue</Text>
                ) : null}
              </View>
            </View>
            <People people={task.assignees} />
          </Pressable>
        );
      })}
      {footer.none || footer.shown || footer.undated ? (
        <View style={s.noteRow}>
          {footer.none ? <Text style={s.note}>No tasks in these weeks.</Text> : null}
          {footer.shown ? <Text style={s.note}>{footer.shown}</Text> : null}
          {footer.allOpen ? (
            <Pressable onPress={openProject} accessibilityRole="button" accessibilityHint="Opens the project" hitSlop={8} style={s.link}>
              <Text style={s.linkText}>{footer.allOpen}</Text>
            </Pressable>
          ) : null}
          {footer.undated ? <Text style={s.note}>{footer.undated}</Text> : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  people: { flexDirection: 'row', gap: 2, flexShrink: 0 },
  more: { minWidth: 24, height: 24, borderRadius: 12, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center' },
  moreText: { ...font('700'), fontSize: 10, lineHeight: 12 },
});

function makeStyles(c: Palette) {
  return StyleSheet.create({
    list: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.line2 },
    row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: 14, paddingVertical: spacing.sm, minHeight: 48, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.line2 },
    pressed: { backgroundColor: c.surface2 },
    flex: { flex: 1, minWidth: 0 },
    title: { ...typeStyle('label') },
    key: { ...typeStyle('caption'), fontFamily: 'monospace', color: c.ink2 },
    whenRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
    when: { ...typeStyle('caption'), color: c.ink2 },
    overdue: { ...font('600'), color: c.dangerText },
    noteRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: spacing.md, rowGap: 2, paddingHorizontal: 14, paddingVertical: spacing.sm },
    note: { ...typeStyle('caption'), color: c.ink2 },
    link: { minHeight: 32, justifyContent: 'center' },
    linkText: { ...typeStyle('caption'), ...font('600'), color: c.brandText },
  });
}
