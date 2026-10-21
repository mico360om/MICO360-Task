import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useColors } from '../../core/theme';
import { Button } from '../ui';
import { spacing, radius, fontSize, type Palette } from '../../lib/theme';
import { clockTime, joinLink, meetingPlace } from '../../lib/meetings';
import { meetingWhen } from '../../lib/meeting-detail';
import { isUnderWay, peopleText, startsLabel, type ListContext } from '../../lib/meeting-list';
import type { ApiMeeting } from '../../lib/types';

/**
 * The next meeting (or the one under way), on top of the list: when it starts, where, who's coming,
 * with Join for an online one and Open — as on the website.
 */
export function UpNextCard({ meeting: m, ctx, onOpen, onJoin }: { meeting: ApiMeeting; ctx: ListContext; onOpen: () => void; onJoin: (href: string) => void }) {
  const c = useColors();
  const s = useMemo(() => makeStyles(c), [c]);
  const live = isUnderWay(m, ctx.now);
  // Under way: until when (the label already says it is on); otherwise when it starts.
  const when = live ? (m.endAt ? `until ${clockTime(m.endAt, ctx.timeZone)}` : 'Happening now') : startsLabel(m, ctx.now, ctx.timeZone);
  const day = meetingWhen(m, ctx.timeZone);
  const join = m.status === 'CANCELLED' ? null : joinLink(m);
  const place = meetingPlace(m);
  const project = m.projectId ? ctx.projectName(m.projectId) : null;
  const heading = live ? 'Under way' : 'Up next';
  return (
    <View style={[s.card, live && s.live]}>
      <Text style={s.eyebrow} accessibilityRole="header">
        {heading.toUpperCase()} <Text style={s.when}>· {when}</Text>
      </Text>
      <Text style={s.title} numberOfLines={2}>
        {m.title}
      </Text>
      <Text style={s.meta}>
        {day.day} · {day.time}
        {place ? ` · ${place}` : ''}
        {project ? ` · ${project}` : ''}
      </Text>
      <Text style={s.meta}>{peopleText(m)}</Text>
      <View style={s.actions}>
        {join ? <Button title="Join" accessibilityLabel={`Join ${m.title} online`} onPress={() => onJoin(join)} style={s.action} /> : null}
        <Button title="Open" accessibilityLabel={`Open ${m.title}`} variant={join ? 'secondary' : 'primary'} onPress={onOpen} style={s.action} />
      </View>
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    card: { backgroundColor: c.brandWash, borderRadius: radius.lg, borderWidth: 1, borderColor: c.brandWash, padding: spacing.md, gap: 2 },
    live: { borderColor: c.brand },
    eyebrow: { fontSize: fontSize.xs, fontWeight: '800', color: c.brand, letterSpacing: 0.8 },
    when: { color: c.ink, fontWeight: '700', letterSpacing: 0 },
    title: { fontSize: fontSize.lg, fontWeight: '800', color: c.ink, marginTop: 2, textAlign: 'auto' },
    meta: { fontSize: fontSize.xs, color: c.ink2, marginTop: 2 },
    actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
    action: { flex: 1, minHeight: 44 },
  });
