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
  BookOpen,
  FileText,
  CheckCircle,
  AlertTriangle,
  Play,
  ChevronRight,
  Clock,
} from '../../../components/lucide';
import * as Haptics from 'expo-haptics';
import { CampusColors, CampusLayout } from '../../../constants/campusTheme';
import { CampusProfileData, CampusUserData } from '../../../types/campus';
import { fetchMyAssignments, CampusMyAssignment } from '../campusApi';
import ShimmerLoader from '../../../components/ShimmerLoader';

import { themedSheet } from '../../../utils/themeNow';
interface StudyTabProps {
  profile: CampusProfileData | null;
  user: CampusUserData | null;
  onOpenStudySync: () => void;
  /** Opens the turn-in portal for a pending assignment (falls back to Classwork when absent). */
  onOpenAssignment?: (assignmentId: string) => void;
  onOpenClasswork: () => void;
  /** Bump to silently reload assignments (e.g. after a turn-in). */
  refreshKey?: number;
}

const formatDue = (value?: string | null): string => {
  if (!value) return '';
  const d = new Date(value);
  if (isNaN(d.getTime())) return '';
  const now = new Date();
  const diffMs = d.getTime() - now.getTime();
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return `Due today, ${time}`;
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  if (d.toDateString() === tomorrow.toDateString()) return `Due tomorrow, ${time}`;
  if (diffMs > 0 && diffMs < 6 * 86400000) {
    return `Due ${d.toLocaleDateString([], { weekday: 'long' })}, ${time}`;
  }
  return `Due ${d.toLocaleDateString([], { day: '2-digit', month: 'short' })}, ${time}`;
};

const submissionLabel = (a: CampusMyAssignment): string | null => {
  const sub = a.mySubmission;
  if (!sub) return null;
  if (sub.grade != null && sub.grade !== '') {
    return a.points ? `Graded ${sub.grade}/${a.points}` : `Graded ${sub.grade}`;
  }
  if (sub.status === 'late') return 'Turned in late';
  return 'Turned in';
};

