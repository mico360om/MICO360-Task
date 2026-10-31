import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import { useServices, useUserId } from '../core/providers';
import { useColors } from '../core/theme';
import { useManagementAccess, useManagementOverview } from '../core/management-queries';
import { Button, Card, ErrorNote, Muted, Skeleton, StatTile } from '../components/ui';
import { ManagementFilters } from '../components/management/ManagementFilters';
import { ItemsSheet } from '../components/management/ItemsSheet';
import { HealthSection } from '../components/management/HealthSection';
import { ApprovalsSection } from '../components/management/ApprovalsSection';
import { InspectionsSection } from '../components/management/InspectionsSection';
import { PeopleSection } from '../components/management/PeopleSection';
import { TrendsSection } from '../components/management/TrendsSection';
import { usePullRefresh } from '../components/meeting/live';
import { ApiError } from '../lib/api-client';
import { companyTodayKey } from '../lib/due-date';
import { DEFAULT_FILTERS, managementRoot, managementTiles, managementView, metaLine, pdfFallbackName, tileColumns } from '../lib/management';
import type { ItemQuery, ManagementFilters as Filters } from '../lib/management-api';
import { radius, spacing, type Palette } from '../lib/theme';
import { font, typeStyle } from '../lib/typography';
import type { AppScreenProps } from '../navigation/types';

const isRefusal = (e: unknown) => e instanceof ApiError && e.status === 403;

/** The page's placeholder while access or the first figures load: the tiles' grid and two sections. */
function ManagementSkeleton({ columns }: { columns: 1 | 2 }) {
  return (
    <View accessible accessibilityLabel="Loading the management overview" accessibilityState={{ busy: true }} style={skeleton.wrap}>
      <View style={skeleton.grid}>
        {Array.from({ length: 8 }, (_, i) => (
          <View key={i} style={columns === 2 ? skeleton.half : skeleton.full}>
            <Skeleton height={96} radius={radius.card} />
          </View>
        ))}
      </View>
      <Skeleton height={240} radius={radius.card} />
      <Skeleton height={200} radius={radius.card} />
    </View>
  );
}

/**
 * Management (the website's ManagementPage and ManagementRoute, Stage 3 Lane M): for administrators
 * and the people who run a project — every project's health, approvals, inspections, people and
 * trends, with the list behind each number, the page's filters and the same PDF. Who may see it is
 * the server's answer, per person (Review Focus 1): the figures are asked for only after it says
 * yes, drawn only while it does, and dropped from memory when it refuses them.
 */
