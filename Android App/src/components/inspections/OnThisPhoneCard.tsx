import { StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useColors } from '../../core/theme';
import { useKeptInspections } from '../../core/inspection-sync';
import { ON_PHONE_TEXT } from '../../lib/on-this-phone';
import { spacing } from '../../lib/theme';
import { typeStyle } from '../../lib/typography';
import type { AppStackParamList } from '../../navigation/types';
import { DashboardSection } from '../dashboard/DashboardSection';
import { Button } from '../ui';

/**
 * "On this phone" (device check B): each inspection the signed-in person has changes waiting
 * for, or keeps on this phone unfinished — its title, its task's key and what waits — with Open. Read
 * from the phone's own records, so it works with no signal, even after the app was restarted. On the
 * Dashboard (all of them) and at the top of a project's Inspections tab (`projectId`'s); nothing
 * shows when there is none.
 */
export function OnThisPhoneCard({ projectId }: { projectId?: string }) {
  const c = useColors();
  const navigation = useNavigation<NativeStackNavigationProp<AppStackParamList>>();
  const rows = useKeptInspections(projectId);
  if (!rows.length) return null;
  return (
    <DashboardSection title={ON_PHONE_TEXT.title}>
      <View>
        {rows.map((r) => (
          <View key={r.inspectionId} style={[s.row, { borderTopColor: c.line }]} accessible={false}>
            <View style={s.text} accessible accessibilityLabel={r.label}>
              <Text style={[typeStyle('bodyStrong'), { color: c.ink }]}>{r.title}</Text>
              <Text style={[typeStyle('caption'), { color: c.ink2 }]}>{[r.taskKey, r.line].filter(Boolean).join(' · ')}</Text>
            </View>
            <Button
              title={ON_PHONE_TEXT.open}
              variant="secondary"
              size="sm"
              accessibilityLabel={r.openLabel}
              onPress={() => navigation.navigate('Inspection', { inspectionId: r.inspectionId, title: r.title })}
            />
          </View>
        ))}
      </View>
    </DashboardSection>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth },
  text: { flex: 1, minWidth: 0, gap: 2 },
});
