import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useColors } from '../../core/theme';
import { copyText } from '../../adapters/clipboard';
import { applyNavAction } from '../../navigation/apply-action';
import { answerBlocks, copyTextOf, type Run } from '../../lib/mico-ai';
import type { MicoAiMessage, MicoAiSource } from '../../lib/mico-ai-api';
import { sourceTarget } from '../../lib/mico-ai-chat';
import { BRAND_GRADIENT, radius, spacing, type Palette } from '../../lib/theme';
import { font, typeStyle } from '../../lib/typography';
import { Button } from '../ui';
import { Icon } from '../Icon';
import { AnswerTable } from './AnswerTable';
import { ProposalCard } from './ProposalCard';

/** What an answer's buttons do (the screen carries them out and shows what went wrong). */
export interface MessageActions {
  /** Ask this text as the next question (quick replies, follow-ups). */
  ask(text: string): void;
  /** Ask the question this answer was for again. */
  retry(m: MicoAiMessage): void;
  /** Table n (1 = the first) as an Excel file. */
  downloadTable(m: MicoAiMessage, n: number, title: string): void;
  /** The whole answer (its words, every table, its sources) as one PDF report. */
  downloadReport(m: MicoAiMessage): void;
}

/** MICO AI's mark: its drawn icon on the brand gradient (decorative: the words around it name it). */
export function MicoAiMark({ size = 28 }: { size?: number }) {
  const c = useColors();
  return (
    <View style={[styles.mark, { width: size, height: size, borderRadius: size / 3.5 }]} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      <LinearGradient colors={BRAND_GRADIENT.colors} locations={BRAND_GRADIENT.locations} start={BRAND_GRADIENT.start} end={BRAND_GRADIENT.end} style={StyleSheet.absoluteFill} />
      <Icon name="nav.ai" size={Math.round(size * 0.55)} color={c.onBrand} />
    </View>
  );
}

function Runs({ runs, s }: { runs: Run[]; s: Styles }) {
  return (
    <>
      {runs.map((r, i) => (
        <Text key={i} style={r.bold ? s.bold : null}>
          {r.text}
        </Text>
      ))}
    </>
  );
}

/** An answer's words: paragraphs, bullets and bold — always as text, so nothing in an answer becomes markup. */
export function AnswerText({ text }: { text: string }) {
  const c = useColors();
  const s = useMemo(() => makeStyles(c), [c]);
  return (
    <View style={s.blocks}>
      {answerBlocks(text).map((b, i) =>
        b.kind === 'p' ? (
          <Text key={i} style={s.answer} selectable>
            {b.lines.map((line, j) => (
              <Text key={j}>
                {j > 0 ? '\n' : null}
                <Runs runs={line} s={s} />
              </Text>
            ))}
          </Text>
        ) : (
          <View key={i} style={s.list}>
            {b.items.map((item, j) => (
              <View key={j} style={s.item}>
                <View style={s.bullet} />
                <Text style={[s.answer, s.flex]} selectable>
                  <Runs runs={item} s={s} />
                </Text>
              </View>
            ))}
          </View>
        ),
      )}
    </View>
  );
}

/** "MICO AI is working": three dots and what it is doing now. */
function Thinking({ step, s }: { step: string | null; s: Styles }) {
  return (
    <View style={s.thinking}>
      <View style={s.dots} importantForAccessibility="no-hide-descendants">
        {[0, 1, 2].map((i) => (
          <View key={i} style={s.dot} />
        ))}
      </View>
      <Text style={s.muted}>{step || 'Thinking…'}</Text>
    </View>
  );
}

