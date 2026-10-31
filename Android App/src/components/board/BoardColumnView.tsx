import React, { useMemo } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet, useWindowDimensions } from 'react-native';
import { useColors } from '../../core/theme';
import { BoardCard } from './BoardCard';
import { Icon } from '../Icon';
import { spacing, radius, fontSize, type Palette } from '../../lib/theme';
import { columnFill, type BoardCard as Card } from '../../lib/board';
import { font } from '../../lib/typography';
import { capLines } from '../ui/text-lines';

/**
 * One column of a board (4b; the All projects board's statuses too, 4c): its colour, name, count
 * and "+", then its cards — a virtualized list as tall as the board, so it scrolls on its own. An
 * empty column is itself the way to start its first task (the website's) — on a phone only as tall as
 * its "No tasks" (lib/board columnFill). `steps`: whether a card can be moved up or down here (not on
 * the All projects board, whose cards keep their order).
 */
export const BoardColumnView = React.memo(function BoardColumnView({
  id,
  name,
  color,
  cards,
  width,
  height,
  timeZone,
  photoOf,
  onAdd,
  onOpen,
  onActions,
  onStep,
  steps = true,
}: {
  id: string;
  name: string;
  color: string;
  cards: Card[];
  width: number;
  /** The board area's height (0 until it is known: the column then sizes to its cards). */
  height: number;
  timeZone: string;
  photoOf: (id: string) => string | null;
  onAdd: (columnId: string) => void;
  onOpen: (card: Card) => void;
  onActions: (card: Card) => void;
  onStep?: (card: Card, dir: -1 | 1) => void;
  steps?: boolean;
}) {
  const c = useColors();
  const s = useMemo(() => makeStyles(c), [c]);
  const { width: screenWidth } = useWindowDimensions();
  return (
    <View style={[s.column, { width }, height > 0 && columnFill({ cards: cards.length, screenWidth }) === 'fill' ? { height } : null]}>
      <View style={[s.columnStripe, { backgroundColor: color }]} />
      <View style={s.columnHead}>
        <View style={[s.dot, { backgroundColor: color }]} />
        <Text style={s.columnName} numberOfLines={capLines(2)} accessibilityRole="header">
          {name}
        </Text>
        <Text style={s.count} accessibilityLabel={`${cards.length} ${cards.length === 1 ? 'task' : 'tasks'}`}>
          {cards.length}
        </Text>
        {/* The website's "+" on every column: a new task starts in this column. */}
        <Pressable onPress={() => onAdd(id)} accessibilityRole="button" accessibilityLabel={`Add a task to ${name}`} hitSlop={6} style={({ pressed }) => [s.colAdd, pressed && s.pressed]}>
          <Icon name="ui.plus" size={20} color={c.ink2} />
        </Pressable>
      </View>
      <FlatList
        data={cards}
        keyExtractor={(card) => card.id}
        contentContainerStyle={s.columnBody}
        showsVerticalScrollIndicator={false}
        initialNumToRender={8}
        windowSize={7}
        nestedScrollEnabled
        renderItem={({ item: card, index }) => (
          <BoardCard
            card={card}
            timeZone={timeZone}
            photoOf={photoOf}
            onOpen={onOpen}
            onActions={onActions}
            onStep={onStep ?? noStep}
            canStepUp={steps && index > 0}
            canStepDown={steps && index < cards.length - 1}
          />
        )}
        ListEmptyComponent={
          <Pressable onPress={() => onAdd(id)} accessibilityRole="button" accessibilityLabel={`No tasks in ${name}. Add a task`} style={({ pressed }) => [s.emptyAdd, pressed && s.pressed]}>
            <Text style={s.emptyCol}>No tasks</Text>
            <View style={s.emptyAddRow}>
              <Icon name="ui.plus" size={14} color={c.brandText} />
              <Text style={s.emptyAddText}>Add a task</Text>
            </View>
          </Pressable>
        }
      />
    </View>
  );
});

const noStep = () => {};

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    pressed: { opacity: 0.6 },
    column: { backgroundColor: c.ground, borderRadius: radius.card, borderWidth: 1, borderColor: c.line, padding: spacing.sm, paddingTop: spacing.sm + 3, overflow: 'hidden' },
    columnStripe: { position: 'absolute', top: 0, left: 0, right: 0, height: 4 },
    columnHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.sm },
    dot: { width: 10, height: 10, borderRadius: 5 },
    columnName: { flex: 1, fontSize: fontSize.md, ...font('700'), color: c.ink },
    count: { fontSize: fontSize.sm, ...font('700'), color: c.ink2, minWidth: 20, textAlign: 'center' },
    columnBody: { gap: spacing.sm, paddingBottom: spacing.xxl * 2 },
    emptyCol: { color: c.ink3, fontSize: fontSize.sm, padding: spacing.sm },
    emptyAdd: { alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderStyle: 'dashed', borderColor: c.line, borderRadius: radius.button, paddingVertical: spacing.lg, minHeight: 88 },
    emptyAddRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    emptyAddText: { color: c.brandText, fontSize: fontSize.sm, ...font('700') },
    colAdd: { width: 44, height: 44, borderRadius: radius.input, alignItems: 'center', justifyContent: 'center' },
  });
