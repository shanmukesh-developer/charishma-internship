import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { useTheme } from '../context/ThemeContext';
import { COLORS } from '../constants/theme';
import DopaminePressable from './DopaminePressable';
import { StaggeredSection } from './AnimatedSection';

const ECOSYSTEM_SERVICES = [
  { id: 'repairs', name: 'Laptop Fix', emoji: '💻', color: '#3B82F6', bg: 'rgba(59, 130, 246, 0.15)', badge: 'DOORSTEP', route: '/others?tab=services' },
  { id: 'mattresses', name: 'Mattresses & Bed', emoji: '🛏️', color: '#EC4899', bg: 'rgba(236, 72, 153, 0.15)', badge: 'ROOM SET', route: '/category/mattresses' },
  { id: 'electronics', name: 'Electronics', emoji: '🔌', color: '#8B5CF6', bg: 'rgba(139, 92, 246, 0.15)', badge: 'HOT', route: '/category/electronics' },
  { id: 'rides', name: 'Bike pool', emoji: '🏍️', color: '#F59E0B', bg: 'rgba(245, 158, 11, 0.15)', badge: 'CO-RIDE', route: '/others?tab=rides' },
  { id: 'groceries', name: 'Kirana & Mart', emoji: '🛒', color: '#EAB308', bg: 'rgba(234, 179, 8, 0.15)', route: '/category/groceries' },
  { id: 'laundry', name: 'Wash & Fold', emoji: '🧺', color: '#06B6D4', bg: 'rgba(6, 182, 212, 0.15)', route: '/category/laundry' },
  { id: 'stays', name: 'Campus Stays', emoji: '🏨', color: '#6366F1', bg: 'rgba(99, 102, 241, 0.15)', route: '/others?tab=stays' },
];

export default function ZenvyEcosystemGrid() {
  const router = useRouter();
  const { isDark } = useTheme();
  
  const txt = isDark ? COLORS.textPrimary : COLORS.textDark;
  const txtSec = isDark ? COLORS.textSecondary : COLORS.textDarkSecondary;
  const cardBg = isDark ? 'rgba(255, 255, 255, 0.05)' : COLORS.bgLightCard;
  const border = isDark ? 'rgba(255, 255, 255, 0.08)' : COLORS.borderLight;

  return (
    <View style={s.container}>
      <View style={s.header}>
        <View style={s.titleRow}>
          <Text style={[s.title, { color: txt }]}>CAMPUS SUPER ECOSYSTEM</Text>
          <View style={s.superBadge}>
            <Text style={s.superBadgeText}>A TO Z</Text>
          </View>
        </View>
        <Text style={[s.sub, { color: txtSec }]}>EVERYTHING A HOSTELER & STUDENT NEEDS</Text>
      </View>
      
      <View style={s.grid}>
        {ECOSYSTEM_SERVICES.map((service, index) => (
          <StaggeredSection key={service.id} delay={60 + index * 30} direction="up" style={{ width: '23%', marginBottom: 12 }}>
            <DopaminePressable 
              style={[s.card, { backgroundColor: cardBg, borderColor: border }]}
              onPress={() => {
                router.push(service.route as any);
              }}
              sound="tabSwitch"
              activeScale={0.92}
            >
              {service.badge && (
                <View style={[s.badgeBox, { backgroundColor: service.color }]}>
                  <Text style={s.badgeText}>{service.badge}</Text>
                </View>
              )}
              <View style={[s.iconBox, { backgroundColor: service.bg, borderColor: service.color }]}>
                <Text style={{ fontSize: 22 }}>{service.emoji}</Text>
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
  container: { marginHorizontal: 16, marginBottom: 20 },
  header: { marginBottom: 14 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontSize: 13, fontWeight: '900', letterSpacing: 1.5 },
  superBadge: { backgroundColor: '#EF4444', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  superBadgeText: { color: '#FFF', fontSize: 12, fontWeight: '900', letterSpacing: 1 },
  sub: { fontSize: 12, fontWeight: '700', letterSpacing: 1.5, marginTop: 2 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  card: { alignItems: 'center', padding: 8, borderRadius: 16, borderWidth: 1, position: 'relative' },
  badgeBox: { position: 'absolute', top: -4, right: -4, paddingHorizontal: 4, paddingVertical: 1, borderRadius: 4, zIndex: 2 },
  badgeText: { color: '#FFF', fontSize: 12, fontWeight: '900' },
  iconBox: { width: 46, height: 46, borderRadius: 14, borderWidth: 1, alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  label: { fontSize: 12, fontWeight: '800', textAlign: 'center' }
});