/** The records an answer used; one the app has a screen for opens it. */
function SourceChips({ sources, s }: { sources: MicoAiSource[]; s: Styles }) {
  if (!sources.length) return null;
  return (
    <View style={s.sources}>
      <Text style={s.sourcesLabel} importantForAccessibility="no">
        Sources:
      </Text>
      {sources.map((source) => {
        const target = sourceTarget(source);
        return target ? (
          <Pressable key={`${source.type}:${source.id}`} onPress={() => applyNavAction(target)} accessibilityRole="link" accessibilityLabel={`Source: ${source.label}`} style={({ pressed }) => [s.source, pressed ? s.pressed : null]}>
            <Text style={s.sourceText} numberOfLines={1}>
              {source.label}
            </Text>
          </Pressable>
        ) : (
          <View key={`${source.type}:${source.id}`} style={s.source} accessible accessibilityLabel={`Source: ${source.label}`}>
            <Text style={s.sourceText} numberOfLines={1}>
              {source.label}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

/** A choice MICO AI offers (a quick reply, a follow-up): it asks its words as the next question. */
function Pill({ text, canAsk, onAsk, s }: { text: string; canAsk: boolean; onAsk: (t: string) => void; s: Styles }) {
  return (
    <Pressable onPress={() => onAsk(text)} disabled={!canAsk} accessibilityRole="button" accessibilityState={{ disabled: !canAsk }} style={({ pressed }) => [s.pill, !canAsk ? s.dim : pressed ? s.pressed : null]}>
      <Text style={s.pillText}>{text}</Text>
    </Pressable>
  );
}

/**
 * One message, as on the website: your question in a bubble on the right; MICO AI's answer beside
 * its mark, with its card of proposed changes, tables, sources and buttons.
 */
export function MessageView({ chatId, message, latest, canAsk, actions }: { chatId: string | null; message: MicoAiMessage; latest: boolean; canAsk: boolean; actions: MessageActions }) {
  const c = useColors();
  const s = useMemo(() => makeStyles(c), [c]);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
  }, [copied]);

  if (message.role === 'user') {
    return (
      <View style={s.userRow}>
        <View style={s.bubble} accessible accessibilityLabel={`You: ${message.text}`}>
          <Text style={s.answer} selectable>
            {message.text}
          </Text>
        </View>
      </View>
    );
  }

  const a = message.answer;
  const done = message.status === 'done';
  let body;
  if (message.status === 'pending') body = <Thinking step={message.step} s={s} />;
  else if (message.status === 'stopped') body = <Text style={s.muted}>Stopped.</Text>;
  else if (message.status === 'error' || !a)
    body = (
      <View style={s.errorBox} accessibilityRole="alert">
        <Text style={s.errorText}>{message.error ?? 'Something went wrong while answering. Try again.'}</Text>
      </View>
    );
  else if (a.unavailable)
    body = (
      <View style={s.unavailable}>
        <AnswerText text={message.text} />
      </View>
    );
  else body = <AnswerText text={message.text} />;

  return (
    <View style={s.answerRow}>
      <MicoAiMark />
      <View style={s.answerBody} accessibilityLabel="MICO AI’s answer">
        {body}
        {/* A card of proposed changes: MICO AI's words, then the card to check and confirm. */}
        {a?.kind === 'proposal' && a.proposal && done && chatId ? <ProposalCard chatId={chatId} message={message} /> : null}
        {a?.kind === 'clarify' && a.options.length ? (
          // "Which Omar?": each option is sent as the next question.
          <View style={s.pills} accessibilityLabel="Quick replies">
            {a.options.map((o) => (
              <Pill key={o} text={o} canAsk={canAsk} onAsk={actions.ask} s={s} />
            ))}
          </View>
        ) : null}
        {a?.tables.map((t, i) => <AnswerTable key={i} table={t} onExcel={done ? () => actions.downloadTable(message, i + 1, t.title) : undefined} />)}
        {a ? <SourceChips sources={a.sources} s={s} /> : null}
        {message.status !== 'pending' ? (
          <View style={s.actions}>
            {/* The whole answer as one report: its words, every table and its sources (text-only answers too). */}
            {a && done && a.kind === 'answer' && (message.text.trim() || a.tables.length) ? (
              <Button title="PDF report" icon="ui.download" variant="secondary" size="sm" onPress={() => actions.downloadReport(message)} accessibilityLabel="Download this answer as a PDF report" />
            ) : null}
            {a && done ? (
              <Button
                title={copied ? 'Copied' : 'Copy'}
                icon={copied ? 'misc.check' : 'ui.copy'}
                variant="ghost"
                size="sm"
                onPress={() => {
                  if (copyText(copyTextOf(message))) setCopied(true);
                }}
              />
            ) : null}
            <Button title="Retry" icon="kit.repeat" variant="ghost" size="sm" disabled={!canAsk} onPress={() => actions.retry(message)} />
          </View>
        ) : null}
        {latest && a?.followUps.length && done && a.kind === 'answer' ? (
          <View style={s.pills} accessibilityLabel="Suggested follow-ups">
            {a.followUps.map((f) => (
              <Pill key={f} text={f} canAsk={canAsk} onAsk={actions.ask} s={s} />
            ))}
          </View>
        ) : null}
      </View>
    </View>
  );
}

type Styles = ReturnType<typeof makeStyles>;

const styles = StyleSheet.create({
  mark: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
});

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    flex: { flex: 1 },
    userRow: { flexDirection: 'row', justifyContent: 'flex-end', paddingLeft: spacing.xxl },
    bubble: { backgroundColor: c.ground, borderRadius: radius.sheet, paddingHorizontal: spacing.lg, paddingVertical: 10, flexShrink: 1 },
    answerRow: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
    answerBody: { flex: 1, minWidth: 0, gap: 14 },
    blocks: { gap: spacing.md },
    answer: { ...typeStyle('body'), fontSize: 15, lineHeight: 24, color: c.ink },
    bold: { ...font('600'), color: c.ink },
    list: { gap: 6 },
    item: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
    bullet: { width: 6, height: 6, borderRadius: 3, backgroundColor: c.brand, marginTop: 9 },
    muted: { ...typeStyle('body'), color: c.ink2 },
    thinking: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 28 },
    dots: { flexDirection: 'row', gap: 4 },
    dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: c.brand },
    errorBox: { borderWidth: 1, borderColor: c.danger, backgroundColor: c.dangerSoft, borderRadius: radius.button, paddingHorizontal: 14, paddingVertical: 10 },
    errorText: { ...typeStyle('body'), color: c.dangerText },
    unavailable: { borderWidth: 1, borderColor: c.warning, backgroundColor: c.warningSoft, borderRadius: radius.button, paddingHorizontal: 14, paddingVertical: 10 },
    sources: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
    sourcesLabel: { ...typeStyle('caption'), color: c.ink2 },
    source: { minHeight: 32, justifyContent: 'center', borderRadius: radius.pill, backgroundColor: c.infoSoft, paddingHorizontal: 10, maxWidth: '100%' },
    sourceText: { ...typeStyle('caption'), ...font('600'), color: c.infoText },
    actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
    pills: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    pill: { minHeight: 40, justifyContent: 'center', borderRadius: radius.pill, borderWidth: 1, borderColor: c.brand, backgroundColor: c.brandWash, paddingHorizontal: 14, paddingVertical: 6, maxWidth: '100%' },
    pillText: { ...typeStyle('label'), color: c.brandText },
    pressed: { opacity: 0.8 },
    dim: { opacity: 0.5 },
  });
