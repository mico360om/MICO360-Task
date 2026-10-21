import React, { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet, RefreshControl, AccessibilityInfo } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useUserId } from '../core/providers';
import { useColors } from '../core/theme';
import { useAfterUserChange, useUserActions, useUsers } from '../core/admin-queries';
import { Badge, ErrorNote, Loader, NoticeNote, TextField } from '../components/ui';
import { FilterChips } from '../components/project/parts';
import { ActionRowButton, Sheet, SheetButtons, SheetMessage } from '../components/meeting/sheet-kit';
import { ApiError } from '../lib/api-client';
import {
  USER_STATUSES,
  deleteProblem,
  filterOptions,
  filterUsers,
  lockedNote,
  rolesText,
  statusChangeProblem,
  statusLabel,
  statusTone,
  unlockDoneText,
  unlockProblem,
  userCardLabel,
  userFullName,
  usersLoadProblem,
  type ApiAdminUser,
  type UserFilter,
} from '../lib/users-admin';
import { spacing, radius, fontSize, type Palette } from '../lib/theme';
import type { AppScreenProps } from '../navigation/types';

/**
 * User Management (6b, administrators), as the website's: everyone's account with their role and
 * status, found by name, username or email and filtered by status (or a locked sign-in). New user,
 * Edit (details, role, status and a new password), the status, Unlock and Delete. Your own status
 * and account can't be changed here, as on the website; the server refuses what breaks its rules
 * (the last administrator) and says why. It needs a connection.
 */
export function UsersScreen({ navigation, route }: AppScreenProps<'Users'>) {
  const c = useColors();
  const s = useMemo(() => makeStyles(c), [c]);
  const myId = useUserId();
  const usersQ = useUsers();
  const actions = useUserActions();
  const after = useAfterUserChange();
  const [q, setQ] = useState(route.params?.q ?? '');
  const [filter, setFilter] = useState<UserFilter>('ALL');
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null);
  const [statusFor, setStatusFor] = useState<ApiAdminUser | null>(null);
  const [deleteFor, setDeleteFor] = useState<ApiAdminUser | null>(null);
  const [unlocking, setUnlocking] = useState<string | null>(null);

  // A person found by Search while this screen is open: their name goes into the search box.
  const asked = route.params?.q;
  useEffect(() => {
    if (asked !== undefined) setQ(asked);
  }, [asked]);

  const denied = usersQ.error instanceof ApiError && usersQ.error.status === 403;
  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: denied
        ? undefined
        : () => (
            <Pressable onPress={() => navigation.navigate('UserForm')} accessibilityRole="button" accessibilityLabel="New user" hitSlop={8} style={s.headerButton}>
              <Text style={s.headerButtonText}>+ New</Text>
            </Pressable>
          ),
    });
  }, [navigation, denied, s]);

  const users = useMemo(() => usersQ.data ?? [], [usersQ.data]);
  const shown = useMemo(() => filterUsers(users, { q, filter }), [users, q, filter]);
  const options = useMemo(() => filterOptions(users), [users]);
  const locked = lockedNote(users);
  // A filter that no longer has anyone (the last locked account unlocked) goes back to All.
  useEffect(() => {
    if (!options.some((o) => o.value === filter)) setFilter('ALL');
  }, [options, filter]);

  async function unlock(u: ApiAdminUser) {
    if (unlocking) return;
    setUnlocking(u.id);
    setNotice(null);
    try {
      await actions.unlock(u);
      const text = unlockDoneText(u);
      setNotice({ text });
      AccessibilityInfo.announceForAccessibility(text);
      after({ ...u, locked: false });
    } catch (e) {
      setNotice({ text: unlockProblem(e, u), error: true });
      after();
    } finally {
      setUnlocking(null);
    }
  }

  if (usersQ.isLoading) return <Loader />;

  if (usersQ.isError && !usersQ.data) {
    return (
      <SafeAreaView style={s.safe} edges={['bottom']}>
        <View style={s.scroll}>
          <ErrorNote message={usersLoadProblem(usersQ.error)} onRetry={denied ? undefined : () => void usersQ.refetch()} retrying={usersQ.isRefetching} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe} edges={['bottom']}>
      <FlatList
        data={shown}
        keyExtractor={(u) => u.id}
        contentContainerStyle={s.scroll}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={usersQ.isRefetching} onRefresh={() => void usersQ.refetch()} />}
        ListHeaderComponent={
          <View style={s.head}>
            <Text style={s.subtitle}>Create and edit accounts, assign roles, control access, and reset passwords.</Text>
            {notice ? (
              <View style={s.noticeRow}>
                <View style={s.flex}>{notice.error ? <ErrorNote message={notice.text} /> : <NoticeNote message={notice.text} />}</View>
                <Pressable onPress={() => setNotice(null)} accessibilityRole="button" accessibilityLabel="Dismiss" hitSlop={8} style={s.dismiss}>
                  <Text style={s.dismissText}>✕</Text>
                </Pressable>
              </View>
            ) : null}
            {locked ? (
              <Text style={s.locked} accessibilityLiveRegion="polite">
                {locked}
              </Text>
            ) : null}
            <TextField
              label="Search people"
              value={q}
              onChangeText={setQ}
              placeholder="Name, username or email"
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
              clearButtonMode="while-editing"
            />
            <FilterChips options={options} value={filter} onChange={setFilter} label="Show" />
            <Text style={s.count} accessibilityLiveRegion="polite">
              {shown.length === users.length ? `${users.length} ${users.length === 1 ? 'person' : 'people'}` : `${shown.length} of ${users.length} people`}
            </Text>
          </View>
        }
        ListEmptyComponent={
          <View style={s.empty}>
            <Text style={s.emptyText}>{users.length ? 'No one matches.' : 'No users yet.'}</Text>
            {users.length && (q || filter !== 'ALL') ? (
              <Pressable
                onPress={() => {
                  setQ('');
                  setFilter('ALL');
                }}
                accessibilityRole="button"
                style={s.clear}
              >
                <Text style={s.clearText}>Show everyone</Text>
              </Pressable>
            ) : null}
          </View>
        }
        renderItem={({ item }) => (
          <UserCard
            user={item}
            isSelf={item.id === myId}
            unlocking={unlocking === item.id}
            onEdit={() => navigation.navigate('UserForm', { userId: item.id })}
            onStatus={() => setStatusFor(item)}
            onUnlock={() => void unlock(item)}
            onDelete={() => setDeleteFor(item)}
            s={s}
          />
        )}
      />
      <StatusSheet user={statusFor} isSelf={statusFor?.id === myId} onClose={() => setStatusFor(null)} />
      <DeleteSheet user={deleteFor} onClose={() => setDeleteFor(null)} onDeleted={(u) => setNotice({ text: `${userFullName(u)}’s account was deleted.` })} />
    </SafeAreaView>
  );
}

