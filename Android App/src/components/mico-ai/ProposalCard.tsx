import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useColors } from '../../core/theme';
import { useCardActions, useCardRefresh } from '../../core/mico-ai-queries';
import { applyNavAction } from '../../navigation/apply-action';
import type { MicoAiMessage, MicoAiProposal, ProposalChange } from '../../lib/mico-ai-api';
import { linkTarget } from '../../lib/mico-ai-chat';
import { FOOTER_NOTE, KIND_BADGE, applyEdit, cardControls, confirmA11y, confirmLabel, effectiveChange, resultLine, timeProblem, undoButtonText, undoLine, type Shown } from '../../lib/mico-ai-card';
import { cardHeading, changeLabel, confirmBody, initialTicks, remainingNeeds, resultSummary, undoLeft, undoSummary } from '../../lib/mico-ai-proposal';
import { radius, shadow, spacing, type Palette } from '../../lib/theme';
import { font, typeStyle } from '../../lib/typography';
import { CheckRow } from '../meeting/sheet-kit';
import { Badge, Button, ErrorNote, NoticeNote, Toggle } from '../ui';
import { ProposalEditor } from './ProposalEditor';
import { RowSummary, cardWhen } from './ProposalSummary';

const CANCELLED = 'Cancelled — nothing was changed.';

/** The current time, ticking every second while `active` (the Undo countdown). */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

/** When the card's server time was taken, by the phone's clock (read again with each new `serverNow`). */
const receivedTime = (_serverNow: string) => Date.now();

/** What happened to one change: done (with where to open it), being made, refused or failed, or skipped. */
function ResultLine({ result, gone, s }: { result: NonNullable<ProposalChange['result']>; gone: boolean; s: Styles }) {
  if (result.status === 'done') {
    const target = result.link && !gone ? linkTarget(result.link.url) : null;
    return (
      <View style={s.result}>
        <Badge label="Done" tone="success" />
        {target && result.link ? <Button title={`Open ${result.link.label}`} variant="ghost" size="sm" onPress={() => applyNavAction(target)} /> : null}
        {result.message ? <Text style={s.muted}>{resultLine(result)}</Text> : null}
      </View>
    );
  }
  if (result.status === 'refused' || result.status === 'failed') return <Text style={s.problem}>{resultLine(result)}</Text>;
  return <Text style={result.status === 'skipped' ? s.quiet : s.muted}>{resultLine(result)}</Text>;
}

/**
 * MICO AI's review card, as the website's ProposalCard: every change it proposes, each with a tick
 * box (unticked when something needs putting right; none when it can't go ahead), and Confirm, which
 * sends the ticked changes — nothing happens before. Then each change shows what happened, and Undo
 * puts them back for 15 minutes. Confirm, Cancel and Undo go through the card's one gate, and the
 * buttons follow the card's status, so a double tap or a Confirm whose answer was lost applies the
 * changes once (Review Focus 3).
 */
