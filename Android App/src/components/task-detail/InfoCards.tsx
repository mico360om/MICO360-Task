import React, { useMemo, useState } from 'react';
import { View, Text, Pressable, Image, StyleSheet, Alert } from 'react-native';
import { useColors } from '../../core/theme';
import { TextField, Button } from '../ui';
import { categoryColorOf, spacing, radius, fontSize, type Palette } from '../../lib/theme';
import { buildTimeline, type FeedEntry, type TimelineKind } from '../../lib/activity-feed';
import { fileKind } from '../../lib/file-kind';
import { filterTasks } from '../../lib/task-picker';
import { attachmentIcon, formatFileSize } from '../../lib/attachments';
import type { TaskRef } from '../../lib/task-detail';
import type { ApiAttachment } from '../../lib/attachments';
import { IconButton, SaveNote, SectionCard, relativeTime, useSave } from './kit';

// ── Activity ─────────────────────────────────────────────────────────────────
const FIRST = 5;
const MORE = 10;

/** What happened to the task: newest first, repetitive runs collapsed, "Load more" for older. */
export function ActivityCard({ entries }: { entries: FeedEntry[] }) {
  const c = useColors();
  const s = useMemo(() => makeStyles(c), [c]);
  const items = useMemo(() => buildTimeline(entries), [entries]);
  const [shown, setShown] = useState(FIRST);
  const dot = (k: TimelineKind): string =>
    ({
      created: c.category.TODO,
      moved: c.brand,
      completed: c.success,
      reopened: c.warning,
      assigned: c.category.REVIEW,
      unassigned: c.ink3,
      updated: c.ink2,
      checklist: c.success,
      comment: c.category.REVIEW,
      file: c.warning,
      blocker: c.danger,
      other: c.ink3,
    })[k];
  if (items.length === 0) return null;
  return (
    <SectionCard title="Activity">
      {items.slice(0, shown).map((item) => (
        <View
          key={item.id}
          style={s.entry}
          accessibilityLabel={`${item.actorName} ${item.text}${item.path ? `: ${item.path.join(', then ')}` : ''}, ${item.createdAt ? relativeTime(item.createdAt) : ''}`}
        >
          <View style={[s.dot, { backgroundColor: dot(item.kind) }]} />
          <View style={s.flex}>
            <Text style={s.line}>
              <Text style={s.actor}>{item.actorName}</Text> {item.text}
            </Text>
            {item.path && item.path.length > 1 ? (
              <View style={s.path}>
                {item.path.map((p, i) => (
                  <React.Fragment key={`${i}-${p}`}>
                    {i > 0 ? <Text style={s.arrow}>→</Text> : null}
                    <Text style={s.step}>{p}</Text>
                  </React.Fragment>
                ))}
              </View>
            ) : null}
            {item.createdAt ? <Text style={s.when}>{relativeTime(item.createdAt)}</Text> : null}
          </View>
        </View>
      ))}
      {items.length > shown ? <Button title="Load more" variant="ghost" onPress={() => setShown((n) => n + MORE)} /> : null}
    </SectionCard>
  );
}

// ── Files ────────────────────────────────────────────────────────────────────
export interface UploadView {
  key: string;
  name: string;
  fraction: number;
  error?: string;
}