export function ManagementScreen({ navigation }: AppScreenProps<'Management'>) {
  const c = useColors();
  const s = useMemo(() => makeStyles(c), [c]);
  const { resources, exporter } = useServices();
  const userId = useUserId() ?? '';
  const qc = useQueryClient();
  const { width, fontScale } = useWindowDimensions();
  const columns = tileColumns(width, fontScale);

  const access = useManagementAccess();
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const q = useManagementOverview(filters);
  const data = q.data;

  // Someone who had the page here and lost it is told why, not moved away — the person who had it.
  const hadAccessFor = useRef<string | null>(null);
  if (access.allowed && userId) hadAccessFor.current = userId;
  // A refusal stays one for this person: the figures are removed and the server asked again, and
  // nothing of the page shows meanwhile.
  const [refusedFor, setRefusedFor] = useState<string | null>(null);
  const refused = isRefusal(q.error) || refusedFor === userId;
  const view = managementView({ access, overviewError: refused ? (q.error ?? new ApiError(403, 'FORBIDDEN', 'Refused')) : q.error, hadAccess: hadAccessFor.current === userId });

  useEffect(() => {
    if (view !== 'leave') return;
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.navigate('Tabs', { screen: 'Dashboard' });
  }, [view, navigation]);
  const { retry } = access;
  useEffect(() => {
    if (view !== 'no-longer' || refusedFor === userId) return;
    setRefusedFor(userId);
    qc.removeQueries({ queryKey: managementRoot(userId) });
    retry();
  }, [view, refusedFor, userId, qc, retry]);

  const [sheet, setSheet] = useState<{ query: ItemQuery; label: string } | null>(null);
  const openList = useCallback((query: ItemQuery, label: string) => setSheet({ query, label }), []);

  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfProblem, setPdfProblem] = useState<string | null>(null);
  async function downloadPdf() {
    setPdfBusy(true);
    setPdfProblem(null);
    try {
      // The server makes the PDF and names it; the share sheet gets it.
      await exporter.exportFile(resources.management.pdfPath(filters), pdfFallbackName(data?.today ?? companyTodayKey()), 'Management overview');
    } catch {
      setPdfProblem('Couldn’t make the PDF. Please try again.');
    } finally {
      setPdfBusy(false);
    }
  }

  const { refetch } = q;
  const pull = usePullRefresh(useCallback(() => refetch(), [refetch]));

  if (view === 'check-failed') {
    return (
      <SafeAreaView style={s.safe} edges={['bottom']}>
        <View style={s.scroll}>
          <Card style={s.notice}>
            <View accessibilityRole="alert">
              <Text style={s.noticeTitle}>Couldn’t check whether you can see this page.</Text>
              <Text style={s.noticeText}>Check your connection, then try again.</Text>
            </View>
            <Button title="Try again" variant="secondary" size="sm" onPress={retry} style={s.noticeButton} />
          </Card>
        </View>
      </SafeAreaView>
    );
  }
  if (view === 'no-longer') {
    return (
      <SafeAreaView style={s.safe} edges={['bottom']}>
        <View style={s.scroll}>
          <Card style={s.notice}>
            <View accessibilityRole="alert">
              <Text style={s.noticeTitle}>You no longer run any projects, so the Management page isn’t open to you.</Text>
              <Text style={s.noticeText}>It shows the projects you own or manage. An administrator can name you as a project’s manager.</Text>
            </View>
            <Button title="Go to the dashboard" variant="secondary" size="sm" onPress={() => navigation.navigate('Tabs', { screen: 'Dashboard' })} style={s.noticeButton} />
          </Card>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe} edges={['bottom']}>
      <ScrollView
        contentContainerStyle={s.scroll}
        keyboardShouldPersistTaps="handled"
        refreshControl={view === 'show' ? <RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} /> : undefined}
      >
        {view === 'show' ? (
          <>
            <Muted style={s.subtitle}>Every project’s health, inspections, people and trends.</Muted>
            <View style={s.actions}>
              <Button title="Download PDF" variant="secondary" size="sm" icon="ui.download" loading={pdfBusy} disabled={!data} onPress={() => void downloadPdf()} />
            </View>
            {pdfProblem ? <ErrorNote message={pdfProblem} /> : null}
            {data ? <Text style={s.meta}>{metaLine(data)}</Text> : null}

            <ManagementFilters filters={filters} projects={data?.options.projects ?? []} owners={data?.options.owners ?? []} onChange={setFilters} />

            {q.isError && !data ? (
              <ErrorNote message="Couldn’t load the management overview." onRetry={() => void refetch()} retrying={q.isRefetching} />
            ) : !data ? (
              <ManagementSkeleton columns={columns} />
            ) : (
              <View style={[s.content, q.isFetching && q.isPlaceholderData ? s.stale : null]}>
                {q.isError ? <ErrorNote message="Couldn’t load the latest figures." onRetry={() => void refetch()} retrying={q.isRefetching} /> : null}
                <View style={s.tiles}>
                  {managementTiles(data).map((tile) => (
                    <View key={tile.label} style={columns === 2 ? s.half : s.full}>
                      <StatTile
                        label={tile.label}
                        value={tile.value}
                        hint={tile.hint}
                        tone={tile.tone}
                        onPress={tile.query ? () => openList(tile.query!, tile.label) : undefined}
                        actionLabel={tile.query ? `${tile.action}: show the list` : undefined}
                      />
                    </View>
                  ))}
                </View>
                <HealthSection
                  rows={data.projects}
                  today={data.today}
                  timeZone={data.timeZone}
                  onOpen={openList}
                  chosenHidden={filters.projectIds.length > 0}
                  noneAtAll={data.options.projects.length === 0}
                  onGoToProjects={() => navigation.navigate('Tabs', { screen: 'Projects' })}
                />
                {data.approvals ? <ApprovalsSection approvals={data.approvals} onOpen={openList} /> : null}
                <InspectionsSection data={data.inspections} onOpen={openList} />
                <PeopleSection people={data.people} week={data.workload.week} limit={data.workload.limit} onOpen={openList} />
                <TrendsSection weeks={data.trends} />
              </View>
            )}
          </>
        ) : (
          <ManagementSkeleton columns={columns} />
        )}
      </ScrollView>
      {view === 'show' && sheet ? <ItemsSheet filters={filters} query={sheet.query} label={sheet.label} timeZone={data?.timeZone ?? 'UTC'} onClose={() => setSheet(null)} /> : null}
    </SafeAreaView>
  );
}

const skeleton = StyleSheet.create({
  wrap: { gap: spacing.lg },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -spacing.xs },
  half: { width: '50%', padding: spacing.xs },
  full: { width: '100%', padding: spacing.xs },
});

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: c.ground },
    scroll: { padding: spacing.lg, paddingBottom: spacing.xxl },
    subtitle: { marginBottom: spacing.sm },
    actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.sm },
    meta: { ...typeStyle('caption'), color: c.ink2, marginBottom: spacing.md },
    content: { gap: spacing.lg },
    stale: { opacity: 0.6 },
    tiles: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -spacing.xs },
    half: { width: '50%', padding: spacing.xs },
    full: { width: '100%', padding: spacing.xs },
    notice: { gap: spacing.sm },
    noticeTitle: { ...typeStyle('bodyStrong'), color: c.ink },
    noticeText: { ...typeStyle('body'), ...font('400'), color: c.ink2, marginTop: spacing.xs },
    noticeButton: { alignSelf: 'flex-start', marginTop: spacing.xs },
  });
