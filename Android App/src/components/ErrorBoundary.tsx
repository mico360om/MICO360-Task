import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Button, Heading, Muted } from './ui';
import { colors, spacing } from '../lib/theme';
import type { CrashReporter } from '../lib/error-reporter';

interface Props {
  reporter: CrashReporter;
  children: React.ReactNode;
}
interface State {
  error: Error | null;
}

/** Catches render-time crashes, reports them, and shows a recoverable fallback (A9). */
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    this.props.reporter.captureException(error, { componentStack: info.componentStack });
  }

  render(): React.ReactNode {
    if (this.state.error) {
      return (
        <View style={styles.wrap}>
          <Heading>Something went wrong</Heading>
          <Muted style={styles.msg}>The app hit an unexpected error. You can try again.</Muted>
          <Button title="Try again" onPress={() => this.setState({ error: null })} />
        </View>
      );
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.md, backgroundColor: colors.ground },
  msg: { textAlign: 'center' },
});
