import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, Alert } from 'react-native';
import { useServices, useMyQueuedChanges } from '../core/providers';
import { useColors } from '../core/theme';
import { Button } from './ui';
import { describeMutation, waitingReason } from '../lib/perform-mutation';
import { waitingTooLong, type QueuedMutation } from '../lib/sync-queue';
import { spacing, radius, fontSize, type Palette } from '../lib/theme';

/**
 * Offline-queue status for the signed-in user (XP-06): how many changes are waiting to sync, and
 * the changes the server would not accept — each with its reason and Retry / Discard — so nothing
 * is dropped silently. A change stuck waiting (the server hasn't answered it, or it has waited a long
 * while) can be discarded too (2c review). Renders nothing when the queue is empty. `only` keeps it
 * to some changes (a meeting's own, on its screen).
 */
export function SyncStatus({ only }: { only?: (m: QueuedMutation) => boolean } = {}) {
  const c = useColors();
  const styles = useMemo(() => makeStyles(c), [c]);
  const { sync, queue } = useServices();
  const mine = useMyQueuedChanges();
  const pending = only ? mine.pending.filter(only) : mine.pending;
  const failed = only ? mine.failed.filter(only) : mine.failed;
  const [syncing, setSyncing] = useState(false);

  if (pending.length === 0 && failed.length === 0) return null;

  const now = Date.now();
  const stuck = pending.filter((m) => waitingTooLong(m, now));
  const discardWaiting = (m: QueuedMutation) =>
    Alert.alert('Discard this change?', `${describeMutation(m)} won’t be sent from this phone. If the server got it already, it stays saved there.`, [
      { text: 'Keep', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: () => void queue.discard(m.id) },
    ]);

  const syncNow = async () => {
    setSyncing(true);
    try {
      // Asked by the person: what waits out its time after no answer goes too (4b review #6).
      await sync.trigger({ skipWait: true });
    } finally {
      setSyncing(false);
    }
  };

  return (
    <View style={styles.wrap} accessibilityLiveRegion="polite">
      {pending.length > 0 ? (
        <View style={styles.box}>
          <Text style={styles.title}>
            {pending.length === 1 ? '1 change is waiting to sync' : `${pending.length} changes are waiting to sync`}
          </Text>
          <Text style={styles.sub}>They are sent automatically when the connection is back.</Text>
          {stuck.map((m) => (
            <View key={m.id} style={styles.item}>
              <Text style={styles.itemText}>{describeMutation(m)}</Text>
              <Text style={styles.itemNote}>{waitingReason(m, now)}</Text>
              <View style={styles.actions}>
                <Button title="Discard" variant="ghost" accessibilityLabel={`Discard: ${describeMutation(m)}`} onPress={() => discardWaiting(m)} style={styles.action} />
              </View>
            </View>
          ))}
          <Button title="Sync now" variant="secondary" onPress={() => void syncNow()} loading={syncing} />
        </View>
      ) : null}
      {failed.length > 0 ? (
        <View style={[styles.box, styles.failedBox]} accessibilityRole="alert">
          <Text style={[styles.title, styles.failedTitle]}>
            {failed.length === 1 ? '1 change could not be saved' : `${failed.length} changes could not be saved`}
          </Text>
          {failed.map((m) => (
            <View key={m.id} style={styles.item}>
              <Text style={styles.itemText}>{describeMutation(m)}</Text>
              {m.lastError ? <Text style={styles.itemError}>{m.lastError}</Text> : null}
              <View style={styles.actions}>
                <Button
                  title="Retry"
                  variant="secondary"
                  accessibilityLabel={`Retry: ${describeMutation(m)}`}
                  onPress={() => {
                    void queue.retry(m.id).then(() => sync.trigger());
                  }}
                  style={styles.action}
                />
                <Button
                  title="Discard"
                  variant="ghost"
                  accessibilityLabel={`Discard: ${describeMutation(m)}`}
                  onPress={() => void queue.discard(m.id)}
                  style={styles.action}
                />
              </View>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    wrap: { gap: spacing.sm },
    box: {
      backgroundColor: c.brandWash,
      borderWidth: 1,
      borderColor: c.brand,
      borderRadius: radius.md,
      padding: spacing.md,
      gap: spacing.xs,
    },
    failedBox: { backgroundColor: c.errorWash, borderColor: c.danger },
    title: { fontSize: fontSize.sm, fontWeight: '700', color: c.brand },
    failedTitle: { color: c.danger },
    sub: { fontSize: fontSize.xs, color: c.ink2, marginBottom: spacing.xs },
    item: { gap: 2, paddingTop: spacing.xs },
    itemText: { fontSize: fontSize.sm, color: c.ink },
    itemError: { fontSize: fontSize.xs, color: c.danger },
    itemNote: { fontSize: fontSize.xs, color: c.ink2 },
    actions: { flexDirection: 'row', gap: spacing.sm },
    action: { flex: 1, minHeight: 40 },
  });
