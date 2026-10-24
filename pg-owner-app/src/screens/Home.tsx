// Dashboard ("Owner Dashboard" reference): building + "Owner", Total / Occupied / Vacant bed tiles, the new
// booking requests call-out, then every section as one menu list (badges on Booking requests / Complaints).
import React from 'react';
import { Image, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { color, font, radius, space } from '../theme';
import { Button, Card, ErrorStrip, SkeletonCard } from '../ui/kit';
import { Banner, MenuGroup, MenuRow, OfflineBanner, StatTile } from '../ui/Screen';
import { ListingSwitcher } from '../ui/ListingSwitcher';
import { useHome } from '../state/HomeProvider';
import { useListing } from '../state/ListingProvider';
import { useSession } from '../state/SessionProvider';
import { imageUrl } from '../lib/photo';
import { monthLabel } from '../lib/format';
import type { TabKey } from '../nav';

export interface TabProps {
  /** Open a pushed stack screen. */
  open: (screen: 'Requests' | 'Tenants' | 'Complaints' | 'Building' | 'Notifications' | 'Settings') => void;
  /** Switch bottom tab. */
  go: (tab: TabKey) => void;
}

export default function HomeTab({ open, go }: TabProps) {
  const insets = useSafeAreaInsets();
  const { owner } = useSession();
  const { home, error, refreshing, refresh } = useHome();
  const { current, reload } = useListing();
  const summary = home?.listings.find((l) => l.id === current?.id) || home?.listings[0] || null;
  const beds = summary?.beds;
  const counts = home?.counts;
  const cover = imageUrl(summary?.coverPhoto);

  const onRefresh = () => { refresh(); reload(); };

  return (
    <View style={{ flex: 1, backgroundColor: color.bg }}>
      <View style={[st.head, { paddingTop: insets.top + space.sm }]}>
        <View style={st.avatar}>
          {cover ? <Image source={{ uri: cover }} style={st.avatarImg} accessibilityIgnoresInvertColors /> : <Ionicons name="business" size={26} color={color.primary} />}
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[font.h2, { color: color.text }]} numberOfLines={1} accessibilityRole="header">{summary?.name || current?.name || 'Your PG'}</Text>
          <Text style={[font.small, { color: color.textMuted }]} numberOfLines={1}>Owner{owner?.name ? ` · ${owner.name}` : ''}</Text>
        </View>
        <ListingSwitcher />
      </View>
      <OfflineBanner />
      <ScrollView contentContainerStyle={st.body} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={color.primary} colors={[color.primary]} />}>
        {!owner?.listings.length ? (
          <Banner tone="warn" title="No PG linked yet" text="The ZCS housing team links your PG listing to this account. Call support if you expected to see it here." />
        ) : null}
        {error && !home ? <ErrorStrip text={error} onRetry={refresh} busy={refreshing} /> : null}

        {beds ? (
          <View style={st.tiles}>
            <StatTile label="Total beds" value={String(beds.total)} icon="bed-outline" />
            <StatTile label="Occupied" value={String(beds.occupied)} icon="people-outline" tint={color.violet} />
            <StatTile label="Vacant" value={String(beds.vacant)} icon="checkmark-circle-outline" tint={color.ok} />
          </View>
        ) : !home ? <SkeletonCard lines={2} /> : null}

        {summary && !summary.isActive ? <Banner tone="warn" text="This PG is hidden from students right now. The ZCS team can list it again." /> : null}

        {counts && counts.pendingRequests > 0 ? (
          <Card style={st.callout}>
            <View style={st.calloutIcon}><Ionicons name="mail-unread-outline" size={22} color={color.textInverse} /></View>
            <View style={{ flex: 1 }}>
              <Text style={[font.h3, { color: color.text }]}>{counts.pendingRequests} new booking request{counts.pendingRequests === 1 ? '' : 's'}</Text>
              <Text style={[font.small, { color: color.textMuted }]}>Students are waiting for your answer.</Text>
            </View>
            <Button label="Review" size="secondary" onPress={() => open('Requests')} style={{ paddingHorizontal: space.md }} />
          </Card>
        ) : null}

        <MenuGroup>
          <MenuRow icon="bed-outline" title="Rooms & Tenants" sub={beds ? `${beds.rooms} room${beds.rooms === 1 ? '' : 's'} · ${counts?.tenants ?? 0} tenant${counts?.tenants === 1 ? '' : 's'}` : undefined} onPress={() => go('rooms')} />
          <MenuRow icon="calendar-outline" title="Mess Timetable & Menu" onPress={() => go('mess')} />
          <MenuRow icon="wallet-outline" title="Rent & Payments" sub={counts && home ? `${monthLabel(home.month)}: ${counts.rentReceived} received · ${counts.rentDue} due` : undefined} onPress={() => go('payments')} />
          <MenuRow icon="file-tray-full-outline" title="Booking Requests" badge={counts?.pendingRequests || 0} onPress={() => open('Requests')} />
          <MenuRow icon="chatbox-ellipses-outline" title="Complaints" badge={counts?.openComplaints || 0} onPress={() => open('Complaints')} />
          <MenuRow icon="business-outline" title="Building Info" sub="Description, rules, amenities, photos" onPress={() => open('Building')} />
          <MenuRow icon="settings-outline" title="Settings" onPress={() => open('Settings')} last />
        </MenuGroup>
        <Text style={[font.small, { color: color.textMuted, textAlign: 'center' }]}>
          Students reach you through the ZCS housing desk. Rent is paid at the PG; this app keeps the record.
        </Text>
      </ScrollView>
    </View>
  );
}

const st = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.md, paddingBottom: space.sm, backgroundColor: color.surface, borderBottomWidth: 1, borderBottomColor: color.border },
  avatar: { width: 52, height: 52, borderRadius: 26, backgroundColor: color.primaryTint, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', borderWidth: 2, borderColor: color.primarySoft },
  avatarImg: { width: '100%', height: '100%' },
  body: { padding: space.md, gap: space.md, paddingBottom: space.xl },
  tiles: { flexDirection: 'row', gap: space.sm },
  callout: { flexDirection: 'row', alignItems: 'center', gap: space.sm, borderColor: color.primarySoft, backgroundColor: color.primaryTint },
  calloutIcon: { width: 40, height: 40, borderRadius: radius.md, backgroundColor: color.primary, alignItems: 'center', justifyContent: 'center' },
});
