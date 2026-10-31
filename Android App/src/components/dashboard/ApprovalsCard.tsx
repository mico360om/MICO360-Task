import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { approvalsCardView, DASHBOARD_TEXT } from '../../lib/dashboard';
import { appTimeZone } from '../../lib/due-date';
import { radius } from '../../lib/theme';
import { typeStyle } from '../../lib/typography';
import type { AppStackParamList } from '../../navigation/types';
import { useApprovals } from '../../core/approval-queries';
import { useColors } from '../../core/theme';
import { DashboardSection } from './DashboardSection';

/**
 * The Dashboard's "Waiting for your approval (N)" card, as the website's, for the people who can
 * approve (they run a project, or are an administrator): the longest waiting first, five at most,
 * each opening the task (whose screen has Approve and Send back); "Review all" opens My Tasks on its
 * To approve list. Nothing waiting: one line. Hidden for everyone else.
 */
export function ApprovalsCard({ onOpenTask }: { onOpenTask: (taskId: string, title: string) => void }) {
  const c = useColors();
  const navigation = useNavigation<NativeStackNavigationProp<AppStackParamList>>();
  const q = useApprovals();
  const view = approvalsCardView(q.data, Date.now(), appTimeZone());
  if (!view.visible) return null;
  const reviewAll = () => navigation.navigate('Tabs', { screen: 'MyTasks', params: { show: 'to-approve' } });
  return (
    <DashboardSection title={view.title} link={view.reviewAll ? { label: DASHBOARD_TEXT.reviewAll, onPress: reviewAll, a11y: 'Review all tasks waiting for your approval' } : null}>
      {view.empty ? (
        <Text style={[typeStyle('body'), s.empty, { color: c.ink2 }]}>{view.empty}</Text>
      ) : (
        <View>
          {view.rows.map((r) => (
            <Pressable
              key={r.id}
              onPress={() => onOpenTask(r.id, r.title)}
              accessibilityRole="button"
              accessibilityLabel={`${r.key} ${r.title}, ${r.line}`}
              style={({ pressed }) => [s.row, pressed ? { backgroundColor: c.ground } : null]}
            >
              <View style={s.top}>
                <Text style={[s.key, { color: c.ink2, backgroundColor: c.ground }]}>{r.key}</Text>
                <Text style={[typeStyle('body'), s.title, { color: c.ink }]} numberOfLines={1}>
                  {r.title}
                </Text>
              </View>
              <Text style={[typeStyle('caption'), { color: c.ink2 }]} numberOfLines={1}>
                {r.line}
              </Text>
            </Pressable>
          ))}
        </View>
      )}
      {view.more ? <Text style={[typeStyle('caption'), s.more, { color: c.ink2 }]}>{view.more}</Text> : null}
    </DashboardSection>
  );
}

const s = StyleSheet.create({
  empty: { textAlign: 'center', paddingVertical: 8 },
  row: { minHeight: 44, justifyContent: 'center', gap: 2, paddingHorizontal: 8, paddingVertical: 8, borderRadius: radius.input },
  top: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  // font-mono text-[11px] on the ground, as the website's task keys.
  key: { fontFamily: 'monospace', fontSize: 11, lineHeight: 16, paddingHorizontal: 6, paddingVertical: 1, borderRadius: radius.badge, overflow: 'hidden' },
  title: { flex: 1, minWidth: 0 },
  more: { marginTop: 8 },
});
