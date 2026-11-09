import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { KeyboardAvoidingView } from '../../../components/KeyboardAvoidingView';
import * as Haptics from 'expo-haptics';
import { ArrowLeft, BookOpen, Megaphone, CheckCircle2, Clock } from '../../../components/lucide';
import { CampusColors } from '../../../constants/campusTheme';
import { CampusUserData } from '../../../types/campus';
import {
  CampusGroup,
  CampusAssignment,
  CampusAnnouncement,
  fetchMyGroups,
  fetchAssignments,
  fetchAnnouncements,
  submitCampusAssignment,
  ackCampusAnnouncement,
} from '../campusApi';

import { themedSheet } from '../../../utils/themeNow';
interface ClassworkScreenProps {
  currentUser: CampusUserData | null;
  onBack: () => void;
}

export const ClassworkScreen: React.FC<ClassworkScreenProps> = ({ currentUser, onBack }) => {
  const [classes, setClasses] = useState<CampusGroup[]>([]);
  const [activeClass, setActiveClass] = useState<CampusGroup | null>(null);
  const [assignments, setAssignments] = useState<CampusAssignment[]>([]);
  const [announcements, setAnnouncements] = useState<CampusAnnouncement[]>([]);
  const [loadingClasses, setLoadingClasses] = useState(true);
  const [loadingContent, setLoadingContent] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [classesError, setClassesError] = useState<string | null>(null);
  const [contentError, setContentError] = useState<string | null>(null);
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  const [ackingId, setAckingId] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const friendly = (e: any, fallback: string) =>
    typeof e?.message === 'string' && e.message && !/^Failed/i.test(e.message) ? e.message : fallback;

  const loadClasses = useCallback(async () => {
    setLoadingClasses(true);
    setClassesError(null);
    try {
      const groups = await fetchMyGroups();
      if (!mountedRef.current) return;
      const classGroups = groups.filter((g) => (g.type || '').toLowerCase() === 'class');
      setClasses(classGroups.length ? classGroups : groups);
    } catch (e: any) {
      if (mountedRef.current) setClassesError(friendly(e, "Couldn't load your classes. Check your connection and try again."));
    } finally {
      if (mountedRef.current) setLoadingClasses(false);
    }
  }, []);

  useEffect(() => {
    loadClasses();
  }, [loadClasses]);

  // Switching classes quickly must never show the previous class's work under the new name.
  const contentReqRef = useRef(0);
  const loadContent = useCallback(async (group: CampusGroup, silent = false) => {
    const reqId = ++contentReqRef.current;
    setActiveClass(group);
    if (!silent) {
      setLoadingContent(true);
      setAssignments([]);
      setAnnouncements([]);
    }
    setContentError(null);
    try {
      const [a, an] = await Promise.all([
        fetchAssignments(group.id),
        fetchAnnouncements(group.id),
      ]);
      if (!mountedRef.current || reqId !== contentReqRef.current) return;
      setAssignments(a);
      setAnnouncements(an);
    } catch (e: any) {
      if (mountedRef.current && reqId === contentReqRef.current) {
        setContentError(friendly(e, "Couldn't load this class. Check your connection and try again."));
      }
    } finally {
      if (mountedRef.current && reqId === contentReqRef.current) setLoadingContent(false);
    }
  }, []);

  const handleSubmit = async (assignment: CampusAssignment) => {
    const text = (drafts[assignment.id] || '').trim();
    if (!text) {
      Alert.alert('Nothing to turn in yet', 'Write your answer first.');
      return;
    }
    if (submittingId) return;
    setSubmittingId(assignment.id);
    try {
      await submitCampusAssignment(assignment.id, { submissionText: text });
      if (!mountedRef.current) return;
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setDrafts((d) => ({ ...d, [assignment.id]: '' }));
      if (activeClass) loadContent(activeClass, true);
    } catch (e: any) {
      if (mountedRef.current) {
        Alert.alert('Could not turn in', `${friendly(e, 'Please try again.')} Your answer is still here.`);
      }
    } finally {
      if (mountedRef.current) setSubmittingId(null);
    }
  };

  const handleAck = async (announcementId: string) => {
    if (ackingId) return;
    setAckingId(announcementId);
    try {
      await ackCampusAnnouncement(announcementId);
      if (mountedRef.current && activeClass) loadContent(activeClass, true);
    } catch (e: any) {
      if (mountedRef.current) Alert.alert("Couldn't update", friendly(e, 'Please try again.'));
    } finally {
      if (mountedRef.current) setAckingId(null);
    }
  };

  const mySubmission = (a: CampusAssignment) =>
    (a.submissions || []).find((s: any) => s.studentId === currentUser?.id);

  return (
    <KeyboardAvoidingView style={styles.safeArea}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={onBack}>
          <ArrowLeft size={22} color={CampusColors.ink} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Classwork</Text>
        <View style={{ width: 30 }} />
      </View>

      {!activeClass ? (
        loadingClasses ? (
          <View style={styles.center}><ActivityIndicator size="large" color={CampusColors.accent} /></View>
        ) : classesError ? (
          <View style={styles.center}>
            <Text style={styles.emptyText}>{classesError}</Text>
            <TouchableOpacity style={styles.turnInBtn} onPress={loadClasses}>
              <Text style={styles.turnInText}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : classes.length === 0 ? (
          <View style={styles.center}>
            <BookOpen size={40} color={CampusColors.muted} />
            <Text style={styles.emptyText}>No classes yet. Join a classroom from Groups.</Text>
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.list}>
            <Text style={styles.sectionLabel}>SELECT A CLASS</Text>
            {classes.map((c) => (
              <TouchableOpacity key={c.id} style={styles.classCard} onPress={() => loadContent(c)}>
                <Text style={styles.className} numberOfLines={1}>{c.name}</Text>
                {typeof c.memberCount === 'number' && (
                  <Text style={styles.classMeta}>
                    {c.memberCount} member{c.memberCount === 1 ? '' : 's'}
                  </Text>
                )}
              </TouchableOpacity>
            ))}
          </ScrollView>
        )
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          <TouchableOpacity style={styles.switchBtn} onPress={() => setActiveClass(null)}>
            <Text style={styles.switchText}>{activeClass.name} — switch class</Text>
          </TouchableOpacity>

          {loadingContent ? (
            <View style={styles.center}><ActivityIndicator color={CampusColors.accent} /></View>
          ) : contentError ? (
            <View style={styles.center}>
              <Text style={styles.emptyText}>{contentError}</Text>
              <TouchableOpacity style={styles.turnInBtn} onPress={() => loadContent(activeClass)}>
                <Text style={styles.turnInText}>Retry</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <>
              <Text style={styles.sectionLabel}>ANNOUNCEMENTS</Text>
              {announcements.length === 0 && (
                <Text style={styles.noneText}>No announcements yet.</Text>
              )}
              {announcements.map((an) => {
                const acked = (an.acks || []).includes(currentUser?.id || '');
                return (
                  <View key={an.id} style={styles.announcementCard}>
                    <View style={styles.announcementHead}>
                      <Megaphone size={15} color={CampusColors.accentDeep} />
                      <Text style={styles.announcementTitle} numberOfLines={1}>{an.title}</Text>
                    </View>
                    <Text style={styles.announcementBody}>{an.body}</Text>
                    <Text style={styles.announcementMeta}>by {an.facultyName}</Text>
                    {!acked && (
                      <TouchableOpacity
                        style={[styles.ackBtn, ackingId === an.id && { opacity: 0.6 }]}
                        disabled={ackingId === an.id}
                        onPress={() => handleAck(an.id)}
                      >
                        <Text style={styles.ackText}>{ackingId === an.id ? 'Saving…' : 'Got it'}</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                );
              })}

              <Text style={styles.sectionLabel}>ASSIGNMENTS</Text>
              {assignments.length === 0 && <Text style={styles.noneText}>No assignments yet.</Text>}
              {assignments.map((a) => {
                const sub = mySubmission(a);
                const overdue = new Date(a.dueDate) < new Date();
                return (
                  <View key={a.id} style={styles.assignmentCard}>
                    <Text style={styles.assignmentTitle} numberOfLines={1}>{a.title}</Text>
                    {a.instructions ? <Text style={styles.assignmentInstructions}>{a.instructions}</Text> : null}
                    <View style={styles.assignmentMetaRow}>
                      <Clock size={13} color={overdue ? '#A3321A' : CampusColors.muted} />
                      <Text style={[styles.assignmentDue, overdue && { color: '#A3321A' }]}>
                        {overdue ? 'Was due ' : 'Due '}
                        {new Date(a.dueDate).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}
                        {typeof a.points === 'number' ? ` • ${a.points} pts` : ''}
                      </Text>
                    </View>

                    {sub ? (
                      <View style={styles.submittedRow}>
                        <CheckCircle2 size={15} color="#2E7D32" />
                        <Text style={styles.submittedText}>
                          {sub.status === 'late' ? 'Turned in late' : sub.status === 'graded' ? 'Graded' : 'Turned in'}
                          {sub.grade != null && sub.grade !== '' ? ` • ${sub.grade}${typeof a.points === 'number' ? `/${a.points}` : ''}` : ''}
                          {sub.submissionText ? ` — ${sub.submissionText}` : ''}
                        </Text>
                      </View>
                    ) : (
                      <>
                        <TextInput
                          style={styles.draftInput}
                          placeholder="Write your answer..."
                          placeholderTextColor={CampusColors.muted}
                          value={drafts[a.id] || ''}
                          onChangeText={(t) => setDrafts((d) => ({ ...d, [a.id]: t }))}
                          multiline
                        />
                        <TouchableOpacity
                          style={[styles.turnInBtn, submittingId === a.id && { opacity: 0.7 }]}
                          onPress={() => handleSubmit(a)}
                          disabled={submittingId === a.id}
                        >
                          {submittingId === a.id ? (
                            <ActivityIndicator color="#FFFFFF" size="small" />
                          ) : (
                            <Text style={styles.turnInText}>Turn in</Text>
                          )}
                        </TouchableOpacity>
                      </>
                    )}
                  </View>
                );
              })}
            </>
          )}
        </ScrollView>
      )}
    </KeyboardAvoidingView>
  );
};

const styles = themedSheet(() => ({
  safeArea: { flex: 1, backgroundColor: CampusColors.paper },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: CampusColors.card,
    borderBottomWidth: 1,
    borderBottomColor: CampusColors.line,
  },
  backBtn: { padding: 4, width: 30 },
  headerTitle: { fontSize: 17, fontWeight: '700', color: CampusColors.ink },
  center: { padding: 40, alignItems: 'center', justifyContent: 'center', gap: 10 },
  emptyText: { color: CampusColors.muted, fontSize: 13, textAlign: 'center' },
  list: { padding: 16, gap: 12 },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1.5,
    color: CampusColors.muted,
    marginTop: 6,
  },
  classCard: {
    backgroundColor: CampusColors.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: CampusColors.line,
    padding: 14,
  },
  className: { fontSize: 15, fontWeight: '700', color: CampusColors.ink },
  classMeta: { fontSize: 12, color: CampusColors.muted, marginTop: 2 },
  switchBtn: { alignSelf: 'flex-start' },
  switchText: { fontSize: 12, fontWeight: '700', color: CampusColors.accent },
  noneText: { fontSize: 13, color: CampusColors.muted },
  announcementCard: {
    backgroundColor: CampusColors.warmSoft,
    borderRadius: 14,
    padding: 14,
    gap: 6,
  },
  announcementHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  announcementTitle: { fontSize: 14, fontWeight: '700', color: CampusColors.ink, flex: 1 },
  announcementBody: { fontSize: 13, color: CampusColors.ink, lineHeight: 19 },
  announcementMeta: { fontSize: 12, color: CampusColors.muted },
  ackBtn: {
    alignSelf: 'flex-start',
    backgroundColor: CampusColors.accent,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 14,
    marginTop: 4,
  },
  ackText: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' },
  assignmentCard: {
    backgroundColor: CampusColors.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: CampusColors.line,
    padding: 14,
    gap: 8,
  },
  assignmentTitle: { fontSize: 15, fontWeight: '700', color: CampusColors.ink },
  assignmentInstructions: { fontSize: 13, color: CampusColors.muted, lineHeight: 18 },
  assignmentMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  assignmentDue: { fontSize: 12, color: CampusColors.muted },
  submittedRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  submittedText: { fontSize: 12, color: '#2E7D32', flex: 1 },
  draftInput: {
    backgroundColor: CampusColors.paper,
    borderWidth: 1,
    borderColor: CampusColors.line,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 13,
    color: CampusColors.ink,
    minHeight: 60,
    textAlignVertical: 'top',
  },
  turnInBtn: {
    alignSelf: 'flex-end',
    backgroundColor: CampusColors.accent,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 14,
  },
  turnInText: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },
}));
