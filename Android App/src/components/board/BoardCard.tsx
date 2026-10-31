import React, { useMemo } from 'react';
import { View, Text, Pressable, StyleSheet, type AccessibilityActionEvent } from 'react-native';
import { useColors } from '../../core/theme';
import { ProjectAvatar } from '../ProjectAvatar';
import { Icon } from '../Icon';
import { ApprovalChip, Avatar, Badge, PriorityBadge, ProgressBar, InspectionChip } from '../ui';
import { cardView, type BoardCard as Card } from '../../lib/board';
import type { IconName } from '../../lib/icons';
import { spacing, radius, fontSize, type Palette } from '../../lib/theme';
import { font } from '../../lib/typography';

const COUNT_ICON: Record<'checklist' | 'comments' | 'files', IconName> = { checklist: 'misc.check', comments: 'ui.message', files: 'ui.paperclip' };

/**
 * A card on the board (4b), as the website's TaskCard: its column's colour as a stripe; the key,
 * Blocked, milestone, repeat and priority; the title; the due day (Overdue in company time, never
 * for finished work); subtasks, comments and files when there are some; the progress; and up to
 * three faces (photos from this server only) and "+N"; the website's approval chip while it waits. On the All projects board (4c) it names its
 * project first. Tap opens the task; long-press (or TalkBack's actions: Move…, Move up, Move down)
 * places it. It grows with the font size.
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
      {card.project ? (
        <View style={s.project} importantForAccessibility="no-hide-descendants">
          <ProjectAvatar project={card.project} size="xs" />
          <Text style={s.projectName} numberOfLines={1}>
            {card.project.name}
          </Text>
        </View>
      ) : null}
      <View style={s.top} importantForAccessibility="no-hide-descendants">
        <Text style={s.key}>{card.key}</Text>
        <View style={s.flags}>
          {card.blocked ? <Badge label="Blocked" tone="danger" /> : null}
          {card.milestone ? <Icon name="misc.milestone" size={14} color={c.brandText} /> : null}
          {card.clientVisible ? <Icon name="misc.eye" size={13} color={c.infoText} label="Visible to client" /> : null}
          {card.recurring ? <Icon name="kit.repeat" size={14} color={c.ink3} /> : null}
          <PriorityBadge priority={card.priority} />
        </View>
      </View>

      <Text style={s.title} numberOfLines={3} importantForAccessibility="no">
        {card.title}
      </Text>

      {/* The facts row, as the website's: waiting for approval, the inspection mark, the due day, the counts. */}
      {view.waiting || card.inspection || view.hasDue || view.counts.length ? (
        <View style={s.meta} importantForAccessibility="no-hide-descendants">
          {view.waiting ? (
            <View importantForAccessibility="no-hide-descendants">
              <ApprovalChip />
            </View>
          ) : null}
          {card.inspection ? <InspectionChip /> : null}
          {view.dueText ? (
            <View style={[s.metaItem, view.overdue && s.dueLate]}>
              <Icon name="kit.calendar" size={12} color={view.overdue ? c.dangerText : c.ink2} />
              <Text style={[s.due, view.overdue && s.dueLateText]}>{view.dueText}</Text>
            </View>
          ) : null}
          {view.counts.map((b) => (
            <View key={b.kind} style={s.metaItem}>
              <Icon name={COUNT_ICON[b.kind]} size={12} color={c.ink2} />
              <Text style={s.count}>{b.value}</Text>
            </View>
          ))}
        </View>
      ) : null}

      <View style={s.bottom} importantForAccessibility="no-hide-descendants">
        <View style={s.progress}>
          <View style={s.track}>
            <ProgressBar value={card.progress} label="Progress" />
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
                <View key={p.id} style={i > 0 ? s.overlap : null}>
                  <Avatar name={p.name} src={photoOf(p.id)} size="sm" />
                </View>
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

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    card: {
      backgroundColor: c.surface,
      // The website's task card is rounded-xl (14).
      borderRadius: radius.button,
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
    project: { flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 0 },
    projectName: { flexShrink: 1, fontSize: fontSize.xs, ...font('600'), color: c.ink2 },
    top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, flexWrap: 'wrap' },
    key: { fontSize: fontSize.xs, ...font('700'), color: c.ink2, backgroundColor: c.ground, paddingHorizontal: 6, paddingVertical: 2, borderRadius: radius.badge, overflow: 'hidden' },
    flags: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
    title: { fontSize: fontSize.md, ...font('600'), color: c.ink },
    meta: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: spacing.md, rowGap: 4 },
    metaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    due: { fontSize: fontSize.xs, color: c.ink2 },
    dueLate: { backgroundColor: c.dangerSoft, borderRadius: radius.badge, paddingHorizontal: 4 },
    dueLateText: { color: c.dangerText, ...font('700') },
    count: { fontSize: fontSize.xs, color: c.ink2 },
    bottom: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
    progress: { flex: 1, minWidth: 120, flexDirection: 'row', alignItems: 'center', gap: 6 },
    track: { flex: 1 },
    pct: { fontSize: fontSize.xs, color: c.ink3, minWidth: 32, textAlign: 'right' },
    people: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
    single: { fontSize: fontSize.xs, color: c.ink2, maxWidth: 110 },
    faces: { flexDirection: 'row', alignItems: 'center' },
    overlap: { marginLeft: -6 },
    face: { width: 24, height: 24, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
    more: { marginLeft: -6, backgroundColor: c.ground, borderColor: c.line },
    moreText: { fontSize: 10, ...font('700'), color: c.ink2 },
  });
