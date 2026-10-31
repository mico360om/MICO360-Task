import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useServices } from '../../core/providers';
import { useColors } from '../../core/theme';
import { useMinutesClient } from '../../core/client-share-queries';
import { clientSwitchStep, type MinutesClientVisibility } from '../../lib/client-share';
import { MINUTES_CLIENT_WORDS as W, minutesHint, previewParts, showMinutesSwitch } from '../../lib/minutes-client';
import { problemText } from '../../lib/inspection-words';
import type { ApiFinalMinutes } from '../../lib/types';
import { radius, spacing } from '../../lib/theme';
import { font, typeStyle } from '../../lib/typography';
import { Icon } from '../Icon';
import { Toggle } from '../ui';
import { ClientPreviewSheet } from './ClientPreviewSheet';
import { MarkedText } from './MarkedText';

const HIGHLIGHTED = 'Highlighted';

/**
 * "Show to client" on a project meeting's approved final minutes (the website's MinutesClientSwitch):
 * whoever runs the project may put them on its client page, after a preview of exactly what the
 * client will see (names highlighted, owners off the next steps, risks only when ticked) — nothing
 * is shown until the preview's own "Show to client" is tapped. Turning it off takes them off at
 * once. Others only see that they are visible. Reopened or re-filed minutes leave the client page.
 */
export function MinutesClientSwitch({ meetingId, minutes }: { meetingId: string; minutes: Pick<ApiFinalMinutes, 'status' | 'content'> }) {
  const c = useColors();
  const qc = useQueryClient();
  const { resources } = useServices();
  const q = useMinutesClient(meetingId);
  const [previewing, setPreviewing] = useState(false);
  const [includeRisks, setIncludeRisks] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const previewQ = useQuery({
    queryKey: ['meeting', meetingId, 'client-preview'],
    queryFn: () => resources.clientShares.minutesPreview(meetingId),
    enabled: previewing,
    staleTime: 0,
  });

  const run = async (change: Promise<MinutesClientVisibility>) => {
    setBusy(true);
    setProblem(null);
    try {
      qc.setQueryData(['meeting', meetingId, 'client-visibility'], await change);
      setPreviewing(false);
    } catch (e) {
      setProblem(problemText(e, W.changeFailed));
    } finally {
      setBusy(false);
    }
  };

  const v = q.data;
  const shown = showMinutesSwitch(v, minutes);
  if (!v || !shown) return null;
  if (shown === 'chip') {
    return (
      <View style={[s.mark, { backgroundColor: c.infoSoft }]}>
        <Icon name="misc.eye" size={12} color={c.infoText} />
        <Text style={[typeStyle('caption'), font('600'), { color: c.infoText }]}>{W.visible}</Text>
      </View>
    );
  }

  const turn = (next: boolean) => {
    const step = clientSwitchStep(v.clientVisible, next);
    if (step === 'hide') void run(resources.clientShares.setMinutesVisible(meetingId, false));
    else if (step === 'preview') {
      setProblem(null);
      setIncludeRisks(false);
      setPreviewing(true);
    }
  };

  const p = previewQ.data;
  const content = p?.content;
  const names = p?.names ?? [];
  return (
    <View style={[s.box, { borderColor: c.line }]}>
      <Toggle on={v.clientVisible} onChange={turn} label={W.show} hint={minutesHint(v)} disabled={busy || !v.approved} />
      {/* Said with the switch (its hint), so TalkBack doesn't read it twice. */}
      <Text style={[typeStyle('caption'), { color: c.ink2 }]} importantForAccessibility="no">
        {minutesHint(v)}
      </Text>
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
          loading={previewQ.isFetching}
          error={previewQ.isError ? W.previewFailed : problem}
          namesNote={
            content && names.length ? (
              <Text style={[typeStyle('caption'), { color: c.ink2 }]}>
                <Text style={[font('600'), { backgroundColor: c.warningSoft, color: c.ink }]}>{HIGHLIGHTED}</Text>
                {W.namesNote.slice(HIGHLIGHTED.length)}
              </Text>
            ) : null
          }
          footer={
            content && content.risks.length ? (
              <View style={s.risks}>
                <Toggle on={includeRisks} onChange={setIncludeRisks} label={W.includeRisks} hint={W.includeRisksHint} disabled={busy} />
                <Text style={[typeStyle('caption'), { color: c.ink2 }]} importantForAccessibility="no">
                  {W.includeRisksHint}
                </Text>
              </View>
            ) : null
          }
          onCancel={() => setPreviewing(false)}
          onConfirm={() => void run(resources.clientShares.setMinutesVisible(meetingId, true, includeRisks))}
          busy={busy}
        >
          {content ? (
            <View style={s.preview}>
              {content.summary ? <MarkedText text={content.summary} names={names} style={[typeStyle('body'), { color: c.ink }]} /> : null}
              {previewParts(content, includeRisks).map((part) => (
                <View key={part.title} style={s.part}>
                  <Text style={[typeStyle('subheading'), { color: c.ink }]} accessibilityRole="header">
                    {part.title}
                  </Text>
                  {part.kind === 'discussion'
                    ? content.discussion.map((d, i) => (
                        <View key={i}>
                          <MarkedText text={d.topic} names={names} style={[typeStyle('label'), { color: c.ink }]} />
                          <MarkedText text={d.text} names={names} style={[typeStyle('body'), { color: c.ink2 }]} />
                        </View>
                      ))
                    : part.items.map((t, i) => (
                        <View key={i} style={s.item}>
                          <View style={[s.dot, { backgroundColor: c.ink3 }]} />
                          <MarkedText text={t} names={names} style={[typeStyle('body'), s.itemText, { color: c.ink }]} />
                        </View>
                      ))}
                </View>
              ))}
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
  preview: { gap: spacing.md },
  part: { gap: spacing.xs },
  item: { flexDirection: 'row', gap: spacing.sm },
  dot: { width: 4, height: 4, borderRadius: 2, marginTop: 8 },
  itemText: { flex: 1 },
  risks: { gap: 2 },
});