export const StudyTab: React.FC<StudyTabProps> = ({
  user,
  onOpenStudySync,
  onOpenAssignment,
  onOpenClasswork,
  refreshKey,
}) => {
  const [refreshing, setRefreshing] = useState(false);
  const [assignments, setAssignments] = useState<CampusMyAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const loadAssignments = useCallback(async () => {
    try {
      const list = await fetchMyAssignments(user?.id);
      if (!mountedRef.current) return;
      setAssignments(list);
      setError(null);
    } catch (e: any) {
      if (!mountedRef.current) return;
      setError(e?.message || "Couldn't load your assignments.");
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    loadAssignments();
  }, [loadAssignments]);

  const firstRefreshKey = useRef(refreshKey);
  useEffect(() => {
    if (refreshKey === firstRefreshKey.current) return;
    loadAssignments();
  }, [refreshKey, loadAssignments]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadAssignments();
    if (mountedRef.current) setRefreshing(false);
  };

  // Pending first (soonest due), then most recent turned-in work; keep the card short.
  const pending = assignments.filter((a) => !a.mySubmission);
  const done = assignments.filter((a) => !!a.mySubmission).reverse();
  const upcoming = [...pending, ...done].slice(0, 5);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={CampusColors.accent} />}
    >
      {/* Phase 3: Classwork entry */}
      <TouchableOpacity style={styles.classworkEntry} onPress={onOpenClasswork} activeOpacity={0.85}>
        <BookOpen size={16} color={CampusColors.accentDeep} strokeWidth={2.2} />
        <Text style={styles.classworkEntryText}>Open Classwork (assignments & announcements)</Text>
      </TouchableOpacity>

      {/* 1. Focus timer card */}
      <TouchableOpacity
        style={styles.studySyncCard}
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          onOpenStudySync();
        }}
        activeOpacity={0.88}
      >
        <View style={styles.syncHeader}>
          <View style={styles.syncLiveBadge}>
            <View style={styles.pulseDot} />
            <Text style={styles.syncLiveText}>FOCUS MODE</Text>
          </View>
        </View>

        <Text style={styles.syncTitle}>Deep Work • Pomodoro 50/10</Text>
        <Text style={styles.syncSubtitle}>
          A distraction-free focus timer with a short task list for your study session.
        </Text>

        <View style={styles.syncActionRow}>
          <View style={styles.syncJoinBtn}>
            <Play size={14} color="#FFFFFF" fill="#FFFFFF" />
            <Text style={styles.syncJoinText}>Start Focus</Text>
          </View>
        </View>
      </TouchableOpacity>

      {/* 2. Assignments & Deadlines (real data from your groups) */}
      <View style={styles.sectionCard}>
        <View style={styles.sectionHeader}>
          <View style={styles.titleRow}>
            <FileText size={18} color={CampusColors.warm} strokeWidth={2.2} />
            <Text style={styles.sectionTitle}>Assignments & Deadlines</Text>
          </View>
          {!loading && pending.length > 0 && (
            <Text style={styles.classCount}>{pending.length} pending</Text>
          )}
        </View>

        {loading ? (
          <View style={{ gap: 12 }}>
            {[0, 1].map((i) => (
              <View key={i} style={styles.skeletonRow}>
                <ShimmerLoader width={38} height={38} borderRadius={10} />
                <View style={{ flex: 1, gap: 6 }}>
                  <ShimmerLoader width="70%" height={14} borderRadius={6} />
                  <ShimmerLoader width="45%" height={11} borderRadius={6} />
                </View>
              </View>
            ))}
          </View>
        ) : error && assignments.length === 0 ? (
          <View style={styles.emptyWrap}>
            <Text style={styles.emptyTitle}>Couldn't load assignments</Text>
            <Text style={styles.emptySubtitle}>{error}</Text>
            <TouchableOpacity
              style={styles.emptyCta}
              onPress={() => {
                setLoading(true);
                loadAssignments();
              }}
            >
              <Text style={styles.emptyCtaText}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : upcoming.length === 0 ? (
          <View style={styles.emptyWrap}>
            <Text style={styles.emptyTitle}>No assignments yet 🎉</Text>
            <Text style={styles.emptySubtitle}>
              When your faculty or CR posts work in a class group, it shows up here.
            </Text>
          </View>
        ) : (
          upcoming.map((a, idx) => {
            const doneLabel = submissionLabel(a);
            const overdue = !doneLabel && new Date(a.dueDate).getTime() < Date.now();
            return (
              <TouchableOpacity
                key={a.id}
                style={[styles.assignmentItem, idx === upcoming.length - 1 && { borderBottomWidth: 0 }]}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  if (!doneLabel && onOpenAssignment) onOpenAssignment(a.id);
                  else onOpenClasswork();
                }}
                activeOpacity={0.7}
              >
                <View
                  style={[
                    styles.assignmentIconWrap,
                    { backgroundColor: doneLabel ? CampusColors.accentSoft : CampusColors.warmSoft },
                  ]}
                >
                  {doneLabel ? (
                    <CheckCircle size={18} color={CampusColors.accentDeep} />
                  ) : overdue ? (
                    <AlertTriangle size={18} color={CampusColors.warmDeep} />
                  ) : (
                    <Clock size={18} color={CampusColors.warmDeep} />
                  )}
                </View>
                <View style={styles.assignmentInfo}>
                  <Text style={styles.assignmentTitle} numberOfLines={1}>
                    {a.title}
                  </Text>
                  <Text style={styles.assignmentDue} numberOfLines={1}>
                    {[
                      doneLabel || (overdue ? 'Past due' : formatDue(a.dueDate)),
                      a.points ? `${a.points} Points` : null,
                      a.groupName || null,
                    ]
                      .filter(Boolean)
                      .join(' • ')}
                  </Text>
                </View>
                {doneLabel ? (
                  <ChevronRight size={16} color={CampusColors.muted} />
                ) : (
                  <View style={styles.turnInPill}>
                    <Text style={styles.turnInText}>Turn In</Text>
                  </View>
                )}
              </TouchableOpacity>
            );
          })
        )}
      </View>
    </ScrollView>
  );
};

