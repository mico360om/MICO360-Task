import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable, Modal, StyleSheet, RefreshControl } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useServices } from '../core/providers';
import { useReportOptions, useReportSummary, useReportTrend } from '../core/queries';
import { useColors } from '../core/theme';
import { Card, SectionTitle, Loader, ErrorNote, NoticeNote, Muted, TextField } from '../components/ui';
import { KeyboardAwareScrollView } from '../components/KeyboardAware';
import { BarChart, LineChart, type Line } from '../components/charts';
import { ApiError, isNetworkError } from '../lib/api-client';
import { companyTodayKey } from '../lib/due-date';
import {
  EXPORT_REPORTS, REPORT_FORMATS, PERIOD_PRESETS, TREND_CHARTS, activePreset, csvAllowed, longRangeNote, onTimeText, periodDays, periodRange,
  rangeProblem, readRange, reportDay, reportExportPath, reportFileName, statusBars, summarize, trendCharts, trendStats, workloadBars,
  type LineTone, type ReportFormat, type ReportKind, type TimeSeries, type TrendLine,
} from '../lib/reports';
import { categoryColorOf, spacing, radius, fontSize, type Palette } from '../lib/theme';
import type { AppScreenProps } from '../navigation/types';

type Option = { value: string; label: string };
type Range = { from: string; to: string };

/**
 * Reports (administrators), as the website's: project and team-member filters, summary tiles,
 * tasks by status, on-time delivery, the trend over a range (the last 7, 30 or 90 days, or dates of
 * your own) with its charts — completion over time, overdue, burndown and weekly velocity — then
 * project progress and employee workload. Excel / PDF / CSV exports follow the same filters and
 * range, named by the server, and go to the share sheet. The figures need a connection.
 */
