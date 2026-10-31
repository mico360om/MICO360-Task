import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useColors } from '../../core/theme';
import { Card, Chip, TextField } from '../ui';
import { Icon } from '../Icon';
import { ProjectAvatar } from '../ProjectAvatar';
import { CheckRow, InlinePicker, Sheet, SheetButtons } from '../meeting/sheet-kit';
import { DEFAULT_FILTERS, PERIODS, PROJECT_STATUSES, STATUS_LABEL, chooseProjects, isDefaultFilters, toggleStatus } from '../../lib/management';
import type { ManagementFilters as Filters, OptionProject } from '../../lib/management-api';
import { radius, spacing, type Palette } from '../../lib/theme';
import { font, typeStyle } from '../../lib/typography';

/** "Projects: All", "Projects: Rig Inspection Portal", "Projects: 2 chosen" (the website's picker button). */
function pickerLabel(projects: OptionProject[], chosen: string[]): string {
  if (chosen.length === 0) return 'Projects: All';
  if (chosen.length === 1) return `Projects: ${projects.find((p) => p.id === chosen[0])?.name ?? '1 chosen'}`;
  return `Projects: ${chosen.length} chosen`;
}

/**
 * Management's filters (the website's ManagementFilters.tsx): which projects (tick boxes in a
 * sheet, found by name when there are more than 8), the owner, the period (4, 12 or 26 weeks) and
 * the project statuses (the ones still going unless chosen), with Clear filters once any is set.
 */
export function ManagementFilters({ filters, projects, owners, onChange }: { filters: Filters; projects: OptionProject[]; owners: { id: string; name: string }[]; onChange: (f: Filters) => void }) {
  const c = useColors();
  const s = useMemo(() => makeStyles(c), [c]);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const chosen = filters.projectIds;
  const found = q.trim() ? projects.filter((p) => `${p.name} ${p.code}`.toLowerCase().includes(q.trim().toLowerCase())) : projects;
  const choose = (ids: string[]) => onChange(chooseProjects(filters, ids, projects));
  const toggle = (id: string) => choose(chosen.includes(id) ? chosen.filter((x) => x !== id) : [...chosen, id]);
  const close = () => {
    setOpen(false);
    setQ('');
  };

  return (
    <Card style={s.card}>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={pickerLabel(projects, chosen)}
        accessibilityHint="Opens the projects to show"
        style={({ pressed }) => [s.picker, chosen.length > 0 && s.pickerOn, pressed && s.pressed]}
      >
        <Icon name="kit.folder" size={16} color={chosen.length ? c.brandText : c.ink2} />
        <Text style={[s.pickerText, chosen.length > 0 && s.pickerTextOn]} numberOfLines={1}>
          {pickerLabel(projects, chosen)}
        </Text>
      </Pressable>

      <InlinePicker
        label="Owner"
        options={[{ value: '', label: 'Owner: Anyone' }, ...owners.map((o) => ({ value: o.id, label: o.name }))]}
        value={filters.ownerId ?? ''}
        onChange={(v) => onChange({ ...filters, ownerId: v || null })}
        placeholder="Owner: Anyone"
      />

      <View style={s.row} accessibilityRole="radiogroup" accessibilityLabel="Period">
        {PERIODS.map((w) => (
          <Chip key={w} label={`${w} weeks`} selected={filters.weeks === w} onPress={() => onChange({ ...filters, weeks: w })} />
        ))}
      </View>

      <Text style={s.legend} importantForAccessibility="no">
        Status
      </Text>
      <View style={s.row} accessibilityLabel="Status">
        {PROJECT_STATUSES.map((st) => (
          <Chip key={st} label={STATUS_LABEL[st]} selected={filters.statuses.includes(st)} onPress={() => onChange(toggleStatus(filters, st))} />
        ))}
      </View>

      {!isDefaultFilters(filters) ? (
        <Pressable onPress={() => onChange({ ...DEFAULT_FILTERS, statuses: [...DEFAULT_FILTERS.statuses] })} accessibilityRole="button" style={({ pressed }) => [s.clear, pressed && s.pressed]}>
          <Text style={s.clearText}>Clear filters</Text>
        </Pressable>
      ) : null}

      <Sheet visible={open} title="Projects to show" subtitle={chosen.length ? `${chosen.length} chosen` : 'All projects'} onClose={close} footer={<SheetButtons cancel="Done" onCancel={close} />}>
        <Pressable onPress={() => choose([])} disabled={chosen.length === 0} accessibilityRole="button" accessibilityState={{ disabled: chosen.length === 0 }} style={({ pressed }) => [s.clear, chosen.length === 0 && s.dim, pressed && s.pressed]}>
          <Text style={s.clearText}>Show all</Text>
        </Pressable>
        {projects.length > 8 ? <TextField value={q} onChangeText={setQ} placeholder="Find a project" accessibilityLabel="Find a project" autoCapitalize="none" /> : null}
        {found.map((p) => (
          <View key={p.id} style={s.projectRow}>
            <ProjectAvatar project={p} size="xs" />
            <View style={s.flex}>
              <CheckRow label={p.name} checked={chosen.includes(p.id)} onChange={() => toggle(p.id)} />
            </View>
            <Text style={s.status}>{STATUS_LABEL[p.status]}</Text>
          </View>
        ))}
        {found.length === 0 ? <Text style={s.none}>No project matches.</Text> : null}
      </Sheet>
    </Card>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    card: { gap: spacing.md, marginBottom: spacing.lg },
    flex: { flex: 1, minWidth: 0 },
    row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    picker: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 44, paddingHorizontal: spacing.md, borderWidth: 1, borderColor: c.line, borderRadius: radius.input, alignSelf: 'flex-start', maxWidth: '100%' },
    pickerOn: { borderColor: c.brand },
    pickerText: { ...typeStyle('label'), color: c.ink, flexShrink: 1 },
    pickerTextOn: { color: c.brandText },
    legend: { ...typeStyle('eyebrow'), color: c.ink3 },
    clear: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
    clearText: { ...typeStyle('button'), color: c.brandText },
    dim: { opacity: 0.5 },
    pressed: { opacity: 0.7 },
    projectRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    status: { ...typeStyle('caption'), color: c.ink3 },
    none: { ...typeStyle('caption'), ...font('400'), color: c.ink3, paddingVertical: spacing.sm },
  });
