import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useServices } from '../../core/providers';
import { useColors } from '../../core/theme';
import { useWaitingInspections } from '../../core/inspection-sync';
import { useDueChecks, useInspectionForms, useInspectionSchedules, useProjectInspections } from '../../core/inspection-queries';
import { openWebsitePage } from '../../adapters/website';
import { appTimeZone } from '../../lib/due-date';
import { INSPECTIONS_TAB_WORDS as W, isFirstRun, waitingBannerText } from '../../lib/inspection-tab';
import type { InspectionListItem } from '../../lib/inspection-types';
import { problemText } from '../../lib/inspection-words';
import { radius, spacing } from '../../lib/theme';
import { typeStyle } from '../../lib/typography';
import type { AppStackParamList } from '../../navigation/types';
import { Icon } from '../Icon';
import { Button, Card, EmptyState, ErrorNote, SectionTitle, SkeletonList } from '../ui';
import { DueChecksSection } from '../inspections/DueChecksSection';
import { SchedulesSection } from '../inspections/SchedulesSection';
import { InspectionRow } from '../inspections/InspectionRow';
import { StartInspectionSheet, type InspectionTaskOption } from '../inspections/StartInspectionSheet';

const FORMS_TAB = '/templates?tab=inspections';

/** One of the lists (In progress, Finished): its rows, or what to say when there are none. */
function Group({ title, items, timeZone, empty }: { title: string; items: InspectionListItem[]; timeZone: string; empty: string }) {
  const c = useColors();
  return (
    <Card>
      <SectionTitle>{`${title} (${items.length})`}</SectionTitle>
      {items.length ? (
        <View style={s.rows}>
          {items.map((x) => (
            <InspectionRow key={x.id} x={x} timeZone={timeZone} />
          ))}
        </View>
      ) : (
        <Text style={[typeStyle('body'), { color: c.ink2 }]}>{empty}</Text>
      )}
    </Card>
  );
}

/**
 * A project's inspections, as the website's tab: the checks due (late ones first) and the schedules
 * that make them, then those in progress and the finished reports; anyone on the team starts one
 * from a form (with a connection). Inspections with changes still on this phone are named, so nobody
 * wonders where they went. The lists are kept on the phone, so the tab opens with no signal. The
 * forms themselves are made on the website ("Manage forms").
 */
export function InspectionsTab({
  projectId,
  tasks,
  onOpenTask,
}: {
  projectId: string;
  tasks: InspectionTaskOption[];
  onOpenTask?: (taskId: string) => void;
}) {
  const c = useColors();
  const { baseUrl } = useServices();
  const navigation = useNavigation<NativeStackNavigationProp<AppStackParamList>>();
  const timeZone = appTimeZone();
  const [starting, setStarting] = useState(false);
  const q = useProjectInspections(projectId);
  const formsQ = useInspectionForms();
  const checksQ = useDueChecks(projectId);
  const schedulesQ = useInspectionSchedules(projectId);
  const allWaiting = useWaitingInspections();
  const waiting = useMemo(() => allWaiting.filter((w) => w.projectId === projectId), [allWaiting, projectId]);
  const all = q.data?.inspections ?? [];
  const inProgress = all.filter((x) => x.status === 'IN_PROGRESS');
  const finished = all.filter((x) => x.status === 'FINISHED');
  const settledQ = (x: { isSuccess: boolean; isError: boolean }) => x.isSuccess || x.isError;
  const settled = !!q.data && settledQ(formsQ) && settledQ(checksQ) && settledQ(schedulesQ);
  const canCreate = !!formsQ.data?.canCreate;
  const openForms = () => openWebsitePage(baseUrl, FORMS_TAB);
  const firstRun =
    settled &&
    isFirstRun({ inspections: all, forms: formsQ.data?.forms, checks: checksQ.data?.checks, schedules: schedulesQ.data?.schedules, waiting: waiting.length });

  if (firstRun) {
    return (
      <EmptyState
        icon="misc.inspection"
        title={W.emptyTitle}
        subtitle={`${W.emptyBase}${canCreate ? W.emptyCanCreate : W.emptyAsk}`}
        action={canCreate ? { title: W.makeForm, onPress: openForms } : undefined}
      />
    );
  }

  const banner = waitingBannerText(waiting);
  return (
    <View style={s.stack}>
      <View style={s.head}>
        <View style={s.intro}>
          <Icon name="misc.inspection" size={16} color={c.ink2} />
          <Text style={[typeStyle('body'), s.grow, { color: c.ink2 }]}>{W.intro}</Text>
        </View>
        <View style={s.actions}>
          {canCreate ? <Button title={W.manageForms} variant="ghost" size="sm" onPress={openForms} accessibilityHint="Opens on the website" /> : null}
          {q.data?.canStart ? <Button title={W.start} size="sm" onPress={() => setStarting(true)} /> : null}
        </View>
      </View>
      {banner ? (
        <View style={[s.banner, { backgroundColor: c.infoSoft, borderColor: c.info }]} accessibilityLiveRegion="polite">
          <Icon name="ui.wifiOff" size={16} color={c.infoText} />
          <Text style={[typeStyle('body'), s.grow, { color: c.infoText }]}>{banner}</Text>
        </View>
      ) : null}
      {q.isLoading || (q.data && !settled) ? <SkeletonList rows={2} /> : null}
      {q.isError && !q.data ? <ErrorNote message={problemText(q.error, W.loadFailed)} onRetry={() => void q.refetch()} retrying={q.isFetching} /> : null}
      {q.data && settled ? (
        <>
          <DueChecksSection projectId={projectId} canStart={q.data.canStart} onOpenTask={onOpenTask} />
          <SchedulesSection projectId={projectId} canChange={q.data.canStart} />
          <Group title={W.inProgress} items={inProgress} timeZone={timeZone} empty={W.noneInProgress} />
          <Group title={W.finished} items={finished} timeZone={timeZone} empty={W.noneFinished} />
        </>
      ) : null}
      {starting ? (
        <StartInspectionSheet
          projectId={projectId}
          tasks={tasks}
          onClose={() => setStarting(false)}
          onStarted={(started) => {
            setStarting(false);
            navigation.navigate('Inspection', { inspectionId: started.id, title: started.title });
          }}
        />
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  stack: { gap: spacing.md },
  head: { gap: spacing.sm },
  intro: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  grow: { flex: 1 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, alignItems: 'center' },
  banner: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, borderWidth: 1, borderRadius: radius.button, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  rows: { gap: spacing.sm },
});
