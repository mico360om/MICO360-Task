import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useColors } from '../../core/theme';
import { DEFAULT_PROJECT_COLOR, HEX_COLOR, projectStatusLabel, projectStatusTone } from '../../lib/project-identity';
import { PROJECTS_TEXT, TEAM_FACES, moreActionsLabel, nextDueLabel, progressOf, targetLabel, teamLabel, updatedLabel } from '../../lib/projects-page';
import { PROJECT_CARD_FIT, figuresFit } from '../../lib/project-card-fit';
import { radius, spacing, type Palette } from '../../lib/theme';
import { toneStyle } from '../../lib/tone';
import { font, typeStyle } from '../../lib/typography';
import type { ProjectOverview } from '../../lib/types';
import { Avatar, Badge, Card, IconButton, ProgressBar } from '../ui';
import { ProjectAvatar } from '../ProjectAvatar';
import { Icon } from '../Icon';
import { ActionRowButton, Sheet, SheetButtons } from '../meeting/sheet-kit';

/**
 * One figure under the progress bar: the value above its label (TalkBack hears the label first), or —
 * `stacked`, when the three don't fit side by side — the label and the value across the card's width.
 */
function Figure({ label, value, spoken, late, stacked, s }: { label: string; value: string; spoken?: string; late?: boolean; stacked: boolean; s: Styles }) {
  const c = useColors();
  const valueText = (
    <Text style={[s.figureValue, { color: late ? c.dangerText : c.ink }]} numberOfLines={1}>
      {value}
    </Text>
  );
  const labelText = (
    <Text style={[typeStyle('caption'), s.figureLabel, stacked ? s.figureLabelStacked : null, { color: c.ink2 }]} numberOfLines={1}>
      {label}
    </Text>
  );
  return (
    <View style={stacked ? s.figureRow : s.figure} accessible accessibilityLabel={`${label}: ${spoken ?? value}`}>
      {stacked ? labelText : valueText}
      {stacked ? valueText : labelText}
    </View>
  );
}

/**
 * A project on the Projects page, as the website's card: a strip in its colour; its picture, name
 * (opens it), status (a menu for whoever may change it, else a plain badge) and code · number ·
 * client; "⋯" (Edit, Open board, Archive…); progress in its colour and the last update; Open,
 * Overdue and Next due; the team's faces, the owner and the target date.
 */
