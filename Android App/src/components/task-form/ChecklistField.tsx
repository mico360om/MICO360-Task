import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { useColors } from '../../core/theme';
import { Button, IconButton, TextField } from '../ui';
import { FieldLabel } from '../meeting/sheet-kit';
import {
  CHECKLIST_ITEM_MAX,
  CHECKLIST_MAX,
  CHECKLIST_TEXT,
  checklistItemLabel,
  checklistRemoveLabel,
  checklistTexts,
  newChecklistRow,
  type ChecklistRow,
} from '../../lib/checklist-draft';
import { radius, spacing, type Palette } from '../../lib/theme';

/**
 * A new task's checklist (the website's ChecklistField): its items, each editable and removable, and a
 * box to add more. The return key adds the typed item; leaving the box adds what was typed; several
 * lines pasted at once become several items. The typed text lives with the form (`pending`), so it
 * counts as a change and is saved even when not added. Items have stable keys: ✕ always removes its
 * own item, and an emptied item goes when it is left.
 */
export function ChecklistField({
  rows,
  pending,
  onChange,
  disabled = false,
}: {
  rows: ChecklistRow[];
  pending: string;
  onChange(next: { rows: ChecklistRow[]; pending: string }): void;
  disabled?: boolean;
}) {
  const c = useColors();
  const s = useMemo(() => makeStyles(c), [c]);
  const full = rows.length >= CHECKLIST_MAX;

  /** The typed text's lines as new items (up to the limit); the box empties. */
  function add(text: string) {
    const lines = checklistTexts([], text);
    onChange({ rows: lines.length ? [...rows, ...lines.map(newChecklistRow)].slice(0, CHECKLIST_MAX) : rows, pending: '' });
  }

  return (
    <View style={s.wrap}>
      <FieldLabel>{`${CHECKLIST_TEXT.label} (optional)`}</FieldLabel>
      {rows.map((row, i) => (
        <View key={row.id} style={s.row}>
          <View style={s.box} />
          <View style={s.flex}>
            <TextField
              value={row.text}
              onChangeText={(text) => onChange({ rows: rows.map((r) => (r.id === row.id ? { ...r, text } : r)), pending })}
              onBlur={() => {
                if (!row.text.trim()) onChange({ rows: rows.filter((r) => r.id !== row.id), pending });
              }}
              accessibilityLabel={checklistItemLabel(i + 1)}
              maxLength={CHECKLIST_ITEM_MAX}
              returnKeyType="done"
              editable={!disabled}
            />
          </View>
          <IconButton icon="ui.close" label={checklistRemoveLabel(row.text, i + 1)} onPress={() => onChange({ rows: rows.filter((r) => r.id !== row.id), pending })} disabled={disabled} color={c.ink2} />
        </View>
      ))}
      <View style={s.row}>
        <View style={s.flex}>
          <TextField
            value={pending}
            onChangeText={(text) => {
              // Several lines at once (pasted): one item per line.
              if (/\n/.test(text)) add(text);
              else onChange({ rows, pending: text });
            }}
            onSubmitEditing={() => add(pending)}
            onBlur={() => {
              if (pending.trim()) add(pending);
            }}
            blurOnSubmit={false}
            returnKeyType="done"
            accessibilityLabel={CHECKLIST_TEXT.addLabel}
            accessibilityHint="Tap Add or the return key to add it. Pasting several lines adds one item per line."
            placeholder={full ? CHECKLIST_TEXT.full : CHECKLIST_TEXT.placeholder}
            maxLength={CHECKLIST_ITEM_MAX * 20}
            editable={!disabled && !full}
          />
        </View>
        <Button title={CHECKLIST_TEXT.add} variant="secondary" size="sm" onPress={() => add(pending)} disabled={disabled || full || !pending.trim()} />
      </View>
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    wrap: { gap: spacing.xs },
    row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    flex: { flex: 1 },
    box: { width: 16, height: 16, borderRadius: radius.badge, borderWidth: 1, borderColor: c.ink3 },
  });
