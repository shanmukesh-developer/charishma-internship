import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Linking,
  Alert,
  Image,
} from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import { LinearGradient } from 'expo-linear-gradient';
import { COLORS, SHADOWS } from '../constants/theme';

export interface CockpitRider {
  id?: string;
  _id?: string;
  name?: string;
  phone?: string;
  photoUrl?: string | null;
  averageRating?: number | null;
  totalRatings?: number | null;
  vehicleType?: string | null;
  vehicleNumber?: string | null;
  completedDeliveries?: number | null;
}

interface LiveOrderCockpitProps {
  status: number; // 1: Placed, 2: Accepted, 3: Preparing / rider at store, 4: Out for delivery, 5: At gate, 6: Delivered
  isDark?: boolean;
  restaurantName?: string;
  hostelAddress?: string;
  orderId: string;
  deliveryPin?: string | null;
  riderInfo?: CockpitRider | null;
  /** Store's own estimate in minutes (Order.estDuration). Hidden when missing. */
  estMinutes?: number | null;
  /** Optional share handler (status text only; never the PIN). */
  onShare?: () => void;
  /**
   * CampusBites stall order (fulfilment 'VENDOR'): the stall delivers it itself — no rider, no PIN.
   * Steps: placed -> accepted -> out for delivery -> delivered.
   */
  vendor?: { name?: string | null; onCall?: (() => void) | null } | null;
}

// Real order statuses only. No invented times or checkpoints.
const MILESTONES = [
  { id: 1, label: 'Order placed', sub: 'Waiting for the store to confirm', icon: '📝' },
  { id: 2, label: 'Order confirmed', sub: 'The store accepted your order', icon: '✅' },
  { id: 3, label: 'Being prepared', sub: 'Your order is being packed', icon: '🍳' },
  { id: 4, label: 'Out for delivery', sub: 'Your rider has picked up the order', icon: '🛵' },
  { id: 5, label: 'At your gate', sub: 'Your rider is waiting with your order', icon: '🏠' },
];

// Stall orders: the stall accepts, then brings it over itself.
const vendorMilestones = (stall: string) => [
  { id: 1, label: 'Order placed', sub: `Waiting for ${stall} to accept`, icon: '📝' },
  { id: 2, label: 'Accepted', sub: `${stall} accepted your order`, icon: '✅' },
  { id: 4, label: 'Out for delivery', sub: `${stall} is bringing your order`, icon: '🏪' },
];

const initials = (name?: string) =>
  (name || '')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map(p => p.charAt(0).toUpperCase())
    .join('') || '🛵';

