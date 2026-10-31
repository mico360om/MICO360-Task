import React, { useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useProject, useServerConfig } from '../core/queries';
import { useClientShares, useShareMutations } from '../core/client-share-queries';
import { useColors } from '../core/theme';
import { KeyboardAwareScrollView } from '../components/KeyboardAware';
import { Button, Card, ErrorNote, NoticeNote, SectionTitle, TextField } from '../components/ui';
import type { ClientShare } from '../lib/client-share';
import { SHARE_WORDS, checkShare, removeTitle, shareNotice, shareSeen } from '../lib/client-share-words';
import { dateZones, subscribeTimeZone } from '../lib/due-date';
import { newIdempotencyKey } from '../lib/idempotency';
import { keepsKey } from '../lib/pending-keys';
import { problemText } from '../lib/inspection-words';
import { fontSize, radius, spacing, type Palette } from '../lib/theme';
import { font, typeStyle } from '../lib/typography';
import type { AppScreenProps } from '../navigation/types';

/**
 * Share with client (the website's ClientSharePanel): the project's owner, managers and admins give
 * a client (by name and email) a private, read-only page of this project. Each client shows when
 * they last viewed it; Resend replaces their link (the old one stops, its devices are signed out),
 * Remove ends their access at once. An archived project is read-only (Remove still offered). Online
 * only, as on the website; the server checks who may do this.
 */
