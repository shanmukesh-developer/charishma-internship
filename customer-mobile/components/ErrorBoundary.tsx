import React, { Component, ErrorInfo, ReactNode } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, SafeAreaView, Platform, StatusBar } from 'react-native';
import { SHADOWS, RADIUS } from '../constants/theme';
import { dietNow, isDarkNow } from '../utils/themeNow';
import { recordJsError } from '../utils/crashReporting';
import { Ionicons } from '@expo/vector-icons';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  /** Leave the broken screen for Home ("Try again" alone re-rendered the same crash, a dead end). */
  onGoHome?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[ZEN_UNCAUGHT_REACT_ERROR]', error, errorInfo);
    // Crashlytics in release builds only (utils/crashReporting); the component stack goes in as context.
    const firstFrame = errorInfo?.componentStack ? String(errorInfo.componentStack).trim().split(/\r?\n/)[0] : '';
    recordJsError(error, firstFrame ? `ErrorBoundary: ${firstFrame}` : 'ErrorBoundary');
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      // Owner, 10 Nov 2026: the app's one diet look (class component: the diet tokens are read outside React).
      const d = dietNow();
      const dark = isDarkNow();
      return (
        <SafeAreaView style={[styles.container, { backgroundColor: d.page }]}>
          <StatusBar barStyle={dark ? 'light-content' : 'dark-content'} backgroundColor={d.page} />
          <View style={[styles.card, { backgroundColor: d.card, borderColor: d.edge }]}>
            <View style={[styles.iconCircle, { backgroundColor: dark ? d.top : d.soft, borderColor: d.line }]}>
              <Ionicons name="alert-circle-outline" size={30} color={d.acc} />
            </View>

            <Text style={[styles.title, { color: d.dk }]}>Something went wrong</Text>
            <Text style={[styles.subtitle, { color: d.muteInk }]}>
              This screen could not load. Your orders and basket are safe. Tap below to try again.
            </Text>

            {__DEV__ && this.state.error && (
              <View style={styles.debugBox}>
                <Text style={styles.debugText} numberOfLines={3}>
                  {this.state.error.toString()}
                </Text>
              </View>
            )}

            <TouchableOpacity style={[styles.primaryButton, { backgroundColor: d.acc, shadowColor: d.acc }]} activeOpacity={0.85} onPress={this.handleReset}>
              <Text style={[styles.primaryButtonText, { color: d.onAcc }]}>Try again</Text>
            </TouchableOpacity>
            {this.props.onGoHome && (
              <TouchableOpacity
                style={{ marginTop: 14, paddingVertical: 8, paddingHorizontal: 16 }}
                activeOpacity={0.7}
                onPress={() => { try { this.props.onGoHome?.(); } catch { /* still reset below */ } this.handleReset(); }}
              >
                <Text style={{ color: d.muteInk, fontSize: 13, fontWeight: '700' }}>Go to Home</Text>
              </TouchableOpacity>
            )}
          </View>
        </SafeAreaView>
      );
    }

    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#09090B',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: '#18181B',
    borderRadius: RADIUS.card,
    padding: 28,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    ...SHADOWS.card,
  },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(239, 79, 95, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
    borderWidth: 1,
    borderColor: 'rgba(239, 79, 95, 0.3)',
  },
  icon: {
    fontSize: 28,
  },
  title: {
    fontSize: 20,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 13,
    color: '#A1A1AA',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 20,
  },
  debugBox: {
    width: '100%',
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    padding: 12,
    borderRadius: RADIUS.sm,
    borderWidth: 1,
    borderColor: 'rgba(239, 79, 95, 0.2)',
    marginBottom: 20,
  },
  debugText: {
    color: '#EF4F5F',
    fontSize: 12,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  primaryButton: {
    width: '100%',
    backgroundColor: '#C8143F',
    paddingVertical: 14,
    borderRadius: RADIUS.md,
    alignItems: 'center',
    justifyContent: 'center',
    ...SHADOWS.redGlow,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800',
  },
});

export default ErrorBoundary;
