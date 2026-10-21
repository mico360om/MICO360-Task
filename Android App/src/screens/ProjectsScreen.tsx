import React, { useCallback, useLayoutEffect, useMemo, useState } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet, RefreshControl, AccessibilityInfo } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useDirectory, useProjects } from '../core/queries';
import { useProjectStatus, useProjectsProgress } from '../core/project-queries';
import { useSession } from '../core/providers';
import { useColors } from '../core/theme';
import { Loader, EmptyState, ErrorNote, Badge } from '../components/ui';
import { ProjectAvatar } from '../components/ProjectAvatar';
import { ActionRowButton, Sheet, SheetButtons, SheetMessage } from '../components/meeting/sheet-kit';
import { PROJECT_STATUSES, projectStatusLabel, projectStatusTone } from '../lib/project-identity';
import { emptyProjects, projectCardLabel, projectCardMeta, projectDates, projectsSubtitle, statusChangeProblem, type ProjectCardMeta } from '../lib/project-list';
import { ownerName } from '../lib/project-dashboard';
import { canEditProject } from '../lib/project-team';
import { spacing, radius, fontSize, type Palette } from '../lib/theme';
import type { ApiProject } from '../lib/types';
import type { TabScreenProps } from '../navigation/types';

/**
 * The Projects tab (5b), as the website's Projects page: each project's picture, code and number,
 * status in words, client, progress, task and overdue counts, dates and owner. A card opens the
 * project's dashboard; "Board" goes straight to its board. Administrators can add a project, edit
 * one and change its status (Archived goes through the archive action). It shows the last copy
 * offline; changes need a connection.
 */
export function ProjectsScreen({ navigation }: TabScreenProps<'Projects'>) {
  const c = useColors();
  const s = useMemo(() => makeStyles(c), [c]);
  const user = useSession()?.user ?? null;
  const admin = canEditProject(user);
  const { data: projects, isLoading, isError, refetch, isRefetching } = useProjects();
  const list = useMemo(() => projects ?? [], [projects]);
  const progress = useProjectsProgress(useMemo(() => list.map((p) => p.id), [list]));
  const dirQ = useDirectory();
  const people = useMemo(() => dirQ.data ?? [], [dirQ.data]);
  const [statusFor, setStatusFor] = useState<ApiProject | null>(null);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: admin
        ? () => (
            <Pressable onPress={() => navigation.navigate('ProjectForm')} accessibilityRole="button" accessibilityLabel="New project" hitSlop={8} style={s.headerButton}>
              <Text style={s.headerButtonText}>+ New</Text>
            </Pressable>
          )
        : undefined,
    });
  }, [navigation, admin, s]);

  const open = useCallback((p: ApiProject) => navigation.navigate('ProjectDetail', { projectId: p.id, projectName: p.name }), [navigation]);
  const board = useCallback((p: ApiProject) => navigation.navigate('Board', { projectId: p.id, projectName: p.name }), [navigation]);
  const edit = useCallback((p: ApiProject) => navigation.navigate('ProjectForm', { projectId: p.id }), [navigation]);

  if (isLoading) return <Loader />;
  const empty = emptyProjects(admin);

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <FlatList
        data={isError && !projects ? [] : list}
        keyExtractor={(p) => p.id}
        contentContainerStyle={s.scroll}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} />}
        ListHeaderComponent={
          <View style={s.head}>
            <Text style={s.subtitle}>{projectsSubtitle(admin)}</Text>
            {isError && !projects ? <ErrorNote message="Couldn’t load your projects." onRetry={() => void refetch()} retrying={isRefetching} /> : null}
          </View>
        }
        ListEmptyComponent={isError && !projects ? null : <EmptyState title={empty.title} subtitle={empty.subtitle} />}
        renderItem={({ item }) => (
          <ProjectCard
            project={item}
            meta={projectCardMeta(progress[item.id], item.ownerId && dirQ.data ? ownerName(item.ownerId, people) : null)}
            admin={admin}
            onOpen={open}
            onBoard={board}
            onEdit={edit}
            onStatus={setStatusFor}
            s={s}
          />
        )}
      />
      <StatusSheet project={statusFor} onClose={() => setStatusFor(null)} />
    </SafeAreaView>
  );
}

type Styles = ReturnType<typeof makeStyles>;

