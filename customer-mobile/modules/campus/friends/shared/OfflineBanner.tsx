import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { WifiOff } from '../../../../components/lucide';
import { getCampusConnectionState, subscribeCampusConnection, CampusConnectionState } from '../../campusSocketClient';
import { FriendsColors, FS, FR } from '../friendsTheme';

import { themedSheet } from '../../../../utils/themeNow';
/** Shown after this long without a live connection (avoids flashing during a quick reconnect). */
const SHOW_AFTER_MS = 2500;

/** True while the live Campus connection is down (debounced). */
export const useCampusOffline = () => {
  const [offline, setOffline] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const apply = (state: CampusConnectionState) => {
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
      }
      if (state === 'connected' || state === 'unauthorized') {
        setOffline(false);
      } else {
        timer.current = setTimeout(() => setOffline(true), SHOW_AFTER_MS);
      }
    };
    apply(getCampusConnectionState());
    const unsub = subscribeCampusConnection(apply);
    return () => {
      unsub();
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  return offline;
};

/** Slim banner: "You're offline. Showing what was loaded." */
export const OfflineBanner: React.FC<{ message?: string }> = ({ message }) => {
  const offline = useCampusOffline();
  if (!offline) return null;
  return (
    <View style={styles.wrap} accessibilityRole="alert" accessibilityLiveRegion="polite">
      <WifiOff size={14} color={FriendsColors.warn} />
      <Text style={styles.text} numberOfLines={2}>
        {message || "You're offline. Live updates will resume when you reconnect."}
      </Text>
    </View>
  );
};

const styles = themedSheet(() => ({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: FS.lg,
    marginTop: FS.sm,
    paddingHorizontal: FS.md,
    paddingVertical: 10,
    minHeight: 44,
    borderRadius: FR.md,
    backgroundColor: FriendsColors.warnSoft,
    borderWidth: 1,
    borderColor: FriendsColors.warnLine,
  },
  text: { flex: 1, fontSize: 12, fontWeight: '600', color: FriendsColors.warn },
}));
