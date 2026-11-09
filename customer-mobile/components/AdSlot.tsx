import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Image, TouchableOpacity, ActivityIndicator, Linking } from 'react-native';
import { COLORS, RADIUS, SHADOWS } from '../constants/theme';
import { dietNow, themedSheet } from '../utils/themeNow';
import { LinearGradient } from 'expo-linear-gradient';

export type AdPlacement = 'rail' | 'interstitial' | 'spotlight' | 'pdp_footer';

export interface AdCreative {
  id: string;
  placement: AdPlacement;
  title: string;
  subtitle: string;
  brand: string;
  imageUrl: string;
  targetUrl?: string;
  ctaText?: string;
}

// ── Ad Creative Resolver ──────────────────────────────────────────────────────
// There is no real ad/campaign source yet, so no creative is returned and the
// slot collapses to zero height. When ads exist they must come from the backend
// and point at in-app routes for real products, never at external domains.
export const fetchAdCreative = async (_placement: AdPlacement): Promise<AdCreative | null> => {
  return null;
};

// ── Ad Analytics Tracker ──────────────────────────────────────────────────────
// No ad backend yet: events are not recorded anywhere.
export const trackAdEvent = (_adId: string, _eventType: 'impression' | 'click') => {};

interface AdSlotProps {
  placement: AdPlacement;
  containerStyle?: any;
}