/** Files on the task: picture previews, open/download, delete (when allowed, after asking), upload with progress. */
export function FilesCard({
  files,
  uploads,
  hrefOf,
  canDelete,
  onOpen,
  onDelete,
  onPick,
  onDismissUpload,
  unavailable,
}: {
  files: ApiAttachment[];
  uploads: UploadView[];
  hrefOf: (a: ApiAttachment) => string;
  canDelete: (a: ApiAttachment) => boolean;
  onOpen: (a: ApiAttachment) => void;
  onDelete: (a: ApiAttachment) => Promise<unknown>;
  onPick: () => void;
  onDismissUpload: (key: string) => void;
  unavailable?: boolean;
}) {
  const c = useColors();
  const s = useMemo(() => makeStyles(c), [c]);
  const save = useSave();
  return (
    <SectionCard title={`Attachments${files.length ? ` · ${files.length}` : ''}`}>
      {unavailable && files.length === 0 ? <Text style={s.muted}>Files aren’t available right now.</Text> : null}
      {!unavailable && files.length === 0 && uploads.length === 0 ? <Text style={s.muted}>No files yet — attach one below.</Text> : null}
      {files.map((a) => {
        const kind = fileKind(a.mimeType, a.filename);
        return (
          <View key={a.id} style={s.file}>
            <Pressable onPress={() => onOpen(a)} accessibilityRole="link" accessibilityLabel={`Open ${a.filename}, ${formatFileSize(a.sizeBytes)}`} style={({ pressed }) => [s.fileMain, pressed && { opacity: 0.7 }]}>
              {kind === 'image' ? (
                <Image source={{ uri: hrefOf(a) }} style={s.thumb} accessibilityIgnoresInvertColors accessible={false} />
              ) : (
                <View style={[s.thumb, s.thumbIcon]}>
                  <Text style={{ fontSize: fontSize.lg }}>{attachmentIcon(a.mimeType)}</Text>
                </View>
              )}
              <View style={s.flex}>
                <Text style={s.fileName} numberOfLines={1}>
                  {a.filename}
                </Text>
                <Text style={s.when}>{formatFileSize(a.sizeBytes)}</Text>
              </View>
            </Pressable>
            {canDelete(a) ? (
              <IconButton
                glyph="🗑"
                label={`Delete ${a.filename}`}
                tone="danger"
                onPress={() =>
                  Alert.alert('Delete file?', `${a.filename} will be removed from this task.`, [
                    { text: 'Keep', style: 'cancel' },
                    { text: 'Delete', style: 'destructive', onPress: () => void save.run(() => onDelete(a), 'Couldn’t delete the file.') },
                  ])
                }
              />
            ) : null}
          </View>
        );
      })}
      {uploads.map((u) => (
        <View key={u.key} style={s.upload}>
          <View style={s.rowCenter}>
            <Text style={[s.fileName, s.flex]} numberOfLines={1}>
              {u.name}
            </Text>
            {u.error ? <IconButton glyph="×" label={`Dismiss ${u.name}`} onPress={() => onDismissUpload(u.key)} /> : <Text style={s.when}>{Math.round(u.fraction * 100)}%</Text>}
          </View>
          {u.error ? (
            <Text accessibilityRole="alert" style={s.error}>{`${u.name}: ${u.error}`}</Text>
          ) : (
            <View style={s.bar} accessibilityLabel={`Uploading ${u.name}`} accessibilityValue={{ min: 0, max: 100, now: Math.round(u.fraction * 100) }}>
              <View style={[s.barFill, { width: `${Math.round(u.fraction * 100)}%` }]} />
            </View>
          )}
        </View>
      ))}
      <SaveNote state={save.state} />
      <Button title="Attach files" variant="secondary" onPress={onPick} />
    </SectionCard>
  );
}

// ── Blockers ─────────────────────────────────────────────────────────────────
function RefLine({ t, onRemove }: { t: TaskRef; onRemove?: () => void }) {
  const c = useColors();
  const s = useMemo(() => makeStyles(c), [c]);
  return (
    <View style={s.ref} accessibilityLabel={`${t.key} ${t.title}${t.statusName ? `, ${t.statusName}` : ''}`}>
      <Text style={[s.refMark, { color: t.done ? c.success : c.warning }]}>{t.done ? '✓' : '●'}</Text>
      <Text style={s.refKey}>{t.key}</Text>
      <Text style={[s.refTitle, t.done && s.refDone]} numberOfLines={1}>
        {t.title}
      </Text>
      {t.statusName ? (
        <View style={s.status}>
          <View style={[s.statusDot, { backgroundColor: categoryColorOf(c, t.statusCategory ?? 'TODO') }]} />
          <Text style={s.statusText}>{t.statusName}</Text>
        </View>
      ) : null}
      {onRemove ? <IconButton glyph="×" label={`Remove blocker ${t.key}`} onPress={onRemove} /> : null}
    </View>
  );
}

/**
 * What this task waits on (and what waits on it), with status; a search to add a blocker that
 * never offers the task itself, one already linked, or one it blocks — a longer loop is refused
 * by the server, with its reason shown.
 */
