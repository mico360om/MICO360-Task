import { Pressable, StyleSheet, Text, View } from 'react-native';
import { DASHBOARD_TEXT, type DueSoonRow } from '../../lib/dashboard';
import { radius } from '../../lib/theme';
import { typeStyle } from '../../lib/typography';
import type { ApiTask } from '../../lib/types';
import { useColors } from '../../core/theme';
import { Icon } from '../Icon';
import { ApprovalChip, ErrorNote } from '../ui';
import { DashboardSection, RowsSkeleton } from './DashboardSection';

/**
 * "Due soon", as the website's: open work with a due day, the earliest first (overdue at the top),
 * six at most — the title on the first line, the key and how far off it is ("3d overdue" in red,
 * "Due tomorrow") on the second. Past its day but waiting for approval, a task shows the Waiting for
 * approval chip instead of "overdue". "Calendar" opens the calendar.
 */
export function DueSoonCard({
  rows,
  loading,
  failed,
  retrying,
  onRetry,
  onCalendar,
  onOpenTask,
}: {
  rows: readonly DueSoonRow[];
  loading: boolean;
  /** The list failed and nothing is kept on the phone: never "all clear" during an outage. */
  failed: boolean;
  retrying: boolean;
  onRetry: () => void;
  onCalendar: () => void;
  onOpenTask: (task: ApiTask) => void;
}) {
  const c = useColors();
  return (
    <DashboardSection title={DASHBOARD_TEXT.dueSoon} link={{ label: DASHBOARD_TEXT.calendar, onPress: onCalendar, a11y: 'Open the calendar' }}>
      {loading ? (
        <RowsSkeleton label="Loading due tasks" rows={6} height={52} />
      ) : failed ? (
        <ErrorNote message="Couldn’t load due tasks." onRetry={onRetry} retrying={retrying} />
      ) : rows.length === 0 ? (
        <View style={s.clear}>
          <Icon name="kit.checkCircle" size={16} color={c.successText} />
          <Text style={[typeStyle('body'), { color: c.ink2 }]}>{DASHBOARD_TEXT.allClear}</Text>
        </View>
      ) : (
        <View>
          {rows.map(({ task, meta, waiting }) => (
            <Pressable
              key={task.id}
              onPress={() => onOpenTask(task)}
              accessibilityRole="button"
              accessibilityLabel={`${task.title}, ${task.key}, ${waiting ? 'Waiting for approval' : meta.label}`}
              style={({ pressed }) => [s.row, pressed ? { backgroundColor: c.ground } : null]}
            >
              <Text style={[typeStyle('body'), { color: c.ink }]} numberOfLines={1}>
                {task.title}
              </Text>
              <View style={s.meta}>
                <Text style={[s.key, { color: c.ink2, backgroundColor: c.ground }]}>{task.key}</Text>
                {waiting ? <ApprovalChip /> : <Text style={[typeStyle('caption'), { color: meta.overdue ? c.dangerText : c.ink2 }]}>{meta.label}</Text>}
              </View>
            </Pressable>
          ))}
        </View>
      )}
    </DashboardSection>
  );
}

const s = StyleSheet.create({
  clear: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12 },
  row: { minHeight: 44, gap: 4, paddingHorizontal: 8, paddingVertical: 8, borderRadius: radius.input },
  meta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  key: { fontFamily: 'monospace', fontSize: 11, lineHeight: 16, paddingHorizontal: 6, paddingVertical: 1, borderRadius: radius.badge, overflow: 'hidden' },
});
