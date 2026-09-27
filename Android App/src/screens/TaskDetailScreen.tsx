import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  keyed,
  useTask,
  useProjectColumns,
  useMoveTask,
  useUpdateTask,
  useTaskTags,
  useSetTaskTags,
  useProjectMembers,
  useTaskAssignees,
  useAssignUsers,
  useUnassignUser,
  useTaskChecklist,
  useChecklistMutations,
  useTaskComments,
  useCommentMutations,
} from '../core/queries';
import { useMyQueuedChanges } from '../core/providers';
import { useColors } from '../core/theme';
import { Card, SectionTitle, Loader, ErrorNote, NoticeNote, Pill, Button, TextField } from '../components/ui';
import { formatDue, priorityColor } from '../components/TaskRow';
import { parseTags } from '../lib/quick-add';
import { parseDueDateInput, parseHoursInput } from '../lib/form-input';
import { ApiError, isNetworkError } from '../lib/api-client';
import { recurrenceSummary } from '../lib/recurrence-summary';
import { categoryColorOf, spacing, radius, fontSize, type Palette } from '../lib/theme';
import type { AppScreenProps } from '../navigation/types';
import { displayName, type ApiTask, type Priority } from '../lib/types';

const PRIORITIES: Priority[] = ['LOW', 'NORMAL', 'HIGH', 'URGENT'];
const OFFLINE_NOTICE = 'You’re offline — saved on this phone and will sync automatically.';

/** User-facing text for a failed write. */
function errorText(e: unknown, fallback: string): string {
  return e instanceof ApiError && e.message ? e.message : fallback;
}

