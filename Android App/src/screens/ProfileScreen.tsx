import React, { useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSession } from '../core/providers';
import { useColors } from '../core/theme';
import { Card, SectionTitle, Muted, Pill } from '../components/ui';
import { spacing, fontSize, type Palette } from '../lib/theme';

export function ProfileScreen() {
  const c = useColors();
  const styles = useMemo(() => makeStyles(c), [c]);
  const user = useSession()?.user;
  const initials = (user?.username ?? '?').slice(0, 2).toUpperCase();

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.header}>
          <View style={styles.avatar}>
            <Text style={styles.initials}>{initials}</Text>
          </View>
          <Text style={styles.name}>{user?.username}</Text>
          <Muted>{user?.email}</Muted>
        </View>

        <View style={styles.section}>
          <SectionTitle>Roles</SectionTitle>
          <Card>
            <View style={styles.roles}>
              {(user?.roles ?? []).map((r) => (
                <Pill key={r} label={r} color={c.brand} />
              ))}
              {(user?.roles ?? []).length === 0 ? <Muted>No roles assigned.</Muted> : null}
            </View>
          </Card>
        </View>

        <View style={styles.section}>
          <SectionTitle>User ID</SectionTitle>
          <Card>
            <Text style={styles.mono}>{user?.id}</Text>
          </Card>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: c.ground },
    scroll: { padding: spacing.lg, gap: spacing.lg },
    header: { alignItems: 'center', gap: spacing.xs, paddingVertical: spacing.lg },
    avatar: {
      width: 84,
      height: 84,
      borderRadius: 42,
      backgroundColor: c.brand,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: spacing.sm,
    },
    initials: { color: c.onBrand, fontSize: fontSize.xxl, fontWeight: '800' },
    name: { fontSize: fontSize.xl, fontWeight: '800', color: c.ink },
    section: { gap: spacing.sm },
    roles: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    mono: { fontSize: fontSize.sm, color: c.ink },
  });
