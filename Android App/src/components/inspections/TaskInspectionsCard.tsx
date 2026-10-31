import React, { useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useColors } from '../../core/theme';
import { useInspectionForms, useStartInspection, useTaskInspections } from '../../core/inspection-queries';
import { newIdempotencyKey } from '../../lib/idempotency';
import { keepsKey } from '../../lib/pending-keys';
import { problemText } from '../../lib/inspection-words';
import { checkFormOf, followUpOfLine, showTaskInspections, taskCheckCard, TASK_CHECK_WORDS as W } from '../../lib/task-checks';
import type { ApiTask } from '../../lib/types';
import { radius, spacing, type Palette } from '../../lib/theme';
import { font, typeStyle } from '../../lib/typography';
import type { AppStackParamList } from '../../navigation/types';
import { Icon } from '../Icon';
import { Badge, Button, Card } from '../ui';
import { StartInspectionSheet } from './StartInspectionSheet';

/**
 * A task's inspections (the website's TaskInspections): those carried out for it and — for a
 * follow-up task — the inspection and item it follows up. A check (a task that carries a form)
 * names its form and has one main button: Start inspection (form, place and task filled in),
 * Continue inspection while one is in progress, or View report. Kept on the phone, so Continue and
 * View report open with no signal; starting needs a connection (decision 5).
 */
export function TaskInspectionsCard({ task, project }: { task: ApiTask; project: { status: string } | null | undefined }) {
  const c = useColors();
  const s = useMemo(() => makeStyles(c), [c]);
  const navigation = useNavigation<NativeStackNavigationProp<AppStackParamList>>();
  const q = useTaskInspections(task.id);
  const canStart = project?.status !== 'ARCHIVED';
  // The form named by the task's own details, while it is still the task's form.
  const carried = task.inspectionFormId && task.inspectionForm?.id === task.inspectionFormId ? task.inspectionForm : null;
  // The company's forms: only when they could be used — to start one for a task, or to name a check's new form.
  const formsQ = useInspectionForms(canStart && !carried);
  const startM = useStartInspection(task.projectId);
  const key = useRef(newIdempotencyKey());
  const [problem, setProblem] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const form = checkFormOf(task, formsQ.data?.forms);
  const place = task.inspectionPlace ?? null;
  const noForms = Array.isArray(formsQ.data?.forms) && formsQ.data.forms.length === 0;
  const attached = q.data?.attached ?? [];
  const of = followUpOfLine(q.data?.followUpOf ?? null);
  const card = taskCheckCard({ form, place, attached, canStart, noForms });
  const open = (inspectionId: string, title?: string) => navigation.navigate('Inspection', { inspectionId, title });

  if (!showTaskInspections({ loaded: !!q.data, formsLoading: formsQ.isLoading, attached, followUpOf: of, offerStart: canStart && !noForms, form })) return null;

  const start = () => {
    if (!form || startM.isPending) return;
    setProblem(null);
    startM.mutate(
      { formId: form.id, taskId: task.id, place, key: key.current },
      {
        onSuccess: (started) => {
          key.current = newIdempotencyKey();
          open(started.id, started.title);
        },
        onError: (e) => {
          // A definite answer (a refusal): the next tap is a new Start. A lost answer, or one still being worked on, keeps its key.
          if (!keepsKey(e)) key.current = newIdempotencyKey();
          setProblem(problemText(e, W.startFailed));
        },
      },
    );
  };

  const self = { id: task.id, key: task.key, title: task.title };
  return (
    <Card>
      <View style={s.head}>
        <Icon name="misc.inspection" size={14} color={c.ink2} />
        <Text style={s.heading} accessibilityRole="header">
          {W.heading}
        </Text>
      </View>

      {form ? (
        <View style={s.check}>
          <Text style={s.caption}>{W.carriedOut}</Text>
          <Text style={s.formTitle}>
            {form.title}
            {place ? <Text style={s.place}> · {place}</Text> : null}
          </Text>
          {card.deletedNote ? <Text style={s.caption}>{W.formDeleted}</Text> : null}
          {card.main ? (
            <View style={s.mainRow}>
              {card.main.kind === 'start' ? (
                <Button title={W.start} size="sm" onPress={start} loading={startM.isPending} />
              ) : (
                <Button title={card.main.kind === 'continue' ? W.continue : W.report} size="sm" onPress={() => open((card.main as { inspectionId: string }).inspectionId)} />
              )}
            </View>
          ) : null}
          {problem ? (
            <Text style={s.problem} accessibilityRole="alert">
              {problem}
            </Text>
          ) : null}
        </View>
      ) : null}

      {of ? (
        <View style={s.followUp}>
          <Text style={s.caption}>{of.before}</Text>
          <Pressable
            onPress={() => open(of.inspectionId, of.title)}
            accessibilityRole="link"
            accessibilityLabel={`${of.before} ${of.title}`}
            style={({ pressed }) => [s.followLink, pressed && { opacity: 0.6 }]}
          >
            <Text style={s.link}>{of.title}</Text>
          </Pressable>
        </View>
      ) : null}

      {attached.map((x) => (
        <Pressable
          key={x.id}
          onPress={() => open(x.id, x.title)}
          accessibilityRole="button"
          accessibilityLabel={`${x.title}, ${x.result}`}
          style={({ pressed }) => [s.row, pressed && { backgroundColor: c.surface2 }]}
        >
          <Text style={s.rowTitle}>{x.title}</Text>
          {x.status === 'FINISHED' ? <Badge label={x.result} tone={x.counts.failed > 0 ? 'danger' : 'success'} /> : <Text style={s.caption}>{x.result}</Text>}
        </Pressable>
      ))}

      {card.another ? (
        <Pressable onPress={() => setStarting(true)} accessibilityRole="button" style={({ pressed }) => [s.another, pressed && { opacity: 0.6 }]}>
          <Text style={s.link}>{card.another === 'another' ? W.another : W.forTask}</Text>
        </Pressable>
      ) : null}

      {starting ? (
        <StartInspectionSheet
          projectId={task.projectId}
          tasks={[self]}
          fixedTask={self}
          onClose={() => setStarting(false)}
          onStarted={(started) => {
            setStarting(false);
            open(started.id, started.title);
          }}
        />
      ) : null}
    </Card>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    head: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: spacing.sm },
    heading: { ...typeStyle('eyebrow'), color: c.ink2 },
    check: { gap: 2, borderRadius: radius.button, borderWidth: 1, borderColor: c.line, backgroundColor: c.brandWash, padding: spacing.md, marginBottom: spacing.sm },
    caption: { ...typeStyle('caption'), color: c.ink2 },
    formTitle: { ...typeStyle('bodyStrong'), color: c.ink },
    place: { ...font('400'), color: c.ink2 },
    mainRow: { flexDirection: 'row', marginTop: spacing.sm },
    problem: { ...typeStyle('caption'), color: c.dangerText, marginTop: spacing.xs },
    followUp: { borderRadius: radius.input, backgroundColor: c.ground, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, marginBottom: spacing.sm },
    link: { ...typeStyle('caption'), ...font('600'), color: c.brandText },
    followLink: { minHeight: 44, justifyContent: 'center' },
    row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, borderWidth: 1, borderColor: c.line, borderRadius: radius.input, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, marginBottom: 6, minHeight: 44 },
    rowTitle: { ...typeStyle('bodyStrong'), color: c.ink, flexShrink: 1 },
    another: { minHeight: 44, justifyContent: 'center' },
  });