export function TaskDetailScreen({ route }: AppScreenProps<'TaskDetail'>) {
  const { taskId } = route.params;
  const c = useColors();
  const styles = useMemo(() => makeStyles(c), [c]);
  const taskQ = useTask(taskId);
  const task = taskQ.data;
  const columnsQ = useProjectColumns(task?.projectId ?? '');
  const move = useMoveTask(task?.projectId ?? '');
  const update = useUpdateTask(taskId);
  const tagsQ = useTaskTags(taskId);
  const setTags = useSetTaskTags(taskId);
  const assigneesQ = useTaskAssignees(taskId);
  const membersQ = useProjectMembers(task?.projectId ?? '');
  const assign = useAssignUsers(taskId);
  const unassign = useUnassignUser(taskId);
  const checklistQ = useTaskChecklist(taskId);
  const checklistM = useChecklistMutations(taskId);
  const commentsQ = useTaskComments(taskId);
  const commentM = useCommentMutations(taskId);
  const queued = useMyQueuedChanges();

  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ title: '', description: '', dueDate: '', estimate: '', priority: 'NORMAL' as Priority });
  const [editScope, setEditScope] = useState<'one' | 'series'>('one');
  const [editErr, setEditErr] = useState<string | null>(null);
  const [dueErr, setDueErr] = useState<string | null>(null);
  const [estErr, setEstErr] = useState<string | null>(null);
  const [editingTags, setEditingTags] = useState(false);
  const [tagsInput, setTagsInput] = useState('');
  const [tagsErr, setTagsErr] = useState<string | null>(null);
  const [newSubtask, setNewSubtask] = useState('');
  const [subtaskErr, setSubtaskErr] = useState<string | null>(null);
  const [newComment, setNewComment] = useState('');
  const [commentErr, setCommentErr] = useState<string | null>(null);
  const [actionErr, setActionErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (taskQ.isLoading) return <Loader />;
  if (taskQ.isError || !task) {
    return (
      <ErrorNote
        message="Could not load this task. Check your connection and try again."
        onRetry={() => void taskQ.refetch()}
        retrying={taskQ.isRefetching}
      />
    );
  }

  const columns = (columnsQ.data ?? []).filter((col) => col.enabled);
  const currentColumn = columns.find((col) => col.id === task.columnId);
  const due = formatDue(task.dueDate);
  const tags = tagsQ.data ?? [];
  const assignees = assigneesQ.data ?? [];
  const assignedIds = new Set(assignees.map((a) => a.id));
  const addableMembers = (membersQ.data ?? []).filter((m) => !assignedIds.has(m.id));
  const checklist = checklistQ.data;
  const comments = commentsQ.data ?? [];
  // Comments written offline for this task, waiting to sync — shown as "Sending…" (MOB-07).
  const pendingComments = queued.pending.filter(
    (m) => m.kind === 'comment.add' && (m.payload as { id?: string } | null)?.id === taskId,
  );

  /**
   * Run a write and surface the outcome: a server rejection shows an inline error; no answer
   * means it was queued for sync (for writes whose hook queues them) and we say so, or — for the
   * few writes that cannot be queued — that it needs a connection. Nothing fails silently.
   */
  async function run<T>(p: Promise<T>, fallback: string, queuedOffline = true): Promise<T | undefined> {
    setActionErr(null);
    try {
      return await p;
    } catch (e) {
      if (isNetworkError(e) && queuedOffline) setNotice(OFFLINE_NOTICE);
      else if (isNetworkError(e)) setActionErr('You’re offline — this needs a connection. Please try again.');
      else setActionErr(errorText(e, fallback));
      return undefined;
    }
  }

  const setProgress = (value: number) =>
    void run(update.mutateAsync({ progress: Math.max(0, Math.min(100, value)) }), 'Could not update the progress.');

  function startEdit() {
    if (!task) return;
    setForm({
      title: task.title,
      description: task.description ?? '',
      dueDate: task.dueDate ? task.dueDate.slice(0, 10) : '',
      estimate: task.estimatedHours != null ? String(task.estimatedHours) : '',
      priority: task.priority,
    });
    setEditScope('one');
    setEditErr(null);
    setDueErr(null);
    setEstErr(null);
    setEditing(true);
  }

  async function saveEdit() {
    if (!task) return;
    const title = form.title.trim();
    if (!title) {
      setEditErr('A task title is required.');
      return;
    }
    // Strict round-trip date check and Arabic-friendly hours (MOB-06 / ARB-04) — never guess.
    const dueParsed = parseDueDateInput(form.dueDate);
    const estParsed = parseHoursInput(form.estimate);
    setDueErr(dueParsed.ok ? null : dueParsed.error);
    setEstErr(estParsed.ok ? null : estParsed.error);
    if (!dueParsed.ok || !estParsed.ok) return;

    const patch: Partial<ApiTask> & { scope?: 'one' | 'series' } = {};
    if (title !== task.title) patch.title = title;
    if (form.description.trim() !== (task.description ?? '')) patch.description = form.description.trim();
    const curDue = task.dueDate ? task.dueDate.slice(0, 10) : null;
    if (dueParsed.value !== curDue) patch.dueDate = dueParsed.value;
    if (estParsed.value !== (task.estimatedHours ?? null)) patch.estimatedHours = estParsed.value;
    if (form.priority !== task.priority) patch.priority = form.priority;

    if (Object.keys(patch).length === 0) {
      setEditing(false);
      return;
    }
    // Apply to the whole series only when this is a recurring task and the user chose so.
    if (task.recurrenceRule && editScope === 'series') patch.scope = 'series';
    setEditErr(null);
    try {
      await update.mutateAsync(patch);
      setEditing(false);
    } catch (e) {
      if (isNetworkError(e)) {
        setEditing(false);
        setNotice(OFFLINE_NOTICE);
      } else {
        setEditErr(errorText(e, 'Could not save your changes. Please try again.'));
      }
    }
  }

  function startEditTags() {
    setTagsInput(tags.map((t) => t.name).join(', '));
    setTagsErr(null);
    setEditingTags(true);
  }
  async function saveTags() {
    setTagsErr(null);
    try {
      await setTags.mutateAsync(parseTags(tagsInput));
      setEditingTags(false);
    } catch (e) {
      setTagsErr(isNetworkError(e) ? 'You’re offline — tags could not be saved. Try again when connected.' : errorText(e, 'Could not save the tags.'));
    }
  }

  async function addSubtask() {
    const t = newSubtask.trim();
    if (!t) return;
    setSubtaskErr(null);
    try {
      await checklistM.add.mutateAsync(keyed({ text: t }));
      setNewSubtask('');
    } catch (e) {
      if (isNetworkError(e)) {
        setNewSubtask('');
        setNotice(OFFLINE_NOTICE);
      } else {
        setSubtaskErr(errorText(e, 'Could not add the subtask.'));
      }
    }
  }

  async function sendComment() {
    const body = newComment.trim();
    if (!body) return;
    setCommentErr(null);
    // The text stays in the box until the server has it (or it is safely queued) — MOB-07.
    try {
      await commentM.add.mutateAsync(keyed({ body }));
      setNewComment('');
    } catch (e) {
      if (isNetworkError(e)) {
        setNewComment(''); // queued: shown below as "Sending…" and synced automatically
      } else {
        setCommentErr(errorText(e, 'Your comment was not posted. Please try again.'));
      }
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={taskQ.isRefetching} onRefresh={() => void taskQ.refetch()} />}
      >
        <Text style={styles.key}>{task.key}</Text>
        <Text style={styles.title} accessibilityRole="header">
          {task.title}
        </Text>

        {actionErr ? <ErrorNote message={actionErr} /> : null}
        {notice ? <NoticeNote message={notice} /> : null}

        <View style={styles.pills}>
          <Pill label={task.priority} color={priorityColor(c, task.priority)} />
          {currentColumn ? <Pill label={currentColumn.name} color={categoryColorOf(c, currentColumn.category)} /> : null}
          {due ? <Pill label={`Due ${due}`} /> : null}
          {task.estimatedHours != null ? <Pill label={`Est. ${task.estimatedHours}h`} /> : null}
        </View>
        {task.recurrenceRule ? (
          <Text style={styles.recurrence}>🔁 {recurrenceSummary(task.recurrenceRule)}</Text>
        ) : null}

        {/* Details — read or edit */}
        {!editing ? (
          <View style={styles.section}>
            <View style={styles.rowBetween}>
              <SectionTitle>Details</SectionTitle>
              <Pressable onPress={startEdit} accessibilityRole="button" accessibilityLabel="Edit details" hitSlop={8}>
                <Text style={styles.link}>Edit</Text>
              </Pressable>
            </View>
            {task.description ? (
              <Card>
                <Text style={styles.desc}>{task.description}</Text>
              </Card>
            ) : (
              <Text style={styles.muted}>No description.</Text>
            )}
          </View>
        ) : (
          <View style={styles.section}>
            <SectionTitle>Edit details</SectionTitle>
            {editErr ? <ErrorNote message={editErr} /> : null}
            <TextField label="Title" required value={form.title} onChangeText={(v) => setForm((f) => ({ ...f, title: v }))} />
            <TextField
              label="Description"
              value={form.description}
              onChangeText={(v) => setForm((f) => ({ ...f, description: v }))}
              placeholder="Add more detail (optional)"
              multiline
              numberOfLines={3}
              style={styles.multiline}
            />
            <View style={styles.row}>
              <View style={styles.rowItem}>
                <TextField
                  label="Due date"
                  value={form.dueDate}
                  onChangeText={(v) => {
                    setForm((f) => ({ ...f, dueDate: v }));
                    if (dueErr) setDueErr(null);
                  }}
                  onBlur={() => {
                    const r = parseDueDateInput(form.dueDate);
                    setDueErr(r.ok ? null : r.error);
                  }}
                  placeholder="YYYY-MM-DD"
                  autoCapitalize="none"
                  keyboardType="numbers-and-punctuation"
                  maxLength={10}
                  error={dueErr}
                />
              </View>
              <View style={styles.rowItem}>
                <TextField
                  label="Est. hours"
                  value={form.estimate}
                  onChangeText={(v) => {
                    setForm((f) => ({ ...f, estimate: v }));
                    if (estErr) setEstErr(null);
                  }}
                  onBlur={() => {
                    const r = parseHoursInput(form.estimate);
                    setEstErr(r.ok ? null : r.error);
                  }}
                  placeholder="e.g. 2.5"
                  keyboardType="decimal-pad"
                  error={estErr}
                />
              </View>
            </View>
            <SectionTitle>Priority</SectionTitle>
            <View style={styles.chips} accessibilityRole="radiogroup">
              {PRIORITIES.map((p) => {
                const active = p === form.priority;
                return (
                  <Pressable
                    key={p}
                    onPress={() => setForm((f) => ({ ...f, priority: p }))}
                    accessibilityRole="radio"
                    accessibilityLabel={`${p} priority`}
                    accessibilityState={{ selected: active, checked: active }}
                    style={[styles.chip, active && styles.chipActive]}
                  >
                    <Text style={[styles.chipText, active && styles.chipTextActive]}>{p}</Text>
                  </Pressable>
                );
              })}
            </View>
            {task.recurrenceRule ? (
              <>
                <SectionTitle>Apply changes to</SectionTitle>
                <View style={styles.chips} accessibilityRole="radiogroup">
                  {(['one', 'series'] as const).map((s) => {
                    const active = s === editScope;
                    const label = s === 'one' ? 'This task' : 'Entire series';
                    return (
                      <Pressable
                        key={s}
                        onPress={() => setEditScope(s)}
                        accessibilityRole="radio"
                        accessibilityLabel={`Apply changes to ${label.toLowerCase()}`}
                        accessibilityState={{ selected: active, checked: active }}
                        style={[styles.chip, active && styles.chipActive]}
                      >
                        <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </>
            ) : null}
            <View style={styles.editActions}>
              <Button title="Cancel" variant="ghost" onPress={() => setEditing(false)} style={styles.pBtn} />
              <Button title="Save" onPress={() => void saveEdit()} loading={update.isPending} style={styles.pBtn} />
            </View>
          </View>
        )}

        {/* Tags */}
        <View style={styles.section}>
          <View style={styles.rowBetween}>
            <SectionTitle>Tags</SectionTitle>
            {!editingTags ? (
              <Pressable onPress={startEditTags} accessibilityRole="button" accessibilityLabel="Edit tags" hitSlop={8}>
                <Text style={styles.link}>Edit</Text>
              </Pressable>
            ) : null}
          </View>
          {!editingTags ? (
            tags.length === 0 ? (
              <Text style={styles.muted}>No tags.</Text>
            ) : (
              <View style={styles.pills}>
                {tags.map((t) => (
                  <Pill key={t.id} label={t.name} color={t.color} />
                ))}
              </View>
            )
          ) : (
            <>
              {tagsErr ? <ErrorNote message={tagsErr} /> : null}
              <TextField
                value={tagsInput}
                onChangeText={setTagsInput}
                placeholder="comma, separated"
                accessibilityLabel="Tags, separated by commas"
                autoCapitalize="none"
              />
              <View style={styles.editActions}>
                <Button title="Cancel" variant="ghost" onPress={() => setEditingTags(false)} style={styles.pBtn} />
                <Button title="Save tags" onPress={() => void saveTags()} loading={setTags.isPending} style={styles.pBtn} />
              </View>
            </>
          )}
        </View>

        {/* Checklist / subtasks */}
        <View style={styles.section}>
          <SectionTitle>
            Subtasks{checklist && checklist.total > 0 ? ` · ${checklist.done}/${checklist.total} (${checklist.progress}%)` : ''}
          </SectionTitle>
          {checklist && checklist.total > 0 ? (
            <View style={styles.progressBar} importantForAccessibility="no-hide-descendants">
              <View style={[styles.progressFill, { width: `${checklist.progress}%` }]} />
            </View>
          ) : null}
          {checklist && checklist.items.length > 0 ? (
            checklist.items.map((it) => (
              <View key={it.id} style={styles.subtaskRow}>
                <Pressable
                  onPress={() =>
                    void run(checklistM.update.mutateAsync({ itemId: it.id, patch: { done: !it.done } }), 'Could not update the subtask.')
                  }
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: it.done }}
                  accessibilityLabel={it.text}
                  hitSlop={8}
                  style={[styles.checkbox, it.done && styles.checkboxOn]}
                >
                  {it.done ? <Text style={styles.checkboxTick}>✓</Text> : null}
                </Pressable>
                <Text style={[styles.subtaskText, it.done && styles.subtaskDone]}>{it.text}</Text>
                <Pressable
                  onPress={() => void run(checklistM.remove.mutateAsync(it.id), 'Could not remove the subtask.', false)}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${it.text}`}
                  hitSlop={8}
                >
                  <Text style={styles.removeX}>×</Text>
                </Pressable>
              </View>
            ))
          ) : (
            <Text style={styles.muted}>No subtasks yet.</Text>
          )}
          {subtaskErr ? <ErrorNote message={subtaskErr} /> : null}
          <View style={styles.inlineAdd}>
            <View style={styles.inlineInput}>
              <TextField
                value={newSubtask}
                onChangeText={setNewSubtask}
                placeholder="Add a subtask…"
                accessibilityLabel="New subtask"
                onSubmitEditing={() => void addSubtask()}
              />
            </View>
            <Button
              title="Add"
              accessibilityLabel="Add subtask"
              onPress={() => void addSubtask()}
              loading={checklistM.add.isPending}
              disabled={!newSubtask.trim()}
              style={styles.inlineBtn}
            />
          </View>
        </View>

        {/* Assignees */}
        <View style={styles.section}>
          <SectionTitle>Assignees</SectionTitle>
          {assignees.length === 0 ? (
            <Text style={styles.muted}>Unassigned.</Text>
          ) : (
            <View style={styles.pills}>
              {assignees.map((a) => (
                <Pressable
                  key={a.id}
                  onPress={() => void run(unassign.mutateAsync(a.id), 'Could not remove the assignee.')}
                  disabled={unassign.isPending}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${displayName(a)}`}
                  accessibilityState={{ disabled: unassign.isPending }}
                  style={styles.assignee}
                >
                  <Text style={styles.assigneeText}>{displayName(a)}</Text>
                  <Text style={styles.assigneeX}>  ×</Text>
                </Pressable>
              ))}
            </View>
          )}
          {membersQ.isLoading ? (
            <Text style={styles.muted}>Loading members…</Text>
          ) : addableMembers.length > 0 ? (
            <>
              <Text style={styles.addLabel}>Add someone</Text>
              <View style={styles.chips}>
                {addableMembers.map((m) => (
                  <Pressable
                    key={m.id}
                    onPress={() => void run(assign.mutateAsync(keyed({ userIds: [m.id] })), 'Could not assign this person.')}
                    disabled={assign.isPending}
                    accessibilityRole="button"
                    accessibilityLabel={`Assign ${displayName(m)}`}
                    accessibilityState={{ disabled: assign.isPending }}
                    style={styles.chip}
                  >
                    <Text style={styles.chipText}>+ {displayName(m)}</Text>
                  </Pressable>
                ))}
              </View>
            </>
          ) : assignees.length > 0 ? (
            <Text style={styles.muted}>Everyone on the project is assigned.</Text>
          ) : null}
        </View>

        <View style={styles.section}>
          <SectionTitle>Progress · {task.progress}%</SectionTitle>
          <View style={styles.progressBar} importantForAccessibility="no-hide-descendants">
            <View style={[styles.progressFill, { width: `${task.progress}%` }]} />
          </View>
          <View style={styles.progressBtns}>
            <Button title="−25%" accessibilityLabel="Decrease progress by 25 percent" variant="secondary" onPress={() => setProgress(task.progress - 25)} style={styles.pBtn} />
            <Button title="+25%" accessibilityLabel="Increase progress by 25 percent" variant="secondary" onPress={() => setProgress(task.progress + 25)} style={styles.pBtn} />
            <Button title="Complete" accessibilityLabel="Mark progress complete" onPress={() => setProgress(100)} style={styles.pBtn} />
          </View>
        </View>

        <View style={styles.section}>
          <SectionTitle>Move to column</SectionTitle>
          <View style={styles.colWrap} accessibilityRole="radiogroup">
            {columns.map((col) => {
              const active = col.id === task.columnId;
              return (
                <Pressable
                  key={col.id}
                  disabled={active || move.isPending}
                  onPress={() => void run(move.mutateAsync({ id: task.id, columnId: col.id }), 'Could not move the task.')}
                  accessibilityRole="radio"
                  accessibilityLabel={active ? `${col.name}, current column` : `Move to ${col.name}`}
                  accessibilityState={{ selected: active, checked: active, disabled: active || move.isPending }}
                  style={[styles.colChip, active && styles.colChipActive]}
                >
                  <View style={[styles.dot, { backgroundColor: categoryColorOf(c, col.category) }]} />
                  <Text style={[styles.colChipText, active && styles.colChipTextActive]}>{col.name}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* Comments */}
        <View style={styles.section}>
          <SectionTitle>Comments{comments.length > 0 ? ` · ${comments.length}` : ''}</SectionTitle>
          {commentsQ.isError && !commentsQ.data ? (
            <ErrorNote message="Could not load the comments." onRetry={() => void commentsQ.refetch()} retrying={commentsQ.isRefetching} />
          ) : comments.length === 0 && pendingComments.length === 0 ? (
            <Text style={styles.muted}>No comments yet.</Text>
          ) : (
            comments.map((cm) => (
              <View key={cm.id} style={styles.comment}>
                <Text style={styles.commentBody}>{cm.body}</Text>
                <Text style={styles.commentMeta}>{new Date(cm.createdAt).toLocaleString()}{cm.editedAt ? ' · edited' : ''}</Text>
              </View>
            ))
          )}
          {pendingComments.map((m) => (
            <View key={m.id} style={[styles.comment, styles.commentPending]} accessibilityLabel={`Sending when online: ${(m.payload as { body?: string }).body ?? ''}`}>
              <Text style={styles.commentBody}>{(m.payload as { body?: string }).body}</Text>
              <Text style={styles.commentMeta}>Sending when you’re back online…</Text>
            </View>
          ))}
          {commentErr ? <ErrorNote message={commentErr} /> : null}
          <View style={styles.inlineAdd}>
            <View style={styles.inlineInput}>
              <TextField
                value={newComment}
                onChangeText={(v) => {
                  setNewComment(v);
                  if (commentErr) setCommentErr(null);
                }}
                placeholder="Write a comment… use @name to mention"
                accessibilityLabel="New comment"
                multiline
              />
            </View>
            <Button
              title="Send"
              accessibilityLabel="Send comment"
              onPress={() => void sendComment()}
              loading={commentM.add.isPending}
              disabled={!newComment.trim()}
              style={styles.inlineBtn}
            />
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: c.ground },
    scroll: { padding: spacing.lg, gap: spacing.md },
    key: { fontSize: fontSize.xs, fontWeight: '700', color: c.brand, letterSpacing: 1 },
    title: { fontSize: fontSize.xl, fontWeight: '800', color: c.ink },
    pills: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    recurrence: { fontSize: fontSize.sm, color: c.brand, fontWeight: '600' },
    desc: { fontSize: fontSize.md, color: c.ink, lineHeight: 22 },
    muted: { fontSize: fontSize.sm, color: c.ink2 },
    link: { fontSize: fontSize.sm, fontWeight: '700', color: c.brand },
    section: { gap: spacing.sm },
    rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    row: { flexDirection: 'row', gap: spacing.sm },
    rowItem: { flex: 1 },
    multiline: { minHeight: 76, paddingTop: spacing.sm, textAlignVertical: 'top' },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    chip: {
      borderWidth: 1,
      borderColor: c.line,
      borderRadius: radius.pill,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    chipActive: { borderColor: c.brand, backgroundColor: c.brandWash },
    chipText: { fontSize: fontSize.sm, color: c.ink, fontWeight: '600' },
    chipTextActive: { color: c.brand },
    addLabel: { fontSize: fontSize.xs, color: c.ink3, marginTop: spacing.xs },
    assignee: {
      flexDirection: 'row',
      alignItems: 'center',
      borderRadius: radius.pill,
      backgroundColor: c.brandWash,
      borderWidth: 1,
      borderColor: c.brand,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    assigneeText: { fontSize: fontSize.sm, color: c.brand, fontWeight: '700' },
    assigneeX: { fontSize: fontSize.sm, color: c.brand, fontWeight: '700' },
    editActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
    subtaskRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xs },
    checkbox: {
      width: 20,
      height: 20,
      borderRadius: 6,
      borderWidth: 1.5,
      borderColor: c.line,
      alignItems: 'center',
      justifyContent: 'center',
    },
    checkboxOn: { borderColor: c.brand, backgroundColor: c.brand },
    checkboxTick: { color: c.onBrand, fontSize: 13, fontWeight: '900', lineHeight: 15 },
    subtaskText: { flex: 1, fontSize: fontSize.md, color: c.ink },
    subtaskDone: { color: c.ink3, textDecorationLine: 'line-through' },
    removeX: { fontSize: fontSize.lg, color: c.ink3, paddingHorizontal: spacing.xs },
    inlineAdd: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, marginTop: spacing.xs },
    inlineInput: { flex: 1, marginBottom: 0 },
    inlineBtn: { paddingHorizontal: spacing.lg },
    comment: { backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.xs },
    commentPending: { opacity: 0.7, borderStyle: 'dashed' },
    commentBody: { fontSize: fontSize.md, color: c.ink },
    commentMeta: { fontSize: fontSize.xs, color: c.ink3, marginTop: spacing.xs },
    progressBar: { height: 10, backgroundColor: c.line, borderRadius: radius.pill, overflow: 'hidden' },
    progressFill: { height: 10, backgroundColor: c.category.DONE },
    progressBtns: { flexDirection: 'row', gap: spacing.sm },
    pBtn: { flex: 1 },
    colWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    colChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
      borderWidth: 1,
      borderColor: c.line,
      borderRadius: radius.pill,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      backgroundColor: c.surface,
    },
    colChipActive: { borderColor: c.brand, backgroundColor: c.brandWash },
    colChipText: { fontSize: fontSize.sm, color: c.ink, fontWeight: '600' },
    colChipTextActive: { color: c.brand },
    dot: { width: 8, height: 8, borderRadius: 4 },
  });
