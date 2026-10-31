import React, { useEffect, useRef } from 'react';
import { AccessibilityInfo, StyleSheet, Text, View } from 'react-native';
import { useColors } from '../../core/theme';
import type { DraftView } from '../../lib/inspection-outbox';
import type { SyncState } from '../../lib/inspection-outboxes';
import { BACK_ONLINE, INSPECTION_WORDS, SYNC_ANNOUNCE, pendingWords, syncLine, syncWord, type SyncWord } from '../../lib/inspection-words';
import type { IconName } from '../../lib/icons';
import { radius, spacing } from '../../lib/theme';
import { toneStyle, type Tone } from '../../lib/tone';
import { typeStyle } from '../../lib/typography';
import { Icon } from '../Icon';
import { Button } from '../ui';

const LOOK: Record<SyncWord, { tone: Tone | 'plain'; icon: IconName }> = {
  memory: { tone: 'warning', icon: 'ui.alert' },
  sent: { tone: 'plain', icon: 'kit.checkCircle' },
  sending: { tone: 'plain', icon: 'kit.checkCircle' },
  'signed-out': { tone: 'warning', icon: 'kit.lock' },
  unreachable: { tone: 'info', icon: 'ui.wifiOff' },
  retry: { tone: 'info', icon: 'ui.wifiOff' },
  offline: { tone: 'info', icon: 'ui.wifiOff' },
  soon: { tone: 'plain', icon: 'kit.clock' },
};
const AWAY = new Set<SyncWord>(['offline', 'unreachable', 'retry', 'signed-out', 'memory']);

/**
 * Where this inspection's changes are, as the website's banner says it: on this phone and waiting
 * for a signal, being sent, all sent, or — the phone's storage being full — only in the app. A
 * refusal the server won't change its mind about is said in plain words, with what can be done.
 * TalkBack hears it only when it matters: the changes can't be sent (and why), or they all went once
 * that was over.
 */
export function SyncBanner({
  view,
  sync,
  online,
  onTryNow,
  onDiscard,
  onLookAgain,
  onOk,
}: {
  view: DraftView | null;
  sync: SyncState;
  online: boolean;
  onTryNow: () => void;
  onDiscard: () => void;
  onLookAgain: () => void;
  /** The person read a note (a refused follow-up request): clear it. */
  onOk: () => void;
}) {
  const c = useColors();
  const word = view ? syncWord(view, sync, online) : null;
  const last = useRef<SyncWord | null>(null);
  useEffect(() => {
    if (!word || word === 'sending' || word === 'soon' || word === last.current) return;
    const before = last.current;
    last.current = word;
    if (AWAY.has(word)) AccessibilityInfo.announceForAccessibility(SYNC_ANNOUNCE[word]!);
    else if (word === 'sent' && before && AWAY.has(before)) AccessibilityInfo.announceForAccessibility(BACK_ONLINE);
  }, [word]);

  if (!view || !word) return null;
  const { pending, problem } = view;
  const waiting = pending.answers > 0 || pending.followUps > 0 || pending.finish;

  if (problem && problem.stage === 'answers') {
    const gone = problem.code === 'INSPECTION_GONE' || problem.code === 'NOT_FOUND';
    const t = toneStyle(c, 'danger');
    return (
      <View style={[s.box, { backgroundColor: t.bg, borderColor: t.border }]} accessibilityRole="alert" accessibilityLiveRegion="assertive">
        <View style={s.line}>
          <Icon name="ui.alert" size={16} color={t.fg} />
          <View style={s.words}>
            <Text style={[typeStyle('body'), { color: t.fg }]}>{problem.message}</Text>
            {waiting ? <Text style={[typeStyle('caption'), { color: t.fg }]}>{INSPECTION_WORDS.stillOnPhone.replace('{w}', pendingWords(pending))}</Text> : null}
          </View>
        </View>
        <View style={s.buttons}>
          {!gone ? <Button title={INSPECTION_WORDS.tryAgain} variant="secondary" size="sm" onPress={onTryNow} /> : null}
          <Button title={INSPECTION_WORDS.throwAway} variant="danger" size="sm" onPress={onDiscard} />
        </View>
      </View>
    );
  }

  // A refused finish or follow-up request: a note to read. It holds nothing else back.
  const note =
    problem && problem.stage !== 'answers' ? (
      <View style={[s.box, { backgroundColor: c.warningSoft, borderColor: c.warning }]} accessibilityRole="alert">
        <View style={s.line}>
          <Icon name="ui.alert" size={16} color={c.warningText} />
          <Text style={[typeStyle('body'), s.words, { color: c.warningText }]}>{problem.message}</Text>
        </View>
        <View style={s.buttons}>
          <Button title={problem.stage === 'finish' ? INSPECTION_WORDS.lookAgain : INSPECTION_WORDS.ok} variant="secondary" size="sm" onPress={problem.stage === 'finish' ? onLookAgain : onOk} />
        </View>
      </View>
    ) : null;

  const look = LOOK[word];
  const t = look.tone === 'plain' ? { bg: c.surface, fg: c.ink2, border: c.line } : toneStyle(c, look.tone);
  return (
    <View style={s.stack}>
      {note}
      <View style={[s.box, s.status, { backgroundColor: t.bg, borderColor: t.border }]}>
        <View style={[s.line, s.grow]}>
          <Icon name={look.icon} size={16} color={t.fg} />
          <Text style={[typeStyle('body'), s.words, { color: t.fg }]}>{syncLine(syncWord(view, sync, online), view)}</Text>
        </View>
        {word === 'unreachable' || word === 'retry' ? <Button title={INSPECTION_WORDS.tryNow} variant="ghost" size="sm" onPress={onTryNow} /> : null}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  stack: { gap: spacing.sm },
  box: { borderWidth: 1, borderRadius: radius.button, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: spacing.sm },
  status: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  line: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  grow: { flex: 1 },
  words: { flex: 1 },
  buttons: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
