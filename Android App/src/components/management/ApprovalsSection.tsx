import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useColors } from '../../core/theme';
import { EmptyState } from '../ui';
import { plural } from '../../lib/management';
import type { ManagementOverview } from '../../lib/management-api';
import { spacing, type Palette } from '../../lib/theme';
import { typeStyle } from '../../lib/typography';
import { NumberButton, Section, type OpenList } from './parts';
import { capLines } from '../ui/text-lines';

/**
 * Tasks waiting for approval (the website's ApprovalsSection.tsx): how many in all, and in each
 * project shown (most first). Every number opens the list of those tasks; each opens its task, whose
 * screen has Approve and Send back.
 */
export function ApprovalsSection({ approvals, onOpen }: { approvals: NonNullable<ManagementOverview['approvals']>; onOpen: OpenList }) {
  const c = useColors();
  const s = useMemo(() => makeStyles(c), [c]);
  const total = approvals.total;
  return (
    <Section
      title="Waiting for approval"
      note="Tasks finished but not approved yet by whoever runs the project. They don’t count as done until then."
      action={
        <View style={s.total}>
          <Text style={s.totalText}>In all:</Text>
          <NumberButton value={String(total)} label={plural(total, 'task') + ' waiting for approval'} query={total ? { metric: 'awaiting-approval' } : null} onOpen={onOpen} tone="warning" />
        </View>
      }
    >
      {approvals.projects.length === 0 ? (
        <EmptyState icon="misc.waiting" title="Nothing is waiting" subtitle="No task in these projects is waiting for approval." />
      ) : (
        <View>
          {approvals.projects.map((p, i) => (
            <View key={p.id} style={[s.row, i > 0 && s.divider]}>
              <Text style={s.name} numberOfLines={capLines(2)}>
                <Text style={s.code}>{p.code} </Text>
                {p.name}
              </Text>
              <NumberButton
                value={String(p.count)}
                label={`${plural(p.count, 'task')} waiting for approval in ${p.name}`}
                query={p.count ? { metric: 'awaiting-approval', projectId: p.id } : null}
                onOpen={onOpen}
                tone="warning"
              />
            </View>
          ))}
        </View>
      )}
    </Section>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    total: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
    totalText: { ...typeStyle('body'), color: c.ink2 },
    row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
    divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.line },
    name: { ...typeStyle('body'), color: c.ink, flex: 1, minWidth: 0 },
    code: { ...typeStyle('caption'), color: c.ink3 },
  });