export function ReportsScreen(_props: AppScreenProps<'Reports'>) {
  const c = useColors();
  const s = useMemo(() => makeStyles(c), [c]);
  const { exporter } = useServices();
  const today = companyTodayKey();
  const [projectId, setProjectId] = useState('');
  const [userId, setUserId] = useState('');
  const [range, setRange] = useState<Range>(() => periodRange(30, today));
  // "Choose dates": the two typed boxes, which may hold a date still being typed.
  const [ownDates, setOwnDates] = useState(false);
  const [boxes, setBoxes] = useState<Range>(range);
  const scope = { projectId: projectId || undefined, userId: userId || undefined };
  const filters = { ...scope, ...range };
  const summaryQ = useReportSummary(scope);
  const trendQ = useReportTrend(filters);
  const optionsQ = useReportOptions();
  const [kind, setKind] = useState<ReportKind>('export');
  const [busy, setBusy] = useState<ReportFormat | null>(null);
  const [msg, setMsg] = useState<{ error: boolean; text: string } | null>(null);
  const [picker, setPicker] = useState<'project' | 'member' | null>(null);

  const projects = optionsQ.data?.projects ?? [];
  const team = optionsQ.data?.team ?? [];
  const projectLabel = projects.find((p) => p.value === projectId)?.label ?? 'All projects';
  const memberLabel = team.find((p) => p.value === userId)?.label ?? 'All team';
  const preset = ownDates ? null : activePreset(range, today);

  function choosePreset(days: number) {
    const next = periodRange(days, today);
    setOwnDates(false);
    setRange(next);
    setBoxes(next);
  }
  function typeDates(next: Range) {
    setBoxes(next);
    const whole = readRange(next.from, next.to, today);
    if (whole) setRange(whole);
  }
  const problem = ownDates ? rangeProblem(boxes.from, boxes.to, today, range) : null;

  async function runExport(format: ReportFormat) {
    setBusy(format);
    setMsg(null);
    const info = EXPORT_REPORTS.find((r) => r.kind === kind)!;
    try {
      // The server names the file (report + filters + the company's day); the share sheet gets it.
      const { fileName } = await exporter.exportFile(reportExportPath(kind, format, filters), reportFileName(kind, format, today), info.label);
      setMsg({ error: false, text: `Ready: ${fileName}` });
    } catch (e) {
      setMsg({
        error: true,
        text: isNetworkError(e)
          ? 'Exports need a connection — check your connection and try again.'
          : e instanceof ApiError && e.status === 403
            ? 'Only administrators can export reports.'
            : 'Couldn’t export the report. Please try again.',
      });
    } finally {
      setBusy(null);
    }
  }

  const denied = summaryQ.error instanceof ApiError && summaryQ.error.status === 403;
  const data = summaryQ.data;
  const scopeText = [projectId ? projectLabel : 'all projects', userId ? memberLabel : null].filter(Boolean).join(' · ');

  return (
    <SafeAreaView style={s.safe} edges={['bottom']}>
      <KeyboardAwareScrollView
        contentContainerStyle={s.scroll}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={summaryQ.isRefetching || trendQ.isRefetching}
            onRefresh={() => {
              void summaryQ.refetch();
              void trendQ.refetch();
            }}
          />
        }
      >
        {denied ? (
          <ErrorNote message="Reports are available to administrators." />
        ) : (
          <>
            <Text style={s.intro}>Task delivery, project progress and team workload — with exports.</Text>
            <Card style={s.card}>
              <SectionTitle>Export</SectionTitle>
              <View style={s.chips} accessibilityRole="radiogroup" accessibilityLabel="Report to export">
                {EXPORT_REPORTS.map((r) => (
                  <Chip key={r.kind} label={r.label} on={kind === r.kind} onPress={() => { setKind(r.kind); setMsg(null); }} s={s} />
                ))}
              </View>
              <View style={s.formats}>
                {REPORT_FORMATS.map(({ format, label }) => {
                  const off = busy !== null || (format === 'csv' && !csvAllowed(kind));
                  return (
                    <Pressable
                      key={format}
                      accessibilityRole="button"
                      accessibilityLabel={`Export as ${label}`}
                      accessibilityHint={format === 'csv' && !csvAllowed(kind) ? 'Choose a single report for CSV' : undefined}
                      accessibilityState={{ disabled: off, busy: busy === format }}
                      disabled={off}
                      onPress={() => void runExport(format)}
                      style={({ pressed }) => [s.fmt, off && s.fmtOff, pressed && s.pressed]}
                    >
                      <Text style={[s.fmtText, off && s.fmtTextOff]}>{busy === format ? 'Exporting…' : `⬇ ${label}`}</Text>
                    </Pressable>
                  );
                })}
              </View>
              <Muted style={s.hint}>
                {kind === 'export' ? 'Every section in one file. ' : ''}
                {kind === 'export' || kind === 'timeseries' ? 'Exports follow the filters and the trend’s dates below.' : 'Exports follow the filters below.'}
                {!csvAllowed(kind) ? ' Choose a single report for CSV.' : ''}
              </Muted>
              {msg ? (msg.error ? <ErrorNote message={msg.text} /> : <NoticeNote message={msg.text} />) : null}
            </Card>

            <Card style={s.card}>
              <SectionTitle>Filter</SectionTitle>
              <Field label="Project" value={projectLabel} onPress={() => setPicker('project')} s={s} />
              <Field label="Team member" value={memberLabel} onPress={() => setPicker('member')} s={s} />
              {projectId || userId ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Clear the filters"
                  onPress={() => { setProjectId(''); setUserId(''); }}
                  style={({ pressed }) => [s.clear, pressed && s.pressed]}
                >
                  <Text style={s.clearText}>Clear</Text>
                </Pressable>
              ) : null}
              {projectId || userId ? (
                <Muted style={s.hint}>
                  Showing {projectId ? projectLabel : 'all projects'}
                  {userId ? ` · ${memberLabel}’s tasks` : ''} — charts, tiles and exports
                </Muted>
              ) : null}
            </Card>

            {summaryQ.isLoading ? (
              <Loader />
            ) : summaryQ.isError && !data ? (
              <ErrorNote
                message={isNetworkError(summaryQ.error) ? 'Reports need a connection — you appear to be offline.' : 'Couldn’t load reports.'}
                onRetry={() => void summaryQ.refetch()}
                retrying={summaryQ.isRefetching}
              />
            ) : data ? (
              <Summary data={data} projectId={projectId} c={c} s={s} />
            ) : null}

            {data ? (
              <Card style={s.card}>
                <SectionTitle>Trends &amp; burndown</SectionTitle>
                <Muted style={s.hint}>
                  {reportDay(range.from)} – {reportDay(range.to)} · {periodDays(range)} days · {scopeText}
                </Muted>
                <View style={s.chips} accessibilityRole="radiogroup" accessibilityLabel="Dates of the trend">
                  {PERIOD_PRESETS.map((n) => (
                    <Chip key={n} label={`Last ${n} days`} on={preset === n} onPress={() => choosePreset(n)} s={s} />
                  ))}
                  <Chip
                    label="Choose dates"
                    on={ownDates || preset === null}
                    onPress={() => {
                      setOwnDates(true);
                      setBoxes(range);
                    }}
                    s={s}
                  />
                </View>
                {ownDates ? (
                  <View style={s.dates}>
                    <View style={s.dateBox}>
                      <TextField
                        label="From"
                        value={boxes.from}
                        onChangeText={(v) => typeDates({ ...boxes, from: v })}
                        placeholder="YYYY-MM-DD"
                        keyboardType="numbers-and-punctuation"
                        maxLength={10}
                        autoCorrect={false}
                        accessibilityLabel="From date, YYYY-MM-DD"
                      />
                    </View>
                    <View style={s.dateBox}>
                      <TextField
                        label="To"
                        value={boxes.to}
                        onChangeText={(v) => typeDates({ ...boxes, to: v })}
                        placeholder="YYYY-MM-DD"
                        keyboardType="numbers-and-punctuation"
                        maxLength={10}
                        autoCorrect={false}
                        accessibilityLabel="To date, YYYY-MM-DD"
                      />
                    </View>
                  </View>
                ) : null}
                {problem ? (
                  <Text style={s.problem} accessibilityRole="alert" accessibilityLiveRegion="polite">
                    {problem}
                  </Text>
                ) : null}
                {longRangeNote(range) ? <Muted style={s.hint}>{longRangeNote(range)}</Muted> : null}
                <Trend q={trendQ} c={c} s={s} />
              </Card>
            ) : null}

            {data ? <Tables data={data} projectId={projectId} userId={userId} memberLabel={memberLabel} c={c} s={s} /> : null}
          </>
        )}
      </KeyboardAwareScrollView>
      <OptionSheet
        visible={picker !== null}
        title={picker === 'member' ? 'Team member' : 'Project'}
        options={[{ value: '', label: picker === 'member' ? 'All team' : 'All projects' }, ...(picker === 'member' ? team : projects)]}
        selected={picker === 'member' ? userId : projectId}
        onPick={(v) => {
          if (picker === 'member') setUserId(v);
          else setProjectId(v);
          setPicker(null);
        }}
        onClose={() => setPicker(null)}
        s={s}
      />
    </SafeAreaView>
  );
}

