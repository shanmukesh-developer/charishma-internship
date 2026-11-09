import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  ScrollView,
  TextInput,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { KeyboardAvoidingView } from '../../../components/KeyboardAvoidingView';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  X,
  Award,
  UploadCloud,
  CheckCircle2,
  Clock,
  Link2,
  AlertCircle,
  RefreshCw,
} from '../../../components/lucide';
import * as Haptics from 'expo-haptics';
import { CampusColors, CampusLayout } from '../../../constants/campusTheme';
import { submitCampusAssignment, fetchMyAssignments, CampusAssignment } from '../campusApi';
import { getUser } from '../../../utils/auth';

import { themedSheet } from '../../../utils/themeNow';
type MySubmission = {
  status?: string;
  turnedInAt?: string;
  submissionText?: string;
  fileUrl?: string;
  grade?: number | string | null;
} | null;

type PortalAssignment = CampusAssignment & {
  groupName?: string | null;
  mySubmission?: MySubmission;
};

interface AssignmentPortalModalProps {
  visible: boolean;
  onClose: () => void;
  assignmentId: string;
  /** Optional: pass the already-loaded assignment to skip the network fetch. */
  assignment?: PortalAssignment | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const formatDue = (iso?: string) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
};

export const AssignmentPortalModal: React.FC<AssignmentPortalModalProps> = ({
  visible,
  onClose,
  assignmentId,
  assignment: assignmentProp,
}) => {
  const [assignment, setAssignment] = useState<PortalAssignment | null>(assignmentProp || null);
  const [loading, setLoading] = useState(!assignmentProp);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submissionText, setSubmissionText] = useState('');
  const [fileUrl, setFileUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [isTurnedIn, setIsTurnedIn] = useState(false);
  const [editing, setEditing] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const applyAssignment = useCallback((a: PortalAssignment) => {
    setAssignment(a);
    const mine = a.mySubmission;
    if (mine && (mine.status === 'turned_in' || mine.status === 'late' || mine.status === 'graded')) {
      setIsTurnedIn(true);
      setSubmissionText(mine.submissionText || '');
      setFileUrl(mine.fileUrl || '');
    }
  }, []);

  const load = useCallback(async () => {
    if (assignmentProp) {
      applyAssignment(assignmentProp);
      setLoading(false);
      return;
    }
    if (!assignmentId || !UUID_RE.test(assignmentId)) {
      setLoading(false);
      setLoadError('This assignment is not available right now.');
      return;
    }
    setLoading(true);
    setLoadError(null);
    try {
      // Assignments across all of my groups, including my own submission status.
      const me = await getUser().catch(() => null);
      const list = (await fetchMyAssignments(me?.id ? String(me.id) : null)) as PortalAssignment[];
      const found = list.find((a) => a.id === assignmentId);
      if (!mountedRef.current) return;
      if (!found) {
        setLoadError('We could not find this assignment. It may have been removed by your instructor.');
      } else {
        applyAssignment(found);
      }
    } catch {
      if (mountedRef.current) setLoadError('Could not load the assignment. Check your connection and try again.');
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [assignmentId, assignmentProp, applyAssignment]);

  useEffect(() => {
    if (visible) load();
  }, [visible, load]);

  const handleSubmit = async () => {
    if (!assignment || submitting) return;
    if (!submissionText.trim() && !fileUrl.trim()) {
      Alert.alert('Nothing to turn in yet', 'Add your answer or paste a link to your work.');
      return;
    }
    const link = fileUrl.trim();
    if (link && !/^https?:\/\/\S+\.\S+/i.test(link)) {
      Alert.alert('Check the link', 'Links should start with https:// (for example a GitHub or Google Drive link).');
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    try {
      setSubmitting(true);
      const result: any = await submitCampusAssignment(assignment.id, {
        submissionText: submissionText.trim() || undefined,
        fileUrl: link || undefined,
      });
      if (!mountedRef.current) return;
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setIsTurnedIn(true);
      setEditing(false);
      const late = result?.submission?.status === 'late';
      Alert.alert(
        late ? 'Turned in (late)' : 'Turned in! 🎉',
        late
          ? 'Your work was submitted after the due date. Your instructor will see it marked as late.'
          : 'Your instructor can now see your submission.'
      );
    } catch (e: any) {
      if (!mountedRef.current) return;
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      const msg = typeof e?.message === 'string' && !/^Failed/i.test(e.message) ? `${e.message}\n\n` : '';
      Alert.alert('Could not turn in', `${msg}Your answer is still here. Please try again.`);
    } finally {
      if (mountedRef.current) setSubmitting(false);
    }
  };

  const locked = isTurnedIn && !editing;
  const dueLabel = formatDue(assignment?.dueDate);
  const overdue = assignment?.dueDate ? new Date(assignment.dueDate).getTime() < Date.now() : false;
  const grade = assignment?.mySubmission?.grade;
  const canRetry = !!assignmentId && UUID_RE.test(assignmentId);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <KeyboardAvoidingView style={{ flex: 1 }}>
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} style={styles.closeBtn} accessibilityLabel="Close">
            <X size={22} color={CampusColors.ink} />
          </TouchableOpacity>
          <View style={styles.headerTitleWrap}>
            <Text style={styles.headerTitle}>Assignment Turn-In</Text>
            {!!(assignment?.groupName || assignment?.topic) && (
              <Text style={styles.headerSubtitle} numberOfLines={1}>
                {[assignment?.groupName, assignment?.topic].filter(Boolean).join(' • ')}
              </Text>
            )}
          </View>
          {isTurnedIn && (
            <View style={styles.turnedInBadge}>
              <CheckCircle2 size={12} color="#166534" />
              <Text style={styles.turnedInText}>TURNED IN</Text>
            </View>
          )}
        </View>

        {loading ? (
          <View style={styles.stateWrap}>
            <ActivityIndicator color={CampusColors.accent} />
            <Text style={styles.stateText}>Loading assignment…</Text>
          </View>
        ) : loadError || !assignment ? (
          <View style={styles.stateWrap}>
            <AlertCircle size={28} color={CampusColors.warm} />
            <Text style={styles.stateText}>{loadError || 'This assignment is not available right now.'}</Text>
            {canRetry ? (
              <TouchableOpacity style={styles.retryBtn} onPress={load}>
                <RefreshCw size={14} color="#FFFFFF" />
                <Text style={styles.turnInBtnText}>Retry</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity style={styles.retryBtn} onPress={onClose}>
                <Text style={styles.turnInBtnText}>Go back</Text>
              </TouchableOpacity>
            )}
          </View>
        ) : (
          <ScrollView style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            {/* Details Card */}
            <View style={styles.card}>
              <Text style={styles.assignmentTitle}>{assignment.title}</Text>

              <View style={styles.metaRow}>
                {!!dueLabel && (
                  <View style={styles.metaCol}>
                    <Clock size={13} color={overdue ? CampusColors.sos : CampusColors.warm} />
                    <Text style={[styles.metaText, { color: overdue ? CampusColors.sos : CampusColors.warm, fontWeight: '700' }]}>
                      {overdue ? 'Was due ' : 'Due '}
                      {dueLabel}
                    </Text>
                  </View>
                )}
                {!!assignment.points && (
                  <View style={styles.metaCol}>
                    <Award size={13} color={CampusColors.accent} />
                    <Text style={styles.metaText}>
                      {grade != null && grade !== '' ? `Graded ${grade}/${assignment.points}` : `${assignment.points} Points`}
                    </Text>
                  </View>
                )}
              </View>
              {!!assignment.facultyName && (
                <Text style={styles.metaText}>Posted by {assignment.facultyName}</Text>
              )}

              {!!assignment.instructions?.trim() && (
                <>
                  <Text style={styles.sectionHeading}>Instructions</Text>
                  <Text style={styles.instructionsBody}>{assignment.instructions}</Text>
                </>
              )}
            </View>

            {/* Submission Form */}
            <View style={styles.card}>
              <Text style={styles.sectionHeading}>Your Submission</Text>

              <Text style={styles.inputLabel}>Written Response / Code Explanation</Text>
              <TextInput
                style={[styles.textArea, locked && { opacity: 0.7 }]}
                placeholder="Type your answer, analysis or summary here..."
                placeholderTextColor={CampusColors.muted}
                value={submissionText}
                onChangeText={setSubmissionText}
                multiline
                editable={!locked && !submitting}
              />

              <Text style={styles.inputLabel}>Repository or Google Drive / PDF Link</Text>
              <View style={[styles.linkInputRow, locked && { opacity: 0.7 }]}>
                <Link2 size={16} color={CampusColors.muted} />
                <TextInput
                  style={styles.linkInput}
                  placeholder="https://github.com/... or Google Drive link"
                  placeholderTextColor={CampusColors.muted}
                  value={fileUrl}
                  onChangeText={setFileUrl}
                  editable={!locked && !submitting}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="url"
                />
              </View>

              {locked ? (
                <>
                  <View style={[styles.turnInBtn, styles.turnInBtnDone]}>
                    <CheckCircle2 size={16} color="#FFFFFF" />
                    <Text style={styles.turnInBtnText}>Turned In Successfully</Text>
                  </View>
                  <TouchableOpacity onPress={() => setEditing(true)} style={styles.editLink}>
                    <Text style={styles.editLinkText}>Update my submission</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <TouchableOpacity
                  style={[styles.turnInBtn, submitting && { opacity: 0.7 }]}
                  onPress={handleSubmit}
                  disabled={submitting}
                >
                  {submitting ? (
                    <ActivityIndicator color="#FFFFFF" />
                  ) : (
                    <>
                      <UploadCloud size={16} color="#FFFFFF" />
                      <Text style={styles.turnInBtnText}>{isTurnedIn ? 'Resubmit' : 'Turn In Assignment'}</Text>
                    </>
                  )}
                </TouchableOpacity>
              )}
            </View>
          </ScrollView>
        )}
      </View>
      </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
};

const styles = themedSheet(() => ({
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
    color: CampusColors.accent,
    fontWeight: '600',
  },
  turnedInBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#DCFCE7',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    gap: 4,
  },
  turnedInText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#166534',
  },
  scroll: {
    flex: 1,
  },
  content: {
    padding: 16,
    gap: 16,
    paddingBottom: 36,
  },
  card: {
    backgroundColor: CampusColors.card,
    borderRadius: CampusLayout.radius.card,
    padding: 18,
    borderWidth: 1,
    borderColor: CampusColors.line,
    gap: 12,
  },
  assignmentTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: CampusColors.ink,
    lineHeight: 24,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  metaCol: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  metaText: {
    fontSize: 12,
    color: CampusColors.muted,
  },
  sectionHeading: {
    fontSize: 14,
    fontWeight: '700',
    color: CampusColors.ink,
    marginTop: 4,
  },
  instructionsBody: {
    fontSize: 13,
    color: CampusColors.muted,
    lineHeight: 20,
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: CampusColors.ink,
  },
  textArea: {
    backgroundColor: CampusColors.paper,
    borderWidth: 1,
    borderColor: CampusColors.line,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 13,
    color: CampusColors.ink,
    height: 110,
    textAlignVertical: 'top',
  },
  linkInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: CampusColors.paper,
    borderWidth: 1,
    borderColor: CampusColors.line,
    borderRadius: 10,
    paddingHorizontal: 12,
    height: 44,
    gap: 8,
  },
  linkInput: {
    flex: 1,
    fontSize: 13,
    color: CampusColors.ink,
  },
  turnInBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: CampusColors.accent,
    height: 46,
    borderRadius: CampusLayout.radius.pill,
    gap: 8,
    marginTop: 8,
  },
  stateWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 12,
  },
  stateText: {
    fontSize: 14,
    color: CampusColors.muted,
    textAlign: 'center',
    lineHeight: 20,
  },
  retryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: CampusColors.accent,
    paddingHorizontal: 18,
    height: 40,
    borderRadius: CampusLayout.radius.pill,
    marginTop: 4,
  },
  editLink: {
    alignSelf: 'center',
    paddingVertical: 6,
  },
  editLinkText: {
    fontSize: 13,
    fontWeight: '700',
    color: CampusColors.accent,
  },
  turnInBtnDone: {
    backgroundColor: '#059669',
  },
  turnInBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
}));
