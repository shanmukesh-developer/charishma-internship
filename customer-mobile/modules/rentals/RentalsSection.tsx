/**
 * Others > Rentals tab: student-to-student vehicle rentals ("Student vehicles") with a prominent
 * "Rent out or lend your vehicle" call to action, plus the existing rental stores (category/rentals).
 */
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Dimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import SafeImage from '../../components/SafeImage';
import { useAuth } from '../../context/AuthContext';
import { readCache, writeCache } from '../../utils/swrCache';
import { Ionicons } from '@expo/vector-icons';
import { rentalsApi, type Eligibility, type Listing, VEHICLE_META, priceLabel, RentalsError, wordsOf, tripsLabel, ratingLabel } from './rentalsApi';
import { usePalette, Btn, Badge, Stars, useRentalLive, GRAD, VEHICLE_FALLBACK, RIcon } from './ui';

const { width: SW } = Dimensions.get('window');
const CARD_W = Math.min(240, SW * 0.62);

export default function RentalsSection() {
  const router = useRouter();
  const p = usePalette();
  const { user } = useAuth();
  const uid = String((user as any)?._id || (user as any)?.id || '');
  const cacheKey = uid ? `rentals:browse:${uid}` : '';
  const [elig, setElig] = useState<Eligibility | null>(null);
  const [listings, setListings] = useState<Listing[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!uid) return;
    try {
      const [e, b] = await Promise.all([rentalsApi.eligibility(), rentalsApi.browse({ sort: 'recent' }).catch((err: RentalsError) => {
        if (err.code === 'FEATURE_OFF') return { listings: [] as Listing[], count: 0, campus: null };
        throw err;
      })]);
      setElig(e);
      setListings(b.listings);
      setError(null);
      if (cacheKey) writeCache(cacheKey, b.listings);
    } catch (err: any) {
      setError(err?.message || 'Could not load rentals.');
    }
  }, [uid, cacheKey]);

  useEffect(() => {
    let cancelled = false;
    if (cacheKey) readCache<Listing[]>(cacheKey).then((c) => { if (!cancelled && c && Array.isArray(c.data)) setListings((cur) => cur || c.data); });
    load();
    return () => { cancelled = true; };
  }, [cacheKey, load]);
  useRentalLive(() => load(), !!uid);

  const goList = () => {
    if (!uid) return router.push('/login' as any);
    if (elig && !elig.eligible) return router.push('/friends?screen=verification' as any);
    router.push('/rentals/new' as any);
  };

  if (!uid) {
    return (
      <View style={{ paddingHorizontal: 16 }}>
        <Hero onCta={goList} />
        <View style={{ alignItems: 'center', paddingVertical: 24 }}>
          <Text style={{ color: p.sub, fontSize: 12.5, textAlign: 'center' }}>Sign in with your student account to rent, borrow or list vehicles.</Text>
          <Btn label="Sign in" small onPress={() => router.push('/login' as any)} style={{ marginTop: 12 }} />
        </View>
        <StoresCard />
      </View>
    );
  }

  return (
    <View style={{ paddingHorizontal: 16 }}>
      {elig && !elig.enabled ? (
        <View style={{ padding: 14, borderRadius: 16, backgroundColor: p.warnSoft, marginBottom: 12 }}>
          <Text style={{ color: p.text, fontWeight: '800', fontSize: 12.5 }}>Student vehicle rentals are paused right now. Your existing trips still work.</Text>
        </View>
      ) : null}
      <Hero onCta={goList} eligible={!elig || elig.eligible} />

      {elig && !elig.eligible ? (
        <TouchableOpacity onPress={() => router.push('/friends?screen=verification' as any)} style={{ padding: 12, borderRadius: 14, backgroundColor: p.accentSoft, marginBottom: 12 }} accessibilityRole="button">
          <Text style={{ color: p.text, fontSize: 12.5, fontWeight: '700' }}>{elig.message || 'Verify your college to list, rent or borrow vehicles.'} <Text style={{ color: p.accent, fontWeight: '900' }}>Verify now ›</Text></Text>
        </TouchableOpacity>
      ) : null}

      <View style={{ flexDirection: 'row', gap: 8, marginBottom: 16 }}>
        <Quick icon="receipt-outline" label="My bookings" badge={elig?.openRequests ? `${elig.openRequests}` : undefined} onPress={() => router.push((elig?.openRequests ? '/rentals/bookings?role=owner' : '/rentals/bookings') as any)} />
        <Quick icon="key-outline" label="My vehicles" onPress={() => router.push('/rentals/my-listings' as any)} />
        <Quick icon={elig?.licence?.status === 'VERIFIED' ? 'shield-checkmark-outline' : 'card-outline'} label={elig?.licence ? (elig.licence.status === 'VERIFIED' ? 'Licence verified' : 'Licence') : 'Add licence'} onPress={() => router.push('/rentals/licence' as any)} />
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <View>
          <Text style={{ fontSize: 11, fontWeight: '800', color: p.accent, letterSpacing: 0.2 }}>Verified students only</Text>
          <Text style={{ fontSize: 16, fontWeight: '900', color: p.text, marginTop: 2 }}>Student vehicles</Text>
        </View>
        <TouchableOpacity onPress={() => router.push('/rentals' as any)} accessibilityRole="button" accessibilityLabel="See all student vehicles">
          <Text style={{ color: p.accent, fontWeight: '900', fontSize: 12 }}>See all ›</Text>
        </TouchableOpacity>
      </View>

      {listings === null && !error ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
          {[0, 1].map((i) => <View key={i} style={{ width: CARD_W, height: 210, borderRadius: 18, backgroundColor: p.card2 }} />)}
        </ScrollView>
      ) : error && !listings ? (
        <TouchableOpacity onPress={load} style={{ padding: 16, borderRadius: 16, borderWidth: 1, borderColor: p.border }} accessibilityRole="button">
          <Text style={{ color: p.sub, fontSize: 12.5 }}>{error} <Text style={{ color: p.accent, fontWeight: '900' }}>Retry</Text></Text>
        </TouchableOpacity>
      ) : (listings || []).length === 0 ? (
        <View style={{ padding: 18, borderRadius: 18, borderWidth: 1, borderColor: p.border, alignItems: 'center' }}>
          <Ionicons name="bicycle-outline" size={32} color={p.accent} />
          <Text style={{ color: p.text, fontWeight: '900', marginTop: 6 }}>No student vehicles yet</Text>
          <Text style={{ color: p.sub, fontSize: 12, textAlign: 'center', marginTop: 4 }}>Be the first: rent out a commercial-plate vehicle, or lend your own bike, scooter or car to classmates.</Text>
        </View>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingRight: 16 }}>
          {(listings || []).slice(0, 8).map((l) => <MiniCard key={l.id} l={l} onPress={() => router.push(`/rentals/${l.id}` as any)} />)}
        </ScrollView>
      )}

      <StoresCard />
    </View>
  );
}

