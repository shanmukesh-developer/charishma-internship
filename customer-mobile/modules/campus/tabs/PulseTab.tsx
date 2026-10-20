import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
} from 'react-native';
import {
  Flame,
  Moon,
  Trophy,
  MessageCircle,
  Calendar,
  Utensils,
  ChevronRight,
  TrendingUp,
  Heart,
  HelpCircle,
  Car,
} from '../../../components/lucide';
import * as Haptics from 'expo-haptics';
import { CampusColors, CampusLayout } from '../../../constants/campusTheme';
import { CampusProfileData, CampusUserData } from '../../../types/campus';
import {
  fetchLostFound,
  fetchRidePools,
  fetchPulseCounts,
  fetchDailyQuestion,
  fetchBranchWars,
  fetchPulseToday,
  fetchWhispers,
  PulseBranchStanding,
  PulseToday,
  PulseWhisper,
} from '../campusApi';
import ShimmerLoader from '../../../components/ShimmerLoader';

// Fallback for older servers: the question's promptDate is an IST (Asia/Kolkata) calendar date.
const istToday = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);

const countLabel = (n: number | null, cap = 100) => (n == null ? null : n >= cap ? `${cap}+` : String(n));

interface PulseTabProps {
  profile: CampusProfileData | null;
  user: CampusUserData | null;
  onOpenWhispers: () => void;
  onOpenNightQuestion: () => void;
  onOpenBranchWars: () => void;
  onOpenLostFound?: () => void;
  onOpenRidePool?: () => void;
  /** 'feed' = social (9 PM, Whispers, Branch Wars); 'campus' = utilities (today, Lost & Found, Rides). */
  mode?: 'feed' | 'campus';
  /** Extra sections rendered at the end (e.g. campus spots). */
  footer?: React.ReactNode;
  header?: React.ReactNode;
}