const ProjectCard = React.memo(function ProjectCard({
  project: p,
  meta,
  admin,
  onOpen,
  onBoard,
  onEdit,
  onStatus,
  s,
}: {
  project: ApiProject;
  meta: ProjectCardMeta | null;
  admin: boolean;
  onOpen: (p: ApiProject) => void;
  onBoard: (p: ApiProject) => void;
  onEdit: (p: ApiProject) => void;
  onStatus: (p: ApiProject) => void;
  s: Styles;
}) {
  const dates = projectDates(p.startDate, p.targetDate);
  return (
    <View style={s.card}>
      <View style={[s.strip, { backgroundColor: p.color || '#8B1E1E' }]} />
      <Pressable
        onPress={() => onOpen(p)}
        accessibilityRole="button"
        accessibilityLabel={projectCardLabel(p, meta, dates)}
        accessibilityHint="Opens the project"
        style={({ pressed }) => [s.main, pressed && s.pressed]}
      >
        <View style={s.topRow}>
          <View style={s.codes}>
            <Text style={s.code}>{p.code}</Text>
            {p.number ? <Text style={s.code}>{p.number}</Text> : null}
          </View>
          <Badge label={projectStatusLabel(p.status)} tone={projectStatusTone(p.status)} />
        </View>
        <View style={s.identity}>
          <ProjectAvatar project={p} size="lg" />
          <View style={s.flex}>
            <Text style={s.name} numberOfLines={2}>
              {p.name}
            </Text>
            <Text style={p.clientName ? s.client : s.internal} numberOfLines={1}>
              {p.clientName || 'Internal'}
            </Text>
          </View>
        </View>
        {meta?.hasProgress ? (
          <View style={s.progressRow}>
            <View style={s.track}>
              <View style={[s.fill, { width: `${Math.min(100, meta.completedPct)}%` }]} />
            </View>
            <Text style={s.pct}>{meta.completedPct}%</Text>
          </View>
        ) : null}
        {meta || dates ? (
          <View style={s.stats}>
            {meta ? <Text style={s.stat}>☑ {meta.total} tasks</Text> : null}
            {meta ? <Text style={[s.stat, meta.overdue > 0 && s.overdue]}>⚠ {meta.overdue} overdue</Text> : null}
            {dates ? <Text style={s.stat}>📅 {dates}</Text> : null}
          </View>
        ) : null}
        {meta?.ownerName ? <Text style={s.owner}>Owner · {meta.ownerName}</Text> : null}
      </Pressable>
      <View style={s.footer}>
        <FooterButton label="Board" a11y={`Board for ${p.name}`} onPress={() => onBoard(p)} s={s} />
        {admin ? <FooterButton label={`Status: ${projectStatusLabel(p.status)}`} a11y={`Status for ${p.name}: ${projectStatusLabel(p.status)}. Change it`} onPress={() => onStatus(p)} s={s} /> : null}
        {admin ? <FooterButton label="Edit" a11y={`Edit ${p.name}`} onPress={() => onEdit(p)} s={s} /> : null}
      </View>
    </View>
  );
});

function FooterButton({ label, a11y, onPress, s }: { label: string; a11y: string; onPress: () => void; s: Styles }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={a11y} style={({ pressed }) => [s.footerButton, pressed && s.pressed]}>
      <Text style={s.footerText}>{label}</Text>
    </Pressable>
  );
}

/** An administrator's status change: saved at once (Archived through the archive action). */
function StatusSheet({ project, onClose }: { project: ApiProject | null; onClose: () => void }) {
  const change = useProjectStatus();
  const [problem, setProblem] = useState<string | null>(null);
  const close = () => {
    setProblem(null);
    onClose();
  };
  return (
    <Sheet visible={!!project} title="Project status" subtitle={project?.name} onClose={close} footer={<SheetButtons cancel="Close" onCancel={close} busy={change.isPending} />}>
      {PROJECT_STATUSES.map((st) => (
        <ActionRowButton
          key={st}
          label={`${projectStatusLabel(st)}${project?.status === st ? ' ✓' : ''}`}
          hint={st === 'ARCHIVED' ? 'Archives the project' : undefined}
          busy={change.isPending && change.variables?.status === st}
          disabled={!project || project.status === st || change.isPending}
          onPress={() => {
            if (!project) return;
            setProblem(null);
            change.mutate(
              { id: project.id, status: st },
              {
                onSuccess: () => {
                  AccessibilityInfo.announceForAccessibility(`${project.name} is now ${projectStatusLabel(st).toLowerCase()}.`);
                  close();
                },
                onError: (e) => setProblem(statusChangeProblem(e)),
              },
            );
          }}
        />
      ))}
      <SheetMessage text={problem} />
    </Sheet>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: c.ground },
    scroll: { padding: spacing.lg, gap: spacing.md },
    head: { gap: spacing.sm },
    subtitle: { fontSize: fontSize.sm, color: c.ink2 },
    headerButton: { paddingHorizontal: spacing.lg, minHeight: 44, justifyContent: 'center' },
    headerButtonText: { color: c.onBrand, fontWeight: '800', fontSize: fontSize.md },
    flex: { flex: 1 },
    pressed: { opacity: 0.7 },
    card: { backgroundColor: c.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: c.line, overflow: 'hidden' },
    strip: { height: 4 },
    main: { padding: spacing.lg, gap: spacing.sm },
    topRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
    codes: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, flexShrink: 1 },
    code: { fontSize: fontSize.xs, fontWeight: '700', color: c.ink2, backgroundColor: c.ground, borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: 2, letterSpacing: 0.5 },
    identity: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
    name: { fontSize: fontSize.lg, fontWeight: '800', color: c.ink },
    client: { fontSize: fontSize.sm, color: c.ink2 },
    internal: { fontSize: fontSize.sm, color: c.ink3 },
    progressRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    track: { flex: 1, height: 6, borderRadius: 3, backgroundColor: c.ground, overflow: 'hidden' },
    fill: { height: 6, borderRadius: 3, backgroundColor: c.brand },
    pct: { fontSize: fontSize.sm, fontWeight: '700', color: c.ink2 },
    stats: { flexDirection: 'row', flexWrap: 'wrap', columnGap: spacing.md, rowGap: 4, borderTopWidth: 1, borderTopColor: c.line, paddingTop: spacing.sm },
    stat: { fontSize: fontSize.sm, color: c.ink2 },
    overdue: { color: c.danger, fontWeight: '700' },
    owner: { fontSize: fontSize.sm, color: c.ink2 },
    footer: { flexDirection: 'row', flexWrap: 'wrap', borderTopWidth: 1, borderTopColor: c.line },
    footerButton: { flexGrow: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.md },
    footerText: { fontSize: fontSize.sm, fontWeight: '700', color: c.brand, textAlign: 'center' },
  });
