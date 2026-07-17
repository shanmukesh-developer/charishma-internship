import React, { useState, useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Image, Linking, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { COLORS, SHADOWS } from '../constants/theme';
import { useTheme } from '../context/ThemeContext';
import { API_URL } from '../constants/api';

const CAMPUSES = [
  { code: 'ALL', label: 'All Campuses', emoji: '🌐' },
  { code: 'SRM', label: 'SRM University', emoji: '🏛️' },
  { code: 'VIT', label: 'VIT Vellore', emoji: '🎓' },
  { code: 'AMRITA', label: 'Amrita Vishwa Vidyapeetham', emoji: '📚' },
];

interface CampusBitesSectionProps {
  restaurants: any[];
}

export default function CampusBitesSection({ restaurants }: CampusBitesSectionProps) {
  const router = useRouter();
  const { isDark } = useTheme();
  const [selectedCampus, setSelectedCampus] = useState('ALL');
  const [stallSearch, setStallSearch] = useState('');

  // 1. Check if there are any local vendors
  const localVendors = useMemo(() => {
    return restaurants
      .filter(r => {
        const vt = (r.vendorType || '').toUpperCase();
        return vt === 'LOCAL_VENDOR';
      })
      .filter(r => {
        if (selectedCampus === 'ALL') return true;
        return (r.campus || '').toUpperCase() === selectedCampus;
      })
      .filter(r => {
        if (!stallSearch) return true;
        const q = stallSearch.toLowerCase();
        return (
          (r.name || '').toLowerCase().includes(q) ||
          (r.stallDescription || '').toLowerCase().includes(q) ||
          (r.menu || []).some((item: any) => (item.name || '').toLowerCase().includes(q))
        );
      })
      .sort((a, b) => {
        const aTier = a.subscriptionTier === 'premium' ? 1 : 0;
        const bTier = b.subscriptionTier === 'premium' ? 1 : 0;
        if (bTier !== aTier) return bTier - aTier;
        return (Number(b.rating) || 0) - (Number(a.rating) || 0);
      });
  }, [restaurants, selectedCampus, stallSearch]);

  const hasAnyLocalVendors = useMemo(() => {
    return restaurants.some(r => (r.vendorType || '').toUpperCase() === 'LOCAL_VENDOR');
  }, [restaurants]);

  if (!hasAnyLocalVendors) return null;

  // 2. Check open status helper
  const isVendorOpen = (vendor: any): boolean => {
    if (!vendor.operatingHours) return vendor.isOpenNow !== false;
    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const [startH, startM] = (vendor.operatingHours.start || '00:00').split(':').map(Number);
    const [endH, endM] = (vendor.operatingHours.end || '23:59').split(':').map(Number);
    const startMinutes = startH * 60 + startM;
    const endMinutes = endH * 60 + endM;
    if (endMinutes < startMinutes) {
      return currentMinutes >= startMinutes || currentMinutes <= endMinutes;
    }
    return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
  };

  const trackClick = (vendorId: string) => {
    fetch(`${API_URL}/api/restaurants/${vendorId}/click`, { method: 'POST' }).catch(() => {});
  };

  const getWhatsAppLink = (vendor: any) => {
    const phone = vendor.whatsappNumber || '919391955674';
    const campusName = CAMPUSES.find(c => c.code === vendor.campus)?.label || vendor.campus || 'Campus';
    const msg = `Hi! I'd like to order from ${vendor.name} via CampusBites (Zenvy). My campus: ${campusName}.`;
    return `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`;
  };

  const getCallLink = (vendor: any) => {
    const phone = vendor.whatsappNumber || '919391955674';
    return `tel:+${phone}`;
  };

  const bg = isDark ? COLORS.bgDark : COLORS.bgLight;
  const cardBg = isDark ? COLORS.bgCard : '#FFF';
  const txt = isDark ? COLORS.textPrimary : COLORS.textDark;
  const txtSec = isDark ? COLORS.textSecondary : COLORS.textDarkSecondary;
  const border = isDark ? COLORS.borderDark : COLORS.borderLight;

  return (
    <View style={s.section}>
      {/* Header */}
      <View style={s.headerRow}>
        <View style={s.headerLeft}>
          <View style={s.badgeRow}>
            <View style={s.badgeIconWrap}><Text style={{ fontSize: 11 }}>🏪</Text></View>
            <Text style={s.badgeTag}>CAMPUSBITES</Text>
          </View>
          <Text style={[s.sectionTitle, { color: txt }]}>
            LOCAL <Text style={{ color: COLORS.gold }}>VENDOR STALLS</Text>
          </Text>
          <Text style={[s.sectionDesc, { color: txtSec }]}>
            DISCOVER ROADSIDE FOOD STALLS NEAR YOUR CAMPUS. BROWSE MENUS & ORDER VIA WHATSAPP OR CALL.
          </Text>
        </View>
      </View>

      {/* Campus Selector Scroll */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.campusScroll}>
        {CAMPUSES.map(c => {
          const isActive = selectedCampus === c.code;
          return (
            <TouchableOpacity
              key={c.code}
              style={[
                s.campusPill,
                { backgroundColor: cardBg, borderColor: isActive ? COLORS.gold : border },
                isActive && s.campusPillActive
              ]}
              onPress={() => setSelectedCampus(c.code)}
            >
              <Text style={{ fontSize: 12, marginRight: 4 }}>{c.emoji}</Text>
              <Text style={[s.campusLabel, { color: isActive ? '#000' : txt }]}>
                {c.code === 'ALL' ? 'All' : c.code}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* Search Input */}
      <View style={[s.searchWrap, { backgroundColor: cardBg, borderColor: border }]}>
        <Text style={{ fontSize: 14, color: txtSec }}>🔍</Text>
        <TextInput
          style={[s.searchInput, { color: txt }]}
          placeholder="Search local stalls, dishes..."
          placeholderTextColor={txtSec}
          value={stallSearch}
          onChangeText={setStallSearch}
        />
      </View>

      {/* Vendor Cards List */}
      {localVendors.length === 0 ? (
        <View style={[s.emptyState, { backgroundColor: cardBg, borderColor: border }]}>
          <Text style={{ fontSize: 32, marginBottom: 8 }}>🏪</Text>
          <Text style={[s.emptyText, { color: txtSec }]}>
            {stallSearch ? 'NO STALLS MATCH YOUR SEARCH' : 'NO LOCAL VENDORS AVAILABLE YET'}
          </Text>
        </View>
      ) : (
        localVendors.map(vendor => {
          const isPremium = vendor.subscriptionTier === 'premium';
          const isOpen = isVendorOpen(vendor);
          const vendorImg = vendor.imageUrl || vendor.image || 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=200';

          return (
            <TouchableOpacity
              key={vendor._id || vendor.id}
              activeOpacity={0.95}
              style={[
                s.card,
                { backgroundColor: cardBg, borderColor: isPremium ? COLORS.goldBorder : border },
                !isOpen && { opacity: 0.75 }
              ]}
              onPress={() => {
                trackClick(vendor._id || vendor.id);
                const { playSound } = require('../utils/sounds');
                playSound(isPremium ? 'premiumRestaurantTransition' : 'click');
                router.push(`/restaurant/${vendor._id || vendor.id}` as any);
              }}
            >
              {/* Premium Header Rib */}
              {isPremium && (
                <View style={s.featuredBadge}>
                  <Text style={s.featuredText}>⭐ FEATURED</Text>
                </View>
              )}

              <View style={s.cardBody}>
                {/* Image Wrap */}
                <View style={[s.imageWrap, { borderColor: border }]}>
                  <Image source={{ uri: vendorImg }} style={s.cardImg} />
                  <View style={[s.statusChip, { backgroundColor: isOpen ? 'rgba(34,197,94,0.9)' : 'rgba(239,68,68,0.9)' }]}>
                    <View style={s.statusDot} />
                    <Text style={s.statusText}>{isOpen ? 'OPEN' : 'CLOSED'}</Text>
                  </View>
                </View>

                {/* Right Info */}
                <View style={s.info}>
                  <Text style={[s.nameText, { color: txt }]} numberOfLines={1}>{vendor.name.toUpperCase()}</Text>
                  
                  <View style={s.metaRow}>
                    <View style={s.campusTag}><Text style={s.campusTagText}>{vendor.campus || 'CAMPUS'}</Text></View>
                    <Text style={[s.ratingText, { color: txt }]}>⭐ {Number(vendor.rating || 4.5).toFixed(1)}</Text>
                  </View>

                  <Text style={[s.descText, { color: txtSec }]} numberOfLines={2}>
                    {vendor.stallDescription || vendor.description || 'Local food stall near campus.'}
                  </Text>

                  {vendor.promoOffer && (
                    <View style={s.promoWrap}>
                      <Text style={s.promoText}>{vendor.promoOffer.toUpperCase()}</Text>
                    </View>
                  )}
                </View>
              </View>

              {/* Bottom Actions Row */}
              <View style={[s.bottomRow, { borderTopColor: border }]}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  <Text style={[s.hoursText, { color: txtSec }]}>
                    🕐 {vendor.operatingHours ? `${vendor.operatingHours.start} - ${vendor.operatingHours.end}` : 'Hours vary'}
                  </Text>
                  {vendor.menu && vendor.menu.length > 0 && (
                    <Text style={[s.hoursText, { color: txtSec }]}>
                      📋 {vendor.menu.length} items
                    </Text>
                  )}
                </View>

                <View style={s.actions}>
                  <TouchableOpacity
                    style={{ marginRight: 6, justifyContent: 'center' }}
                    onPress={() => {
                      trackClick(vendor._id || vendor.id);
                      const { playSound } = require('../utils/sounds');
                      playSound(isPremium ? 'premiumRestaurantTransition' : 'click');
                      router.push(`/restaurant/${vendor._id || vendor.id}` as any);
                    }}
                  >
                    <Text style={{ color: COLORS.gold, fontSize: 8, fontWeight: '900', letterSpacing: 0.5 }}>VIEW MENU →</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[s.actionBtn, s.callBtn]}
                    onPress={() => {
                      trackClick(vendor._id || vendor.id);
                      Linking.openURL(getCallLink(vendor));
                    }}
                  >
                    <Text style={s.callText}>📞 CALL</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[s.actionBtn, s.orderBtn]}
                    onPress={() => {
                      trackClick(vendor._id || vendor.id);
                      Linking.openURL(getWhatsAppLink(vendor));
                    }}
                  >
                    <Text style={s.orderText}>💬 ORDER</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </TouchableOpacity>
          );
        })
      )}

      {/* Footer disclaimer */}
      <Text style={[s.disclaimer, { color: txtSec }]}>
        Zenvy acts as a discovery platform. Orders are placed directly with vendors via WhatsApp or Call.
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  section: { paddingHorizontal: 16, marginBottom: 24 },
  headerRow: { marginBottom: 12 },
  headerLeft: {},
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  badgeIconWrap: { width: 22, height: 22, borderRadius: 6, backgroundColor: COLORS.gold, alignItems: 'center', justifyContent: 'center' },
  badgeTag: { fontSize: 8, fontWeight: '900', color: COLORS.gold, letterSpacing: 2 },
  sectionTitle: { fontSize: 18, fontWeight: '900', letterSpacing: -0.5, fontStyle: 'italic' },
  sectionDesc: { fontSize: 8, fontWeight: '700', letterSpacing: 1, marginTop: 4, lineHeight: 12 },

  campusScroll: { marginBottom: 12 },
  campusPill: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, borderWidth: 1, marginRight: 8 },
  campusPillActive: { backgroundColor: COLORS.gold, borderColor: COLORS.gold },
  campusLabel: { fontSize: 9, fontWeight: '900', letterSpacing: 1 },

  searchWrap: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, height: 42, borderRadius: 12, borderWidth: 1, gap: 8, marginBottom: 16 },
  searchInput: { flex: 1, fontSize: 11, fontWeight: '600' },

  emptyState: { padding: 32, borderRadius: 20, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  emptyText: { fontSize: 9, fontWeight: '900', letterSpacing: 2 },

  card: { borderRadius: 20, borderWidth: 1, marginBottom: 14, overflow: 'hidden', padding: 14, position: 'relative' },
  featuredBadge: { position: 'absolute', top: 0, right: 0, backgroundColor: COLORS.gold, paddingHorizontal: 10, paddingVertical: 4, borderBottomLeftRadius: 10 },
  featuredText: { fontSize: 7, fontWeight: '900', color: '#000', letterSpacing: 1 },

  cardBody: { flexDirection: 'row', gap: 12 },
  imageWrap: { width: 80, height: 80, borderRadius: 12, overflow: 'hidden', borderWidth: 1, position: 'relative' },
  cardImg: { width: '100%', height: '100%' },
  statusChip: { position: 'absolute', bottom: 4, left: 4, flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8 },
  statusDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: '#FFF' },
  statusText: { color: '#FFF', fontSize: 6, fontWeight: '900', letterSpacing: 1 },

  info: { flex: 1 },
  nameText: { fontSize: 13, fontWeight: '900', letterSpacing: 0.5 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  campusTag: { backgroundColor: 'rgba(251,146,60,0.1)', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  campusTagText: { color: '#FB923C', fontSize: 7, fontWeight: '900', letterSpacing: 1 },
  ratingText: { fontSize: 9, fontWeight: '700' },
  descText: { fontSize: 9, fontWeight: '600', marginTop: 6, lineHeight: 12 },
  promoWrap: { alignSelf: 'flex-start', backgroundColor: 'rgba(251,191,36,0.1)', borderWidth: 1, borderColor: 'rgba(251,191,36,0.2)', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, marginTop: 6 },
  promoText: { color: '#FBBF24', fontSize: 7, fontWeight: '900', letterSpacing: 0.5 },

  bottomRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 12, paddingTop: 10, borderWidth: 0, borderTopWidth: 1 },
  hoursText: { fontSize: 8, fontWeight: '700', letterSpacing: 0.5 },
  actions: { flexDirection: 'row', gap: 6 },
  actionBtn: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, borderWidth: 1 },
  callBtn: { backgroundColor: 'rgba(59,130,246,0.1)', borderColor: 'rgba(59,130,246,0.2)' },
  callText: { color: '#3B82F6', fontSize: 7, fontWeight: '900', letterSpacing: 1 },
  orderBtn: { backgroundColor: 'rgba(16,185,129,0.1)', borderColor: 'rgba(16,185,129,0.2)' },
  orderText: { color: '#10B981', fontSize: 7, fontWeight: '900', letterSpacing: 1 },

  disclaimer: { fontSize: 7, fontWeight: '700', letterSpacing: 0.5, textAlign: 'center', marginTop: 12, lineHeight: 10 }
});
