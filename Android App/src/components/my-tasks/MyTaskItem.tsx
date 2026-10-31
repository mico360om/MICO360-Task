import React, { useMemo } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useColors } from '../../core/theme';
import { ProjectAvatar } from '../ProjectAvatar';
import { Icon } from '../Icon';
import { ApprovalChip, Avatar, InspectionChip, PriorityBadge, ProgressBar } from '../ui';
import { STATUS_NAME } from '../../lib/all-board';
import { dueLabel, myTaskLabel, selectTaskLabel, type MyTaskRow } from '../../lib/my-tasks';
import { externalContactsLine } from '../../lib/external-contacts';
import { categoryColorOf, spacing, radius, fontSize, type Palette } from '../../lib/theme';
import type { ColumnCategory } from '../../lib/types';
import { font } from '../../lib/typography';
import { capLines } from '../ui/text-lines';

/**
 * One of my tasks (4d), as the website's My Tasks card: its box to select it, its project, priority,
 * key and status, the title (struck through when done), the due day (Overdue in company time, "Due
 * today"), the approval chip while it waits, the progress and up to three people. Tapping it opens the task; the box only selects.
 */
export const MyTaskItem = React.memo(function MyTaskItem({ row, selected, onOpen, onToggle }: { row: MyTaskRow; selected: boolean; onOpen: (row: MyTaskRow) => void; onToggle: (id: string) => void }) {
  const c = useColors();
  const s = useMemo(() => makeStyles(c), [c]);
  const t = row.task;
  const people = (t.assignees ?? []) as unknown as { id: string; name: string }[];
  const shownPeople = people.slice(0, 3);
  const due = dueLabel(row);
  const external = externalContactsLine(t.externalSummary);
  return (
    <View style={[s.card, selected && s.cardOn, row.overdue && s.overdue]}>
      <Pressable
        onPress={() => onToggle(t.id)}
        accessibilityRole="checkbox"
        accessibilityLabel={selectTaskLabel(row)}
        accessibilityState={{ checked: selected }}
        hitSlop={6}
        style={s.boxHit}
      >
        <View style={[s.box, selected && s.boxOn]}>{selected ? <Icon name="misc.check" size={14} color={c.onBrand} /> : null}</View>
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
          <PriorityBadge priority={t.priority} />
        </View>
        <View style={s.meta} importantForAccessibility="no-hide-descendants">
          <Text style={s.key}>{t.key}</Text>
          <View style={s.status}>
            <View style={[s.dot, { backgroundColor: categoryColorOf(c, row.cat) }]} />
            <Text style={s.statusText}>{STATUS_NAME[row.cat as ColumnCategory] ?? row.cat}</Text>
          </View>
          {/* A check (a task carried out with an inspection form — Stage 4), as the website's My Tasks row. */}
          {row.inspection ? <InspectionChip /> : null}
        </View>
        <Text style={[s.title, row.done && s.titleDone]} numberOfLines={capLines(2)} importantForAccessibility="no">
          {t.title}
        </Text>
        {row.waiting ? (
          <View importantForAccessibility="no-hide-descendants">
            <ApprovalChip />
          </View>
        ) : null}
        {external ? (
          <Text style={s.external} numberOfLines={capLines(1)} importantForAccessibility="no">
            {external}
          </Text>
        ) : null}
        <View style={s.dueRow} importantForAccessibility="no-hide-descendants">
          <Icon name="kit.calendar" size={12} color={row.overdue ? c.dangerText : row.dueToday ? c.warningText : t.dueDate ? c.ink2 : c.ink3} />
          <Text style={[s.due, row.overdue && s.dueLate, row.dueToday && !row.overdue && s.dueToday, !t.dueDate && s.noDue]}>{due}</Text>
        </View>
        <View style={s.bottom} importantForAccessibility="no-hide-descendants">
          <View style={s.track}>
            <ProgressBar value={t.progress} label="Progress" />
          </View>
          <Text style={s.pct}>{t.progress}%</Text>
          <View style={s.faces}>
            {shownPeople.map((p, i) => (
              <View key={p.id} style={i > 0 ? s.overlap : null}>
                <Avatar name={p.name} size="sm" />
              </View>
            ))}
            {people.length > 3 ? (
              <View style={[s.face, s.overlap, s.more]}>
                <Text style={s.moreText} allowFontScaling={false}>+{people.length - 3}</Text>
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
    card: { flexDirection: 'row', backgroundColor: c.surface, borderRadius: radius.button, borderWidth: 1, borderColor: c.line, overflow: 'hidden' },
    cardOn: { borderColor: c.brand, backgroundColor: c.brandWash },
    overdue: { borderLeftWidth: 3, borderLeftColor: c.danger },
    boxHit: { width: 48, alignItems: 'center', paddingTop: spacing.md },
    box: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: c.ink3, alignItems: 'center', justifyContent: 'center' },
    boxOn: { borderColor: c.brand, backgroundColor: c.brand },
    main: { flex: 1, paddingVertical: spacing.md, paddingRight: spacing.md, gap: 6 },
    pressed: { opacity: 0.7 },
    top: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    project: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 0 },
    projectName: { flexShrink: 1, fontSize: fontSize.xs, ...font('700'), color: c.ink3, textTransform: 'uppercase', letterSpacing: 0.5 },
    meta: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
    key: { fontSize: fontSize.xs, ...font('700'), color: c.ink2, backgroundColor: c.ground, paddingHorizontal: 6, paddingVertical: 2, borderRadius: radius.badge, overflow: 'hidden' },
    status: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: c.ground, borderRadius: radius.badge, paddingHorizontal: 6, paddingVertical: 2 },
    dot: { width: 7, height: 7, borderRadius: 4 },
    statusText: { fontSize: fontSize.xs, color: c.ink2, ...font('600') },
    title: { fontSize: fontSize.md, ...font('600'), color: c.ink },
    titleDone: { textDecorationLine: 'line-through', color: c.ink3 },
    external: { fontSize: fontSize.xs, ...font('600'), color: c.ink2 },
    dueRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    due: { fontSize: fontSize.xs, color: c.ink2 },
    dueLate: { color: c.dangerText, ...font('700') },
    dueToday: { color: c.warningText, ...font('700') },
    noDue: { color: c.ink3 },
    bottom: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    track: { flex: 1 },
    pct: { fontSize: fontSize.xs, color: c.ink3, minWidth: 32, textAlign: 'right' },
    faces: { flexDirection: 'row', alignItems: 'center' },
    face: { width: 24, height: 24, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
    overlap: { marginLeft: -6 },
    more: { backgroundColor: c.ground, borderColor: c.line },
    moreText: { fontSize: 9, ...font('700'), color: c.ink2 },
  });
