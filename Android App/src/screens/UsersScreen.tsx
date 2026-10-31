import React, { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet, RefreshControl, AccessibilityInfo } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSession, useUserId } from '../core/providers';
import { useColors } from '../core/theme';
import { useAfterUserChange, useUserActions, useUsers, useWelcomeEmails } from '../core/admin-queries';
import { useServerConfig } from '../core/queries';
import { Avatar, Badge, Button, Chip, ErrorNote, IconButton, Muted, NoticeNote, SkeletonList, TextField } from '../components/ui';
import { Icon } from '../components/Icon';
import { notice as toast } from '../components/notice';
import { FilterChips } from '../components/project/parts';
import { ChoiceSheet } from '../components/my-tasks/ChoiceSheet';
import { ActionRowButton, Sheet, SheetButtons, SheetMessage } from '../components/meeting/sheet-kit';
import { WelcomeManySheet, WelcomeOneSheet, WelcomeResultSheet } from '../components/users/WelcomeSheets';
import { ApiError } from '../lib/api-client';
import { appTimeZone } from '../lib/due-date';
import { MAX_WELCOME_BATCH, signInText, sortBySignIn, welcomeBlockedReason, welcomeCandidates, welcomeSentText, type SignInSort } from '../lib/user-sign-in';
import {
  NEVER_EMPTY,
  SIGN_IN_SORTS,
  USERS_SUBTITLE,
  USER_STATUSES,
  WELCOME_TEXT,
  deleteProblem,
  filterOptions,
  filterUsers,
  lockedNote,
  offersNewUser,
  rolesText,
  statusChangeProblem,
  statusLabel,
  statusTone,
  unlockDoneText,
  unlockProblem,
  selectedText,
  userCardLabel,
  userFullName,
  usersLoadProblem,
  welcomeProblem,
  welcomeSentNotice,
  type ApiAdminUser,
  type UserFilter,
  type WelcomeBatchResult,
} from '../lib/users-admin';
import { spacing, radius, fontSize, type Palette } from '../lib/theme';
import type { AppScreenProps } from '../navigation/types';
import { font } from '../lib/typography';

