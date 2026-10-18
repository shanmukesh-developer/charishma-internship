// Force update (C3) UI. Same file in all five Zenvy apps; logic lives in ./forceUpdate.
//   blocked -> full-screen "Update required" (app name, message, Update -> Play Store, Retry); the app
//              behind it is not rendered, so it stops calling the API.
//   soft    -> dismissible banner at the top, shown once per latest version.
// Checks GET /api/config/app-version on launch and whenever the app comes back to the foreground.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import {
  checkForUpdate,
  dismissSoftPrompt,
  getApiOrigin,
  getClientInfo,
  getUpdateState,
  isSoftPromptDismissed,
  storeLinks,
  subscribeUpdateState,
  type UpdateState,
} from './forceUpdate';

const RESUME_CHECK_MIN_MS = 30 * 1000;

async function openStore(storeUrl: string | null): Promise<boolean> {
  const client = getClientInfo();
  const links = storeLinks(storeUrl, client ? client.packageId : null, Platform.OS === 'android');
  for (const url of links) {
    try {
      await Linking.openURL(url);
      return true;
    } catch { /* try the next link (no Play Store app -> https) */ }
  }
  return false;
}

export default function UpdateGate({ children }: { children: React.ReactNode }) {
  const [update, setUpdate] = useState<UpdateState>(getUpdateState());
  const [softHidden, setSoftHidden] = useState(true);
  const [retrying, setRetrying] = useState(false);
  const [openFailed, setOpenFailed] = useState(false);
  const lastCheck = useRef(0);

  const runCheck = useCallback((force = false) => {
    const now = Date.now();
    if (!force && now - lastCheck.current < RESUME_CHECK_MIN_MS) return Promise.resolve(getUpdateState());
    lastCheck.current = now;
    return checkForUpdate();
  }, []);

  useEffect(() => {
    const unsub = subscribeUpdateState(setUpdate);
    setUpdate(getUpdateState());
    runCheck(true);
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') runCheck(false);
    });
    return () => {
      unsub();
      sub.remove();
    };
  }, [runCheck]);

  const latest = update.policy ? update.policy.latestVersion : null;
  useEffect(() => {
    let alive = true;
    if (update.status !== 'soft') {
      setSoftHidden(true);
      return () => { alive = false; };
    }
    isSoftPromptDismissed(latest).then((d) => { if (alive) setSoftHidden(d); });
    return () => { alive = false; };
  }, [update.status, latest]);

  const onUpdate = useCallback(async () => {
    setOpenFailed(false);
    const ok = await openStore(update.policy ? update.policy.storeUrl : null);
    if (!ok) setOpenFailed(true);
  }, [update.policy]);

  const onRetry = useCallback(async () => {
    setRetrying(true);
    try { await runCheck(true); } finally { setRetrying(false); }
  }, [runCheck]);

  const onLater = useCallback(() => {
    setSoftHidden(true);
    dismissSoftPrompt(latest);
  }, [latest]);

  if (update.status === 'blocked') {
    const p = update.policy;
    const client = getClientInfo();
    const origin = getApiOrigin();
    return (
      <View style={styles.blocked} accessibilityRole="alert">
        <View style={styles.card}>
          <Text style={styles.badge}>UPDATE REQUIRED</Text>
          <Text style={styles.title}>{p ? p.appName : 'Zenvy'} needs an update</Text>
          <Text style={styles.message}>{p ? p.message : 'This version of the app is no longer supported. Please update to keep using Zenvy.'}</Text>
          {!!client && !!client.version && (
            <Text style={styles.meta}>
              You have version {client.version}
              {p && p.minSupportedVersion ? ` · ${p.minSupportedVersion} or newer is needed` : ''}
            </Text>
          )}
          <Pressable style={({ pressed }) => [styles.primary, pressed && styles.pressed]} onPress={onUpdate} accessibilityRole="button" accessibilityLabel="Update the app">
            <Text style={styles.primaryText}>Update</Text>
          </Pressable>
          {openFailed && <Text style={styles.error}>Could not open the store. Search for &quot;{p ? p.appName : 'Zenvy'}&quot; in the Play Store.</Text>}
          <Pressable style={({ pressed }) => [styles.secondary, pressed && styles.pressed]} onPress={onRetry} disabled={retrying} accessibilityRole="button" accessibilityLabel="Check again">
            {retrying ? <ActivityIndicator color="#E5E7EB" /> : <Text style={styles.secondaryText}>Retry</Text>}
          </Pressable>
          {!!origin && (
            <Pressable onPress={() => { Linking.openURL(`${origin}/legal/delete-account`).catch(() => {}); }} accessibilityRole="link">
              <Text style={styles.link}>Want to delete your account instead?</Text>
            </Pressable>
          )}
        </View>
      </View>
    );
  }

  return (
    <View style={styles.fill}>
      {children}
      {update.status === 'soft' && !softHidden && update.policy && (
        <View style={styles.banner} accessibilityRole="alert">
          <Text style={styles.bannerText} numberOfLines={2}>
            A new version{update.policy.latestVersion ? ` (${update.policy.latestVersion})` : ''} is available.
          </Text>
          <Pressable onPress={onUpdate} style={styles.bannerBtn} accessibilityRole="button" accessibilityLabel="Update the app">
            <Text style={styles.bannerBtnText}>Update</Text>
          </Pressable>
          <Pressable onPress={onLater} style={styles.bannerLater} accessibilityRole="button" accessibilityLabel="Remind me later">
            <Text style={styles.bannerLaterText}>Later</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  blocked: { flex: 1, backgroundColor: '#0B0D12', alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: { width: '100%', maxWidth: 420, backgroundColor: '#151821', borderRadius: 20, padding: 24, borderWidth: 1, borderColor: '#262A36' },
  badge: { color: '#F59E0B', fontSize: 11, fontWeight: '800', letterSpacing: 1.5, marginBottom: 10 },
  title: { color: '#FFFFFF', fontSize: 22, fontWeight: '800', marginBottom: 10 },
  message: { color: '#D1D5DB', fontSize: 15, lineHeight: 22, marginBottom: 12 },
  meta: { color: '#9CA3AF', fontSize: 12, marginBottom: 18 },
  primary: { backgroundColor: '#22C55E', borderRadius: 14, paddingVertical: 15, alignItems: 'center', marginTop: 4 },
  primaryText: { color: '#0B0D12', fontSize: 16, fontWeight: '800' },
  secondary: { borderRadius: 14, paddingVertical: 13, alignItems: 'center', marginTop: 10, borderWidth: 1, borderColor: '#374151', minHeight: 48, justifyContent: 'center' },
  secondaryText: { color: '#E5E7EB', fontSize: 15, fontWeight: '700' },
  pressed: { opacity: 0.8 },
  error: { color: '#FCA5A5', fontSize: 12, marginTop: 8 },
  link: { color: '#9CA3AF', fontSize: 12, textAlign: 'center', marginTop: 16, textDecorationLine: 'underline' },
  banner: {
    position: 'absolute', left: 12, right: 12, top: Platform.OS === 'ios' ? 54 : 36,
    backgroundColor: '#151821', borderRadius: 14, paddingVertical: 10, paddingHorizontal: 14,
    flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#262A36',
    elevation: 8, shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 8, shadowOffset: { width: 0, height: 3 },
  },
  bannerText: { flex: 1, color: '#F3F4F6', fontSize: 13, fontWeight: '600', marginRight: 8 },
  bannerBtn: { backgroundColor: '#22C55E', borderRadius: 10, paddingVertical: 7, paddingHorizontal: 12 },
  bannerBtnText: { color: '#0B0D12', fontWeight: '800', fontSize: 13 },
  bannerLater: { paddingVertical: 7, paddingHorizontal: 10 },
  bannerLaterText: { color: '#9CA3AF', fontWeight: '700', fontSize: 13 },
});
