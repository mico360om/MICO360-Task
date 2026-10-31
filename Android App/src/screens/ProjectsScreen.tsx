import React, { useCallback, useMemo, useState, useSyncExternalStore } from 'react';
import { View, Text, FlatList, Pressable, ScrollView, StyleSheet, RefreshControl, AccessibilityInfo } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useProjectsOverview, useProjectStatus } from '../core/project-queries';
import { useRefetchOnFocus } from '../core/focus-refetch';
import { useSession } from '../core/providers';
import { useColors } from '../core/theme';
import { SkeletonList, EmptyState, ErrorNote, Button, Card, Chip, PageHeader, TextField, Toggle } from '../components/ui';
import { Icon } from '../components/Icon';
import { ProjectCard } from '../components/projects/ProjectCard';
import { ProjectStatusSheet } from '../components/projects/ProjectStatusSheet';
import { ArchiveProjectSheet } from '../components/projects/ArchiveProjectSheet';
import { ChoiceSheet } from '../components/my-tasks/ChoiceSheet';
import { companyTodayKey, dateZones, subscribeTimeZone } from '../lib/due-date';
import { projectStatusLabel } from '../lib/project-identity';
import {
  DEFAULT_LIST_STATE,
  EMPTY_TAB,
  PROJECTS_TEXT,
  PROJECT_SORTS,
  STATUS_TABS,
  countLine,
  filterProjects,
  headerSummary,
  inTab,
  ownerOptions,
  showAnotherProjectTile,
  sortProjects,
  tabCounts,
  type ProjectListState,
  type ProjectSort,
} from '../lib/projects-page';
import { canCreateProject, canManageProject } from '../lib/project-team';
import { spacing, radius, type Palette } from '../lib/theme';
import { font, typeStyle } from '../lib/typography';
import type { ProjectOverview } from '../lib/types';
import type { TabScreenProps } from '../navigation/types';

/**
 * Projects, as the website's page: find a project fast, see how each is doing, and manage them.
 * Status tabs with counts (one row that scrolls sideways), one search box, owner and sort, and for
 * administrators "Only my projects"; a card per project with its figures — the whole list from ONE
 * request (/projects/overview), kept for offline. Anyone may create a project; a card offers its
 * status menu, Edit and Archive to whoever may change it (an administrator, or the server's
 * canManage). A status change shows at once and needs a connection.
 */
