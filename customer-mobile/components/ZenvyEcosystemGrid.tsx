import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image } from 'react-native';
import { useRouter } from 'expo-router';
import { useTheme } from '../context/ThemeContext';
import { COLORS, SHADOWS } from '../constants/theme';
import DopaminePressable from './DopaminePressable';
import { StaggeredSection, BounceIn } from './AnimatedSection';

const ECOSYSTEM_SERVICES = [
  { id: 'mart', name: 'Zenvy Mart', emoji: '🛒', color: '#EAB308', bg: 'rgba(234, 179, 8, 0.1)' },
  { id: 'pharmacy', name: 'Pharmacy SOS', emoji: '⚕️', color: '#14B8A6', bg: 'rgba(20, 184, 166, 0.1)' },
  { id: 'laundry', name: 'Wash & Fold', emoji: '🧺', color: '#8B5CF6', bg: 'rgba(139, 92, 246, 0.1)' },
  { id: 'print', name: 'Print & Drop', emoji: '🖨️', color: '#9CA3AF', bg: 'rgba(156, 163, 175, 0.1)' },
  { id: 'grocery', name: 'Groceries', emoji: '🍎', color: '#22C55E', bg: 'rgba(34, 197, 94, 0.1)' },
  { id: 'meat', name: 'Meat & Fish', emoji: '🥩', color: '#EF4444', bg: 'rgba(239, 68, 68, 0.1)' },
  { id: 'bakery', name: 'Sweets', emoji: '🍰', color: '#EC4899', bg: 'rgba(236, 72, 153, 0.1)' },
  { id: 'rentals', name: 'Rentals', emoji: '🚲', color: '#3B82F6', bg: 'rgba(59, 130, 246, 0.1)' },
];

export default function ZenvyEcosystemGrid() {
  const router = useRouter();
  const { isDark } = useTheme();
  
  const txt = isDark ? COLORS.textPrimary : COLORS.textDark;
  const txtSec = isDark ? COLORS.textSecondary : COLORS.textDarkSecondary;
  const cardBg = isDark ? 'rgba(255, 255, 255, 0.08)' : COLORS.bgLightCard;
  const border = isDark ? 'rgba(255, 255, 255, 0.1)' : COLORS.borderLight;

  return (
    <View style={s.container}>
      <View style={s.header}>
        <Text style={[s.title, { color: txt }]}>MEGA MARKET</Text>
        <Text style={[s.sub, { color: txtSec }]}>YOUR CAMPUS ESSENTIALS</Text>
      </View>
      
      <View style={s.grid}>
        {ECOSYSTEM_SERVICES.map((service, index) => (
          <StaggeredSection key={service.id} delay={100 + index * 50} direction="up" style={{ width: '23%', marginBottom: 12 }}>
            <DopaminePressable 
              style={[s.card, { backgroundColor: cardBg, borderColor: border }]}
              onPress={() => router.push(`/category/${service.id}` as any)}
              sound="tabSwitch"
              activeScale={0.9}
            >
              <View style={[s.iconBox, { backgroundColor: service.bg, borderColor: service.color }]}>
                <Text style={{ fontSize: 24 }}>{service.emoji}</Text>
              </View>
              <Text style={[s.label, { color: txt }]} numberOfLines={1}>{service.name}</Text>
            </DopaminePressable>
          </StaggeredSection>
        ))}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  container: { marginHorizontal: 16, marginBottom: 24 },
  header: { marginBottom: 16 },
  title: { fontSize: 14, fontWeight: '900', letterSpacing: 2 },
  sub: { fontSize: 9, fontWeight: '700', letterSpacing: 3, marginTop: -2 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  card: { alignItems: 'center', padding: 8, borderRadius: 16, borderWidth: 1 },
  iconBox: { width: 50, height: 50, borderRadius: 16, borderWidth: 1, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  label: { fontSize: 9, fontWeight: '800', textAlign: 'center' }
});
