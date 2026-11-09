import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  X,
  Trophy,
  Flame,
  BookOpen,
  Users,
  RefreshCw,
} from '../../../components/lucide';
import { CampusColors, CampusLayout } from '../../../constants/campusTheme';
import { fetchBranchWars, PulseBranchStanding } from '../campusApi';

import { themedSheet } from '../../../utils/themeNow';
const PALETTE = [CampusColors.accent, CampusColors.warm, CampusColors.rose, '#059669', CampusColors.violet, '#0EA5E9'];

interface BranchWarsModalProps {
  visible: boolean;
  onClose: () => void;
  userBranch?: string;
}

export const BranchWarsModal: React.FC<BranchWarsModalProps> = ({
  visible,
  onClose,
  userBranch,
}) => {
  const [standings, setStandings] = useState<PulseBranchStanding[]>([]);
  const [myBranch, setMyBranch] = useState<string | null>(userBranch || null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await fetchBranchWars();
      if (!mountedRef.current) return;
      setStandings(data.standings || []);
      if (data.userBranch) setMyBranch(data.userBranch);
    } catch (e: any) {
      if (mountedRef.current) {
        setLoadError(e?.message || "We couldn't load the leaderboard. Check your connection and try again.");
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (visible) load();
  }, [visible, load]);

  const maxPoints = Math.max(1, ...standings.map((b) => b.points));

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
            <X size={22} color={CampusColors.ink} />
          </TouchableOpacity>
          <View style={styles.headerTitleWrap}>
            <Text style={styles.headerTitle}>Branch Wars</Text>
            <Text style={styles.headerSubtitle}>Live • last 7 days of real campus activity</Text>
          </View>
          <View style={styles.trophyIconWrap}>
            <Trophy size={20} color={CampusColors.warm} />
          </View>
        </View>

        <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
          {/* Banner Card */}
          <View style={styles.bannerCard}>
            <View style={styles.bannerRow}>
              <View style={styles.bannerBadge}>
                <Flame size={14} color="#FFFFFF" />
                <Text style={styles.bannerBadgeText}>COMPUTED LIVE</Text>
              </View>
              <Text style={styles.bannerTimer}>Rolling 7-day window</Text>
            </View>
            <Text style={styles.bannerHeadline}>
              Points are earned by real campus activity — messages sent this week and verified members in each branch. No boosts, no fakes.
            </Text>
          </View>

          {/* Standings Title */}
          <Text style={styles.sectionHeader}>Campus Leaderboard</Text>

          {loading ? (
            <ActivityIndicator color={CampusColors.accent} style={{ marginVertical: 24 }} />
          ) : loadError ? (
            <View style={styles.errorWrap}>
              <Text style={styles.emptyText}>{loadError}</Text>
              <TouchableOpacity style={styles.retryBtn} onPress={load}>
                <RefreshCw size={14} color="#FFFFFF" />
                <Text style={styles.retryText}>Retry</Text>
              </TouchableOpacity>
            </View>
          ) : standings.length === 0 ? (
            <Text style={styles.emptyText}>
              No branch activity yet. Set your branch in your Campus profile and start chatting to climb the board.
            </Text>
          ) : (
            <View style={styles.listCard}>
              {standings.map((item, index) => {
                const isFirst = item.rank === 1;
                const isMyBranch = !!myBranch && item.code === myBranch.trim().toUpperCase();
                const pct = `${Math.max(4, Math.round((item.points / maxPoints) * 100))}%`;
                const color = PALETTE[index % PALETTE.length];

                return (
                  <View
                    key={item.code}
                    style={[
                      styles.rankRow,
                      isMyBranch && styles.myBranchRow,
                      index === standings.length - 1 && { borderBottomWidth: 0 },
                    ]}
                  >
                    <View style={styles.rankBadge}>
                      <Text style={[styles.rankNumber, isFirst && { color: '#B4561A', fontWeight: '800' }]}>
                        {item.rank}
                      </Text>
                    </View>

                    <View style={styles.branchInfo}>
                      <View style={styles.branchTop}>
                        <View style={styles.nameRow}>
                          <Text style={styles.branchName}>{item.code}</Text>
                          {isMyBranch && (
                            <View style={styles.youPill}>
                              <Text style={styles.youText}>YOU</Text>
                            </View>
                          )}
                        </View>
                        <Text style={styles.pointsText}>{item.points.toLocaleString()} pts</Text>
                      </View>

                      <View style={styles.progressBarBg}>
                        <View style={[styles.progressBarFill, { width: pct as any, backgroundColor: color }]} />
                      </View>

                      <View style={styles.statsRow}>
                        <View style={styles.statCol}>
                          <Flame size={11} color={CampusColors.warm} />
                          <Text style={styles.statText}>{item.messagesThisWeek} msgs this week</Text>
                        </View>
                        <View style={styles.statCol}>
                          <Users size={11} color={CampusColors.accent} />
                          <Text style={styles.statText}>{item.activeMembers}/{item.members} active</Text>
                        </View>
                      </View>
                    </View>
                  </View>
                );
              })}
            </View>
          )}
        </ScrollView>
      </View>
      </SafeAreaView>
    </Modal>
  );
};

