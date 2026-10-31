import React, { useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { useServices } from '../../core/providers';
import { useColors } from '../../core/theme';
import { useInspectionForms } from '../../core/inspection-queries';
import { useDirectory, useProjectMembers } from '../../core/queries';
import { useDatePreferences } from '../../core/calendar-queries';
import { ApiError } from '../../lib/api-client';
import { weekStartOf } from '../../lib/calendar';
import { companyTodayKey } from '../../lib/due-date';
import { newIdempotencyKey } from '../../lib/idempotency';
import { INSPECTION_LIMITS } from '../../lib/inspection-rules';
import { SCHEDULE_PRESETS, scheduleSentence, type SchedulePreset } from '../../lib/inspection-schedule';
import {
  NO_COLUMNS,
  SCHEDULE_WORDS as W,
  checkSchedule,
  checksColumn,
  editScheduleDraft,
  firstDayOf,
  inspectorChanges,
  isStaleSchedule,
  newScheduleDraft,
  scheduleCreateBody,
  scheduleEditPatch,
  withForm,
  withName,
  withPlace,
  withPreset,
  withStartsOn,
  type ScheduleDraft,
} from '../../lib/inspection-schedule-form';
import type { InspectionSchedule } from '../../lib/inspection-types';
import { problemText } from '../../lib/inspection-words';
import { assignablePeople } from '../../lib/task-form';
import { spacing } from '../../lib/theme';
import { typeStyle } from '../../lib/typography';
import { Icon } from '../Icon';
import { RecurrenceEditor } from '../RecurrenceEditor';
import { AssigneeField } from '../task-form/AssigneeField';
import { DueDateField } from '../task-form/DueDateField';
import { ChipChoice, InlinePicker, Sheet, SheetButtons, SheetMessage } from '../meeting/sheet-kit';
import { TextField } from '../ui';

const TITLE_MAX = 191;

/**
 * Schedule an inspection (or change a schedule), as the website's schedule dialog: which form,
 * what the checks are called, where, who does them, from when and how often. Each check is a task
 * due on its day for the inspectors, made on schedule whether or not the one before was done. It
 * needs a connection, as on the website; one key for the sheet's life, so a retry after a lost
 * answer never makes a second schedule.
 */
export function ScheduleSheet({
  projectId,
  workingDays,
  schedule,
  onClose,
  onSaved,
  onStale,
}: {
  projectId: string;
  workingDays: number[];
  /** Edit this schedule; without it, a new one. */
  schedule?: InspectionSchedule | null;
  onClose: () => void;
  onSaved: () => void;
  /** Saving found the schedule changed meanwhile: nothing was saved (the list is read again). */
  onStale: () => void;
}) {
  const c = useColors();
  const qc = useQueryClient();
  const { resources } = useServices();
  const editing = !!schedule;
  const today = companyTodayKey();
  const weekStart = weekStartOf(useDatePreferences().data);
  const formsQ = useInspectionForms();
  const membersQ = useProjectMembers(projectId);
  const dirQ = useDirectory();
  const people = useMemo(() => assignablePeople(membersQ.data, dirQ.data), [membersQ.data, dirQ.data]);
  const known = useRef(new Map<string, string>((schedule?.assignees ?? []).map((a) => [a.id, a.name])));
  for (const p of people) known.current.set(p.id, p.name);
  const [draft, setDraft] = useState<ScheduleDraft>(() => (schedule ? editScheduleDraft(schedule, workingDays) : newScheduleDraft(today, workingDays)));
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Changed only once the server refused a try (a 4xx: nothing was made).
  const key = useRef(newIdempotencyKey());

  const forms = formsQ.data?.forms ?? [];
  const formOptions = forms.map((f) => ({ value: f.id, label: f.title, hint: `${f.itemCount} ${f.itemCount === 1 ? 'item' : 'items'}` }));
  if (schedule && !forms.some((f) => f.id === schedule.form.id)) formOptions.unshift({ value: schedule.form.id, label: schedule.form.title, hint: '' });
  const firstDay = firstDayOf(draft, editing);
  const sentence = scheduleSentence(draft.rule, draft.inspectorIds.map((id) => known.current.get(id) ?? 'Someone'), workingDays, firstDay);
  const change = (next: ScheduleDraft) => {
    setDraft(next);
    setProblem(null);
  };

  async function save() {
    if (saving) return;
    const check = checkSchedule(draft, { today, editing });
    if (!check.ok) {
      setProblem(check.message);
      return;
    }
    setSaving(true);
    setProblem(null);
    try {
      if (!schedule) {
        const columns = await qc.fetchQuery({ queryKey: ['columns', projectId], queryFn: () => resources.projects.columns(projectId) });
        const columnId = checksColumn(columns ?? []);
        if (!columnId) throw new Error(NO_COLUMNS);
        await resources.inspections.createCheckSeries(scheduleCreateBody(draft, projectId, columnId), key.current);
      } else {
        await resources.inspections.updateCheckSeries(schedule.taskId, scheduleEditPatch(draft, schedule));
        const { add, remove } = inspectorChanges(draft, schedule);
        if (add.length) await resources.tasks.assign(schedule.taskId, add);
        for (const id of remove) await resources.tasks.unassign(schedule.taskId, id);
      }
      void qc.invalidateQueries({ queryKey: ['tasks'] });
      void qc.invalidateQueries({ queryKey: ['project-inspections', projectId] });
      onSaved();
      onClose();
    } catch (e) {
      if (!editing && e instanceof ApiError && e.status >= 400 && e.status < 500 && e.status !== 409) key.current = newIdempotencyKey();
      if (editing && isStaleSchedule(e)) {
        void qc.invalidateQueries({ queryKey: ['project-inspections', projectId] });
        onStale();
        onClose();
        return;
      }
      setProblem(problemText(e, editing ? W.saveFailed : W.scheduleFailed));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet
      visible
      title={editing ? W.editTitle : W.newTitle}
      subtitle={editing ? W.editIntro : W.newIntro}
      onClose={saving ? () => undefined : onClose}
      footer={<SheetButtons cancel={W.cancel} onCancel={onClose} confirm={editing ? W.save : W.schedule} onConfirm={() => void save()} busy={saving} />}
    >
      <InlinePicker
        label={`${W.form} *`}
        options={formOptions}
        value={draft.formId}
        onChange={(id) => {
          const f = formOptions.find((o) => o.value === id);
          if (f) change(withForm(draft, { id: f.value, title: f.label }));
        }}
        placeholder={formsQ.isLoading ? W.loadingForms : forms.length ? W.chooseForm : W.noForms}
        disabled={saving}
      />
      {formsQ.isError ? <SheetMessage text={problemText(formsQ.error, W.formsFailed)} /> : null}
      <TextField label={W.place} value={draft.place} onChangeText={(v) => change(withPlace(draft, v))} maxLength={INSPECTION_LIMITS.placeMax} placeholder={W.placePlaceholder} editable={!saving} />
      <TextField label={W.name} value={draft.name} onChangeText={(v) => change(withName(draft, v))} maxLength={TITLE_MAX} placeholder={W.namePlaceholder} editable={!saving} />
      <AssigneeField
        people={people}
        value={draft.inspectorIds}
        onChange={(ids) => change({ ...draft, inspectorIds: ids })}
        note={W.inspectorsNote}
        disabled={saving}
        status={membersQ.isLoading ? 'loading' : membersQ.isError && !membersQ.data ? 'failed' : null}
        labels={{ list: `${W.inspectors} *`, add: W.addInspectors, allChosen: W.allInspectors }}
      />
      {!editing ? <DueDateField label={W.startsOn} what={W.startsOn} value={draft.startsOn} onChange={(day) => change(withStartsOn(draft, day, workingDays))} today={today} weekStart={weekStart} disabled={saving} /> : null}
      <ChipChoice<SchedulePreset> label={W.repeat} options={SCHEDULE_PRESETS} value={draft.preset} onChange={(p) => change(withPreset(draft, p, workingDays))} disabled={saving} />
      <RecurrenceEditor
        kind="check"
        value={draft.rule}
        onChange={(next) => {
          if (next) change({ ...draft, rule: { ...next, createNext: 'ON_SCHEDULE' } });
        }}
        dueDate={firstDay ?? schedule?.nextDue ?? null}
        hideFrequency={draft.preset !== 'CUSTOM'}
        endsOnly={draft.preset === 'DAILY' || draft.preset === 'WORKING_DAYS'}
        disabled={saving}
      />
      <View style={s.sentence} accessibilityLiveRegion="polite">
        <Icon name="kit.repeat" size={16} color={c.brandText} />
        <Text style={[typeStyle('body'), s.grow, { color: c.ink }]}>{sentence}</Text>
      </View>
      <SheetMessage text={problem} />
    </Sheet>
  );
}

const s = StyleSheet.create({
  sentence: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  grow: { flex: 1 },
});
