import React, { useMemo } from 'react';
import { Modal, View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '../../core/theme';
import { Button } from '../ui';
import { Chip } from '../task-detail/kit';
import { spacing, radius, fontSize, type Palette } from '../../lib/theme';
import { MEETING_STATUS_LABELS } from '../../lib/meeting-detail';
import { DATE_RANGES, SORTS, STATUS_CHOICES, type MeetingFilters, type MeetingSort } from '../../lib/meeting-list';

/**
 * "Filters" for the Meetings list, as on the website: project (or standalone only), date, status
 * and sort, in a sheet from the bottom. Each choice applies at once; Reset clears them all.
 */
export function MeetingFiltersSheet({
  visible,
  filters,
  sort,
  projects,
  onChange,
  onReset,
  onClose,
}: {
  visible: boolean;
  filters: MeetingFilters;
  sort: MeetingSort;
  projects: Array<{ id: string; name: string }>;
  onChange: (changes: Partial<MeetingFilters> & { sort?: MeetingSort }) => void;
  onReset: () => void;
  onClose: () => void;
}) {
  const c = useColors();
  const s = useMemo(() => makeStyles(c), [c]);
  const insets = useSafeAreaInsets();
  const group = (label: string, children: React.ReactNode) => (
    <View style={s.group} accessibilityRole="radiogroup" accessibilityLabel={label}>
      <Text style={s.groupLabel}>{label}</Text>
      <View style={s.chips}>{children}</View>
    </View>
  );
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={s.backdrop} onPress={onClose} accessibilityLabel="Close filters" accessibilityRole="button" />
      <View style={[s.sheet, { paddingBottom: spacing.lg + insets.bottom }]} accessibilityViewIsModal>
        <Text style={s.title} accessibilityRole="header">
          Filter meetings
        </Text>
        <ScrollView style={s.scroll} contentContainerStyle={{ gap: spacing.md }}>
          {group(
            'Project',
            <>
              <Chip label="All projects" selected={filters.projectId === ''} onPress={() => onChange({ projectId: '' })} />
              <Chip label="Standalone only" selected={filters.projectId === 'none'} onPress={() => onChange({ projectId: 'none' })} />
              {projects.map((p) => (
                <Chip key={p.id} label={p.name} selected={filters.projectId === p.id} onPress={() => onChange({ projectId: p.id })} />
              ))}
            </>,
          )}
          {group(
            'Date',
            DATE_RANGES.map((r) => <Chip key={r.value} label={r.label} selected={filters.range === r.value} onPress={() => onChange({ range: r.value })} />),
          )}
          {group(
            'Status',
            <>
              <Chip label="All statuses" selected={filters.status === 'ALL'} onPress={() => onChange({ status: 'ALL' })} />
              {STATUS_CHOICES.map((st) => (
                <Chip key={st} label={MEETING_STATUS_LABELS[st]} selected={filters.status === st} onPress={() => onChange({ status: st })} />
              ))}
            </>,
          )}
          {group(
            'Sort by',
            SORTS.map((o) => <Chip key={o.value} label={o.label} selected={sort === o.value} onPress={() => onChange({ sort: o.value })} />),
          )}
        </ScrollView>
        <View style={s.actions}>
          <Button title="Reset" variant="ghost" onPress={onReset} style={s.action} accessibilityLabel="Reset the filters" />
          <Button title="Done" onPress={onClose} style={s.action} />
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
    sheet: { backgroundColor: c.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg, gap: spacing.sm, maxHeight: '85%' },
    title: { fontSize: fontSize.lg, fontWeight: '800', color: c.ink },
    scroll: { flexGrow: 0 },
    group: { gap: spacing.xs },
    groupLabel: { fontSize: fontSize.xs, fontWeight: '800', color: c.ink2, textTransform: 'uppercase', letterSpacing: 0.8 },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
    action: { flex: 1 },
  });
