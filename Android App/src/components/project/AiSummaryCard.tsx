import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, AccessibilityInfo } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useServices } from '../../core/providers';
import { useColors } from '../../core/theme';
import { Button } from '../ui';
import { SectionCard } from './parts';
import { aiFailureText } from '../../lib/task-detail';
import { aiSummaryQuery, summaryButton } from '../../lib/ai-summary';
import type { SummaryRequest } from '../../lib/project-dashboard';
import { spacing, radius, fontSize } from '../../lib/theme';

/**
 * "AI status summary" (5b), as on the website: a plain-language read on where the project stands,
 * from its live figures and a few open task titles. It may take the AI a while (a model still
 * loading): the phone waits as long as the server does, and says so plainly when it can't — or
 * shows the server's own words ("AI is not configured yet …"). The answer, and the wait for it,
 * are kept per project (lib/ai-summary — 5b review): switching tabs keeps them, and a double tap
 * asks once. It can be asked once the project's tasks have loaded.
 */
export function AiSummaryCard({ projectId, ready, request }: { projectId: string; ready: boolean; request: () => SummaryRequest }) {
  const c = useColors();
  const { resources } = useServices();
  const requestRef = useRef(request);
  requestRef.current = request;
  const q = useQuery(aiSummaryQuery(projectId, async () => (await resources.ai.summary(requestRef.current())) || 'The AI gave no summary. Please try again.'));
  const busy = q.isFetching;
  const summary = q.data ?? null;
  const error = q.isError && !busy ? aiFailureText(q.error, 'Could not generate a summary right now.') : null;
  const button = summaryButton({ ready, busy, hasSummary: !!summary });

  // Said when a summary asked for here arrives (not when a kept one is shown again).
  const asked = useRef(false);
  useEffect(() => {
    if (asked.current && !busy && summary && q.isSuccess) {
      asked.current = false;
      AccessibilityInfo.announceForAccessibility('The summary is ready.');
    }
  }, [busy, summary, q.isSuccess, q.dataUpdatedAt]);

  function run() {
    if (button.disabled) return;
    asked.current = true;
    // Joins the request already on its way rather than starting another.
    void q.refetch({ cancelRefetch: false });
  }

  return (
    <SectionCard
      title="✨ AI status summary"
      action={
        <Button
          title={button.title}
          accessibilityLabel={button.hint ? `Generate a summary. ${button.hint}` : summary ? 'Regenerate the summary' : 'Generate a summary'}
          variant="secondary"
          onPress={run}
          loading={busy}
          disabled={button.disabled}
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
        <Text style={[styles.summary, { color: c.ink3 }]}>
          {busy ? 'This can take up to two minutes.' : button.hint ?? 'Get a quick, plain-language read on where this project stands.'}
        </Text>
      )}
    </SectionCard>
  );
}

const styles = StyleSheet.create({
  button: { minHeight: 44, paddingHorizontal: spacing.md },
  box: { fontSize: fontSize.sm, fontWeight: '600', borderRadius: radius.md, padding: spacing.md },
  summary: { fontSize: fontSize.md, lineHeight: 22 },
});