export function ClientShareScreen({ route }: AppScreenProps<'ClientShare'>) {
  const { projectId } = route.params;
  const c = useColors();
  const s = useMemo(() => makeStyles(c), [c]);
  const projectQ = useProject(projectId);
  const configQ = useServerConfig();
  const sharesQ = useClientShares(projectId);
  const { add, resend, remove } = useShareMutations(projectId);
  const timeZone = useSyncExternalStore(subscribeTimeZone, dateZones, dateZones).company;
  const projectName = projectQ.data?.name ?? route.params.projectName ?? '';
  const archived = projectQ.data?.status === 'ARCHIVED';
  const emailEnabled = configQ.data?.emailEnabled;
  const shares = Array.isArray(sharesQ.data) ? sharesQ.data : [];
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [problem, setProblem] = useState<{ field?: 'name' | 'email'; message: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const key = useRef(newIdempotencyKey());
  const busy = add.isPending || resend.isPending || remove.isPending;

  const say = (next: string | null, wrong: string | null = null) => {
    setNotice(next);
    setProblem(wrong ? { message: wrong } : null);
  };

  function share() {
    if (busy) return;
    const wrong = checkShare(name, email);
    if (wrong) {
      setNotice(null);
      setProblem(wrong);
      return;
    }
    say(null);
    add.mutate(
      { input: { name: name.trim(), email: email.trim() }, key: key.current },
      {
        onSuccess: (made) => {
          key.current = newIdempotencyKey();
          setName('');
          setEmail('');
          say(shareNotice('added', made));
        },
        onError: (e) => {
          // A definite answer (a refusal): the next Share is a new one. No answer, or still being saved: the same key, so they are never invited twice.
          if (!keepsKey(e)) key.current = newIdempotencyKey();
          say(null, problemText(e, SHARE_WORDS.addFailed));
        },
      },
    );
  }

  function resendTo(sh: ClientShare) {
    say(null);
    resend.mutate(sh, { onSuccess: (r) => say(shareNotice('resent', r)), onError: (e) => say(null, problemText(e, SHARE_WORDS.resendFailed)) });
  }

  function confirmRemove(sh: ClientShare) {
    Alert.alert(removeTitle(sh.name), SHARE_WORDS.removeBody, [
      { text: SHARE_WORDS.removeKeep, style: 'cancel' },
      {
        text: SHARE_WORDS.removeConfirm,
        style: 'destructive',
        onPress: () => remove.mutate(sh, { onSuccess: () => say(shareNotice('removed', sh)), onError: (e) => say(null, problemText(e, SHARE_WORDS.removeFailed)) }),
      },
    ]);
  }

  return (
    <SafeAreaView style={s.safe} edges={['bottom']}>
      <KeyboardAwareScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
        {projectName ? <Text style={s.project}>{projectName}</Text> : null}
        <View style={s.intro}>
          <Text style={s.text}>{SHARE_WORDS.intro1}</Text>
          <Text style={s.text}>{SHARE_WORDS.intro2}</Text>
          {[SHARE_WORDS.sees1, SHARE_WORDS.sees2, SHARE_WORDS.sees3].map((line) => (
            <View key={line} style={s.item}>
              <View style={s.dot} />
              <Text style={[s.text, s.itemText]}>{line}</Text>
            </View>
          ))}
          <Text style={s.text}>{SHARE_WORDS.never}</Text>
        </View>

        {archived ? <Text style={s.archived}>{SHARE_WORDS.archived}</Text> : (
          <Card style={s.form}>
            <TextField
              label={SHARE_WORDS.name}
              value={name}
              onChangeText={setName}
              maxLength={120}
              autoComplete="off"
              error={problem?.field === 'name' ? problem.message : null}
              editable={!add.isPending}
            />
            <TextField
              label={SHARE_WORDS.email}
              value={email}
              onChangeText={setEmail}
              maxLength={254}
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              error={problem?.field === 'email' ? problem.message : null}
              editable={!add.isPending}
            />
            {emailEnabled === false ? <Text style={s.emailOff}>{SHARE_WORDS.emailOff}</Text> : null}
            <View style={s.formFoot}>
              <Button title={SHARE_WORDS.share} size="sm" onPress={share} loading={add.isPending} disabled={busy || emailEnabled === false} />
            </View>
          </Card>
        )}

        {problem && !problem.field ? <ErrorNote message={problem.message} /> : null}
        {notice ? <NoticeNote message={notice} /> : null}

        <View>
          <SectionTitle>{SHARE_WORDS.clients}</SectionTitle>
          {/* Before anyone taps Resend: what it does (owner, 30 Oct); each Resend says it too. */}
          {!archived && shares.length > 0 ? <Text style={s.hint}>{SHARE_WORDS.resendExplains}</Text> : null}
          {sharesQ.isLoading ? (
            <Text style={s.text}>{SHARE_WORDS.loading}</Text>
          ) : sharesQ.isError && !sharesQ.data ? (
            <ErrorNote message={SHARE_WORDS.loadFailed} onRetry={() => void sharesQ.refetch()} retrying={sharesQ.isRefetching} />
          ) : shares.length === 0 ? (
            <Text style={s.text}>{SHARE_WORDS.none}</Text>
          ) : (
            <Card padded={false}>
              {shares.map((sh, i) => (
                <View key={sh.id} style={[s.row, i > 0 && s.rowLine]}>
                  <View style={s.rowText}>
                    <Text style={s.name} numberOfLines={1}>
                      {sh.name}
                    </Text>
                    <Text style={s.small} numberOfLines={1}>
                      {sh.email}
                    </Text>
                    <Text style={s.small}>{shareSeen(sh, timeZone)}</Text>
                  </View>
                  <View style={s.rowActions}>
                    {!archived ? (
                      <Button
                        title={SHARE_WORDS.resend}
                        variant="secondary"
                        size="sm"
                        onPress={() => resendTo(sh)}
                        loading={resend.isPending && resend.variables?.id === sh.id}
                        disabled={busy || emailEnabled === false}
                        accessibilityLabel={SHARE_WORDS.resendTo.replace('{name}', sh.name)}
                        accessibilityHint={SHARE_WORDS.resendExplains}
                      />
                    ) : null}
                    <Pressable
                      onPress={() => confirmRemove(sh)}
                      disabled={busy}
                      accessibilityRole="button"
                      accessibilityLabel={SHARE_WORDS.removeWho.replace('{name}', sh.name)}
                      accessibilityState={{ disabled: busy }}
                      style={({ pressed }) => [s.remove, pressed && { backgroundColor: c.dangerSoft }, busy && s.dim]}
                    >
                      <Text style={s.removeText}>{SHARE_WORDS.remove}</Text>
                    </Pressable>
                  </View>
                </View>
              ))}
            </Card>
          )}
        </View>
      </KeyboardAwareScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: c.ground },
    body: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xxl },
    project: { ...typeStyle('subheading'), color: c.ink2 },
    intro: { gap: spacing.sm },
    text: { fontSize: fontSize.sm, lineHeight: 20, color: c.ink2 },
    item: { flexDirection: 'row', gap: spacing.sm, paddingLeft: spacing.sm },
    dot: { width: 4, height: 4, borderRadius: 2, backgroundColor: c.ink3, marginTop: 8 },
    itemText: { flex: 1 },
    archived: { fontSize: fontSize.sm, color: c.ink2, backgroundColor: c.surface, borderRadius: radius.input, borderWidth: 1, borderColor: c.line, padding: spacing.md },
    form: { gap: spacing.xs },
    emailOff: { fontSize: fontSize.sm, color: c.warningText, backgroundColor: c.warningSoft, borderRadius: radius.input, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, marginBottom: spacing.sm },
    formFoot: { flexDirection: 'row', justifyContent: 'flex-end' },
    hint: { ...typeStyle('caption'), color: c.ink2, marginBottom: spacing.sm },
    row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
    rowLine: { borderTopWidth: 1, borderTopColor: c.line },
    rowText: { flexGrow: 1, flexBasis: 180, minWidth: 0 },
    name: { fontSize: fontSize.sm, ...font('600'), color: c.ink },
    small: { ...typeStyle('caption'), color: c.ink2 },
    rowActions: { flexDirection: 'row', gap: spacing.sm },
    remove: { minHeight: 44, justifyContent: 'center', paddingHorizontal: spacing.md, borderRadius: radius.button },
    removeText: { ...typeStyle('button'), color: c.dangerText },
    dim: { opacity: 0.5 },
  });