type Styles = ReturnType<typeof makeStyles>;
type SummaryData = NonNullable<ReturnType<typeof useReportSummary>['data']>;

/** The tiles, tasks by status and on-time delivery. */
function Summary({ data, projectId, c, s }: { data: SummaryData; projectId: string; c: Palette; s: Styles }) {
  const sum = summarize(data.projects, { projectId: projectId || undefined });
  const completion = data.completion;
  const bars = statusBars(data.status).map((b) => ({ label: b.label, value: b.value, color: categoryColorOf(c, b.category) }));
  return (
    <>
      <View style={s.tiles}>
        <Tile value={sum.total} label="Total tasks" hint={`${sum.projects} project${sum.projects === 1 ? '' : 's'}`} tone={c.brand} s={s} />
        <Tile value={sum.completed} label="Completed" hint={`${sum.completionPct}% completion`} tone={c.success} s={s} />
        <Tile value={sum.overdue} label="Overdue" hint={sum.total ? `${sum.overduePct}% of tasks` : '—'} tone={c.danger} s={s} />
        <Tile
          value={completion ? `${completion.onTimeRate}%` : '—'}
          label="On-time rate"
          hint={completion ? `${completion.onTime} on time · ${completion.late} late` : 'No completion data yet.'}
          tone={c.info}
          s={s}
        />
      </View>

      <Card style={s.card}>
        <SectionTitle>Tasks by status</SectionTitle>
        <BarChart title="Tasks by status" data={bars} />
      </Card>

      <Card style={s.card}>
        <SectionTitle>On-time delivery</SectionTitle>
        {completion ? (
          <>
            <View style={s.onTime}>
              <Big value={completion.onTime} label="On time" tone={c.success} s={s} />
              <Big value={completion.late} label="Late" tone={c.danger} s={s} />
              <Big value={completion.unclassified} label="No due date" tone={c.ink2} s={s} />
            </View>
            <View style={s.onTimeTrack} importantForAccessibility="no-hide-descendants">
              <View style={[s.onTimeFill, { width: `${Math.min(100, Math.max(0, completion.onTimeRate))}%` }]} />
            </View>
            <Text style={s.onTimeText}>{onTimeText(completion)}</Text>
          </>
        ) : (
          <Muted>No completion data yet.</Muted>
        )}
      </Card>
    </>
  );
}

