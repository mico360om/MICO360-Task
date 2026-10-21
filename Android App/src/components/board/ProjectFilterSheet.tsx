import React, { useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useColors } from '../../core/theme';
import { Sheet } from '../meeting/sheet-kit';
import { Button, TextField } from '../ui';
import { ProjectAvatar } from '../ProjectAvatar';
import { ALL_PROJECTS_TEXT, findProjects } from '../../lib/all-board';
import { spacing, radius, fontSize, type Palette } from '../../lib/theme';
import type { ApiProject } from '../../lib/types';

/**
 * Which projects the All projects board shows (4c), as the website's "Projects:" panel: Show all,
 * Show none, a search once there are more than eight, and a box per project. The board remembers
 * the projects left out, so a new project shows.
 */
export function ProjectFilterSheet({
  visible,
  projects,
  hidden,
  onChange,
  onClose,
}: {
  visible: boolean;
  projects: ApiProject[];
  hidden: ReadonlySet<string>;
  onChange: (hidden: Set<string>) => void;
  onClose: () => void;
}) {
  const c = useColors();
  const s = useMemo(() => makeStyles(c), [c]);
  const [q, setQ] = useState('');
  const listed = findProjects(projects, q);
  const toggle = (id: string) => {
    const next = new Set(hidden);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(next);
  };
  const close = () => {
    setQ('');
    onClose();
  };
  return (
    <Sheet visible={visible} title={ALL_PROJECTS_TEXT.filterTitle} onClose={close} footer={<Button title="Done" onPress={close} style={s.flex} />}>
      <View style={s.row}>
        <Button title={ALL_PROJECTS_TEXT.showAll} variant="ghost" onPress={() => onChange(new Set())} style={s.flex} />
        <Button title={ALL_PROJECTS_TEXT.showNone} variant="ghost" onPress={() => onChange(new Set(projects.map((p) => p.id)))} style={s.flex} />
      </View>
      {projects.length > 8 ? <TextField value={q} onChangeText={setQ} placeholder={ALL_PROJECTS_TEXT.find} accessibilityLabel={ALL_PROJECTS_TEXT.find} autoCapitalize="none" /> : null}
      {listed.map((p) => {
        const on = !hidden.has(p.id);
        return (
          <Pressable
            key={p.id}
            onPress={() => toggle(p.id)}
            accessibilityRole="checkbox"
            accessibilityLabel={p.name}
            accessibilityState={{ checked: on }}
            style={({ pressed }) => [s.option, pressed && s.pressed]}
          >
            <View style={[s.box, on && s.boxOn]}>{on ? <Text style={s.tick}>✓</Text> : null}</View>
            <ProjectAvatar project={p} size="xs" />
            <Text style={s.name} numberOfLines={1}>
              {p.name}
            </Text>
          </Pressable>
        );
      })}
      {listed.length === 0 ? <Text style={s.none}>{ALL_PROJECTS_TEXT.noMatch}</Text> : null}
    </Sheet>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    flex: { flex: 1 },
    row: { flexDirection: 'row', gap: spacing.sm },
    option: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 48, paddingHorizontal: spacing.sm, borderRadius: radius.md },
    pressed: { backgroundColor: c.ground },
    box: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: c.ink3, alignItems: 'center', justifyContent: 'center' },
    boxOn: { borderColor: c.brand, backgroundColor: c.brand },
    tick: { color: c.onBrand, fontSize: 14, fontWeight: '900', lineHeight: 16 },
    name: { flex: 1, fontSize: fontSize.md, color: c.ink, fontWeight: '600' },
    none: { fontSize: fontSize.sm, color: c.ink3, paddingVertical: spacing.sm },
  });
