import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable, Modal, StyleSheet, RefreshControl } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useServices } from '../core/providers';
import { useReportOptions, useReports } from '../core/queries';
import { useColors } from '../core/theme';
import { Card, SectionTitle, Loader, ErrorNote, NoticeNote, Muted } from '../components/ui';
import { ApiError, isNetworkError } from '../lib/api-client';
import { companyTodayKey } from '../lib/due-date';
import {
  EXPORT_REPORTS, REPORT_FORMATS, PERIOD_PRESETS, csvAllowed, periodDays, periodRange, reportExportPath, reportFileName,
  statusBars, summarize, trendStats, type ReportFormat, type ReportKind,
} from '../lib/reports';
import { categoryColorOf, spacing, radius, fontSize, type Palette } from '../lib/theme';
import type { AppScreenProps } from '../navigation/types';

type Option = { value: string; label: string };

/** "2026-09-25" → "25 Sep" (calendar day, no time zone shift). */
function shortDay(key: string): string {
  const [, m, d] = key.split('-');
  return `${Number(d)} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(m) - 1]}`;
}

/**
 * Reports (administrators) — the web portal's reports on the phone: project / team-member filters and
 * a period, summary tiles, status, the period's trend, project progress and team workload, and Excel /
 * PDF / CSV exports that follow the same filters (handed to the share sheet).
 */
export function ReportsScreen(_props: AppScreenProps<'Reports'>) {
  const c = useColors();
  const s = useMemo(() => makeStyles(c), [c]);
  const { exporter } = useServices();
  const today = companyTodayKey();
  const [projectId, setProjectId] = useState('');
  const [userId, setUserId] = useState('');
  const [days, setDays] = useState<number>(30);
  const period = periodRange(days, today);
  const filters = { projectId: projectId || undefined, userId: userId || undefined, ...period };
  const reportsQ = useReports(filters);
  const optionsQ = useReportOptions();
  const [kind, setKind] = useState<ReportKind>('export');
  const [busy, setBusy] = useState<ReportFormat | null>(null);
  const [msg, setMsg] = useState<{ error: boolean; text: string } | null>(null);
  const [picker, setPicker] = useState<'project' | 'member' | null>(null);

  const projects = optionsQ.data?.projects ?? [];
  const team = optionsQ.data?.team ?? [];
  const projectLabel = projects.find((p) => p.value === projectId)?.label ?? 'All projects';
  const memberLabel = team.find((p) => p.value === userId)?.label ?? 'All team';

  async function runExport(format: ReportFormat) {
    setBusy(format);
    setMsg(null);
    const info = EXPORT_REPORTS.find((r) => r.kind === kind)!;
    try {
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

  const denied = reportsQ.error instanceof ApiError && reportsQ.error.status === 403;
  const data = reportsQ.data;

  return (
    <SafeAreaView style={s.safe} edges={['bottom']}>
      <ScrollView
        contentContainerStyle={s.scroll}
        refreshControl={<RefreshControl refreshing={reportsQ.isRefetching} onRefresh={() => void reportsQ.refetch()} />}
      >
        {denied ? (
          <ErrorNote message="Reports are available to administrators." />
        ) : (
          <>
            <Card style={s.card}>
              <SectionTitle>Export</SectionTitle>
              <View style={s.chips}>
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
                      accessibilityState={{ disabled: off, busy: busy === format }}
                      disabled={off}
                      onPress={() => void runExport(format)}
                      style={({ pressed }) => [s.fmt, off && s.fmtOff, pressed && s.pressed]}
                    >
                      <Text style={[s.fmtText, off && s.fmtTextOff]}>{busy === format ? 'Preparing…' : `⬇ ${label}`}</Text>
                    </Pressable>
                  );
                })}
              </View>
              <Muted style={s.hint}>
                {kind === 'export' ? 'Every section in one file. ' : ''}Exports follow the filters below.
              </Muted>
              {msg ? (msg.error ? <ErrorNote message={msg.text} /> : <NoticeNote message={msg.text} />) : null}
            </Card>

            <Card style={s.card}>
              <SectionTitle>Filter</SectionTitle>
              <Field label="Project" value={projectLabel} onPress={() => setPicker('project')} s={s} />
              <Field label="Team member" value={memberLabel} onPress={() => setPicker('member')} s={s} />
              <Text style={s.fieldLabel}>Period</Text>
              <View style={s.chips}>
                {PERIOD_PRESETS.map((n) => (
                  <Chip key={n} label={`Last ${n} days`} on={days === n} onPress={() => setDays(n)} s={s} />
                ))}
              </View>
              <Muted style={s.hint}>
                {shortDay(period.from)} – {shortDay(period.to)} · {periodDays(period)} days
              </Muted>
            </Card>

            {reportsQ.isLoading ? (
              <Loader />
            ) : reportsQ.isError && !data ? (
              <ErrorNote
                message={isNetworkError(reportsQ.error) ? 'Reports need a connection — you appear to be offline.' : 'Couldn’t load the reports.'}
                onRetry={() => void reportsQ.refetch()}
                retrying={reportsQ.isRefetching}
              />
            ) : data ? (
              <Body data={data} projectId={projectId} userId={userId} c={c} s={s} />
            ) : null}
          </>
        )}
      </ScrollView>
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
type ReportData = NonNullable<ReturnType<typeof useReports>['data']>;

