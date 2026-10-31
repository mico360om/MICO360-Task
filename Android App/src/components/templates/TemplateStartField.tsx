import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useColors } from '../../core/theme';
import { useProjectTemplates } from '../../core/template-queries';
import { Icon } from '../Icon';
import { PriorityBadge, Skeleton } from '../ui';
import { FieldLabel, InlinePicker } from '../meeting/sheet-kit';
import { DueDateField } from '../task-form/DueDateField';
import { chooseTemplate, fillerOptions, planFor, templateOptions, usableProjectTemplates, withFiller, type TemplateChoice } from '../../lib/template-choice';
import { count, daysOffNote, overdueWarning, planSummary, planTaskDue, planTaskWho, TEMPLATE_START_WORDS } from '../../lib/template-words';
import type { TemplatePlan } from '../../lib/templates-api';
import { displayName, type ApiDirectoryUser } from '../../lib/types';
import type { WeekStart } from '../../lib/calendar';
import { fontSize, radius, spacing, type Palette } from '../../lib/theme';
import { font, typeStyle } from '../../lib/typography';

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

/**
 * The New project form's "Start from a template" (the website's TemplateStart): a template (or a
 * blank project), the day the project starts (today unless changed), who fills each of its roles
 * (active people; they join the team), and the tasks it will create — each with its due day and
 * who will do it — so nothing is a surprise. A role left empty leaves its tasks to the project's
 * owner. New projects only; hidden when there is no template to start from.
 */