export default function LiveOrderCockpit({
  status,
  isDark = true,
  restaurantName,
  hostelAddress,
  orderId,
  deliveryPin,
  riderInfo,
  estMinutes,
  onShare,
  vendor,
}: LiveOrderCockpitProps) {
  const isVendor = !!vendor;
  const stallName = String(vendor?.name || 'the stall');
  const [copiedPin, setCopiedPin] = useState(false);
  const [photoFailed, setPhotoFailed] = useState(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
  }, []);

  // A newly assigned rider gets a fresh chance to show their photo.
  useEffect(() => { setPhotoFailed(false); }, [riderInfo?.photoUrl]);

  const rider = riderInfo && (riderInfo.id || riderInfo._id || riderInfo.name) ? riderInfo : null;
  const ratingCount = Number(rider?.totalRatings) || 0;
  const ratingAvg = Number(rider?.averageRating);
  const hasRating = ratingCount > 0 && Number.isFinite(ratingAvg) && ratingAvg > 0;
  const deliveriesDone = Number(rider?.completedDeliveries) || 0;
  const vehicleLine = [
    rider?.vehicleType,
    rider?.vehicleNumber,
    deliveriesDone > 0 ? `${deliveriesDone} ${deliveriesDone === 1 ? 'delivery' : 'deliveries'}` : null,
  ].filter(Boolean).join(' • ');

  const handleCallRider = () => {
    if (!rider?.phone) return;
    Linking.openURL(`tel:${rider.phone}`).catch(() => {
      Alert.alert('Could not start the call', `You can call your rider on ${rider.phone}.`);
    });
  };

  const handleCopyPin = () => {
    if (!deliveryPin) return;
    Clipboard.setString(deliveryPin);
    setCopiedPin(true);
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    copyTimerRef.current = setTimeout(() => setCopiedPin(false), 2000);
  };

  const progressPercent = Math.min(100, Math.max(10, (Math.min(status, 6) / 6) * 100));
  const shortId = (orderId || '').slice(-6).toUpperCase();

  const title = isVendor
    ? (status >= 6 ? `Delivered by ${stallName} 🎉`
      : status >= 4 ? `${stallName} is on the way 🏪`
      : status >= 2 ? 'Order accepted ✅'
      : `Waiting for ${stallName} ⏳`)
    : status >= 6 ? 'Order delivered 🎉'
    : status === 5 ? 'Your rider is at the gate 🔔'
    : status === 4 ? 'On the way to you 🛵'
    : status === 3 ? 'Being prepared 🍳'
    : status === 2 ? 'Order confirmed ✅'
    : 'Waiting for the store ⏳';

  const subtitle =
    isVendor ? (status >= 6 ? 'Thanks for ordering with ZCS' : `Pay ${stallName} in cash when it arrives`)
    : status === 5 ? 'Share your Delivery PIN at handover'
    : [restaurantName, hostelAddress].filter(Boolean).join(' ➔ ');

  const showEstimate = !!estMinutes && estMinutes > 0 && status >= 2 && status <= 4;

  const cardBg = isDark ? '#141416' : '#FFFFFF';
  const border = isDark ? 'rgba(212, 175, 55, 0.25)' : 'rgba(0, 0, 0, 0.08)';
  const txt = isDark ? '#FFFFFF' : '#0F172A';
  const txtSec = isDark ? COLORS.textSecondary : '#617088';

  return (
    <View style={[styles.cockpitCard, { backgroundColor: cardBg, borderColor: border }]}>
      {/* ── HERO: real status ── */}
      <LinearGradient
        colors={isDark ? ['#1E1B18', '#141416'] : ['#FEF3C7', '#FFFBEB']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.heroGradient}
      >
        <View style={styles.heroTopRow}>
          <View style={styles.liveBeaconWrap}>
            <View style={[styles.liveBeaconDot, status >= 6 && { backgroundColor: COLORS.gold }]} />
            <Text style={styles.liveBeaconText}>{status >= 6 ? 'ORDER COMPLETE' : 'LIVE ORDER STATUS'}</Text>
          </View>
          {!!shortId && <Text style={[styles.orderIdBadge, { color: COLORS.gold }]}>#{shortId}</Text>}
        </View>

        <View style={styles.etaRow}>
          <View style={{ flex: 1, paddingRight: 10 }}>
            <Text style={[styles.etaTitle, { color: txt }]}>{title}</Text>
            {!!subtitle && (
              <Text style={[styles.etaSubtitle, { color: txtSec }]} numberOfLines={2}>{subtitle}</Text>
            )}
            {showEstimate && (
              <Text style={[styles.etaSubtitle, { color: COLORS.gold, fontWeight: '800' }]}>
                Store estimate: about {estMinutes} min
              </Text>
            )}
          </View>
          <View style={[styles.etaPulseIconBox, { backgroundColor: COLORS.gold }]}>
            <Text style={{ fontSize: 22 }}>{status >= 6 ? '🎉' : isVendor ? (status >= 4 ? '🏪' : '⏳') : status === 5 ? '🏠' : status === 4 ? '🛵' : '🍳'}</Text>
          </View>
        </View>

        <View style={styles.progressBarTrack}>
          <View style={[styles.progressBarFill, { width: `${progressPercent}%`, backgroundColor: COLORS.gold }]} />
        </View>
      </LinearGradient>

      {/* ── RIDER (real data only) — or the stall that delivers a stall order ── */}
      <View style={[styles.riderSection, { borderBottomColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)' }]}>
        {isVendor ? (
          <>
            <View style={[styles.riderPhoto, styles.initialsAvatar, { backgroundColor: isDark ? '#262626' : '#FFF7ED', borderColor: 'transparent' }]}>
              <Text style={{ fontSize: 20 }}>🏪</Text>
            </View>
            <View style={{ flex: 1, paddingHorizontal: 12 }}>
              <Text style={[styles.riderName, { color: txt }]} numberOfLines={1}>Delivered by {stallName}</Text>
              <Text style={[styles.vehicleText, { color: txtSec }]}>
                {status >= 6 ? 'Thanks for ordering with ZCS' : 'No ZCS rider or PIN — the stall brings it to you'}
              </Text>
            </View>
            {!!vendor?.onCall && status < 6 && (
              <View style={styles.actionButtonsCol}>
                <TouchableOpacity
                  style={[styles.actionRoundBtn, { backgroundColor: '#256FEF' }]}
                  onPress={vendor.onCall}
                  accessibilityLabel={`Call ${stallName}`}
                >
                  <Text style={{ fontSize: 16 }}>📞</Text>
                </TouchableOpacity>
              </View>
            )}
          </>
        ) : rider ? (
          <>
            <View style={styles.riderAvatarWrapper}>
              {rider.photoUrl && !photoFailed ? (
                <Image source={{ uri: rider.photoUrl }} style={styles.riderPhoto} onError={() => setPhotoFailed(true)} />
              ) : (
                <View style={[styles.riderPhoto, styles.initialsAvatar, { backgroundColor: isDark ? '#262626' : '#FEF3C7' }]}>
                  <Text style={{ fontSize: 15, fontWeight: '900', color: COLORS.gold }}>{initials(rider.name)}</Text>
                </View>
              )}
            </View>

            <View style={{ flex: 1, paddingHorizontal: 12 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <Text style={[styles.riderName, { color: txt }]} numberOfLines={1}>{rider.name || 'Your rider'}</Text>
                <View style={styles.ratingPill}>
                  <Text style={styles.ratingText}>{hasRating ? `⭐ ${ratingAvg.toFixed(1)}` : 'New rider'}</Text>
                </View>
              </View>
              {!!vehicleLine && (
                <Text style={[styles.vehicleText, { color: txtSec }]} numberOfLines={1}>{vehicleLine}</Text>
              )}
            </View>

            {!!rider.phone && status < 6 && (
              <View style={styles.actionButtonsCol}>
                <TouchableOpacity
                  style={[styles.actionRoundBtn, { backgroundColor: '#10B981' }]}
                  onPress={handleCallRider}
                  accessibilityLabel="Call your rider"
                >
                  <Text style={{ fontSize: 16 }}>📞</Text>
                </TouchableOpacity>
              </View>
            )}
          </>
        ) : (
          <>
            <View style={[styles.riderPhoto, styles.initialsAvatar, { backgroundColor: isDark ? '#262626' : '#F1F5F9', borderColor: 'transparent' }]}>
              <Text style={{ fontSize: 20 }}>🛵</Text>
            </View>
            <View style={{ flex: 1, paddingHorizontal: 12 }}>
              <Text style={[styles.riderName, { color: txt }]}>
                {status >= 6 ? 'Delivered' : 'Assigning a delivery partner'}
              </Text>
              <Text style={[styles.vehicleText, { color: txtSec }]}>
                {status >= 6 ? 'Thanks for ordering with ZCS' : "We'll show your rider here as soon as one accepts"}
              </Text>
            </View>
          </>
        )}
      </View>

      {/* ── DELIVERY PIN ── */}
      {!!deliveryPin && !isVendor && status < 6 && (
        <View style={[styles.pinBox, { backgroundColor: isDark ? 'rgba(212,175,55,0.08)' : '#FFFBEB', borderColor: isDark ? 'rgba(212,175,55,0.3)' : '#FDE68A' }]}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.pinHeading, { color: COLORS.gold }]}>DELIVERY PIN</Text>
            <Text style={[styles.pinDescription, { color: txtSec }]}>Share this code with your rider only at handover</Text>
          </View>
          <TouchableOpacity style={styles.pinCodePill} onPress={handleCopyPin} accessibilityLabel="Copy Delivery PIN">
            <Text style={styles.pinDigits}>{deliveryPin}</Text>
            <Text style={{ fontSize: 12, marginLeft: 4 }}>{copiedPin ? '✅' : '📋'}</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ── STATUS STEPS (real statuses, no invented times) ── */}
      <View style={styles.milestonesContainer}>
        <Text style={[styles.milestonesSectionTitle, { color: txtSec }]}>ORDER PROGRESS</Text>

        {(isVendor ? vendorMilestones(stallName) : MILESTONES).map((m, idx, list) => {
          const isDone = status > m.id || status >= 6;
          const isCurrent = status === m.id;
          const isPending = !isDone && !isCurrent;

          return (
            <View key={m.id} style={styles.milestoneRow}>
              <View style={styles.timelineNodeCol}>
                <View
                  style={[
                    styles.timelineDot,
                    isDone && { backgroundColor: COLORS.gold, borderColor: '#FFF' },
                    isCurrent && { backgroundColor: COLORS.gold, transform: [{ scale: 1.2 }], borderWidth: 2, borderColor: '#FFF' },
                    isPending && { backgroundColor: isDark ? '#2D3748' : '#E2E8F0' },
                  ]}
                >
                  <Text style={{ fontSize: 12 }}>{m.icon}</Text>
                </View>
                {idx < list.length - 1 && (
                  <View
                    style={[
                      styles.timelineLine,
                      { backgroundColor: isDone ? COLORS.gold : (isDark ? '#2D3748' : '#E2E8F0') },
                    ]}
                  />
                )}
              </View>

              <View style={{ flex: 1, paddingBottom: 16 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text
                    style={[
                      styles.milestoneLabel,
                      { color: isCurrent ? COLORS.gold : isDone ? txt : txtSec },
                      isCurrent && { fontWeight: '900' },
                    ]}
                  >
                    {m.label}
                  </Text>
                  {(isDone || isCurrent) && (
                    <Text style={[styles.milestoneEst, { color: isCurrent ? COLORS.gold : txtSec }]}>
                      {isDone ? 'DONE' : 'NOW'}
                    </Text>
                  )}
                </View>
                {(isCurrent || isDone) && (
                  <Text style={[styles.milestoneSub, { color: txtSec }]} numberOfLines={2}>{m.sub}</Text>
                )}
              </View>
            </View>
          );
        })}
      </View>

      {onShare && status < 6 && (
        <View style={styles.footerRow}>
          <TouchableOpacity style={styles.shareBtn} onPress={onShare}>
            <Text style={styles.shareBtnText}>🔗 SHARE ORDER STATUS</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  cockpitCard: {
    borderRadius: 24,
    borderWidth: 1.5,
    overflow: 'hidden',
    marginBottom: 16,
    ...SHADOWS.goldGlow,
  },
  heroGradient: {
    padding: 18,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  heroTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  liveBeaconWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  liveBeaconDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#10B981',
  },
  liveBeaconText: {
    fontSize: 12,
    fontWeight: '900',
    color: COLORS.gold,
    letterSpacing: 1.5,
  },
  orderIdBadge: {
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1,
  },
  etaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginVertical: 6,
  },
  etaTitle: {
    fontSize: 17,
    fontWeight: '900',
    letterSpacing: -0.3,
  },
  etaSubtitle: {
    fontSize: 12,
    fontWeight: '600',
    marginTop: 2,
  },
  etaPulseIconBox: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 4,
  },
  progressBarTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(0,0,0,0.15)',
    marginTop: 14,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 3,
  },
  riderSection: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
  },
  riderAvatarWrapper: {
    position: 'relative',
  },
  riderPhoto: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 2,
    borderColor: COLORS.gold,
  },
  initialsAvatar: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  riderName: {
    fontSize: 13,
    fontWeight: '800',
  },
  ratingPill: {
    backgroundColor: '#FEF3C7',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  ratingText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#92400E',
  },
  vehicleText: {
    fontSize: 12,
    fontWeight: '600',
    marginTop: 2,
  },
  actionButtonsCol: {
    flexDirection: 'row',
    gap: 8,
  },
  actionRoundBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 3,
    elevation: 3,
  },
  pinBox: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginHorizontal: 16,
    marginTop: 14,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
  },
  pinHeading: {
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1.2,
  },
  pinDescription: {
    fontSize: 12,
    fontWeight: '600',
    marginTop: 2,
  },
  pinCodePill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#D4AF37',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 3,
  },
  pinDigits: {
    fontSize: 16,
    fontWeight: '900',
    color: '#000',
    letterSpacing: 2,
  },
  milestonesContainer: {
    padding: 16,
    paddingBottom: 0,
  },
  milestonesSectionTitle: {
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1.2,
    marginBottom: 14,
  },
  milestoneRow: {
    flexDirection: 'row',
    gap: 12,
  },
  timelineNodeCol: {
    alignItems: 'center',
    width: 28,
  },
  timelineDot: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  timelineLine: {
    width: 2,
    flex: 1,
    marginVertical: 4,
    minHeight: 24,
  },
  milestoneLabel: {
    fontSize: 12,
    fontWeight: '700',
  },
  milestoneEst: {
    fontSize: 12,
    fontWeight: '800',
  },
  milestoneSub: {
    fontSize: 12,
    fontWeight: '500',
    marginTop: 2,
  },
  footerRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    padding: 14,
    paddingTop: 4,
  },
  shareBtn: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: 'rgba(212,175,55,0.12)',
  },
  shareBtnText: {
    fontSize: 12,
    fontWeight: '900',
    color: COLORS.gold,
    letterSpacing: 0.5,
  },
});
