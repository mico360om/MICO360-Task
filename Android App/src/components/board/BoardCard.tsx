import React, { useMemo, useState } from 'react';
import { View, Text, Pressable, Image, StyleSheet, type AccessibilityActionEvent } from 'react-native';
import { useColors } from '../../core/theme';
import { priorityColor } from '../TaskRow';
import { cardView, personInitials, type BoardCard as Card } from '../../lib/board';
import { spacing, radius, fontSize, type Palette } from '../../lib/theme';

const PRIORITY_WORD = { LOW: 'Low', NORMAL: 'Normal', HIGH: 'High', URGENT: 'Urgent' } as const;

/**
 * A card on the board (4b), as the website's TaskCard: its column's colour as a stripe; the key,
 * Blocked, milestone, repeat and priority; the title; the due day (Overdue in company time, never
 * for finished work); subtasks, comments and files when there are some; the progress; and up to
 * three faces (photos from this server only) and "+N". Tap opens the task; long-press (or TalkBack's
 * actions: Move…, Move up, Move down) places it. It grows with the font size.
 */
export const BoardCard = React.memo(function BoardCard({
  card,
  timeZone,
  photoOf,
  onOpen,
  onActions,
  onStep,
  canStepUp,
  canStepDown,
}: {
  card: Card;
  timeZone: string;
  /** A person's photo address (only one stored on this server), or null. */
  photoOf: (userId: string) => string | null;
  onOpen: (card: Card) => void;
  onActions: (card: Card) => void;
  onStep: (card: Card, step: -1 | 1) => void;
  canStepUp: boolean;
  canStepDown: boolean;
}) {
  const c = useColors();
  const s = useMemo(() => makeStyles(c), [c]);
  const view = cardView(card, { timeZone });
  const actions = [
    { name: 'activate', label: 'Open the task' },
    { name: 'longpress', label: 'Move…' },
    ...(canStepUp ? [{ name: 'moveUp', label: 'Move up' }] : []),
    ...(canStepDown ? [{ name: 'moveDown', label: 'Move down' }] : []),
  ];
  const onAction = (e: AccessibilityActionEvent) => {
    const name = e.nativeEvent.actionName;
    if (name === 'activate') onOpen(card);
    else if (name === 'longpress') onActions(card);
    else if (name === 'moveUp') onStep(card, -1);
    else if (name === 'moveDown') onStep(card, 1);
  };
  return (
    <Pressable
      onPress={() => onOpen(card)}
      onLongPress={() => onActions(card)}
      delayLongPress={350}
      accessibilityRole="button"
      accessibilityLabel={view.label}
      accessibilityHint="Opens the task. Long-press to move it."
      accessibilityActions={actions}
      onAccessibilityAction={onAction}
      style={({ pressed }) => [s.card, view.overdue ? s.overdueRing : card.blocked ? s.blockedRing : null, pressed && s.pressed]}
    >
      <View style={[s.stripe, { backgroundColor: card.accentColor }]} />
      <View style={s.top} importantForAccessibility="no-hide-descendants">
        <Text style={s.key}>{card.key}</Text>
        <View style={s.flags}>
          {card.blocked ? (
            <View style={s.blocked}>
              <Text style={s.blockedText}>⊘ BLOCKED</Text>
            </View>
          ) : null}
          {card.milestone ? <Text style={s.flag}>🏁</Text> : null}
          {card.recurring ? <Text style={s.flagMuted}>🔁</Text> : null}
          <View style={[s.priority, { borderColor: priorityColor(c, card.priority) }]}>
            <Text style={[s.priorityText, { color: priorityColor(c, card.priority) }]}>{PRIORITY_WORD[card.priority] ?? card.priority}</Text>
          </View>
        </View>
      </View>

      <Text style={s.title} numberOfLines={3} importantForAccessibility="no">
        {card.title}
      </Text>

      {view.hasDue || view.counts.length ? (
        <View style={s.meta} importantForAccessibility="no-hide-descendants">
          {view.dueText ? (
            <Text style={[s.due, view.overdue && s.dueLate]}>📅 {view.dueText}</Text>
          ) : null}
          {view.counts.map((b) => (
            <Text key={b.kind} style={s.count}>
              {b.kind === 'checklist' ? '☑' : b.kind === 'comments' ? '💬' : '📎'} {b.value}
            </Text>
          ))}
        </View>
      ) : null}

      <View style={s.bottom} importantForAccessibility="no-hide-descendants">
        <View style={s.progress}>
          <View style={s.track}>
            <View style={[s.fill, { width: `${Math.max(0, Math.min(100, card.progress))}%` }]} />
          </View>
          <Text style={s.pct}>{card.progress}%</Text>
        </View>
        {card.assignees.length ? (
          <View style={s.people}>
            {view.singleName ? (
              <Text style={s.single} numberOfLines={1}>
                {view.singleName}
              </Text>
            ) : null}
            <View style={s.faces}>
              {view.shown.map((p, i) => (
                <Face key={p.id} name={p.name} photo={photoOf(p.id)} s={s} first={i === 0} />
              ))}
              {view.extra > 0 ? (
                <View style={[s.face, s.more]}>
                  <Text style={s.moreText}>+{view.extra}</Text>
                </View>
              ) : null}
            </View>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
});

function Face({ name, photo, s, first }: { name: string; photo: string | null; s: Styles; first: boolean }) {
  const [broken, setBroken] = useState(false);
  return (
    <View style={[s.face, !first && s.overlap]}>
      {photo && !broken ? (
        <Image source={{ uri: photo }} style={s.photo} onError={() => setBroken(true)} accessibilityIgnoresInvertColors />
      ) : (
        <Text style={s.initials} allowFontScaling={false}>
          {personInitials(name)}
        </Text>
      )}
    </View>
  );
}

type Styles = ReturnType<typeof makeStyles>;

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    card: {
      backgroundColor: c.surface,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: c.line,
      padding: spacing.md,
      paddingLeft: spacing.md + 4,
      gap: spacing.sm,
      overflow: 'hidden',
    },
    overdueRing: { borderColor: c.danger },
    blockedRing: { borderColor: c.warning },
    pressed: { opacity: 0.75 },
    stripe: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 4 },
    top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, flexWrap: 'wrap' },
    key: { fontSize: fontSize.xs, fontWeight: '700', color: c.ink2, backgroundColor: c.ground, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, overflow: 'hidden' },
    flags: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
    blocked: { backgroundColor: c.dangerSoft, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
    blockedText: { fontSize: fontSize.xs, fontWeight: '800', color: c.danger },
    flag: { fontSize: fontSize.sm, color: c.brand },
    flagMuted: { fontSize: fontSize.sm, color: c.ink3 },
    priority: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 1 },
    priorityText: { fontSize: fontSize.xs, fontWeight: '700' },
    title: { fontSize: fontSize.md, fontWeight: '600', color: c.ink },
    meta: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: spacing.md, rowGap: 4 },
    due: { fontSize: fontSize.xs, color: c.ink2 },
    dueLate: { color: c.danger, fontWeight: '700', backgroundColor: c.dangerSoft, borderRadius: 4, paddingHorizontal: 4, overflow: 'hidden' },
    count: { fontSize: fontSize.xs, color: c.ink2 },
    bottom: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
    progress: { flex: 1, minWidth: 120, flexDirection: 'row', alignItems: 'center', gap: 6 },
    track: { flex: 1, height: 6, borderRadius: radius.pill, backgroundColor: c.ground, overflow: 'hidden' },
    fill: { height: 6, borderRadius: radius.pill, backgroundColor: c.brand },
    pct: { fontSize: fontSize.xs, color: c.ink3, minWidth: 32, textAlign: 'right' },
    people: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
    single: { fontSize: fontSize.xs, color: c.ink2, maxWidth: 110 },
    faces: { flexDirection: 'row', alignItems: 'center' },
    face: { width: 26, height: 26, borderRadius: 13, backgroundColor: c.brandWash, borderWidth: 1.5, borderColor: c.surface, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
    overlap: { marginLeft: -7 },
    photo: { width: '100%', height: '100%' },
    initials: { fontSize: 10, fontWeight: '700', color: c.brand },
    more: { marginLeft: -7, backgroundColor: c.ground, borderColor: c.line },
    moreText: { fontSize: 10, fontWeight: '700', color: c.ink2 },
  });
