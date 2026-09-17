import React, { useMemo } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useProjects } from '../core/queries';
import { useColors } from '../core/theme';
import { Loader, EmptyState, ErrorNote, Pill } from '../components/ui';
import { spacing, radius, fontSize, type Palette } from '../lib/theme';
import type { ApiProject } from '../lib/types';
import type { TabScreenProps } from '../navigation/types';

export function ProjectsScreen({ navigation }: TabScreenProps<'Projects'>) {
  const c = useColors();
  const styles = useMemo(() => makeStyles(c), [c]);
  const { data: projects, isLoading, isError, refetch, isRefetching } = useProjects();

  if (isLoading) return <Loader />;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} />}
      >
        {isError && !projects ? (
          <ErrorNote message="Couldn't load your projects. Pull down to retry." />
        ) : (projects ?? []).length === 0 ? (
          <EmptyState title="No projects" subtitle="Projects you can access will appear here." />
        ) : (
          (projects ?? []).map((p: ApiProject) => (
            <Pressable
              key={p.id}
              onPress={() => navigation.navigate('Board', { projectId: p.id, projectName: p.name })}
              accessibilityRole="button"
              accessibilityLabel={`${p.code}, ${p.name}, ${p.status}`}
              style={({ pressed }) => [styles.card, pressed && styles.pressed]}
            >
              <View style={styles.cardHead}>
                <Text style={styles.code}>{p.code}</Text>
                <Pill label={p.status} />
              </View>
              <Text style={styles.name}>{p.name}</Text>
              {p.description ? (
                <Text style={styles.desc} numberOfLines={2}>
                  {p.description}
                </Text>
              ) : null}
            </Pressable>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: c.ground },
    scroll: { padding: spacing.lg, gap: spacing.md },
    card: {
      backgroundColor: c.surface,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: c.line,
      padding: spacing.lg,
      gap: spacing.xs,
    },
    pressed: { opacity: 0.7 },
    cardHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    code: { fontSize: fontSize.xs, fontWeight: '700', color: c.brand, letterSpacing: 1 },
    name: { fontSize: fontSize.lg, fontWeight: '700', color: c.ink },
    desc: { fontSize: fontSize.sm, color: c.ink2 },
  });
