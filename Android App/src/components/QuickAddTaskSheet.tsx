import React, { useMemo, useState } from 'react';
import { Modal, View, Text, Pressable, ScrollView, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import { useServices } from '../core/providers';
import { useColors } from '../core/theme';
import { ApiError } from '../lib/api-client';
import { Button, TextField, ErrorNote, SectionTitle } from './ui';
import { buildCreateTaskInput, parseTags } from '../lib/quick-add';
import { spacing, radius, fontSize, categoryColorOf, type Palette } from '../lib/theme';
import type { ApiColumn, Priority } from '../lib/types';

const PRIORITIES: Priority[] = ['LOW', 'NORMAL', 'HIGH', 'URGENT'];

/** Quick Add Task (A4.3) — create a task in a chosen column of the current project. */
export function QuickAddTaskSheet({
  visible,
  onClose,
  projectId,
  columns,
  boardDate,
}: {
  visible: boolean;
  onClose: () => void;
  projectId: string;
  columns: ApiColumn[];
  /** Per-date boards: create the task on this day (defaults to today server-side). */
  boardDate?: string;
}) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => makeStyles(c), [c]);
  const { resources, queue, session } = useServices();
  const qc = useQueryClient();
  const myId = session.getSession()?.user.id;

  const enabled = columns.filter((col) => col.enabled);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [columnId, setColumnId] = useState(enabled[0]?.id ?? '');
  const [priority, setPriority] = useState<Priority>('NORMAL');
  const [dueDate, setDueDate] = useState('');
  const [estimate, setEstimate] = useState('');
  const [tags, setTags] = useState('');
  const [assignToMe, setAssignToMe] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function reset() {
    setTitle('');
    setDescription('');
    setPriority('NORMAL');
    setDueDate('');
    setEstimate('');
    setTags('');
    setAssignToMe(false);
    setError(null);
  }

  async function submit() {
    const estimatedHours = estimate.trim() ? Number(estimate.trim()) : undefined;
    const built = buildCreateTaskInput({
      title,
      projectId,
      columnId,
      priority,
      description,
      dueDate: dueDate.trim() || undefined,
      estimatedHours,
      tags: parseTags(tags),
      assigneeIds: assignToMe && myId ? [myId] : undefined,
    });
    if (!built.ok) {
      setError(built.error);
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await resources.tasks.create({ ...built.value, ...(boardDate ? { boardDate } : {}) });
      await qc.invalidateQueries({ queryKey: ['tasks', 'project', projectId] });
      reset();
      onClose();
    } catch (e) {
      // A server rejection (4xx/5xx) is a real error; a network failure is queued for later sync.
      if (e instanceof ApiError) {
        setError(e.message || 'Could not create the task. Please try again.');
      } else {
        await queue.enqueue('task.create', built.value);
        reset();
        // Keep the sheet open so the offline confirmation is visible; it syncs on reconnect.
        setNotice('You’re offline — the task was queued and will sync automatically.');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View style={[styles.sheet, { paddingBottom: spacing.lg + insets.bottom }]}>
        <Text style={styles.title}>New task</Text>
        <ScrollView keyboardShouldPersistTaps="handled" style={styles.body}>
          {error ? <ErrorNote message={error} /> : null}
          {notice ? (
            <View style={styles.notice}>
              <Text style={styles.noticeText}>{notice}</Text>
            </View>
          ) : null}
          <TextField label="Title" required value={title} onChangeText={setTitle} placeholder="What needs doing?" autoFocus />

          <TextField
            label="Description"
            value={description}
            onChangeText={setDescription}
            placeholder="Add more detail (optional)"
            multiline
            numberOfLines={3}
            style={styles.multiline}
          />

          <SectionTitle>Status</SectionTitle>
          <View style={styles.chips}>
            {enabled.map((col) => {
              const active = col.id === columnId;
              return (
                <Pressable
                  key={col.id}
                  onPress={() => setColumnId(col.id)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={`Status ${col.name}`}
                  style={[styles.chip, active && styles.chipActive]}
                >
                  <View style={[styles.dot, { backgroundColor: categoryColorOf(c, col.category) }]} />
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>{col.name}</Text>
                </Pressable>
              );
            })}
          </View>

          <SectionTitle>Priority</SectionTitle>
          <View style={styles.chips}>
            {PRIORITIES.map((p) => {
              const active = p === priority;
              return (
                <Pressable
                  key={p}
                  onPress={() => setPriority(p)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={`${p} priority`}
                  style={[styles.chip, active && styles.chipActive]}
                >
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>{p}</Text>
                </Pressable>
              );
            })}
          </View>

          <View style={styles.row}>
            <View style={styles.rowItem}>
              <TextField label="Due date" value={dueDate} onChangeText={setDueDate} placeholder="YYYY-MM-DD" autoCapitalize="none" />
            </View>
            <View style={styles.rowItem}>
              <TextField label="Est. hours" value={estimate} onChangeText={setEstimate} placeholder="e.g. 3" keyboardType="numeric" />
            </View>
          </View>

          <TextField label="Tags" value={tags} onChangeText={setTags} placeholder="comma, separated" autoCapitalize="none" />

          {myId ? (
            <Pressable
              onPress={() => setAssignToMe((v) => !v)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: assignToMe }}
              style={[styles.chip, styles.assignRow, assignToMe && styles.chipActive]}
            >
              <View style={[styles.checkbox, assignToMe && styles.checkboxOn]}>
                {assignToMe ? <Text style={styles.checkboxTick}>✓</Text> : null}
              </View>
              <Text style={[styles.chipText, assignToMe && styles.chipTextActive]}>Assign to me</Text>
            </Pressable>
          ) : null}
        </ScrollView>

        <View style={styles.actions}>
          <Button title="Cancel" variant="ghost" onPress={onClose} style={styles.action} />
          <Button title="Add task" onPress={submit} loading={busy} disabled={!title.trim() || !columnId} style={styles.action} />
        </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    fill: { flex: 1 },
    backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
    sheet: {
      backgroundColor: c.surface,
      borderTopLeftRadius: radius.lg,
      borderTopRightRadius: radius.lg,
      padding: spacing.lg,
      gap: spacing.sm,
      maxHeight: '88%',
    },
    body: { flexGrow: 0 },
    multiline: { minHeight: 76, paddingTop: spacing.sm, textAlignVertical: 'top' },
    row: { flexDirection: 'row', gap: spacing.sm },
    rowItem: { flex: 1 },
    notice: {
      backgroundColor: c.brandWash,
      borderWidth: 1,
      borderColor: c.brand,
      borderRadius: radius.md,
      padding: spacing.md,
      marginBottom: spacing.md,
    },
    noticeText: { color: c.brand, fontSize: fontSize.sm, fontWeight: '500' },
    title: { fontSize: fontSize.xl, fontWeight: '800', color: c.ink, marginBottom: spacing.xs },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.sm },
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
      borderWidth: 1,
      borderColor: c.line,
      borderRadius: radius.pill,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    chipActive: { borderColor: c.brand, backgroundColor: c.brandWash },
    chipText: { fontSize: fontSize.sm, color: c.ink, fontWeight: '600' },
    chipTextActive: { color: c.brand },
    assignRow: { alignSelf: 'flex-start', marginTop: spacing.xs },
    checkbox: {
      width: 18,
      height: 18,
      borderRadius: 5,
      borderWidth: 1.5,
      borderColor: c.line,
      alignItems: 'center',
      justifyContent: 'center',
    },
    checkboxOn: { borderColor: c.brand, backgroundColor: c.brand },
    checkboxTick: { color: c.onBrand, fontSize: 12, fontWeight: '900', lineHeight: 14 },
    dot: { width: 8, height: 8, borderRadius: 4 },
    actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
    action: { flex: 1 },
  });
