// C9: last line of defence for render errors. Instead of a white screen / app crash the user sees a calm
// "Something went wrong" screen with Restart, which remounts the app below this boundary (session, token and
// offline queue are kept: they live in storage, not in React state). The error is logged to the console
// (Sentry can be wired into componentDidCatch later). Self-contained: no theme / navigation imports, so it
// still renders when those are what broke.
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

interface Props {
  children: React.ReactNode;
  /** Shown in the log line, e.g. "Zenvy Rider". */
  appName: string;
}
interface State {
  error: Error | null;
  generation: number;
}

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null, generation: 0 };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error(`[${this.props.appName}] render error:`, error?.message || error, info?.componentStack || '');
  }

  private restart = () => {
    this.setState((s) => ({ error: null, generation: s.generation + 1 }));
  };

  render() {
    if (!this.state.error) {
      return <React.Fragment key={this.state.generation}>{this.props.children}</React.Fragment>;
    }
    return (
      <View style={styles.wrap} accessibilityRole="alert">
        <View style={styles.card}>
          <Text style={styles.title}>Something went wrong</Text>
          <Text style={styles.body}>
            The app hit an unexpected problem. Your account and your work are safe. Tap Restart to continue.
          </Text>
          {__DEV__ ? (
            <Text style={styles.debug} numberOfLines={4}>
              {String(this.state.error?.message || this.state.error)}
            </Text>
          ) : null}
          <Pressable
            onPress={this.restart}
            style={({ pressed }) => [styles.btn, pressed && { opacity: 0.85 }]}
            accessibilityRole="button"
            accessibilityLabel="Restart"
          >
            <Text style={styles.btnText}>Restart</Text>
          </Pressable>
        </View>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: '#F6F6F4' },
  card: {
    width: '100%',
    maxWidth: 420,
    padding: 24,
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E4E4E0',
    gap: 12,
  },
  title: { fontSize: 20, fontWeight: '800', color: '#16171A' },
  body: { fontSize: 15, lineHeight: 22, color: '#4A4C52' },
  debug: { fontSize: 12, color: '#B42318', fontFamily: 'monospace' },
  btn: { marginTop: 8, minHeight: 52, borderRadius: 12, backgroundColor: '#16171A', alignItems: 'center', justifyContent: 'center' },
  btnText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
});

export default ErrorBoundary;
