import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useColors } from '../../core/theme';
import { useProjectColumns } from '../../core/queries';
import { Sheet, SheetButtons, CardChoice, ActionRowButton, SheetMessage } from '../meeting/sheet-kit';
import { QuickAddTaskSheet } from '../QuickAddTaskSheet';
import { MonthGrid } from './MonthGrid';
import { dayLabel, fullDayLabel, shiftMonth, type WeekStart } from '../../lib/calendar';
import { PRIORITY_LABEL, STATUS_LABEL, type CalItem } from '../../lib/calendar-model';
import { moveBlockReason, needsSeriesChoice, projectedNote, quickDays, type MoveScope } from '../../lib/calendar-reschedule';
import { recurrenceSummary } from '../../lib/recurrence-summary';
import { dueDayKey } from '../../lib/due-date';
import { spacing, radius, fontSize, type Palette } from '../../lib/theme';

function useStyles() {
  const c = useColors();
  return useMemo(() => makeStyles(c), [c]);
}

/**
 * A day to pick: a few one-tap days, then the month (previous / next month) to tap one in. Used to
 * move a task and to go to a date.
 */
export function DayPicker({
  value,
  onChange,
  today,
  weekStart,
  quick,
  ringed,
  ringedWord,
  hint,
}: {
  value: string | null;
  onChange: (day: string) => void;
  today: string;
  weekStart: WeekStart;
  quick?: { label: string; day: string }[];
  ringed?: string | null;
  ringedWord?: string;
  hint: string;
}) {
  const s = useStyles();
  const [month, setMonth] = useState(() => `${(value ?? ringed ?? today).slice(0, 7)}-01`);
  const monthName = dayLabel(month, { month: 'long', year: true });
  return (
    <View style={s.picker}>
      {quick?.length ? (
        <View style={s.quick}>
          {quick.map((q) => {
            const on = q.day === value;
            return (
              <Pressable
                key={q.label}
                onPress={() => {
                  onChange(q.day);
                  setMonth(`${q.day.slice(0, 7)}-01`);
                }}
                accessibilityRole="button"
                accessibilityLabel={`${q.label}, ${dayLabel(q.day)}`}
                accessibilityState={{ selected: on }}
                style={({ pressed }) => [s.chip, on && s.chipOn, pressed && s.pressed]}
              >
                <Text style={[s.chipText, on && s.chipTextOn]}>{q.label}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
      <View style={s.monthBar}>
        <Pressable onPress={() => setMonth(shiftMonth(month, -1))} accessibilityRole="button" accessibilityLabel="Previous month" hitSlop={8} style={({ pressed }) => [s.step, pressed && s.pressed]}>
          <Text style={s.stepText}>‹</Text>
        </Pressable>
        <Text style={s.monthName} accessibilityLiveRegion="polite">
          {monthName}
        </Text>
        <Pressable onPress={() => setMonth(shiftMonth(month, 1))} accessibilityRole="button" accessibilityLabel="Next month" hitSlop={8} style={({ pressed }) => [s.step, pressed && s.pressed]}>
          <Text style={s.stepText}>›</Text>
        </Pressable>
      </View>
      <MonthGrid cursor={month} weekStart={weekStart} today={today} selected={value} onPick={onChange} outlined={ringed} outlinedWord={ringedWord} label={monthName} hint={hint} />
    </View>
  );
}

/**
 * "Move to another day" (the website's drag, and its "Change date"): a day, and — for the newest
 * copy of a repeating task — whether only this occurrence moves or the schedule with it.
 */
export function MoveDaySheet({
  item,
  today,
  weekStart,
  onMove,
  onClose,
}: {
  item: CalItem | null;
  today: string;
  weekStart: WeekStart;
  onMove: (item: CalItem, day: string, scope: MoveScope) => void;
  onClose: () => void;
}) {
  const s = useStyles();
  const [day, setDay] = useState<string | null>(null);
  const [scope, setScope] = useState<MoveScope>('occurrence');
  useEffect(() => {
    setDay(null);
    setScope('occurrence');
  }, [item?.key]);
  if (!item) return null;
  const chosen = day && day !== item.date ? day : null;
  const series = needsSeriesChoice(item.task);
  return (
    <Sheet
      visible
      title="Move to another day"
      subtitle={`${item.task.key} · now due ${fullDayLabel(item.date)}`}
      onClose={onClose}
      closeLabel="Close, without moving"
      footer={<SheetButtons onCancel={onClose} confirm={chosen ? `Move to ${dayLabel(chosen)}` : 'Move'} disabled={!chosen} onConfirm={() => chosen && onMove(item, chosen, scope)} />}
    >
      <Text style={s.taskTitle} numberOfLines={3}>
        {item.task.title}
      </Text>
      <DayPicker
        value={day}
        onChange={setDay}
        today={today}
        weekStart={weekStart}
        quick={quickDays(today, item.date)}
        ringed={item.date}
        ringedWord="due now"
        hint="Picks this day"
      />
      {series ? (
        <CardChoice
          legend="Which occurrences?"
          value={scope}
          onChange={setScope}
          options={[
            { value: 'occurrence', label: 'This occurrence', hint: 'Only this copy moves; the next ones stay on their days.' },
            { value: 'series', label: 'This and future occurrences', hint: 'The schedule moves to the new day from here on.' },
          ]}
        />
      ) : null}
    </Sheet>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  const s = useStyles();
  return (
    <View style={s.fact} accessible accessibilityLabel={`${label}: ${typeof children === 'string' ? children : ''}`}>
      <Text style={s.factLabel}>{label}</Text>
      <Text style={s.factValue}>{children}</Text>
    </View>
  );
}

/**
 * A task that can't be moved from the calendar, explained: a repeat not created yet (with when it
 * will be, as the website says it), a finished task, or one of an archived project — with its
 * details and a way to open it (a projected copy opens its series' current copy).
 */
export function TaskInfoSheet({
  item,
  projectName,
  timeZone,
  onOpen,
  onClose,
}: {
  item: CalItem | null;
  projectName?: string;
  timeZone: string;
  onOpen: (item: CalItem) => void;
  onClose: () => void;
}) {
  const s = useStyles();
  if (!item) return null;
  const t = item.task;
  const projected = item.kind === 'projected';
  const note = projected ? projectedNote(item, timeZone) : moveBlockReason(item);
  const rule = t.recurrenceRule;
  const due = dueDayKey(t.dueDate, timeZone);
  return (
    <Sheet
      visible
      title={t.title}
      subtitle={projected ? 'Not created yet' : t.key}
      onClose={onClose}
      footer={<SheetButtons cancel="Close" onCancel={onClose} confirm={projected ? 'Open the current copy' : 'Open task'} onConfirm={() => onOpen(item)} />}
    >
      <SheetMessage text={note} tone="info" />
      {projected && moveBlockReason(item) ? <Text style={s.note}>{moveBlockReason(item)}</Text> : null}
      <Fact label="Status">{STATUS_LABEL[item.status]}</Fact>
      <Fact label={projected ? 'This copy' : 'Due'}>{fullDayLabel(item.date)}</Fact>
      {projected && due ? <Fact label="Current copy due">{fullDayLabel(due)}</Fact> : null}
      <Fact label="Project">{projectName ?? 'Project'}</Fact>
      <Fact label="Assignees">{t.assignees?.length ? t.assignees.map((a) => a.name).join(', ') : 'Unassigned'}</Fact>
      <Fact label="Priority">{PRIORITY_LABEL[t.priority]}</Fact>
      {rule || t.recurrenceParentId ? <Fact label="Repeat">{rule ? recurrenceSummary(rule) : 'An earlier copy of a repeating task'}</Fact> : null}
    </Sheet>
  );
}

/** "Go to a date": the calendar jumps to the day picked (the website's date box). */
export function GoToDateSheet({
  visible,
  current,
  today,
  weekStart,
  onGo,
  onClose,
}: {
  visible: boolean;
  current: string;
  today: string;
  weekStart: WeekStart;
  onGo: (day: string) => void;
  onClose: () => void;
}) {
  const [day, setDay] = useState<string | null>(null);
  useEffect(() => {
    if (visible) setDay(null);
  }, [visible]);
  if (!visible) return null;
  return (
    <Sheet visible title="Go to a date" subtitle={`Showing ${fullDayLabel(current)}`} onClose={onClose} footer={<SheetButtons onCancel={onClose} confirm={day ? `Go to ${dayLabel(day)}` : 'Go'} disabled={!day} onConfirm={() => day && onGo(day)} />}>
      <DayPicker value={day} onChange={setDay} today={today} weekStart={weekStart} quick={[{ label: 'Today', day: today }]} ringed={current} ringedWord="shown now" hint="Picks this day" />
    </Sheet>
  );
}

type ProjectChoice = { id: string; name: string; status: string };

/**
 * "Add a task on this day": in the project the calendar is filtered to, or — without one — the
 * project you pick first (open projects only); then the app's New task sheet, due on that day.
 */
export function NewTaskOnDay({
  day,
  presetProjectId,
  projects,
  onClose,
}: {
  day: string | null;
  presetProjectId: string | null;
  projects: ProjectChoice[];
  onClose: () => void;
}) {
  const s = useStyles();
  const [picked, setPicked] = useState<string | null>(null);
  useEffect(() => setPicked(null), [day]);
  const projectId = presetProjectId ?? picked;
  const columnsQ = useProjectColumns(day && projectId ? projectId : '');
  const open = useMemo(() => projects.filter((p) => p.status !== 'ARCHIVED' && p.status !== 'COMPLETED').sort((a, b) => a.name.localeCompare(b.name)), [projects]);
  if (!day) return null;
  if (!projectId) {
    return (
      <Sheet visible title={`Add a task on ${dayLabel(day)}`} subtitle="Which project is it for?" onClose={onClose} footer={<SheetButtons onCancel={onClose} />}>
        {open.length === 0 ? <Text style={s.note}>None of your projects is open for new tasks.</Text> : null}
        {open.map((p) => (
          <ActionRowButton key={p.id} label={p.name} hint={`Adds a task to ${p.name}`} onPress={() => setPicked(p.id)} />
        ))}
      </Sheet>
    );
  }
  return <QuickAddTaskSheet visible onClose={onClose} projectId={projectId} columns={columnsQ.data ?? []} defaultDueDate={day} />;
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    picker: { gap: spacing.sm },
    quick: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    chip: { minHeight: 40, justifyContent: 'center', borderWidth: 1, borderColor: c.line, borderRadius: radius.pill, paddingHorizontal: spacing.md, backgroundColor: c.surface },
    chipOn: { borderColor: c.brand, backgroundColor: c.brandWash },
    chipText: { fontSize: fontSize.sm, fontWeight: '600', color: c.ink },
    chipTextOn: { color: c.brand, fontWeight: '700' },
    pressed: { opacity: 0.7 },
    monthBar: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    step: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md, borderWidth: 1, borderColor: c.line },
    stepText: { fontSize: fontSize.xl, color: c.ink, fontWeight: '700' },
    monthName: { flex: 1, textAlign: 'center', fontSize: fontSize.md, fontWeight: '700', color: c.ink },
    taskTitle: { fontSize: fontSize.md, color: c.ink, textAlign: 'auto' },
    note: { fontSize: fontSize.sm, color: c.ink2 },
    fact: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, paddingVertical: spacing.xs, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.line },
    factLabel: { width: 120, fontSize: fontSize.xs, fontWeight: '700', color: c.ink2, textTransform: 'uppercase' },
    factValue: { flex: 1, minWidth: 140, fontSize: fontSize.sm, color: c.ink, textAlign: 'auto' },
  });
