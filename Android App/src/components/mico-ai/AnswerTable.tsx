import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useColors } from '../../core/theme';
import { cellDisplay } from '../../lib/mico-ai';
import type { CellKind, MicoAiTable } from '../../lib/mico-ai-api';
import { answerColumnWidth } from '../../lib/mico-ai-layout';
import { radius, spacing, type Palette } from '../../lib/theme';
import { font, typeStyle } from '../../lib/typography';
import { Button } from '../ui';

/** Figures line up on the right, as on the website. */
const NUMERIC = new Set<CellKind | undefined>(['number', 'percent', 'days']);
/** The rows shown at first; the rest behind "Show all N rows". */
const FIRST_ROWS = 25;

/**
 * A table copied by the server from the data (its figures are the data's, never the AI's), as the
 * website's AnswerTable: its title, a box that scrolls sideways when it is wider than the phone,
 * the first 25 rows, and its Excel download once the answer is written ("Preparing Excel…" while
 * it is made; `busy`: another download of the answer is on its way).
 */
export function AnswerTable({ table, onExcel, preparing = false, busy = false }: { table: MicoAiTable; onExcel?: () => void; preparing?: boolean; busy?: boolean }) {
  const c = useColors();
  const s = useMemo(() => makeStyles(c), [c]);
  const [all, setAll] = useState(false);
  const rows = all ? table.rows : table.rows.slice(0, FIRST_ROWS);
  // Wider with a larger font, so big text wraps in its column instead of being cut off.
  const { fontScale } = useWindowDimensions();
  const widths = useMemo(() => table.columns.map((_, j) => answerColumnWidth(table, j, fontScale)), [table, fontScale]);
  return (
    <View style={s.wrap}>
      <View style={s.box}>
        <Text style={s.caption} accessibilityRole="header">
          {table.title}
        </Text>
        <ScrollView horizontal accessibilityLabel={table.title} showsHorizontalScrollIndicator>
          <View>
            <View style={[s.row, s.head]}>
              {table.columns.map((col, j) => (
                <Text key={col.key} style={[s.headText, { width: widths[j] }, NUMERIC.has(col.kind) ? s.end : null]}>
                  {col.label}
                </Text>
              ))}
            </View>
            {rows.map((r, i) => (
              <View key={i} style={[s.row, i > 0 ? s.rowLine : null, i % 2 === 1 ? s.even : null]}>
                {r.cells.map((v, j) => {
                  const kind = table.columns[j]?.kind;
                  const text = cellDisplay(kind, v);
                  return (
                    <View key={j} style={[s.cell, { width: widths[j] }]}>
                      {kind === 'key' && text ? (
                        <Text style={s.key}>{text}</Text>
                      ) : (
                        <Text style={[s.cellText, NUMERIC.has(kind) ? s.number : null, kind === 'days' && text ? s.days : null]}>{text}</Text>
                      )}
                    </View>
                  );
                })}
              </View>
            ))}
          </View>
        </ScrollView>
      </View>
      <View style={s.footer}>
        {onExcel ? (
          <Button
            title={preparing ? 'Preparing Excel…' : 'Excel'}
            icon="ui.download"
            variant="secondary"
            size="sm"
            onPress={onExcel}
            disabled={busy}
            accessibilityLabel={`Download ${table.title} as Excel`}
            accessibilityHint={preparing ? 'Preparing Excel…' : undefined}
          />
        ) : null}
        {table.total !== undefined && table.total > table.rows.length ? <Text style={s.note}>{`Showing ${table.rows.length} of ${table.total}`}</Text> : null}
        {table.rows.length > FIRST_ROWS ? (
          <Pressable onPress={() => setAll((v) => !v)} accessibilityRole="button" hitSlop={8} style={s.more}>
            <Text style={s.moreText}>{all ? 'Show fewer rows' : `Show all ${table.rows.length} rows`}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    wrap: { gap: 6 },
    box: { borderWidth: 1, borderColor: c.line, borderRadius: radius.button, backgroundColor: c.surface, overflow: 'hidden' },
    caption: { ...typeStyle('caption'), ...font('600'), color: c.ink2, backgroundColor: c.ground, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: c.line },
    row: { flexDirection: 'row' },
    head: { backgroundColor: c.ground, borderBottomWidth: 1, borderBottomColor: c.line },
    headText: { ...typeStyle('caption'), ...font('600'), color: c.ink2, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
    rowLine: { borderTopWidth: 1, borderTopColor: c.line },
    even: { backgroundColor: c.surface2 },
    cell: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
    cellText: { ...typeStyle('body'), color: c.ink },
    end: { textAlign: 'right' },
    number: { ...typeStyle('number'), color: c.ink, textAlign: 'right' },
    days: { ...font('600'), color: c.dangerText },
    key: { ...typeStyle('caption'), fontFamily: 'monospace', color: c.ink2, backgroundColor: c.ground, borderRadius: radius.badge, paddingHorizontal: 6, paddingVertical: 2, alignSelf: 'flex-start' },
    footer: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.md },
    note: { ...typeStyle('caption'), color: c.ink3 },
    more: { minHeight: 32, justifyContent: 'center' },
    moreText: { ...typeStyle('caption'), ...font('600'), color: c.brandText },
  });