/**
 * User Management (6b, administrators), as the website's: everyone's account with their role,
 * status and last sign-in, found by name, username or email, filtered by status, "Never signed in"
 * (or a locked sign-in) and sorted by last sign-in. New user, Edit (details, role, status and a new
 * password), the status, Unlock and Delete; welcome emails to one person, the ticked ones, or
 * everyone who has never signed in (1.13). Your own status and account can't be changed here, as on
 * the website; the server refuses what breaks its rules (the last administrator) and says why. It
 * needs a connection.
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
  const [sort, setSort] = useState<SignInSort>('newest');
  const [sortOpen, setSortOpen] = useState(false);
  // People ticked for "Send welcome emails" (sent in the list's own order).
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  // How many "everyone who has never signed in" left out; null once the ticks are changed by hand.
  const [leftOut, setLeftOut] = useState<number | null>(null);
  const [welcomeFor, setWelcomeFor] = useState<ApiAdminUser | null>(null);
  const [manyOpen, setManyOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [batchResult, setBatchResult] = useState<WelcomeBatchResult | null>(null);
  const welcome = useWelcomeEmails();
  // Welcome emails need email set up on the server (until /config answers, they're offered).
  const emailEnabled = useServerConfig().data?.emailEnabled !== false;
  const timeZone = appTimeZone();

  // A person found by Search while this screen is open: their name goes into the search box.
  const asked = route.params?.q;
  useEffect(() => {
    if (asked !== undefined) setQ(asked);
  }, [asked]);

  const denied = usersQ.error instanceof ApiError && usersQ.error.status === 403;
  const isAdmin = (useSession()?.user.roles ?? []).includes('ADMIN');
  const showNew = offersNewUser({ isAdmin, listed: usersQ.isSuccess, denied });
  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: showNew
        ? () => (
            <IconButton icon="ui.plus" label="New user" color={c.brandText} onPress={() => navigation.navigate('UserForm')} />
          )
        : undefined,
    });
  }, [navigation, showNew, c]);

  const users = useMemo(() => usersQ.data ?? [], [usersQ.data]);
  const shown = useMemo(() => sortBySignIn(filterUsers(users, { q, filter }), sort), [users, q, filter, sort]);
  const options = useMemo(() => filterOptions(users), [users]);
  const locked = lockedNote(users);
  const chosen = useMemo(() => users.filter((u) => selected.has(u.id)), [users, selected]);
  const candidates = useMemo(() => welcomeCandidates(users, new Date()), [users]);
  const sortLabel = SIGN_IN_SORTS.find((o) => o.value === sort)!.label;

  const pickNeverSignedIn = () => {
    setSelected(new Set(candidates.pick.map((u) => u.id)));
    setLeftOut(candidates.leftOut);
  };
  const clearSelection = () => {
    setSelected(new Set());
    setLeftOut(null);
  };
  const toggle = useCallback((id: string) => {
    setLeftOut(null);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const openWelcome = useCallback((u: ApiAdminUser) => {
    setSendError(null);
    setWelcomeFor(u);
  }, []);

  async function sendOne() {
    if (!welcomeFor || sending) return;
    const u = welcomeFor;
    setSending(true);
    setSendError(null);
    try {
      const out = await welcome.sendOne(u);
      setWelcomeFor(null);
      toast(welcomeSentNotice({ username: u.username, email: out.email ?? u.email }));
    } catch (e) {
      setSendError(welcomeProblem(e));
    } finally {
      setSending(false);
    }
  }

  async function sendMany() {
    if (sending || chosen.length === 0 || chosen.length > MAX_WELCOME_BATCH) return;
    setSending(true);
    setSendError(null);
    try {
      const r = await welcome.sendMany(chosen.map((u) => u.id));
      setManyOpen(false);
      clearSelection();
      // All sent: a short notice; anyone left without one: the answer, with each and why.
      if (r.notSent > 0) setBatchResult(r);
      else toast(`Sent ${r.sent}.`);
    } catch (e) {
      setSendError(welcomeProblem(e));
    } finally {
      setSending(false);
    }
  }
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

  if (usersQ.isLoading) return <SkeletonList rows={5} avatar />;

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
            <Text style={s.subtitle}>{USERS_SUBTITLE}</Text>
            {notice ? (
              <View style={s.noticeRow}>
                <View style={s.flex}>{notice.error ? <ErrorNote message={notice.text} /> : <NoticeNote message={notice.text} />}</View>
                <Pressable onPress={() => setNotice(null)} accessibilityRole="button" accessibilityLabel="Dismiss" hitSlop={8} style={s.dismiss}>
                  <Icon name="ui.close" size={18} color={c.ink2} />
                </Pressable>
              </View>
            ) : null}
            {!emailEnabled ? <Text style={s.locked}>{WELCOME_TEXT.emailOff}</Text> : null}
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
            <View style={s.tools}>
              <Chip label={sortLabel} a11yLabel={`Sort: ${sortLabel}. Change it`} selected={sort !== 'newest'} onPress={() => setSortOpen(true)} />
            </View>
            {emailEnabled ? (
              <View style={s.welcome}>
                <Button
                  title={WELCOME_TEXT.pickNever}
                  variant="secondary"
                  size="sm"
                  onPress={pickNeverSignedIn}
                  disabled={candidates.pick.length === 0}
                  accessibilityHint={candidates.pick.length === 0 ? WELCOME_TEXT.nobody : undefined}
                />
                {candidates.pick.length === 0 ? <Muted>{WELCOME_TEXT.nobody}</Muted> : null}
                {chosen.length > 0 ? (
                  <View style={s.selection}>
                    <Text style={s.selected} accessibilityLiveRegion="polite">
                      {selectedText(chosen.length)}
                    </Text>
                    <Button
                      title={WELCOME_TEXT.sendMany}
                      size="sm"
                      onPress={() => {
                        setSendError(null);
                        setManyOpen(true);
                      }}
                      disabled={chosen.length > MAX_WELCOME_BATCH}
                    />
                    <Button title={WELCOME_TEXT.clear} variant="ghost" size="sm" onPress={clearSelection} />
                  </View>
                ) : null}
                {chosen.length > MAX_WELCOME_BATCH ? <Text style={s.tooMany}>{WELCOME_TEXT.tooMany}</Text> : null}
              </View>
            ) : null}
            <Text style={s.count} accessibilityLiveRegion="polite">
              {shown.length === users.length ? `${users.length} ${users.length === 1 ? 'person' : 'people'}` : `${shown.length} of ${users.length} people`}
            </Text>
          </View>
        }
        ListEmptyComponent={
          <View style={s.empty}>
            <Text style={s.emptyText}>{filter === 'NEVER' && !q.trim() && users.length ? NEVER_EMPTY : users.length ? 'No one matches.' : 'No users yet.'}</Text>
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
            welcome={emailEnabled ? { selected: selected.has(item.id), blocked: welcomeBlockedReason(item, myId), onToggle: toggle, onSend: openWelcome } : null}
            timeZone={timeZone}
            s={s}
          />
        )}
      />
      <ChoiceSheet
        visible={sortOpen}
        title="Sort"
        options={SIGN_IN_SORTS}
        value={sort}
        onChoose={(v) => {
          setSort(v as SignInSort);
          setSortOpen(false);
        }}
        onClose={() => setSortOpen(false)}
      />
      <WelcomeOneSheet user={welcomeFor} busy={sending} error={sendError} onSend={() => void sendOne()} onClose={() => setWelcomeFor(null)} />
      <WelcomeManySheet
        visible={manyOpen}
        names={chosen.map(userFullName)}
        leftOut={leftOut}
        busy={sending}
        error={sendError}
        onSend={() => void sendMany()}
        onClose={() => setManyOpen(false)}
      />
      <WelcomeResultSheet result={batchResult} onClose={() => setBatchResult(null)} />
      <StatusSheet user={statusFor} isSelf={statusFor?.id === myId} onClose={() => setStatusFor(null)} />
      <DeleteSheet user={deleteFor} onClose={() => setDeleteFor(null)} onDeleted={(u) => setNotice({ text: `${userFullName(u)}’s account was deleted.` })} />
    </SafeAreaView>
  );
}

type Styles = ReturnType<typeof makeStyles>;

/** A person's welcome-email parts on their card (none while email isn't set up on the server). */
type CardWelcome = { selected: boolean; blocked: string | null; onToggle: (id: string) => void; onSend: (u: ApiAdminUser) => void };

