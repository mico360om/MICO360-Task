import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, RefreshControl } from 'react-native';
import { useProject, useProjectMembers, useProjectProgress } from '../core/queries';
import { useServices } from '../core/providers';
import { useColors } from '../core/theme';
import { Card, SectionTitle, Loader, ErrorNote, Pill, Badge, Button } from '../components/ui';
import { ApiError, isNetworkError } from '../lib/api-client';
import { displayName } from '../lib/types';
import { spacing, fontSize, radius, type Palette } from '../lib/theme';
import type { AppScreenProps } from '../navigation/types';

/**
 * Project details (A5.1): what the project is, how far along it is, and who is on the team — with
 * shortcuts to its board and its chat channel.
 */
export function ProjectDetailScreen({ route, navigation }: AppScreenProps<'ProjectDetail'>) {
  const { projectId } = route.params;
  const c = useColors();
  const styles = useMemo(() => makeStyles(c), [c]);
  const { resources } = useServices();
  const projectQ = useProject(projectId);
  const progressQ = useProjectProgress(projectId);
  const membersQ = useProjectMembers(projectId);
  const [chatError, setChatError] = useState<string | null>(null);
  const [openingChat, setOpeningChat] = useState(false);

  const project = projectQ.data;
  const progress = progressQ.data;
  const members = [...(membersQ.data ?? [])].sort((a, b) => (a.role === b.role ? displayName(a).localeCompare(displayName(b)) : a.role === 'MANAGER' ? -1 : 1));
  const refreshing = projectQ.isRefetching || progressQ.isRefetching || membersQ.isRefetching;

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

  if (projectQ.isLoading) return <Loader />;
  if (!project) {
    return (
      <View style={styles.safe}>
        <ErrorNote message="Couldn’t load this project." onRetry={() => void projectQ.refetch()} retrying={projectQ.isRefetching} />
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.safe}
      contentContainerStyle={styles.scroll}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            void projectQ.refetch();
            void progressQ.refetch();
            void membersQ.refetch();
          }}
        />
      }
    >
      <Card>
        <View style={styles.headRow}>
          <Text style={styles.code}>{project.code}</Text>
          <Pill label={project.status} />
        </View>
        <Text style={styles.name}>{project.name}</Text>
        {project.clientName ? <Text style={styles.meta}>Client: {project.clientName}</Text> : null}
        {project.startDate || project.targetDate ? (
          <Text style={styles.meta}>
            {project.startDate ? `Starts ${project.startDate.slice(0, 10)}` : ''}
            {project.startDate && project.targetDate ? ' · ' : ''}
            {project.targetDate ? `Target ${project.targetDate.slice(0, 10)}` : ''}
          </Text>
        ) : null}
        {project.description ? <Text style={styles.desc}>{project.description}</Text> : null}
        <View style={styles.actions}>
          <Button title="Open board" onPress={() => navigation.navigate('Board', { projectId, projectName: project.name })} style={styles.action} />
          <Button title="Project chat" variant="secondary" onPress={() => void openChat()} loading={openingChat} style={styles.action} />
        </View>
        {chatError ? <Text style={styles.error} accessibilityRole="alert">{chatError}</Text> : null}
      </Card>

      <Card>
        <SectionTitle>Progress{progress ? ` · ${progress.completionPct}%` : ''}</SectionTitle>
        {progress ? (
          <>
            <View style={styles.bar} importantForAccessibility="no-hide-descendants">
              <View style={[styles.barFill, { width: `${Math.min(100, Math.max(0, progress.completionPct))}%` }]} />
            </View>
            <View style={styles.stats}>
              <Stat label="Done" value={progress.completed} styles={styles} />
              <Stat label="In progress" value={progress.inProgress} styles={styles} />
              <Stat label="To do" value={progress.todo} styles={styles} />
              <Stat label="Overdue" value={progress.overdue} styles={styles} danger={progress.overdue > 0} />
            </View>
          </>
        ) : progressQ.isError ? (
          <Text style={styles.meta}>Progress isn’t available right now.</Text>
        ) : (
          <Loader />
        )}
      </Card>

      <Card>
        <SectionTitle>Team · {members.length}</SectionTitle>
        {membersQ.isError && members.length === 0 ? (
          <Text style={styles.meta}>The team list isn’t available right now.</Text>
        ) : members.length === 0 ? (
          <Text style={styles.meta}>No members yet.</Text>
        ) : (
          members.map((m) => (
            <View key={m.id} style={styles.member} accessible accessibilityLabel={`${displayName(m)}${m.role === 'MANAGER' ? ', project manager' : ''}`}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{displayName(m).slice(0, 2).toUpperCase()}</Text>
              </View>
              <View style={styles.memberText}>
                <Text style={styles.memberName}>{displayName(m)}</Text>
                <Text style={styles.memberSub}>@{m.username}</Text>
              </View>
              {m.role === 'MANAGER' ? <Badge label="Manager" tone="brand" /> : null}
            </View>
          ))
        )}
      </Card>
    </ScrollView>
  );
}

function Stat({ label, value, styles, danger }: { label: string; value: number; styles: ReturnType<typeof makeStyles>; danger?: boolean }) {
  return (
    <View style={styles.stat} accessible accessibilityLabel={`${label}: ${value}`}>
      <Text style={[styles.statValue, danger && styles.statDanger]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: c.ground },
    scroll: { padding: spacing.lg, gap: spacing.md },
    headRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    code: { fontSize: fontSize.xs, fontWeight: '700', color: c.brand, letterSpacing: 1 },
    name: { fontSize: fontSize.xl, fontWeight: '800', color: c.ink, marginTop: spacing.xs },
    meta: { fontSize: fontSize.sm, color: c.ink2, marginTop: spacing.xs },
    desc: { fontSize: fontSize.md, color: c.ink, marginTop: spacing.sm, lineHeight: 22 },
    actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg },
    action: { flex: 1 },
    error: { color: c.danger, fontSize: fontSize.sm, marginTop: spacing.sm },
    bar: { height: 8, borderRadius: 4, backgroundColor: c.line, overflow: 'hidden', marginTop: spacing.sm },
    barFill: { height: 8, borderRadius: 4, backgroundColor: c.success },
    stats: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.md },
    stat: { alignItems: 'center', flex: 1 },
    statValue: { fontSize: fontSize.xl, fontWeight: '800', color: c.ink },
    statDanger: { color: c.danger },
    statLabel: { fontSize: fontSize.xs, color: c.ink3, marginTop: 2 },
    member: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm, borderTopWidth: 1, borderTopColor: c.line },
    avatar: { width: 36, height: 36, borderRadius: radius.pill, backgroundColor: c.brand, alignItems: 'center', justifyContent: 'center' },
    avatarText: { color: c.onBrand, fontWeight: '700', fontSize: fontSize.xs },
    memberText: { flex: 1 },
    memberName: { fontSize: fontSize.md, fontWeight: '600', color: c.ink },
    memberSub: { fontSize: fontSize.xs, color: c.ink3 },
  });
