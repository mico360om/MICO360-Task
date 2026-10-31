import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useColors } from '../../core/theme';
import { Avatar, EmptyState } from '../ui';
import { overloadedDaysText, plural, shortDay } from '../../lib/management';
import type { PersonRow } from '../../lib/management-api';
import { radius, spacing, type Palette } from '../../lib/theme';
import { typeStyle } from '../../lib/typography';
import { NumberButton, Section, Term, type OpenList } from './parts';

/**
 * People and workload (the website's PeopleSection.tsx, its phone cards): who has late work, who is
 * over the Workload daily limit on a working day this week (the number counts days), and open meeting
 * action items with the overdue ones — in the projects shown. Every number opens its own list.
 */
export function PeopleSection({ people, week, limit, onOpen }: { people: PersonRow[]; week: string; limit: number; onOpen: OpenList }) {
  const c = useColors();
  const s = useMemo(() => makeStyles(c), [c]);
  return (
    <Section title="People and workload" note={`This week from ${shortDay(week)}. Overloaded: more than ${limit} open tasks due on a working day (the Workload limit).`}>
      {people.length === 0 ? (
        <EmptyState icon="ui.users" title="Nobody is behind" subtitle="Nobody has late work, an overloaded day or open action items in these projects." />
      ) : (
        people.map((p) => {
          const days = overloadedDaysText(p.overloadedDays);
          return (
            <View key={p.id} style={s.card}>
              <View style={s.who}>
                <Avatar name={p.name} src={p.avatarUrl} size="sm" />
                <Text style={s.name} numberOfLines={1}>
                  {p.name}
                </Text>
              </View>
              <View style={s.grid}>
                <View style={s.cell}>
                  <Term>Late tasks</Term>
                  <NumberButton value={String(p.lateTasks)} label={`${p.name}: ${plural(p.lateTasks, 'late task')}`} query={p.lateTasks ? { metric: 'late-tasks', personId: p.id } : null} onOpen={onOpen} tone="danger" />
                </View>
                <View style={s.cell}>
                  <Term>Overloaded days</Term>
                  <NumberButton
                    value={String(p.overloadedDays.length)}
                    label={`${p.name}: ${plural(p.overloadedDays.length, 'day')} over the limit this week`}
                    query={p.overloadedDays.length ? { metric: 'person-overloaded', personId: p.id } : null}
                    onOpen={onOpen}
                    tone="danger"
                  />
                </View>
                <View style={s.cell}>
                  <Term>Action items</Term>
                  <NumberButton value={String(p.openActions)} label={`${p.name}: ${plural(p.openActions, 'open action item')}`} query={p.openActions ? { metric: 'person-actions', personId: p.id } : null} onOpen={onOpen} />
                </View>
              </View>
              {days || p.overdueActions ? (
                <View style={s.more}>
                  {days ? <Text style={s.days}>{days}</Text> : null}
                  {p.overdueActions ? (
                    <NumberButton
                      value={`${p.overdueActions} overdue`}
                      label={`${p.name}: ${plural(p.overdueActions, 'overdue action item')}`}
                      query={{ metric: 'overdue-actions', personId: p.id }}
                      onOpen={onOpen}
                      tone="danger"
                    />
                  ) : null}
                </View>
              ) : null}
            </View>
          );
        })
      )}
    </Section>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    card: { borderWidth: 1, borderColor: c.line, borderRadius: radius.button, padding: spacing.md, gap: spacing.xs },
    who: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    name: { ...typeStyle('label'), color: c.ink, flex: 1, minWidth: 0 },
    grid: { flexDirection: 'row', flexWrap: 'wrap' },
    cell: { minWidth: '33%', flexGrow: 1, paddingEnd: spacing.sm },
    more: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: spacing.sm },
    days: { ...typeStyle('caption'), color: c.ink2 },
  });
