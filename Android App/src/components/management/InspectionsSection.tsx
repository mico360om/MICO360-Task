import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useColors } from '../../core/theme';
import { useServices } from '../../core/providers';
import { EmptyState } from '../ui';
import { openWebsitePage } from '../../adapters/website';
import { inspectionFigures, plural } from '../../lib/management';
import type { ManagementOverview } from '../../lib/management-api';
import { radius, spacing, type Palette } from '../../lib/theme';
import { typeStyle } from '../../lib/typography';
import { NumberButton, Section, type OpenList } from './parts';
import { capLines } from '../ui/text-lines';

/**
 * Inspections (the website's InspectionsSection.tsx): checks done against those due in the period,
 * done late, missing now, closed without a report, the pass rate, open follow-up tasks, and the items
 * and forms that failed most. Every count opens its list; a percentage is shown, not a list.
 */
export function InspectionsSection({ data, onOpen }: { data: ManagementOverview['inspections']; onOpen: OpenList }) {
  const c = useColors();
  const s = useMemo(() => makeStyles(c), [c]);
  const { baseUrl } = useServices();
  const nothing = data.due === 0 && data.finished === 0 && data.missing === 0 && data.openFollowUps === 0;
  return (
    <Section title="Inspections" note="Checks are tasks that carry an inspection form. Due, done and the pass rate cover the chosen period; missing checks and follow-ups are now.">
      {nothing ? (
        <EmptyState
          icon="nav.templates"
          title="No inspections yet"
          subtitle="Checks due and inspections finished in this period show here. Start with a form in Templates, then schedule checks from a project’s Inspections tab."
          // Inspection forms are made on the website (spec §4).
          action={{ title: 'Inspection forms', onPress: () => openWebsitePage(baseUrl, '/templates') }}
        />
      ) : (
        <>
          <View style={s.figures}>
            {inspectionFigures(data).map((f) => (
              <View key={f.label} style={s.figureCell}>
                <View style={s.figure}>
                  <NumberButton value={f.value} label={f.action || `${f.label}: ${f.spoken ?? f.value}`} query={f.query} onOpen={onOpen} tone={f.tone} big />
                  <Text style={s.figureLabel}>{f.label}</Text>
                  {f.help ? <Text style={s.help}>{f.help}</Text> : null}
                </View>
              </View>
            ))}
          </View>

          <Text style={s.subhead} accessibilityRole="header">
            Most-failed items
          </Text>
          {data.topItems.length === 0 ? (
            <Text style={s.quiet}>No item failed in this period.</Text>
          ) : (
            <View style={s.list}>
              {data.topItems.map((i, n) => (
                <View key={`${i.formId}|${i.itemId}`} style={[s.row, n > 0 && s.divider]}>
                  <View style={s.flex}>
                    <Text style={s.itemLabel} numberOfLines={capLines(2)}>
                      {i.label}
                    </Text>
                    <Text style={s.formTitle} numberOfLines={1}>
                      {i.formTitle}
                    </Text>
                  </View>
                  <NumberButton
                    value={String(i.failures)}
                    label={`“${i.label}” failed ${plural(i.failures, 'time')}`}
                    query={i.failures ? { metric: 'failed-item', formId: i.formId ?? 'none', itemId: i.itemId } : null}
                    onOpen={onOpen}
                    tone="danger"
                    suffix="×"
                  />
                </View>
              ))}
            </View>
          )}

          <Text style={s.subhead} accessibilityRole="header">
            Forms with the most failed items
          </Text>
          {data.topForms.length === 0 ? (
            <Text style={s.quiet}>No form had a failed item in this period.</Text>
          ) : (
            <View style={s.list}>
              {data.topForms.map((f, n) => {
                const formId = f.formId ?? 'none';
                return (
                  <View key={f.formId ?? f.title} style={[s.form, n > 0 && s.divider]}>
                    <Text style={s.itemLabel} numberOfLines={capLines(2)}>
                      {f.title}
                    </Text>
                    <View style={s.formLine}>
                      <NumberButton value={String(f.failedItems)} label={`${plural(f.failedItems, 'failed item')} in ${f.title}`} query={f.failedItems ? { metric: 'failed-form', formId } : null} onOpen={onOpen} tone="danger" />
                      <Text style={s.formWords}>{f.failedItems === 1 ? 'failed item' : 'failed items'} ·</Text>
                      <NumberButton value={String(f.withFailures)} label={`${plural(f.withFailures, 'inspection')} of ${f.title} had a failure`} query={f.withFailures ? { metric: 'inspections', formId, failed: true } : null} onOpen={onOpen} />
                      <Text style={s.formWords}>of</Text>
                      <NumberButton value={String(f.finished)} label={`${plural(f.finished, 'inspection')} of ${f.title} finished`} query={f.finished ? { metric: 'inspections', formId } : null} onOpen={onOpen} />
                      <Text style={s.formWords}>{f.finished === 1 ? 'inspection had' : 'inspections had'} a failure</Text>
                    </View>
                  </View>
                );
              })}
            </View>
          )}
        </>
      )}
    </Section>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    flex: { flex: 1, minWidth: 0 },
    figures: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -spacing.xs },
    figureCell: { width: '50%', padding: spacing.xs },
    figure: { borderWidth: 1, borderColor: c.line, borderRadius: radius.button, padding: spacing.md, flexGrow: 1 },
    figureLabel: { ...typeStyle('bodyStrong'), fontSize: 12, lineHeight: 16, color: c.ink2, marginTop: 2 },
    help: { ...typeStyle('caption'), fontSize: 11, lineHeight: 14, color: c.ink3, marginTop: 2 },
    subhead: { ...typeStyle('subheading'), color: c.ink, marginTop: spacing.sm },
    quiet: { ...typeStyle('body'), color: c.ink2, backgroundColor: c.ground, borderRadius: radius.input, padding: spacing.md },
    list: { borderWidth: 1, borderColor: c.line, borderRadius: radius.button, paddingHorizontal: spacing.md },
    row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.xs },
    divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.line },
    itemLabel: { ...typeStyle('label'), color: c.ink },
    formTitle: { ...typeStyle('caption'), color: c.ink3 },
    form: { paddingVertical: spacing.sm },
    formLine: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: spacing.xs },
    formWords: { ...typeStyle('caption'), color: c.ink2 },
  });
