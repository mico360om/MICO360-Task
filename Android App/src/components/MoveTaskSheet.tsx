import React, { useMemo } from 'react';
import { Modal, View, Text, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '../core/theme';
import { moveTargets } from '../lib/board-move';
import { categoryColorOf, spacing, radius, fontSize, type Palette } from '../lib/theme';
import type { ApiColumn, ApiTask } from '../lib/types';

/** "Move to…" sheet for a board card (opened by long-pressing it): pick the column it goes to. */
export function MoveTaskSheet({
  task,
  columns,
  onMove,
  onClose,
}: {
  task: ApiTask | null;
  columns: ApiColumn[];
  onMove: (columnId: string) => void;
  onClose: () => void;
}) {
  const c = useColors();
  const styles = useMemo(() => makeStyles(c), [c]);
  const insets = useSafeAreaInsets();
  const targets = task ? moveTargets(columns, task.columnId) : [];
  return (
    <Modal visible={!!task} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close" accessibilityRole="button" />
      <View style={[styles.sheet, { paddingBottom: spacing.lg + insets.bottom }]} accessibilityViewIsModal>
        <Text style={styles.title} numberOfLines={2}>
          Move “{task?.title}”
        </Text>
        <Text style={styles.subtitle}>{task?.key} · choose a column</Text>
        {targets.map((col) => (
          <Pressable
            key={col.id}
            onPress={() => onMove(col.id)}
            accessibilityRole="button"
            accessibilityLabel={`Move to ${col.name}`}
            style={({ pressed }) => [styles.option, pressed && styles.pressed]}
          >
            <View style={[styles.dot, { backgroundColor: categoryColorOf(c, col.category) }]} />
            <Text style={styles.optionText}>{col.name}</Text>
          </Pressable>
        ))}
        {targets.length === 0 ? <Text style={styles.subtitle}>There is no other column to move it to.</Text> : null}
        <Pressable onPress={onClose} accessibilityRole="button" style={styles.cancel}>
          <Text style={styles.cancelText}>Cancel</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
    sheet: { backgroundColor: c.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg, gap: spacing.xs },
    title: { fontSize: fontSize.lg, fontWeight: '800', color: c.ink },
    subtitle: { fontSize: fontSize.sm, color: c.ink3, marginBottom: spacing.sm },
    option: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md, paddingHorizontal: spacing.sm, borderRadius: radius.md, minHeight: 48 },
    pressed: { backgroundColor: c.ground },
    dot: { width: 10, height: 10, borderRadius: 5 },
    optionText: { fontSize: fontSize.md, fontWeight: '600', color: c.ink },
    cancel: { alignItems: 'center', paddingVertical: spacing.md, marginTop: spacing.xs },
    cancelText: { fontSize: fontSize.md, fontWeight: '700', color: c.brand },
  });