const UserCard = React.memo(function UserCard({
  user: u,
  isSelf,
  unlocking,
  onEdit,
  onStatus,
  onUnlock,
  onDelete,
  welcome,
  timeZone,
  s,
}: {
  user: ApiAdminUser;
  isSelf: boolean;
  unlocking: boolean;
  onEdit: () => void;
  onStatus: () => void;
  onUnlock: () => void;
  onDelete: () => void;
  welcome: CardWelcome | null;
  timeZone: string;
  s: Styles;
}) {
  const c = useColors();
  const name = userFullName(u);
  const signIn = signInText(u.lastLoginAt, timeZone);
  const sentLine = u.welcomeSentAt ? welcomeSentText(u.welcomeSentAt, timeZone) : null;
  return (
    <View style={s.card}>
      <View style={s.cardTop}>
        {welcome ? (
          <Pressable
            onPress={() => welcome.onToggle(u.id)}
            accessibilityRole="checkbox"
            accessibilityLabel={`Select ${u.username}`}
            accessibilityState={{ checked: welcome.selected }}
            style={s.tick}
          >
            <View style={[s.tickBox, welcome.selected && s.tickBoxOn]}>{welcome.selected ? <Icon name="misc.check" size={14} color={c.onBrand} /> : null}</View>
          </Pressable>
        ) : null}
        <View accessible accessibilityLabel={userCardLabel(u, isSelf)} style={[s.info, s.flex]}>
          <View style={s.topRow}>
            <Avatar name={name} src={u.avatarUrl} size="md" />
            <Text style={[s.name, s.flex]} numberOfLines={2}>
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
            {u.locked ? <Badge label="Locked" tone="warning" dot /> : null}
          </View>
        </View>
      </View>
      <View accessible accessibilityLabel={`Last sign-in: ${signIn}${sentLine ? `. ${sentLine}` : ''}`} style={s.signIn}>
        <Text style={s.signInLabel}>Last sign-in</Text>
        <Text style={[s.signInText, !u.lastLoginAt && s.never]}>{signIn}</Text>
        {sentLine ? <Text style={s.meta}>{sentLine}</Text> : null}
      </View>
      <View style={s.footer}>
        {welcome ? (
          <IconButton
            icon="kit.mail"
            label={`Send welcome email to ${u.username}`}
            hint={welcome.blocked ?? undefined}
            disabled={!!welcome.blocked}
            variant="outlined"
            onPress={() => welcome.onSend(u)}
          />
        ) : null}
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
          label={`${statusLabel(st)}${user?.status === st ? ' (current)' : ''}`}
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
    locked: { fontSize: fontSize.sm, color: c.warningText, backgroundColor: c.warningSoft, borderRadius: radius.input, padding: spacing.md },
    count: { fontSize: fontSize.sm, color: c.ink2 },
    tools: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, alignItems: 'center' },
    welcome: { gap: spacing.sm, alignItems: 'flex-start' },
    selection: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm },
    selected: { fontSize: fontSize.sm, ...font('600'), color: c.ink },
    tooMany: { fontSize: fontSize.sm, color: c.warningText },
    cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xs },
    // The box is 22 dp; the finger-sized target around it reaches 44 (into the card's padding).
    tick: { width: 44, height: 44, marginLeft: -spacing.md, marginTop: -spacing.sm, alignItems: 'center', justifyContent: 'center' },
    tickBox: { width: 22, height: 22, borderRadius: radius.badge, borderWidth: 1.5, borderColor: c.ink3, backgroundColor: c.surface, alignItems: 'center', justifyContent: 'center' },
    tickBoxOn: { backgroundColor: c.brand, borderColor: c.brand },
    signIn: { gap: 2 },
    signInLabel: { fontSize: fontSize.xs, color: c.ink3 },
    signInText: { fontSize: fontSize.sm, color: c.ink },
    never: { fontStyle: 'italic', color: c.ink2 },
    card: { backgroundColor: c.surface, borderRadius: radius.card, borderWidth: 1, borderColor: c.line, padding: spacing.lg, gap: spacing.md },
    info: { gap: 2 },
    topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, flexWrap: 'wrap' },
    name: { flexShrink: 1, fontSize: fontSize.md, ...font('700'), color: c.ink },
    you: { ...font('400'), color: c.ink2 },
    meta: { fontSize: fontSize.sm, color: c.ink2 },
    tags: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm, marginTop: spacing.xs },
    roles: { fontSize: fontSize.sm, color: c.ink, ...font('600') },
    footer: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    button: { minHeight: 44, justifyContent: 'center', paddingHorizontal: spacing.md, borderRadius: radius.button, borderWidth: 1, borderColor: c.line },
    buttonWarning: { borderColor: c.warning },
    buttonText: { fontSize: fontSize.sm, ...font('700'), color: c.ink },
    buttonWarningText: { color: c.warningText },
    buttonDanger: { color: c.dangerText },
    pressed: { opacity: 0.7 },
    disabled: { opacity: 0.4 },
    empty: { alignItems: 'center', padding: spacing.xl, gap: spacing.sm },
    emptyText: { fontSize: fontSize.md, color: c.ink2 },
    clear: { minHeight: 44, justifyContent: 'center', paddingHorizontal: spacing.md },
    clearText: { fontSize: fontSize.sm, ...font('700'), color: c.brandText },
  });
