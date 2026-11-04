/**
 * Rentals v2 home (night): hero top, category grid, near your campus, popular this week, then the student's
 * own rentals shortcuts (My rentals, My vehicles, Licence), "List your vehicle" and the rental stores link,
 * which the old Rentals tab had and the board leaves out. Pull to refresh reloads the real data.
 */
import React, { useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useAuth } from '../../context/AuthContext';
import { NIGHT, W } from './rentalsV2Theme';
import { HomeTop } from './RentalsV2HomeTop';
import { PopularWeek, g } from './RentalsV2HomeGrid';
import { CategoryGrid, NearCampus } from './RentalsV2CategoryCards';
import { FadeInUp, Press } from './RentalsV2Kit';
import { IArrowRight, IChevronRight, IIdCard, IKey, IReceipt } from './RentalsV2Icons';
import { reloadAll, useRentalsV2 } from './rentalsV2Data';
import { useNav } from './rentalsV2Nav';
import { themedSheet } from '../../utils/themeNow';

function YourRentals() {
  const nav = useNav();
  const router = useRouter();
  const { user } = useAuth();
  const { elig, featureOff } = useRentalsV2();
  const signedIn = !!user;
  const go = (path: string) => router.push((signedIn ? path : '/login') as any);
  const listVehicle = () => {
    if (!signedIn) return router.push('/login' as any);
    if (elig && !elig.eligible) return router.push('/friends?screen=verification' as any);
    router.push('/rentals/new' as any);
  };
  const licence = elig?.licence ? (elig.licence.status === 'VERIFIED' ? 'Licence verified' : 'Licence in review') : 'Add licence';
  const tiles = [
    { key: 'mine', label: 'My rentals', Icon: IReceipt, badge: elig?.openRequests || 0, onPress: () => (signedIn ? nav.push({ name: 'mine', role: elig?.openRequests ? 'owner' : undefined }) : router.push('/login' as any)) },
    { key: 'veh', label: 'My vehicles', Icon: IKey, badge: 0, onPress: () => go('/rentals/my-listings') },
    { key: 'lic', label: licence, Icon: IIdCard, badge: 0, onPress: () => go('/rentals/licence') },
  ];
  return (
    <View style={{ marginTop: 24, paddingHorizontal: 10 }}>
      <Text style={[g.secTitle, { paddingHorizontal: 6, marginBottom: 11 }]}>Your rentals</Text>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {tiles.map((t, i) => (
          <FadeInUp key={t.key} index={i} style={{ flex: 1 }}>
            <Press onPress={t.onPress} label={t.label} style={h.tile}>
              <View style={h.tileIcon}><t.Icon size={18} color="#E9E3FF" strokeWidth={1.6} /></View>
              <Text style={h.tileText} numberOfLines={1}>{t.label}</Text>
              {t.badge ? <View style={h.badge}><Text style={h.badgeText}>{t.badge}</Text></View> : null}
            </Press>
          </FadeInUp>
        ))}
      </View>
      {featureOff ? <Text style={[g.campusKm, { marginTop: 10, paddingHorizontal: 6 }]}>Student vehicle rentals are paused right now. Your existing trips still work.</Text> : null}
      <FadeInUp index={3}>
        <Press onPress={listVehicle} label="List your vehicle" style={h.list}>
          <LinearGradient colors={['#8673CA', '#6F5BB0', '#594496']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
          <LinearGradient colors={['rgba(255,255,255,0.22)', 'rgba(255,255,255,0)']} style={[StyleSheet.absoluteFill, { height: '55%' }]} />
          <View style={h.listIcon}><IKey size={20} color="#FFFFFF" strokeWidth={1.6} /></View>
          <View style={{ flex: 1 }}>
            <Text style={h.listTitle}>List your vehicle</Text>
            <Text style={h.listSub} numberOfLines={2}>{elig && !elig.eligible ? 'Verify your college email or ID first' : 'Rent out or lend your bike or car to verified students'}</Text>
          </View>
          <View style={h.listGo}><IArrowRight size={15} color="#5B3FE0" strokeWidth={2} /></View>
        </Press>
      </FadeInUp>
      <Press onPress={() => router.push('/category/rentals' as any)} label="Rental stores" style={[g.campus, { marginTop: 10, height: 52, paddingHorizontal: 14 }]}>
        <View style={{ flex: 1 }}>
          <Text style={g.campusName}>Rental stores</Text>
          <Text style={g.campusKm} numberOfLines={1}>Cycles, scooters and more from campus rental partners</Text>
        </View>
        <IChevronRight size={16} color={NIGHT.sub} strokeWidth={1.8} />
      </Press>
    </View>
  );
}

export function RentalsV2HomeBody({ sections }: { sections?: { key: string; label: string }[] }) {
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = async () => {
    setRefreshing(true);
    try { await reloadAll(); } finally { setRefreshing(false); }
  };
  return (
    <ScrollView style={{ flex: 1, backgroundColor: NIGHT.page }} contentContainerStyle={{ paddingBottom: 120 }} showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#C4B5FD" colors={['#7C5CF0']} progressViewOffset={60} />}>
      <HomeTop sections={sections} />
      <CategoryGrid />
      <NearCampus />
      <PopularWeek />
      <YourRentals />
    </ScrollView>
  );
}

const h = themedSheet(() => ({
  tile: { height: 74, borderRadius: 14, backgroundColor: NIGHT.chip, borderWidth: 1, borderColor: NIGHT.chipLine, alignItems: 'center', justifyContent: 'center', gap: 7, paddingHorizontal: 6 },
  tileIcon: { width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(167,139,250,0.18)', alignItems: 'center', justifyContent: 'center' },
  tileText: { color: '#FFFFFF', fontSize: 11.5, fontWeight: W.label },
  badge: { position: 'absolute', top: 7, right: 9, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: NIGHT.bellDot, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 },
  badgeText: { color: '#FFFFFF', fontSize: 11, fontWeight: W.title },
  list: { marginTop: 12, minHeight: 72, borderRadius: 18, overflow: 'hidden', flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 12 },
  listIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  listTitle: { color: '#FFFFFF', fontSize: 15, fontWeight: W.title },
  listSub: { color: 'rgba(255,255,255,0.85)', fontSize: 11.5, marginTop: 2, lineHeight: 15 },
  listGo: { width: 30, height: 30, borderRadius: 15, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
}));
