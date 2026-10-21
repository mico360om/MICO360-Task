import React, { useMemo } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useColors } from '../../core/theme';
import { ProjectAvatar } from '../ProjectAvatar';
import { priorityColor } from '../TaskRow';
import { personInitials } from '../../lib/board';
import { STATUS_NAME } from '../../lib/all-board';
import { dueLabel, myTaskLabel, type MyTaskRow } from '../../lib/my-tasks';
import { categoryColorOf, spacing, radius, fontSize, type Palette } from '../../lib/theme';
import type { ColumnCategory } from '../../lib/types';

const PRIORITY_WORD = { LOW: 'Low', NORMAL: 'Normal', HIGH: 'High', URGENT: 'Urgent' } as const;

/**
 * One of my tasks (4d), as the website's My Tasks card: its box to select it, its project, priority,
 * key and status, the title (struck through when done), the due day (Overdue in company time, "Due
 * today"), the progress and up to three people. Tapping it opens the task; the box only selects.
 */
export const MyTaskItem = React.memo(function MyTaskItem({ row, selected, onOpen, onToggle }: { row: MyTaskRow; selected: boolean; onOpen: (row: MyTaskRow) => void; onToggle: (id: string) => void }) {
  const c = useColors();
  const s = useMemo(() => makeStyles(c), [c]);
  const t = row.task;
  const people = (t.assignees ?? []) as unknown as { id: string; name: string }[];
  const shownPeople = people.slice(0, 3);
  const due = dueLabel(row);
  return (
    <View style={[s.card, selected && s.cardOn, row.overdue && s.overdue]}>
      <Pressable
        onPress={() => onToggle(t.id)}
        accessibilityRole="checkbox"
        accessibilityLabel={`Select ${t.key}`}
        accessibilityState={{ checked: selected }}
        hitSlop={6}
        style={s.boxHit}
      >
        <View style={[s.box, selected && s.boxOn]}>{selected ? <Text style={s.tick}>✓</Text> : null}</View>
      </Pressable>
      <Pressable onPress={() => onOpen(row)} accessibilityRole="button" accessibilityLabel={myTaskLabel(row)} accessibilityHint="Opens the task" style={({ pressed }) => [s.main, pressed && s.pressed]}>
        <View style={s.top} importantForAccessibility="no-hide-descendants">
          {row.project ? (
            <View style={s.project}>
              <ProjectAvatar project={row.project} size="xs" />
              <Text style={s.projectName} numberOfLines={1}>
                {row.project.name}
              </Text>
            </View>
          ) : (
            <View style={s.project} />
          )}
          <View style={[s.priority, { borderColor: priorityColor(c, t.priority) }]}>
            <Text style={[s.priorityText, { color: priorityColor(c, t.priority) }]}>{PRIORITY_WORD[t.priority] ?? t.priority}</Text>
          </View>
        </View>
        <View style={s.meta} importantForAccessibility="no-hide-descendants">
          <Text style={s.key}>{t.key}</Text>
          <View style={s.status}>
            <View style={[s.dot, { backgroundColor: categoryColorOf(c, row.cat) }]} />
            <Text style={s.statusText}>{STATUS_NAME[row.cat as ColumnCategory] ?? row.cat}</Text>
          </View>
        </View>
        <Text style={[s.title, row.done && s.titleDone]} numberOfLines={2} importantForAccessibility="no">
          {t.title}
        </Text>
        <Text style={[s.due, row.overdue && s.dueLate, row.dueToday && !row.overdue && s.dueToday, !t.dueDate && s.noDue]} importantForAccessibility="no">
          📅 {due}
        </Text>
        <View style={s.bottom} importantForAccessibility="no-hide-descendants">
          <View style={s.track}>
            <View style={[s.fill, { width: `${Math.max(0, Math.min(100, t.progress))}%` }]} />
          </View>
          <Text style={s.pct}>{t.progress}%</Text>
          <View style={s.faces}>
            {shownPeople.map((p, i) => (
              <View key={p.id} style={[s.face, i > 0 && s.overlap]}>
                <Text style={s.initials} allowFontScaling={false}>
                  {personInitials(p.name)}
                </Text>
              </View>
            ))}
            {people.length > 3 ? (
              <View style={[s.face, s.overlap, s.more]}>
                <Text style={s.initials}>+{people.length - 3}</Text>
              </View>
            ) : null}
          </View>
        </View>
      </Pressable>
    </View>
  );
});

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    card: { flexDirection: 'row', backgroundColor: c.surface, borderRadius: radius.md, borderWidth: 1, borderColor: c.line, overflow: 'hidden' },
    cardOn: { borderColor: c.brand, backgroundColor: c.brandWash },
    overdue: { borderLeftWidth: 3, borderLeftColor: c.danger },
    boxHit: { width: 48, alignItems: 'center', paddingTop: spacing.md },
    box: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: c.ink3, alignItems: 'center', justifyContent: 'center' },
    boxOn: { borderColor: c.brand, backgroundColor: c.brand },
    tick: { color: c.onBrand, fontSize: 14, fontWeight: '900', lineHeight: 16 },
    main: { flex: 1, paddingVertical: spacing.md, paddingRight: spacing.md, gap: 6 },
    pressed: { opacity: 0.7 },
    top: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    project: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 0 },
    projectName: { flexShrink: 1, fontSize: fontSize.xs, fontWeight: '700', color: c.ink3, textTransform: 'uppercase', letterSpacing: 0.5 },
    priority: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 1 },
    priorityText: { fontSize: fontSize.xs, fontWeight: '700' },
    meta: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
    key: { fontSize: fontSize.xs, fontWeight: '700', color: c.ink2, backgroundColor: c.ground, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, overflow: 'hidden' },
    status: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: c.ground, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
    dot: { width: 7, height: 7, borderRadius: 4 },
    statusText: { fontSize: fontSize.xs, color: c.ink2, fontWeight: '600' },
    title: { fontSize: fontSize.md, fontWeight: '600', color: c.ink },
    titleDone: { textDecorationLine: 'line-through', color: c.ink3 },
    due: { fontSize: fontSize.xs, color: c.ink2 },
    dueLate: { color: c.danger, fontWeight: '700' },
    dueToday: { color: c.warning, fontWeight: '700' },
    noDue: { color: c.ink3 },
    bottom: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    track: { flex: 1, height: 6, borderRadius: radius.pill, backgroundColor: c.ground, overflow: 'hidden' },
    fill: { height: 6, borderRadius: radius.pill, backgroundColor: c.brand },
    pct: { fontSize: fontSize.xs, color: c.ink3, minWidth: 32, textAlign: 'right' },
    faces: { flexDirection: 'row', alignItems: 'center' },
    face: { width: 24, height: 24, borderRadius: 12, backgroundColor: c.brandWash, borderWidth: 1.5, borderColor: c.surface, alignItems: 'center', justifyContent: 'center' },
    overlap: { marginLeft: -6 },
    more: { backgroundColor: c.ground, borderColor: c.line },
    initials: { fontSize: 9, fontWeight: '700', color: c.brand },
  });
