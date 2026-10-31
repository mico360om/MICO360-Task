import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useColors } from '../../core/theme';
import { useManagementItems } from '../../core/management-queries';
import { Button, ErrorNote, Skeleton } from '../ui';
import { Sheet } from '../meeting/sheet-kit';
import { applyNavAction } from '../../navigation/apply-action';
import { finishedText, itemTarget, itemsFooter, itemsStatus, plural, shortDay } from '../../lib/management';
import type { ItemQuery, ItemRow, ManagementFilters } from '../../lib/management-api';
import { radius, spacing, type Palette } from '../../lib/theme';
import { font, typeStyle } from '../../lib/typography';

/** A row's detail in its tone's TEXT colour (never a fill as text). */
const toneText = (c: Palette, tone: ItemRow['tone']) =>
  tone === 'danger' ? c.dangerText : tone === 'warning' ? c.warningText : tone === 'success' ? c.successText : c.ink2;

/** What a row says: its key and title, then the project, how late or when due, when finished, who, and its detail. */
function RowBody({ row, timeZone, s, c }: { row: ItemRow; timeZone: string; s: ReturnType<typeof makeStyles>; c: Palette }) {
  const due = row.daysLate ? `${plural(row.daysLate, 'day')} late` : row.due ? `Due ${shortDay(row.due)}` : null;
  return (
    <>
      <View style={s.head}>
        {row.key ? <Text style={s.key}>{row.key}</Text> : null}
        <Text style={s.title} numberOfLines={2}>
          {row.title}
        </Text>
      </View>
      <View style={s.meta}>
        {row.project ? (
          <Text style={s.metaText} numberOfLines={1}>
            {row.project.name}
          </Text>
        ) : null}
        {due ? <Text style={[s.metaText, row.daysLate ? s.late : null]}>{due}</Text> : null}
        {row.at ? <Text style={s.metaText}>{finishedText(row.at, timeZone)}</Text> : null}
        {row.people?.length ? (
          <Text style={s.metaText} numberOfLines={1}>
            {row.people.join(', ')}
          </Text>
        ) : null}
      </View>
      {row.detail ? <Text style={[s.detail, { color: toneText(c, row.tone) }]}>{row.detail}</Text> : null}
    </>
  );
}

/**
 * The list behind a number (the website's ItemsSheet.tsx), with the same filters, so a number N
 * opens N rows (the first ones the server sends). A row opens the app's screen for it (itemTarget);
 * an overloaded day lists its tasks in place, each opening the task. Closes before it opens anything.
 */
export function ItemsSheet({
  filters,
  query,
  label,
  timeZone,
  onClose,
}: {
  filters: ManagementFilters;
  query: ItemQuery;
  label: string;
  /** The company's time zone (the overview's), for when an inspection finished. */
  timeZone: string;
  onClose: () => void;
}) {
  const c = useColors();
  const s = useMemo(() => makeStyles(c), [c]);
  const q = useManagementItems(filters, query);
  const list = q.data;
  const [expanded, setExpanded] = useState<string | null>(null);
  const footer = itemsFooter(list);

  const open = (row: ItemRow) => {
    const target = itemTarget(row);
    if (target === 'expand') return setExpanded((cur) => (cur === row.id ? null : row.id));
    if (!target) return;
    onClose();
    applyNavAction(target);
  };
  const openTask = (id: string, title: string) => {
    const target = itemTarget({ kind: 'task', id, title });
    if (!target || target === 'expand') return;
    onClose();
    applyNavAction(target);
  };

  return (
    <Sheet visible title={list?.title ?? label} subtitle={itemsStatus(list, q.isLoading)} onClose={onClose} footer={<Button title="Close" variant="secondary" onPress={onClose} style={s.close} />}>
      {q.isLoading ? (
        <View accessible accessibilityLabel="Loading" accessibilityState={{ busy: true }} style={s.loading}>
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} height={48} radius={radius.input} />
          ))}
        </View>
      ) : q.isError ? (
        <ErrorNote message="Couldn’t load this list." onRetry={() => void q.refetch()} retrying={q.isRefetching} />
      ) : list && list.rows.length ? (
        list.rows.map((row) => {
          const target = itemTarget(row);
          const day = target === 'expand';
          const isOpen = day && expanded === row.id;
          return (
            <View key={`${row.kind}-${row.id}-${row.detail ?? ''}`} style={s.item}>
              {target ? (
                <Pressable
                  onPress={() => open(row)}
                  accessibilityRole="button"
                  accessibilityState={day ? { expanded: isOpen } : undefined}
                  accessibilityHint={day ? (isOpen ? 'Hides its tasks' : 'Shows its tasks') : undefined}
                  style={({ pressed }) => [s.row, pressed && s.pressed]}
                >
                  <RowBody row={row} timeZone={timeZone} s={s} c={c} />
                </Pressable>
              ) : (
                <View style={s.row} accessible>
                  <RowBody row={row} timeZone={timeZone} s={s} c={c} />
                </View>
              )}
              {isOpen && row.tasks?.length ? (
                <View style={s.dayTasks} accessibilityLabel={`Tasks due ${row.title}`}>
                  {row.tasks.map((t) => (
                    <Pressable key={t.id} onPress={() => openTask(t.id, t.title)} accessibilityRole="button" accessibilityLabel={`${t.key} ${t.title}`} style={({ pressed }) => [s.dayTask, pressed && s.pressed]}>
                      <Text style={s.key}>{t.key}</Text>
                      <Text style={s.dayTaskTitle} numberOfLines={2}>
                        {t.title}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}
            </View>
          );
        })
      ) : (
        <Text style={s.none}>Nothing to list.</Text>
      )}
      {footer ? <Text style={s.footer}>{footer}</Text> : null}
    </Sheet>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    loading: { gap: spacing.sm },
    item: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.line },
    row: { minHeight: 44, paddingVertical: spacing.sm + 2, gap: 2 },
    pressed: { opacity: 0.7 },
    head: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm },
    key: { ...typeStyle('caption'), ...font('500'), color: c.ink3, fontVariant: ['tabular-nums'] },
    title: { ...typeStyle('label'), color: c.ink, flex: 1, textAlign: 'auto' },
    meta: { flexDirection: 'row', flexWrap: 'wrap', columnGap: spacing.sm },
    metaText: { ...typeStyle('caption'), color: c.ink2 },
    late: { ...font('600'), color: c.dangerText },
    detail: { ...typeStyle('caption'), ...font('500') },
    dayTasks: { marginStart: spacing.md, marginBottom: spacing.sm, gap: 2 },
    dayTask: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm, minHeight: 44, paddingVertical: spacing.xs },
    dayTaskTitle: { ...typeStyle('body'), color: c.ink, flex: 1 },
    none: { ...typeStyle('body'), color: c.ink2, paddingVertical: spacing.md },
    footer: { ...typeStyle('caption'), color: c.ink2, paddingTop: spacing.sm },
    close: { flex: 1 },
  });
