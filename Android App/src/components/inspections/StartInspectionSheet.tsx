import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useServices } from '../../core/providers';
import { useColors } from '../../core/theme';
import { useInspectionForms, useStartInspection } from '../../core/inspection-queries';
import { openWebsitePage } from '../../adapters/website';
import { keepsKey } from '../../lib/pending-keys';
import { newIdempotencyKey } from '../../lib/idempotency';
import { INSPECTION_LIMITS } from '../../lib/inspection-rules';
import { INSPECTIONS_TAB_WORDS as W, startCheck } from '../../lib/inspection-tab';
import type { InspectionDetail } from '../../lib/inspection-types';
import { problemText } from '../../lib/inspection-words';
import { spacing } from '../../lib/theme';
import { typeStyle } from '../../lib/typography';
import { CardChoice, InlinePicker, Sheet, SheetButtons, SheetMessage } from '../meeting/sheet-kit';
import { Button, TextField } from '../ui';

export interface InspectionTaskOption {
  id: string;
  key: string;
  title: string;
}

const FORMS_TAB = '/templates?tab=inspections';

/**
 * Start an inspection, as the website's Start dialog: a form, the task it is for (or the task
 * given), and where. It needs a connection (decision 5): with no signal it says so and nothing is
 * kept for later. One key per Start, so an answer lost on the way never makes two inspections.
 */
export function StartInspectionSheet({
  projectId,
  tasks,
  fixedTask,
  onClose,
  onStarted,
}: {
  projectId: string;
  tasks: InspectionTaskOption[];
  fixedTask?: InspectionTaskOption;
  onClose: () => void;
  onStarted: (detail: InspectionDetail) => void;
}) {
  const c = useColors();
  const { baseUrl } = useServices();
  const formsQ = useInspectionForms();
  const startM = useStartInspection(projectId);
  const [formId, setFormId] = useState('');
  const [taskId, setTaskId] = useState(fixedTask?.id ?? '');
  const [place, setPlace] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [key, setKey] = useState(() => newIdempotencyKey());
  const forms = formsQ.data?.forms ?? [];

  const start = () => {
    const wrong = startCheck(formId, place);
    if (wrong) {
      setProblem(wrong);
      return;
    }
    setProblem(null);
    startM.mutate(
      { formId, taskId: taskId || null, place: place.trim() || null, key },
      {
        onSuccess: (started) => onStarted(started),
        onError: (e) => {
          // The server answered (a refusal): the next try is a new Start. A lost answer — or the
          // server still on it — keeps its key (lib/pending-keys keepsKey).
          if (!keepsKey(e)) setKey(newIdempotencyKey());
          setProblem(problemText(e, W.startFailed));
        },
      },
    );
  };

  return (
    <Sheet
      visible
      title={W.startTitle}
      subtitle={W.startIntro}
      onClose={startM.isPending ? () => undefined : onClose}
      footer={<SheetButtons onCancel={onClose} confirm={W.startOne} onConfirm={start} busy={startM.isPending} />}
    >
      {formsQ.isLoading ? <Text style={[typeStyle('body'), { color: c.ink2 }]}>{W.loadingForms}</Text> : null}
      {formsQ.isError ? <SheetMessage text={problemText(formsQ.error, W.formsFailed)} /> : null}
      {formsQ.data && !forms.length ? (
        <View style={s.noForms}>
          <Text style={[typeStyle('body'), { color: c.ink2 }]}>{`${W.noForms} ${formsQ.data.canCreate ? '' : W.askForForm}`}</Text>
          {formsQ.data.canCreate ? <Button title={W.makeAForm} variant="ghost" size="sm" onPress={() => openWebsitePage(baseUrl, FORMS_TAB)} accessibilityHint="Opens on the website" /> : null}
        </View>
      ) : null}
      {forms.length ? (
        <CardChoice
          legend={W.form}
          value={formId}
          onChange={setFormId}
          options={forms.map((f) => ({
            value: f.id,
            label: f.title,
            hint: `${f.sectionCount} ${f.sectionCount === 1 ? 'section' : 'sections'} · ${f.itemCount} ${f.itemCount === 1 ? 'item' : 'items'}`,
          }))}
        />
      ) : null}
      {fixedTask ? (
        <Text style={[typeStyle('body'), { color: c.ink2 }]}>{W.forTask.replace('{key}', fixedTask.key).replace('{title}', fixedTask.title)}</Text>
      ) : (
        <View>
          <InlinePicker label={W.forATask} placeholder={W.noTask} value={taskId} onChange={setTaskId} options={[{ value: '', label: W.noTask }, ...tasks.map((t) => ({ value: t.id, label: `${t.key} · ${t.title}` }))]} />
          <Text style={[typeStyle('caption'), { color: c.ink2 }]}>{W.taskHint}</Text>
        </View>
      )}
      <TextField label={W.place} value={place} onChangeText={setPlace} maxLength={INSPECTION_LIMITS.placeMax} placeholder={W.placePlaceholder} />
      <SheetMessage text={problem} />
    </Sheet>
  );
}

const s = StyleSheet.create({
  noForms: { gap: spacing.xs, alignItems: 'flex-start' },
});
