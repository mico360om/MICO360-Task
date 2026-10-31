import { Pressable, StyleSheet, Text, View } from 'react-native';
import { DASHBOARD_TEXT, type ActivityLine } from '../../lib/dashboard';
import { font, typeStyle } from '../../lib/typography';
import type { Palette } from '../../lib/theme';
import { useColors } from '../../core/theme';
import { Avatar, ErrorNote } from '../ui';
import { DashboardSection, QuietNote, RowsSkeleton } from './DashboardSection';

/** The verb's colour as text (the website's text-success / -warning / -info / -brand / -ink-2). */
const verbColour = (c: Palette, tone: ActivityLine['tone']): string =>
  ({ success: c.successText, warning: c.warningText, info: c.infoText, brand: c.brandText, ink2: c.ink2 })[tone];

/** "Aisha Khan assigned MICO-3 to Omar Ahmed": what TalkBack says for a row. */
const sentence = (a: ActivityLine): string => [a.who, a.verb, a.taskKey ?? a.projectName, a.assignee ? `to ${a.assignee}` : null, a.ago].filter(Boolean).join(' ');

/**
 * "Recent activity", as the website's: the newest six things done in your projects — who, what (in
 * its colour), the task's key (it opens the task) or the project, and how long ago; "View all" opens
 * the Activity page.
 */
export function RecentActivityCard({
  rows,
  loading,
  failed,
  retrying,
  onRetry,
  onViewAll,
  onOpenTask,
}: {
  rows: readonly ActivityLine[];
  loading: boolean;
  failed: boolean;
  retrying: boolean;
  onRetry: () => void;
  onViewAll: () => void;
  onOpenTask: (taskId: string, key: string) => void;
}) {
  const c = useColors();
  return (
    <DashboardSection title={DASHBOARD_TEXT.recent} link={{ label: DASHBOARD_TEXT.viewAll, onPress: onViewAll, a11y: 'View all activity' }}>
      {failed ? (
        <ErrorNote message="Couldn’t load recent activity." onRetry={onRetry} retrying={retrying} />
      ) : loading ? (
        <RowsSkeleton label="Loading recent activity" rows={6} height={40} />
      ) : rows.length === 0 ? (
        <QuietNote>{DASHBOARD_TEXT.noActivity}</QuietNote>
      ) : (
        <View style={s.list}>
          {rows.map((a) => {
            const body = (
              <>
                <Avatar name={a.who} size="sm" />
                <View style={s.text}>
                  <Text style={[typeStyle('body'), { color: c.ink }]}>
                    <Text style={s.who}>{a.who}</Text> <Text style={{ color: verbColour(c, a.tone) }}>{a.verb}</Text>
                    {a.taskKey ? (
                      <Text style={[s.key, { color: c.brandText }]}> {a.taskKey}</Text>
                    ) : a.projectName ? (
                      <Text style={{ color: c.ink2 }}> {a.projectName}</Text>
                    ) : null}
                    {a.assignee ? (
                      <Text>
                        {' '}to <Text style={s.assignee}>{a.assignee}</Text>
                      </Text>
                    ) : null}
                  </Text>
                  <Text style={[typeStyle('caption'), { color: c.ink2 }]}>{a.ago}</Text>
                </View>
              </>
            );
            const taskId = a.taskId;
            return taskId && a.taskKey ? (
              <Pressable
                key={a.id}
                onPress={() => onOpenTask(taskId, a.taskKey!)}
                accessibilityRole="button"
                accessibilityLabel={sentence(a)}
                accessibilityHint={`Opens ${a.taskKey}`}
                style={({ pressed }) => [s.row, pressed ? s.pressed : null]}
              >
                {body}
              </Pressable>
            ) : (
              <View key={a.id} style={s.row} accessible accessibilityLabel={sentence(a)}>
                {body}
              </View>
            );
          })}
        </View>
      )}
    </DashboardSection>
  );
}

const s = StyleSheet.create({
  list: { gap: 4 },
  row: { flexDirection: 'row', gap: 8, minHeight: 44, paddingVertical: 4 },
  pressed: { opacity: 0.7 },
  text: { flex: 1, minWidth: 0 },
  who: { ...font('600') },
  key: { fontFamily: 'monospace', fontSize: 12 },
  assignee: { ...font('500') },
});
