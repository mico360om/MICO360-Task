import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Alert } from 'react-native';
import { useColors } from '../../core/theme';
import { TextField, Button } from '../ui';
import { KeyboardGroup } from '../KeyboardAware';
import { MentionSuggestions, MentionText, useMentionInput } from '../Mentions';
import { spacing, radius, fontSize, type Palette } from '../../lib/theme';
import { aiFailureText, moveBy } from '../../lib/task-detail';
import type { MentionPerson } from '../../lib/mentions';
import type { ApiChecklistItem } from '../../lib/types';
import { IconButton, SaveNote, SectionCard, relativeTime, useSave } from './kit';

// ── Description ──────────────────────────────────────────────────────────────
/** The description, edited in place (Save / Cancel). Empty, it offers to add one. */
export function DescriptionCard({ description, onSave }: { description: string | null; onSave?: (text: string) => Promise<unknown> }) {
  const c = useColors();
  const s = useMemo(() => makeStyles(c), [c]);
  const [draft, setDraft] = useState<string | null>(null);
  const save = useSave();
  async function commit() {
    if (draft === null) return;
    if (draft.trim() === (description ?? '').trim()) {
      setDraft(null);
      return;
    }
    if (await save.run(() => onSave?.(draft.trim()), 'Couldn’t save the description.', true)) setDraft(null);
  }
  return (
    <SectionCard title="Description" right={onSave && draft === null && description ? <IconButton glyph="✎" label="Edit description" onPress={() => { save.reset(); setDraft(description); }} /> : undefined}>
      {draft !== null ? (
        <KeyboardGroup style={{ gap: spacing.xs }}>
          <TextField value={draft} onChangeText={setDraft} multiline numberOfLines={4} accessibilityLabel="Description" placeholder="What needs doing, and how will we know it’s done?" autoFocus style={s.multiline} />
          <View style={s.row}>
            <Button title="Cancel" variant="ghost" onPress={() => { setDraft(null); save.reset(); }} style={s.flex} />
            <Button title="Save" accessibilityLabel="Save description" onPress={() => void commit()} loading={save.busy} style={s.flex} />
          </View>
        </KeyboardGroup>
      ) : description ? (
        <Text style={s.body}>{description}</Text>
      ) : onSave ? (
        <Pressable onPress={() => setDraft('')} accessibilityRole="button" accessibilityLabel="Add a description" style={s.dashed}>
          <Text style={s.dashedText}>✎ Add a description</Text>
        </Pressable>
      ) : (
        <Text style={s.muted}>No description.</Text>
      )}
      <SaveNote state={save.state} />
    </SectionCard>
  );
}

// ── Checklist ────────────────────────────────────────────────────────────────
function ChecklistRow({
  item,
  first,
  last,
  onToggle,
  onRename,
  onMove,
  onRemove,
}: {
  item: ApiChecklistItem;
  first: boolean;
  last: boolean;
  onToggle: () => void;
  onRename: (text: string) => Promise<unknown>;
  onMove: (delta: -1 | 1) => void;
  onRemove: () => void;
}) {
  const c = useColors();
  const s = useMemo(() => makeStyles(c), [c]);
  const [draft, setDraft] = useState<string | null>(null);
  const save = useSave();
  async function commit() {
    if (draft === null) return;
    const text = draft.trim();
    if (!text || text === item.text) {
      setDraft(null);
      return;
    }
    if (await save.run(() => onRename(text), 'Couldn’t rename the step.', true)) setDraft(null);
  }
  if (draft !== null) {
    return (
      <KeyboardGroup style={{ gap: spacing.xs }}>
        <TextField value={draft} onChangeText={setDraft} accessibilityLabel="Checklist item" autoFocus onSubmitEditing={() => void commit()} returnKeyType="done" />
        <View style={s.row}>
          <Button title="Cancel" variant="ghost" onPress={() => setDraft(null)} style={s.flex} />
          <Button title="Save" accessibilityLabel="Save step" onPress={() => void commit()} loading={save.busy} style={s.flex} />
        </View>
        <SaveNote state={save.state} />
      </KeyboardGroup>
    );
  }
  return (
    <View>
      <View style={s.item}>
        <Pressable
          onPress={onToggle}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: item.done }}
          accessibilityLabel={item.text}
          hitSlop={8}
          style={s.checkHit}
        >
          <View style={[s.checkbox, item.done && s.checkboxOn]}>{item.done ? <Text style={s.tick}>✓</Text> : null}</View>
        </Pressable>
        <Text style={[s.itemText, item.done && s.itemDone]}>{item.text}</Text>
        <IconButton glyph="↑" label={`Move “${item.text}” up`} onPress={() => onMove(-1)} disabled={first} />
        <IconButton glyph="↓" label={`Move “${item.text}” down`} onPress={() => onMove(1)} disabled={last} />
        <IconButton glyph="✎" label={`Edit “${item.text}”`} onPress={() => { save.reset(); setDraft(item.text); }} />
        <IconButton glyph="×" label={`Remove “${item.text}”`} onPress={onRemove} tone="danger" />
      </View>
      <SaveNote state={save.state} />
    </View>
  );
}

