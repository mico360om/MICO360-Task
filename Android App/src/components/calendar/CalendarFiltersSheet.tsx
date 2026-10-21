import React, { useMemo } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useColors } from '../../core/theme';
import { TextField } from '../ui';
import { Sheet, SheetButtons, CheckRow, InlinePicker, FieldLabel, type PickOption } from '../meeting/sheet-kit';
import { PRIORITIES, PRIORITY_LABEL, STATUS_FILTERS, STATUS_LABEL, activeFilterCount, DEFAULT_FILTERS, type CalendarFilters } from '../../lib/calendar-model';
import { spacing, radius, fontSize, type Palette } from '../../lib/theme';

/** Several of a few choices, as chips that each turn on and off. */
function ToggleChips<T extends string>({ label, options, values, onToggle }: { label: string; options: { value: T; label: string }[]; values: T[]; onToggle: (v: T) => void }) {
  const c = useColors();
  const s = useMemo(() => makeStyles(c), [c]);
  return (
    <View style={s.group}>
      <FieldLabel>{label}</FieldLabel>
      <View style={s.chips}>
        {options.map((o) => {
          const on = values.includes(o.value);
          return (
            <Pressable
              key={o.value}
              onPress={() => onToggle(o.value)}
              accessibilityRole="checkbox"
              accessibilityLabel={`${label}: ${o.label}`}
              accessibilityState={{ checked: on }}
              style={({ pressed }) => [s.chip, on && s.chipOn, pressed && s.pressed]}
            >
              <Text style={[s.chipText, on && s.chipTextOn]}>{o.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/**
 * The calendar's filters, as on the website: search, project, person and "My tasks"; status and
 * priority; and what to include (completed tasks, archived projects' tasks, repeats not created
 * yet, meetings). Each choice applies at once; "Clear filters" goes back to everyone's tasks.
 */
export function CalendarFiltersSheet({
  visible,
  filters,
  onChange,
  projectOptions,
  personOptions,
  timeNote,
  onClose,
}: {
  visible: boolean;
  filters: CalendarFilters;
  onChange: (next: CalendarFilters) => void;
  projectOptions: PickOption[];
  personOptions: PickOption[];
  /** Which time zone the days are in. */
  timeNote: string;
  onClose: () => void;
}) {
  if (!visible) return null;
  const set = (patch: Partial<CalendarFilters>) => onChange({ ...filters, ...patch });
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const count = activeFilterCount(filters);
  return (
    <Sheet
      visible
      title="Filter the calendar"
      subtitle={timeNote}
      onClose={onClose}
      closeLabel="Close filters"
      footer={<SheetButtons cancel={count ? `Clear filters (${count})` : 'Clear filters'} onCancel={() => onChange(DEFAULT_FILTERS)} confirm="Done" onConfirm={onClose} />}
    >
      <TextField label="Search tasks" value={filters.q} onChangeText={(q) => set({ q })} placeholder="Title or key" autoCapitalize="none" returnKeyType="search" />
      <InlinePicker label="Project" options={projectOptions} value={filters.projectId} onChange={(projectId) => set({ projectId })} placeholder="All projects" />
      <InlinePicker label="Person" options={personOptions} value={filters.assigneeId} onChange={(assigneeId) => set({ assigneeId })} placeholder="Everyone" />
      <CheckRow label="My tasks only" checked={filters.mine} onChange={(mine) => set({ mine })} />
      <ToggleChips label="Status" options={STATUS_FILTERS.map((v) => ({ value: v, label: STATUS_LABEL[v] }))} values={filters.statuses} onToggle={(v) => set({ statuses: toggle(filters.statuses, v) })} />
      <ToggleChips label="Priority" options={PRIORITIES.map((v) => ({ value: v, label: PRIORITY_LABEL[v] }))} values={filters.priorities} onToggle={(v) => set({ priorities: toggle(filters.priorities, v) })} />
      <FieldLabel>Include</FieldLabel>
      <CheckRow label="Show completed tasks" checked={filters.showCompleted} onChange={(showCompleted) => set({ showCompleted })} />
      <CheckRow label="Show tasks of archived projects" checked={filters.showArchived} onChange={(showArchived) => set({ showArchived })} />
      <CheckRow label="Show repeats not created yet" checked={filters.showProjected} onChange={(showProjected) => set({ showProjected })} />
      <CheckRow label="Show meetings" checked={filters.showMeetings} onChange={(showMeetings) => set({ showMeetings })} />
    </Sheet>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    group: { gap: spacing.xs, marginBottom: spacing.xs },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    chip: { minHeight: 40, justifyContent: 'center', borderWidth: 1, borderColor: c.line, borderRadius: radius.pill, paddingHorizontal: spacing.md, backgroundColor: c.surface },
    chipOn: { borderColor: c.brand, backgroundColor: c.brandWash },
    chipText: { fontSize: fontSize.sm, fontWeight: '600', color: c.ink },
    chipTextOn: { color: c.brand, fontWeight: '700' },
    pressed: { opacity: 0.7 },
  });
