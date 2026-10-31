import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { font, typeStyle } from '../../lib/typography';
import { useColors } from '../../core/theme';
import { Card, Skeleton } from '../ui';

/**
 * One of the Dashboard's cards, as the website's `card p-5`: an eyebrow heading (read as a header)
 * with an optional brand text link on the right ("View all", "Calendar", "Review all"), then its rows.
 */
export function DashboardSection({ title, link, children }: { title: string; link?: { label: string; onPress: () => void; a11y?: string } | null; children: ReactNode }) {
  const c = useColors();
  return (
    <Card>
      <View style={s.head}>
        <Text style={[typeStyle('eyebrow'), s.title, { color: c.ink2 }]} accessibilityRole="header">
          {title}
        </Text>
        {link ? (
          <Pressable onPress={link.onPress} accessibilityRole="button" accessibilityLabel={link.a11y ?? link.label} hitSlop={8} style={({ pressed }) => [s.link, pressed ? s.pressed : null]}>
            <Text style={[typeStyle('caption'), s.linkText, { color: c.brandText }]}>{link.label}</Text>
          </Pressable>
        ) : null}
      </View>
      {children}
    </Card>
  );
}

/** A list's place while it loads: rows as tall as the real ones, so the cards below don't jump (TalkBack hears `label`). */
export function RowsSkeleton({ label, rows, height = 44 }: { label: string; rows: number; height?: number }) {
  return (
    <View accessible accessibilityLabel={label} accessibilityState={{ busy: true }} style={s.skeleton}>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} height={height} />
      ))}
    </View>
  );
}

/** A quiet one-line note in place of an empty list ("Nothing due — you’re all clear."). */
export function QuietNote({ children }: { children: ReactNode }) {
  const c = useColors();
  return <Text style={[typeStyle('body'), s.quiet, { color: c.ink2 }]}>{children}</Text>;
}

const s = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8, minHeight: 44 },
  title: { flexShrink: 1 },
  link: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 4 },
  linkText: { ...font('600') },
  pressed: { opacity: 0.7 },
  skeleton: { gap: 6 },
  quiet: { textAlign: 'center', paddingVertical: 12 },
});