/**
 * The checklist: progress, ticking off, adding (pasted lines become separate items), renaming,
 * moving up/down, removing — and AI-suggested steps that are reviewed before any is added.
 */
export function ChecklistCard({
  items,
  onToggle,
  onAdd,
  onRename,
  onRemove,
  onReorder,
  onSuggest,
}: {
  items: ApiChecklistItem[];
  onToggle: (id: string, done: boolean) => Promise<unknown>;
  onAdd: (text: string) => Promise<unknown>;
  onRename: (id: string, text: string) => Promise<unknown>;
  onRemove: (id: string) => Promise<unknown>;
  onReorder: (orderedIds: string[]) => Promise<unknown>;
  onSuggest?: () => Promise<string[]>;
}) {
  const c = useColors();
  const s = useMemo(() => makeStyles(c), [c]);
  const save = useSave();
  const [newItem, setNewItem] = useState('');
  const [order, setOrder] = useState<string[] | null>(null);
  const [ticks, setTicks] = useState<Record<string, boolean>>({});
  const [suggestions, setSuggestions] = useState<{ text: string; on: boolean }[] | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [moved, setMoved] = useState('');
  useEffect(() => {
    setOrder(null);
    setTicks({});
  }, [items]);
  const withTicks = items.map((i) => (i.id in ticks ? { ...i, done: ticks[i.id]! } : i));
  const byId = new Map(withTicks.map((i) => [i.id, i]));
  const shown = order ? order.map((id) => byId.get(id)).filter((i): i is ApiChecklistItem => Boolean(i)) : withTicks;
  const doneNow = withTicks.filter((i) => i.done).length;
  const pct = withTicks.length ? Math.round((doneNow / withTicks.length) * 100) : 0;

  async function addAll(texts: string[]) {
    for (const text of texts) {
      if (!(await save.run(() => onAdd(text), 'Couldn’t add the step.', true))) return false;
    }
    return true;
  }
  async function addTyped(raw: string) {
    const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) return;
    if (await addAll(lines)) setNewItem('');
  }
  function move(id: string, delta: -1 | 1) {
    const ids = shown.map((i) => i.id);
    const next = moveBy(ids, id, delta);
    if (!next) return;
    setOrder(next);
    const item = byId.get(id);
    setMoved(`“${item?.text ?? ''}” moved to position ${next.indexOf(id) + 1} of ${next.length}.`);
    void save.run(() => onReorder(next), 'Couldn’t reorder the checklist.').then((ok) => {
      if (!ok) setOrder(null);
    });
  }
  function toggle(item: ApiChecklistItem) {
    const next = !item.done;
    setTicks((t) => ({ ...t, [item.id]: next }));
    void save.run(() => onToggle(item.id, next), 'Couldn’t update the step.', true).then((ok) => {
      if (!ok) setTicks((t) => Object.fromEntries(Object.entries(t).filter(([k]) => k !== item.id)));
    });
  }
  function confirmRemove(item: ApiChecklistItem) {
    Alert.alert('Remove step?', `“${item.text}” will be removed from the checklist.`, [
      { text: 'Keep', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => void save.run(() => onRemove(item.id), 'Couldn’t remove the step.') },
    ]);
  }
  async function suggest() {
    if (!onSuggest) return;
    setSuggesting(true);
    save.reset();
    try {
      const steps = await onSuggest();
      if (steps.length === 0) save.fail('The AI had no steps to suggest for this task.');
      else setSuggestions(steps.map((text) => ({ text, on: true })));
    } catch (e) {
      save.fail(aiFailureText(e, 'The AI suggestion failed.'));
    } finally {
      setSuggesting(false);
    }
  }
  const picked = suggestions?.filter((x) => x.on) ?? [];

  return (
    <SectionCard
      title="Checklist"
      right={
        onSuggest ? (
          <Pressable onPress={() => void suggest()} disabled={suggesting} accessibilityRole="button" accessibilityLabel="Suggest steps with AI" style={s.aiBtn}>
            <Text style={s.aiText}>{suggesting ? 'Thinking…' : '✨ Suggest steps · AI'}</Text>
          </Pressable>
        ) : undefined
      }
    >
      {withTicks.length > 0 ? (
        <View style={s.progressRow} accessibilityLabel={`Checklist progress: ${doneNow} of ${withTicks.length} done`}>
          <Text style={s.count}>{`${doneNow} of ${withTicks.length} done`}</Text>
          <View style={s.bar} importantForAccessibility="no-hide-descendants">
            <View style={[s.barFill, { width: `${pct}%`, backgroundColor: pct === 100 ? c.success : c.brand }]} />
          </View>
          <Text style={s.count}>{pct}%</Text>
        </View>
      ) : null}
      {suggestions ? (
        <View style={s.review} accessibilityLabel="Suggested steps">
          <Text style={s.reviewTitle}>✨ AI suggestions — choose which to add</Text>
          {suggestions.map((x, i) => (
            <Pressable
              key={`${i}-${x.text}`}
              onPress={() => setSuggestions((all) => all!.map((y, j) => (j === i ? { ...y, on: !y.on } : y)))}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: x.on }}
              accessibilityLabel={x.text}
              style={s.reviewRow}
            >
              <View style={[s.checkbox, x.on && s.checkboxOn]}>{x.on ? <Text style={s.tick}>✓</Text> : null}</View>
              <Text style={s.itemText}>{x.text}</Text>
            </Pressable>
          ))}
          <View style={s.row}>
            <Button
              title={`Add ${picked.length} ${picked.length === 1 ? 'step' : 'steps'}`}
              disabled={picked.length === 0}
              onPress={() => void addAll(picked.map((x) => x.text)).then((ok) => ok && setSuggestions(null))}
              style={s.flex}
            />
            <Button title="Discard" variant="ghost" onPress={() => setSuggestions(null)} style={s.flex} />
          </View>
        </View>
      ) : null}
      <Text accessibilityLiveRegion="polite" style={s.srOnly}>
        {moved}
      </Text>
      {shown.length === 0 ? (
        <Text style={s.muted}>No steps yet — break the work down below.</Text>
      ) : (
        shown.map((it, i) => (
          <ChecklistRow
            key={it.id}
            item={it}
            first={i === 0}
            last={i === shown.length - 1}
            onToggle={() => toggle(it)}
            onRename={(text) => onRename(it.id, text)}
            onMove={(delta) => move(it.id, delta)}
            onRemove={() => confirmRemove(it)}
          />
        ))
      )}
      <SaveNote state={save.state} />
      <KeyboardGroup style={s.addRow}>
        <View style={s.flex}>
          <TextField
            value={newItem}
            onChangeText={(v) => {
              // Pasted lines become one step each.
              if (/\n/.test(v)) void addTyped(v);
              else setNewItem(v);
            }}
            placeholder="Add an item…"
            accessibilityLabel="Add a checklist item"
            onSubmitEditing={() => void addTyped(newItem)}
            blurOnSubmit={false}
            returnKeyType="done"
          />
        </View>
        <Button title="Add" accessibilityLabel="Add item" onPress={() => void addTyped(newItem)} disabled={!newItem.trim()} />
      </KeyboardGroup>
    </SectionCard>
  );
}