export function BlockersCard({
  taskId,
  blockedBy,
  blocks,
  candidates,
  onAdd,
  onRemove,
}: {
  taskId: string;
  blockedBy: TaskRef[];
  blocks: TaskRef[];
  candidates: TaskRef[];
  onAdd: (id: string) => Promise<unknown>;
  onRemove: (id: string) => Promise<unknown>;
}) {
  const c = useColors();
  const s = useMemo(() => makeStyles(c), [c]);
  const save = useSave();
  const [query, setQuery] = useState('');
  const exclude = new Set([taskId, ...blockedBy.map((d) => d.id), ...blocks.map((d) => d.id)]);
  const matches = query.trim() ? filterTasks(candidates, query, exclude, 6) : [];
  const open = blockedBy.filter((d) => !d.done).length;
  return (
    <SectionCard title="Dependencies" right={open > 0 ? <Text style={s.waiting}>{`Waiting on ${open} open ${open === 1 ? 'task' : 'tasks'}`}</Text> : undefined}>
      <Text style={s.sub}>Blocked by</Text>
      {blockedBy.length === 0 ? <Text style={s.muted}>Nothing is blocking this task.</Text> : null}
      {blockedBy.map((d) => (
        <RefLine key={d.id} t={d} onRemove={() => void save.run(() => onRemove(d.id), 'Couldn’t remove the blocker.')} />
      ))}
      <TextField
        value={query}
        onChangeText={(v) => {
          setQuery(v);
          if (save.state.status === 'error') save.reset();
        }}
        placeholder="Add a blocker — search by key or title…"
        accessibilityLabel="Add a blocking task"
        autoCapitalize="none"
      />
      {query.trim() && matches.length === 0 ? <Text style={s.muted}>No task matches (a task can’t block itself or one it already blocks).</Text> : null}
      {matches.map((t) => (
        <Pressable
          key={t.id}
          accessibilityRole="button"
          accessibilityLabel={`Add blocker ${t.key} ${t.title}`}
          onPress={() => void save.run(() => onAdd(t.id), 'Couldn’t add the blocker.').then((ok) => ok && setQuery(''))}
          style={({ pressed }) => [s.option, pressed && { backgroundColor: c.brandWash }]}
        >
          <Text style={s.refKey}>{t.key}</Text>
          <Text style={[s.refTitle, s.flex]} numberOfLines={1}>
            {t.title}
          </Text>
          {t.statusName ? <Text style={s.when}>{t.statusName}</Text> : null}
        </Pressable>
      ))}
      <SaveNote state={save.state} />
      {blocks.length > 0 ? (
        <>
          <Text style={s.sub}>Blocks</Text>
          {blocks.map((d) => (
            <RefLine key={d.id} t={d} />
          ))}
        </>
      ) : null}
    </SectionCard>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    flex: { flex: 1 },
    muted: { fontSize: fontSize.sm, color: c.ink3 },
    when: { fontSize: fontSize.xs, color: c.ink3 },
    entry: { flexDirection: 'row', gap: spacing.sm, paddingVertical: spacing.xs },
    dot: { width: 10, height: 10, borderRadius: 5, marginTop: 5 },
    line: { fontSize: fontSize.sm, color: c.ink2 },
    actor: { fontWeight: '800', color: c.ink },
    path: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 4, marginTop: 2 },
    arrow: { fontSize: fontSize.xs, color: c.ink3 },
    step: { fontSize: fontSize.xs, color: c.ink2, backgroundColor: c.ground, borderRadius: radius.sm, paddingHorizontal: 6, paddingVertical: 1, overflow: 'hidden' },
    file: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
    fileMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 56, borderWidth: 1, borderColor: c.line, borderRadius: radius.md, padding: spacing.sm, backgroundColor: c.surface },
    thumb: { width: 40, height: 40, borderRadius: radius.sm },
    thumbIcon: { backgroundColor: c.ground, alignItems: 'center', justifyContent: 'center' },
    fileName: { fontSize: fontSize.md, fontWeight: '600', color: c.ink },
    upload: { borderWidth: 1, borderColor: c.line, borderRadius: radius.md, padding: spacing.sm, gap: spacing.xs },
    rowCenter: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
    error: { fontSize: fontSize.sm, color: c.danger, fontWeight: '600' },
    bar: { height: 6, backgroundColor: c.line, borderRadius: radius.pill, overflow: 'hidden' },
    barFill: { height: 6, backgroundColor: c.brand },
    waiting: { fontSize: fontSize.xs, fontWeight: '800', color: c.warning, backgroundColor: c.warningSoft, borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: 2, overflow: 'hidden' },
    sub: { fontSize: fontSize.xs, fontWeight: '700', color: c.ink2 },
    ref: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, minHeight: 44 },
    refMark: { fontSize: fontSize.sm, fontWeight: '900', width: 16, textAlign: 'center' },
    refKey: { fontSize: fontSize.xs, fontWeight: '700', color: c.ink2, fontFamily: 'monospace' },
    refTitle: { flexShrink: 1, fontSize: fontSize.sm, color: c.ink },
    refDone: { color: c.ink3, textDecorationLine: 'line-through' },
    status: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: c.ground, borderRadius: radius.sm, paddingHorizontal: 6, paddingVertical: 2 },
    statusDot: { width: 7, height: 7, borderRadius: 4 },
    statusText: { fontSize: fontSize.xs, color: c.ink2, fontWeight: '600' },
    option: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 48, paddingHorizontal: spacing.sm, borderRadius: radius.sm, borderWidth: 1, borderColor: c.line },
  });
