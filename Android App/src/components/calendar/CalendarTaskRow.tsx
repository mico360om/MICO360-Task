import React, { useMemo } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useColors } from '../../core/theme';
import { STATUS_LABEL, itemMeta, itemName, type CalItem, type CalStatus } from '../../lib/calendar-model';
import { spacing, radius, fontSize, type Palette } from '../../lib/theme';
import { statusColor } from './MonthGrid';
import { moveButton } from '../../lib/calendar-reschedule';

/** Each status's sign (with its words beside it — colour is never the only sign). */
const STATUS_ICON: Record<CalStatus, string> = {
  overdue: '!',
  blocked: '⊘',
  'in-progress': '◐',
  todo: '○',
  done: '✓',
  projected: '↻',
};

/**
 * A task on the calendar: its status (sign and words), up to two lines of its title, its key (or
 * "Not created yet"), project and people, the project's colour on its edge, and a dashed outline
 * for a repeat not created yet. Tap opens it; its Move button, a long press or TalkBack's action
 * moves it (5a review: the button makes moving findable without a long-press).
 */
export function CalendarTaskRow({
  item,
  projectName,
  projectColor,
  onPress,
  onLongPress,
  movable,
}: {
  item: CalItem;
  projectName?: string;
  projectColor?: string | null;
  onPress: () => void;
  onLongPress: () => void;
  movable: boolean;
}) {
  const c = useColors();
  const s = useMemo(() => makeStyles(c), [c]);
  const projected = item.kind === 'projected';
  const meta = itemMeta(item, projectName);
  const tone = statusColor(c, item.status);
  const move = movable ? moveButton(item) : null;
  const actionLabel = move ? move.a11y : 'Why it can’t be moved';
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={350}
      accessibilityRole="button"
      accessibilityLabel={`${itemName(item)}. ${meta}`}
      accessibilityHint={projected ? 'Explains this copy, and opens the current one' : move ? 'Opens the task. Move it to another day from the actions' : 'Opens the task'}
      accessibilityActions={[{ name: 'longpress', label: actionLabel }]}
      onAccessibilityAction={(e) => {
        if (e.nativeEvent.actionName === 'longpress') onLongPress();
      }}
      style={({ pressed }) => [s.row, projected && s.projected, item.status === 'overdue' && s.overdue, pressed && s.pressed]}
    >
      <View style={[s.edge, { backgroundColor: projectColor || c.line }]} />
      <Text style={[s.icon, { color: tone }]} importantForAccessibility="no" maxFontSizeMultiplier={1.4}>
        {STATUS_ICON[item.status]}
      </Text>
      <View style={s.body}>
        <Text style={[s.title, item.status === 'done' && s.doneTitle, projected && s.projectedTitle]} numberOfLines={2}>
          {item.task.title}
        </Text>
        <Text style={s.meta} numberOfLines={2}>
          <Text style={[s.status, { color: item.status === 'todo' ? c.ink2 : tone }]}>{STATUS_LABEL[item.status]}</Text>
          {meta ? ` · ${meta}` : ''}
        </Text>
      </View>
      {item.kind === 'task' && item.recurring ? (
        <Text style={s.repeat} importantForAccessibility="no">
          🔁
        </Text>
      ) : null}
      {move ? (
        // TalkBack reaches it as the row's action (named the same); the button is for sight.
        <Pressable onPress={onLongPress} hitSlop={6} accessibilityLabel={move.a11y} style={({ pressed }) => [s.move, pressed && s.pressed]}>
          <Text style={s.moveText}>{move.label}</Text>
        </Pressable>
      ) : null}
    </Pressable>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      minHeight: 56,
      paddingVertical: spacing.sm,
      paddingRight: spacing.md,
      backgroundColor: c.surface,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: c.line,
      overflow: 'hidden',
    },
    projected: { borderStyle: 'dashed', borderColor: c.ink3, backgroundColor: c.ground },
    overdue: { borderColor: c.danger },
    pressed: { opacity: 0.7 },
    edge: { alignSelf: 'stretch', width: 4, marginVertical: -spacing.sm },
    icon: { width: 22, textAlign: 'center', fontSize: fontSize.md, fontWeight: '800' },
    body: { flex: 1, gap: 2 },
    // An Arabic title reads right to left on its own line (Android picks the direction from the text).
    title: { fontSize: fontSize.md, fontWeight: '600', color: c.ink, textAlign: 'auto' },
    doneTitle: { color: c.ink2, textDecorationLine: 'line-through' },
    projectedTitle: { color: c.ink2 },
    meta: { fontSize: fontSize.xs, color: c.ink2 },
    status: { fontWeight: '700' },
    repeat: { fontSize: fontSize.sm, color: c.ink2 },
    move: { minHeight: 36, justifyContent: 'center', paddingHorizontal: spacing.md, borderRadius: radius.pill, borderWidth: 1, borderColor: c.brand },
    moveText: { fontSize: fontSize.sm, fontWeight: '700', color: c.brand },
  });
