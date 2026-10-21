import React, { useCallback, useLayoutEffect, useMemo, useState } from 'react';
import { View, Text, FlatList, StyleSheet, RefreshControl, Alert, AccessibilityInfo } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { useDirectory, useProject, useProjectColumns, useProjectMeetings, useProjectMembers, useProjectTasks } from '../core/queries';
import { useProjectOwner } from '../core/project-queries';
import { useBoardRealtime } from '../core/useBoardRealtime';
import { useServices, useSession } from '../core/providers';
import { useColors } from '../core/theme';
import { Badge, Button, ErrorNote, Loader } from '../components/ui';
import { ProjectAvatar } from '../components/ProjectAvatar';
import { InlinePicker, SheetMessage } from '../components/meeting/sheet-kit';
import { ProgressBar, StatTiles, Tabs, EmptyNote } from '../components/project/parts';
import { OverviewTab } from '../components/project/OverviewTab';
import { MeetingsTab } from '../components/project/MeetingsTab';
import { TeamTab } from '../components/project/TeamTab';
import { TaskGroupHeading, TasksTabBar, TasksTabRow, tasksTabItems, type TasksTabItem } from '../components/project/TasksTab';
import { ApiError, isNetworkError } from '../lib/api-client';
import { companyTodayKey } from '../lib/due-date';
import { projectStatusLabel, projectStatusTone } from '../lib/project-identity';
import { canEditProject, canManageProject } from '../lib/project-team';
import { ownerChangeProblem } from '../lib/project-list';
import {
  canScheduleIn,
  filterCounts,
  ownerName,
  shownGroups,
  statTiles,
  summaryRequest,
  taskGroups,
  taskStats,
  withColumnStage,
  type TaskFilter,
} from '../lib/project-dashboard';
import { displayName, type ApiTask } from '../lib/types';
import { spacing, fontSize, radius, type Palette } from '../lib/theme';
import type { AppScreenProps } from '../navigation/types';

type Tab = 'overview' | 'tasks' | 'meetings' | 'team';

/**
 * A project's dashboard (5b), as the website's: its picture, name, status and owner; the stat
 * tiles and completion; then Overview (details, work done and time, milestones, deadlines, the AI
 * status summary, who runs it and who has what, the next meeting, tasks by status), Tasks (every
 * task by status column, narrowed by where it stands or by words), Meetings and Team. Live: another
 * person's change to its tasks shows here at once. An administrator can edit the project and change
 * its owner; administrators and the project's managers run the team. It opens offline from the
 * last copy; every change needs a connection.
 */