function Body({ data, projectId, userId, c, s }: { data: ReportData; projectId: string; userId: string; c: Palette; s: Styles }) {
  const sum = summarize(data.projects, { projectId: projectId || undefined });
  const t = trendStats(data.series);
  const bars = statusBars(data.status);
  const rows = [...data.projects].filter((p) => !projectId || p.projectId === projectId).sort((a, b) => b.completionPct - a.completionPct);
  const team = [...data.workload].filter((w) => !userId || w.userId === userId).sort((a, b) => b.assigned - a.assigned);
  const completion = data.completion;
  return (
    <>
      <View style={s.tiles}>
        <Tile value={sum.total} label="Total tasks" hint={`${sum.projects} project${sum.projects === 1 ? '' : 's'}`} tone={c.ink} s={s} />
        <Tile value={sum.completed} label="Completed" hint={`${sum.completionPct}% completion`} tone={c.success} s={s} />
        <Tile value={sum.overdue} label="Overdue" hint={sum.total ? `${sum.overduePct}% of tasks` : '—'} tone={c.danger} s={s} />
        <Tile
          value={completion ? `${completion.onTimeRate}%` : '—'}
          label="On-time rate"
          hint={completion ? `${completion.onTime} on time · ${completion.late} late` : 'No completed tasks'}
          tone={c.info}
          s={s}
        />
      </View>

      <Card style={s.card}>
        <SectionTitle>Tasks by status</SectionTitle>
        {bars.length === 0 ? <Muted>No tasks.</Muted> : null}
        {bars.map((b) => (
          <View key={b.category} style={s.barRow} accessible accessibilityLabel={`${b.label}: ${b.value} tasks, ${b.pct}%`}>
            <Text style={s.barLabel}>{b.label}</Text>
            <View style={s.track}>
              <View style={[s.fill, { width: `${b.pct}%`, backgroundColor: categoryColorOf(c, b.category) }]} />
            </View>
            <Text style={s.barNum}>{b.value}</Text>
          </View>
        ))}
      </Card>

      <Card style={s.card}>
        <SectionTitle>In the period</SectionTitle>
        <View style={s.minis}>
          <Mini value={t.completed} label="Completed" tone={c.success} s={s} />
          <Mini value={t.created} label="New tasks" tone={c.info} s={s} />
          <Mini value={`${t.velocityPerWeek}/wk`} label="Velocity" tone={c.ink} s={s} />
          <Mini value={t.overdueNow} label="Overdue now" tone={c.danger} s={s} />
        </View>
      </Card>

      <Card style={s.card}>
        <SectionTitle>Project progress</SectionTitle>
        {rows.length === 0 ? <Muted>No projects.</Muted> : null}
        {rows.map((r, i) => (
          <View key={r.projectId} style={[s.listRow, i > 0 && s.listRowLine]}>
            <View style={s.listHead}>
              <Text style={s.listName} numberOfLines={2}>{r.projectName}</Text>
              <Text style={s.listPct}>{r.completionPct}%</Text>
            </View>
            <View style={s.track}>
              <View style={[s.fill, { width: `${Math.min(100, r.completionPct)}%`, backgroundColor: c.brand }]} />
            </View>
            <Text style={s.listMeta}>
              {r.total} tasks · {r.completed} done · {r.total - r.completed} open
              {r.overdue ? <Text style={{ color: c.danger }}> · {r.overdue} overdue</Text> : null}
            </Text>
          </View>
        ))}
      </Card>

      <Card style={s.card}>
        <SectionTitle>Team workload</SectionTitle>
        {team.length === 0 ? <Muted>No team members.</Muted> : null}
        {team.map((w, i) => (
          <View key={w.userId} style={[s.wlRow, i > 0 && s.listRowLine]}>
            <Text style={s.listName} numberOfLines={1}>{w.name || w.username}</Text>
            <Text style={s.wlNums}>
              {w.assigned} assigned · {w.completed} done
              {w.overdue ? <Text style={{ color: c.danger }}> · {w.overdue} overdue</Text> : null}
            </Text>
          </View>
        ))}
      </Card>
    </>
  );
}

