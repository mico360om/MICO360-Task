import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { View, Text, StyleSheet, Alert, Pressable, Platform, ToastAndroid, AccessibilityInfo, type ScrollView, type TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as DocumentPicker from 'expo-document-picker';
import { useQueryClient } from '@tanstack/react-query';
import { useDirectory, useProjectColumns, useProjectMembers, useProjects } from '../core/queries';
import { useDatePreferences } from '../core/calendar-queries';
import { useLastProject, useSendNewTask } from '../core/new-task';
import { useColors } from '../core/theme';
import { pickedFiles } from '../adapters/picked-files';
import { Button, ErrorNote, TextField } from '../components/ui';
import { KeyboardAwareScrollView } from '../components/KeyboardAware';
import { RecurrenceEditor } from '../components/RecurrenceEditor';
import { CheckRow, ChipChoice, FieldLabel, InlinePicker } from '../components/meeting/sheet-kit';
import { DescribeTask } from '../components/task-form/DescribeTask';
import { AssigneeField } from '../components/task-form/AssigneeField';
import { DueDateField } from '../components/task-form/DueDateField';
import { FilesField } from '../components/task-form/FilesField';
import { companyTodayKey, dateZones, subscribeTimeZone } from '../lib/due-date';
import { weekStartOf } from '../lib/calendar';
import { PRIORITY_LABEL } from '../lib/calendar-model';
import { progressWorthShowing } from '../lib/chat-ui';
import { newIdempotencyKey } from '../lib/idempotency';
import { refresh } from '../lib/refresh';
import { createdTaskRefreshes } from '../lib/task-cache';
import { taskSuggestions, type AiTaskDraft, type DescribedFields } from '../lib/task-describe';
import {
  assignablePeople,
  assigneeNote,
  checkNewTask,
  createdWithoutFilesText,
  DESCRIPTION_MAX,
  formColumns,
  isDraftDirty,
  leaveWarning,
  NEW_TASK_TEXT,
  newTaskDraft,
  openProjectsOf,
  pickColumn,
  prunedAssignees,
  scheduleText,
  START_OVER,
  startProjectId,
  submitLabel,
  TITLE_MAX,
  untilProblem,
  withPickedFiles,
  type FormProject,
  type NewTaskFile,
  type TaskDraft,
} from '../lib/task-form';
import { spacing, radius, fontSize, type Palette } from '../lib/theme';
import { displayName, type ApiTask, type Priority } from '../lib/types';
import type { AppScreenProps } from '../navigation/types';

const PRIORITIES: Priority[] = ['LOW', 'NORMAL', 'HIGH', 'URGENT'];

/** A short notice that stays after the form has closed (Android's own toast; TalkBack reads it). */
function notice(text: string) {
  if (Platform.OS === 'android') ToastAndroid.show(text, ToastAndroid.LONG);
  else Alert.alert(text);
}

/**
 * New task (4a) — the website's New task form: where it goes (project and column), what it is,
 * when and how urgent (priority, due date, repeat), who does it, whether it is a milestone, and
 * files attached once it exists. "Describe it in plain English" fills the form from a sentence
 * (reviewed first). Opened from a board's column (its project fixed, that column), the calendar (a
 * day), a project, My Tasks.
 *
 * Without a connection a task without files is kept on this phone and sent later (it shows as
 * waiting in the sync list; the same key, so never twice). Files need a connection: a task with
 * files that got no answer may be on the server, so the form keeps its key and locks until it is
 * finished or started over.
 */
export function NewTaskScreen({ route, navigation }: AppScreenProps<'NewTask'>) {
  const params = route.params ?? {};
  const fixedProjectId = params.projectId ?? '';
  const c = useColors();
  const s = useMemo(() => makeStyles(c), [c]);
  const qc = useQueryClient();
  // Company time: the due date is a company calendar day, and "today" for Describe is the company's.
  const timeZone = useSyncExternalStore(subscribeTimeZone, dateZones, dateZones).company;
  const today = companyTodayKey(new Date(), timeZone);
  const weekStart = weekStartOf(useDatePreferences().data);

  const start = (): TaskDraft => newTaskDraft({ projectId: fixedProjectId, columnId: params.columnId, dueDate: params.dueDate });
  // `saved` is how the form opened (with what it filled in itself); `draft` is the form.
  const [saved, setSaved] = useState<TaskDraft>(start);
  const [draft, setDraft] = useState<TaskDraft>(start);
  const [placeChosen, setPlaceChosen] = useState(false);
  const [files, setFiles] = useState<NewTaskFile[]>([]);
  const fileSeq = useRef({ n: 0 });
  const [titleError, setTitleError] = useState<string | null>(null);
  const [repeatError, setRepeatError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [placeNotice, setPlaceNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // A try with files that got no answer: the key stays and the details can't change (it may be saved).
  const [locked, setLocked] = useState(false);
  // Created, but a file wasn't attached: "Done" closes.
  const [created, setCreated] = useState<ApiTask | null>(null);
  const busy = useRef(false);
  const done = useRef(false);
  const key = useRef(newIdempotencyKey());
  const titleRef = useRef<TextInput>(null);
  const scrollRef = useRef<ScrollView>(null);
  const frozen = locked || !!created || saving;

  const set = (patch: Partial<TaskDraft>) => {
    if (frozen) return;
    setDraft((d) => ({ ...d, ...patch }));
  };
  /** A value the form fills in itself (a default, data that loaded) — not a change of yours. */
  const settle = (patch: Partial<TaskDraft>) => {
    setSaved((x) => ({ ...x, ...patch }));
    setDraft((d) => ({ ...d, ...patch }));
  };

  // ── Where the task goes ──
  const projectsQ = useProjects();
  const allProjects = useMemo(() => (Array.isArray(projectsQ.data) ? (projectsQ.data as FormProject[]) : []), [projectsQ.data]);
  const openProjects = useMemo(() => openProjectsOf(allProjects), [allProjects]);
  const project = allProjects.find((p) => p.id === draft.projectId) ?? null;
  const projectFixed = !!fixedProjectId;
  const noProjects = !projectFixed && !!projectsQ.data && openProjects.length === 0;
  const [lastProject, rememberProject] = useLastProject();

  useEffect(() => {
    if (projectFixed || draft.projectId || lastProject === undefined || openProjects.length === 0) return;
    // The page's own project first, then the one used last time, then the first open project.
    const id = startProjectId({ preferred: params.defaultProjectId, last: lastProject, open: openProjects });
    if (id) settle({ projectId: id });
  }, [projectFixed, draft.projectId, lastProject, openProjects, params.defaultProjectId]);

  const columnsQ = useProjectColumns(draft.projectId);
  const columns = useMemo(() => formColumns(columnsQ.data), [columnsQ.data]);
  // After a project change, land in the same kind of column (e.g. "in progress") when it has one.
  const preferKind = useRef<string | null>(null);
  useEffect(() => {
    if (!columnsQ.data || columns.length === 0) return;
    const pick = pickColumn(columns, { current: draft.columnId, preferKind: preferKind.current, defaultColumnId: params.columnId });
    if (pick === draft.columnId) return;
    if (placeChosen) setDraft((d) => ({ ...d, columnId: pick }));
    else settle({ columnId: pick });
  }, [columnsQ.data, columns, draft.columnId]);

  // ── Who does it ──
  const membersQ = useProjectMembers(draft.projectId);
  const dirQ = useDirectory();
  const people = useMemo(() => assignablePeople(membersQ.data, dirQ.data), [membersQ.data, dirQ.data]);
  const known = useRef(new Map<string, string>());
  for (const p of people) known.current.set(p.id, p.name);
  for (const u of dirQ.data ?? []) if (!known.current.has(u.id)) known.current.set(u.id, displayName(u));
  // Someone who isn't on a newly chosen project can't work on the task there.
  const pruneFor = useRef<string | null>(null);
  useEffect(() => {
    if (!pruneFor.current || pruneFor.current !== draft.projectId || !membersQ.isSuccess || membersQ.isFetching) return;
    pruneFor.current = null;
    const r = prunedAssignees(draft.assigneeIds, people, known.current, project?.name ?? null);
    if (!r.notice) return;
    setDraft((d) => ({ ...d, assigneeIds: r.ids }));
    setPlaceNotice(r.notice);
  }, [membersQ.isSuccess, membersQ.isFetching, people, draft.projectId]);

  function chooseProject(id: string) {
    if (frozen || !id || id === draft.projectId) return;
    preferKind.current = columns.find((col) => col.id === draft.columnId)?.category ?? null;
    pruneFor.current = id;
    setPlaceNotice(null);
    setPlaceChosen(true);
    setDraft((d) => ({ ...d, projectId: id, columnId: '' }));
  }
  const ownerName = project?.ownerId ? known.current.get(project.ownerId) ?? null : null;
  const membersStatus = !draft.projectId ? null : membersQ.isLoading ? 'loading' : membersQ.isError && !membersQ.data ? 'failed' : null;

  // ── Describe it in plain English ──
  const describeProjects = useMemo(() => openProjects.map((p) => ({ id: p.id, name: p.name, code: p.code, number: p.number ?? null })), [openProjects]);
  const fields = (d: TaskDraft): DescribedFields => ({ title: d.title, description: d.description, dueDate: d.dueDate, priority: d.priority, rule: d.rule, projectId: d.projectId });
  const suggest = useCallback(
    (d: AiTaskDraft) =>
      taskSuggestions(d, { current: fields(draft), initial: fields(saved), projects: projectFixed ? undefined : describeProjects, projectChosen: placeChosen, repeatText: scheduleText }),
    [draft, saved, projectFixed, describeProjects, placeChosen],
  );
  const applyFound = ({ projectId, ...patch }: Partial<DescribedFields>) => {
    if (frozen) return;
    if (projectId) chooseProject(projectId); // its columns and people follow, as when picked by hand
    setDraft((d) => ({ ...d, ...patch }));
    if (patch.title) setTitleError(null);
  };

  // ── Files ──
  const pick = async (pictures: boolean) => {
    if (frozen) return;
    try {
      const got = await DocumentPicker.getDocumentAsync({ type: pictures ? 'image/*' : '*/*', multiple: true, copyToCacheDirectory: true });
      if (got.canceled) return;
      setFiles((f) => withPickedFiles(f, got.assets ?? [], fileSeq.current));
      setBanner(null);
    } catch {
      setBanner('Couldn’t open your files. Please try again.');
    }
  };
  const removeFile = (k: string) => {
    if (saving || created) return;
    const gone = files.find((f) => f.key === k);
    setFiles((f) => f.filter((x) => x.key !== k));
    if (gone) void pickedFiles.forget(gone.uri);
  };
  const shownFraction = useRef(new Map<string, number>());
  const patchFile = useCallback((k: string, patch: Partial<NewTaskFile>) => {
    // Progress in 5% steps (each step redraws the form).
    if (patch.fraction !== undefined && patch.error === undefined && Object.keys(patch).length === 1) {
      if (!progressWorthShowing(shownFraction.current.get(k) ?? 0, patch.fraction)) return;
      shownFraction.current.set(k, patch.fraction);
    }
    setFiles((list) => list.map((f) => (f.key === k ? { ...f, ...patch } : f)));
  }, []);
  // Files still listed when the form goes (discarded) don't stay in the phone's cache.
  const filesRef = useRef(files);
  filesRef.current = files;
  useEffect(() => () => filesRef.current.forEach((f) => void pickedFiles.forget(f.uri)), []);

  // ── Leaving ──
  const dirty = isDraftDirty(draft, saved, { placeChosen, files: files.length });
  useEffect(
    () =>
      navigation.addListener('beforeRemove', (e) => {
        if (done.current || created || (!dirty && !locked && !saving)) return;
        e.preventDefault();
        const w = leaveWarning({ saving, locked });
        Alert.alert(w.title, w.message, [
          { text: w.stay, style: 'cancel' },
          { text: w.leave, style: 'destructive', onPress: () => navigation.dispatch(e.data.action) },
        ]);
      }),
    [navigation, dirty, locked, saving, created],
  );
  const leave = () => {
    done.current = true;
    navigation.goBack();
  };

  const startOver = () =>
    Alert.alert(START_OVER.title, START_OVER.message, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: START_OVER.confirm,
        style: 'destructive',
        onPress: () => {
          key.current = newIdempotencyKey();
          setLocked(false);
          setBanner(null);
          refresh(qc, createdTaskRefreshes(draft.projectId));
        },
      },
    ]);

  // ── Creating ──
  const send = useSendNewTask();
  async function submit() {
    if (busy.current) return;
    if (created) return leave(); // the task exists already: never a second one
    const check = checkNewTask(draft, { noProjects, boardDate: params.boardDate });
    if (!check.ok) {
      if (check.field === 'title') {
        setTitleError(check.message);
        titleRef.current?.focus();
      } else if (check.field === 'repeat') setRepeatError(check.message);
      else setBanner(check.message);
      return;
    }
    busy.current = true;
    setSaving(true);
    setBanner(null);
    shownFraction.current.clear();
    try {
      const out = await send({ input: check.input, key: key.current, files, onFile: patchFile });
      const projectId = check.input.projectId;
      switch (out.kind) {
        case 'created':
          refresh(qc, createdTaskRefreshes(projectId));
          if (!projectFixed) rememberProject(projectId);
          for (const f of files) void pickedFiles.forget(f.uri);
          setFiles([]);
          AccessibilityInfo.announceForAccessibility(`Created ${out.task.key}.`);
          leave();
          return;
        case 'files-failed': {
          refresh(qc, createdTaskRefreshes(projectId));
          if (!projectFixed) rememberProject(projectId);
          const failed = new Set(out.failed.map((f) => f.key));
          for (const f of files) if (!failed.has(f.key)) void pickedFiles.forget(f.uri);
          setCreated(out.task);
          setLocked(false);
          setBanner(createdWithoutFilesText(out.failed));
          return;
        }
        case 'kept':
          // On this phone, sent when the connection is back (the sync list shows it waiting).
          if (!projectFixed) rememberProject(projectId);
          notice(out.message);
          leave();
          return;
        case 'no-answer':
          setLocked(true);
          setBanner(out.message);
          return;
        case 'refused':
          // The server keeps a refusal under its key: the next try (once fixed) is a new one.
          key.current = newIdempotencyKey();
          setLocked(false);
          setBanner(out.message);
          return;
      }
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }

  // A message about the whole form shows at its top: brought into view when it appears.
  useEffect(() => {
    if (banner) scrollRef.current?.scrollTo({ y: 0, animated: true });
  }, [banner]);

  const uploading = saving && files.some((f) => f.fraction !== undefined);
  const repeatProblem = repeatError ?? untilProblem(draft.rule, draft.dueDate);
  const projectOptions = useMemo(() => openProjects.map((p) => ({ value: p.id, label: p.name, hint: p.code })), [openProjects]);

  return (
    <SafeAreaView style={s.safe} edges={['bottom']}>
      <KeyboardAwareScrollView ref={scrollRef} contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
        {banner ? <ErrorNote message={banner} /> : null}
        {noProjects ? (
          <View style={s.note}>
            <Text style={s.noteText}>{NEW_TASK_TEXT.noProjects}</Text>
          </View>
        ) : null}
        {projectsQ.isError && !projectsQ.data ? <ErrorNote message="Couldn’t load your projects. Check your connection and try again." onRetry={() => void projectsQ.refetch()} retrying={projectsQ.isRefetching} /> : null}
        {locked ? (
          <View style={s.note}>
            <Text style={s.noteText} accessibilityLiveRegion="polite">
              🔒 {NEW_TASK_TEXT.locked}
            </Text>
            <Button title={START_OVER.label} variant="ghost" onPress={startOver} disabled={saving} accessibilityLabel="Start over: unlock the form. The task may already be created — check the board first." />
          </View>
        ) : null}

        {!noProjects && !created ? <DescribeTask timeZone={timeZone} withProject={!projectFixed} suggest={suggest} onApply={applyFound} disabled={frozen} /> : null}

        {projectFixed ? (
          <View style={s.group}>
            <FieldLabel>Project</FieldLabel>
            <View style={[s.fixed, { borderColor: c.line, backgroundColor: c.ground }]} accessible accessibilityLabel={`Project: ${project?.name ?? 'Loading…'}`}>
              <Text style={s.fixedText} numberOfLines={1}>
                {project?.name ?? 'Loading…'}
              </Text>
            </View>
          </View>
        ) : (
          <InlinePicker
            label="Project"
            options={projectOptions}
            value={draft.projectId}
            onChange={chooseProject}
            placeholder={projectsQ.isLoading ? 'Loading…' : 'Choose a project'}
            emptyText="None of your projects is open for new tasks."
            disabled={frozen || noProjects}
          />
        )}
        <View style={s.group} accessibilityRole="radiogroup" accessibilityLabel="Column">
          <FieldLabel>Column</FieldLabel>
          {columns.length === 0 ? (
            <Text style={s.hint}>{columnsQ.isLoading || !draft.projectId ? 'Loading…' : columnsQ.isError ? 'Couldn’t load this project’s columns.' : 'This project has no columns'}</Text>
          ) : (
            <View style={s.chips}>
              {columns.map((col) => {
                const on = col.id === draft.columnId;
                return (
                  <Pressable
                    key={col.id}
                    onPress={() => {
                      if (frozen) return;
                      setPlaceChosen(true);
                      set({ columnId: col.id });
                    }}
                    disabled={frozen}
                    accessibilityRole="radio"
                    accessibilityLabel={col.name}
                    accessibilityState={{ selected: on, checked: on, disabled: frozen }}
                    style={({ pressed }) => [s.chip, on && s.chipOn, pressed && s.pressed]}
                  >
                    <View style={[s.dot, { backgroundColor: col.color || c.ink3 }]} />
                    <Text style={[s.chipText, on && s.chipTextOn]}>{col.name}</Text>
                  </Pressable>
                );
              })}
            </View>
          )}
          {placeNotice ? (
            <Text style={s.hint} accessibilityLiveRegion="polite">
              {placeNotice}
            </Text>
          ) : null}
        </View>

        <TextField
          inputRef={titleRef}
          label="Task title"
          required
          value={draft.title}
          onChangeText={(title) => {
            set({ title });
            if (titleError) setTitleError(null);
          }}
          placeholder="What needs to be done?"
          maxLength={TITLE_MAX}
          error={titleError}
          editable={!frozen}
        />
        <TextField
          label="Description (optional)"
          value={draft.description}
          onChangeText={(description) => set({ description })}
          placeholder="Details, links, acceptance notes…"
          multiline
          numberOfLines={4}
          maxLength={DESCRIPTION_MAX}
          style={s.multiline}
          editable={!frozen}
        />

        <ChipChoice<Priority> label="Priority" options={PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABEL[p] }))} value={draft.priority} onChange={(priority) => set({ priority })} disabled={frozen} />
        <DueDateField
          value={draft.dueDate}
          onChange={(dueDate) => {
            set({ dueDate });
            setRepeatError(null);
          }}
          today={today}
          weekStart={weekStart}
          disabled={frozen}
        />

        <View style={s.card}>
          <FieldLabel>Repeat</FieldLabel>
          {draft.rule ? <Text style={s.summary}>🔁 {scheduleText(draft.rule, draft.dueDate)}</Text> : null}
          <RecurrenceEditor
            value={draft.rule}
            onChange={(rule) => {
              set({ rule });
              setRepeatError(null);
            }}
            dueDate={draft.dueDate || null}
            disabled={frozen}
          />
          {repeatProblem ? (
            <Text style={s.problem} accessibilityRole="alert">
              {repeatProblem}
            </Text>
          ) : null}
          {draft.rule && !draft.dueDate ? <Text style={s.hint}>{NEW_TASK_TEXT.noDueForRepeat}</Text> : null}
        </View>

        <AssigneeField
          people={people}
          value={draft.assigneeIds}
          onChange={(assigneeIds) => set({ assigneeIds })}
          note={assigneeNote(draft.assigneeIds, ownerName)}
          disabled={frozen || !draft.projectId}
          status={membersStatus}
        />

        <FilesField files={files} onPickFiles={() => void pick(false)} onPickPictures={() => void pick(true)} onRemove={removeFile} busy={saving || !!created} />

        <View style={s.card}>
          <CheckRow label="Milestone" checked={draft.milestone} onChange={(milestone) => set({ milestone })} disabled={frozen} />
          <Text style={s.hint}>{NEW_TASK_TEXT.milestoneHint}</Text>
        </View>
      </KeyboardAwareScrollView>

      <View style={s.footer}>
        {created ? (
          <Button
            title="Open the task"
            variant="ghost"
            onPress={() => {
              done.current = true;
              navigation.replace('TaskDetail', { taskId: created.id, title: created.title });
            }}
            style={s.grow}
          />
        ) : (
          <Button title="Cancel" variant="ghost" onPress={() => navigation.goBack()} disabled={saving} style={s.grow} />
        )}
        <Button title={submitLabel({ created: !!created, saving, uploading })} onPress={() => void submit()} loading={saving} disabled={noProjects} style={s.wide} />
      </View>
    </SafeAreaView>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: c.ground },
    body: { padding: spacing.lg, gap: spacing.xs, paddingBottom: spacing.xxl },
    group: { gap: spacing.xs, marginBottom: spacing.md },
    card: { gap: spacing.sm, marginBottom: spacing.md, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: radius.lg, padding: spacing.md },
    fixed: { minHeight: 48, justifyContent: 'center', borderWidth: 1, borderRadius: radius.md, paddingHorizontal: spacing.md },
    fixedText: { fontSize: fontSize.md, color: c.ink, textAlign: 'auto' },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    chip: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, minHeight: 40, borderWidth: 1, borderColor: c.line, borderRadius: radius.pill, paddingHorizontal: spacing.md, backgroundColor: c.surface },
    chipOn: { borderColor: c.brand, backgroundColor: c.brandWash },
    chipText: { fontSize: fontSize.sm, fontWeight: '600', color: c.ink },
    chipTextOn: { color: c.brand, fontWeight: '700' },
    dot: { width: 10, height: 10, borderRadius: 5 },
    pressed: { opacity: 0.7 },
    multiline: { minHeight: 96, paddingTop: spacing.sm, textAlignVertical: 'top' },
    summary: { fontSize: fontSize.sm, fontWeight: '700', color: c.ink },
    hint: { fontSize: fontSize.xs, color: c.ink2 },
    problem: { fontSize: fontSize.xs, fontWeight: '700', color: c.danger },
    note: { backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm, gap: spacing.xs },
    noteText: { fontSize: fontSize.sm, color: c.ink2 },
    footer: { flexDirection: 'row', gap: spacing.sm, padding: spacing.md, borderTopWidth: 1, borderTopColor: c.line, backgroundColor: c.surface },
    grow: { flex: 1 },
    wide: { flex: 2 },
  });