export default function AdSlot({ placement, containerStyle }: AdSlotProps) {
  const [ad, setAd] = useState<AdCreative | null>(null);
  const [loading, setLoading] = useState(false);
  const [hasImpressionTracked, setHasImpressionTracked] = useState(false);

  useEffect(() => {
    let mounted = true;
    fetchAdCreative(placement)
      .then((data) => {
        if (mounted) {
          setAd(data);
          setLoading(false);
          if (data && !hasImpressionTracked) {
            trackAdEvent(data.id, 'impression');
            setHasImpressionTracked(true);
          }
        }
      })
      .catch(() => {
        if (mounted) {
          setAd(null);
          setLoading(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, [placement]);

  const handleClick = () => {
    if (!ad) return;
    trackAdEvent(ad.id, 'click');
    if (ad.targetUrl) {
      Linking.openURL(ad.targetUrl).catch(() => {});
    }
  };

  // Zero-height collapse when loading or empty ad
  if (loading) {
    return (
      <View style={[styles.skeleton, placement === 'interstitial' && styles.interstitialSkeleton, containerStyle]}>
        <ActivityIndicator size="small" color={dietNow().acc} />
      </View>
    );
  }

  if (!ad) {
    return null; // Collapses completely to zero height
  }

  if (placement === 'spotlight') {
    return (
      <TouchableOpacity
        style={[styles.spotlightCard, containerStyle]}
        activeOpacity={0.88}
        onPress={handleClick}
      >
        <Image source={{ uri: ad.imageUrl }} style={StyleSheet.absoluteFill} />
        <LinearGradient
          colors={['rgba(20, 19, 31, 0.95)', 'rgba(20, 19, 31, 0.4)']}
          start={{ x: 0, y: 1 }}
          end={{ x: 0, y: 0 }}
          style={StyleSheet.absoluteFill}
        />
        <View style={styles.adTagPill}>
          <Text style={styles.adTagText}>Ad</Text>
        </View>
        <View style={styles.spotlightContent}>
          <Text style={styles.spotlightTitle}>{ad.title}</Text>
          <Text style={styles.spotlightSub} numberOfLines={1}>
            {ad.subtitle}
          </Text>
        </View>
      </TouchableOpacity>
    );
  }

  if (placement === 'interstitial') {
    return (
      <TouchableOpacity
        style={[styles.interstitialCard, containerStyle]}
        activeOpacity={0.9}
        onPress={handleClick}
      >
        <Image source={{ uri: ad.imageUrl }} style={styles.interstitialImg} />
        <LinearGradient
          colors={['transparent', 'rgba(20, 19, 31, 0.85)']}
          style={StyleSheet.absoluteFill}
        />
        <View style={styles.sponsoredBadge}>
          <Text style={styles.sponsoredBadgeText}>SPONSORED</Text>
        </View>
        <View style={styles.interstitialInfo}>
          <Text style={styles.interstitialTitle}>{ad.title}</Text>
          <Text style={styles.interstitialDesc}>{ad.subtitle}</Text>
          <View style={styles.interstitialCtaBtn}>
            <Text style={styles.interstitialCtaText}>{ad.ctaText || 'Shop Now'}</Text>
          </View>
        </View>
      </TouchableOpacity>
    );
  }

  if (placement === 'pdp_footer') {
    return (
      <View style={[styles.pdpFooterBox, containerStyle]}>
        <View style={styles.pdpHeaderRow}>
          <Text style={styles.pdpAdLabel}>Sponsored</Text>
        </View>
        <TouchableOpacity style={styles.pdpInnerCard} activeOpacity={0.88} onPress={handleClick}>
          <Image source={{ uri: ad.imageUrl }} style={styles.pdpThumb} />
          <View style={{ flex: 1 }}>
            <Text style={styles.pdpTitle}>{ad.title}</Text>
            <Text style={styles.pdpSub} numberOfLines={2}>
              {ad.subtitle}
            </Text>
            <Text style={styles.pdpBrandText}>{ad.brand}</Text>
          </View>
        </TouchableOpacity>
      </View>
    );
  }

  // Rail default fallback
  return (
    <TouchableOpacity style={[styles.railCard, containerStyle]} activeOpacity={0.85} onPress={handleClick}>
      <Image source={{ uri: ad.imageUrl }} style={styles.railImg} />
      <View style={styles.adTagPill}>
        <Text style={styles.adTagText}>Ad</Text>
      </View>

      <Text style={styles.railTitle} numberOfLines={1}>
        {ad.title}
      </Text>
      <Text style={styles.railSub} numberOfLines={1}>
        {ad.subtitle}
      </Text>
    </TouchableOpacity>
  );
}

// Owner, 10 Nov 2026: the old purple is gone - ad labels and the CTA wear the diet accent (read per look).
const styles = themedSheet(() => ({
  skeleton: {
    height: 48,
    borderRadius: RADIUS.md,
    backgroundColor: dietNow().soft,
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 6,
  },
  interstitialSkeleton: {
    height: 120,
  },
  spotlightCard: {
    width: 140,
    height: 80,
    borderRadius: RADIUS.lg,
    overflow: 'hidden',
    position: 'relative',
    marginRight: 10,
    ...SHADOWS.cardElevated,
  },
  adTagPill: {
    position: 'absolute',
    top: 6,
    right: 6,
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    zIndex: 5,
  },
  adTagText: {
    fontSize: 12,
    fontWeight: '800',
    color: 'rgba(255,255,255,0.7)',
    textTransform: 'uppercase',
  },
  spotlightContent: {
    position: 'absolute',
    bottom: 8,
    left: 8,
    right: 8,
  },
  spotlightTitle: {
    fontSize: 12,
    fontWeight: '900',
    color: '#FFF',
  },
  spotlightSub: {
    fontSize: 12,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.7)',
  },
  interstitialCard: {
    width: '100%',
    height: 160,
    borderRadius: RADIUS.xl,
    overflow: 'hidden',
    position: 'relative',
    marginVertical: 14,
    ...SHADOWS.cardElevated,
  },
  interstitialImg: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    resizeMode: 'cover',
  },
  sponsoredBadge: {
    position: 'absolute',
    top: 10,
    left: 10,
    backgroundColor: dietNow().soft,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: RADIUS.sm,
  },
  sponsoredBadgeText: {
    fontSize: 12,
    fontWeight: '900',
    color: dietNow().acc,
    letterSpacing: 1,
  },
  interstitialInfo: {
    position: 'absolute',
    bottom: 12,
    left: 14,
    right: 14,
  },
  interstitialTitle: {
    fontSize: 18,
    fontWeight: '900',
    color: '#FFF',
  },
  interstitialDesc: {
    fontSize: 12,
    fontWeight: '500',
    color: 'rgba(255,255,255,0.8)',
    marginTop: 2,
    marginBottom: 8,
  },
  interstitialCtaBtn: {
    backgroundColor: dietNow().acc,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: RADIUS.pill,
    alignSelf: 'flex-start',
  },
  interstitialCtaText: {
    fontSize: 12,
    fontWeight: '900',
    color: '#FFF',
    letterSpacing: 0.5,
  },
  pdpFooterBox: {
    borderRadius: RADIUS.xl,
    borderWidth: 1,
    borderColor: dietNow().line,
    backgroundColor: dietNow().soft,
    padding: 12,
    marginVertical: 16,
  },
  pdpHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  pdpAdLabel: {
    fontSize: 12,
    fontWeight: '900',
    color: dietNow().acc,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  pdpInnerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  pdpThumb: {
    width: 56,
    height: 56,
    borderRadius: RADIUS.md,
    backgroundColor: '#FFF',
  },
  pdpTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: COLORS.ink,
  },
  pdpSub: {
    fontSize: 12,
    color: COLORS.inkMuted,
    marginTop: 2,
  },
  pdpBrandText: {
    fontSize: 12,
    fontWeight: '700',
    color: dietNow().acc,
    marginTop: 4,
  },
  railCard: {
    width: 120,
    borderRadius: RADIUS.lg,
    backgroundColor: '#FFF',
    padding: 8,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    marginRight: 10,
  },
  railImg: {
    width: '100%',
    height: 80,
    borderRadius: RADIUS.md,
    marginBottom: 6,
  },
  railTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: COLORS.ink,
  },
  railSub: {
    fontSize: 12,
    color: COLORS.inkMuted,
  },
}));
