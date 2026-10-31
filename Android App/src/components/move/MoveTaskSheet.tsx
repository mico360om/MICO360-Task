import React, { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useColors } from '../../core/theme';
import { useMovePreview, useMoveTargets, useMoveTasks } from '../../core/move-queries';
import { Button } from '../ui';
import { CardChoice, FieldLabel, InlinePicker, Sheet, SheetButtons, SheetMessage } from '../meeting/sheet-kit';
import { assigneeChoiceLabels, bulkMoveAvailability, bulkMovedText, moveAvailability, moveChanges, notOnTeamText } from '../../lib/task-move';
import { MOVE_TEXT, columnHint, failedLines, moveFailure, moveInput, moveSubtitle, moveTitle, previewProblem, refusedLines, sheetTasks, submitLabel, type MoveTaskRef } from '../../lib/move-sheet';
import { STATUS_NAME } from '../../lib/all-board';
import { appTimeZone, companyTodayKey } from '../../lib/due-date';
import { spacing, type Palette } from '../../lib/theme';
import { typeStyle } from '../../lib/typography';
import type { AssigneeChoice, BulkMoveResult, ColumnCategory, MoveResult } from '../../lib/types';

const statusLabel = (category: string): string => STATUS_NAME[category as ColumnCategory] ?? category;

/**
 * "Move to another project" (the website's MoveTaskDialog), one sheet for one task or several: the
 * project (only ones the person may move to: not this one, not completed or archived), the column
 * (the same kind of column as now, changeable), what will change, and ONE question for the whole group
 * when people assigned aren't on the new team — required. Online only: the move goes now or says why
 * not. A bulk move with failures turns the sheet into its result until Done.
 */
