import { useCallback, useMemo, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, View, type ListRenderItem } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useIsFocused } from '@react-navigation/native';
import { Button, ErrorNote, IconButton, Muted, NoticeNote, SkeletonList, TextField } from '../components/ui';
import { InlinePicker } from '../components/meeting/sheet-kit';
import { useMinuteNow, usePullRefresh } from '../components/meeting/live';
import { DaySheet } from '../components/workload/DaySheet';
import { Hatch, PersonCard } from '../components/workload/PersonCard';
import { useApplySuggestion, useSetDailyLimit, useWorkload } from '../core/planning-queries';
import { useDatePreferences } from '../core/calendar-queries';
import { useColors } from '../core/theme';
import { shiftDayKey, weekDays, weekStartOf } from '../lib/calendar';
import { companyTodayKey } from '../lib/due-date';
import type { WorkloadCell, WorkloadPerson, WorkloadTask } from '../lib/planning-api';
import { cellLook } from '../lib/planning-look';
import { filterPeople, footerLine, limitOptions, scopeLead, sortPeople, summaryLine, weekLabel, type CellTone } from '../lib/workload';
import { radius, spacing, type Palette } from '../lib/theme';
import { font, typeStyle } from '../lib/typography';
import type { AppScreenProps } from '../navigation/types';

/** The legend: a small day in each look and the website's words for it. */
const LEGEND: { tone: CellTone; shows: string; words: string }[] = [
  { tone: 'none', shows: '0', words: 'none' },
  { tone: 'below', shows: '3', words: 'below the limit' },
  { tone: 'at', shows: '5', words: 'at the limit' },
  { tone: 'over', shows: '7', words: '! over the limit' },
  { tone: 'off', shows: 'Off', words: 'not a working day (Meeting hours)' },
  { tone: 'offdue', shows: '2', words: 'due on a day off' },
];

/**
 * Workload (Stage 3): each person's open tasks due each day of a week against the company's daily
 * limit, their overdue tasks and days off — one card per person (the website has no phone layout
 * here; spec §7). A day's number opens its tasks with the server's suggestion each (a teammate
 * with room, or a lighter day), applied only when tapped. Administrators see everyone and set the
 * limit; a project manager sees their projects' teams; anyone else their own week.
 */
