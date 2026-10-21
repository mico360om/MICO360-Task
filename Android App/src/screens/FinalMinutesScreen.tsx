import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, Alert, Pressable, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFinalMinutes, useMeeting } from '../core/queries';
import { useFinalMinutesMutations } from '../core/meeting-mutations';
import { useColors } from '../core/theme';
import { Button, ErrorNote, Loader, NoticeNote, TextField } from '../components/ui';
import { KeyboardAwareScrollView, KeyboardGroup } from '../components/KeyboardAware';
import { FieldLabel } from '../components/meeting/sheet-kit';
import { draftFailure, draftNotice, isEmptyContent, minutesSaveFailure, toContent, toEditing, type MinutesEditing } from '../lib/meeting-minutes';
import { spacing, fontSize, radius, type Palette } from '../lib/theme';
import type { ApiFinalMinutes } from '../lib/types';
import type { AppScreenProps } from '../navigation/types';

/**
 * The final minutes of a meeting — the "Final MOM" (2b), as on the website: start from a draft,
 * written by the AI from the meeting's agenda, notes and action items (it can take up to three
 * minutes), or put together from the notes; edit it; save it; mark it final. Final minutes are
 * read-only until reopened. Only whoever runs the meeting writes them. Needs a connection.
 */
export function FinalMinutesScreen({ route, navigation }: AppScreenProps<'FinalMinutes'>) {
  const { meetingId, start } = route.params;
  const c = useColors();
  const s = useMemo(() => makeStyles(c), [c]);
  const meetingQ = useMeeting(meetingId);
  const fmQ = useFinalMinutes(meetingId);
  const fm = fmQ.data;
  const m = useFinalMinutesMutations(meetingId);
  const [editing, setEditing] = useState<MinutesEditing | null>(null);
  const [changed, setChanged] = useState(false);
  const [problem, setProblem] = useState<{ text: string; offerNotes?: boolean } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const started = useRef(false);
  const leaving = useRef(false);
  const busy = m.draft.isPending || m.save.isPending || m.approve.isPending || m.reopen.isPending;

  useEffect(() => {
    if (meetingQ.data?.title) navigation.setOptions({ title: `Final MOM · ${meetingQ.data.title}` });
  }, [meetingQ.data?.title, navigation]);

  // A saved draft opens in the editor — unless you are in the middle of changing it.
  useEffect(() => {
    if (!fm || changed) return;
    setEditing(fm.status === 'DRAFT' && fm.content ? toEditing(fm.content) : null);
  }, [fm, changed]);

  const runDraft = (source: 'ai' | 'notes') => {
    setProblem(null);
    setNotice(null);
    m.draft.mutate(source, {
      onSuccess: (res) => {
        setEditing(toEditing(res.content));
        setChanged(true);
        setNotice(draftNotice(res.source));
      },
      onError: (e) => setProblem(draftFailure(e, source)),
    });
  };
  const startDraft = (source: 'ai' | 'notes') => {
    if (editing && !isEmptyContent(toContent(editing))) {
      Alert.alert('Replace what is written?', 'A new draft takes the place of what is in the editor now.', [
        { text: 'Keep it', style: 'cancel' },
        { text: 'Replace', style: 'destructive', onPress: () => runDraft(source) },
      ]);
      return;
    }
    runDraft(source);
  };

  // Opened from "Draft with AI" / "Start from the notes": the draft is made as the screen opens.
  useEffect(() => {
    if (!start || started.current || !fm || !fm.canEdit || fm.status === 'FINAL') return;
    started.current = true;
    // Once, as it opens (runDraft only reads state that is fresh at this point).
    if (fm.status !== 'DRAFT') runDraft(start);
  }, [start, fm]);

  // Leaving with changes not saved asks first.
  useEffect(
    () =>
      navigation.addListener('beforeRemove', (e) => {
        if (!changed || leaving.current) return;
        e.preventDefault();
        Alert.alert('Discard your changes?', 'The minutes in the editor aren’t saved.', [
          { text: 'Keep editing', style: 'cancel' },
          { text: 'Discard', style: 'destructive', onPress: () => navigation.dispatch(e.data.action) },
        ]);
      }),
    [navigation, changed],
  );

  const settled = (next: ApiFinalMinutes, message: string) => {
    setChanged(false);
    setEditing(next.status === 'DRAFT' && next.content ? toEditing(next.content) : null);
    setProblem(null);
    setNotice(message);
  };
  const edit = (patch: Partial<MinutesEditing>) => {
    setEditing((e) => (e ? { ...e, ...patch } : e));
    setChanged(true);
    setNotice(null);
  };
  const saveDraft = () => {
    if (!editing) return;
    m.save.mutate(toContent(editing), { onSuccess: (next) => settled(next, 'Draft saved.'), onError: (e) => setProblem({ text: minutesSaveFailure(e, 'Couldn’t save the minutes.') }) });
  };
  const approve = () => {
    if (!editing) return;
    const content = toContent(editing);
    if (isEmptyContent(content)) {
      setProblem({ text: 'Write the minutes before marking them final.' });
      return;
    }
    m.approve.mutate(content, {
      onSuccess: () => {
        leaving.current = true;
        setChanged(false);
        navigation.goBack();
      },
      onError: (e) => setProblem({ text: minutesSaveFailure(e, 'Couldn’t mark the minutes as final.') }),
    });
  };
  const reopen = () =>
    m.reopen.mutate(undefined, {
      onSuccess: (next) => settled(next, 'Reopened: the minutes can be changed again. Mark them final when they are ready.'),
      onError: (e) => setProblem({ text: minutesSaveFailure(e, 'Couldn’t reopen the minutes.') }),
    });

  if (!fm) {
    if (fmQ.isError) return <ErrorNote message="Couldn’t load the final minutes." onRetry={() => void fmQ.refetch()} retrying={fmQ.isFetching} />;
    return <Loader />;
  }

  const messages = (
    <>
      {problem ? (
        <View style={s.problem} accessibilityRole="alert" accessibilityLiveRegion="assertive">
          <Text style={s.problemText}>{problem.text}</Text>
          {problem.offerNotes ? <Button title="Start from the notes" variant="secondary" onPress={() => runDraft('notes')} disabled={busy} style={s.inlineButton} /> : null}
        </View>
      ) : null}
      {notice ? <NoticeNote message={notice} /> : null}
      {m.draft.isPending ? (
        <View style={s.drafting} accessibilityLiveRegion="polite">
          <ActivityIndicator />
          <Text style={s.hint}>{m.draft.variables === 'ai' ? 'Drafting with the AI… this can take up to three minutes.' : 'Putting the notes together…'}</Text>
        </View>
      ) : null}
    </>
  );

  if (!fm.canEdit) {
    return (
      <View style={s.page}>
        <Text style={s.hint}>Only the organizer, the project manager or an admin can write the final minutes.</Text>
      </View>
    );
  }

  if (fm.status === 'FINAL') {
    return (
      <View style={s.page}>
        {messages}
        <Text style={s.lead}>These minutes are final. Reopen them to make changes.</Text>
        <Button title="Reopen" variant="secondary" onPress={reopen} loading={m.reopen.isPending} />
        <Button title="Back to the meeting" variant="ghost" onPress={() => navigation.goBack()} />
      </View>
    );
  }

  if (!editing) {
    return (
      <View style={s.page}>
        {messages}
        <Text style={s.lead}>
          The minutes you approve and send: a summary, what was discussed under each agenda item, the decisions, risks and next steps. Start from a draft, edit it, then mark it final.
        </Text>
        <Button title="Draft with AI" onPress={() => startDraft('ai')} loading={m.draft.isPending && m.draft.variables === 'ai'} disabled={busy} />
        <Button title="Start from the notes" variant="secondary" onPress={() => startDraft('notes')} loading={m.draft.isPending && m.draft.variables === 'notes'} disabled={busy} />
      </View>
    );
  }

  const setTopic = (i: number, patch: Partial<{ topic: string; text: string }>) => edit({ discussion: editing.discussion.map((d, j) => (j === i ? { ...d, ...patch } : d)) });
  const list = (field: 'decisions' | 'risks' | 'nextSteps', label: string, hint: string) => (
    <TextField label={`${label} — one per line`} value={editing[field]} onChangeText={(v) => edit({ [field]: v })} placeholder={hint} multiline style={s.multiline} />
  );

  return (
    <SafeAreaView style={s.safe} edges={['bottom']}>
      <KeyboardAwareScrollView contentContainerStyle={s.body}>
        {messages}
        <TextField label="Summary" value={editing.summary} onChangeText={(summary) => edit({ summary })} placeholder="What the meeting was for and what came of it." multiline style={s.multiline} />

        <FieldLabel>Discussion</FieldLabel>
        {editing.discussion.length === 0 ? <Text style={s.hint}>No topics yet.</Text> : null}
        {editing.discussion.map((d, i) => (
          <KeyboardGroup key={i} style={s.topic}>
            <View style={s.topicHead}>
              <View style={s.grow}>
                <TextField accessibilityLabel={`Topic ${i + 1}`} value={d.topic} onChangeText={(topic) => setTopic(i, { topic })} placeholder="Agenda item or topic" />
              </View>
              <Pressable
                onPress={() => edit({ discussion: editing.discussion.filter((_, j) => j !== i) })}
                accessibilityRole="button"
                accessibilityLabel={`Remove topic ${i + 1}`}
                hitSlop={6}
                style={s.remove}
              >
                <Text style={s.removeText}>✕</Text>
              </Pressable>
            </View>
            <TextField accessibilityLabel={`What was discussed under topic ${i + 1}`} value={d.text} onChangeText={(text) => setTopic(i, { text })} multiline style={s.multiline} />
          </KeyboardGroup>
        ))}
        <Pressable onPress={() => edit({ discussion: [...editing.discussion, { topic: '', text: '' }] })} accessibilityRole="button" style={s.link}>
          <Text style={s.linkText}>＋ Add a topic</Text>
        </Pressable>

        {list('decisions', 'Decisions', 'e.g. Go-live moves to 1 November.')}
        {list('risks', 'Risks & open issues', 'e.g. Field tablets may not be updated in time.')}
        {list('nextSteps', 'Next steps', 'e.g. Send the revised form — Bilal, by 18 Oct')}

        <View style={s.redraft}>
          <Pressable onPress={() => startDraft('ai')} disabled={busy} accessibilityRole="button" style={s.link}>
            <Text style={s.linkText}>{m.draft.isPending && m.draft.variables === 'ai' ? 'Drafting…' : 'Redraft with AI'}</Text>
          </Pressable>
          <Pressable onPress={() => startDraft('notes')} disabled={busy} accessibilityRole="button" style={s.link}>
            <Text style={s.linkText}>{m.draft.isPending && m.draft.variables === 'notes' ? 'Drafting…' : 'Start again from the notes'}</Text>
          </Pressable>
        </View>
      </KeyboardAwareScrollView>
      <View style={s.footer}>
        <Text style={s.state} accessibilityLiveRegion="polite">
          {changed ? 'Not saved yet.' : fm.savedAt ? 'Saved.' : ''}
        </Text>
        <View style={s.buttons}>
          <Button title="Save draft" variant="secondary" onPress={saveDraft} loading={m.save.isPending} disabled={busy} style={s.grow} />
          <Button title="Mark as final" onPress={approve} loading={m.approve.isPending} disabled={busy} style={s.grow} />
        </View>
      </View>
    </SafeAreaView>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: c.ground },
    page: { flex: 1, backgroundColor: c.ground, padding: spacing.lg, gap: spacing.md },
    body: { padding: spacing.lg, gap: spacing.xs, paddingBottom: spacing.xxl },
    lead: { fontSize: fontSize.md, color: c.ink, lineHeight: 22 },
    hint: { fontSize: fontSize.sm, color: c.ink2, flexShrink: 1 },
    grow: { flex: 1 },
    multiline: { minHeight: 76, paddingTop: spacing.sm, textAlignVertical: 'top' },
    topic: { borderWidth: 1, borderColor: c.line, borderRadius: radius.lg, padding: spacing.sm, marginBottom: spacing.sm, backgroundColor: c.surface },
    topicHead: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xs },
    remove: { minWidth: 44, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
    removeText: { fontSize: fontSize.lg, color: c.ink3 },
    link: { minHeight: 44, justifyContent: 'center' },
    linkText: { fontSize: fontSize.sm, fontWeight: '700', color: c.brand },
    redraft: { flexDirection: 'row', flexWrap: 'wrap', columnGap: spacing.lg },
    problem: { backgroundColor: c.dangerSoft, borderRadius: radius.md, padding: spacing.md, gap: spacing.sm, marginBottom: spacing.sm },
    problemText: { color: c.danger, fontSize: fontSize.sm, fontWeight: '600' },
    inlineButton: { alignSelf: 'flex-start', minHeight: 40 },
    drafting: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
    footer: { padding: spacing.md, gap: spacing.xs, borderTopWidth: 1, borderTopColor: c.line, backgroundColor: c.surface },
    buttons: { flexDirection: 'row', gap: spacing.sm },
    state: { fontSize: fontSize.xs, color: c.ink3 },
  });
