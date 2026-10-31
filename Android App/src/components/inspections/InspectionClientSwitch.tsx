import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useServices } from '../../core/providers';
import { useColors } from '../../core/theme';
import { clientSwitchStep } from '../../lib/client-share';
import { REPORT_CLIENT_WORDS as W, notesNameSomeone } from '../../lib/inspection-client';
import type { InspectionDetail } from '../../lib/inspection-types';
import { problemText } from '../../lib/inspection-words';
import { radius, spacing } from '../../lib/theme';
import { font, typeStyle } from '../../lib/typography';
import { dayText } from '../../lib/day-words';
import { Icon } from '../Icon';
import { Toggle } from '../ui';
import { ClientPreviewSheet } from '../client-share/ClientPreviewSheet';
import { ClientInspectionBody } from './ClientInspectionBody';

/**
 * "Show to client" on a finished inspection, as the website's: whoever runs the project may put its
 * report on the project's client page (with a PDF), after a preview of exactly what the client will
 * see — nothing is shown until the preview's own "Show to client" is tapped. Turning it off takes it
 * off at once. Others see only that it is visible. An archived project's report can only be taken off.
 */
export function InspectionClientSwitch({ detail, archived, onChanged }: { detail: InspectionDetail; archived: boolean; onChanged: () => void }) {
  const c = useColors();
  const { resources } = useServices();
  const [previewing, setPreviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const visible = detail.clientVisible;
  const previewQ = useQuery({
    queryKey: ['inspection', detail.id, 'client-preview'],
    queryFn: () => resources.inspections.clientPreview(detail.id),
    enabled: previewing,
    staleTime: 0,
  });

  const run = async (change: Promise<unknown>) => {
    setBusy(true);
    setProblem(null);
    try {
      await change;
      setPreviewing(false);
      onChanged();
    } catch (e) {
      setProblem(problemText(e, W.changeFailed));
    } finally {
      setBusy(false);
    }
  };

  if (!detail.permissions.canShowToClient) {
    return visible ? (
      <View style={[s.mark, { backgroundColor: c.infoSoft }]}>
        <Icon name="misc.eye" size={12} color={c.infoText} />
        <Text style={[typeStyle('caption'), font('600'), { color: c.infoText }]}>{W.visible}</Text>
      </View>
    ) : null;
  }

  const turn = (next: boolean) => {
    const step = clientSwitchStep(visible, next);
    if (step === 'hide') void run(resources.inspections.setClientVisible(detail.id, false));
    else if (step === 'preview') {
      setProblem(null);
      setPreviewing(true);
    }
  };

  const p = previewQ.data;
  return (
    <View style={[s.box, { borderColor: c.line }]}>
      <Toggle on={visible} onChange={turn} label={W.show} disabled={busy || (archived && !visible)} />
      <Text style={[typeStyle('caption'), { color: c.ink2 }]}>{archived ? W.archivedHint : visible ? W.onHint : W.offHint}</Text>
      {problem && !previewing ? (
        <Text style={[typeStyle('caption'), { color: c.dangerText }]} accessibilityRole="alert">
          {problem}
        </Text>
      ) : null}
      {previewing ? (
        <ClientPreviewSheet
          visible
          title={W.previewTitle}
          intro={W.previewIntro}
          loading={previewQ.isLoading}
          error={previewQ.isError ? problemText(previewQ.error, W.previewFailed) : problem}
          namesNote={
            p && notesNameSomeone(p.inspection, p.names) ? (
              <Text style={[typeStyle('caption'), { color: c.ink2 }]}>
                <Text style={[font('600'), { backgroundColor: c.warningSoft, color: c.ink }]}>Highlighted</Text>
                {W.namesNote.slice('Highlighted'.length)}
              </Text>
            ) : null
          }
          onCancel={() => setPreviewing(false)}
          onConfirm={() => void run(resources.inspections.setClientVisible(detail.id, true))}
          busy={busy}
        >
          {p ? (
            <View style={s.preview}>
              <Text style={[typeStyle('subheading'), { color: c.ink }]}>{p.inspection.title}</Text>
              <Text style={[typeStyle('caption'), { color: c.ink2 }]}>{[dayText(p.inspection.date), p.inspection.place].filter(Boolean).join(' · ')}</Text>
              <ClientInspectionBody inspection={p.inspection} names={p.names} />
            </View>
          ) : null}
        </ClientPreviewSheet>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  box: { borderWidth: 1, borderRadius: radius.button, padding: spacing.md, gap: spacing.xs },
  mark: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', borderRadius: radius.badge, paddingHorizontal: 6, paddingVertical: 2 },
  preview: { gap: spacing.xs },
});
