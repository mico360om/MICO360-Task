import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { useColors } from '../../core/theme';
import { Button } from '../ui';
import { FieldLabel } from '../meeting/sheet-kit';
import { attachmentIcon, formatFileSize, uploadMimeType } from '../../lib/attachments';
import { NEW_TASK_TEXT, type NewTaskFile } from '../../lib/task-form';
import { spacing, radius, fontSize } from '../../lib/theme';

/**
 * Files for a new task (4a), as on the website's FilesField: picked files (any, or pictures) listed
 * with their size — or their progress while they go up, or why one couldn't — each removable until
 * then. They are attached once the task is created; they need a connection.
 */
export function FilesField({
  files,
  onPickFiles,
  onPickPictures,
  onRemove,
  busy,
}: {
  files: readonly NewTaskFile[];
  onPickFiles: () => void;
  onPickPictures: () => void;
  onRemove: (key: string) => void;
  /** Creating, or created: the list can't change. */
  busy?: boolean;
}) {
  const c = useColors();
  return (
    <View style={styles.wrap}>
      <FieldLabel>Attachments (optional)</FieldLabel>
      {files.map((f) => {
        const pct = f.fraction !== undefined ? Math.round(f.fraction * 100) : null;
        return (
          <View key={f.key} style={[styles.file, { borderColor: c.line, backgroundColor: c.surface }]}>
            <Text style={styles.icon} importantForAccessibility="no">
              {attachmentIcon(uploadMimeType(f.name, f.mimeType))}
            </Text>
            <View style={styles.grow}>
              <Text style={[styles.name, { color: c.ink }]} numberOfLines={1}>
                {f.name}
              </Text>
              {f.error ? (
                <Text style={[styles.meta, { color: c.danger }]} accessibilityRole="alert">
                  {f.error}
                </Text>
              ) : pct !== null ? (
                <View
                  accessibilityRole="progressbar"
                  accessibilityLabel={`Uploading ${f.name}`}
                  accessibilityValue={{ min: 0, max: 100, now: pct }}
                  style={[styles.track, { backgroundColor: c.ground }]}
                >
                  <View style={[styles.fill, { width: `${pct}%`, backgroundColor: c.brand }]} />
                </View>
              ) : (
                <Text style={[styles.meta, { color: c.ink3 }]}>{f.size !== null ? formatFileSize(f.size) : 'Size not known'}</Text>
              )}
            </View>
            {!busy && f.fraction === undefined ? (
              <Pressable onPress={() => onRemove(f.key)} accessibilityRole="button" accessibilityLabel={`Remove ${f.name}`} hitSlop={6} style={styles.remove}>
                <Text style={[styles.removeText, { color: c.ink2 }]}>✕</Text>
              </Pressable>
            ) : null}
          </View>
        );
      })}
      {!busy ? (
        <>
          <View style={styles.row}>
            <Button title="Choose files" variant="secondary" onPress={onPickFiles} style={styles.grow} />
            <Button title="Choose pictures" variant="secondary" onPress={onPickPictures} style={styles.grow} />
          </View>
          <Text style={[styles.hint, { color: c.ink3 }]}>{NEW_TASK_TEXT.filesHint}</Text>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.xs, marginBottom: spacing.md },
  row: { flexDirection: 'row', gap: spacing.sm },
  grow: { flex: 1 },
  file: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderWidth: 1, borderRadius: radius.md, paddingLeft: spacing.md, paddingVertical: spacing.xs, minHeight: 52 },
  icon: { fontSize: fontSize.lg },
  name: { fontSize: fontSize.sm, fontWeight: '600', textAlign: 'auto' },
  meta: { fontSize: fontSize.xs, marginTop: 2 },
  track: { height: 6, borderRadius: radius.pill, overflow: 'hidden', marginTop: 6 },
  fill: { height: 6 },
  remove: { width: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  removeText: { fontSize: fontSize.md, fontWeight: '700' },
  hint: { fontSize: fontSize.xs },
});