type Styles = ReturnType<typeof makeStyles>;

const UserCard = React.memo(function UserCard({
  user: u,
  isSelf,
  unlocking,
  onEdit,
  onStatus,
  onUnlock,
  onDelete,
  s,
}: {
  user: ApiAdminUser;
  isSelf: boolean;
  unlocking: boolean;
  onEdit: () => void;
  onStatus: () => void;
  onUnlock: () => void;
  onDelete: () => void;
  s: Styles;
}) {
  const name = userFullName(u);
  return (
    <View style={s.card}>
      <View accessible accessibilityLabel={userCardLabel(u, isSelf)} style={s.info}>
        <View style={s.topRow}>
          <Text style={s.name} numberOfLines={2}>
            {name}
            {isSelf ? <Text style={s.you}> (you)</Text> : null}
          </Text>
          <Badge label={statusLabel(u.status)} tone={statusTone(u.status)} />
        </View>
        <Text style={s.meta} numberOfLines={1}>
          @{u.username}
        </Text>
        <Text style={s.meta} numberOfLines={1}>
          {u.email}
        </Text>
        <View style={s.tags}>
          <Text style={s.roles}>{rolesText(u.roles)}</Text>
          {u.locked ? <Badge label="🔒 Locked" tone="warning" /> : null}
        </View>
      </View>
      <View style={s.footer}>
        {u.locked ? <CardButton label={unlocking ? 'Unlocking…' : 'Unlock'} a11y={`Unlock ${u.username}`} onPress={onUnlock} disabled={unlocking} s={s} warning /> : null}
        <CardButton label="Edit" a11y={`Edit ${u.username}`} onPress={onEdit} s={s} />
        <CardButton
          label={`Status: ${statusLabel(u.status)}`}
          a11y={isSelf ? 'You can’t change your own status' : `Status for ${u.username}: ${statusLabel(u.status)}. Change it`}
          onPress={onStatus}
          disabled={isSelf}
          s={s}
        />
        <CardButton label="Delete" a11y={isSelf ? 'You can’t delete your own account' : `Delete ${u.username}`} onPress={onDelete} disabled={isSelf} danger s={s} />
      </View>
    </View>
  );
});

function CardButton({ label, a11y, onPress, disabled, danger, warning, s }: { label: string; a11y: string; onPress: () => void; disabled?: boolean; danger?: boolean; warning?: boolean; s: Styles }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      accessibilityState={{ disabled: !!disabled }}
      style={({ pressed }) => [s.button, warning && s.buttonWarning, pressed && s.pressed, disabled && s.disabled]}
    >
      <Text style={[s.buttonText, danger && s.buttonDanger, warning && s.buttonWarningText]}>{label}</Text>
    </Pressable>
  );
}