const styles = themedSheet(() => ({
  errorWrap: {
    alignItems: 'center',
    gap: 12,
    marginVertical: 16,
  },
  retryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: CampusColors.accent,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: CampusLayout.radius.pill,
  },
  retryText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 13,
  },
  container: {
    flex: 1,
    backgroundColor: CampusColors.paper,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
    backgroundColor: CampusColors.card,
    borderBottomWidth: 1,
    borderBottomColor: CampusColors.line,
  },
  closeBtn: {
    padding: 6,
    marginRight: 8,
  },
  headerTitleWrap: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: CampusColors.ink,
  },
  headerSubtitle: {
    fontSize: 12,
    color: CampusColors.warm,
    fontWeight: '600',
  },
  trophyIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: CampusColors.warmSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scroll: {
    flex: 1,
  },
  content: {
    padding: 16,
    gap: 16,
    paddingBottom: 36,
  },
  bannerCard: {
    backgroundColor: CampusColors.inkCard,
    borderRadius: CampusLayout.radius.card,
    padding: 18,
    borderWidth: 1,
    borderColor: CampusColors.inkBorder,
  },
  bannerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  bannerBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: CampusColors.warm,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: CampusLayout.radius.pill,
    gap: 4,
  },
  bannerBadgeText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
  bannerTimer: {
    fontSize: 12,
    color: CampusColors.inkMuted,
  },
  bannerHeadline: {
    fontSize: 14,
    color: '#FFFFFF',
    lineHeight: 21,
    marginBottom: 16,
  },
  cheerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: CampusColors.warm,
    height: 44,
    borderRadius: CampusLayout.radius.pill,
    gap: 6,
  },
  cheerBtnDone: {
    backgroundColor: CampusColors.inkTrack,
  },
  cheerBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  sectionHeader: {
    fontSize: 16,
    fontWeight: '700',
    color: CampusColors.ink,
    marginTop: 4,
  },
  emptyText: {
    fontSize: 13,
    color: CampusColors.muted,
    textAlign: 'center',
    paddingVertical: 24,
    lineHeight: 19,
  },
  listCard: {
    backgroundColor: CampusColors.card,
    borderRadius: CampusLayout.radius.card,
    borderWidth: 1,
    borderColor: CampusColors.line,
    overflow: 'hidden',
  },
  rankRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: CampusColors.line,
  },
  myBranchRow: {
    backgroundColor: CampusColors.accentSoft,
  },
  rankBadge: {
    width: 28,
    alignItems: 'center',
    marginRight: 10,
  },
  rankNumber: {
    fontSize: 18,
    fontWeight: '700',
    color: CampusColors.muted,
  },
  branchInfo: {
    flex: 1,
  },
  branchTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 2,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  branchName: {
    fontSize: 15,
    fontWeight: '700',
    color: CampusColors.ink,
  },
  youPill: {
    backgroundColor: CampusColors.accent,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  youText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  pointsText: {
    fontSize: 14,
    fontWeight: '700',
    color: CampusColors.ink,
  },
  fullName: {
    fontSize: 12,
    color: CampusColors.muted,
    marginBottom: 8,
  },
  progressBarBg: {
    height: 6,
    backgroundColor: CampusColors.placeholderFill,
    borderRadius: 3,
    overflow: 'hidden',
    marginBottom: 8,
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 3,
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  statCol: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  statText: {
    fontSize: 12,
    color: CampusColors.muted,
  },
}));
