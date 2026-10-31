import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { spacing } from '../../lib/theme';
import { statTileColumns } from '../../lib/stat-grid';
import type { DashboardLink, DashboardTile } from '../../lib/dashboard';
import { StatTile } from '../ui';

/** What tapping a tile does, for TalkBack. */
const opens = (to: DashboardLink): string => ('tab' in to ? (to.tab === 'MyTasks' ? 'Opens My Tasks' : 'Opens Projects') : 'Opens Reports');

/**
 * The Dashboard's four tiles, as the website's (two to a row on a phone): each a StatTile that opens
 * its page. Two to a row only while every label fits a half-width tile at this width and font size;
 * a large font gets one a row, so no label is cut. A figure not loaded yet shows "—" and says "loading".
 */
export function DashboardTiles({ tiles, onOpen }: { tiles: readonly DashboardTile[]; onOpen: (to: DashboardLink) => void }) {
  const { width, fontScale } = useWindowDimensions();
  const cols = statTileColumns(tiles.map((t) => t.label), width, fontScale);
  const tile = cols === 2 ? s.tile : s.tileFull;
  return (
    <View style={s.tiles}>
      {tiles.map((t) => (
        <View key={t.key} style={tile}>
          <StatTile
            label={t.label}
            value={t.value}
            spokenValue={t.value === '—' ? 'loading' : undefined}
            hint={t.hint}
            icon={t.icon}
            tone={t.tone}
            onPress={() => onOpen(t.to)}
            actionLabel={opens(t.to)}
          />
        </View>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  tile: { flexGrow: 1, flexBasis: '47%' },
  tileFull: { flexBasis: '100%' },
});