export function MoveTaskSheet({
  tasks: given,
  visible,
  onClose,
  onMoved,
  onBulkMoved,
}: {
  tasks: MoveTaskRef[];
  visible: boolean;
  onClose(): void;
  /** One task moved: what happened (the caller closes the sheet and says so). */
  onMoved?(r: MoveResult): void;
  /** Several: what happened to each. All moved: the caller closes the sheet; otherwise it shows the ones that couldn't be. */
  onBulkMoved?(r: BulkMoveResult, projectName: string): void;
}) {
  const c = useColors();
  const s = useMemo(() => makeStyles(c), [c]);
  // The caller lets go of the tasks as it closes the sheet: it slides away still showing them.
  const held = useRef<MoveTaskRef[]>(given);
  if (given.length > 0) held.current = given;
  const tasks = sheetTasks(given, held.current);
  const single = tasks.length === 1;
  const ids = useMemo(() => tasks.map((t) => t.id), [tasks]);
  const today = companyTodayKey(new Date(), appTimeZone());
  const [projectId, setProjectId] = useState('');
  // The column chosen; '' = the suggestion (one task) or each task's own kind of column (several).
  const [columnId, setColumnId] = useState('');
  const [choice, setChoice] = useState<AssigneeChoice | ''>('');
  const [choiceError, setChoiceError] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<BulkMoveResult | null>(null);
  const [busy, setBusy] = useState(false);
  // Each time it opens: from the start.
  useEffect(() => {
    if (!visible) return;
    setProjectId('');
    setColumnId('');
    setChoice('');
    setChoiceError(false);
    setError(null);
    setOutcome(null);
  }, [visible]);

  const targets = useMoveTargets(visible);
  // Its own project isn't offered (for several tasks, only when they are all in one project).
  const ownProject = tasks.every((t) => t.projectId === tasks[0]?.projectId) ? tasks[0]?.projectId : undefined;
  const projectOptions = useMemo(() => (targets?.projects ?? []).filter((p) => p.id !== ownProject).map((p) => ({ value: p.id, label: p.name, hint: p.code })), [targets, ownProject]);
  const nowhere = targets !== undefined && projectOptions.length === 0;
  const nowhereReason = single ? moveAvailability(tasks[0]?.projectId ?? '', targets, undefined).reason : bulkMoveAvailability(targets).reason;

  const previewQ = useMovePreview(ids, visible ? projectId : '');
  const preview = projectId ? previewQ.data : undefined;
  const movable = preview?.tasks.filter((t) => t.canMove) ?? [];
  const refused = preview?.tasks.filter((t) => !t.canMove) ?? [];
  const suggested = single ? (movable[0]?.columnId ?? '') : '';
  const chosenColumn = columnId || suggested;
  // What will change, for the column chosen (one task: the suggestion until another is picked).
  const changes = preview ? moveChanges(preview, today, single ? chosenColumn : columnId) : [];
  const hint = preview ? columnHint({ single, preview, columnId, statusLabel }) : null;
  const labels = preview ? assigneeChoiceLabels(preview.outsiders) : null;
  const moves = useMoveTasks();

  function chooseProject(next: string) {
    setProjectId(next);
    setColumnId('');
    setChoice('');
    setChoiceError(false);
    setError(null);
  }

  async function submit() {
    if (!preview || movable.length === 0 || busy) return;
    const input = moveInput({ projectId, columnId: chosenColumn, choice: choice || null, outsiders: preview.outsiders.length });
    if ('problem' in input) {
      setChoiceError(true);
      return;
    }
    setError(null);
    setBusy(true);
    try {
      if (single) {
        onMoved?.(await moves.moveOne(ids[0]!, input));
      } else {
        const result = await moves.moveMany(movable.map((t) => t.id), input);
        if (result.failed > 0) setOutcome(result);
        onBulkMoved?.(result, preview.project.name);
      }
    } catch (e) {
      const failure = moveFailure(e, !single);
      setError(failure.message);
      // Someone assigned left the new team since the preview: read it again, so the question shows.
      if (failure.rerunPreview) {
        setChoice('');
        void previewQ.refetch();
      }
    } finally {
      setBusy(false);
    }
  }

  const lines = (items: string[]) =>
    items.map((line) => (
      <View key={line} style={s.line}>
        <View style={s.dot} />
        <Text style={s.lineText}>{line}</Text>
      </View>
    ));

  if (outcome) {
    return (
      <Sheet visible={visible} title={moveTitle(tasks.length)} subtitle={moveSubtitle(tasks)} onClose={onClose} footer={<Button title={MOVE_TEXT.done} onPress={onClose} style={s.flex} />}>
        <SheetMessage tone="info" text={bulkMovedText(outcome, preview?.project.name ?? '')} />
        <FieldLabel>{MOVE_TEXT.notMoved}</FieldLabel>
        {lines(failedLines(outcome, preview, tasks))}
      </Sheet>
    );
  }

  return (
    <Sheet
      visible={visible}
      title={moveTitle(tasks.length)}
      subtitle={moveSubtitle(tasks)}
      onClose={busy ? () => {} : onClose}
      footer={
        <View style={s.footer}>
          {choiceError ? <SheetMessage text={MOVE_TEXT.chooseTeam} /> : null}
          <View style={s.footerRow}>
            <SheetButtons
              onCancel={onClose}
              confirm={submitLabel({ single, movable: movable.length || tasks.length, busy })}
              onConfirm={() => void submit()}
              busy={busy}
              disabled={!preview || movable.length === 0}
            />
          </View>
        </View>
      }
    >
      <SheetMessage text={error} />
      <InlinePicker
        label={MOVE_TEXT.project}
        options={projectOptions}
        value={projectId}
        onChange={chooseProject}
        placeholder={MOVE_TEXT.projectPlaceholder}
        emptyText={targets === undefined ? MOVE_TEXT.loading : MOVE_TEXT.noProjects}
        disabled={busy}
      />
      {nowhere && nowhereReason ? <Text style={s.hint}>{nowhereReason}</Text> : null}
      {projectId && previewQ.isLoading ? (
        <Text style={s.hint} accessibilityLiveRegion="polite">
          {MOVE_TEXT.checking}
        </Text>
      ) : null}
      {projectId && previewQ.isError ? <SheetMessage text={previewProblem(previewQ.error)} /> : null}
      {preview && single && refused[0] ? <SheetMessage tone="info" text={refused[0].reason} /> : null}

      {preview && movable.length > 0 ? (
        <>
          <InlinePicker
            label={MOVE_TEXT.column}
            options={[...(single ? [] : [{ value: '', label: MOVE_TEXT.sameKind }]), ...preview.columns.map((col) => ({ value: col.id, label: col.name, hint: statusLabel(col.category) }))]}
            value={single ? chosenColumn : columnId}
            onChange={setColumnId}
            placeholder={MOVE_TEXT.sameKind}
            disabled={busy}
          />
          {hint ? <Text style={s.hint}>{hint}</Text> : null}

          {preview.outsiders.length > 0 && labels ? (
            <>
              {/* One question for the whole group (the website's): the CardChoice's hint has no words of its own. */}
              <CardChoice<AssigneeChoice | ''>
                legend={notOnTeamText(preview.outsiders, preview.project.name)}
                options={[
                  { value: 'ADD_TO_TEAM', label: labels.add, hint: '' },
                  { value: 'UNASSIGN', label: labels.unassign, hint: '' },
                ]}
                value={choice}
                onChange={(v) => {
                  setChoice(v);
                  setChoiceError(false);
                }}
              />
              {/* No answer when Move is tapped: said by the buttons (final review A5), never scrolled out of view. */}
            </>
          ) : null}

          <FieldLabel>{MOVE_TEXT.changes}</FieldLabel>
          {lines(changes)}
        </>
      ) : null}

      {preview && !single && refused.length > 0 ? (
        <>
          <FieldLabel>{MOVE_TEXT.cantMove}</FieldLabel>
          {lines(refusedLines(preview))}
        </>
      ) : null}
    </Sheet>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    flex: { flex: 1 },
    footer: { flex: 1, gap: spacing.xs },
    footerRow: { flexDirection: 'row', gap: spacing.sm },
    hint: { ...typeStyle('caption'), color: c.ink2, marginBottom: spacing.sm },
    line: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, marginBottom: spacing.xs },
    dot: { width: 5, height: 5, borderRadius: 3, backgroundColor: c.ink2, marginTop: 7 },
    lineText: { flex: 1, ...typeStyle('body'), color: c.ink },
  });
