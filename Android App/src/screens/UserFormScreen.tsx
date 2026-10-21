import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, Alert, AccessibilityInfo, AppState, type TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useUserId } from '../core/providers';
import { useColors } from '../core/theme';
import { useAdminUser, useAfterUserChange, useUserActions } from '../core/admin-queries';
import { Button, Card, ErrorNote, Loader, Muted, NoticeNote, SectionTitle, TextField } from '../components/ui';
import { KeyboardAwareScrollView, KeyboardGroup } from '../components/KeyboardAware';
import { CheckRow, ChipChoice } from '../components/meeting/sheet-kit';
import { newIdempotencyKey } from '../lib/idempotency';
import { SIGN_IN_LIMITS } from '../lib/auth';
import { PASSWORD_RULE_HINT, clearsPasswordFields } from '../lib/password-change';
import {
  RESET_DONE,
  ROLE_OPTIONS,
  StatusAfterSaveError,
  USER_STATUSES,
  checkNewUser,
  checkResetPassword,
  checkUserEdit,
  createUserProblem,
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

/** The longest name, username or email the server takes. */
const NAME_MAX = 191;

/**
 * New user, or Manage account (6b, administrators), as the website's dialogs. New user: the name,
 * username, email, a temporary password and the role. Manage account: the details, the status and
 * the roles (your own are read-only, as on the website), and "Reset password" to set a new one.
 * Passwords stay only in their fields: emptied once used, and when you leave the screen or the app.
 */
export function UserFormScreen({ navigation, route }: AppScreenProps<'UserForm'>) {
  const userId = route.params?.userId;
  const { user, query } = useAdminUser(userId);
  if (!userId) return <NewUserForm navigation={navigation} />;
  if (query.isLoading) return <Loader />;
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

/** Passwords are emptied when you leave the screen or the app (the 6a rule). */
function useClearOnLeave(navigation: Nav, clear: () => void) {
  const latest = useRef(clear);
  latest.current = clear;
  useEffect(() => {
    const offBlur = navigation.addListener('blur', () => latest.current());
    const sub = AppState.addEventListener('change', (state) => {
      if (clearsPasswordFields(state)) latest.current();
    });
    return () => {
      offBlur();
      sub.remove();
    };
  }, [navigation]);
}

const EMPTY: NewUserForm = { firstName: '', lastName: '', username: '', email: '', password: '', role: 'EMPLOYEE' };

function NewUserForm({ navigation }: { navigation: Nav }) {
  const s = useStyles();
  const actions = useUserActions();
  const after = useAfterUserChange();
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
  const dirty = (Object.keys(EMPTY) as (keyof NewUserForm)[]).some((k) => k !== 'role' && form[k] !== '');
  useLeaveGuard(navigation, dirty, busy, left, 'the new user');
  useClearOnLeave(navigation, () => setForm((f) => (f.password ? { ...f, password: '' } : f)));

  const set = (patch: Partial<NewUserForm>) => {
    setForm((f) => ({ ...f, ...patch }));
    setProblem(null);
  };
  const fieldError = (f: NewUserField) => (problem?.field === f ? problem.message : null);

  async function submit() {
    if (busy.current) return;
    const bad = checkNewUser(form);
    if (bad) {
      setProblem(bad);
      refs[bad.field].current?.focus();
      return;
    }
    const sent = JSON.stringify(form);
    if (!key.current || key.current.sent !== sent) key.current = { key: newIdempotencyKey(), sent };
    busy.current = true;
    setSaving(true);
    setProblem(null);
    try {
      const created = await actions.create(form, key.current.key);
      left.current = true;
      after(created);
      AccessibilityInfo.announceForAccessibility(`Account created for ${userFullName(created)}.`);
      navigation.goBack();
    } catch (e) {
      const p = createUserProblem(e);
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
          <TextField
            inputRef={refs.password}
            label="Temp password"
            required
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
    eyebrow: { fontSize: fontSize.xs, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', color: c.ink2 },
    title: { fontSize: fontSize.xl, fontWeight: '800', color: c.ink },
    hint: { marginTop: -spacing.sm, marginBottom: spacing.md, fontSize: fontSize.xs, color: c.ink2 },
    label: { fontSize: fontSize.sm, fontWeight: '600', color: c.ink, marginTop: spacing.sm, marginBottom: spacing.xs },
    role: { marginBottom: spacing.sm },
    roleHint: { fontSize: fontSize.xs, color: c.ink2, marginLeft: 36 },
    selfNote: { marginBottom: spacing.md },
  });
