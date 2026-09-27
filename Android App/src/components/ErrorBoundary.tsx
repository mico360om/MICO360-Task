import React from 'react';
import { View, Text, Pressable, StyleSheet, Appearance } from 'react-native';
import { resolveColors, spacing, radius, fontSize, type Palette } from '../lib/theme';
import type { CrashReporter } from '../lib/error-reporter';

interface Props {
  reporter: CrashReporter;
  children: React.ReactNode;
}
interface State {
  error: Error | null;
}

/** The palette for the fallback, read straight from the OS (no ThemeProvider needed). */
function fallbackColors(): Palette {
  try {
    return resolveColors(Appearance.getColorScheme());
  } catch {
    return resolveColors('light');
  }
}

/**
 * Catches render-time crashes, reports them, and shows a recoverable fallback (A9, MOB-02).
 *
 * This boundary sits OUTSIDE the theme/services providers (so it also catches their failures),
 * therefore the fallback is built only from plain React Native primitives with static styles —
 * themed components call `useTheme()` and would throw again without a provider, turning one bad
 * API value into a white screen.
 */
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    try {
      this.props.reporter.captureException(error, { componentStack: info.componentStack });
    } catch {
      /* a failing reporter must never break the fallback */
    }
  }

  private retry = (): void => {
    this.setState({ error: null });
  };

  render(): React.ReactNode {
    if (!this.state.error) return this.props.children;
    const c = fallbackColors();
    return (
      <View style={[styles.wrap, { backgroundColor: c.ground }]}>
        <Text accessibilityRole="header" style={[styles.title, { color: c.ink }]}>
          Something went wrong
        </Text>
        <Text accessibilityLiveRegion="polite" style={[styles.msg, { color: c.ink2 }]}>
          The app hit an unexpected error. You can try again.
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Try again"
          onPress={this.retry}
          style={({ pressed }) => [styles.btn, { backgroundColor: c.brand, opacity: pressed ? 0.7 : 1 }]}
        >
          <Text style={[styles.btnText, { color: c.onBrand }]}>Try again</Text>
        </Pressable>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.md },
  title: { fontSize: fontSize.xl, fontWeight: '800', textAlign: 'center' },
  msg: { fontSize: fontSize.md, textAlign: 'center' },
  btn: { minHeight: 48, minWidth: 160, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.lg },
  btnText: { fontSize: fontSize.md, fontWeight: '700' },
});
