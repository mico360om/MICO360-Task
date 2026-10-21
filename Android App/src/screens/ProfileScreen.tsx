import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, Image, Pressable, StyleSheet, Alert, AccessibilityInfo, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as DocumentPicker from 'expo-document-picker';
import { useServices, useSession } from '../core/providers';
import { useColors } from '../core/theme';
import { useDirectory } from '../core/queries';
import { useAvatar } from '../core/account-queries';
import { pickedFiles } from '../adapters/files';
import { Card, SectionTitle, Muted, Badge, Button, ErrorNote } from '../components/ui';
import { KeyboardAwareScrollView } from '../components/KeyboardAware';
import { ChangePasswordCard } from '../components/account/ChangePasswordCard';
import { SignOutButton } from '../components/account/SignOutButton';
import {
  AVATAR_TYPES,
  MY_DATA_EXPORT_PATH,
  accountRoleLabel,
  avatarHref,
  avatarPart,
  avatarProblem,
  fullNameOf,
  initialsOf,
  myDataFileName,
  myDataProblem,
  photoOf,
  photoRemoveProblem,
  photoUploadProblem,
} from '../lib/account';
import { companyTodayKey } from '../lib/due-date';
import { sitePageUrl } from '../lib/server-address';
import { spacing, radius, fontSize, type Palette } from '../lib/theme';
import type { AppScreenProps } from '../navigation/types';

/**
 * Your profile (6a), as the website's Profile page: your photo, name and role, your account
 * details, Change password and "Download my data". All of it needs a connection, as on the website.
 */
export function ProfileScreen({ navigation }: AppScreenProps<'Profile'>) {
  const c = useColors();
  const s = useMemo(() => makeStyles(c), [c]);
  const { baseUrl, exporter } = useServices();
  const user = useSession()?.user;
  const dirQ = useDirectory();
  const me = Array.isArray(dirQ.data) ? dirQ.data.find((d) => d.id === user?.id) : undefined;
  const fullName = fullNameOf(me, user?.username);
  const role = accountRoleLabel(user?.roles);
  const photo = avatarHref(baseUrl, photoOf(me, user));
  const [photoBroken, setPhotoBroken] = useState(false);
  useEffect(() => setPhotoBroken(false), [photo]);

  const { upload, remove } = useAvatar();
  const photoBusy = upload.isPending || remove.isPending;
  const [photoProblem, setPhotoProblem] = useState<string | null>(null);

  async function pickPhoto() {
    setPhotoProblem(null);
    let picked: DocumentPicker.DocumentPickerResult;
    try {
      picked = await DocumentPicker.getDocumentAsync({ type: AVATAR_TYPES, copyToCacheDirectory: true, multiple: false });
    } catch {
      setPhotoProblem('Couldn’t open your files. Please try again.');
      return;
    }
    const asset = picked.canceled ? null : picked.assets?.[0];
    if (!asset) return;
    // Checked here first, so a photo the server would refuse isn't uploaded for nothing (6a review).
    const problem = avatarProblem(asset);
    if (problem) {
      setPhotoProblem(problem);
      void pickedFiles.remove(asset.uri);
      return;
    }
    upload.mutate(avatarPart(asset), {
      onSuccess: () => AccessibilityInfo.announceForAccessibility('Photo updated.'),
      onError: (e) => setPhotoProblem(photoUploadProblem(e)),
      // The picker's copy isn't kept on the phone once it has been sent.
      onSettled: () => void pickedFiles.remove(asset.uri),
    });
  }

  function confirmRemove() {
    Alert.alert('Remove photo', 'Remove your profile photo? Your initials are shown instead.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => {
          setPhotoProblem(null);
          remove.mutate(undefined, {
            onSuccess: () => AccessibilityInfo.announceForAccessibility('Photo removed.'),
            onError: (e) => setPhotoProblem(photoRemoveProblem(e)),
          });
        },
      },
    ]);
  }

  const [dataBusy, setDataBusy] = useState(false);
  const [dataProblem, setDataProblem] = useState<string | null>(null);
  async function downloadMyData() {
    setDataBusy(true);
    setDataProblem(null);
    try {
      await exporter.exportFile(MY_DATA_EXPORT_PATH, myDataFileName(companyTodayKey()), 'Your data');
    } catch (e) {
      setDataProblem(myDataProblem(e));
    } finally {
      setDataBusy(false);
    }
  }
  const openPrivacy = () => void Linking.openURL(sitePageUrl(baseUrl, '/privacy')).catch(() => {});

  return (
    <SafeAreaView style={s.safe} edges={['bottom']}>
      <KeyboardAwareScrollView contentContainerStyle={s.scroll}>
        {/* Identity: photo, name, username, role */}
        <View style={s.header}>
          {photo && !photoBroken ? (
            <Image
              source={{ uri: photo }}
              style={s.photo}
              onError={() => setPhotoBroken(true)}
              accessible
              accessibilityLabel="Your profile photo"
              accessibilityIgnoresInvertColors
            />
          ) : (
            <View style={s.initialsBox} accessible accessibilityLabel="No profile photo">
              <Text style={s.initials}>{initialsOf(fullName === '—' ? '' : fullName)}</Text>
            </View>
          )}
          <Text style={s.name} accessibilityRole="header">
            {fullName}
          </Text>
          {user?.username ? <Muted>@{user.username}</Muted> : null}
          <Badge label={role} tone={role === 'Administrator' ? 'brand' : 'neutral'} />
          <View style={s.photoActions}>
            <Button
              title={upload.isPending ? 'Uploading…' : photo ? 'Change photo' : 'Upload photo'}
              accessibilityLabel={photo ? 'Change photo' : 'Upload photo'}
              variant="secondary"
              onPress={() => void pickPhoto()}
              loading={upload.isPending}
              disabled={photoBusy}
              style={s.photoButton}
            />
            {photo ? (
              <Button title="Remove" accessibilityLabel="Remove photo" variant="ghost" onPress={confirmRemove} loading={remove.isPending} disabled={photoBusy} style={s.photoButton} />
            ) : null}
          </View>
          {photoProblem ? (
            <Text style={s.photoProblem} accessibilityRole="alert" accessibilityLiveRegion="assertive">
              {photoProblem}
            </Text>
          ) : null}
        </View>

        {/* Account details */}
        <View style={s.section}>
          <SectionTitle>Account details</SectionTitle>
          <Card>
            <Row label="Full name" value={fullName} first s={s} />
            <Row label="Username" value={user?.username ?? '—'} s={s} />
            <Row label="Email" value={user?.email ?? '—'} s={s} />
            <Row label="Role" value={role} s={s} />
          </Card>
        </View>

        <ChangePasswordCard />

        {/* Your data */}
        <View style={s.section}>
          <SectionTitle>Your data</SectionTitle>
          <Card>
            <Muted>Download a copy of your profile, tasks, comments, files, messages, meeting notes and activity as a JSON file.</Muted>
            <Pressable onPress={openPrivacy} accessibilityRole="link" hitSlop={6} style={s.link}>
              <Text style={s.linkText}>Privacy policy</Text>
            </Pressable>
            {dataProblem ? <ErrorNote message={dataProblem} /> : null}
            <Button title="Download my data" variant="secondary" onPress={() => void downloadMyData()} loading={dataBusy} />
          </Card>
        </View>

        {/* Account */}
        <View style={s.section}>
          <SectionTitle>Account</SectionTitle>
          <Button
            title="Preferences & notifications"
            variant="secondary"
            accessibilityLabel="Preferences and notifications, opens Settings"
            onPress={() => navigation.navigate('Settings')}
          />
          {/* As on the website's Profile page (6a review). */}
          <SignOutButton />
        </View>
      </KeyboardAwareScrollView>
    </SafeAreaView>
  );
}

