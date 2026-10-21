import { useCallback, useEffect, useState } from 'react';
import { Alert, Linking } from 'react-native';

/**
 * "Now", moved on every minute while the screen is in view (`active`), so "Under way", "in 25 min"
 * and "overdue" stay true; a tab out of view doesn't redraw its list every minute. Coming back
 * into view brings it up to date at once.
 */
export function useMinuteNow(active = true): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!active) return;
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

/**
 * Pull to refresh: the spinner shows for the pull itself only, not whenever a live update loads
 * the list again in the background.
 */
export function usePullRefresh(load: () => Promise<unknown>): { refreshing: boolean; onRefresh: () => void } {
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void load()
      .catch(() => {})
      .finally(() => setRefreshing(false));
  }, [load]);
  return { refreshing, onRefresh };
}

/** Open an online meeting's link — one already checked to be http or https (safeMeetingHref). */
export function openJoinLink(href: string): void {
  void Linking.openURL(href).catch(() => Alert.alert('Couldn’t open the meeting link', href));
}
