import React, { useMemo, useSyncExternalStore } from 'react';
import { View, ScrollView, StyleSheet, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useMyTasks, useProjects } from '../core/queries';
import { useAdminTotals } from '../core/project-queries';
import { useActivityFeed } from '../core/activity-queries';
import { useApprovals } from '../core/approval-queries';
import { useDueSoonTasks } from '../core/dashboard-queries';
import { useSession } from '../core/providers';
import { useColors } from '../core/theme';
import { SkeletonList } from '../components/ui';
import { SyncStatus } from '../components/SyncStatus';
import { AdminTotals } from '../components/AdminTotals';
import { WelcomeBand } from '../components/dashboard/WelcomeBand';
import { DashboardTiles } from '../components/dashboard/DashboardTiles';
import { FirstSteps } from '../components/dashboard/FirstSteps';
import { OpenTasksCard } from '../components/dashboard/OpenTasksCard';
import { ApprovalsCard } from '../components/dashboard/ApprovalsCard';
import { DueSoonCard } from '../components/dashboard/DueSoonCard';
import { RecentActivityCard } from '../components/dashboard/RecentActivityCard';
import { activityRows, dashboardTiles, dueSoonRows, isFirstDay, welcomeBand, type DashboardLink } from '../lib/dashboard';
import { myDueCounts } from '../lib/dashboard-tiles';
import { dateZones, subscribeTimeZone } from '../lib/due-date';
import { spacing, type Palette } from '../lib/theme';
import type { TabScreenProps } from '../navigation/types';

/**
 * The Dashboard, as the website's, in its phone order: the welcome band (the page's title), the four
 * tiles, then — on a new company's first day — the first steps instead of the rest; otherwise the
 * administrators' charts or your open tasks, the tasks waiting for your approval, Due soon and
 * Recent activity. Everyone else's Overdue and Due this week count company days and the company's
 * week (never the person's own settings), as the website does.
 */
export function DashboardScreen({ navigation }: TabScreenProps<'Dashboard'>) {
  const c = useColors();
  const styles = useMemo(() => makeStyles(c), [c]);
  const session = useSession();
  // The company's totals and charts are for administrators.
  const admin = !!session?.user.roles.includes('ADMIN');
  const zones = useSyncExternalStore(subscribeTimeZone, dateZones);

  const myTasksQ = useMyTasks();
  const projectsQ = useProjects();
  const dueSoonQ = useDueSoonTasks();
  const activityQ = useActivityFeed();
  const approvalsQ = useApprovals();
  const adminQ = useAdminTotals(admin);

  const mine = useMemo(
    () => (myTasksQ.data ? myDueCounts(myTasksQ.data, { timeZone: zones.company, weekStart: zones.companyWeekStart }) : undefined),
    [myTasksQ.data, zones.company, zones.companyWeekStart],
  );

  if (myTasksQ.isLoading) return <SkeletonList rows={6} />;

  const now = new Date();
  const tiles = dashboardTiles({ isAdmin: admin, myTasks: myTasksQ.data, projects: projectsQ.data, reportRows: adminQ.data?.projects, mine });
  const firstDay = isFirstDay({ projects: projectsQ.data, myTasks: myTasksQ.data, dueSoon: dueSoonQ.data });
  const band = welcomeBand({ firstDay, username: session?.user.username, now, timeZone: zones.company });
  const openTask = (taskId: string, title?: string) => navigation.navigate('TaskDetail', { taskId, title });
  // A tile opens its tab (My Tasks, Projects) or Reports.
  const openTile = (to: DashboardLink) => ('tab' in to ? navigation.navigate(to.tab) : navigation.navigate(to.screen));
  const refreshing = myTasksQ.isRefetching || projectsQ.isRefetching || dueSoonQ.isRefetching || activityQ.isRefetching;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              void myTasksQ.refetch();
              void projectsQ.refetch();
              void dueSoonQ.refetch();
              void activityQ.refetch();
              void approvalsQ.refetch();
              if (admin) void adminQ.refetch();
            }}
          />
        }
      >
        <WelcomeBand {...band} onOpenBoard={() => navigation.navigate('AllBoard')} onViewMyTasks={() => navigation.navigate('MyTasks')} />

        <SyncStatus />

        <DashboardTiles tiles={tiles} onOpen={openTile} />

        {firstDay ? (
          <FirstSteps isAdmin={admin} onCreateProject={() => navigation.navigate('ProjectForm')} onAddTeam={() => navigation.navigate('UserForm')} />
        ) : (
          <View style={styles.cards}>
            {admin ? <AdminTotals /> : (
              <OpenTasksCard
                tasks={myTasksQ.data}
                loading={false}
                failed={myTasksQ.isError && !myTasksQ.data}
                retrying={myTasksQ.isRefetching}
                onRetry={() => void myTasksQ.refetch()}
                onViewAll={() => navigation.navigate('MyTasks')}
                onOpenTask={(t) => openTask(t.id, t.title)}
              />
            )}
            <ApprovalsCard onOpenTask={openTask} />
            <DueSoonCard
              rows={dueSoonRows(dueSoonQ.data ?? [], now, zones.company)}
              loading={dueSoonQ.isLoading}
              failed={dueSoonQ.isError && !dueSoonQ.data}
              retrying={dueSoonQ.isRefetching}
              onRetry={() => void dueSoonQ.refetch()}
              onCalendar={() => navigation.navigate('Calendar')}
              onOpenTask={(t) => openTask(t.id, t.title)}
            />
            <RecentActivityCard
              rows={activityRows(activityQ.data ?? [], now.getTime())}
              loading={activityQ.isLoading}
              failed={activityQ.isError && !activityQ.data}
              retrying={activityQ.isRefetching}
              onRetry={() => void activityQ.refetch()}
              onViewAll={() => navigation.navigate('Activity')}
              onOpenTask={(taskId) => openTask(taskId)}
            />
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: c.ground },
    scroll: { padding: spacing.lg, gap: spacing.md },
    cards: { gap: spacing.md },
  });