function Row({ label, value, first, s }: { label: string; value: string; first?: boolean; s: ReturnType<typeof makeStyles> }) {
  return (
    <View style={[s.row, !first && s.rowDivided]} accessible accessibilityLabel={`${label}: ${value}`}>
      <Text style={s.rowLabel}>{label}</Text>
      <Text style={s.rowValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: c.ground },
    scroll: { padding: spacing.lg, gap: spacing.lg },
    header: { alignItems: 'center', gap: spacing.xs, paddingVertical: spacing.lg },
    photo: { width: 112, height: 112, borderRadius: 56, borderWidth: 1, borderColor: c.line, marginBottom: spacing.sm, backgroundColor: c.surface },
    initialsBox: { width: 112, height: 112, borderRadius: 56, backgroundColor: c.brand, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.sm },
    initials: { color: c.onBrand, fontSize: fontSize.xxl, fontWeight: '800' },
    name: { fontSize: fontSize.xl, fontWeight: '800', color: c.ink, textAlign: 'center' },
    photoActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
    photoButton: { minWidth: 120 },
    photoProblem: { color: c.danger, fontSize: fontSize.sm, fontWeight: '600', textAlign: 'center', marginTop: spacing.xs },
    section: { gap: spacing.sm },
    row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.lg, paddingVertical: spacing.sm },
    rowDivided: { borderTopWidth: 1, borderTopColor: c.line },
    rowLabel: { fontSize: fontSize.sm, color: c.ink2 },
    rowValue: { flexShrink: 1, fontSize: fontSize.sm, fontWeight: '600', color: c.ink, textAlign: 'right' },
    link: { alignSelf: 'flex-start', marginVertical: spacing.md, borderRadius: radius.sm },
    linkText: { fontSize: fontSize.sm, fontWeight: '700', color: c.brand },
  });
