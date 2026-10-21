import React, { memo, useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Image, Modal, Linking, ActivityIndicator, TextInput, type AccessibilityActionEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '../../core/theme';
import { MentionText } from '../Mentions';
import { ActionRowButton, Sheet, SheetButtons, SheetMessage } from '../meeting/sheet-kit';
import { attachmentHref } from '../../lib/attachments';
import { messageActions, reactionLabel, type MessageActionSet } from '../../lib/chat-actions';
import { formatSize } from '../../lib/chat-model';
import { linkParts } from '../../lib/chat-ui';
import { EMOJI_GROUPS, QUICK_REACTIONS, searchEmoji } from '../../lib/emoji';
import type { ThreadMessage } from '../../lib/chat-timeline';
import type { MentionPerson } from '../../lib/mentions';
import { spacing, radius, fontSize, type Palette } from '../../lib/theme';
import type { ApiChatAttachment, ReactionGroup } from '../../lib/types';

/**
 * A message in the thread (3b), as the website shows it: the answered message's quote (tap to show
 * it), the words (mentions and web addresses marked), pictures and files, "Edited", the time and —
 * on my own — where it stands (✓ sent, ✓✓ delivered, read or seen by N), and its reactions. A
 * deleted message is a tombstone. A long press (or TalkBack's actions) offers react, reply, copy,
 * edit and delete. Messages and files still on their way say so, with Retry and Discard.
 */

export function useChatStyles() {
  const c = useColors();
  return { c, s: useMemo(() => makeStyles(c), [c]) };
}

export function clockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** A day's line ("Today", "Yesterday", "Mon, Oct 12"). */
export function DayLine({ label }: { label: string }) {
  const { s } = useChatStyles();
  return (
    <View style={s.dayWrap} accessibilityRole="header" accessible accessibilityLabel={label}>
      <Text style={s.day}>{label}</Text>
    </View>
  );
}

/** Where the unread messages start. */
export function UnreadLine() {
  const { c, s } = useChatStyles();
  return (
    <View style={s.unreadWrap} accessible accessibilityLabel="New messages start here">
      <View style={[s.unreadRule, { backgroundColor: c.danger }]} />
      <Text style={[s.unreadText, { color: c.danger }]}>New</Text>
      <View style={[s.unreadRule, { backgroundColor: c.danger }]} />
    </View>
  );
}

/**
 * Words with mentions marked and web addresses that open in the browser. A long press on a link
 * still offers the message's actions; TalkBack opens links from the message's actions (messageLinks).
 */
function Body({ text, people, mine, style, onLongPress }: { text: string; people: MentionPerson[]; mine: boolean; style: object; onLongPress?: () => void }) {
  const { c } = useChatStyles();
  const parts = linkParts(text);
  if (parts.length === 1 && !parts[0]!.url) return <MentionText style={style} body={text} people={people} onBrand={mine} />;
  return (
    <Text style={style}>
      {parts.map((p, i) =>
        p.url ? (
          <Text key={i} style={{ color: mine ? c.onBrand : c.brand, textDecorationLine: 'underline' }} onPress={() => void Linking.openURL(p.url!)} onLongPress={onLongPress}>
            {p.text}
          </Text>
        ) : (
          <MentionText key={i} body={p.text} people={people} onBrand={mine} />
        ),
      )}
    </Text>
  );
}

/** The web addresses in a message, each once (opened from TalkBack's actions and the actions sheet). */
export function messageLinks(text: string): string[] {
  return [...new Set(linkParts(text).flatMap((p) => (p.url ? [p.url] : [])))];
}

export interface BubbleHandlers {
  onActions: (m: ThreadMessage) => void;
  onAction: (m: ThreadMessage, action: 'react' | 'reply' | 'copy' | 'edit' | 'delete') => void;
  onReact: (m: ThreadMessage, emoji: string) => void;
  onWhoReacted: (r: ReactionGroup) => void;
  onJump: (messageId: string) => void;
  onOpenImage: (a: ApiChatAttachment) => void;
  onRetry: (queueId: string) => void;
  onDiscard: (queueId: string) => void;
  onEditUnsent: (queueId: string, body: string) => void;
  onRetryUpload: (key: string) => void;
  onDiscardUpload: (key: string) => void;
}

/** One message in the thread. Memoized: a new message doesn't redraw the rest. */
export const MessageBubble = memo(function MessageBubble({
  m,
  mine,
  groupStart,
  authorName,
  people,
  myId,
  isAdmin,
  nameOf,
  receiptLabel,
  receiptTicks,
  highlighted,
  baseUrl,
  handlers,
}: {
  m: ThreadMessage;
  mine: boolean;
  groupStart: boolean;
  authorName: string;
  people: MentionPerson[];
  myId: string;
  isAdmin: boolean;
  nameOf: (userId: string) => string;
  /** Where my message stands, for TalkBack ("Delivered") and as ticks. */
  receiptLabel?: string;
  receiptTicks?: string;
  highlighted: boolean;
  baseUrl: string;
  handlers: BubbleHandlers;
}) {
  const { c, s } = useChatStyles();
  const actions = messageActions(m, { myId, isAdmin });
  const receipt = receiptLabel ? { label: receiptLabel, ticks: receiptTicks ?? '' } : undefined;
  const deleted = !!m.deletedAt;
  const text = deleted ? '' : m.body;
  const time = clockTime(m.createdAt);
  const files = deleted ? [] : m.attachments ?? [];
  const upload = m.upload;
  const outbox = m.outbox;
  const quote = m.replyTo;
  const filesOnly = !deleted && !text.trim() && !quote && (files.length > 0 || !!upload);
  const quoteText = quote ? (quote.deleted ? 'This message was deleted.' : quote.body.replace(/\s+/g, ' ')) : '';
  const state = outbox
    ? outbox.state === 'sending'
      ? 'Sending…'
      : outbox.state === 'waiting'
        ? 'Waiting for connection'
        : outbox.state === 'unanswered'
          ? 'Not answered yet — trying again'
          : `Not sent — ${outbox.reason ?? ''}`
    : upload
      ? upload.state === 'sending'
        ? `Sending ${Math.round(upload.progress * 100)}%`
        : `Not sent — ${upload.error ?? ''}`
      : null;

  const said = [
    `${mine ? 'You' : authorName}, ${time}`,
    m.editedAt && !deleted ? 'edited' : null,
    quote ? `reply to ${nameOf(quote.userId)}: ${quoteText}` : null,
    deleted ? 'This message was deleted.' : text ? `${text}` : null,
    files.length ? `${files.length === 1 ? 'a file' : `${files.length} files`}: ${files.map((f) => f.fileName).join(', ')}` : null,
    upload ? `file ${upload.name}` : null,
    receipt?.label ?? null,
    state,
  ]
    .filter(Boolean)
    .join('. ');
  // The message's web addresses: TalkBack opens each from its actions (a link inside the message
  // isn't a focus stop of its own).
  const links = deleted ? [] : messageLinks(text);
  const a11yActions = [
    ...(actions.react ? [{ name: 'react', label: 'React' }] : []),
    ...(actions.reply ? [{ name: 'reply', label: 'Reply' }] : []),
    ...(actions.copy ? [{ name: 'copy', label: 'Copy text' }] : []),
    ...(actions.edit ? [{ name: 'edit', label: 'Edit' }] : []),
    ...(actions.remove ? [{ name: 'delete', label: 'Delete' }] : []),
    ...links.map((url, i) => ({ name: `link-${i}`, label: `Open link ${url.replace(/^https?:\/\//, '').slice(0, 40)}` })),
  ];
  const anyAction = a11yActions.length > 0;
  const onA11y = (e: AccessibilityActionEvent) => {
    const name = e.nativeEvent.actionName;
    if (name.startsWith('link-')) {
      const url = links[Number(name.slice(5))];
      if (url) void Linking.openURL(url);
      return;
    }
    handlers.onAction(m, name as 'react' | 'reply' | 'copy' | 'edit' | 'delete');
  };

  const bubbleTone = mine ? { backgroundColor: c.brand, borderColor: c.brand } : { backgroundColor: c.surface, borderColor: c.line };
  const ink = mine ? c.onBrand : c.ink;
  const quiet = mine ? c.onBrand : c.ink2;
  const failed = outbox?.state === 'failed' || upload?.state === 'failed';

  return (
    <View style={[s.msg, mine ? s.mine : s.theirs, groupStart ? s.groupStart : null, highlighted && { backgroundColor: c.brandWash }]}>
      {groupStart && !mine ? (
        <Text style={s.author} numberOfLines={1}>
          {authorName}
        </Text>
      ) : null}
      {deleted ? (
        <View style={[s.bubble, s.tombstone, { borderColor: c.line }]} accessible accessibilityLabel={said}>
          <Text style={s.tombstoneText}>This message was deleted.</Text>
        </View>
      ) : filesOnly ? null : (
        <View style={[s.bubble, bubbleTone, (outbox || upload) && !failed ? s.pending : null, failed ? { borderColor: c.danger, borderWidth: 2 } : null]}>
          {quote ? (
            <Pressable
              onPress={() => handlers.onJump(quote.id)}
              style={[s.quote, { borderLeftColor: mine ? c.onBrand : c.brand, backgroundColor: mine ? 'rgba(0,0,0,0.15)' : c.ground }]}
              accessibilityRole="button"
              accessibilityLabel={`Reply to ${nameOf(quote.userId)}: ${quoteText} — show that message`}
            >
              <Text style={[s.quoteWho, { color: ink }]} numberOfLines={1}>
                {nameOf(quote.userId)}
              </Text>
              <Text style={[s.quoteText, { color: quiet }, quote.deleted && s.italic]} numberOfLines={2}>
                {quoteText}
              </Text>
            </Pressable>
          ) : null}
          <Pressable
            onLongPress={anyAction ? () => handlers.onActions(m) : undefined}
            delayLongPress={350}
            accessible
            accessibilityLabel={said}
            accessibilityHint={anyAction ? 'Long press for reactions, reply and more.' : undefined}
            accessibilityActions={a11yActions}
            onAccessibilityAction={anyAction ? onA11y : undefined}
          >
            {text ? <Body text={text} people={people} mine={mine} style={[s.body, { color: ink }]} onLongPress={anyAction ? () => handlers.onActions(m) : undefined} /> : null}
            <View style={s.meta}>
              {m.editedAt ? <Text style={[s.metaText, { color: quiet }]}>Edited ·</Text> : null}
              <Text style={[s.metaText, { color: quiet }]}>{time}</Text>
              {receipt?.ticks ? <Text style={[s.metaText, { color: receipt.label.startsWith('Read') || receipt.label.startsWith('Seen') ? (mine ? '#BDE3FF' : c.info) : quiet }]}>{receipt.ticks}</Text> : null}
            </View>
          </Pressable>
        </View>
      )}

      {files.length ? (
        <View style={[s.files, mine ? s.alignEnd : null]}>
          {files.map((f) =>
            f.mimeType.startsWith('image/') ? (
              <Pressable key={f.id} onPress={() => handlers.onOpenImage(f)} onLongPress={anyAction ? () => handlers.onActions(m) : undefined} accessibilityRole="imagebutton" accessibilityLabel={`Open picture ${f.fileName}`}>
                <Image source={{ uri: attachmentHref(baseUrl, f.url) }} style={[s.picture, { borderColor: c.line }]} resizeMode="cover" accessibilityIgnoresInvertColors />
              </Pressable>
            ) : (
              <Pressable
                key={f.id}
                style={[s.file, { borderColor: c.line, backgroundColor: c.surface }]}
                onPress={() => void Linking.openURL(attachmentHref(baseUrl, f.url))}
                onLongPress={anyAction ? () => handlers.onActions(m) : undefined}
                accessibilityRole="button"
                accessibilityLabel={`Open file ${f.fileName}, ${formatSize(f.sizeBytes)}`}
              >
                <Text style={s.fileIcon}>📄</Text>
                <View style={s.grow}>
                  <Text style={s.fileName} numberOfLines={1}>
                    {f.fileName}
                  </Text>
                  <Text style={s.fileSize}>{formatSize(f.sizeBytes)}</Text>
                </View>
              </Pressable>
            ),
          )}
        </View>
      ) : null}
      {upload ? (
        <View style={[s.file, s.alignEnd, { borderColor: c.line, backgroundColor: c.surface }]}>
          <Text style={s.fileIcon}>{upload.type.startsWith('image/') ? '🖼️' : '📄'}</Text>
          <View style={s.grow}>
            <Text style={s.fileName} numberOfLines={1}>
              {upload.name}
            </Text>
            {upload.size !== null ? <Text style={s.fileSize}>{formatSize(upload.size)}</Text> : null}
            {upload.state === 'sending' ? (
              <View style={[s.progress, { backgroundColor: c.line }]} accessibilityRole="progressbar" accessibilityLabel={`Uploading ${upload.name}`} accessibilityValue={{ min: 0, max: 100, now: Math.round(upload.progress * 100) }}>
                <View style={{ width: `${Math.max(4, Math.round(upload.progress * 100))}%`, height: '100%', backgroundColor: c.brand }} />
              </View>
            ) : null}
          </View>
        </View>
      ) : null}

      {filesOnly ? (
        // A file without words: no empty bubble, just its time (and ticks) beside the file — as on the website.
        <Pressable
          onLongPress={anyAction ? () => handlers.onActions(m) : undefined}
          delayLongPress={350}
          style={[s.meta, s.metaAlone, mine ? s.alignEnd : null]}
          accessible
          accessibilityLabel={said}
          accessibilityHint={anyAction ? 'Long press for reactions, reply and more.' : undefined}
          accessibilityActions={a11yActions}
          onAccessibilityAction={anyAction ? onA11y : undefined}
        >
          <Text style={[s.metaText, { color: c.ink2 }]}>{time}</Text>
          {receipt?.ticks ? <Text style={[s.metaText, { color: receipt.label.startsWith('Read') || receipt.label.startsWith('Seen') ? c.info : c.ink2 }]}>{receipt.ticks}</Text> : null}
        </Pressable>
      ) : null}

      {!deleted && (m.reactions ?? []).length ? (
        <View style={[s.reactions, mine ? s.alignEnd : null]}>
          {(m.reactions ?? []).map((r) => {
            const mineToo = r.userIds.includes(myId);
            return (
              <Pressable
                key={r.emoji}
                onPress={() => handlers.onReact(m, r.emoji)}
                onLongPress={() => handlers.onWhoReacted(r)}
                disabled={!actions.react}
                style={[s.chip, { borderColor: mineToo ? c.brand : c.line, backgroundColor: mineToo ? c.brandWash : c.surface }]}
                accessibilityRole="button"
                accessibilityState={{ selected: mineToo, disabled: !actions.react }}
                accessibilityLabel={reactionLabel(r, myId, nameOf)}
              >
                <Text style={s.chipEmoji}>{r.emoji}</Text>
                <Text style={[s.chipCount, { color: mineToo ? c.brand : c.ink2 }]}>{r.userIds.length}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      {state ? (
        <Text style={[s.state, failed ? { color: c.danger, fontWeight: '700' } : null, mine ? s.textEnd : null]} accessibilityLiveRegion="polite">
          {state}
        </Text>
      ) : null}
      {outbox && (outbox.state === 'failed' || outbox.canDiscard) ? (
        <View style={[s.outboxActions, s.alignEnd]}>
          {outbox.state === 'failed' ? (
            <Pressable style={s.smallBtn} onPress={() => handlers.onRetry(outbox.queueId)} accessibilityRole="button" accessibilityLabel={`Retry sending “${outbox.body.slice(0, 40)}”`}>
              <Text style={[s.smallBtnText, { color: c.brand }]}>Retry</Text>
            </Pressable>
          ) : null}
          {outbox.state === 'failed' && outbox.body ? (
            <Pressable style={s.smallBtn} onPress={() => handlers.onEditUnsent(outbox.queueId, outbox.body)} accessibilityRole="button" accessibilityLabel={`Edit “${outbox.body.slice(0, 40)}” and send it again`}>
              <Text style={s.smallBtnText}>Edit</Text>
            </Pressable>
          ) : null}
          <Pressable style={s.smallBtn} onPress={() => handlers.onDiscard(outbox.queueId)} accessibilityRole="button" accessibilityLabel={`Discard “${outbox.body.slice(0, 40)}”`}>
            <Text style={s.smallBtnText}>Discard</Text>
          </Pressable>
        </View>
      ) : null}
      {upload?.state === 'failed' ? (
        <View style={[s.outboxActions, s.alignEnd]}>
          <Pressable style={s.smallBtn} onPress={() => handlers.onRetryUpload(upload.key)} accessibilityRole="button" accessibilityLabel={`Retry sending ${upload.name}`}>
            <Text style={[s.smallBtnText, { color: c.brand }]}>Retry</Text>
          </Pressable>
          <Pressable style={s.smallBtn} onPress={() => handlers.onDiscardUpload(upload.key)} accessibilityRole="button" accessibilityLabel={`Discard ${upload.name}`}>
            <Text style={s.smallBtnText}>Discard</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
});

/** A searchable grid of the chat's emoji (the website's picker). */
function EmojiGrid({ onPick }: { onPick: (emoji: string) => void }) {
  const { c, s } = useChatStyles();
  const [q, setQ] = useState('');
  const found = useMemo(() => searchEmoji(q), [q]);
  return (
    <View style={s.grid}>
      <TextInput style={[s.emojiSearch, { borderColor: c.line, color: c.ink }]} value={q} onChangeText={setQ} placeholder="Search emoji" placeholderTextColor={c.ink3} accessibilityLabel="Search emoji" autoCorrect={false} />
      {found.length === 0 ? <Text style={s.hint}>No emoji match “{q.trim()}”.</Text> : null}
      {EMOJI_GROUPS.map((group) => {
        const list = found.filter((e) => e.group === group);
        if (!list.length) return null;
        return (
          <View key={group}>
            <Text style={s.groupTitle}>{group.toUpperCase()}</Text>
            <View style={s.gridRow}>
              {list.map((e) => (
                <Pressable key={e.char} style={s.emojiBtn} onPress={() => onPick(e.char)} accessibilityRole="button" accessibilityLabel={`React with ${e.char}, ${e.words.split(' ')[0]}`}>
                  <Text style={s.emojiText}>{e.char}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        );
      })}
    </View>
  );
}

/** A message's actions (long press): the quick reactions and more emoji, reply, copy, edit, delete. */
export function MessageActionsSheet({
  visible,
  actions,
  links = [],
  onReact,
  onAction,
  onClose,
}: {
  visible: boolean;
  actions: MessageActionSet | null;
  /** The message's web addresses, each with an "Open link" row. */
  links?: string[];
  onReact: (emoji: string) => void;
  onAction: (action: 'reply' | 'copy' | 'edit' | 'delete') => void;
  onClose: () => void;
}) {
  const { s } = useChatStyles();
  const [more, setMore] = useState(false);
  const close = () => {
    setMore(false);
    onClose();
  };
  const pick = (emoji: string) => {
    setMore(false);
    onReact(emoji);
  };
  return (
    <Sheet visible={visible} title="Message" onClose={close} footer={<SheetButtons cancel="Close" onCancel={close} />}>
      {actions?.react ? (
        <>
          <View style={s.quickRow} accessibilityLabel="Add a reaction">
            {QUICK_REACTIONS.map((e) => (
              <Pressable key={e} style={s.emojiBtn} onPress={() => pick(e)} accessibilityRole="button" accessibilityLabel={`React with ${e}`}>
                <Text style={s.emojiText}>{e}</Text>
              </Pressable>
            ))}
            <Pressable style={[s.emojiBtn, s.moreBtn]} onPress={() => setMore((m) => !m)} accessibilityRole="button" accessibilityLabel="More emoji" accessibilityState={{ expanded: more }}>
              <Text style={s.moreText}>＋</Text>
            </Pressable>
          </View>
          {more ? <EmojiGrid onPick={pick} /> : null}
        </>
      ) : null}
      {actions?.reply ? <ActionRowButton label="Reply" onPress={() => onAction('reply')} /> : null}
      {links.map((url) => (
        <ActionRowButton
          key={url}
          label={`Open link: ${url.replace(/^https?:\/\//, '').slice(0, 48)}`}
          onPress={() => {
            close();
            void Linking.openURL(url);
          }}
        />
      ))}
      {actions?.copy ? <ActionRowButton label="Copy text" onPress={() => onAction('copy')} /> : null}
      {actions?.edit ? <ActionRowButton label="Edit" onPress={() => onAction('edit')} /> : null}
      {actions?.remove ? <ActionRowButton label="Delete" danger onPress={() => onAction('delete')} /> : null}
    </Sheet>
  );
}

/** Editing one of my messages (Save / Cancel); it stays open when the edit wasn't saved. */
export function EditMessageSheet({
  visible,
  initial,
  busy,
  error,
  note,
  onSave,
  onClose,
}: {
  visible: boolean;
  initial: string;
  busy: boolean;
  error: string | null;
  note: string | null;
  onSave: (body: string) => void;
  onClose: () => void;
}) {
  const { c, s } = useChatStyles();
  const [body, setBody] = useState(initial);
  const [shownFor, setShownFor] = useState(initial);
  if (shownFor !== initial) {
    setShownFor(initial);
    setBody(initial);
  }
  const length = body.trim().length;
  return (
    <Sheet
      visible={visible}
      title="Edit message"
      onClose={onClose}
      footer={<SheetButtons onCancel={onClose} confirm={busy ? 'Saving…' : 'Save'} onConfirm={() => onSave(body)} busy={busy} disabled={length === 0 || length > 4000} />}
    >
      <TextInput
        style={[s.editBox, { borderColor: length > 4000 ? c.danger : c.line, color: c.ink }]}
        value={body}
        onChangeText={setBody}
        multiline
        autoFocus
        accessibilityLabel="Edit message"
        maxLength={4100}
      />
      {length > 3500 ? (
        <Text style={[s.hint, length > 4000 && { color: c.danger, fontWeight: '700' }]} accessibilityLiveRegion="polite">
          {length.toLocaleString()} / 4,000
        </Text>
      ) : null}
      <SheetMessage text={note} tone="info" />
      <SheetMessage text={error} />
    </Sheet>
  );
}

/** A picture from the conversation, full size, with a way to open (or save) it. */
export function ImageViewer({ attachment, baseUrl, onClose }: { attachment: ApiChatAttachment | null; baseUrl: string; onClose: () => void }) {
  const { s } = useChatStyles();
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  if (!attachment) return null;
  const url = attachmentHref(baseUrl, attachment.url);
  return (
    <Modal visible transparent={false} animationType="fade" onRequestClose={onClose}>
      <View style={[s.viewer, { paddingTop: insets.top, paddingBottom: insets.bottom }]} accessibilityViewIsModal>
        <View style={s.viewerBar}>
          <Text style={s.viewerName} numberOfLines={1}>
            {attachment.fileName}
          </Text>
          <Pressable style={s.viewerBtn} onPress={() => void Linking.openURL(url)} accessibilityRole="button" accessibilityLabel={`Open ${attachment.fileName} in another app to save or share it`}>
            <Text style={s.viewerBtnText}>Open</Text>
          </Pressable>
          <Pressable style={s.viewerBtn} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close">
            <Text style={s.viewerBtnText}>✕</Text>
          </Pressable>
        </View>
        <View style={s.viewerBody}>
          {loading ? <ActivityIndicator color="#fff" style={s.viewerSpinner} /> : null}
          <Image source={{ uri: url }} style={s.viewerImage} resizeMode="contain" onLoadEnd={() => setLoading(false)} accessibilityLabel={attachment.fileName} accessibilityIgnoresInvertColors />
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    dayWrap: { alignItems: 'center', marginVertical: spacing.sm },
    day: { fontSize: fontSize.xs, fontWeight: '700', color: c.ink2, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 2, overflow: 'hidden' },
    unreadWrap: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginVertical: spacing.xs },
    unreadRule: { flex: 1, height: 1 },
    unreadText: { fontSize: fontSize.xs, fontWeight: '700' },
    msg: { gap: 2, borderRadius: radius.md, paddingHorizontal: 2 },
    groupStart: { marginTop: spacing.sm },
    mine: { alignItems: 'flex-end' },
    theirs: { alignItems: 'flex-start' },
    author: { fontSize: fontSize.xs, fontWeight: '700', color: c.ink, paddingHorizontal: spacing.xs },
    bubble: { maxWidth: '85%', borderWidth: 1, borderRadius: radius.lg, paddingHorizontal: spacing.md, paddingVertical: spacing.xs + 2, gap: 4 },
    pending: { opacity: 0.75 },
    tombstone: { borderStyle: 'dashed', backgroundColor: 'transparent' },
    tombstoneText: { fontSize: fontSize.sm, fontStyle: 'italic', color: c.ink2 },
    quote: { borderLeftWidth: 3, borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: 4, minHeight: 44, justifyContent: 'center' },
    quoteWho: { fontSize: fontSize.xs, fontWeight: '700' },
    quoteText: { fontSize: fontSize.xs },
    italic: { fontStyle: 'italic' },
    body: { fontSize: fontSize.md, lineHeight: 21 },
    meta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 4 },
    metaText: { fontSize: 11 },
    metaAlone: { minHeight: 24, paddingHorizontal: spacing.xs },
    files: { gap: spacing.xs, maxWidth: '85%' },
    alignEnd: { alignSelf: 'flex-end' },
    textEnd: { textAlign: 'right' },
    picture: { width: 220, height: 160, borderRadius: radius.md, borderWidth: 1 },
    file: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, minHeight: 48, maxWidth: 280 },
    fileIcon: { fontSize: fontSize.lg },
    grow: { flex: 1 },
    fileName: { fontSize: fontSize.sm, fontWeight: '600', color: c.ink },
    fileSize: { fontSize: 11, color: c.ink2 },
    progress: { height: 4, borderRadius: 2, overflow: 'hidden', marginTop: 4 },
    reactions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
    chip: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.sm, minHeight: 32 },
    chipEmoji: { fontSize: fontSize.md },
    chipCount: { fontSize: fontSize.xs, fontWeight: '700' },
    state: { fontSize: fontSize.xs, color: c.ink2 },
    outboxActions: { flexDirection: 'row', gap: spacing.sm },
    smallBtn: { minHeight: 44, minWidth: 64, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: c.line, borderRadius: radius.md, paddingHorizontal: spacing.md, backgroundColor: c.surface },
    smallBtnText: { fontSize: fontSize.sm, fontWeight: '700', color: c.ink2 },
    quickRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, alignItems: 'center' },
    emojiBtn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
    emojiText: { fontSize: 24 },
    moreBtn: { borderWidth: 1, borderColor: c.line },
    moreText: { fontSize: fontSize.lg, color: c.ink2, fontWeight: '700' },
    grid: { gap: spacing.xs },
    gridRow: { flexDirection: 'row', flexWrap: 'wrap' },
    groupTitle: { fontSize: 11, fontWeight: '700', color: c.ink2, marginTop: spacing.xs },
    emojiSearch: { borderWidth: 1, borderRadius: radius.md, minHeight: 44, paddingHorizontal: spacing.md, fontSize: fontSize.md },
    hint: { fontSize: fontSize.xs, color: c.ink2 },
    editBox: { borderWidth: 1, borderRadius: radius.md, minHeight: 96, maxHeight: 220, padding: spacing.md, fontSize: fontSize.md, textAlignVertical: 'top' },
    viewer: { flex: 1, backgroundColor: '#000' },
    viewerBar: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md },
    viewerName: { flex: 1, color: '#fff', fontSize: fontSize.sm, fontWeight: '600' },
    viewerBtn: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md, backgroundColor: 'rgba(255,255,255,0.15)', paddingHorizontal: spacing.md },
    viewerBtnText: { color: '#fff', fontWeight: '700', fontSize: fontSize.sm },
    viewerBody: { flex: 1, justifyContent: 'center' },
    viewerSpinner: { position: 'absolute', alignSelf: 'center' },
    viewerImage: { width: '100%', height: '100%' },
  });
