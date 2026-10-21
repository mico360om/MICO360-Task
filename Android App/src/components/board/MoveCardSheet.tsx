import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useColors } from '../../core/theme';
import { Sheet, FieldLabel } from '../meeting/sheet-kit';
import { Button } from '../ui';
import { moveTargets, placeChoices, placeOrder, stepOrder, type Place } from '../../lib/board-move';
import { spacing, radius, fontSize, type Palette } from '../../lib/theme';
import type { BoardColumn } from '../../lib/board';
import type { ApiTask } from '../../lib/types';

/**
 * Move a card (4b), opened by long-pressing it (or TalkBack's "Move…"). The phone has no drag and
 * drop, so this says what a drop on the website's board says: in its own column, up or down one, to
 * the top or the bottom; into another column, then where in it — at the top, after one of its
 * cards, or at the bottom.
 */
export function MoveCardSheet({
  task,
  board,
  onReorder,
  onMove,
  onClose,
}: {
  task: ApiTask | null;
  /** The board's shown columns with their cards, in order. */
  board: BoardColumn[];
  /** Its own column in a new order. */
  onReorder: (columnId: string, orderedIds: string[]) => void;
  /** Into another column, at a place there. */
  onMove: (toColumnId: string, place: Place) => void;
  onClose: () => void;
}) {
  const c = useColors();
  const s = useMemo(() => makeStyles(c), [c]);
  const [to, setTo] = useState<string | null>(null);
  useEffect(() => setTo(null), [task?.id]);

  const own = task ? board.find((b) => b.column.id === task.columnId) : undefined;
  const ownTasks = own?.tasks ?? [];
  const targets = task ? moveTargets(board.map((b) => b.column), task.columnId) : [];
  const dest = to ? board.find((b) => b.column.id === to) : undefined;

  const here: { label: string; order: string[] | null }[] = task && own
    ? [
        { label: 'Move up', order: stepOrder(ownTasks, task.id, -1) },
        { label: 'Move down', order: stepOrder(ownTasks, task.id, 1) },
        { label: 'To the top', order: placeOrder(ownTasks, task.id, 'top') },
        { label: 'To the bottom', order: placeOrder(ownTasks, task.id, 'bottom') },
      ]
    : [];
  const shownHere = here.filter((h) => h.order);

  const close = () => {
    setTo(null);
    onClose();
  };

  return (
    <Sheet
      visible={!!task}
      title={dest ? `Move to ${dest.column.name}` : `Move “${task?.title ?? ''}”`}
      subtitle={dest ? 'Where in the column?' : task ? `${task.key}${own ? ` · in ${own.column.name}` : ''}` : null}
      onClose={close}
      closeLabel="Close, without moving the task"
      footer={dest ? <Button title="Back" variant="ghost" onPress={() => setTo(null)} style={s.flex} /> : <Button title="Cancel" variant="ghost" onPress={close} style={s.flex} />}
    >
      {dest && task ? (
        placeChoices(dest.tasks, task.id).map((choice) => (
          <Option key={typeof choice.place === 'string' ? choice.place : `after:${choice.place.after}`} label={choice.label} onPress={() => onMove(dest.column.id, choice.place)} s={s} />
        ))
      ) : (
        <>
          {own && shownHere.length ? (
            <View style={s.group}>
              <FieldLabel>In {own.column.name}</FieldLabel>
              {shownHere.map((h) => (
                <Option key={h.label} label={h.label} onPress={() => onReorder(own.column.id, h.order!)} s={s} />
              ))}
            </View>
          ) : null}
          <View style={s.group}>
            <FieldLabel>To another column</FieldLabel>
            {targets.length === 0 ? <Text style={s.none}>There is no other column to move it to.</Text> : null}
            {targets.map((col) => {
              const count = board.find((b) => b.column.id === col.id)?.tasks.length ?? 0;
              return (
                <Option
                  key={col.id}
                  label={col.name}
                  a11y={`Move to ${col.name}, ${count} ${count === 1 ? 'task' : 'tasks'}. Then choose where in it.`}
                  dot={col.color}
                  trailing={`${count} ›`}
                  onPress={() => setTo(col.id)}
                  s={s}
                />
              );
            })}
          </View>
        </>
      )}
    </Sheet>
  );
}

function Option({ label, a11y, dot, trailing, onPress, s }: { label: string; a11y?: string; dot?: string; trailing?: string; onPress: () => void; s: Styles }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={a11y ?? label} style={({ pressed }) => [s.option, pressed && s.pressed]}>
      {dot ? <View style={[s.dot, { backgroundColor: dot }]} /> : null}
      <Text style={s.optionText}>{label}</Text>
      {trailing ? (
        <Text style={s.trailing} importantForAccessibility="no">
          {trailing}
        </Text>
      ) : null}
    </Pressable>
  );
}

type Styles = ReturnType<typeof makeStyles>;

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    flex: { flex: 1 },
    group: { gap: 2, marginBottom: spacing.md },
    none: { fontSize: fontSize.sm, color: c.ink3, paddingVertical: spacing.sm },
    option: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md, paddingHorizontal: spacing.sm, borderRadius: radius.md, minHeight: 48 },
    pressed: { backgroundColor: c.ground },
    dot: { width: 12, height: 12, borderRadius: 6 },
    optionText: { flex: 1, fontSize: fontSize.md, fontWeight: '600', color: c.ink },
    trailing: { fontSize: fontSize.sm, color: c.ink3, fontWeight: '700' },
  });
