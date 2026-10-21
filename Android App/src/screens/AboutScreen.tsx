import React, { useMemo } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet, Linking, Alert, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useServices, useSession } from '../core/providers';
import { useColors } from '../core/theme';
import { useServerConfig } from '../core/queries';
import { useAboutVersion, useReleases } from '../core/search-queries';
import { Badge, Card, ErrorNote, Muted, SectionTitle } from '../components/ui';
import { isNetworkError } from '../lib/api-client';
import { appDownloadUrl, offeredAppVersion, updateAvailable } from '../lib/app-version';
import { appVersionText, lastUpdatedText, releaseBadges, releaseDay, releaseHeadingLabel, releaseSections, technicalDetails, type ReleaseEntry } from '../lib/about';
import { appTimeZone } from '../lib/due-date';
import { serverLabel } from '../lib/server-address';
import { spacing, radius, fontSize, type Palette } from '../lib/theme';
import type { AppScreenProps } from '../navigation/types';

/**
 * About MICO360 Tasks (6b), as the website's About page: this app's version and build, the
 * website's version and when it was last updated, and every release with its new features,
 * improvements and bug fixes (administrators also see the security fixes and the technical
 * details). A newer app on the website is offered here too, as the notice does.
 */
export function AboutScreen(_props: AppScreenProps<'About'>) {
  const c = useColors();
  const s = useMemo(() => makeStyles(c), [c]);
  const { app, baseUrl } = useServices();
  const isAdmin = (useSession()?.user.roles ?? []).includes('ADMIN');
  const versionQ = useAboutVersion();
  const releasesQ = useReleases();
  const config = useServerConfig().data;
  const v = versionQ.data;
  const timeZone = appTimeZone();
  // The same rule as the "new version" notice: the app file the website offers, when it is newer.
  const offered = config ? offeredAppVersion(config, v?.version ?? null) : null;
  const newer = updateAvailable(app.version, offered) ? offered : null;
  const download = appDownloadUrl(baseUrl, config?.androidAppUrl);
  const releases = releasesQ.data ?? [];
  const refresh = () => {
    void versionQ.refetch();
    void releasesQ.refetch();
  };

  const header = (
    <View style={s.head}>
      <Muted>The version you are using, and what each release changed.</Muted>

      <View style={s.section}>
        <SectionTitle>This app</SectionTitle>
        <Card>
          <Text style={s.big} accessibilityLabel={`App version ${app.version}, build ${app.build}`}>
            {appVersionText(app)}
          </Text>
          {newer ? (
            <View style={s.update}>
              <Text style={s.updateText}>A new version of MICO360 Tasks is available (v{newer}).</Text>
              <Pressable
                onPress={() =>
                  void Linking.openURL(download).catch(() => Alert.alert('Couldn’t open the download', `Open this address in your browser to get the new version:\n${download}`))
                }
                accessibilityRole="link"
                accessibilityLabel={`Download version ${newer}`}
                style={({ pressed }) => [s.download, pressed && s.pressed]}
              >
                <Text style={s.downloadText}>Download</Text>
              </Pressable>
            </View>
          ) : null}
        </Card>
      </View>

      <View style={s.section}>
        <SectionTitle>Website</SectionTitle>
        <Card>
          {v ? (
            <>
              <Text style={s.big}>Version {v.version}</Text>
              <Muted>Last updated {lastUpdatedText(v.deployedAt, timeZone)}</Muted>
            </>
          ) : versionQ.isError ? (
            <ErrorNote
              message={isNetworkError(versionQ.error) ? 'You’re offline — the website’s version shows when you’re connected.' : 'Couldn’t load the version.'}
              onRetry={() => void versionQ.refetch()}
              retrying={versionQ.isRefetching}
            />
          ) : (
            <Muted>Loading…</Muted>
          )}
          <Muted style={s.connected}>Connected to {serverLabel(baseUrl)}</Muted>
          {isAdmin && v ? (
            <View style={s.tech} accessibilityRole="summary">
              <Text style={s.techTitle} accessibilityRole="header">
                Technical details
              </Text>
              {technicalDetails(v, timeZone).map(([label, value]) => (
                <View key={label} style={s.techRow} accessible accessibilityLabel={`${label}: ${value}`}>
                  <Text style={s.techLabel}>{label}</Text>
                  <Text style={[s.techValue, label === 'Code revision' && s.mono]}>{value}</Text>
                </View>
              ))}
            </View>
          ) : null}
        </Card>
      </View>

      <Text style={s.history} accessibilityRole="header">
        Version history
      </Text>
      {releasesQ.isError && !releasesQ.data ? (
        <ErrorNote
          message={isNetworkError(releasesQ.error) ? 'You’re offline — the version history shows when you’re connected.' : 'Couldn’t load the version history.'}
          onRetry={() => void releasesQ.refetch()}
          retrying={releasesQ.isRefetching}
        />
      ) : releasesQ.isLoading ? (
        <Muted>Loading…</Muted>
      ) : releases.length === 0 ? (
        <Muted>No release notes yet.</Muted>
      ) : null}
    </View>
  );

  return (
    <SafeAreaView style={s.safe} edges={['bottom']}>
      <FlatList
        data={releases}
        keyExtractor={(r) => r.version}
        contentContainerStyle={s.scroll}
        ListHeaderComponent={header}
        refreshControl={<RefreshControl refreshing={versionQ.isRefetching || releasesQ.isRefetching} onRefresh={refresh} />}
        renderItem={({ item }) => <Release release={item} isAdmin={isAdmin} badges={releaseBadges(item, { serverVersion: v?.version, appVersion: app.version })} s={s} />}
      />
    </SafeAreaView>
  );
}

