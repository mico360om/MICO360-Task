import React, { useMemo, useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { useColors } from '../../core/theme';
import { useTaskClientVisible } from '../../core/client-share-queries';
import { Card, Toggle } from '../ui';
import { problemText } from '../../lib/inspection-words';
import type { ApiTask } from '../../lib/types';
import { fontSize, spacing, type Palette } from '../../lib/theme';
import { font, typeStyle } from '../../lib/typography';

/**
 * "Client view" on a task (the website's ClientViewSwitch): whether the project's client page lists
 * it — its title, status and due date only. For whoever runs the project (the server checks too);
 * the website shows no preview for a task, so the switch changes it at once. Needs a connection.
 */
export function TaskClientCard({ task, canChange }: { task: Pick<ApiTask, 'id' | 'clientVisible'>; canChange: boolean }) {
  const c = useColors();
  const s = useMemo(() => makeStyles(c), [c]);
  const change = useTaskClientVisible(task.id);
  const [problem, setProblem] = useState<string | null>(null);
  if (!canChange) return null;
  const on = !!task.clientVisible;
  return (
    <Card>
      <Text style={s.heading} accessibilityRole="header">
        Client view
      </Text>
      <Toggle
        on={on}
        label="Show to client"
        hint={HINT}
        disabled={change.isPending}
        onChange={(visible) => {
          setProblem(null);
          change.mutate(visible, { onError: (e) => setProblem(problemText(e, 'Couldn’t change it. Please try again.')) });
        }}
      />
      {/* Said with the switch (its hint), so TalkBack doesn't read it twice. */}
      <Text style={s.hint} importantForAccessibility="no">
        {HINT}
      </Text>
      {problem ? (
        <Text style={s.problem} accessibilityRole="alert">
          {problem}
        </Text>
      ) : null}
    </Card>
  );
}

/** The website's hint under the switch (TaskDrawer's ClientViewSwitch), said with it by TalkBack. */
const HINT = 'Show to client: its title, status and due date appear on the project’s client page. Never people, comments, files or the description.';

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    heading: { ...typeStyle('eyebrow'), color: c.ink2, marginBottom: spacing.xs },
    hint: { ...typeStyle('caption'), color: c.ink2, marginTop: spacing.xs },
    problem: { fontSize: fontSize.xs, ...font('500'), color: c.dangerText, marginTop: spacing.xs },
  });