export function ProjectsScreen({ navigation }: TabScreenProps<'Projects'>) {
  const c = useColors();
  const s = useMemo(() => makeStyles(c), [c]);
  const user = useSession()?.user ?? null;
  const admin = !!user?.roles.includes('ADMIN');
  const timeZone = useSyncExternalStore(subscribeTimeZone, dateZones).company;
  const query = useProjectsOverview();
  const all = useMemo(() => (Array.isArray(query.data) ? query.data : []), [query.data]);
  const [state, setState] = useState<ProjectListState>(DEFAULT_LIST_STATE);
  const update = useCallback((changes: Partial<ProjectListState>) => setState((st) => ({ ...st, ...changes })), []);
  const [picker, setPicker] = useState<'owner' | 'sort' | null>(null);
  const [statusFor, setStatusFor] = useState<ProjectOverview | null>(null);
  const [archiving, setArchiving] = useState<ProjectOverview | null>(null);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const changeStatus = useProjectStatus();

  // Read again as the tab comes into view, once, when the list it shows is out of date (a task change
  // marks it so) and isn't being read — never again and again while a read fails (fix pass B1).
  useRefetchOnFocus(query);
  const { refetch } = query;

  const open = useCallback((p: ProjectOverview) => navigation.navigate('ProjectDetail', { projectId: p.id, projectName: p.name }), [navigation]);
  const board = useCallback((p: ProjectOverview) => navigation.navigate('Board', { projectId: p.id, projectName: p.name }), [navigation]);
  const edit = useCallback((p: ProjectOverview) => navigation.navigate('ProjectForm', { projectId: p.id }), [navigation]);
  const newProject = () => navigation.navigate('ProjectForm');

  const runStatus = async (project: ProjectOverview, status: string) => {
    setProblem(null);
    const out = await changeStatus(project, status);
    if (out.ok) AccessibilityInfo.announceForAccessibility(`${project.name} is now ${projectStatusLabel(status).toLowerCase()}.`);
    else {
      setProblem(out.message);
      AccessibilityInfo.announceForAccessibility(out.message);
    }
  };
  const pickStatus = (project: ProjectOverview, status: string) => {
    setStatusFor(null);
    if (status === 'ARCHIVED') openArchive(project);
    else void runStatus(project, status);
  };
  const openArchive = (project: ProjectOverview) => {
    setArchiveError(null);
    setArchiving(project);
  };
  const confirmArchive = async (project: ProjectOverview) => {
    setArchiveBusy(true);
    setArchiveError(null);
    const out = await changeStatus(project, 'ARCHIVED');
    setArchiveBusy(false);
    if (out.ok) {
      setArchiving(null);
      AccessibilityInfo.announceForAccessibility(`${project.name} is now archived.`);
    } else setArchiveError(out.message);
  };

  if (query.isLoading) return <SkeletonList rows={4} avatar />;

  const now = new Date();
  const today = companyTodayKey(now, timeZone);
  const loaded = Array.isArray(query.data);
  const failed = query.isError && !loaded;
  // "Only my projects" is an administrator's filter; everyone else only sees theirs anyway.
  const mine = admin && state.mine;
  const owners = ownerOptions(all);
  // An owner who owns none of the projects this person can see (any more) is ignored.
  const owner = state.owner !== '' && !owners.some((o) => o.id === state.owner) ? '' : state.owner;
  const filters: ProjectListState = { ...DEFAULT_LIST_STATE, q: state.q, owner, mine };
  const counts = tabCounts(filterProjects(all, filters));
  const visible = sortProjects(filterProjects(all, filters).filter((p) => inTab(p, state.status)), state.sort, today, timeZone);
  const filtersOn = Boolean(state.q.trim() || owner || mine);
  const summary = loaded && all.length > 0 ? headerSummary(all, today, timeZone) : undefined;
  // No project at all yet: the tabs, search and filters have nothing to work on, so only the invitation shows.
  const firstRun = loaded && !query.isError && all.length === 0;
  const ownerName = owner ? (owners.find((o) => o.id === owner)?.name ?? PROJECTS_TEXT.anyone) : PROJECTS_TEXT.anyone;
  const sortName = PROJECT_SORTS.find((x) => x.value === state.sort)!.label;
  const clearFilters = () => update({ q: '', owner: '', mine: false });

  const header = (
    <View style={s.head}>
      <PageHeader
        title="Projects"
        subtitle={summary}
        actions={canCreateProject(user) ? <Button size="sm" icon="ui.plus" title="New project" onPress={newProject} /> : null}
      />
      {firstRun || failed ? null : (
        <>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} accessibilityLabel={PROJECTS_TEXT.tabs} contentContainerStyle={s.tabs}>
            {STATUS_TABS.map((t) => (
              <Chip key={t.value} label={t.label} selected={t.value === state.status} onPress={() => update({ status: t.value })} count={loaded ? counts[t.value] : undefined} />
            ))}
          </ScrollView>
          <TextField
            value={state.q}
            onChangeText={(q) => update({ q })}
            placeholder={PROJECTS_TEXT.search}
            accessibilityLabel={PROJECTS_TEXT.searchLabel}
            returnKeyType="search"
            autoCorrect={false}
          />
          <View style={s.selects}>
            <SelectBox label={PROJECTS_TEXT.owner} value={ownerName} onPress={() => setPicker('owner')} s={s} />
            <SelectBox label={PROJECTS_TEXT.sort} value={sortName} onPress={() => setPicker('sort')} s={s} />
          </View>
          {admin ? <Toggle on={state.mine} onChange={(v) => update({ mine: v })} label={PROJECTS_TEXT.onlyMine} /> : null}
          {problem ? <ErrorNote message={problem} /> : null}
          <Text style={[typeStyle('body'), { color: c.ink2 }]} accessibilityLiveRegion="polite">
            {countLine(visible.length, state.sort)}
          </Text>
        </>
      )}
    </View>
  );

  const empty = firstRun ? (
    <EmptyState
      icon="nav.projects"
      title={PROJECTS_TEXT.firstRun}
      subtitle={admin ? PROJECTS_TEXT.firstRunAdmin : PROJECTS_TEXT.firstRunOther}
      action={canCreateProject(user) ? { title: 'New project', onPress: newProject } : undefined}
    />
  ) : failed ? (
    <ErrorNote message="Couldn’t load projects." onRetry={() => void refetch()} retrying={query.isRefetching} />
  ) : filtersOn ? (
    <EmptyState title={PROJECTS_TEXT.noMatch} subtitle={PROJECTS_TEXT.noMatchBody} action={{ title: PROJECTS_TEXT.clear, onPress: clearFilters }} />
  ) : (
    <EmptyState title={EMPTY_TAB[state.status]} subtitle={state.status === 'archived' ? PROJECTS_TEXT.archivedNote : undefined} />
  );

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <FlatList
        data={firstRun || failed ? [] : visible}
        keyExtractor={(p) => p.id}
        contentContainerStyle={s.scroll}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => void refetch()} />}
        ListHeaderComponent={header}
        ListEmptyComponent={empty}
        ListFooterComponent={
          canCreateProject(user) && showAnotherProjectTile({ filtered: filtersOn, shown: visible.length, tab: state.status }) ? (
            <Card onPress={newProject} style={s.another} accessibilityLabel={`${PROJECTS_TEXT.another}. ${PROJECTS_TEXT.anotherBody}`}>
              <View style={[s.anotherIcon, { backgroundColor: c.brandWash }]}>
                <Icon name="ui.plus" size={20} color={c.brandText} />
              </View>
              <Text style={[typeStyle('bodyStrong'), { color: c.ink }]}>{PROJECTS_TEXT.another}</Text>
              <Text style={[typeStyle('body'), s.center, { color: c.ink2 }]}>{PROJECTS_TEXT.anotherBody}</Text>
            </Card>
          ) : null
        }
        renderItem={({ item }) => (
          <ProjectCard
            project={item}
            today={today}
            timeZone={timeZone}
            now={now}
            canChange={canManageProject(user, item)}
            onOpen={open}
            onEdit={edit}
            onOpenBoard={board}
            onStatus={setStatusFor}
            onArchive={openArchive}
          />
        )}
      />
      <ProjectStatusSheet project={statusFor} onChoose={pickStatus} onClose={() => setStatusFor(null)} />
      <ArchiveProjectSheet project={archiving} busy={archiveBusy} error={archiveError} onConfirm={(p) => void confirmArchive(p)} onClose={() => setArchiving(null)} />
      <ChoiceSheet
        visible={picker === 'owner'}
        title={PROJECTS_TEXT.owner}
        options={[{ value: '', label: PROJECTS_TEXT.anyone }, ...owners.map((o) => ({ value: o.id, label: o.name }))]}
        value={owner}
        onChoose={(v) => update({ owner: v })}
        onClose={() => setPicker(null)}
      />
      <ChoiceSheet
        visible={picker === 'sort'}
        title={PROJECTS_TEXT.sort}
        options={PROJECT_SORTS.map((x) => ({ value: x.value, label: x.label }))}
        value={state.sort}
        onChoose={(v) => update({ sort: v as ProjectSort })}
        onClose={() => setPicker(null)}
      />
    </SafeAreaView>
  );
}