export const ProjectCard = React.memo(function ProjectCard({
  project: p,
  today,
  timeZone,
  now,
  canChange,
  onOpen,
  onEdit,
  onOpenBoard,
  onStatus,
  onArchive,
}: {
  project: ProjectOverview;
  /** Today's 'YYYY-MM-DD' in the company time zone. */
  today: string;
  timeZone: string;
  now: Date;
  /** Whoever may change it (an administrator, or the server's canManage): the status menu, Edit and Archive. */
  canChange: boolean;
  onOpen: (p: ProjectOverview) => void;
  onEdit: (p: ProjectOverview) => void;
  onOpenBoard: (p: ProjectOverview) => void;
  onStatus: (p: ProjectOverview) => void;
  onArchive: (p: ProjectOverview) => void;
}) {
  const c = useColors();
  const s = useMemo(() => makeStyles(c), [c]);
  const [menu, setMenu] = useState(false);
  // The project's own colour (the website's maroon when it has none).
  const color = p.color && HEX_COLOR.test(p.color) ? p.color : DEFAULT_PROJECT_COLOR;
  const statusLabel = projectStatusLabel(p.status);
  const tone = projectStatusTone(p.status);
  const look = toneStyle(c, tone);
  const progress = progressOf(p.stats);
  const target = targetLabel(p, today, timeZone);
  const next = nextDueLabel(p.stats.nextDue, today);
  // Side by side while every figure fits its third of the card at this width and font size (fix pass B5).
  const { width, fontScale } = useWindowDimensions();
  const stacked = !figuresFit([String(p.stats.open), String(p.stats.overdue), next.short], width, fontScale);
  const meta = [p.code, p.number ? `No. ${p.number}` : null, p.clientName].filter(Boolean).join(' · ');
  const faces = p.team.slice(0, TEAM_FACES);
  const more = Math.max(0, p.teamCount - faces.length);
  const actions = [
    ...(canChange ? [{ value: 'edit', label: PROJECTS_TEXT.edit }] : []),
    { value: 'board', label: PROJECTS_TEXT.openBoard },
    ...(canChange && p.status !== 'ARCHIVED' ? [{ value: 'archive', label: PROJECTS_TEXT.archive }] : []),
  ];
  const act = (v: string) => {
    setMenu(false);
    if (v === 'edit') onEdit(p);
    else if (v === 'board') onOpenBoard(p);
    else onArchive(p);
  };

  return (
    <Card padded={false} style={s.card}>
      {/* A tap anywhere on the card opens the project, as the website's stretched title link; the
          status and ⋯ buttons on it keep their own taps. Not a TalkBack stop: the name is (fix pass B4). */}
      <Pressable onPress={() => onOpen(p)} accessible={false} style={({ pressed }) => (pressed ? { backgroundColor: c.surface2 } : null)}>
        <View style={[s.strip, { backgroundColor: color }]} />
        <View style={s.head}>
          <ProjectAvatar project={p} size="lg" />
          <View style={s.headText}>
            <Pressable onPress={() => onOpen(p)} accessibilityRole="button" accessibilityLabel={p.name} accessibilityHint="Opens the project" style={({ pressed }) => (pressed ? s.pressed : null)}>
              <Text style={s.name} numberOfLines={2}>
                {p.name}
              </Text>
            </Pressable>
            <View style={s.statusRow}>
              {canChange ? (
                <Pressable
                  onPress={() => onStatus(p)}
                  accessibilityRole="button"
                  accessibilityLabel={`Status: ${statusLabel}. Change the status of ${p.name}`}
                  hitSlop={{ top: 10, bottom: 10 }}
                  style={({ pressed }) => [s.status, { backgroundColor: look.bg }, pressed ? s.pressed : null]}
                >
                  <View style={[s.dot, { backgroundColor: look.fg }]} />
                  <Text style={[typeStyle('badge'), { color: look.fg }]}>{statusLabel}</Text>
                  <Icon name="kit.down" size={12} color={look.fg} />
                </Pressable>
              ) : (
                <Badge label={statusLabel} tone={tone} dot />
              )}
              <Text style={[typeStyle('caption'), s.meta, { color: c.ink2 }]}>{meta}</Text>
            </View>
          </View>
          <IconButton icon="misc.dots" label={moreActionsLabel(p.name)} onPress={() => setMenu(true)} />
        </View>

        <View style={s.progress}>
          <View importantForAccessibility="no-hide-descendants">
            <ProgressBar value={progress.pct} color={color} height={8} label={`${p.name}: ${progress.text}`} />
          </View>
          <View style={s.progressRow}>
            <Text style={[typeStyle('caption'), { color: c.ink2 }]}>
              {p.stats.total ? (
                <>
                  <Text style={[s.pct, { color: c.ink }]}>{progress.pct}%</Text>
                  {progress.text.replace(/^\d+%/, '')}
                </>
              ) : (
                progress.text
              )}
            </Text>
            <Text style={[typeStyle('caption'), { color: c.ink2 }]}>{updatedLabel(p.stats.lastActivityAt, now, timeZone)}</Text>
          </View>
        </View>

        <View style={stacked ? s.figuresStacked : s.figures}>
          <Figure label={PROJECTS_TEXT.open} value={String(p.stats.open)} stacked={stacked} s={s} />
          <View style={stacked ? s.dividerStacked : s.divider} />
          <Figure label={PROJECTS_TEXT.overdue} value={String(p.stats.overdue)} late={p.stats.overdue > 0} stacked={stacked} s={s} />
          <View style={stacked ? s.dividerStacked : s.divider} />
          <Figure label={PROJECTS_TEXT.nextDue} value={next.short} spoken={next.long} stacked={stacked} s={s} />
        </View>

        <View style={s.footer}>
          {faces.length ? (
            <View style={s.faces} accessible accessibilityLabel={teamLabel(p)}>
              {faces.map((m, i) => (
                <View key={m.id} style={i ? s.overlap : null}>
                  <Avatar name={m.name} src={m.avatarUrl} size="sm" />
                </View>
              ))}
              {more ? (
                <View style={[s.more, s.overlap, { backgroundColor: c.ground, borderColor: c.surface }]}>
                  <Text style={[s.moreText, { color: c.ink2 }]}>+{more}</Text>
                </View>
              ) : null}
            </View>
          ) : null}
          <Text style={[typeStyle('caption'), s.owner, { color: p.owner ? c.ink2 : c.ink3 }]} numberOfLines={1}>
            {p.owner ? (
              <>
                Owner · <Text style={[s.ownerName, { color: c.ink }]}>{p.owner.name}</Text>
              </>
            ) : (
              PROJECTS_TEXT.noOwner
            )}
          </Text>
          <Text style={[typeStyle('caption'), s.target, target.late ? s.late : null, { color: target.late ? c.dangerText : c.ink2 }]}>{target.text}</Text>
        </View>
      </Pressable>

      <Sheet visible={menu} title={p.name} onClose={() => setMenu(false)} footer={<SheetButtons cancel="Close" onCancel={() => setMenu(false)} />}>
        {actions.map((a) => (
          <ActionRowButton key={a.value} label={a.label} danger={a.value === 'archive'} onPress={() => act(a.value)} />
        ))}
      </Sheet>
    </Card>
  );
});