/** Active, Inactive or Suspended: saved at once (an inactive or suspended person is signed out everywhere). */
function StatusSheet({ user, isSelf, onClose }: { user: ApiAdminUser | null; isSelf: boolean; onClose: () => void }) {
  const actions = useUserActions();
  const after = useAfterUserChange();
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const close = () => {
    if (busy) return;
    setProblem(null);
    onClose();
  };
  async function choose(status: (typeof USER_STATUSES)[number]) {
    if (!user || busy) return;
    setBusy(status);
    setProblem(null);
    try {
      const updated = await actions.setStatus(user, status);
      after(updated);
      AccessibilityInfo.announceForAccessibility(`${userFullName(user)} is now ${statusLabel(status).toLowerCase()}.`);
      setBusy(null);
      onClose();
    } catch (e) {
      setProblem(statusChangeProblem(e));
      after();
      setBusy(null);
    }
  }
  return (
    <Sheet visible={!!user} title="Account status" subtitle={user ? `${userFullName(user)} · @${user.username}` : null} onClose={close} footer={<SheetButtons cancel="Close" onCancel={close} busy={!!busy} />}>
      {isSelf ? <SheetMessage tone="info" text="You can’t change your own status. Ask another administrator if it needs to change." /> : null}
      <SheetMessage text={problem} />
      {USER_STATUSES.map((st) => (
        <ActionRowButton
          key={st}
          label={`${statusLabel(st)}${user?.status === st ? ' ✓' : ''}`}
          hint={st === 'ACTIVE' ? 'Can sign in' : 'Signed out everywhere, and can’t sign in'}
          busy={busy === st}
          disabled={!user || isSelf || user.status === st || !!busy}
          onPress={() => void choose(st)}
        />
      ))}
    </Sheet>
  );
}

/** Delete an account, after a second tap (the website's Confirm). */
function DeleteSheet({ user, onClose, onDeleted }: { user: ApiAdminUser | null; onClose: () => void; onDeleted: (u: ApiAdminUser) => void }) {
  const actions = useUserActions();
  const after = useAfterUserChange();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const close = () => {
    if (busy) return;
    setProblem(null);
    onClose();
  };
  async function remove() {
    if (!user || busy) return;
    setBusy(true);
    setProblem(null);
    try {
      await actions.remove(user);
      after({ removed: user.id });
      AccessibilityInfo.announceForAccessibility(`${userFullName(user)}’s account was deleted.`);
      setBusy(false);
      onDeleted(user);
      onClose();
    } catch (e) {
      setProblem(deleteProblem(e));
      after();
      setBusy(false);
    }
  }
  return (
    <Sheet
      visible={!!user}
      title="Delete user"
      subtitle={user ? `${userFullName(user)} · @${user.username}` : null}
      onClose={close}
      footer={<SheetButtons cancel="No, keep" onCancel={close} confirm={busy ? 'Deleting…' : 'Delete'} onConfirm={() => void remove()} busy={busy} danger />}
    >
      <SheetMessage tone="info" text="They won’t be able to sign in any more, and are signed out everywhere." />
      <SheetMessage text={problem} />
    </Sheet>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: c.ground },
    scroll: { padding: spacing.lg, gap: spacing.md },
    flex: { flex: 1 },
    head: { gap: spacing.sm },
    subtitle: { fontSize: fontSize.sm, color: c.ink2 },
    noticeRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xs },
    dismiss: { minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center' },
    dismissText: { fontSize: fontSize.md, color: c.ink2, fontWeight: '700' },
    locked: { fontSize: fontSize.sm, color: c.warning, backgroundColor: c.warningSoft, borderRadius: radius.md, padding: spacing.md },
    count: { fontSize: fontSize.sm, color: c.ink2 },
    card: { backgroundColor: c.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: c.line, padding: spacing.lg, gap: spacing.md },
    info: { gap: 2 },
    topRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.sm, flexWrap: 'wrap' },
    name: { flexShrink: 1, fontSize: fontSize.md, fontWeight: '700', color: c.ink },
    you: { fontWeight: '400', color: c.ink2 },
    meta: { fontSize: fontSize.sm, color: c.ink2 },
    tags: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm, marginTop: spacing.xs },
    roles: { fontSize: fontSize.sm, color: c.ink, fontWeight: '600' },
    footer: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    button: { minHeight: 44, justifyContent: 'center', paddingHorizontal: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: c.line },
    buttonWarning: { borderColor: c.warning },
    buttonText: { fontSize: fontSize.sm, fontWeight: '700', color: c.ink },
    buttonWarningText: { color: c.warning },
    buttonDanger: { color: c.danger },
    pressed: { opacity: 0.7 },
    disabled: { opacity: 0.4 },
    headerButton: { minHeight: 44, justifyContent: 'center', paddingHorizontal: spacing.md },
    headerButtonText: { color: c.onBrand, fontWeight: '800', fontSize: fontSize.md },
    empty: { alignItems: 'center', padding: spacing.xl, gap: spacing.sm },
    emptyText: { fontSize: fontSize.md, color: c.ink2 },
    clear: { minHeight: 44, justifyContent: 'center', paddingHorizontal: spacing.md },
    clearText: { fontSize: fontSize.sm, fontWeight: '700', color: c.brand },
  });
