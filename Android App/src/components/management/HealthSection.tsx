import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useColors } from '../../core/theme';
import { Chip, EmptyState, ProgressBar } from '../ui';
import { ProjectAvatar } from '../ProjectAvatar';
import { applyNavAction } from '../../navigation/apply-action';
import { HEALTH_SORTS, STATUS_LABEL, idleText, itemTarget, milestoneText, plural, reasonQuery, sortHealth, type HealthSort } from '../../lib/management';
import type { HealthRow } from '../../lib/management-api';
import { radius, spacing, type Palette } from '../../lib/theme';
import { typeStyle } from '../../lib/typography';
import { ListButton, NumberButton, RagMark, Section, Term, type OpenList } from './parts';

/** Open a screen a row names (the ids checked: lib/management itemTarget). */
const go = (row: Parameters<typeof itemTarget>[0]) => {
  const target = itemTarget(row);
  if (target && target !== 'expand') applyNavAction(target);
};

/** A reason's words in its level's TEXT tone. */
const levelColor = (c: Palette, level: HealthRow['rag']) => (level === 'RED' ? c.dangerText : level === 'AMBER' ? c.warningText : c.ink2);

function Milestone({ row, onOpen, s, c }: { row: HealthRow; onOpen: OpenList; s: ReturnType<typeof makeStyles>; c: Palette }) {
  const m = row.nextMilestone;
  if (!m) return <Text style={s.none}>—</Text>;
  // Waiting for approval: never late while it waits (owner, 30 Oct) — milestoneText says it waits.
  const late = !m.waiting && m.daysLeft !== null && m.daysLeft < 0;
  return (
    <View>
      <Pressable onPress={() => go({ kind: 'task', id: m.id, title: m.title })} accessibilityRole="button" accessibilityHint="Opens the milestone" style={({ pressed }) => [s.link, pressed && s.pressed]}>
        <Text style={s.milestone} numberOfLines={2}>
          {m.title}
        </Text>
      </Pressable>
      {late ? (
        <ListButton label={`Late milestones in ${row.name}`} query={{ metric: 'late-milestones', projectId: row.id }} onOpen={onOpen} color={c.dangerText}>
          {milestoneText(m)}
        </ListButton>
      ) : (
        <Text style={s.small}>{milestoneText(m)}</Text>
      )}
    </View>
  );
}

/**
 * Project health (the website's HealthSection.tsx, its phone cards): every project's mark with its
 * reasons, % done, late tasks, missing checks, the next milestone and the last activity — worst
 * first, or in the order chosen. Every count opens the list behind it; the figures are the server's.
 */
