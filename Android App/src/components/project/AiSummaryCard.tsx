import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, AccessibilityInfo } from 'react-native';
import { useServices } from '../../core/providers';
import { useColors } from '../../core/theme';
import { Button } from '../ui';
import { SectionCard } from './parts';
import { aiFailureText } from '../../lib/task-detail';
import type { SummaryRequest } from '../../lib/project-dashboard';
import { spacing, radius, fontSize } from '../../lib/theme';

/**
 * "AI status summary" (5b), as on the website: a plain-language read on where the project stands,
 * from its live figures and a few open task titles. It may take the AI a while (a model still
 * loading): the phone waits as long as the server does, and says so plainly when it can't — or
 * shows the server's own words ("AI is not configured yet …").
 */
export function AiSummaryCard({ request }: { request: () => SummaryRequest }) {
  const c = useColors();
  const { resources } = useServices();
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );

  async function run() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const text = await resources.ai.summary(request());
      if (!mounted.current) return;
      setSummary(text || 'The AI gave no summary. Please try again.');
      AccessibilityInfo.announceForAccessibility('The summary is ready.');
    } catch (e) {
      if (mounted.current) setError(aiFailureText(e, 'Could not generate a summary right now.'));
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  return (
    <SectionCard
      title="✨ AI status summary"
      action={
        <Button
          title={busy ? 'Thinking…' : summary ? 'Regenerate' : 'Generate summary'}
          accessibilityLabel={summary ? 'Regenerate the summary' : 'Generate a summary'}
          variant="secondary"
          onPress={() => void run()}
          loading={busy}
          style={styles.button}
        />
      }
    >
      {error ? (
        <Text style={[styles.box, { color: c.danger, backgroundColor: c.dangerSoft }]} accessibilityRole="alert" accessibilityLiveRegion="assertive">
          {error}
        </Text>
      ) : summary ? (
        <View accessible accessibilityLabel={`Summary: ${summary}`}>
          <Text style={[styles.summary, { color: c.ink2 }]} selectable>
            {summary}
          </Text>
        </View>
      ) : (
        <Text style={[styles.summary, { color: c.ink3 }]}>{busy ? 'This can take up to two minutes.' : 'Get a quick, plain-language read on where this project stands.'}</Text>
      )}
    </SectionCard>
  );
}

const styles = StyleSheet.create({
  button: { minHeight: 44, paddingHorizontal: spacing.md },
  box: { fontSize: fontSize.sm, fontWeight: '600', borderRadius: radius.md, padding: spacing.md },
  summary: { fontSize: fontSize.md, lineHeight: 22 },
});
