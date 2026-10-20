import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import {
  MapPin, BookOpen, Utensils, Dumbbell, Users, Sofa, Mic, Coffee, Music, Gamepad2, Trees, Bus, Laptop, Building,
  Wifi, ChevronRight,
} from '../../../components/lucide';
import * as Haptics from 'expo-haptics';
import { CampusColors } from '../../../constants/campusTheme';
import { fetchProximityRooms, ProximityRoomItem } from '../campusApi';
import ShimmerLoader from '../../../components/ShimmerLoader';
import { useLiveSync } from '../../../utils/useLiveSync';
import { T, S, R } from '../ui';

/** Icons an admin can pick for a spot (backend spotAdminController ICONS). */
export const SPOT_ICON_MAP: Record<string, any> = {
  MapPin, BookOpen, Utensils, Dumbbell, Users, Sofa, Mic, Coffee, Music, Gamepad2, Trees, Bus, Laptop, Building,
};

const CATEGORY_COLORS: Record<string, { bg: string; fg: string }> = {
  library: { bg: CampusColors.accentSoft, fg: CampusColors.accentDeep },
  dining: { bg: CampusColors.warmSoft, fg: CampusColors.warmDeep },
  sports: { bg: '#DCFCE7', fg: '#166534' },
  hostel: { bg: CampusColors.roseSoft, fg: CampusColors.roseDeep },
  academic: { bg: CampusColors.accentSoft, fg: CampusColors.accentDeep },
  common: { bg: '#F3E8FF', fg: '#7C3AED' },
};

/**
 * Campus spot chat rooms (library, mess, gym…). Spots are created by admins per campus; the app shows
 * only what the server returns (nothing when there are none) and refreshes when an admin edits them.
 * The app does not use your location.
 */
export const LiveZones: React.FC<{ onOpenRoom: (slug: string) => void; refreshKey?: number }> = ({ onOpenRoom, refreshKey }) => {
  const [rooms, setRooms] = useState<ProximityRoomItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    try {
      const r = await fetchProximityRooms();
      if (!mounted.current) return;
      setRooms(r);
      setError(false);
    } catch {
      if (mounted.current) setError(true);
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  // Admin created / edited / disabled / reordered a spot: refetch silently.
  useLiveSync({
    types: ['campus'],
    filter: (e) => !e.scope || e.scope === 'spots',
    onChange: () => { load(); },
  });

  if (loading) {
    return (
      <View style={{ flexDirection: 'row', gap: S.md }}>
        <ShimmerLoader width={200} height={60} borderRadius={14} />
        <ShimmerLoader width={200} height={60} borderRadius={14} />
      </View>
    );
  }
  if (error && rooms.length === 0) {
    return (
      <TouchableOpacity style={styles.empty} onPress={() => { setLoading(true); load(); }} activeOpacity={0.7}>
        <Text style={T.muted}>Couldn&apos;t load campus spots. Tap to retry.</Text>
      </TouchableOpacity>
    );
  }
  if (rooms.length === 0) {
    return <Text style={[T.small, { color: CampusColors.muted }]}>No campus spots yet.</Text>;
  }
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: S.md, paddingRight: S.lg }}>
      {rooms.map((room) => {
        const Icon = SPOT_ICON_MAP[room.icon] || MapPin;
        const c = CATEGORY_COLORS[room.category] || CATEGORY_COLORS.common;
        return (
          <TouchableOpacity
            key={room.slug}
            style={styles.card}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel={`Open ${room.name} chat`}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
              onOpenRoom(room.slug);
            }}
          >
            <View style={[styles.icon, { backgroundColor: c.bg }]}>
              {room.emoji ? <Text style={styles.emoji}>{room.emoji}</Text> : <Icon size={16} color={c.fg} />}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={T.h3} numberOfLines={1}>{room.name}</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
                {room.activeUserCount > 0 && (
                  <View style={styles.live}>
                    <Wifi size={9} color="#166534" />
                    <Text style={styles.liveText}>{room.activeUserCount} here</Text>
                  </View>
                )}
                {!!room.subtitle && <Text style={[T.small, { flexShrink: 1 }]} numberOfLines={1}>{room.subtitle}</Text>}
              </View>
            </View>
            <ChevronRight size={14} color={CampusColors.muted} />
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: CampusColors.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: CampusColors.line,
    paddingHorizontal: 12,
    paddingVertical: 10,
    width: 230,
  },
  icon: { width: 32, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  emoji: { fontSize: 17 },
  live: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: '#DCFCE7', paddingHorizontal: 5, paddingVertical: 1, borderRadius: R.pill },
  liveText: { fontSize: 12, fontWeight: '800', color: '#166534' },
  empty: { paddingVertical: S.lg, alignItems: 'center', backgroundColor: CampusColors.card, borderRadius: R.card, borderWidth: 1, borderColor: CampusColors.line },
});
