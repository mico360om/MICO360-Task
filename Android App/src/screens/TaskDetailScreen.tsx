import React, { useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, RefreshControl, Alert, Linking, useWindowDimensions } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  keyed,
  useTask,
  useProjectColumns,
  useProjectTasks,
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
  useTaskMentionable,
  useCommentMutations,
  useTaskAttachments,
  useAttachmentMutations,
  useTaskActivity,
  useTaskDependencies,
  useDependencyMutations,
  useTaskWatch,
  useDeleteTask,
  useDirectory,
} from '../core/queries';
import { useMyQueuedChanges, useServices, useSession } from '../core/providers';
import { useColors } from '../core/theme';
import { Loader, ErrorNote, Button } from '../components/ui';
import { isNetworkError } from '../lib/api-client';
import { inSeries, isEarlierCopy } from '../lib/recurrence-edit';
import type { MentionPerson } from '../lib/mentions';
import { attachmentHref, canRemoveAttachment, uploadErrorMessage, uploadPart, type ApiAttachment } from '../lib/attachments';
import { spacing, fontSize, type Palette } from '../lib/theme';
import { taskExportPath, taskFileName } from '../lib/reports';
import { activityFeed, blockerRefs, canDeleteTask, dueState, meetingLine, taskLoadProblem } from '../lib/task-detail';
import type { AppScreenProps } from '../navigation/types';
import { displayName } from '../lib/types';
import { HeaderCard } from '../components/task-detail/HeaderCard';
import { DetailsCard, type TaskPatch } from '../components/task-detail/DetailsCard';
import { ChecklistCard, CommentsCard, DescriptionCard, type CommentView } from '../components/task-detail/WorkCards';
import { ActivityCard, BlockersCard, FilesCard, type UploadView } from '../components/task-detail/InfoCards';
import { failureText } from '../components/task-detail/kit';
import { KeyboardAwareScrollView } from '../components/KeyboardAware';

/** At this width and up (tablets, landscape) the details sit beside the work in a second column. */
const TWO_COLUMNS_FROM = 720;

/**
 * Task details: header (reference, status, priority, due date, title, ⋯ menu), the description,
 * properties, checklist, files, blockers, comments and activity — each edited in place with its own
 * saving / saved / error state. Edits made offline are kept and synced where the app allows it.
 */
