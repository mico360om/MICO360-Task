import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, Switch, StyleSheet, Platform } from 'react-native';
import { useColors } from '../../core/theme';
import { useServerConfig } from '../../core/queries';
import { useSavePreferences, useSendDailyEmailTest } from '../../core/account-queries';
import { Card, SectionTitle, Muted, Button, TextField } from '../ui';
import { KeyboardGroup } from '../KeyboardAware';
import {
  DAILY_EMAIL_ITEMS,
  dailyEmailChange,
  dailyEmailPrefs,
  dailyEmailTestProblem,
  dailyEmailTestSummary,
  prefsSaveProblem,
  readDailyEmailTime,
  timeFieldKeyboard,
  type DailyEmailPrefs,
  type NotificationPreferences,
} from '../../lib/notification-prefs';
import { spacing, radius, fontSize, type Palette } from '../../lib/theme';

/**
 * Settings → Daily task emails (6a), as on the website: the two morning emails (pending tasks;
 * tasks completed yesterday), each on or off, and the time they go, in your time zone. "Send me a
 * test now" sends them at once. A change saves only that one setting; the server keeps the rest.
 */
export function DailyEmailSettings({ prefs }: { prefs: NotificationPreferences }) {
  const c = useColors();
  const s = useMemo(() => makeStyles(c), [c]);
  const save = useSavePreferences();
  const test = useSendDailyEmailTest();
  const emailEnabled = useServerConfig().data?.emailEnabled !== false;
  const daily = dailyEmailPrefs(prefs);
  const [time, setTime] = useState(daily.time);
  useEffect(() => setTime(daily.time), [daily.time]);
  const [problem, setProblem] = useState<string | null>(null);
  const [timeError, setTimeError] = useState<string | null>(null);
  const [testNote, setTestNote] = useState<{ ok: boolean; text: string } | null>(null);

  const change = (patch: Partial<DailyEmailPrefs>) => {
    setProblem(null);
    save.mutate(dailyEmailChange(patch), { onError: (e) => setProblem(prefsSaveProblem(e)) });
  };

  const saveTime = () => {
    if (time === daily.time) return setTimeError(null);
    const r = readDailyEmailTime(time);
    if (!r.ok) {
      setTimeError(r.error);
      return;
    }
    setTimeError(null);
    setTime(r.value);
    // Leaving the field and tapping "Save time" both come here: one save for one time.
    if (r.value === daily.time || (save.isPending && save.variables?.dailyEmails?.time === r.value)) return;
    change({ time: r.value });
  };

  const sendTest = () => {
    setTestNote(null);
    test.mutate(undefined, {
      onSuccess: (r) => setTestNote({ ok: true, text: dailyEmailTestSummary(r) }),
      onError: (e) => setTestNote({ ok: false, text: dailyEmailTestProblem(e) }),
    });
  };

  return (
    <View style={s.section}>
      <SectionTitle>Daily task emails</SectionTitle>
      <Card>
        <Muted>
          Two emails each morning: the tasks assigned to you that aren’t done yet, and your tasks completed the day before. An email with nothing in it isn’t
          sent.
        </Muted>
        {!emailEnabled ? (
          <View style={s.warning}>
            <Text style={s.warningText}>
              Email isn’t set up on this server yet, so these emails can’t be sent. You can still choose them; they start once an administrator sets up email.
            </Text>
          </View>
        ) : null}
        {problem ? (
          <Text style={s.error} accessibilityRole="alert" accessibilityLiveRegion="assertive">
            {problem}
          </Text>
        ) : null}
        {DAILY_EMAIL_ITEMS.map((item) => (
          <View key={item.key} style={[s.row, s.divided]}>
            <View style={s.rowText}>
              <Text style={s.rowTitle}>{item.label}</Text>
              <Muted>{item.description}</Muted>
            </View>
            <Switch
              value={daily[item.key]}
              onValueChange={(on) => change({ [item.key]: on })}
              accessibilityLabel={item.a11y}
              trackColor={{ true: c.brand, false: c.line }}
              thumbColor={c.surface}
            />
          </View>
        ))}
        {/* The time with its Save stays above the keyboard while typing. */}
        <KeyboardGroup style={s.divided}>
          <TextField
            label="Send them at"
            value={time}
            onChangeText={(v) => {
              setTime(v);
              setTimeError(null);
            }}
            onBlur={saveTime}
            onSubmitEditing={saveTime}
            returnKeyType="done"
            // Android's number keyboard has no colon: digits and a point ("7.30") are read too (6a review).
            placeholder={timeFieldKeyboard(Platform.OS).placeholder}
            keyboardType={timeFieldKeyboard(Platform.OS).keyboardType}
            maxLength={5}
            accessibilityHint="In your time zone, for example 7.30"
            error={timeError}
          />
          <Muted style={s.timeNote}>In your time zone (see Calendar & dates below).</Muted>
          {time !== daily.time ? <Button title="Save time" variant="secondary" onPress={saveTime} loading={save.isPending} style={s.saveTime} /> : null}
        </KeyboardGroup>
        {emailEnabled ? (
          <View style={s.divided}>
            <Button title={test.isPending ? 'Sending…' : 'Send me a test now'} accessibilityLabel="Send me a test now" variant="secondary" onPress={sendTest} loading={test.isPending} />
            {testNote ? (
              <Text
                style={[s.testNote, !testNote.ok && s.testNoteError]}
                accessibilityRole={testNote.ok ? undefined : 'alert'}
                accessibilityLiveRegion={testNote.ok ? 'polite' : 'assertive'}
              >
                {testNote.text}
              </Text>
            ) : null}
          </View>
        ) : null}
      </Card>
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    section: { gap: spacing.sm },
    row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
    rowText: { flex: 1 },
    rowTitle: { fontSize: fontSize.md, fontWeight: '600', color: c.ink },
    divided: { borderTopWidth: 1, borderTopColor: c.line, paddingTop: spacing.md, marginTop: spacing.md },
    warning: { backgroundColor: c.warningSoft, borderRadius: radius.md, padding: spacing.md, marginTop: spacing.md },
    warningText: { color: c.warning, fontSize: fontSize.sm },
    error: { fontSize: fontSize.sm, color: c.danger, fontWeight: '600', marginTop: spacing.sm },
    timeNote: { marginTop: -spacing.sm },
    saveTime: { marginTop: spacing.sm },
    testNote: { fontSize: fontSize.sm, color: c.ink2, marginTop: spacing.sm },
    testNoteError: { color: c.danger },
  });