function Chip({ label, on, onPress, s }: { label: string; on: boolean; onPress: () => void; s: Styles }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
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
    card: { gap: spacing.sm },
    pressed: { opacity: 0.7 },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    chip: { borderWidth: 1, borderColor: c.line, borderRadius: radius.pill, paddingHorizontal: spacing.md, minHeight: 36, justifyContent: 'center', backgroundColor: c.surface },
    chipOn: { borderColor: c.brand, backgroundColor: c.brandWash },
    chipText: { fontSize: fontSize.sm, fontWeight: '600', color: c.ink2 },
    chipTextOn: { color: c.brand },
    formats: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
    fmt: { flex: 1, minHeight: 44, borderRadius: radius.md, borderWidth: 1, borderColor: c.brand, alignItems: 'center', justifyContent: 'center', backgroundColor: c.surface },
    fmtOff: { borderColor: c.line },
    fmtText: { fontSize: fontSize.sm, fontWeight: '700', color: c.brand },
    fmtTextOff: { color: c.ink3 },
    hint: { fontSize: fontSize.xs },
    fieldWrap: { gap: spacing.xs },
    fieldLabel: { fontSize: fontSize.xs, fontWeight: '700', color: c.ink2, textTransform: 'uppercase', letterSpacing: 0.6, marginTop: spacing.xs },
    field: { minHeight: 44, borderWidth: 1, borderColor: c.line, borderRadius: radius.md, paddingHorizontal: spacing.md, flexDirection: 'row', alignItems: 'center', backgroundColor: c.surface },
    fieldValue: { flex: 1, fontSize: fontSize.md, color: c.ink, textAlign: 'auto' },
    fieldCaret: { color: c.ink3, fontSize: fontSize.md },
    tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    tile: { flexBasis: '47%', flexGrow: 1, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: radius.lg, padding: spacing.md },
    tileValue: { fontSize: fontSize.xxl, fontWeight: '800' },
    tileLabel: { fontSize: fontSize.xs, fontWeight: '700', color: c.ink2, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 2 },
    tileHint: { fontSize: fontSize.xs, color: c.ink3, marginTop: 4 },
    barRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    barLabel: { width: 88, fontSize: fontSize.sm, color: c.ink2, fontWeight: '600' },
    track: { flex: 1, height: 8, borderRadius: radius.pill, backgroundColor: c.ground, overflow: 'hidden' },
    fill: { height: '100%', borderRadius: radius.pill },
    barNum: { width: 40, textAlign: 'right', fontSize: fontSize.sm, fontWeight: '700', color: c.ink },
    minis: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    mini: { flexBasis: '47%', flexGrow: 1, borderWidth: 1, borderColor: c.line, borderRadius: radius.md, padding: spacing.sm, backgroundColor: c.ground },
    miniValue: { fontSize: fontSize.lg, fontWeight: '800' },
    miniLabel: { fontSize: fontSize.xs, color: c.ink2, fontWeight: '600' },
    listRow: { paddingVertical: spacing.sm, gap: 6 },
    listRowLine: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.line },
    listHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    listName: { flex: 1, fontSize: fontSize.md, fontWeight: '600', color: c.ink, textAlign: 'auto' },
    listPct: { fontSize: fontSize.sm, fontWeight: '700', color: c.ink },
    listMeta: { fontSize: fontSize.xs, color: c.ink2 },
    wlRow: { paddingVertical: spacing.sm, gap: 2 },
    wlNums: { fontSize: fontSize.xs, color: c.ink2 },
    backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' },
    sheet: { maxHeight: '70%', backgroundColor: c.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, paddingTop: spacing.md },
    sheetTitle: { fontSize: fontSize.lg, fontWeight: '700', color: c.ink, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
    option: { minHeight: 48, paddingHorizontal: spacing.lg, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.line },
    optionText: { flex: 1, fontSize: fontSize.md, color: c.ink, textAlign: 'auto' },
    optionOn: { color: c.brand, fontWeight: '700' },
  });
}
