import { StyleSheet, Text, View } from 'react-native';
import { radius } from '../../lib/theme';
import { typeStyle } from '../../lib/typography';
import { useColors } from '../../core/theme';
import { Button } from './Button';

/**
 * An error message that screen readers announce as soon as it appears (MOB-10), optionally with a
 * Retry button for load failures (MOB-08).
 */
export function ErrorNote({ message, onRetry, retrying }: { message: string; onRetry?: () => void; retrying?: boolean }) {
  const c = useColors();
  return (
    <View style={[styles.box, { backgroundColor: c.dangerSoft, borderColor: c.danger }]} accessibilityRole="alert" accessibilityLiveRegion="assertive">
      <Text style={[typeStyle('label'), { color: c.dangerText }]}>{message}</Text>
      {onRetry ? <Button title="Retry" variant="secondary" size="sm" onPress={onRetry} loading={retrying} style={styles.retry} /> : null}
    </View>
  );
}

/** A neutral, non-error status line (e.g. "Saved offline — will sync"), announced politely. */
export function NoticeNote({ message }: { message: string }) {
  const c = useColors();
  return (
    <View style={[styles.box, { backgroundColor: c.brandWash, borderColor: c.brand }]} accessibilityLiveRegion="polite">
      <Text style={[typeStyle('label'), { color: c.brandText }]}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderWidth: 1, borderRadius: radius.input, padding: 12, marginBottom: 12 },
  retry: { marginTop: 8, alignSelf: 'flex-start' },
});
