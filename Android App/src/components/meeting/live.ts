import { useEffect, useState } from 'react';
import { Alert, Linking } from 'react-native';

/** "Now", moved on every minute, so "Under way", "in 25 min" and "overdue" stay true on an open screen. */
export function useMinuteNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

/** Open an online meeting's link — one already checked to be http or https (safeMeetingHref). */
export function openJoinLink(href: string): void {
  void Linking.openURL(href).catch(() => Alert.alert('Couldn’t open the meeting link', href));
}