export function TemplateStartField({
  choice,
  onChange,
  people,
  ownerId,
  today,
  weekStart,
  plan,
  planError,
  onRetry,
  disabled,
}: {
  choice: TemplateChoice | null;
  onChange: (choice: TemplateChoice | null) => void;
  /** The company's people (the directory): active ones can fill a role; names for the preview. */
  people: readonly ApiDirectoryUser[];
  /** Who will own the new project ('' none): gets the tasks of roles nobody fills. */
  ownerId: string;
  today: string;
  weekStart: WeekStart;
  plan: TemplatePlan | undefined;
  planError: boolean;
  onRetry: () => void;
  disabled?: boolean;
}) {
  const c = useColors();
  const s = useMemo(() => makeStyles(c), [c]);
  const listQ = useProjectTemplates();
  const options = templateOptions(listQ.data, choice, plan);
  const fillers = useMemo(() => fillerOptions(people), [people]);
  const names = useMemo(() => new Map(people.map((u) => [u.id, displayName(u)])), [people]);
  const current = planFor(plan, choice);
  const roles = current?.template.roles ?? [];
  const owner = ownerId ? { id: ownerId, name: names.get(ownerId) ?? null } : null;

  // No template to start from (a new company): a picker offering only "Blank project" says nothing.
  if (listQ.isSuccess && usableProjectTemplates(listQ.data).length === 0 && !choice) return null;

  const warning = current ? overdueWarning(current.overdue) : null;
  return (
    <View style={s.box}>
      <View style={s.head}>
        <Icon name="misc.templateProject" size={20} color={c.brandText} />
        <Text style={s.heading} accessibilityRole="header">
          {TEMPLATE_START_WORDS.heading} <Text style={s.optional}>{TEMPLATE_START_WORDS.optional}</Text>
        </Text>
      </View>
      <InlinePicker
        label={TEMPLATE_START_WORDS.template}
        options={options}
        value={choice?.id ?? ''}
        onChange={(id) => onChange(chooseTemplate(choice, id, today))}
        placeholder={listQ.isLoading ? TEMPLATE_START_WORDS.loading : TEMPLATE_START_WORDS.blank}
        disabled={disabled}
      />

      {choice ? (
        <>
          <DueDateField
            label={TEMPLATE_START_WORDS.startDate}
            what={TEMPLATE_START_WORDS.startDate}
            value={choice.startDate}
            onChange={(day) => onChange({ ...choice, startDate: day })}
            today={today}
            weekStart={weekStart}
            note={daysOffNote(current?.workingDays ?? ALL_DAYS)}
            disabled={disabled}
          />

          {roles.length ? (
            <View style={s.roles}>
              <FieldLabel>{TEMPLATE_START_WORDS.whoFills}</FieldLabel>
              {roles.map((r) => (
                <InlinePicker
                  key={r.id}
                  label={r.name}
                  a11yName={TEMPLATE_START_WORDS.personFor.replace('{role}', r.name)}
                  options={fillers}
                  value={choice.roles[r.id] ?? ''}
                  onChange={(v) => onChange(withFiller(choice, r.id, v))}
                  placeholder={TEMPLATE_START_WORDS.nobody}
                  disabled={disabled}
                />
              ))}
              <Text style={s.note}>{TEMPLATE_START_WORDS.rolesNote}</Text>
            </View>
          ) : null}

          {planError ? (
            <View style={s.problem} accessibilityRole="alert">
              <Text style={s.problemText}>{TEMPLATE_START_WORDS.planFailed}</Text>
              <Text onPress={onRetry} accessibilityRole="button" style={s.retry} suppressHighlighting>
                {TEMPLATE_START_WORDS.retry}
              </Text>
            </View>
          ) : !current ? (
            <View accessible accessibilityRole="progressbar" accessibilityLabel={TEMPLATE_START_WORDS.planLoading}>
              <Skeleton height={128} radius={radius.input} />
            </View>
          ) : (
            <View style={s.plan}>
              <Text style={s.summary}>{planSummary(current)}</Text>
              {warning ? (
                <Text style={s.warning} accessibilityLiveRegion="polite">
                  {warning}
                </Text>
              ) : null}
              {current.tasks.length ? (
                <ScrollView style={s.list} nestedScrollEnabled accessibilityLabel={TEMPLATE_START_WORDS.tasksList}>
                  {current.tasks.map((t, i) => {
                    const late = !!t.dueDate && t.dueDate < current.today;
                    return (
                      <View key={t.position} style={[s.row, i > 0 && s.rowLine]}>
                        <Text style={s.number}>{t.position + 1}</Text>
                        <View style={s.rowBody}>
                          <View style={s.titleLine}>
                            <Text style={s.title} numberOfLines={2}>
                              {t.title}
                            </Text>
                            {t.priority !== 'NORMAL' ? <PriorityBadge priority={t.priority} /> : null}
                          </View>
                          <Text style={[s.fact, late && s.late]}>{planTaskDue(t, current.today)}</Text>
                          <Text style={s.fact}>{planTaskWho(t, roles, choice.roles, names, owner)}</Text>
                          {t.checklistCount ? <Text style={s.faint}>{count(t.checklistCount, 'checklist item')}</Text> : null}
                        </View>
                      </View>
                    );
                  })}
                </ScrollView>
              ) : null}
            </View>
          )}
        </>
      ) : null}
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    box: { gap: spacing.md, borderWidth: 1, borderColor: c.line, borderRadius: radius.card, padding: spacing.lg, backgroundColor: c.surface },
    head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    heading: { ...typeStyle('subheading'), color: c.ink, flexShrink: 1 },
    optional: { ...typeStyle('caption'), color: c.ink2 },
    roles: { gap: spacing.sm },
    note: { fontSize: fontSize.sm, color: c.ink2 },
    problem: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm },
    problemText: { fontSize: fontSize.sm, color: c.dangerText },
    retry: { fontSize: fontSize.sm, ...font('600'), color: c.dangerText, textDecorationLine: 'underline', paddingVertical: spacing.sm },
    plan: { gap: spacing.sm },
    summary: { fontSize: fontSize.sm, color: c.ink },
    warning: { fontSize: fontSize.sm, ...font('500'), color: c.warningText, backgroundColor: c.warningSoft, borderRadius: radius.input, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
    list: { maxHeight: 288, borderWidth: 1, borderColor: c.line, borderRadius: radius.input, backgroundColor: c.surface },
    row: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
    rowLine: { borderTopWidth: 1, borderTopColor: c.line },
    number: { ...typeStyle('caption'), width: 24, textAlign: 'right', color: c.ink3, fontVariant: ['tabular-nums'] },
    rowBody: { flex: 1, gap: 2 },
    titleLine: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm },
    title: { fontSize: fontSize.sm, ...font('500'), color: c.ink, flexShrink: 1 },
    fact: { ...typeStyle('caption'), color: c.ink2 },
    late: { color: c.dangerText, ...font('600') },
    faint: { ...typeStyle('caption'), color: c.ink3 },
  });
