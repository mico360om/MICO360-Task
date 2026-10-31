import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { TimelineProject } from '../../lib/planning-api';
import { barColor, type HealthLook } from '../../lib/planning-look';
import { timelineRow } from '../../lib/timeline';
import { toneStyle } from '../../lib/tone';
import { radius, spacing, type Palette } from '../../lib/theme';
import { font, typeStyle } from '../../lib/typography';
import { useColors } from '../../core/theme';
import type { AppStackParamList } from '../../navigation/types';
import { Card, ProgressBar } from '../ui';
import { Icon } from '../Icon';
import { ProjectAvatar } from '../ProjectAvatar';
import { TimelineTasks } from './TimelineTasks';

/** On track (tick), At risk (warning sign), Late (clock), No target: words and an icon, never colour alone (the website's HealthPill). */
export function HealthPill({ look }: { look: HealthLook }) {
  const c = useColors();
  const t = toneStyle(c, look.tone);
  return (
    <View style={[pill.box, { backgroundColor: t.bg }]}>
      {look.icon ? <Icon name={look.icon} size={12} color={t.fg} /> : null}
      <Text style={[pill.text, { color: t.fg }]} numberOfLines={1}>
        {look.label}
      </Text>
    </View>
  );
}

const pill = StyleSheet.create({
  box: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2, flexShrink: 0 },
  text: { ...font('700'), fontSize: 11, lineHeight: 16 },
});

/**
 * One project on the Timeline's phone list (the website's PhoneList row): its picture, name and
 * health, the server's progress, the next milestone and the target — the row opens the project —
 * and "Tasks" to show its tasks under it.
 */
export function TimelineRow({
  project,
  today,
  range,
  open,
  onToggle,
}: {
  project: TimelineProject;
  today: string;
  range: { from: string; to: string };
  open: boolean;
  onToggle: () => void;
}) {
  const c = useColors();
  const s = useMemo(() => makeStyles(c), [c]);
  const navigation = useNavigation<NativeStackNavigationProp<AppStackParamList>>();
  const row = timelineRow(project, today);
  const milestone = row.milestone.next ? `Next milestone ${row.milestone.text}` : row.milestone.text;
  return (
    <Card padded={false} style={s.card}>
      <Pressable
        onPress={() => navigation.navigate('ProjectDetail', { projectId: project.id, projectName: project.name })}
        accessibilityRole="button"
        accessibilityLabel={`${project.name}, ${row.health.label}, ${row.progress}% done, ${milestone}, ${row.target}`}
        accessibilityHint="Opens the project"
        style={({ pressed }) => [s.main, pressed && s.pressed]}
      >
        <View style={s.head}>
          <ProjectAvatar project={project} size="md" />
          <Text style={s.name} numberOfLines={1}>
            {project.name}
          </Text>
          <HealthPill look={row.health} />
        </View>
        <View style={s.progress}>
          <View style={s.bar}>
            <ProgressBar value={row.progress} color={barColor(c, project.health)} label={row.progressLabel} />
          </View>
          <Text style={s.pct}>{row.progress}%</Text>
        </View>
        <View style={s.line}>
          {row.milestone.next ? (
            <>
              <Icon name="misc.milestone" size={13} color={c.ink2} />
              <Text style={s.small}>Next</Text>
            </>
          ) : null}
          <Text style={[s.small, s.flex]} numberOfLines={1}>
            {row.milestone.text}
          </Text>
        </View>
        <Text style={[s.small, row.targetLate && s.late]}>{row.target}</Text>
      </Pressable>
      <Pressable
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityLabel={`Tasks of ${project.name}`}
        accessibilityState={{ expanded: open }}
        accessibilityHint={open ? 'Hides its tasks' : 'Shows its tasks'}
        hitSlop={{ top: 6, bottom: 6 }}
        style={({ pressed }) => [s.tasksButton, pressed && s.pressed]}
      >
        <Icon name="ui.chevron" size={16} color={c.ink2} rotate={open ? 0 : 270} />
        <Text style={s.tasksText}>Tasks</Text>
      </Pressable>
      {open ? <TimelineTasks projectId={project.id} projectName={project.name} range={range} /> : null}
    </Card>
  );
}

function makeStyles(c: Palette) {
  return StyleSheet.create({
    card: { overflow: 'hidden' },
    main: { padding: 14, paddingBottom: spacing.sm, gap: 6 },
    pressed: { backgroundColor: c.surface2 },
    head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    name: { ...typeStyle('bodyStrong'), ...font('700'), flex: 1, color: c.ink },
    progress: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: 4 },
    bar: { flex: 1 },
    pct: { ...typeStyle('caption'), ...font('700'), fontVariant: ['tabular-nums'], color: c.ink },
    line: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    flex: { flex: 1 },
    small: { ...typeStyle('caption'), color: c.ink2 },
    late: { ...font('600'), color: c.dangerText },
    tasksButton: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 4, minHeight: 36, paddingHorizontal: spacing.sm, marginLeft: 6, marginBottom: 6, borderRadius: radius.input },
    tasksText: { ...typeStyle('caption'), ...font('700'), color: c.ink2 },
  });
}
