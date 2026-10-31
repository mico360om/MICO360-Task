import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, Alert, AccessibilityInfo, AppState, type TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import { useUserId } from '../core/providers';
import { useColors } from '../core/theme';
import { useServerConfig } from '../core/queries';
import { useAdminUser, useAfterUserChange, useUserActions } from '../core/admin-queries';
import { Button, Card, ErrorNote, SkeletonList, Muted, NoticeNote, SectionTitle, TextField, Toggle } from '../components/ui';
import { notice } from '../components/notice';
import { ApiError } from '../lib/api-client';
import { KeyboardAwareScrollView, KeyboardGroup } from '../components/KeyboardAware';
import { CheckRow, ChipChoice } from '../components/meeting/sheet-kit';
import { newIdempotencyKey } from '../lib/idempotency';
import { SIGN_IN_LIMITS } from '../lib/auth';
import { PASSWORD_RULE_HINT, createPasswordWipe } from '../lib/password-change';
import {
  NEW_USER_TEXT,
  RESET_DONE,
  ROLE_OPTIONS,
  StatusAfterSaveError,
  USER_STATUSES,
  checkNewUser,
  checkResetPassword,
  checkUserEdit,
  createUserProblem,
  createdNotice,
  editChanged,
  editFormOf,
  resetProblem,
  saveProblem,
  statusAfterSaveText,
  statusLabel,
  userFullName,
  usersLoadProblem,
  type ApiAdminUser,
  type NewUserField,
  type NewUserForm,
  type UserEditField,
  type UserEditForm,
  type UserStatus,
} from '../lib/users-admin';
import { spacing, fontSize, type Palette } from '../lib/theme';
import type { AppScreenProps } from '../navigation/types';
import { font } from '../lib/typography';

/** The longest name, username or email the server takes. */
const NAME_MAX = 191;

/**
 * New user, or Manage account (6b, administrators), as the website's dialogs. New user: the name,
 * username, email, "Send a welcome email" (on unless email isn't set up on the server), a temporary
 * password (optional while a welcome email goes: they set their own with its link) and the role. Manage account: the details, the status and
 * the roles (your own are read-only, as on the website), and "Reset password" to set a new one.
 * Passwords stay only in their fields: emptied once used, when you leave the screen, and after a
 * minute away from the app.
 */
export function UserFormScreen({ navigation, route }: AppScreenProps<'UserForm'>) {
  const userId = route.params?.userId;
  const { user, query } = useAdminUser(userId);
  if (!userId) return <NewUserForm navigation={navigation} />;
  if (query.isLoading) return <SkeletonList rows={5} />;
  if (!user) {
    const text = query.isError ? usersLoadProblem(query.error) : 'This account isn’t there any more.';
    return <Missing text={text} onRetry={query.isError ? () => void query.refetch() : undefined} />;
  }
  return <ManageAccount user={user} navigation={navigation} />;
}

type Nav = AppScreenProps<'UserForm'>['navigation'];

function Missing({ text, onRetry }: { text: string; onRetry?: () => void }) {
  const s = useStyles();
  return (
    <SafeAreaView style={s.safe} edges={['bottom']}>
      <View style={s.body}>
        <ErrorNote message={text} onRetry={onRetry} />
      </View>
    </SafeAreaView>
  );
}

/** Leaving with something typed asks first; while sending, it waits (a lost answer could be lost twice). */
function useLeaveGuard(navigation: Nav, dirty: boolean, busy: React.MutableRefObject<boolean>, left: React.MutableRefObject<boolean>, what: string) {
  useEffect(
    () =>
      navigation.addListener('beforeRemove', (e) => {
        if (left.current || !dirty) return;
        e.preventDefault();
        if (busy.current) {
          Alert.alert('Still saving', 'Wait a moment until it is saved.');
          return;
        }
        Alert.alert('Discard your changes?', `What you entered for ${what} hasn’t been saved.`, [
          { text: 'Keep editing', style: 'cancel' },
          { text: 'Discard', style: 'destructive', onPress: () => navigation.dispatch(e.data.action) },
        ]);
      }),
    [navigation, dirty, busy, left, what],
  );
}

/**
 * Passwords are emptied when you leave the screen, or after a minute away from the app — kept while
 * you copy one from a password manager (the 6a rule as the 5b review changed it: lib/password-change).
 */
function useClearOnLeave(navigation: Nav, clear: () => void) {
  const latest = useRef(clear);
  latest.current = clear;
  useEffect(() => {
    const offBlur = navigation.addListener('blur', () => latest.current());
    const wipe = createPasswordWipe();
    const sub = AppState.addEventListener('change', (state) => {
      if (wipe.onAppState(state)) latest.current();
    });
    return () => {
      offBlur();
      sub.remove();
    };
  }, [navigation]);
}

