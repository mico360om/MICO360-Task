import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { spacing } from '../../lib/theme';
import { statTileColumns } from '../../lib/stat-grid';
import { TILE_FAILED, type DashboardLink, type DashboardTile } from '../../lib/dashboard';
import { ErrorNote, StatTile } from '../ui';

/** What tapping a tile does, for TalkBack. */
const opens = (to: DashboardLink): string => ('tab' in to ? (to.tab === 'MyTasks' ? 'Opens My Tasks' : 'Opens Projects') : 'Opens Reports');

/**
 * The Dashboard's four tiles, as the website's (two to a row on a phone): each a StatTile that opens
 * its page. Two to a row only while every label fits a half-width tile at this width and font size;
 * a large font gets one a row, so no label is cut. A figure not loaded yet shows "—" and says "loading";
 * one whose list couldn't load says so ("Couldn’t load"), with Retry under the tiles (fix pass B9).
 */
export function DashboardTiles({
  tiles,
  onOpen,
  onRetry,
  retrying,
}: {
  tiles: readonly DashboardTile[];
  onOpen: (to: DashboardLink) => void;
  /** Read the failed lists again. */
  onRetry: () => void;
  retrying: boolean;
}) {
  const { width, fontScale } = useWindowDimensions();
  const cols = statTileColumns(tiles.map((t) => t.label), width, fontScale);
  const tile = cols === 2 ? s.tile : s.tileFull;
  return (
    <View style={s.wrap}>
      <View style={s.tiles}>
        {tiles.map((t) => (
          <View key={t.key} style={tile}>
            <StatTile
              label={t.label}
              value={t.value}
              spokenValue={t.failed ? TILE_FAILED.spoken : t.value === '—' ? 'loading' : undefined}
              hint={t.hint}
              icon={t.icon}
              tone={t.tone}
              onPress={() => onOpen(t.to)}
              actionLabel={opens(t.to)}
            />
          </View>
        ))}
      </View>
      {tiles.some((t) => t.failed) ? <ErrorNote message={TILE_FAILED.note} onRetry={onRetry} retrying={retrying} /> : null}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { gap: spacing.sm },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  tile: { flexGrow: 1, flexBasis: '47%' },
  tileFull: { flexBasis: '100%' },
});