export function ProposalCard({ chatId, message }: { chatId: string; message: MicoAiMessage }) {
  const c = useColors();
  const s = useMemo(() => makeStyles(c), [c]);
  const proposal = message.answer!.proposal as MicoAiProposal;
  const { confirm, cancel, undo, busy } = useCardActions(chatId, message.id);
  useCardRefresh(chatId, message);
  const when = useMemo(() => cardWhen(), []);
  const [ticks, setTicks] = useState(() => initialTicks(proposal.items));
  const [edits, setEdits] = useState<Record<string, Record<string, unknown>>>({});
  const [shown, setShown] = useState<Record<string, Shown>>({});
  /** The changes whose editor is open. */
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  /** Meeting times as typed, per change: one that doesn't read as a time holds Confirm back. */
  const [times, setTimes] = useState<Record<string, string>>({});
  const badTime = timeProblem(times);
  const [invite, setInvite] = useState(proposal.sendInvites);
  const [acting, setActing] = useState<null | 'confirm' | 'cancel' | 'undo'>(null);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState('');
  /** What this card asked for, so its outcome is announced once. */
  const acted = useRef<null | 'confirm' | 'cancel' | 'undo'>(null);

  const status = proposal.status;
  const proposed = status === 'proposed';
  // While it waits for Confirm, each change is shown with the person's edits in it.
  const items = proposed ? proposal.items.map((i) => effectiveChange(i, edits[i.id], shown[i.id])) : proposal.items;
  /** What each change still needs putting right (an edit to the field concerned clears it). */
  const needsOf = (item: ProposalChange) => remainingNeeds(proposal.items.find((x) => x.id === item.id) ?? item, edits[item.id]);
  // Only a change with nothing left to put right can be ticked (Select all included).
  const eligible = items.filter((i) => !i.locked && needsOf(i).length === 0);
  const ticked = eligible.filter((i) => ticks[i.id]).length;

  // The countdown follows the server's clock: the phone's may be off (taken when this copy of the card arrived).
  const canUndoNow = status === 'done' && proposal.canUndo && !!proposal.undoUntil;
  const now = useNow(canUndoNow);
  const receivedAt = useMemo(() => receivedTime(proposal.serverNow), [proposal.serverNow]);
  const left = undoLeft(proposal.undoUntil, proposal.serverNow, receivedAt, now);
  const controls = cardControls(proposal, left);

  // The card's state moved on (the server's answer replaced it): what happened is announced, once.
  const latest = useRef(proposal);
  latest.current = proposal;
  useEffect(() => {
    const p = latest.current;
    if (p.status === 'done' && acted.current === 'confirm') {
      acted.current = null;
      setLive(`Changes made: ${resultSummary(p.items)}.`);
    } else if (p.status === 'undone' && acted.current === 'undo') {
      acted.current = null;
      setLive(`Undo: ${undoSummary(p.items)}.`);
    } else if (p.status === 'cancelled' && acted.current === 'cancel') {
      acted.current = null;
      setLive(CANCELLED);
    }
  }, [status]);

  /** An edit to one change (`item` as proposed): kept for Confirm, and the change ticked once nothing is left to put right. */
  const edit = (item: ProposalChange, patch: Record<string, unknown>, show?: Shown) => {
    const r = applyEdit(edits, item, patch);
    setEdits(r.edits);
    if (show) setShown((sh) => ({ ...sh, [item.id]: { ...sh[item.id], ...show } }));
    setTicks((t) => ({ ...t, [item.id]: r.tick }));
  };
  const toggleOpen = (id: string) =>
    setOpen((o) => {
      const n = new Set(o);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  async function run(kind: 'confirm' | 'cancel' | 'undo', call: () => Promise<string | null>) {
    if (busy) return;
    setActing(kind);
    setError(null);
    acted.current = kind;
    const problem = await call();
    setActing(null);
    if (problem) {
      acted.current = null;
      setError(problem);
    }
  }

  return (
    <View style={s.card}>
      <View style={s.head}>
        <Text style={s.heading} accessibilityRole="header">
          {cardHeading(items)}
        </Text>
      </View>
      {proposed && eligible.length > 1 ? (
        <View style={s.pad}>
          <CheckRow
            label="Select all"
            checked={ticked === eligible.length}
            disabled={busy}
            onChange={() => {
              const on = ticked !== eligible.length;
              setTicks((t) => ({ ...t, ...Object.fromEntries(eligible.map((i) => [i.id, on])) }));
            }}
          />
        </View>
      ) : null}
      {proposal.note ? (
        <View style={s.pad}>
          <NoticeNote message={proposal.note} />
        </View>
      ) : null}

      {items.map((item) => {
        const label = changeLabel(item);
        const editing = proposed && open.has(item.id) && !item.locked;
        const needs = proposed && !item.locked ? needsOf(item) : [];
        const original = proposal.items.find((x) => x.id === item.id) ?? item;
        return (
          <View key={item.id} style={[s.item, proposed && !item.locked && !ticks[item.id] ? s.itemOff : null]}>
            {proposed && !item.locked ? <CheckRow label={label} checked={!!ticks[item.id] && needs.length === 0} disabled={busy || needs.length > 0} onChange={(v) => setTicks((t) => ({ ...t, [item.id]: v }))} /> : null}
            {proposed && item.locked ? <Text style={s.label}>{label}</Text> : null}
            <View style={s.kindRow}>
              <Badge label={KIND_BADGE[item.type]} tone="brand" />
              {proposed && !item.locked ? (
                <Button
                  title={editing ? 'Done editing' : 'Edit'}
                  variant="ghost"
                  size="sm"
                  onPress={() => toggleOpen(item.id)}
                  disabled={busy}
                  accessibilityLabel={`Edit ${label}`}
                />
              ) : null}
            </View>
            <RowSummary item={item} when={when} />
            {proposed && item.locked ? <Text style={s.problemText}>{`Can’t do: ${item.problem ?? 'this change can’t be made.'}`}</Text> : null}
            {needs.length ? <Text style={s.problemText}>{`Put right first: ${needs.map((n) => n.message).join(' ')}`}</Text> : null}
            {proposed && item.warning ? <Text style={s.warning}>{item.warning}</Text> : null}
            {editing ? <ProposalEditor item={item} onEdit={(patch, show) => edit(original, patch, show)} draftTime={times[item.id]} onDraftTime={(t) => setTimes((x) => ({ ...x, [item.id]: t }))} /> : null}
            {!proposed && item.result ? <ResultLine result={item.result} gone={!!item.undo?.gone} s={s} /> : null}
            {item.undo ? <Text style={item.undo.status === 'undone' || item.undo.status === 'started' ? s.muted : s.notUndone}>{undoLine(item.undo)}</Text> : null}
          </View>
        );
      })}

      <View style={s.footer}>
        {proposed && proposal.hasMeetings ? <Toggle label="Email the invitations" on={invite} onChange={setInvite} disabled={busy} /> : null}
        {controls.confirm || controls.cancel ? (
          <View style={s.buttons}>
            {controls.confirm ? (
              <Button
                title={busy && acting === 'confirm' ? 'Making the changes…' : confirmLabel(ticked)}
                onPress={() => void run('confirm', () => confirm(confirmBody(proposal.items, ticks, edits, invite)))}
                disabled={busy || ticked === 0 || !!badTime}
                accessibilityLabel={busy ? undefined : confirmA11y(ticked)}
              />
            ) : null}
            {controls.cancel ? <Button title="Cancel" variant="secondary" onPress={() => void run('cancel', cancel)} disabled={busy} /> : null}
          </View>
        ) : null}
        {proposed && badTime ? <Text style={s.problemText}>{badTime}</Text> : null}
        {proposed ? <Text style={s.quiet}>{FOOTER_NOTE}</Text> : null}
        {controls.footer ? <Text style={status === 'done' || status === 'undone' ? s.summary : s.muted}>{controls.footer}</Text> : null}
        {controls.undo ? (
          <Button
            title={busy && acting === 'undo' ? 'Undoing…' : undoButtonText(left)}
            variant="secondary"
            onPress={() => void run('undo', undo)}
            disabled={busy}
            accessibilityLabel="Undo these changes (open for 15 minutes)"
            style={s.start}
          />
        ) : null}
        {controls.undoGone ? <Text style={s.quiet}>Undo is no longer available.</Text> : null}
        {error ? <ErrorNote message={error} /> : null}
      </View>
      <Text accessibilityLiveRegion="polite" style={s.live}>
        {live}
      </Text>
    </View>
  );
}

type Styles = ReturnType<typeof makeStyles>;

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    card: { borderWidth: 1, borderColor: c.line, borderRadius: radius.card, backgroundColor: c.surface, overflow: 'hidden', ...shadow.soft },
    head: { backgroundColor: c.ground, borderBottomWidth: 1, borderBottomColor: c.line, paddingHorizontal: 14, paddingVertical: 10 },
    heading: { ...font('600', 'display'), fontSize: 14, lineHeight: 20, color: c.ink },
    pad: { paddingHorizontal: 14, paddingTop: spacing.sm },
    item: { gap: spacing.sm, paddingHorizontal: 14, paddingVertical: spacing.md, borderTopWidth: 1, borderTopColor: c.line },
    itemOff: { backgroundColor: c.surface2 },
    label: { ...typeStyle('bodyStrong'), color: c.ink2 },
    muted: { ...typeStyle('body'), color: c.ink2 },
    quiet: { ...typeStyle('caption'), color: c.ink3 },
    problemText: { ...typeStyle('body'), color: c.dangerText },
    problem: { ...typeStyle('body'), color: c.dangerText, backgroundColor: c.dangerSoft, borderRadius: radius.input, paddingHorizontal: 10, paddingVertical: 6, overflow: 'hidden' },
    notUndone: { ...typeStyle('body'), color: c.ink, backgroundColor: c.warningSoft, borderRadius: radius.input, paddingHorizontal: 10, paddingVertical: 6, overflow: 'hidden' },
    warning: { ...typeStyle('caption'), color: c.warningText },
    result: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm },
    kindRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
    footer: { gap: 10, paddingHorizontal: 14, paddingVertical: spacing.md, borderTopWidth: 1, borderTopColor: c.line },
    buttons: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    summary: { ...typeStyle('bodyStrong'), color: c.ink },
    start: { alignSelf: 'flex-start' },
    live: { position: 'absolute', left: 0, bottom: 0, width: 1, height: 1, overflow: 'hidden', color: c.surface },
  });
