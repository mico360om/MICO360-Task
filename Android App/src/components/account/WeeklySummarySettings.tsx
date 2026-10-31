import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useColors } from '../../core/theme';
import { useNotificationPreferences, useServerConfig } from '../../core/queries';
import { useSavePreferences } from '../../core/account-queries';
import { useManagementAccess } from '../../core/management-queries';
import { Card, SectionTitle, Muted, Toggle } from '../ui';
import { WEEKLY_SUMMARY_TEXT, prefsSaveProblem, weeklySummaryOn } from '../../lib/notification-prefs';
import { spacing, radius, fontSize, type Palette } from '../../lib/theme';
import { font } from '../../lib/typography';

/**
 * Settings → Weekly management summary, as on the website (WeeklySummarySettings.tsx): for the
 * people who can see the Management page (the server says, GET /management/access), the short
 * summary of their projects sent on the first working morning of each week — on unless turned off.
 * While the company has it off (System Settings) the switch shows off and can't be changed.
 */
export function WeeklySummarySettings() {
  const c = useColors();
  const s = useMemo(() => makeStyles(c), [c]);
  const { allowed } = useManagementAccess();
  const prefsQ = useNotificationPreferences();
  const config = useServerConfig().data;
  const save = useSavePreferences();
  const [problem, setProblem] = useState<string | null>(null);
  // The company-wide switch: while it is off nothing is sent, whatever is chosen here.
  const companyOff = config?.weeklySummaryEnabled === false;
  const prefs = prefsQ.data;
  const on = weeklySummaryOn(prefs);
  if (!allowed) return null;

  const change = (next: boolean) => {
    setProblem(null);
    // Only this setting is sent: the server keeps the switches and the daily emails as they are.
    save.mutate({ weeklySummary: next }, { onError: (e) => setProblem(prefsSaveProblem(e)) });
  };

  return (
    <View style={s.section}>
      <SectionTitle>{WEEKLY_SUMMARY_TEXT.heading}</SectionTitle>
      <Card>
        <Muted>{WEEKLY_SUMMARY_TEXT.body}</Muted>
        {problem ? (
          <Text style={s.error} accessibilityRole="alert" accessibilityLiveRegion="assertive">
            {problem}
          </Text>
        ) : null}
        {companyOff ? (
          <View style={s.warning}>
            <Text style={s.warningText}>{WEEKLY_SUMMARY_TEXT.off}</Text>
          </View>
        ) : null}
        <View style={s.divided}>
          <Toggle
            label={WEEKLY_SUMMARY_TEXT.row}
            a11yLabel={WEEKLY_SUMMARY_TEXT.label}
            hint={companyOff ? WEEKLY_SUMMARY_TEXT.off : WEEKLY_SUMMARY_TEXT.rowHint}
            on={on && !companyOff}
            disabled={!prefs || companyOff}
            onChange={() => change(!on)}
          />
          <Muted>{WEEKLY_SUMMARY_TEXT.rowHint}</Muted>
        </View>
      </Card>
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    section: { gap: spacing.sm },
    divided: { borderTopWidth: 1, borderTopColor: c.line, paddingTop: spacing.md, marginTop: spacing.md },
    warning: { backgroundColor: c.warningSoft, borderRadius: radius.input, padding: spacing.md, marginTop: spacing.md },
    warningText: { color: c.warningText, fontSize: fontSize.sm },
    error: { fontSize: fontSize.sm, color: c.dangerText, ...font('600'), marginTop: spacing.sm },
  });
