import React, { memo, useMemo } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useColors } from '../../core/theme';
import { Badge } from '../ui';
import { Icon } from '../Icon';
import { spacing, radius, fontSize, type Palette } from '../../lib/theme';
import { zonedDayKey } from '../../lib/due-date';
import { isRepeating, meetingPlace } from '../../lib/meetings';
import { meetingStatusLabel, meetingStatusTone, meetingWhen, minutesBadge } from '../../lib/meeting-detail';
import { dateLeafParts, isUnderWay, meetingCardLabel, peopleText, type ListContext } from '../../lib/meeting-list';
import type { ApiMeeting } from '../../lib/types';
import { font } from '../../lib/typography';

type LeafTone = 'today' | 'upcoming' | 'muted';

/** The meeting's day as a calendar leaf: weekday, day number, month (filled in on today). */
export function DateLeaf({ iso, timeZone, tone }: { iso: string; timeZone: string; tone: LeafTone }) {
  const c = useColors();
  const s = useMemo(() => makeStyles(c), [c]);
  const part = dateLeafParts(iso, timeZone);
  // Today: the brand fill with white words; upcoming in the brand text tone; past (and cancelled) in ink3.
  const fg = tone === 'today' ? c.onBrand : tone === 'upcoming' ? c.brandText : c.ink3;
  return (
    <View importantForAccessibility="no-hide-descendants" style={[s.leaf, tone === 'today' ? s.leafToday : tone === 'upcoming' ? s.leafUpcoming : s.leafMuted]}>
      <Text style={[s.leafSmall, { color: fg }]}>{part.weekday}</Text>
      <Text style={[s.leafDay, { color: tone === 'today' ? c.onBrand : c.ink }]}>{part.day}</Text>
      <Text style={[s.leafSmall, { color: fg }]}>{part.month}</Text>
    </View>
  );
}

/**
 * A meeting in the Meetings list, as on the website: its day, title, time and place, project and
 * organizer; underneath, who's coming and how far it got — minutes, decisions, open action items.
 * The whole card opens the meeting.
 */
export const MeetingCard = memo(function MeetingCard({
  meeting: m,
  ctx,
  statusShown = true,
  onPress,
}: {
  meeting: ApiMeeting;
  ctx: ListContext;
  /** False where the group already says it (a draft among Drafts). */
  statusShown?: boolean;
  onPress: (m: ApiMeeting) => void;
}) {
  const c = useColors();
  const s = useMemo(() => makeStyles(c), [c]);
  const cancelled = m.status === 'CANCELLED';
  const day = zonedDayKey(new Date(m.startAt), ctx.timeZone);
  const today = zonedDayKey(ctx.now, ctx.timeZone);
  const live = isUnderWay(m, ctx.now);
  const tone: LeafTone = cancelled || m.status === 'COMPLETED' || day < today ? 'muted' : day === today ? 'today' : 'upcoming';
  const when = meetingWhen(m, ctx.timeZone);
  const place = meetingPlace(m);
  const minutes = minutesBadge(m.minutes);
  const open = m.openActionItemCount ?? 0;
  const decisions = m.decisionCount ?? 0;
  const project = m.projectId ? ctx.projectName(m.projectId) ?? 'A project' : null;
  const organizer = ctx.organizerName(m.organizerId);
  return (
    <Pressable
      onPress={() => onPress(m)}
      accessibilityRole="button"
      accessibilityLabel={meetingCardLabel(m, ctx, statusShown)}
      accessibilityHint="Opens the meeting"
      style={({ pressed }) => [s.card, live && s.cardLive, cancelled && s.cardCancelled, pressed && s.pressed]}
    >
      <View style={s.top}>
        <DateLeaf iso={m.startAt} timeZone={ctx.timeZone} tone={tone} />
        <View style={s.body}>
          <Text style={[s.title, cancelled && s.struck]} numberOfLines={2}>
            {m.title}
          </Text>
          <Text style={s.when} numberOfLines={1}>
            {when.time}
            {place ? ` · ${place}` : ''}
          </Text>
          <View style={s.subRow}>
            <Text style={s.sub} numberOfLines={1}>
              {project ?? 'Standalone'}
              {organizer ? ' ·' : ''}
            </Text>
            {organizer ? (
              <>
                <Icon name="kit.user" size={12} color={c.ink3} />
                <Text style={[s.sub, s.flexText]} numberOfLines={1}>
                  {organizer}
                </Text>
              </>
            ) : null}
          </View>
        </View>
      </View>
      <View style={s.foot}>
        <Text style={s.people}>{peopleText(m)}</Text>
        <View style={s.badges}>
          {live ? <Badge label="Under way" tone="brand" /> : m.status !== 'SCHEDULED' && statusShown ? <Badge label={meetingStatusLabel(m.status)} tone={meetingStatusTone(m.status)} /> : null}
          {minutes ? <Badge label={minutes.label} tone={minutes.tone} /> : null}
          {decisions ? <Text style={s.count}>{decisions} {decisions === 1 ? 'decision' : 'decisions'}</Text> : null}
          {open ? <Badge label={`${open} open`} tone="warning" /> : null}
          {isRepeating(m) ? <Icon name="kit.repeat" size={14} color={c.ink2} /> : null}
        </View>
      </View>
    </Pressable>
  );
});

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    card: { backgroundColor: c.surface, borderRadius: radius.card, borderWidth: 1, borderColor: c.line, overflow: 'hidden' },
    cardLive: { borderColor: c.brand },
    cardCancelled: { opacity: 0.8 },
    pressed: { opacity: 0.7 },
    top: { flexDirection: 'row', gap: spacing.md, padding: spacing.md, paddingBottom: spacing.sm },
    body: { flex: 1, minWidth: 0 },
    // A title in Arabic reads right to left on its own line (Android picks the direction from the text).
    title: { fontSize: fontSize.md, ...font('700'), color: c.ink, textAlign: 'auto' },
    struck: { textDecorationLine: 'line-through', color: c.ink3 },
    when: { fontSize: fontSize.xs, color: c.ink2, marginTop: 2 },
    subRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2, minWidth: 0 },
    sub: { fontSize: fontSize.xs, color: c.ink3, flexShrink: 1 },
    flexText: { flex: 1 },
    foot: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.sm,
      borderTopWidth: 1,
      borderTopColor: c.line,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    people: { fontSize: fontSize.xs, color: c.ink2 },
    badges: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.xs, flexShrink: 1, justifyContent: 'flex-end' },
    count: { fontSize: fontSize.xs, color: c.ink2 },
    leaf: { width: 52, alignItems: 'center', borderRadius: radius.input, borderWidth: 1, paddingVertical: spacing.xs },
    leafToday: { backgroundColor: c.brand, borderColor: c.brand },
    leafUpcoming: { backgroundColor: c.brandWash, borderColor: c.brandWash },
    leafMuted: { backgroundColor: c.ground, borderColor: c.line },
    leafSmall: { fontSize: 10, ...font('700'), letterSpacing: 0.5 },
    leafDay: { fontSize: fontSize.lg, ...font('700', 'display'), lineHeight: 22 },
  });