type Styles = ReturnType<typeof makeStyles>;

const Release = React.memo(function Release({ release: r, isAdmin, badges, s }: { release: ReleaseEntry; isAdmin: boolean; badges: string[]; s: Styles }) {
  return (
    <View style={s.release}>
      <View style={s.releaseHead} accessible accessibilityRole="header" accessibilityLabel={releaseHeadingLabel(r, badges)}>
        <Text style={s.releaseVersion}>v{r.version}</Text>
        <Text style={s.releaseDay}>{releaseDay(r.date)}</Text>
        {badges.map((b) => (
          <Badge key={b} label={b} tone="brand" />
        ))}
      </View>
      {releaseSections(r, isAdmin).map((sec) => (
        <View key={sec.title} style={s.releaseSection}>
          <Text style={s.releaseSectionTitle}>{sec.title}</Text>
          {sec.items.map((item, i) => (
            <View key={`${i}-${item}`} style={s.bulletRow}>
              <Text style={s.bullet} importantForAccessibility="no">
                •
              </Text>
              <Text style={s.bulletText}>{item}</Text>
            </View>
          ))}
        </View>
      ))}
      {!isAdmin && r.securityUpdates ? <Text style={s.securityNote}>Includes security updates.</Text> : null}
    </View>
  );
});

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: c.ground },
    scroll: { padding: spacing.lg, gap: spacing.md },
    head: { gap: spacing.lg },
    section: { gap: spacing.sm },
    big: { fontSize: fontSize.lg, fontWeight: '800', color: c.ink },
    connected: { marginTop: spacing.sm },
    update: { marginTop: spacing.md, gap: spacing.sm, backgroundColor: c.brandWash, borderRadius: radius.md, padding: spacing.md },
    updateText: { fontSize: fontSize.sm, fontWeight: '600', color: c.brand },
    download: { alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center', paddingHorizontal: spacing.lg, borderRadius: radius.md, backgroundColor: c.brand },
    downloadText: { color: c.onBrand, fontWeight: '800', fontSize: fontSize.sm },
    pressed: { opacity: 0.7 },
    tech: { marginTop: spacing.md, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: c.line, gap: spacing.xs },
    techTitle: { fontSize: fontSize.xs, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', color: c.ink3 },
    techRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    techLabel: { fontSize: fontSize.sm, color: c.ink2, minWidth: 110 },
    techValue: { flex: 1, minWidth: 140, fontSize: fontSize.sm, color: c.ink },
    mono: { fontFamily: 'monospace' },
    history: { fontSize: fontSize.lg, fontWeight: '800', color: c.ink },
    release: { backgroundColor: c.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: c.line, padding: spacing.lg, gap: spacing.sm },
    releaseHead: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm },
    releaseVersion: { fontSize: fontSize.lg, fontWeight: '800', color: c.ink },
    releaseDay: { fontSize: fontSize.sm, color: c.ink2 },
    releaseSection: { gap: 2, marginTop: spacing.xs },
    releaseSectionTitle: { fontSize: fontSize.sm, fontWeight: '700', color: c.ink },
    bulletRow: { flexDirection: 'row', gap: spacing.sm, paddingStart: spacing.xs },
    bullet: { fontSize: fontSize.sm, color: c.ink2 },
    bulletText: { flex: 1, fontSize: fontSize.sm, color: c.ink2, textAlign: 'auto' },
    securityNote: { fontSize: fontSize.sm, color: c.ink2, marginTop: spacing.xs },
  });
