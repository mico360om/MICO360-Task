import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '../core/theme';
import { useAlertsCount } from '../core/alerts';
import { alertsBadge, bellLabel } from '../lib/alerts';
import { useDrawerStore } from '../lib/drawer-store';
import { navigationRef } from '../navigation/ref';
import { BrandLogo, IconButton } from './ui';

/**
 * The top bar of every tab, as the website's: white (the surface), the menu and the MICO360 logo
 * on the left, Search and the bell with the unread count on the right. Each page's title is in its
 * own content (PageHeader).
 */
export function AppTopBar() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const count = useAlertsCount();
  const go = (screen: 'Search' | 'Notifications') => {
    if (!navigationRef.isReady()) return;
    if (screen === 'Search') navigationRef.navigate('Search');
    else navigationRef.navigate('Notifications');
  };
  return (
    <View style={[styles.bar, { paddingTop: insets.top, height: insets.top + 56, backgroundColor: c.surface, borderBottomColor: c.line }]}>
      <View style={styles.side}>
        <IconButton icon="misc.menu" label="Open menu" variant="outlined" onPress={() => useDrawerStore.getState().openDrawer()} />
        <BrandLogo height={28} />
      </View>
      <View style={styles.side}>
        <IconButton icon="ui.search" label="Search" hint="Finds tasks, projects, people, meetings and pages" variant="outlined" onPress={() => go('Search')} />
        <IconButton icon="nav.notifications" label={bellLabel(count)} badge={alertsBadge(count)} variant="outlined" onPress={() => go('Notifications')} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, borderBottomWidth: 1 },
  side: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
