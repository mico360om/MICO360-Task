import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useServices, useMyQueuedChanges } from '../core/providers';
import { useColors } from '../core/theme';
import { Button } from './ui';
import { describeMutation } from '../lib/perform-mutation';
import { spacing, radius, fontSize, type Palette } from '../lib/theme';

/**
 * Offline-queue status for the signed-in user (XP-06): how many changes are waiting to sync, and
 * the changes the server would not accept — each with its reason and Retry / Discard — so nothing
 * is dropped silently. Renders nothing when the queue is empty.
 */
export function SyncStatus() {
  const c = useColors();
  const styles = useMemo(() => makeStyles(c), [c]);
  const { sync, queue } = useServices();
  const { pending, failed } = useMyQueuedChanges();
  const [syncing, setSyncing] = useState(false);

  if (pending.length === 0 && failed.length === 0) return null;

  const syncNow = async () => {
    setSyncing(true);
    try {
      await sync.trigger();
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
    actions: { flexDirection: 'row', gap: spacing.sm },
    action: { flex: 1, minHeight: 40 },
  });