export function TaskDetailScreen({ route, navigation }: AppScreenProps<'TaskDetail'>) {
  const { taskId } = route.params;
  const c = useColors();
  const styles = useMemo(() => makeStyles(c), [c]);
  const { width } = useWindowDimensions();
  const wide = width >= TWO_COLUMNS_FROM;

  const taskQ = useTask(taskId);
  const task = taskQ.data;
  const projectId = task?.projectId ?? '';
  const columnsQ = useProjectColumns(projectId);
  const projectTasksQ = useProjectTasks(projectId);
  const move = useMoveTask(projectId);
  const update = useUpdateTask(taskId);
  const tagsQ = useTaskTags(taskId);
  const setTags = useSetTaskTags(taskId);
  const assigneesQ = useTaskAssignees(taskId);
  const membersQ = useProjectMembers(projectId);
  const assign = useAssignUsers(taskId);
  const unassign = useUnassignUser(taskId);
  const checklistQ = useTaskChecklist(taskId);
  const checklistM = useChecklistMutations(taskId);
  const commentsQ = useTaskComments(taskId);
  const commentM = useCommentMutations(taskId);
  const mentionableQ = useTaskMentionable(taskId);
  const attachmentsQ = useTaskAttachments(taskId);
  const attachM = useAttachmentMutations(taskId);
  const activityQ = useTaskActivity(taskId);
  const depsQ = useTaskDependencies(taskId);
  const depM = useDependencyMutations(taskId);
  const watch = useTaskWatch(taskId);
  const deleteTask = useDeleteTask(taskId);
  const directoryQ = useDirectory();
  const queued = useMyQueuedChanges();
  const { baseUrl, exporter, resources } = useServices();
  const session = useSession();

  const [scope, setScope] = useState<'one' | 'series'>('one');
  const [exporting, setExporting] = useState<'xlsx' | 'pdf' | null>(null);
  const [uploads, setUploads] = useState<UploadView[]>([]);
  const uploadSeq = useRef(0);

  const mentionPeople = useMemo<MentionPerson[]>(
    () =>
      (mentionableQ.data ?? []).map((p) => ({
        id: p.id,
        username: p.username,
        name: displayName({ firstName: p.firstName ?? undefined, lastName: p.lastName ?? undefined, username: p.username }),
        avatarUrl: p.avatarUrl,
      })),
    [mentionableQ.data],
  );
  const nameOf = (userId: string) => {
    const u = (directoryQ.data ?? []).find((d) => d.id === userId);
    return u ? displayName(u) : 'Someone';
  };

  if (taskQ.isLoading) return <Loader />;
  if (taskQ.isError || !task) {
    const problem = taskLoadProblem(taskQ.error);
    return <ErrorNote message={problem.message} onRetry={problem.canRetry ? () => void taskQ.refetch() : undefined} retrying={taskQ.isRefetching} />;
  }

  const columns = (columnsQ.data ?? []).filter((col) => col.enabled);
  const projectTasks = projectTasksQ.data ?? [];
  const current = columns.find((col) => col.id === task.columnId);
  const due = dueState(task);
  const myId = session?.user.id ?? null;
  const myRoles = session?.user.roles ?? [];
  const isAdmin = myRoles.includes('ADMIN');
  const members = membersQ.data ?? [];
  const series = inSeries(task);
  const checklist = checklistQ.data;
  const deps = depsQ.data ?? { blockedBy: [], blocks: [] };

  /** Save a field edit; `withScope` applies "entire series" when chosen (title, description, priority, estimate). */
  const patch = (p: TaskPatch, withScope = false) =>
    update.mutateAsync({ ...p, ...(withScope && series && scope === 'series' ? { scope: 'series' as const } : {}) });

  async function exportTask(format: 'xlsx' | 'pdf') {
    if (!task) return;
    setExporting(format);
    try {
      await exporter.exportFile(taskExportPath(task.id, format), taskFileName(task, format), task.key);
    } catch (e) {
      Alert.alert('Export failed', isNetworkError(e) ? 'Exports need a connection — check your connection and try again.' : 'Couldn’t export the task. Please try again.');
    } finally {
      setExporting(null);
    }
  }

  /** Pick one or more files and upload each, showing its progress. */
  async function pickAndUpload() {
    const picked = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: true });
    if (picked.canceled) return;
    for (const asset of picked.assets ?? []) {
      const key = `u${++uploadSeq.current}`;
      setUploads((u) => [...u, { key, name: asset.name, fraction: 0 }]);
      const set = (patchUpload: Partial<UploadView>) => setUploads((u) => u.map((x) => (x.key === key ? { ...x, ...patchUpload } : x)));
      attachM.upload
        .mutateAsync({ part: uploadPart({ uri: asset.uri, name: asset.name, mimeType: asset.mimeType }), onProgress: (fraction) => set({ fraction }) })
        .then(
          () => setUploads((u) => u.filter((x) => x.key !== key)),
          (e) => set({ error: isNetworkError(e) ? 'You’re offline — files can be attached when you’re connected.' : uploadErrorMessage(e) }),
        );
    }
  }

  /** The meeting the task came from opens on the website (the app has no meetings screen). */
  async function openMeeting(href: string) {
    try {
      await Linking.openURL(href);
    } catch {
      Alert.alert('Couldn’t open the meeting', 'Open it from Meetings on the website.');
    }
  }

  async function openFile(a: ApiAttachment) {
    try {
      await Linking.openURL(attachmentHref(baseUrl, a.url));
    } catch {
      Alert.alert('Couldn’t open the file', a.filename);
    }
  }

  function confirmDelete() {
    const run = (scopeChoice?: 'series') =>
      deleteTask.mutateAsync(scopeChoice).then(
        () => navigation.goBack(),
        (e) => Alert.alert('Couldn’t delete the task', failureText(e, 'Please try again.')),
      );
    if (series) {
      Alert.alert('Delete this recurring task?', 'Delete just this occurrence, or the entire series?', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'This occurrence', style: 'destructive', onPress: () => void run() },
        { text: 'Entire series', style: 'destructive', onPress: () => void run('series') },
      ]);
    } else {
      Alert.alert('Delete this task?', 'This can’t be undone.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => void run() },
      ]);
    }
  }

  const comments: CommentView[] = (commentsQ.data ?? []).map((cm) => ({
    id: cm.id,
    body: cm.body,
    authorName: nameOf(cm.userId),
    createdAt: cm.createdAt,
    edited: Boolean(cm.editedAt),
    mine: cm.userId === myId,
    canDelete: cm.userId === myId || isAdmin,
  }));
  // Comments written offline for this task, waiting to sync (shown as "Sending…").
  const pendingComments = queued.pending
    .filter((m) => m.kind === 'comment.add' && (m.payload as { id?: string } | null)?.id === taskId)
    .map((m) => (m.payload as { body?: string }).body ?? '');

  const description = (
    <DescriptionCard description={task.description} onSave={(text) => patch({ description: text }, true)} />
  );
  const details = (
    <DetailsCard
      task={task}
      columns={columns}
      inSeries={series}
      earlierCopy={isEarlierCopy(task)}
      scope={scope}
      onScope={setScope}
      overdue={due.overdue}
      onMove={(columnId) => move.mutateAsync({ id: task.id, columnId })}
      onPatch={patch}
      onSuggestPriority={() => resources.ai.suggestPriority(task.title, task.description ?? undefined, task.dueDate)}
      assignees={assigneesQ.data ?? []}
      members={members}
      onAssign={(userId) => assign.mutateAsync(keyed({ userIds: [userId] }))}
      onUnassign={(userId) => unassign.mutateAsync(userId)}
      tags={tagsQ.data ?? []}
      onSaveTags={(names) => setTags.mutateAsync(names)}
    />
  );
  const checklistCard = (
    <ChecklistCard
      items={checklist?.items ?? []}
      onToggle={(id, done) => checklistM.update.mutateAsync({ itemId: id, patch: { done } })}
      onAdd={(text) => checklistM.add.mutateAsync(keyed({ text }))}
      onRename={(id, text) => checklistM.update.mutateAsync({ itemId: id, patch: { text } })}
      onRemove={(id) => checklistM.remove.mutateAsync(id)}
      onReorder={(ids) => checklistM.reorder.mutateAsync(ids)}
      onSuggest={() => resources.ai.breakdown(task.title, task.description ?? undefined)}
    />
  );
  const files = (
    <FilesCard
      files={attachmentsQ.data ?? []}
      uploads={uploads}
      hrefOf={(a) => attachmentHref(baseUrl, a.url)}
      canDelete={(a) => canRemoveAttachment(a, myId, myRoles)}
      onOpen={(a) => void openFile(a)}
      onDelete={(a) => attachM.remove.mutateAsync(a.id)}
      onPick={() => void pickAndUpload()}
      onDismissUpload={(key) => setUploads((u) => u.filter((x) => x.key !== key))}
      unavailable={attachmentsQ.isError}
    />
  );
  const blockers = (
    <BlockersCard
      taskId={task.id}
      blockedBy={blockerRefs(deps.blockedBy, projectTasks, columns)}
      blocks={blockerRefs(deps.blocks, projectTasks, columns)}
      candidates={blockerRefs(projectTasks.map((t) => t.id), projectTasks, columns)}
      onAdd={(id) => depM.add.mutateAsync(id)}
      onRemove={(id) => depM.remove.mutateAsync(id)}
    />
  );
  const commentsCard = (
    <CommentsCard
      comments={comments}
      pending={pendingComments}
      people={mentionPeople}
      onAdd={(body) => commentM.add.mutateAsync(keyed({ body }))}
      onEdit={(id, body) => commentM.edit.mutateAsync({ commentId: id, body })}
      onDelete={(id) => commentM.remove.mutateAsync(id)}
    />
  );
  const activity = <ActivityCard entries={activityFeed(activityQ.data ?? [], nameOf)} />;
  const refreshAll = () => {
    void taskQ.refetch();
    void checklistQ.refetch();
    void commentsQ.refetch();
    void attachmentsQ.refetch();
    void activityQ.refetch();
    void depsQ.refetch();
    void assigneesQ.refetch();
  };

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      {/* Typing in a field (or a comment) keeps it and its buttons above the keyboard. */}
      <KeyboardAwareScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={taskQ.isRefetching} onRefresh={refreshAll} />}
      >
        <HeaderCard
          task={task}
          statusName={current?.name}
          statusCategory={current?.category}
          due={due}
          onSaveTitle={(title) => patch({ title }, true)}
          watching={Boolean(watch.status.data)}
          watcherCount={watch.watchers.data?.length ?? 0}
          onToggleWatch={() => watch.toggle.mutateAsync().catch((e) => Alert.alert('Couldn’t change watching', failureText(e, 'Please try again.')))}
          onExport={(format) => void exportTask(format)}
          exporting={exporting}
          meeting={meetingLine(task.meeting, baseUrl)}
          onOpenMeeting={(href) => void openMeeting(href)}
        />
        {wide ? (
          <View style={styles.columns}>
            <View style={styles.main}>
              {description}
              {checklistCard}
              {commentsCard}
              {activity}
            </View>
            <View style={styles.side}>
              {details}
              {files}
              {blockers}
            </View>
          </View>
        ) : (
          <>
            {description}
            {details}
            {checklistCard}
            {files}
            {blockers}
            {commentsCard}
            {activity}
          </>
        )}
        {canDeleteTask(session?.user ?? null, members) ? (
          <View style={styles.danger}>
            <Text style={styles.dangerNote}>Deleting a task removes its checklist, comments and files.</Text>
            <Button title="Delete task" variant="ghost" onPress={confirmDelete} loading={deleteTask.isPending} accessibilityLabel="Delete task" />
          </View>
        ) : null}
      </KeyboardAwareScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: c.ground },
    scroll: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xxl },
    columns: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
    main: { flex: 3, gap: spacing.md },
    side: { flex: 2, gap: spacing.md },
    danger: { marginTop: spacing.md, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: c.line, gap: spacing.xs },
    dangerNote: { fontSize: fontSize.xs, color: c.ink3 },
  });