/** The trend: the range's figures, then the four charts. */
function Trend({ q, c, s }: { q: ReturnType<typeof useReportTrend>; c: Palette; s: Styles }) {
  if (q.isError && !q.data) {
    return (
      <ErrorNote
        message={isNetworkError(q.error) ? 'Couldn’t load trends — you appear to be offline.' : 'Couldn’t load trends.'}
        onRetry={() => void q.refetch()}
        retrying={q.isRefetching}
      />
    );
  }
  if (q.isLoading || !q.data) return <Loader />;
  const series: TimeSeries = q.data;
  const t = trendStats(series);
  const charts = trendCharts(series);
  const color = (tone: LineTone) => ({ done: c.category.DONE, muted: c.ink3, danger: c.danger, brand: c.brand })[tone];
  const lines = (ls: TrendLine[]): Line[] => ls.map((l) => ({ name: l.name, values: l.values, color: color(l.tone), area: l.area, dashed: l.dashed }));
  const byKey = { completion: lines(charts.completion), overdue: lines(charts.overdue), burndown: lines(charts.burndown) };
  return (
    <>
      <View style={s.minis}>
        <Mini value={t.completed} label="Completed in range" tone={c.success} s={s} />
        <Mini value={t.created} label="New tasks in range" tone={c.info} s={s} />
        <Mini value={`${t.velocityPerWeek}/wk`} label="Velocity" tone={c.brand} s={s} />
        <Mini value={t.overdueNow} label="Overdue now" tone={c.danger} s={s} />
      </View>
      {TREND_CHARTS.map((chart) => (
        <View key={chart.key} style={s.chart}>
          <Text style={s.chartTitle} accessibilityRole="header">
            {chart.title}
          </Text>
          <Text style={s.chartAbout}>{chart.about(t.velocityPerWeek)}</Text>
          {chart.key === 'velocity' ? (
            <BarChart title="Tasks completed per week" data={charts.velocity} />
          ) : (
            <LineChart title={chart.title} labels={charts.labels} lines={byKey[chart.key]} />
          )}
        </View>
      ))}
    </>
  );
}

/** Project progress and employee workload. */
function Tables({ data, projectId, userId, memberLabel, c, s }: { data: SummaryData; projectId: string; userId: string; memberLabel: string; c: Palette; s: Styles }) {
  const rows = [...data.projects].filter((p) => !projectId || p.projectId === projectId).sort((a, b) => b.completionPct - a.completionPct);
  const team = [...data.workload].filter((w) => !userId || w.userId === userId).sort((a, b) => b.assigned - a.assigned);
  return (
    <>
      <Card style={s.card}>
        <SectionTitle>Project progress</SectionTitle>
        {rows.length === 0 ? <Muted>No projects yet.</Muted> : null}
        {rows.map((r, i) => (
          <View
            key={r.projectId}
            style={[s.listRow, i > 0 && s.listRowLine]}
            accessible
            accessibilityLabel={`${r.projectName}: ${r.completionPct}% complete. ${r.total} total, ${r.completed} completed, ${r.total - r.completed} pending, ${r.overdue} overdue`}
          >
            <View style={s.listHead}>
              <Text style={s.listName}>{r.projectName}</Text>
              <Text style={s.listPct}>{r.completionPct}%</Text>
            </View>
            <View style={s.track}>
              <View style={[s.fill, { width: `${Math.min(100, r.completionPct)}%`, backgroundColor: c.brand }]} />
            </View>
            <Text style={s.listMeta}>
              {r.total} total · {r.completed} completed · {r.total - r.completed} pending
              {r.overdue ? <Text style={{ color: c.danger }}> · {r.overdue} overdue</Text> : null}
            </Text>
          </View>
        ))}
      </Card>

      <Card style={s.card}>
        <SectionTitle>{userId ? `Employee workload · ${memberLabel}` : 'Employee workload'}</SectionTitle>
        {team.length === 0 ? (
          <Muted>No workload data.</Muted>
        ) : (
          <>
            <Text style={s.chartAbout}>Assigned tasks by team member</Text>
            <BarChart title="Assigned tasks by team member" data={workloadBars(data.workload, userId)} />
          </>
        )}
        {team.map((w, i) => {
          const pct = w.assigned ? Math.round((w.completed / w.assigned) * 100) : 0;
          return (
            <View
              key={w.userId}
              style={[s.wlRow, i === 0 && s.wlFirst, i > 0 && s.listRowLine]}
              accessible
              accessibilityLabel={`${w.name || w.username}: ${w.assigned} assigned, ${w.completed} completed, ${w.overdue} overdue, ${pct}% complete`}
            >
              <Text style={s.listName}>{w.name || w.username}</Text>
              <Text style={s.wlNums}>
                {w.assigned} assigned · {w.completed} completed · {pct}% complete
                {w.overdue ? <Text style={{ color: c.danger }}> · {w.overdue} overdue</Text> : null}
              </Text>
            </View>
          );
        })}
      </Card>
    </>
  );
}