// ── Comments ─────────────────────────────────────────────────────────────────
export interface CommentView {
  id: string;
  body: string;
  authorName: string;
  createdAt: string;
  edited: boolean;
  mine: boolean;
  canDelete: boolean;
}

function CommentRow({ cm, people, onEdit, onDelete }: { cm: CommentView; people: MentionPerson[]; onEdit: (body: string) => Promise<unknown>; onDelete: () => Promise<unknown> }) {
  const c = useColors();
  const s = useMemo(() => makeStyles(c), [c]);
  const [draft, setDraft] = useState<string | null>(null);
  const save = useSave();
  return (
    <View style={s.comment}>
      <View style={s.commentHead}>
        <Text style={s.author}>{cm.authorName}</Text>
        <Text style={s.when}>{relativeTime(cm.createdAt)}</Text>
        {cm.edited ? <Text style={s.when}>(edited)</Text> : null}
        <View style={s.flex} />
        {draft === null && cm.mine ? <IconButton glyph="✎" label="Edit your comment" onPress={() => { save.reset(); setDraft(cm.body); }} /> : null}
        {draft === null && cm.canDelete ? (
          <IconButton
            glyph="🗑"
            label={cm.mine ? 'Delete your comment' : `Delete comment by ${cm.authorName}`}
            tone="danger"
            onPress={() =>
              Alert.alert('Delete comment?', 'This can’t be undone.', [
                { text: 'Keep', style: 'cancel' },
                { text: 'Delete', style: 'destructive', onPress: () => void save.run(onDelete, 'Couldn’t delete the comment.') },
              ])
            }
          />
        ) : null}
      </View>
      {draft === null ? (
        <MentionText style={s.body} body={cm.body} people={people} />
      ) : (
        <KeyboardGroup style={{ gap: spacing.xs }}>
          <TextField value={draft} onChangeText={setDraft} multiline accessibilityLabel="Edit comment" autoFocus />
          <View style={s.row}>
            <Button title="Cancel" variant="ghost" onPress={() => setDraft(null)} style={s.flex} />
            <Button
              title="Save"
              accessibilityLabel="Save comment"
              disabled={!draft.trim()}
              loading={save.busy}
              onPress={() => void save.run(() => onEdit(draft.trim()), 'Couldn’t save the comment.').then((ok) => ok && setDraft(null))}
              style={s.flex}
            />
          </View>
        </KeyboardGroup>
      )}
      <SaveNote state={save.state} />
    </View>
  );
}