export const PulseTab: React.FC<PulseTabProps> = ({
  profile,
  user,
  onOpenWhispers,
  onOpenNightQuestion,
  onOpenBranchWars,
  onOpenLostFound,
  onOpenRidePool,
  mode = 'feed',
  footer,
  header,
}) => {
  const isFeed = mode === 'feed';
  const [refreshing, setRefreshing] = useState(false);

  // Pulse live data (all backend-backed)
  const [nightQ, setNightQ] = useState<{ text: string; count: number; isToday: boolean; isOpen: boolean; ended: boolean } | null>(null);
  const [branches, setBranches] = useState<PulseBranchStanding[]>([]);
  const [today, setToday] = useState<PulseToday | null>(null);
  const [topWhisper, setTopWhisper] = useState<PulseWhisper | null>(null);
  const [whispersOff, setWhispersOff] = useState(false);
  const [pulseError, setPulseError] = useState(false);
  const [pulseLoaded, setPulseLoaded] = useState(false);

  // Open counts for the Lost & Found / Ride Pool entry cards (null = unknown, never invented).
  const [lnfCount, setLnfCount] = useState<number | null>(null);
  const [rideCount, setRideCount] = useState<number | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const loadPulse = useCallback(async () => {
    // Each mode only loads what it shows.
    const skip = Promise.reject(new Error('skipped'));
    skip.catch(() => {});
    const [q, bw, td, ws] = await Promise.allSettled([
      isFeed ? fetchDailyQuestion() : skip,
      isFeed ? fetchBranchWars() : skip,
      isFeed ? skip : fetchPulseToday(),
      isFeed ? fetchWhispers('All') : skip,
    ]);
    if (!mountedRef.current) return;
    if (q.status === 'fulfilled') {
      const qq = q.value.question;
      setNightQ(
        qq
          ? (() => {
              const isToday = typeof qq.isToday === 'boolean' ? qq.isToday : String(qq.promptDate).slice(0, 10) === istToday();
              const isOpen = typeof qq.isOpen === 'boolean' ? qq.isOpen : isToday;
              const opensAtMs = qq.opensAt ? new Date(qq.opensAt).getTime() : NaN;
              const ended = isToday && !isOpen && !(opensAtMs > Date.now());
              return { text: qq.question, count: q.value.answerCount, isToday, isOpen, ended };
            })()
          : null
      );
    }
    if (bw.status === 'fulfilled') setBranches((bw.value.standings || []).slice(0, 3));
    if (td.status === 'fulfilled') setToday(td.value);
    if (ws.status === 'fulfilled') {
      const top = [...(ws.value.whispers || [])].sort((a, b) => b.hearts - a.hearts)[0] || null;
      setTopWhisper(top);
      setWhispersOff(false);
    } else if ((ws.reason as any)?.code === 'FEATURE_OFF') {
      // C2: admin kill switch: hide the Whispers entry point.
      setWhispersOff(true);
    }
    setPulseError((isFeed ? [q, bw, ws] : [td]).every((r) => r.status === 'rejected'));
    setPulseLoaded(true);
  }, [isFeed]);

  // Only the counts are needed here; failures stay quiet (the card just hides the number).
  const loadCounts = useCallback(async () => {
    try {
      const counts = await fetchPulseCounts();
      if (!mountedRef.current) return;
      setLnfCount(counts.openLostFound);
      setRideCount(counts.openRides);
      return;
    } catch {
      // Older server without /pulse/counts: count the boards instead.
    }
    const [items, rideList] = await Promise.allSettled([fetchLostFound(), fetchRidePools()]);
    if (!mountedRef.current) return;
    if (items.status === 'fulfilled') setLnfCount(items.value.length);
    if (rideList.status === 'fulfilled') setRideCount(rideList.value.length);
  }, []);

  useEffect(() => {
    loadPulse();
    if (!isFeed) loadCounts();
  }, [loadPulse, loadCounts, isFeed]);

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([isFeed ? Promise.resolve() : loadCounts(), loadPulse()]);
    if (mountedRef.current) setRefreshing(false);
  };

  const lnfLabel = countLabel(lnfCount);
  const rideLabel = countLabel(rideCount);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={CampusColors.accent} />}
    >
      {header}
      {pulseError && (
        <TouchableOpacity
          style={styles.offlineBanner}
          onPress={() => {
            setPulseError(false);
            loadPulse();
            loadCounts();
          }}
          activeOpacity={0.8}
        >
          <Text style={styles.offlineBannerText}>Couldn't refresh. Tap to try again.</Text>
        </TouchableOpacity>
      )}

      {/* 1. The 9 PM Question Night Card (Section 1.2 & Section 7.1) */}
      {isFeed && (
      <TouchableOpacity
        style={styles.nightCard}
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          onOpenNightQuestion();
        }}
        activeOpacity={0.9}
      >
        <View style={styles.nightCardTop}>
          <View style={styles.nightBadge}>
            <Moon size={13} color={CampusColors.lavender} />
            <Text style={styles.nightBadgeText}>THE 9 PM QUESTION</Text>
          </View>
          <Text style={styles.nightTimer}>{nightQ?.isOpen ? 'Live now' : nightQ?.ended ? 'Answers closed' : 'Drops at 9 PM'}</Text>
        </View>

        <Text style={styles.nightQuestion}>
          {nightQ?.isToday ? `"${nightQ.text}"` : "Today's question drops at 9 PM. Come back tonight."}
        </Text>

        <View style={styles.nightFooter}>
          <Text style={styles.nightSubtitle}>
            {nightQ?.isToday
              ? nightQ.count > 0
                ? `${countLabel(nightQ.count, 200)} answer${nightQ.count === 1 ? '' : 's'} so far • Anonymous`
                : 'Be the first to answer • Anonymous'
              : 'Anonymous • Verified students only'}
          </Text>
          <View style={styles.nightActionPill}>
            <Text style={styles.nightActionText}>{nightQ?.isToday ? 'Answer' : 'Peek'}</Text>
            <ChevronRight size={14} color="#FFFFFF" />
          </View>
        </View>
      </TouchableOpacity>
      )}

      {/* 2. Branch Wars Leaderboard (Section 7.2) */}
      {isFeed && (
      <View style={styles.sectionCard}>
        <View style={styles.sectionHeader}>
          <View style={styles.titleRow}>
            <Trophy size={18} color={CampusColors.warm} strokeWidth={2.2} />
            <Text style={styles.sectionTitle}>Branch Wars</Text>
          </View>
          <TouchableOpacity
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              onOpenBranchWars();
            }}
          >
            <Text style={styles.seeAllText}>Standings</Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.sectionSubtitle}>
          Live • computed from real campus activity over the last 7 days.
        </Text>

        <View style={styles.branchList}>
          {!pulseLoaded ? (
            <View style={{ gap: 10 }}>
              <ShimmerLoader width="100%" height={18} borderRadius={6} />
              <ShimmerLoader width="85%" height={18} borderRadius={6} />
              <ShimmerLoader width="70%" height={18} borderRadius={6} />
            </View>
          ) : branches.length === 0 ? (
            <Text style={styles.boardEmpty}>No branch activity yet this week.</Text>
          ) : (
            branches.map((b, i) => {
              const max = Math.max(1, ...branches.map((x) => x.points));
              const pct = `${Math.max(6, Math.round((b.points / max) * 100))}%`;
              const barColor = i === 0 ? CampusColors.accent : i === 1 ? CampusColors.warm : CampusColors.muted;
              return (
                <View key={b.code} style={styles.branchRow}>
                  <Text style={[styles.rankNumber, i === 0 && { color: '#B4561A' }]}>{b.rank}</Text>
                  <View style={styles.branchInfo}>
                    <View style={styles.branchNameRow}>
                      <Text style={styles.branchName}>{b.code}</Text>
                      <Text style={styles.branchPoints}>{b.points.toLocaleString()} pts</Text>
                    </View>
                    <View style={styles.track}>
                      <View style={[styles.progress, { width: pct as any, backgroundColor: barColor }]} />
                    </View>
                  </View>
                </View>
              );
            })
          )}
        </View>
      </View>

      )}

      {/* 3. Today on Campus (Section 5) */}
      {!isFeed && (
      <View style={styles.sectionCard}>
        <View style={styles.sectionHeader}>
          <View style={styles.titleRow}>
            <Calendar size={18} color={CampusColors.accent} strokeWidth={2.2} />
            <Text style={styles.sectionTitle}>Today on Campus</Text>
          </View>
          <Text style={styles.dateBadge}>
            {new Date().toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}
          </Text>
        </View>

        {(() => {
          const mess = today?.mess || {};
          // Show the meal that's next/now (breakfast in the morning, dinner at night), then any other.
          const hour = new Date().getHours();
          const mealOrder =
            hour < 10
              ? (['breakfast', 'lunch', 'snacks', 'dinner'] as const)
              : hour < 15
              ? (['lunch', 'snacks', 'dinner', 'breakfast'] as const)
              : hour < 18
              ? (['snacks', 'dinner', 'lunch', 'breakfast'] as const)
              : (['dinner', 'snacks', 'lunch', 'breakfast'] as const);
          const dinnerMeal = mealOrder.find((m) => mess[m]);
          const events = (today?.events || []).slice(0, 2);
          const hasContent = dinnerMeal || events.length > 0;
          if (!pulseLoaded) {
            return (
              <View style={{ gap: 10 }}>
                <ShimmerLoader width="100%" height={40} borderRadius={10} />
                <ShimmerLoader width="100%" height={40} borderRadius={10} />
              </View>
            );
          }
          if (!hasContent) {
            return <Text style={styles.boardEmpty}>Nothing scheduled today. Check back later.</Text>;
          }
          return (
            <>
              {dinnerMeal && (
                <View style={[styles.todayItem, events.length === 0 && { borderBottomWidth: 0 }]}>
                  <View style={[styles.itemIconWrap, { backgroundColor: CampusColors.accentSoft }]}>
                    <Utensils size={16} color={CampusColors.accentDeep} />
                  </View>
                  <View style={styles.itemTextWrap}>
                    <Text style={styles.itemTitle}>
                      Today's Mess Menu • {dinnerMeal.charAt(0).toUpperCase() + dinnerMeal.slice(1)}
                    </Text>
                    <Text style={styles.itemSubtitle}>{mess[dinnerMeal]}</Text>
                  </View>
                </View>
              )}

              {events.map((ev, idx) => {
                const when = new Date(ev.startsAt);
                const timeLabel = isNaN(when.getTime())
                  ? ''
                  : when.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
                return (
                  <View
                    key={ev.id}
                    style={[styles.todayItem, idx === events.length - 1 && { borderBottomWidth: 0 }]}
                  >
                    <View style={[styles.itemIconWrap, { backgroundColor: CampusColors.warmSoft }]}>
                      <Flame size={16} color={CampusColors.warmDeep} />
                    </View>
                    <View style={styles.itemTextWrap}>
                      <Text style={styles.itemTitle}>{ev.title}</Text>
                      <Text style={styles.itemSubtitle}>
                        {[ev.location, timeLabel].filter(Boolean).join(' • ')}
                        {ev.description ? ` • ${ev.description}` : ''}
                      </Text>
                    </View>
                  </View>
                );
              })}
            </>
          );
        })()}
      </View>

      )}

      {/* Campus services: Lost & Found and Rides (one entry for campus cab pools + bike co-ride) */}
      {!isFeed && (
      <View style={styles.sectionCard}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Campus services</Text>
        </View>
        <View style={styles.utilitiesRow}>
          <TouchableOpacity
            style={styles.utilityCard}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              onOpenLostFound?.();
            }}
            activeOpacity={0.8}
          >
            <View style={[styles.utilityIconWrap, { backgroundColor: CampusColors.roseSoft }]}>
              <HelpCircle size={18} color={CampusColors.roseDeep} />
            </View>
            <Text style={styles.utilityTitle}>Lost & Found</Text>
            <Text style={styles.utilitySubtitle}>
              {lnfLabel !== null ? `${lnfLabel} open • report or claim` : 'Report or claim items'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.utilityCard}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              onOpenRidePool?.();
            }}
            activeOpacity={0.8}
          >
            <View style={[styles.utilityIconWrap, { backgroundColor: CampusColors.accentSoft }]}>
              <Car size={18} color={CampusColors.accentDeep} />
            </View>
            <Text style={styles.utilityTitle}>Rides</Text>
            <Text style={styles.utilitySubtitle}>
              {rideLabel !== null ? `${rideLabel} open • cab pools & bike co-ride` : 'Cab pools & bike co-ride'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
      )}

      {/* 4. Campus Whispers Highlights (Section 7.3) */}
      {isFeed && !whispersOff && (
      <View style={styles.sectionCard}>
        <View style={styles.sectionHeader}>
          <View style={styles.titleRow}>
            <MessageCircle size={18} color={CampusColors.rose} strokeWidth={2.2} />
            <Text style={styles.sectionTitle}>Campus Whispers</Text>
          </View>
          <TouchableOpacity
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              onOpenWhispers();
            }}
          >
            <Text style={[styles.seeAllText, { color: CampusColors.rose }]}>All Whispers</Text>
          </TouchableOpacity>
        </View>

        {topWhisper ? (
          <View style={styles.whisperCard}>
            <Text style={styles.whisperText}>"{topWhisper.text}"</Text>
            <View style={styles.whisperMeta}>
              <Text style={styles.whisperTime}>
                {topWhisper.alias} • {topWhisper.topic}
              </Text>
              <View style={styles.whisperReactions}>
                <View style={styles.reactionPill}>
                  <Heart size={12} color={CampusColors.rose} fill={CampusColors.rose} />
                  <Text style={styles.reactionCount}>{topWhisper.hearts}</Text>
                </View>
              </View>
            </View>
          </View>
        ) : !pulseLoaded ? (
          <ShimmerLoader width="100%" height={64} borderRadius={12} />
        ) : (
          <Text style={styles.boardEmpty}>No whispers yet. Be the first to post one.</Text>
        )}
      </View>
      )}
      {footer}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  offlineBanner: {
    backgroundColor: CampusColors.warmSoft,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginBottom: 12,
  },
  offlineBannerText: {
    fontSize: 13,
    fontWeight: '600',
    color: CampusColors.warmDeep,
    textAlign: 'center',
  },
  container: {
    flex: 1,
    backgroundColor: CampusColors.paper,
  },
  content: {
    paddingHorizontal: CampusLayout.spacing.lg,
    paddingTop: 12,
    paddingBottom: 28,
  },
  nightCard: {
    backgroundColor: CampusColors.nightCard,
    borderRadius: CampusLayout.radius.card,
    padding: 16,
    borderWidth: 1,
    borderColor: CampusColors.nightLine,
    marginBottom: 16,
  },
  nightCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  nightBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(200, 182, 255, 0.15)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: CampusLayout.radius.pill,
    gap: 6,
  },
  nightBadgeText: {
    fontSize: 12,
    fontWeight: '800',
    color: CampusColors.lavender,
    letterSpacing: 0.6,
  },
  nightTimer: {
    fontSize: 12,
    color: CampusColors.nightMuted,
  },
  nightQuestion: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
    lineHeight: 23,
    marginBottom: 14,
  },
  nightFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: CampusColors.nightLine,
  },
  nightSubtitle: {
    fontSize: 12,
    color: CampusColors.nightMuted,
    flex: 1,
    marginRight: 10,
  },
  nightActionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: CampusColors.violet,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: CampusLayout.radius.pill,
    gap: 4,
  },
  nightActionText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  sectionCard: {
    backgroundColor: CampusColors.card,
    borderRadius: CampusLayout.radius.card,
    padding: 16,
    borderWidth: 1,
    borderColor: CampusColors.line,
    marginBottom: 16,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: CampusColors.ink,
  },
  seeAllText: {
    fontSize: 13,
    fontWeight: '600',
    color: CampusColors.accent,
  },
  sectionSubtitle: {
    fontSize: 12,
    color: CampusColors.muted,
    marginBottom: 14,
  },
  dateBadge: {
    fontSize: 12,
    fontWeight: '600',
    color: CampusColors.muted,
  },
  branchList: {
    gap: 12,
  },
  branchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  rankNumber: {
    fontSize: 16,
    fontWeight: '800',
    color: CampusColors.muted,
    width: 16,
    textAlign: 'center',
  },
  branchInfo: {
    flex: 1,
  },
  branchNameRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  branchName: {
    fontSize: 13,
    fontWeight: '600',
    color: CampusColors.ink,
  },
  branchPoints: {
    fontSize: 12,
    fontWeight: '700',
    color: CampusColors.muted,
  },
  track: {
    height: 6,
    backgroundColor: CampusColors.placeholderFill,
    borderRadius: 3,
    overflow: 'hidden',
  },
  progress: {
    height: '100%',
    borderRadius: 3,
  },
  todayItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: CampusColors.line,
    gap: 12,
  },
  itemIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemTextWrap: {
    flex: 1,
  },
  itemTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: CampusColors.ink,
    marginBottom: 2,
  },
  itemSubtitle: {
    fontSize: 12,
    color: CampusColors.muted,
    lineHeight: 17,
  },
  whisperCard: {
    backgroundColor: CampusColors.paper,
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: CampusColors.line,
  },
  whisperText: {
    fontSize: 14,
    color: CampusColors.ink,
    lineHeight: 20,
    fontStyle: 'italic',
    marginBottom: 10,
  },
  whisperMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  whisperTime: {
    fontSize: 12,
    color: CampusColors.muted,
  },
  whisperReactions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  reactionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: CampusColors.roseSoft,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    gap: 4,
  },
  reactionCount: {
    fontSize: 12,
    fontWeight: '700',
    color: CampusColors.roseDeep,
  },
  utilitiesRow: {
    flexDirection: 'row',
    gap: 12,
  },
  utilityCard: {
    flex: 1,
    backgroundColor: CampusColors.paper,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: CampusColors.line,
  },
  utilityIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  utilityTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: CampusColors.ink,
    marginBottom: 2,
  },
  utilitySubtitle: {
    fontSize: 12,
    color: CampusColors.muted,
  },
  boardPanel: {
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: CampusColors.line,
    gap: 10,
  },
  boardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  boardTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: CampusColors.ink,
  },
  boardHeaderActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  boardAddBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: CampusColors.paper,
    borderWidth: 1,
    borderColor: CampusColors.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  composeBox: {
    backgroundColor: CampusColors.paper,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: CampusColors.line,
    padding: 10,
    gap: 8,
  },
  segmentRow: {
    flexDirection: 'row',
    gap: 8,
  },
  segmentBtn: {
    flex: 1,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: CampusColors.card,
    borderWidth: 1,
    borderColor: CampusColors.line,
  },
  segmentActive: {
    backgroundColor: CampusColors.accentSoft,
    borderColor: CampusColors.accent,
  },
  segmentText: {
    fontSize: 12,
    fontWeight: '700',
    color: CampusColors.muted,
  },
  segmentTextActive: {
    color: CampusColors.accentDeep,
  },
  boardField: {
    backgroundColor: CampusColors.card,
    borderWidth: 1,
    borderColor: CampusColors.line,
    borderRadius: 10,
    paddingHorizontal: 10,
    height: 40,
    fontSize: 13,
    color: CampusColors.ink,
  },
  boardSubmit: {
    height: 40,
    borderRadius: 12,
    backgroundColor: CampusColors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boardSubmitText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  boardEmpty: {
    fontSize: 12,
    color: CampusColors.muted,
    textAlign: 'center',
    paddingVertical: 8,
  },
  boardItem: {
    backgroundColor: CampusColors.paper,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: CampusColors.line,
    padding: 10,
    gap: 4,
  },
  boardTypePill: {
    alignSelf: 'flex-start',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 7,
  },
  lostPill: {
    backgroundColor: CampusColors.roseSoft,
  },
  foundPill: {
    backgroundColor: CampusColors.accentSoft,
  },
  boardTypeText: {
    fontSize: 12,
    fontWeight: '900',
    color: CampusColors.ink,
    letterSpacing: 0.6,
  },
  boardItemTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: CampusColors.ink,
  },
  boardMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  boardMetaText: {
    fontSize: 12,
    color: CampusColors.muted,
    flexShrink: 1,
  },
  boardItemFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  boardResolveBtn: {
    alignSelf: 'flex-start',
    backgroundColor: CampusColors.card,
    borderWidth: 1,
    borderColor: CampusColors.line,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 12,
    marginTop: 4,
  },
  boardResolveText: {
    fontSize: 12,
    fontWeight: '700',
    color: CampusColors.ink,
  },
  boardJoinBtn: {
    backgroundColor: CampusColors.accent,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 12,
  },
  boardJoinDisabled: {
    backgroundColor: CampusColors.placeholderFill,
  },
  boardJoinText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  boardLeaveBtn: {
    backgroundColor: CampusColors.card,
    borderWidth: 1,
    borderColor: CampusColors.line,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 12,
  },
  boardLeaveText: {
    color: CampusColors.ink,
    fontSize: 12,
    fontWeight: '700',
  },
  organiserTag: {
    fontSize: 12,
    fontWeight: '700',
    color: CampusColors.accentDeep,
  },
});