function Chip({ label, on, onPress, s }: { label: string; on: boolean; onPress: () => void; s: Styles }) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected: on, checked: on }}
      onPress={onPress}
      style={({ pressed }) => [s.chip, on && s.chipOn, pressed && s.pressed]}
    >
      <Text style={[s.chipText, on && s.chipTextOn]}>{label}</Text>
    </Pressable>
  );
}

function Field({ label, value, onPress, s }: { label: string; value: string; onPress: () => void; s: Styles }) {
  return (
    <View style={s.fieldWrap}>
      <Text style={s.fieldLabel}>{label}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${value}. Change`}
        onPress={onPress}
        style={({ pressed }) => [s.field, pressed && s.pressed]}
      >
        <Text style={s.fieldValue} numberOfLines={1}>{value}</Text>
        <Text style={s.fieldCaret}>▾</Text>
      </Pressable>
    </View>
  );
}

function Tile({ value, label, hint, tone, s }: { value: string | number; label: string; hint: string; tone: string; s: Styles }) {
  return (
    <View style={s.tile} accessible accessibilityLabel={`${label}: ${value}. ${hint}`}>
      <Text style={[s.tileValue, { color: tone }]}>{value}</Text>
      <Text style={s.tileLabel}>{label}</Text>
      <Text style={s.tileHint}>{hint}</Text>
    </View>
  );
}

function Mini({ value, label, tone, s }: { value: string | number; label: string; tone: string; s: Styles }) {
  return (
    <View style={s.mini} accessible accessibilityLabel={`${label}: ${value}`}>
      <Text style={[s.miniValue, { color: tone }]}>{value}</Text>
      <Text style={s.miniLabel}>{label}</Text>
    </View>
  );
}

function Big({ value, label, tone, s }: { value: number; label: string; tone: string; s: Styles }) {
  return (
    <View style={s.big} accessible accessibilityLabel={`${label}: ${value}`}>
      <Text style={[s.bigValue, { color: tone }]}>{value}</Text>
      <Text style={s.miniLabel}>{label}</Text>
    </View>
  );
}

function OptionSheet({
  visible, title, options, selected, onPick, onClose, s,
}: { visible: boolean; title: string; options: Option[]; selected: string; onPick: (v: string) => void; onClose: () => void; s: Styles }) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={s.backdrop} accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} />
      <View style={[s.sheet, { paddingBottom: insets.bottom + spacing.md }]}>
        <Text style={s.sheetTitle}>{title}</Text>
        <ScrollView>
          {options.map((o) => (
            <Pressable
              key={o.value || 'all'}
              accessibilityRole="button"
              accessibilityState={{ selected: o.value === selected }}
              onPress={() => onPick(o.value)}
              style={({ pressed }) => [s.option, pressed && s.pressed]}
            >
              <Text style={[s.optionText, o.value === selected && s.optionOn]}>{o.label}</Text>
              {o.value === selected ? <Text style={s.optionOn}>✓</Text> : null}
            </Pressable>
          ))}
        </ScrollView>
      </View>
    </Modal>
  );
}

function makeStyles(c: Palette) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: c.ground },
    scroll: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl },
    intro: { fontSize: fontSize.sm, color: c.ink2 },
    card: { gap: spacing.sm },
    pressed: { opacity: 0.7 },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    chip: { borderWidth: 1, borderColor: c.line, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, minHeight: 40, justifyContent: 'center', backgroundColor: c.surface },
    chipOn: { borderColor: c.brand, backgroundColor: c.brandWash },
    chipText: { fontSize: fontSize.sm, fontWeight: '600', color: c.ink2 },
    chipTextOn: { color: c.brand },
    formats: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.xs },
    fmt: { flexGrow: 1, flexBasis: 90, minHeight: 48, borderRadius: radius.md, borderWidth: 1, borderColor: c.brand, alignItems: 'center', justifyContent: 'center', backgroundColor: c.surface, paddingHorizontal: spacing.sm },
    fmtOff: { borderColor: c.line },
    fmtText: { fontSize: fontSize.sm, fontWeight: '700', color: c.brand },
    fmtTextOff: { color: c.ink3 },
    hint: { fontSize: fontSize.xs },
    fieldWrap: { gap: spacing.xs },
    fieldLabel: { fontSize: fontSize.xs, fontWeight: '700', color: c.ink2, textTransform: 'uppercase', letterSpacing: 0.6, marginTop: spacing.xs },
    field: { minHeight: 48, borderWidth: 1, borderColor: c.line, borderRadius: radius.md, paddingHorizontal: spacing.md, flexDirection: 'row', alignItems: 'center', backgroundColor: c.surface },
    fieldValue: { flex: 1, fontSize: fontSize.md, color: c.ink, textAlign: 'auto' },
    fieldCaret: { color: c.ink3, fontSize: fontSize.md },
    clear: { alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center' },
    clearText: { fontSize: fontSize.sm, fontWeight: '700', color: c.brand },
    dates: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    dateBox: { flexGrow: 1, flexBasis: 140 },
    problem: { fontSize: fontSize.sm, fontWeight: '600', color: c.danger },
    tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    tile: { flexBasis: '47%', flexGrow: 1, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: radius.lg, padding: spacing.md },
    tileValue: { fontSize: fontSize.xxl, fontWeight: '800' },
    tileLabel: { fontSize: fontSize.xs, fontWeight: '700', color: c.ink2, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 2 },
    tileHint: { fontSize: fontSize.xs, color: c.ink2, marginTop: 4 },
    onTime: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg },
    big: { minWidth: 72 },
    bigValue: { fontSize: fontSize.xxl, fontWeight: '800' },
    onTimeTrack: { height: 12, borderRadius: radius.pill, backgroundColor: c.ground, overflow: 'hidden' },
    onTimeFill: { height: '100%', backgroundColor: c.success },
    onTimeText: { fontSize: fontSize.sm, color: c.ink2 },
    minis: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    mini: { flexBasis: '47%', flexGrow: 1, borderWidth: 1, borderColor: c.line, borderRadius: radius.md, padding: spacing.sm, backgroundColor: c.ground },
    miniValue: { fontSize: fontSize.lg, fontWeight: '800' },
    miniLabel: { fontSize: fontSize.xs, color: c.ink2, fontWeight: '600' },
    chart: { gap: 2, marginTop: spacing.md },
    chartTitle: { fontSize: fontSize.md, fontWeight: '700', color: c.ink },
    chartAbout: { fontSize: fontSize.xs, color: c.ink2, marginBottom: spacing.xs },
    track: { height: 8, borderRadius: radius.pill, backgroundColor: c.ground, overflow: 'hidden' },
    fill: { height: '100%', borderRadius: radius.pill },
    listRow: { paddingVertical: spacing.sm, gap: 6 },
    listRowLine: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.line },
    listHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    listName: { flex: 1, fontSize: fontSize.md, fontWeight: '600', color: c.ink, textAlign: 'auto' },
    listPct: { fontSize: fontSize.sm, fontWeight: '700', color: c.ink },
    listMeta: { fontSize: fontSize.xs, color: c.ink2 },
    wlRow: { paddingVertical: spacing.sm, gap: 2 },
    wlFirst: { marginTop: spacing.sm },
    wlNums: { fontSize: fontSize.xs, color: c.ink2 },
    backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' },
    sheet: { maxHeight: '70%', backgroundColor: c.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, paddingTop: spacing.md },
    sheetTitle: { fontSize: fontSize.lg, fontWeight: '700', color: c.ink, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
    option: { minHeight: 48, paddingHorizontal: spacing.lg, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.line },
    optionText: { flex: 1, fontSize: fontSize.md, color: c.ink, textAlign: 'auto' },
    optionOn: { color: c.brand, fontWeight: '700' },
  });
}