export function ProjectDetailScreen({ route, navigation }: AppScreenProps<'ProjectDetail'>) {
  const { projectId } = route.params;
  const c = useColors();
  const s = useMemo(() => makeStyles(c), [c]);
  const { resources } = useServices();
  const user = useSession()?.user ?? null;
  const projectQ = useProject(projectId);
  const columnsQ = useProjectColumns(projectId);
  const tasksQ = useProjectTasks(projectId);
  const membersQ = useProjectMembers(projectId);
  const meetingsQ = useProjectMeetings(projectId);
  const dirQ = useDirectory();
  const focused = useIsFocused();
  // Live while in view (the board, opened over it, has its own): leave when taken off the project.
  useBoardRealtime(focused ? projectId : undefined, () => {
    Alert.alert('No longer available', 'You were removed from this project.');
    navigation.navigate('Tabs', { screen: 'Projects' });
  });

  const [tab, setTab] = useState<Tab>('overview');
  const [filter, setFilter] = useState<TaskFilter>('all');
  const [query, setQuery] = useState('');
  const [chatError, setChatError] = useState<string | null>(null);
  const [openingChat, setOpeningChat] = useState(false);
  const [ownerProblem, setOwnerProblem] = useState<string | null>(null);
  const ownerMut = useProjectOwner(projectId);

  const project = projectQ.data;
  const today = companyTodayKey();
  const columns = useMemo(() => columnsQ.data ?? [], [columnsQ.data]);
  const tasks = useMemo(() => withColumnStage(tasksQ.data ?? [], columns), [tasksQ.data, columns]);
  const stats = useMemo(() => taskStats(tasks, today), [tasks, today]);
  const groups = useMemo(() => taskGroups(columns, tasks), [columns, tasks]);
  const statsReady = !!tasksQ.data && !!columnsQ.data;
  const members = useMemo(() => membersQ.data ?? [], [membersQ.data]);
  const people = useMemo(() => dirQ.data ?? [], [dirQ.data]);
  const canManage = canManageProject(user, members);
  const canEdit = canEditProject(user);
  // Until the people list has loaded (offline, say), an owner shows as "—" rather than "Unknown".
  const owner = dirQ.data || !project?.ownerId ? ownerName(project?.ownerId, people) : '—';
  const canSchedule = canScheduleIn(project);
  const counts = useMemo(() => filterCounts(tasks, today), [tasks, today]);
  const items = useMemo<TasksTabItem[]>(() => (tab === 'tasks' ? tasksTabItems(shownGroups(groups, filter, query, today)) : []), [tab, groups, filter, query, today]);

  // The title follows the project's name (an edit renames it).
  useLayoutEffect(() => {
    if (project?.name) navigation.setOptions({ title: project.name });
  }, [navigation, project?.name]);

  const openTask = useCallback((t: Pick<ApiTask, 'id' | 'title'>) => navigation.navigate('TaskDetail', { taskId: t.id, title: t.title }), [navigation]);
  const openMeeting = (meetingId: string, title?: string | null) => navigation.navigate('MeetingDetail', { meetingId, title: title ?? undefined });
  const show = (next: 'tasks' | 'meetings' | 'team', f?: TaskFilter) => {
    if (f) setFilter(f);
    setTab(next);
  };

  async function openChat() {
    if (!project) return;
    setOpeningChat(true);
    setChatError(null);
    try {
      const { conversation } = await resources.chat.openProjectChannel(projectId);
      navigation.navigate('ChatThread', { conversationId: conversation.id, title: project.name, kind: 'PROJECT' });
    } catch (e) {
      setChatError(isNetworkError(e) ? 'You’re offline — try again when connected.' : e instanceof ApiError ? e.message : 'Couldn’t open the project chat.');
    } finally {
      setOpeningChat(false);
    }
  }

  function changeOwner(ownerId: string) {
    setOwnerProblem(null);
    ownerMut.mutate(ownerId || null, {
      onSuccess: () => AccessibilityInfo.announceForAccessibility('Owner changed.'),
      onError: (e) => setOwnerProblem(ownerChangeProblem(e)),
    });
  }

  const refreshing = projectQ.isRefetching || columnsQ.isRefetching || membersQ.isRefetching || tasksQ.isRefetching || meetingsQ.isRefetching;
  const refreshAll = () => {
    void projectQ.refetch();
    void columnsQ.refetch();
    void tasksQ.refetch();
    void membersQ.refetch();
    void meetingsQ.refetch();
  };

  if (projectQ.isLoading) return <Loader />;
  if (!project) {
    const missing = projectQ.error instanceof ApiError && projectQ.error.status === 404;
    return (
      <View style={s.safe}>
        <View style={s.missing}>
          <ErrorNote
            message={missing ? 'Project not found. It may have been deleted, or the link is wrong.' : 'Couldn’t load this project. Check your connection and try again.'}
            onRetry={missing ? undefined : () => void projectQ.refetch()}
            retrying={projectQ.isRefetching}
          />
        </View>
      </View>
    );
  }

  const ownerOptions = [{ value: '', label: 'No owner' }, ...people.map((u) => ({ value: u.id, label: displayName(u), hint: `@${u.username}` }))];
  const meta = [project.code, project.number ? `Project no. ${project.number}` : null, project.clientName || null, `Owner: ${owner}`].filter(Boolean).join(' · ');

  const header = (
    <View style={s.head}>
      <View style={s.identity}>
        <ProjectAvatar project={project} size="lg" label />
        <View style={s.identityText}>
          <Text style={s.name} accessibilityRole="header">
            {project.name}
          </Text>
          <View style={s.badgeRow}>
            <Badge label={projectStatusLabel(project.status)} tone={projectStatusTone(project.status)} />
          </View>
          <Text style={s.meta}>{meta}</Text>
        </View>
      </View>
      {canEdit ? <Button title="✏️ Edit project" accessibilityLabel="Edit project" variant="secondary" onPress={() => navigation.navigate('ProjectForm', { projectId })} /> : null}
      <SheetMessage text={ownerProblem} />

      <StatTiles tiles={statTiles(stats, statsReady)} />
      <ProgressBar value={statsReady ? stats.pct : 0} label="Completion" />

      <Tabs
        label="Project dashboard"
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'overview', label: 'Overview' },
          { value: 'tasks', label: 'Tasks', count: stats.total },
          { value: 'meetings', label: 'Meetings', count: meetingsQ.data?.stats.upcoming ?? 0 },
          { value: 'team', label: 'Team', count: members.length },
        ]}
      />

      {tab === 'overview' ? (
        <OverviewTab
          project={project}
          tasks={tasks}
          groups={groups}
          stats={stats}
          statsReady={statsReady}
          today={today}
          members={members}
          ownerName={owner}
          ownerControl={
            canEdit ? <InlinePicker label="Project owner" options={ownerOptions} value={project.ownerId ?? ''} onChange={changeOwner} placeholder="No owner" disabled={ownerMut.isPending} /> : null
          }
          meetings={meetingsQ.data}
          meetingsLoading={meetingsQ.isLoading}
          onOpenTask={openTask}
          onOpenMeeting={openMeeting}
          onShow={show}
          onOpenBoard={() => navigation.navigate('Board', { projectId, projectName: project.name })}
          onOpenChat={() => void openChat()}
          chatBusy={openingChat}
          chatError={chatError}
          onNewMeeting={canSchedule ? () => navigation.navigate('MeetingForm', { projectId }) : undefined}
          summaryRequest={() => summaryRequest(project.name, tasks, stats)}
        />
      ) : null}

      {tab === 'tasks' ? (
        <View style={s.tasksHead}>
          {tasksQ.isLoading || columnsQ.isLoading ? (
            <Loader />
          ) : tasksQ.isError && !tasksQ.data ? (
            <ErrorNote message="The project’s tasks aren’t available right now." onRetry={() => void tasksQ.refetch()} retrying={tasksQ.isRefetching} />
          ) : tasks.length === 0 ? (
            <EmptyNote>No tasks in this project yet.</EmptyNote>
          ) : (
            <>
              <TasksTabBar counts={counts} filter={filter} onFilter={setFilter} query={query} onQuery={setQuery} />
              {items.length === 0 ? <EmptyNote>No tasks match.</EmptyNote> : null}
            </>
          )}
        </View>
      ) : null}

      {tab === 'meetings' ? (
        <MeetingsTab
          overview={meetingsQ.data}
          loading={meetingsQ.isLoading}
          failed={meetingsQ.isError}
          onRetry={() => void meetingsQ.refetch()}
          retrying={meetingsQ.isRefetching}
          onOpen={openMeeting}
          onSchedule={canSchedule ? () => navigation.navigate('MeetingForm', { projectId }) : undefined}
        />
      ) : null}

      {tab === 'team' ? (
        <TeamTab
          projectId={projectId}
          members={members}
          loadFailed={membersQ.isError}
          onRetry={() => void membersQ.refetch()}
          retrying={membersQ.isRefetching}
          canManage={canManage}
          people={people}
          myId={user?.id}
        />
      ) : null}
    </View>
  );

  return (
    <FlatList
      style={s.safe}
      contentContainerStyle={s.scroll}
      data={items}
      keyExtractor={(item) => (item.kind === 'group' ? `g:${item.group.id}` : `t:${item.task.id}`)}
      renderItem={({ item }) => (item.kind === 'group' ? <TaskGroupHeading group={item.group} /> : <TasksTabRow task={item.task} group={item.group} today={today} onOpen={openTask} />)}
      ListHeaderComponent={header}
      keyboardShouldPersistTaps="handled"
      initialNumToRender={20}
      windowSize={7}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refreshAll} />}
    />
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: c.ground },
    scroll: { padding: spacing.lg, paddingBottom: spacing.xxl },
    missing: { padding: spacing.lg },
    head: { gap: spacing.md, marginBottom: spacing.sm },
    identity: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, backgroundColor: c.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: c.line, padding: spacing.lg },
    identityText: { flex: 1, gap: spacing.xs },
    name: { fontSize: fontSize.xl, fontWeight: '800', color: c.ink },
    badgeRow: { flexDirection: 'row' },
    meta: { fontSize: fontSize.sm, color: c.ink2 },
    tasksHead: { gap: spacing.sm },
  });