const styles = themedSheet(() => ({
  container: {
    flex: 1,
    backgroundColor: CampusColors.paper,
  },
  content: {
    paddingHorizontal: CampusLayout.spacing.lg,
    paddingTop: 12,
    paddingBottom: 28,
  },
  classworkEntry: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: CampusColors.accentSoft,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 12,
  },
  classworkEntryText: {
    fontSize: 14,
    fontWeight: '700',
    color: CampusColors.accentDeep,
  },
  studySyncCard: {
    backgroundColor: CampusColors.inkCard,
    borderRadius: CampusLayout.radius.card,
    padding: 16,
    marginBottom: 16,
  },
  syncHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  syncLiveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(29, 168, 112, 0.2)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: CampusLayout.radius.pill,
    gap: 6,
  },
  pulseDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#3DD598',
  },
  syncLiveText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#B7E4B7',
    letterSpacing: 0.6,
  },
  syncOnlineText: {
    fontSize: 12,
    color: CampusColors.inkMuted,
  },
  syncTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#FFFFFF',
    marginBottom: 4,
  },
  syncSubtitle: {
    fontSize: 13,
    color: CampusColors.inkMuted,
    lineHeight: 18,
    marginBottom: 14,
  },
  syncActionRow: {
    flexDirection: 'row',
  },
  syncJoinBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: CampusColors.accent,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: CampusLayout.radius.pill,
    gap: 6,
  },
  syncJoinText: {
    fontSize: 13,
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
    marginBottom: 14,
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
  classCount: {
    fontSize: 12,
    color: CampusColors.muted,
    fontWeight: '500',
  },
  timeline: {
    gap: 0,
  },
  timelineItem: {
    flexDirection: 'row',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: CampusColors.line,
    alignItems: 'center',
  },
  timeColumn: {
    width: 68,
  },
  timeStart: {
    fontSize: 13,
    fontWeight: '700',
    color: CampusColors.ink,
  },
  timeEnd: {
    fontSize: 12,
    color: CampusColors.muted,
  },
  statusStrip: {
    width: 4,
    height: 40,
    borderRadius: 2,
    marginHorizontal: 10,
  },
  classDetails: {
    flex: 1,
  },
  courseName: {
    fontSize: 14,
    fontWeight: '700',
    color: CampusColors.ink,
    marginBottom: 2,
  },
  classMeta: {
    fontSize: 12,
    color: CampusColors.muted,
  },
  classBadge: {
    alignSelf: 'flex-start',
    backgroundColor: CampusColors.accentSoft,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    marginTop: 4,
  },
  classBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: CampusColors.accentDeep,
  },
  assignmentItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: CampusColors.line,
    gap: 12,
  },
  assignmentIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  assignmentInfo: {
    flex: 1,
  },
  assignmentTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: CampusColors.ink,
    marginBottom: 2,
  },
  assignmentDue: {
    fontSize: 12,
    color: CampusColors.muted,
  },
  turnInPill: {
    backgroundColor: CampusColors.accent,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: CampusLayout.radius.pill,
  },
  turnInText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  skeletonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  emptyWrap: {
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 8,
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: CampusColors.ink,
    marginBottom: 4,
  },
  emptySubtitle: {
    fontSize: 13,
    color: CampusColors.muted,
    textAlign: 'center',
    lineHeight: 18,
  },
  emptyCta: {
    marginTop: 12,
    backgroundColor: CampusColors.accent,
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderRadius: CampusLayout.radius.pill,
  },
  emptyCtaText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
  },
}));
