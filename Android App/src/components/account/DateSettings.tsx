import React, { useMemo, useState, useSyncExternalStore } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useColors } from '../../core/theme';
import { useDatePreferences } from '../../core/calendar-queries';
import { useSaveDatePreferences } from '../../core/account-queries';
import { Card, SectionTitle, Muted, Button } from '../ui';
import { ChipChoice, InlinePicker } from '../meeting/sheet-kit';
import {
  WEEK_START_OPTIONS,
  calendarZoneNote,
  deviceTimeZone,
  isValidTimeZone,
  supportedTimeZones,
  timeZoneChoices,
  type DatePreferences,
} from '../../lib/date-settings';
import { weekStartOf } from '../../lib/calendar';
import { dateZones, subscribeTimeZone } from '../../lib/due-date';
import { prefsSaveProblem } from '../../lib/notification-prefs';
import { spacing, fontSize, type Palette } from '../../lib/theme';

/**
 * Settings → Calendar & dates (6a), as on the website: the first day of the week and, if wanted,
 * your own time zone for the calendar (otherwise the company's). Saved for you on the server, so it
 * follows you to the website and any phone; the calendar follows at once.
 */
export function DateSettings() {
  const c = useColors();
  const s = useMemo(() => makeStyles(c), [c]);
  const prefsQ = useDatePreferences();
  const save = useSaveDatePreferences();
  const zones = useSyncExternalStore(subscribeTimeZone, dateZones);
  const prefs = prefsQ.data;
  const own = prefs ? (isValidTimeZone(prefs.timeZone) ? prefs.timeZone : null) : zones.own;
  const weekStart = weekStartOf(prefs);
  const choices = useMemo(() => timeZoneChoices({ zones: supportedTimeZones(), company: zones.company, own, device: deviceTimeZone() }), [zones.company, own]);
  const [problem, setProblem] = useState<string | null>(null);
  const loading = !prefs && prefsQ.isLoading;

  const change = (patch: Partial<DatePreferences>) => {
    setProblem(null);
    save.mutate(patch, { onError: (e) => setProblem(prefsSaveProblem(e)) });
  };

  return (
    <View style={s.section}>
      <SectionTitle>Calendar & dates</SectionTitle>
      <Card>
        {prefsQ.isError && !prefs ? <Muted style={s.gap}>Your choices can’t be loaded right now.</Muted> : null}
        <ChipChoice
          label="Week starts on"
          options={WEEK_START_OPTIONS.map((o) => ({ value: String(o.value), label: o.label }))}
          value={String(weekStart)}
          onChange={(v) => {
            const next = Number(v) as 0 | 1 | 6;
            if (next !== weekStart) change({ weekStart: next });
          }}
          disabled={loading}
        />
        <Muted>The first column of the calendar.</Muted>
        <View style={s.divided}>
          <Text style={s.rowTitle}>Time zone for the calendar</Text>
          <Muted style={s.gap}>{calendarZoneNote(own, zones.company)}</Muted>
          <InlinePicker
            label="Time zone"
            options={choices}
            value={own ?? ''}
            onChange={(v) => {
              if (v && v !== own) change({ timeZone: v });
            }}
            placeholder="Company default"
            disabled={loading}
          />
          {own ? <Button title="Use the company time zone" variant="ghost" onPress={() => change({ timeZone: null })} disabled={save.isPending} /> : null}
        </View>
        {problem ? (
          <Text style={s.error} accessibilityRole="alert" accessibilityLiveRegion="assertive">
            {problem}
          </Text>
        ) : null}
      </Card>
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    section: { gap: spacing.sm },
    gap: { marginBottom: spacing.sm },
    rowTitle: { fontSize: fontSize.md, fontWeight: '600', color: c.ink },
    divided: { borderTopWidth: 1, borderTopColor: c.line, paddingTop: spacing.md, marginTop: spacing.md },
    error: { fontSize: fontSize.sm, color: c.danger, fontWeight: '600', marginTop: spacing.sm },
  });