function Hero({ onCta, eligible = true }: { onCta: () => void; eligible?: boolean }) {
  return (
    <LinearGradient colors={GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ borderRadius: 22, padding: 18, marginBottom: 12, marginTop: 4 }}>
      <Text style={{ fontSize: 11, fontWeight: '800', color: 'rgba(255,255,255,0.85)', letterSpacing: 0.2 }}>Zenvy Rentals · student to student</Text>
      <Text style={{ fontSize: 21, fontWeight: '900', color: '#fff', marginTop: 4, letterSpacing: -0.4 }}>Rent or borrow a ride from a classmate</Text>
      <Text style={{ fontSize: 12, color: 'rgba(255,255,255,0.9)', marginTop: 6, lineHeight: 17 }}>Bikes, scooters and cars from college-verified students. Commercial-plate vehicles are rented, private ones are borrowed. Pick up with a PIN, pay cash at pickup.</Text>
      <TouchableOpacity onPress={onCta} accessibilityRole="button" accessibilityLabel="Rent out or lend your vehicle" activeOpacity={0.9}
        style={{ marginTop: 14, backgroundColor: '#fff', borderRadius: 14, paddingVertical: 13, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View>
          <Text style={{ fontSize: 14.5, fontWeight: '900', color: '#0F172A' }}>Rent out or lend your vehicle</Text>
          <Text style={{ fontSize: 11, color: '#475569', marginTop: 1 }}>{eligible ? 'List it in 5 minutes · you set the rent or cost share' : 'Verify your college first'}</Text>
        </View>
        <Ionicons name="chevron-forward" size={20} color="#0EA5E9" />
      </TouchableOpacity>
    </LinearGradient>
  );
}

function Quick({ icon, label, onPress, badge }: { icon: string; label: string; onPress: () => void; badge?: string }) {
  const p = usePalette();
  return (
    <TouchableOpacity onPress={onPress} accessibilityRole="button" accessibilityLabel={label} style={{ flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: 16, borderWidth: 1, borderColor: p.border, backgroundColor: p.card }}>
      <RIcon name={icon} size={20} color={p.accent} />
      <Text style={{ fontSize: 11, fontWeight: '800', color: p.text, marginTop: 4 }} numberOfLines={1}>{label}</Text>
      {badge ? <View style={{ position: 'absolute', top: 6, right: 10, backgroundColor: '#EF4444', borderRadius: 9, minWidth: 18, paddingHorizontal: 5, alignItems: 'center' }}><Text style={{ color: '#fff', fontSize: 10, fontWeight: '900' }}>{badge}</Text></View> : null}
    </TouchableOpacity>
  );
}

export function MiniCard({ l, onPress, width = CARD_W }: { l: Listing; onPress: () => void; width?: number }) {
  const p = usePalette();
  const meta = VEHICLE_META[l.vehicleType];
  const w = wordsOf(l);
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.9} accessibilityRole="button" accessibilityLabel={`${w.verb}: ${l.title}, ${priceLabel(l)}`}
      style={{ width, borderRadius: 18, borderWidth: 1, borderColor: p.border, backgroundColor: p.card, overflow: 'hidden' }}>
      <View style={{ height: 120, backgroundColor: p.card2 }}>
        {l.photos[0] ? <SafeImage source={{ uri: l.photos[0] }} style={{ width: '100%', height: '100%' }} contentFit="cover" fallbackUri={VEHICLE_FALLBACK} /> : <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><RIcon name={meta.icon} size={40} color={p.muted} /></View>}
        <View style={{ position: 'absolute', top: 8, left: 8 }}><Badge label={meta.label} color="#0EA5E9" /></View>
        <View style={{ position: 'absolute', bottom: 8, left: 8 }}><Badge label={w.badge} color={w.color} /></View>
        {l.isMine ? <View style={{ position: 'absolute', top: 8, right: 8 }}><Badge label="Yours" color="#8B5CF6" /></View> : null}
      </View>
      <View style={{ padding: 10 }}>
        <Text style={{ fontSize: 13.5, fontWeight: '900', color: p.text }} numberOfLines={1}>{l.title}{l.year ? ` · ${l.year}` : ''}</Text>
        <Text style={{ fontSize: 12, fontWeight: '800', color: p.success, marginTop: 3 }} numberOfLines={1}>{priceLabel(l)}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 5 }}>
          {l.ratingCount > 0 ? <><Stars value={l.ratingAvg} size={11} /><Text style={{ fontSize: 10.5, color: p.sub }}>{ratingLabel(l.ratingAvg)} · {tripsLabel(l.tripCount)}</Text></> : <Text style={{ fontSize: 10.5, color: p.sub }}>New · {l.pickupLocation || 'On campus'}</Text>}
        </View>
      </View>
    </TouchableOpacity>
  );
}

function StoresCard() {
  const p = usePalette();
  const router = useRouter();
  return (
    <TouchableOpacity onPress={() => router.push('/category/rentals' as any)} accessibilityRole="button" accessibilityLabel="Rental stores"
      style={{ marginTop: 18, marginBottom: 8, flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 18, borderWidth: 1, borderColor: p.border, backgroundColor: p.card }}>
      <Ionicons name="storefront-outline" size={26} color={p.accent} />
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 14, fontWeight: '900', color: p.text }}>Rental stores</Text>
        <Text style={{ fontSize: 11.5, color: p.sub, marginTop: 2 }}>Cycles, scooters and more from campus rental partners</Text>
      </View>
      <Text style={{ color: p.accent, fontWeight: '900' }}>›</Text>
    </TouchableOpacity>
  );
}