/** Comments with author, time and "(edited)"; your own can be edited or deleted; @mentions suggested. */
export function CommentsCard({
  comments,
  pending,
  people,
  onAdd,
  onEdit,
  onDelete,
}: {
  comments: CommentView[];
  pending: string[];
  people: MentionPerson[];
  onAdd: (body: string) => Promise<unknown>;
  onEdit: (id: string, body: string) => Promise<unknown>;
  onDelete: (id: string) => Promise<unknown>;
}) {
  const c = useColors();
  const s = useMemo(() => makeStyles(c), [c]);
  const [draft, setDraft] = useState('');
  const save = useSave();
  const mention = useMentionInput(draft, setDraft, people);
  async function send() {
    const body = draft.trim();
    if (!body) return;
    // The text stays until the server has it, or it is safely queued to send when online.
    if (await save.run(() => onAdd(body), 'Your comment was not posted. Please try again.', true)) setDraft('');
  }
  return (
    <SectionCard title={`Comments${comments.length ? ` · ${comments.length}` : ''}`}>
      {comments.length === 0 && pending.length === 0 ? <Text style={s.muted}>No comments yet. Start the conversation.</Text> : null}
      {comments.map((cm) => (
        <CommentRow key={cm.id} cm={cm} people={people} onEdit={(body) => onEdit(cm.id, body)} onDelete={() => onDelete(cm.id)} />
      ))}
      {pending.map((body, i) => (
        <View key={`p${i}`} style={[s.comment, s.pending]} accessibilityLabel={`Sending when online: ${body}`}>
          <Text style={s.body}>{body}</Text>
          <Text style={s.when}>Sending when you’re back online…</Text>
        </View>
      ))}
      {/* Typing keeps the suggestions, the box and Send above the keyboard. */}
      <KeyboardGroup style={{ gap: spacing.sm }}>
        <MentionSuggestions menu={mention.menu} onPick={mention.pick} noMatchText={(query) => `No one on this project matches “@${query}”.`} />
        <View style={s.addRow}>
          <View style={s.flex}>
            <TextField
              inputRef={mention.inputRef}
              onSelectionChange={mention.onSelectionChange}
              value={draft}
              onChangeText={(v) => {
                setDraft(v);
                if (save.state.status === 'error') save.reset();
              }}
              placeholder="Write a comment… use @name to mention"
              accessibilityLabel="New comment"
              multiline
            />
          </View>
          <Button title="Send" accessibilityLabel="Send comment" onPress={() => void send()} loading={save.busy} disabled={!draft.trim()} />
        </View>
      </KeyboardGroup>
      <SaveNote state={save.state} />
    </SectionCard>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    row: { flexDirection: 'row', gap: spacing.sm },
    flex: { flex: 1 },
    body: { fontSize: fontSize.md, color: c.ink, lineHeight: 22 },
    muted: { fontSize: fontSize.sm, color: c.ink3 },
    multiline: { minHeight: 96, textAlignVertical: 'top', paddingTop: spacing.sm },
    dashed: { minHeight: 48, justifyContent: 'center', paddingHorizontal: spacing.md, borderRadius: radius.md, borderWidth: 1, borderStyle: 'dashed', borderColor: c.line },
    dashedText: { fontSize: fontSize.sm, color: c.ink2, fontWeight: '600' },
    aiBtn: { minHeight: 36, paddingHorizontal: spacing.sm, borderRadius: radius.pill, borderWidth: 1, borderColor: c.brand, justifyContent: 'center', backgroundColor: c.brandWash },
    aiText: { fontSize: fontSize.xs, fontWeight: '800', color: c.brand },
    progressRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    count: { fontSize: fontSize.xs, fontWeight: '700', color: c.ink2 },
    bar: { flex: 1, height: 8, backgroundColor: c.line, borderRadius: radius.pill, overflow: 'hidden' },
    barFill: { height: 8 },
    item: { flexDirection: 'row', alignItems: 'center', minHeight: 48 },
    checkHit: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
    checkbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: c.ink3, alignItems: 'center', justifyContent: 'center' },
    checkboxOn: { borderColor: c.brand, backgroundColor: c.brand },
    tick: { color: c.onBrand, fontSize: 14, fontWeight: '900', lineHeight: 16 },
    itemText: { flex: 1, fontSize: fontSize.md, color: c.ink },
    itemDone: { color: c.ink3, textDecorationLine: 'line-through' },
    review: { gap: spacing.xs, padding: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: c.brand, backgroundColor: c.brandWash },
    reviewTitle: { fontSize: fontSize.sm, fontWeight: '800', color: c.brand },
    reviewRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 44 },
    srOnly: { position: 'absolute', width: 1, height: 1, opacity: 0 },
    addRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
    comment: { borderWidth: 1, borderColor: c.line, borderRadius: radius.md, padding: spacing.sm, backgroundColor: c.ground, gap: 2 },
    pending: { opacity: 0.7, borderStyle: 'dashed' },
    commentHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, minHeight: 44 },
    author: { fontSize: fontSize.sm, fontWeight: '800', color: c.ink },
    when: { fontSize: fontSize.xs, color: c.ink3 },
  });