export function HealthSection({
  rows,
  today,
  timeZone,
  onOpen,
  chosenHidden,
  noneAtAll,
  onGoToProjects,
}: {
  rows: HealthRow[];
  today: string;
  timeZone: string;
  onOpen: OpenList;
  /** Projects were chosen, but the status filter leaves them out. */
  chosenHidden?: boolean;
  /** The company has no project at all (not just none matching the filters). */
  noneAtAll?: boolean;
  onGoToProjects: () => void;
}) {
  const c = useColors();
  const s = useMemo(() => makeStyles(c), [c]);
  const [sort, setSort] = useState<HealthSort>('worst');
  const shown = useMemo(() => sortHealth(rows, sort), [rows, sort]);
  // The Done bar's fill is the success colour, as on the website (a fill, not text).
  const doneFill = c.success;

  return (
    <Section
      title="Project health"
      note="Red: a milestone is late, a quarter or more of the open tasks are late (at least 3), or 3 or more checks are missing. Amber: any late task or missing check, or an active project with no change for 14 days."
      action={
        rows.length > 1 ? (
          <View style={s.sorts} accessibilityLabel="Sort">
            {HEALTH_SORTS.map((o) => (
              <Chip key={o.value} label={o.label} selected={sort === o.value} onPress={() => setSort(o.value)} />
            ))}
          </View>
        ) : null
      }
    >
      {rows.length === 0 && noneAtAll ? (
        <EmptyState icon="nav.projects" title="No projects yet" subtitle="Each project’s health shows here once there is one: its late tasks, milestones and checks." action={{ title: 'Go to Projects', onPress: onGoToProjects }} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon="nav.projects"
          title="No projects to show"
          subtitle={
            chosenHidden
              ? 'The projects you chose have a status the filter leaves out. Tick their status, or clear the filters.'
              : 'No project matches these filters. Choose other statuses or projects, or clear the filters.'
          }
        />
      ) : (
        shown.map((row) => (
          <View key={row.id} style={s.card}>
            <View style={s.top}>
              <Pressable onPress={() => go({ kind: 'project', id: row.id, title: row.name })} accessibilityRole="button" accessibilityHint="Opens the project" style={({ pressed }) => [s.name, pressed && s.pressed]}>
                <ProjectAvatar project={row} size="sm" />
                <View style={s.flex}>
                  <Text style={s.projectName} numberOfLines={2}>
                    {row.name}
                  </Text>
                  <Text style={s.code} numberOfLines={1}>
                    {[row.code, STATUS_LABEL[row.status], row.owner?.name].filter(Boolean).join(' · ')}
                  </Text>
                </View>
              </Pressable>
              <RagMark rag={row.rag} />
            </View>

            <View style={s.reasons}>
              {row.reasons.map((reason) => {
                const query = reasonQuery(reason.code, row.id);
                const color = levelColor(c, reason.level);
                return query ? (
                  <ListButton key={reason.code + reason.text} label={reason.text} query={query} onOpen={onOpen} color={color}>
                    {reason.text}
                  </ListButton>
                ) : (
                  <Text key={reason.code + reason.text} style={[s.small, { color }]}>
                    {reason.text}
                  </Text>
                );
              })}
            </View>

            <View style={s.grid}>
              <View style={s.cell}>
                <Term>Done</Term>
                <View style={s.done}>
                  <Text style={s.pct}>{row.completionPct}%</Text>
                  <View style={s.flex}>
                    <ProgressBar value={row.completionPct} color={doneFill} label={`${row.name}: ${row.completionPct}% done`} />
                  </View>
                </View>
              </View>
              <View style={s.cell}>
                <Term>Last activity</Term>
                <Text style={s.value}>{idleText(row.lastActivityAt, today, timeZone)}</Text>
              </View>
              <View style={s.cell}>
                <Term>Late tasks</Term>
                <NumberButton value={String(row.late)} label={`${plural(row.late, 'late task')} in ${row.name}`} query={row.late ? { metric: 'late-tasks', projectId: row.id } : null} onOpen={onOpen} tone="danger" />
              </View>
              <View style={s.cell}>
                <Term>Missing checks</Term>
                <NumberButton value={String(row.missingChecks)} label={`${plural(row.missingChecks, 'missing check')} in ${row.name}`} query={row.missingChecks ? { metric: 'missing-checks', projectId: row.id } : null} onOpen={onOpen} tone="danger" />
              </View>
              <View style={s.wide}>
                <Term>Next milestone</Term>
                <Milestone row={row} onOpen={onOpen} s={s} c={c} />
              </View>
            </View>
          </View>
        ))
      )}
    </Section>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    flex: { flex: 1, minWidth: 0 },
    pressed: { opacity: 0.7 },
    sorts: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    card: { borderWidth: 1, borderColor: c.line, borderRadius: radius.button, padding: spacing.md, gap: spacing.sm },
    top: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
    name: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 44 },
    projectName: { ...typeStyle('bodyStrong'), color: c.ink, textAlign: 'auto' },
    code: { ...typeStyle('caption'), color: c.ink3 },
    reasons: { gap: 0 },
    small: { ...typeStyle('caption'), color: c.ink2 },
    grid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: spacing.sm },
    cell: { width: '50%', paddingEnd: spacing.sm },
    wide: { width: '100%' },
    done: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 44 },
    pct: { ...typeStyle('number'), color: c.ink },
    value: { ...typeStyle('body'), color: c.ink2, minHeight: 44, textAlignVertical: 'center' },
    link: { minHeight: 44, justifyContent: 'center' },
    milestone: { ...typeStyle('label'), color: c.ink },
    none: { ...typeStyle('body'), color: c.ink3 },
  });