const EMPTY: NewUserForm = { firstName: '', lastName: '', username: '', email: '', password: '', role: 'EMPLOYEE', sendWelcome: true };

function NewUserForm({ navigation }: { navigation: Nav }) {
  const s = useStyles();
  const actions = useUserActions();
  const after = useAfterUserChange();
  const qc = useQueryClient();
  // Welcome emails need email set up on the server (until /config answers, they're offered).
  const emailEnabled = useServerConfig().data?.emailEnabled !== false;
  const [form, setForm] = useState<NewUserForm>(EMPTY);
  const [problem, setProblem] = useState<{ field: NewUserField | null; message: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  const left = useRef(false);
  // The try's key: the same form sent again after a lost answer is answered with the first result.
  const key = useRef<{ key: string; sent: string } | null>(null);
  const refs = {
    firstName: useRef<TextInput>(null),
    lastName: useRef<TextInput>(null),
    username: useRef<TextInput>(null),
    email: useRef<TextInput>(null),
    password: useRef<TextInput>(null),
  };
  const dirty = (Object.keys(EMPTY) as (keyof NewUserForm)[]).some((k) => k !== 'role' && k !== 'sendWelcome' && form[k] !== '');
  // What is sent: no welcome email while email isn't set up, whatever the switch was left on.
  const toSend: NewUserForm = { ...form, sendWelcome: emailEnabled && form.sendWelcome };
  useLeaveGuard(navigation, dirty, busy, left, 'the new user');
  useClearOnLeave(navigation, () => setForm((f) => (f.password ? { ...f, password: '' } : f)));

  const set = (patch: Partial<NewUserForm>) => {
    setForm((f) => ({ ...f, ...patch }));
    setProblem(null);
  };
  const fieldError = (f: NewUserField) => (problem?.field === f ? problem.message : null);

  async function submit() {
    if (busy.current) return;
    const bad = checkNewUser(toSend, { emailEnabled });
    if (bad) {
      setProblem(bad);
      refs[bad.field].current?.focus();
      return;
    }
    const sent = JSON.stringify(toSend);
    if (!key.current || key.current.sent !== sent) key.current = { key: newIdempotencyKey(), sent };
    busy.current = true;
    setSaving(true);
    setProblem(null);
    try {
      const created = await actions.create(toSend, key.current.key);
      left.current = true;
      after(created.user);
      AccessibilityInfo.announceForAccessibility(`Account created for ${userFullName(created.user)}.`);
      // Back on the list, it says whether the welcome email went (and why not).
      notice(createdNotice(created));
      navigation.goBack();
    } catch (e) {
      const p = createUserProblem(e);
      // The phone thought email was set up: ask the server again, so the switch shows as unavailable.
      if (e instanceof ApiError && e.code === 'EMAIL_NOT_CONFIGURED') void qc.invalidateQueries({ queryKey: ['server', 'config'] });
      // An answered refusal makes the next try a new one; no answer keeps the key for the same try again.
      if (!p.unsure) key.current = null;
      setProblem(p);
      if (p.field) refs[p.field].current?.focus();
      after();
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }

  const field = (k: Exclude<NewUserField, 'password'>, label: string, extra: Partial<React.ComponentProps<typeof TextField>> = {}) => (
    <TextField
      inputRef={refs[k]}
      label={label}
      required
      value={form[k]}
      onChangeText={(v) => set({ [k]: v })}
      maxLength={NAME_MAX}
      editable={!saving}
      error={fieldError(k)}
      returnKeyType="next"
      blurOnSubmit={false}
      {...extra}
    />
  );

  return (
    <SafeAreaView style={s.safe} edges={['bottom']}>
      <KeyboardAwareScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
        {problem && !problem.field ? <ErrorNote message={problem.message} /> : null}
        <Card>
          {field('firstName', 'First name', { onSubmitEditing: () => refs.lastName.current?.focus() })}
          {field('lastName', 'Last name', { onSubmitEditing: () => refs.username.current?.focus() })}
          {field('username', 'Username', { autoCapitalize: 'none', autoCorrect: false, onSubmitEditing: () => refs.email.current?.focus() })}
          {field('email', 'Email', { keyboardType: 'email-address', autoCapitalize: 'none', autoCorrect: false, autoComplete: 'email', onSubmitEditing: () => refs.password.current?.focus() })}
          <View style={s.welcome}>
            <Toggle
              label={NEW_USER_TEXT.welcome}
              on={toSend.sendWelcome}
              disabled={!emailEnabled || saving}
              hint={emailEnabled ? NEW_USER_TEXT.welcomeHint : NEW_USER_TEXT.welcomeOffHint}
              onChange={(on) => set({ sendWelcome: on })}
            />
            <Muted>{emailEnabled ? NEW_USER_TEXT.welcomeHint : NEW_USER_TEXT.welcomeOffHint}</Muted>
          </View>
          <TextField
            inputRef={refs.password}
            label={`${NEW_USER_TEXT.password}${toSend.sendWelcome ? NEW_USER_TEXT.optional : ''}`}
            required={!toSend.sendWelcome}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            // The new person's password, not yours: the phone's password manager doesn't offer to save it (6b review).
            autoComplete="off"
            importantForAutofill="no"
            value={form.password}
            onChangeText={(v) => set({ password: v })}
            maxLength={SIGN_IN_LIMITS.password}
            editable={!saving}
            accessibilityHint={PASSWORD_RULE_HINT}
            error={fieldError('password')}
            returnKeyType="done"
          />
          {fieldError('password') ? null : (
            <Text style={s.hint} importantForAccessibility="no">
              {PASSWORD_RULE_HINT}
            </Text>
          )}
          {toSend.sendWelcome ? <Text style={s.hint}>{NEW_USER_TEXT.leaveEmpty}</Text> : null}
          <ChipChoice label="Role" options={[...ROLE_OPTIONS].reverse().map((r) => ({ value: r.value, label: r.label }))} value={form.role} onChange={(role) => set({ role })} disabled={saving} />
        </Card>
        <Button title={saving ? 'Creating…' : 'Create user'} accessibilityLabel="Create user" onPress={() => void submit()} loading={saving} />
      </KeyboardAwareScrollView>
    </SafeAreaView>
  );
}

function ManageAccount({ user, navigation }: { user: ApiAdminUser; navigation: Nav }) {
  const s = useStyles();
  const myId = useUserId();
  const isSelf = user.id === myId;
  const actions = useUserActions();
  const after = useAfterUserChange();
  const [form, setForm] = useState<UserEditForm>(() => editFormOf(user));
  const [problem, setProblem] = useState<{ field: UserEditField | null; message: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  const left = useRef(false);
  const refs = { firstName: useRef<TextInput>(null), lastName: useRef<TextInput>(null), username: useRef<TextInput>(null), email: useRef<TextInput>(null) };
  const dirty = editChanged(user, form);
  useLeaveGuard(navigation, dirty, busy, left, 'this account');

  const set = (patch: Partial<UserEditForm>) => {
    setForm((f) => ({ ...f, ...patch }));
    setProblem(null);
  };
  const toggleRole = (role: string) => set({ roles: form.roles.includes(role) ? form.roles.filter((r) => r !== role) : [...form.roles, role] });
  const fieldError = (f: UserEditField) => (problem?.field === f ? problem.message : null);

  async function submit() {
    if (busy.current) return;
    const bad = checkUserEdit(form, isSelf);
    if (bad) {
      setProblem(bad);
      if (bad.field) refs[bad.field].current?.focus();
      return;
    }
    busy.current = true;
    setSaving(true);
    setProblem(null);
    try {
      const saved = await actions.save(user, form, isSelf);
      left.current = true;
      after(saved);
      AccessibilityInfo.announceForAccessibility('Changes saved.');
      navigation.goBack();
    } catch (e) {
      if (e instanceof StatusAfterSaveError) {
        after(e.saved);
        setProblem({ field: null, message: statusAfterSaveText(e.inner) });
      } else {
        setProblem({ field: null, message: saveProblem(e) });
        after();
      }
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }

  const field = (k: UserEditField, label: string, extra: Partial<React.ComponentProps<typeof TextField>> = {}) => (
    <TextField inputRef={refs[k]} label={label} required value={form[k]} onChangeText={(v) => set({ [k]: v })} maxLength={NAME_MAX} editable={!saving} error={fieldError(k)} {...extra} />
  );

  return (
    <SafeAreaView style={s.safe} edges={['bottom']}>
      <KeyboardAwareScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
        <View accessible accessibilityRole="header" accessibilityLabel={`Manage account: ${userFullName(user)}, @${user.username}${isSelf ? ', you' : ''}`}>
          <Text style={s.eyebrow}>Manage account</Text>
          <Text style={s.title}>{userFullName(user)}</Text>
          <Muted>@{user.username}</Muted>
        </View>
        {problem && !problem.field ? <ErrorNote message={problem.message} /> : null}

        <View style={s.section}>
          <SectionTitle>Profile</SectionTitle>
          <Card>
            {field('firstName', 'First name')}
            {field('lastName', 'Last name')}
            {field('username', 'Username', { autoCapitalize: 'none', autoCorrect: false })}
            {field('email', 'Email', { keyboardType: 'email-address', autoCapitalize: 'none', autoCorrect: false })}
          </Card>
        </View>

        <View style={s.section}>
          <SectionTitle>Access</SectionTitle>
          <Card>
            {isSelf ? <Muted style={s.selfNote}>You can’t change your own roles or account status. Ask another administrator if they need to change.</Muted> : null}
            <ChipChoice<UserStatus>
              label="Account status"
              options={USER_STATUSES.map((st) => ({ value: st, label: statusLabel(st) }))}
              value={form.status}
              onChange={(status) => set({ status })}
              disabled={isSelf || saving}
            />
            <Text style={s.label} importantForAccessibility="no">
              Roles &amp; permissions
            </Text>
            {ROLE_OPTIONS.map((r) => (
              <View key={r.value} style={s.role}>
                <CheckRow label={r.label} checked={form.roles.includes(r.value)} onChange={() => toggleRole(r.value)} disabled={isSelf || saving} />
                <Text style={s.roleHint} importantForAccessibility="no">
                  {r.hint}
                </Text>
              </View>
            ))}
          </Card>
        </View>

        <Button title={saving ? 'Saving…' : 'Save changes'} accessibilityLabel="Save changes" onPress={() => void submit()} loading={saving} />

        <ResetPassword user={user} navigation={navigation} />
      </KeyboardAwareScrollView>
    </SafeAreaView>
  );
}

/** "Reset password", as on the website: a new password for this person (it also unlocks a locked account). */
function ResetPassword({ user, navigation }: { user: ApiAdminUser; navigation: Nav }) {
  const s = useStyles();
  const actions = useUserActions();
  const after = useAfterUserChange();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null);
  const inputRef = useRef<TextInput>(null);
  useClearOnLeave(navigation, () => setPassword(''));

  async function reset() {
    if (busy) return;
    setNotice(null);
    const bad = checkResetPassword(password);
    if (bad) {
      setNotice({ text: bad, error: true });
      inputRef.current?.focus();
      return;
    }
    setBusy(true);
    try {
      await actions.resetPassword(user, password);
      setPassword('');
      setNotice({ text: RESET_DONE });
      AccessibilityInfo.announceForAccessibility(RESET_DONE);
      after({ ...user, locked: false });
    } catch (e) {
      setNotice({ text: resetProblem(e), error: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={s.section}>
      <SectionTitle>Reset password</SectionTitle>
      <Card>
        <Muted style={s.selfNote}>Set a new password for this user. They can change it after signing in. Resetting also unlocks a locked account.</Muted>
        {notice ? notice.error ? <ErrorNote message={notice.text} /> : <NoticeNote message={notice.text} /> : null}
        <KeyboardGroup>
          <TextField
            inputRef={inputRef}
            label="New password"
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            // This person's password, not yours: the phone's password manager doesn't offer to save it (6b review).
            autoComplete="off"
            importantForAutofill="no"
            value={password}
            onChangeText={(v) => {
              setPassword(v);
              setNotice(null);
            }}
            maxLength={SIGN_IN_LIMITS.password}
            editable={!busy}
            accessibilityHint={PASSWORD_RULE_HINT}
            returnKeyType="done"
            onSubmitEditing={() => void reset()}
          />
          <Text style={s.hint} importantForAccessibility="no">
            {PASSWORD_RULE_HINT}
          </Text>
          <Button title="Reset" variant="secondary" accessibilityLabel={`Reset the password for ${user.username}`} onPress={() => void reset()} loading={busy} disabled={!password} />
        </KeyboardGroup>
      </Card>
    </View>
  );
}

function useStyles() {
  const c = useColors();
  return useMemo(() => makeStyles(c), [c]);
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: c.ground },
    body: { padding: spacing.lg, gap: spacing.lg },
    section: { gap: spacing.sm },
    eyebrow: { fontSize: fontSize.xs, ...font('700'), letterSpacing: 1, textTransform: 'uppercase', color: c.ink2 },
    title: { fontSize: fontSize.xl, ...font('800'), color: c.ink },
    hint: { marginTop: -spacing.sm, marginBottom: spacing.md, fontSize: fontSize.xs, color: c.ink2 },
    label: { fontSize: fontSize.sm, ...font('600'), color: c.ink, marginTop: spacing.sm, marginBottom: spacing.xs },
    role: { marginBottom: spacing.sm },
    welcome: { marginBottom: spacing.md, gap: 2 },
    roleHint: { fontSize: fontSize.xs, color: c.ink2, marginLeft: 36 },
    selfNote: { marginBottom: spacing.md },
  });