export function WorkloadScreen(_props: AppScreenProps<'Workload'>) {
  const c = useColors();
  const s = useMemo(() => makeStyles(c), [c]);
  const focused = useIsFocused();
  const today = companyTodayKey(useMinuteNow(focused));
  const weekStart = weekStartOf(useDatePreferences().data);
  const thisWeek = weekDays(today, weekStart)[0]!;
  const [asked, setAsked] = useState<string | null>(null);
  const week = asked ?? thisWeek;
  const [projectId, setProjectId] = useState('');
  const [q, setQ] = useState('');
  const query = useWorkload(week, projectId);
  const pull = usePullRefresh(query.refetch);
  const data = query.data;
  const people = useMemo(() => sortPeople(data?.people ?? []), [data]);
  const shown = useMemo(() => filterPeople(people, q), [people, q]);

  // The open day (whose number it is), and what the last suggestion did.
  const [open, setOpen] = useState<{ personId: string; date: string } | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const openPerson = open ? (people.find((p) => p.id === open.personId) ?? null) : null;
  const openCell = open && openPerson ? (openPerson.days.find((d) => d.date === open.date) ?? null) : null;
  const { apply, busyTaskId } = useApplySuggestion();
  const goToWeek = (w: string) => {
    setOpen(null);
    setAsked(w === thisWeek ? null : w);
  };
  const openDay = useCallback((person: WorkloadPerson, cell: WorkloadCell) => {
    setNotice(null);
    setOpen({ personId: person.id, date: cell.date });
  }, []);
  const onApply = async (task: WorkloadTask, person: WorkloadPerson) => {
    setNotice(null);
    const result = await apply(task, person);
    if (result) setNotice(result);
  };

  // The daily limit: the chosen one shows while it is saved, then the server's.
  const { set: saveLimit } = useSetDailyLimit();
  const [limitDraft, setLimitDraft] = useState<number | null>(null);
  const [limitProblem, setLimitProblem] = useState<string | null>(null);
  const limit = limitDraft ?? data?.limit ?? 0;
  const changeLimit = async (value: number) => {
    if (value === limit || limitDraft !== null) return;
    setLimitDraft(value);
    setLimitProblem(null);
    const problem = await saveLimit(value);
    setLimitProblem(problem);
    setLimitDraft(null);
  };

  const renderItem: ListRenderItem<WorkloadPerson> = useCallback(
    ({ item }) => <PersonCard person={item} week={week} today={today} onOpenDay={(cell) => openDay(item, cell)} />,
    [week, today, openDay],
  );

  const header = (
    <View style={s.header}>
      <Muted>
        Open tasks due each day, per person. {data && !query.isError ? summaryLine(people, week === thisWeek) : ''}
        {data ? scopeLead(data.scope) : ''}
      </Muted>
      <View style={s.weeks}>
        <IconButton icon="ui.back" label="Previous week" variant="outlined" onPress={() => goToWeek(shiftDayKey(week, -7))} />
        <Button title={weekLabel(week, today)} variant="secondary" size="sm" accessibilityHint="Back to this week" onPress={() => goToWeek(thisWeek)} />
        <IconButton icon="ui.back" rotate={180} label="Next week" variant="outlined" onPress={() => goToWeek(shiftDayKey(week, 7))} />
      </View>
      <InlinePicker
        label="Project"
        options={[{ value: '', label: 'All' }, ...(data?.projects ?? []).map((p) => ({ value: p.id, label: p.name }))]}
        value={projectId}
        onChange={(v) => {
          setOpen(null);
          setProjectId(v);
        }}
        placeholder="All"
      />
      <TextField value={q} onChangeText={setQ} placeholder="Find a person…" accessibilityLabel="Find a person" autoCapitalize="none" autoCorrect={false} />
      {data ? (
        data.canChangeLimit ? (
          <View>
            <InlinePicker
              label="Daily limit"
              options={limitOptions(limit).map((n) => ({ value: String(n), label: String(n) }))}
              value={String(limit)}
              onChange={(v) => void changeLimit(Number(v))}
              placeholder={String(limit)}
              disabled={limitDraft !== null}
            />
            <Text style={s.hint}>Open tasks a person may have due on one working day — for everyone</Text>
          </View>
        ) : (
          <View style={s.limitBox} accessible accessibilityLabel={`Daily limit ${data.limit}, set by an administrator`}>
            <Text style={s.limitText}>
              Daily limit <Text style={s.limitValue}>{data.limit}</Text>
            </Text>
            <Text style={s.hint}>Set by an administrator</Text>
          </View>
        )
      ) : null}
      {limitProblem ? <ErrorNote message={limitProblem} /> : null}
      {/* What the last suggestion did (or why it couldn't), said aloud. */}
      <View accessibilityLiveRegion="polite">{notice ? (notice.ok ? <NoticeNote message={notice.text} /> : <ErrorNote message={notice.text} />) : null}</View>
    </View>
  );

  const footer = data ? (
    <View style={s.footer}>
      <View style={s.legend} accessibilityLabel="Legend">
        {LEGEND.map((item) => {
          const look = cellLook(c, item.tone);
          return (
            <View key={item.tone} style={s.legendItem}>
              <View style={[s.mini, { backgroundColor: look.bg, borderColor: look.border }]} importantForAccessibility="no-hide-descendants">
                {look.hatched ? <Hatch color={item.tone === 'off' ? c.ground2 : c.surface} /> : null}
                <Text style={[s.miniText, { color: look.fg }]} allowFontScaling={false}>
                  {item.shows}
                </Text>
              </View>
              <Text style={s.legendText}>{item.words}</Text>
            </View>
          );
        })}
      </View>
      <Muted>{footerLine(data.scope)}</Muted>
    </View>
  ) : null;

  const empty = query.isLoading ? (
    <SkeletonList avatar />
  ) : query.isError || !data ? (
    <ErrorNote message="Couldn’t load the workload." onRetry={() => void query.refetch()} retrying={query.isRefetching} />
  ) : (
    <Text style={s.nobody}>{q.trim() ? `Nobody matches “${q.trim()}”.` : 'Nobody to show for this week.'}</Text>
  );

  return (
    <SafeAreaView style={s.safe} edges={['bottom']}>
      <FlatList
        data={data && !query.isError ? shown : []}
        keyExtractor={(p) => p.id}
        renderItem={renderItem}
        ListHeaderComponent={header}
        ListEmptyComponent={empty}
        ListFooterComponent={footer}
        ItemSeparatorComponent={Separator}
        contentContainerStyle={s.list}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} />}
      />
      {openPerson && openCell && data ? (
        <DaySheet
          person={openPerson}
          cell={openCell}
          week={week}
          busyTaskId={busyTaskId}
          notice={notice}
          onApply={(task) => void onApply(task, openPerson)}
          onClose={() => setOpen(null)}
        />
      ) : null}
    </SafeAreaView>
  );
}

function Separator() {
  return <View style={separator.gap} />;
}

const separator = StyleSheet.create({ gap: { height: spacing.sm } });

function makeStyles(c: Palette) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: c.ground },
    list: { padding: spacing.lg, paddingBottom: spacing.xxl },
    header: { gap: spacing.md, marginBottom: spacing.md },
    weeks: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    hint: { ...typeStyle('caption'), color: c.ink2, marginTop: 4 },
    limitBox: { borderWidth: 1, borderColor: c.line, backgroundColor: c.surface2, borderRadius: radius.input, padding: spacing.md },
    limitText: { ...typeStyle('label'), color: c.ink2 },
    limitValue: { ...font('700'), color: c.ink },
    footer: { gap: spacing.md, marginTop: spacing.lg },
    legend: { flexDirection: 'row', flexWrap: 'wrap', columnGap: spacing.lg, rowGap: spacing.sm, borderWidth: 1, borderColor: c.line, backgroundColor: c.surface2, borderRadius: radius.card, padding: spacing.md },
    legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    mini: { width: 28, height: 20, borderRadius: radius.badge, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
    miniText: { ...font('700'), fontSize: 11, lineHeight: 14 },
    legendText: { ...typeStyle('caption'), color: c.ink2 },
    nobody: { ...typeStyle('body'), color: c.ink2, textAlign: 'center', paddingVertical: spacing.xl },
  });
}
