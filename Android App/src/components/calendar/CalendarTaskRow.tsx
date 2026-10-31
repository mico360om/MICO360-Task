import React, { useMemo } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useColors } from '../../core/theme';
import { STATUS_LABEL, itemMeta, itemName, waits, type CalItem, type CalStatus } from '../../lib/calendar-model';
import { spacing, radius, fontSize, type Palette } from '../../lib/theme';
import { moveButton } from '../../lib/calendar-reschedule';
import { font } from '../../lib/typography';
import { Icon } from '../Icon';
import { capLines } from '../ui/text-lines';

// Each status's sign is the website's calendar icon (lib/icons `cal.<status>`, from its calendar's
// STATUS_META), with its words beside it — colour is never the only sign.

/** The status's words and sign in its text tone (the dots keep the fills: MonthGrid statusColor). */
function statusTextColor(c: Palette, s: CalStatus): string {
  switch (s) {
    case 'overdue':
      return c.dangerText;
    case 'blocked':
      return c.warningText;
    case 'in-progress':
      return c.infoText;
    case 'done':
      return c.successText;
    default:
      return c.ink2;
  }
}

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
  const tone = statusTextColor(c, item.status);
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
      <View style={s.icon} importantForAccessibility="no-hide-descendants">
        <Icon name={`cal.${item.status}`} size={18} color={tone} />
      </View>
      <View style={s.body}>
        <Text style={[s.title, item.status === 'done' && s.doneTitle, projected && s.projectedTitle]} numberOfLines={capLines(2)}>
          {item.task.title}
        </Text>
        <Text style={s.meta} numberOfLines={capLines(2)}>
          <Text style={[s.status, { color: tone }]}>{STATUS_LABEL[item.status]}</Text>
          {meta ? ` · ${meta}` : ''}
        </Text>
      </View>
      {/* Waiting for approval: the website's hourglass (its words are in the row's name; the icon itself is silent). */}
      {waits(item) ? <Icon name="misc.waiting" size={13} color={c.warningText} /> : null}
      {item.kind === 'task' && item.recurring ? (
        <View importantForAccessibility="no-hide-descendants">
          <Icon name="kit.repeat" size={16} color={c.ink2} />
        </View>
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
      borderRadius: radius.button,
      borderWidth: 1,
      borderColor: c.line,
      overflow: 'hidden',
    },
    projected: { borderStyle: 'dashed', borderColor: c.ink3, backgroundColor: c.ground },
    overdue: { borderColor: c.danger },
    pressed: { opacity: 0.7 },
    edge: { alignSelf: 'stretch', width: 4, marginVertical: -spacing.sm },
    icon: { width: 22, alignItems: 'center', justifyContent: 'center' },
    body: { flex: 1, gap: 2 },
    // An Arabic title reads right to left on its own line (Android picks the direction from the text).
    title: { fontSize: fontSize.md, ...font('600'), color: c.ink, textAlign: 'auto' },
    doneTitle: { color: c.ink2, textDecorationLine: 'line-through' },
    projectedTitle: { color: c.ink2 },
    meta: { fontSize: fontSize.xs, color: c.ink2 },
    status: { ...font('700') },
    move: { minHeight: 36, justifyContent: 'center', paddingHorizontal: spacing.md, borderRadius: radius.pill, borderWidth: 1, borderColor: c.brand },
    moveText: { fontSize: fontSize.sm, ...font('700'), color: c.brandText },
  });