type Styles = ReturnType<typeof makeStyles>;

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    card: { overflow: 'hidden' },
    strip: { height: 4 },
    pressed: { opacity: 0.7 },
    head: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.md },
    headText: { flex: 1, minWidth: 0 },
    // font-display text-base font-bold.
    name: { fontSize: 16, lineHeight: 22, ...font('700', 'display'), color: c.ink },
    statusRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: spacing.sm, rowGap: 4, marginTop: 6 },
    status: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 24, borderRadius: radius.badge, paddingHorizontal: 8, paddingVertical: 2 },
    dot: { width: 6, height: 6, borderRadius: 3 },
    meta: { flexShrink: 1 },
    progress: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md, gap: 6 },
    progressRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', columnGap: spacing.md, rowGap: 2 },
    pct: { ...font('600') },
    figures: { flexDirection: 'row', borderTopWidth: 1, borderBottomWidth: 1, borderColor: c.line },
    figuresStacked: { borderTopWidth: 1, borderBottomWidth: 1, borderColor: c.line },
    figure: { flex: 1, minWidth: 0, paddingHorizontal: PROJECT_CARD_FIT.figurePadding, paddingVertical: 10 },
    figureRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: 8 },
    // font-display text-lg font-bold tabular-nums.
    figureValue: { fontSize: PROJECT_CARD_FIT.valueSize, lineHeight: 22, ...font('700', 'display'), fontVariant: ['tabular-nums'] },
    figureLabel: { fontSize: PROJECT_CARD_FIT.labelSize },
    figureLabelStacked: { flexShrink: 1 },
    divider: { width: PROJECT_CARD_FIT.divider, backgroundColor: c.line },
    dividerStacked: { height: PROJECT_CARD_FIT.divider, backgroundColor: c.line },
    footer: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: spacing.md, rowGap: 6, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
    faces: { flexDirection: 'row', alignItems: 'center' },
    overlap: { marginLeft: -4 },
    more: { height: 24, minWidth: 24, borderRadius: 12, borderWidth: 1, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center' },
    moreText: { fontSize: 10, ...font('600') },
    owner: { flexShrink: 1 },
    ownerName: { ...font('500') },
    target: { marginLeft: 'auto' },
    late: { ...font('600') },
  });