type Styles = ReturnType<typeof makeStyles>;

/** Owner and Sort, as the website's two select boxes: the label, the choice, a chevron; a sheet to choose. */
function SelectBox({ label, value, onPress, s }: { label: string; value: string; onPress: () => void; s: Styles }) {
  const c = useColors();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${label}: ${value}`} accessibilityHint={`Choose the ${label.toLowerCase()}`} style={({ pressed }) => [s.select, pressed ? s.pressed : null]}>
      <Text style={[typeStyle('body'), { color: c.ink2 }]}>{label}</Text>
      <Text style={[typeStyle('label'), s.selectValue, { color: c.ink }]} numberOfLines={1}>
        {value}
      </Text>
      <Icon name="kit.down" size={14} color={c.ink2} />
    </Pressable>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: c.ground },
    scroll: { padding: spacing.lg, gap: spacing.md },
    head: { gap: spacing.sm },
    tabs: { gap: spacing.sm, paddingVertical: 6 },
    selects: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    select: { flexGrow: 1, flexBasis: 140, minWidth: 0, minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: c.line, borderRadius: radius.button, backgroundColor: c.surface, paddingHorizontal: spacing.md },
    selectValue: { flex: 1, ...font('500') },
    pressed: { opacity: 0.7 },
    another: { alignItems: 'center', gap: spacing.sm, borderStyle: 'dashed', borderWidth: 2, paddingVertical: spacing.xl },
    anotherIcon: { width: 44, height: 44, borderRadius: radius.card, alignItems: 'center', justifyContent: 'center' },
    center: { textAlign: 'center', maxWidth: 260 },
  });
