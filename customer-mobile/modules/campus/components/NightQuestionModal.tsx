import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { KeyboardAvoidingView } from '../../../components/KeyboardAvoidingView';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  X,
  Moon,
  Send,
  ThumbsUp,
  Sparkles,
  Flame,
  CheckCircle2,
  RefreshCw,
} from '../../../components/lucide';
import * as Haptics from 'expo-haptics';
import { CampusColors, CampusLayout } from '../../../constants/campusTheme';
import {
  fetchDailyQuestion,
  submitDailyAnswer,
  upvoteDailyAnswer,
  PulseAnswer,
} from '../campusApi';

import { themedSheet } from '../../../utils/themeNow';
interface NightQuestionModalProps {
  visible: boolean;
  onClose: () => void;
}

const timeAgo = (iso: string) => {
  const then = new Date(iso).getTime();
  if (isNaN(then)) return '';
  const mins = Math.max(0, Math.floor((Date.now() - then) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
};

export const NightQuestionModal: React.FC<NightQuestionModalProps> = ({
  visible,
  onClose,
}) => {
  const [question, setQuestion] = useState<string | null>(null);
  const [answers, setAnswers] = useState<PulseAnswer[]>([]);
  const [answerCount, setAnswerCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [myAnswer, setMyAnswer] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  // false when the server says answers are closed (or not open yet) for this question
  const [acceptingAnswers, setAcceptingAnswers] = useState(true);
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
      const data = await fetchDailyQuestion();
      if (!mountedRef.current) return;
      setQuestion(data.question?.question || null);
      setAnswers(data.answers);
      setAnswerCount(data.answerCount);
      setSubmitted(data.iAnswered);
      setAcceptingAnswers((data.question as any)?.isOpen !== false);
    } catch (e: any) {
      if (mountedRef.current) {
        setLoadError(e?.message || "We couldn't load tonight's question. Check your connection and try again.");
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (visible) load();
  }, [visible, load]);

  const handleUpvote = async (id: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      const res = await upvoteDailyAnswer(id);
      if (!mountedRef.current) return;
      setAnswers((prev) =>
        prev.map((a) => (a.id === id ? { ...a, upvotes: res.upvotes, iUpvoted: res.iUpvoted } : a))
      );
    } catch (e: any) {
      if (mountedRef.current) Alert.alert("Couldn't upvote", e?.message || 'Please try again in a moment.');
    }
  };

  const handleSubmit = async () => {
    if (submitting) return;
    if (!myAnswer.trim()) {
      Alert.alert('Empty answer', 'Write your answer first. It stays anonymous.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await submitDailyAnswer(myAnswer.trim());
      if (!mountedRef.current) return;
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      const { answerCount: _c, ...entry } = res;
      setAnswers((prev) => [entry as PulseAnswer, ...prev]);
      setAnswerCount(res.answerCount);
      setMyAnswer('');
      setSubmitted(true);
    } catch (e: any) {
      if (!mountedRef.current) return;
      Alert.alert("Couldn't submit", e?.message || 'Your answer is still here. Please try again.');
    } finally {
      if (mountedRef.current) setSubmitting(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <KeyboardAvoidingView style={{ flex: 1 }}>
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
            <X size={22} color="#FFFFFF" />
          </TouchableOpacity>
          <View style={styles.badge}>
            <Moon size={13} color={CampusColors.lavender} />
            <Text style={styles.badgeText}>THE 9 PM QUESTION</Text>
          </View>
          <View style={{ width: 32 }} />
        </View>

        <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
          {/* Question Card */}
          <View style={styles.questionCard}>
            <Text style={styles.countdownText}>LIVE TONIGHT</Text>
            {loading ? (
              <ActivityIndicator color={CampusColors.lavender} style={{ marginVertical: 18 }} />
            ) : loadError ? (
              <View style={styles.errorWrap}>
                <Text style={styles.errorText}>{loadError}</Text>
                <TouchableOpacity style={styles.retryBtn} onPress={load}>
                  <RefreshCw size={14} color="#FFFFFF" />
                  <Text style={styles.retryText}>Retry</Text>
                </TouchableOpacity>
              </View>
            ) : question ? (
              <Text style={styles.questionText}>"{question}"</Text>
            ) : (
              <Text style={styles.questionText}>No question is live right now. Check back at 9 PM.</Text>
            )}
            {!loading && !loadError && (
            <View style={styles.metaRow}>
              <Flame size={14} color="#F2B27E" />
              <Text style={styles.metaText}>
                {answerCount} verified student{answerCount === 1 ? '' : 's'} answering tonight
              </Text>
            </View>
            )}
          </View>

          {/* Submission Box */}
          <View style={styles.submitSection}>
            <Text style={styles.sectionHeader}>Your Anonymous Confession</Text>
            <TextInput
              style={styles.answerInput}
              placeholder="Spill the tea... your name is 100% hidden."
              placeholderTextColor={CampusColors.nightMuted}
              value={myAnswer}
              onChangeText={setMyAnswer}
              multiline
              maxLength={500}
              editable={!submitted && !!question && acceptingAnswers}
            />
            <TouchableOpacity
              style={[styles.submitBtn, submitted && styles.submittedBtn, !submitted && (!question || !acceptingAnswers) && { opacity: 0.5 }]}
              onPress={handleSubmit}
              disabled={submitted || submitting || !question || !acceptingAnswers}
            >
              {submitting ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : submitted ? (
                <>
                  <CheckCircle2 size={16} color="#FFFFFF" />
                  <Text style={styles.submitBtnText}>Answer Submitted!</Text>
                </>
              ) : !acceptingAnswers ? (
                <Text style={styles.submitBtnText}>Answers are closed for this question</Text>
              ) : (
                <>
                  <Send size={15} color="#FFFFFF" />
                  <Text style={styles.submitBtnText}>Submit Anonymously</Text>
                </>
              )}
            </TouchableOpacity>
          </View>

          {/* Live Answers Feed */}
          <View style={styles.answersSection}>
            <View style={styles.feedHeaderRow}>
              <Text style={styles.sectionHeader}>Revealed Answers Tonight</Text>
              <Sparkles size={14} color={CampusColors.lavender} />
            </View>

            {loading ? (
              <ActivityIndicator color={CampusColors.lavender} style={{ marginVertical: 16 }} />
            ) : loadError ? null : answers.length === 0 ? (
              <Text style={styles.emptyText}>No answers yet. Be the first to confess.</Text>
            ) : (
              answers.map((item) => (
                <View key={item.id} style={styles.answerCard}>
                  <View style={styles.cardTop}>
                    <View style={styles.aliasWrap}>
                      <View style={styles.dot} />
                      <Text style={styles.aliasText}>{item.alias}</Text>
                    </View>
                    <Text style={styles.timeText}>{timeAgo(item.createdAt)}</Text>
                  </View>

                  <Text style={styles.answerBody}>{item.answer}</Text>

                  <View style={styles.cardBottom}>
                    <TouchableOpacity
                      style={[styles.upvoteBtn, item.iUpvoted && styles.upvoteBtnActive]}
                      onPress={() => handleUpvote(item.id)}
                    >
                      <ThumbsUp
                        size={13}
                        color={item.iUpvoted ? CampusColors.lavender : CampusColors.nightMuted}
                      />
                      <Text style={[styles.upvoteCount, item.iUpvoted && styles.upvoteCountActive]}>
                        {item.upvotes}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ))
            )}
          </View>
        </ScrollView>
      </View>
      </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
};

const styles = themedSheet(() => ({
  errorWrap: {
    alignItems: 'center',
    gap: 12,
    marginVertical: 12,
  },
  errorText: {
    color: CampusColors.nightMuted,
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  retryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(200, 182, 255, 0.25)',
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
    backgroundColor: CampusColors.nightBg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: CampusColors.nightLine,
  },
  closeBtn: {
    padding: 6,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(200, 182, 255, 0.15)',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: CampusLayout.radius.pill,
    gap: 6,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '800',
    color: CampusColors.lavender,
    letterSpacing: 0.8,
  },
  scroll: {
    flex: 1,
  },
  content: {
    padding: 16,
    paddingBottom: 40,
    gap: 18,
  },
  questionCard: {
    backgroundColor: CampusColors.nightCard,
    borderRadius: CampusLayout.radius.card,
    padding: 18,
    borderWidth: 1,
    borderColor: CampusColors.nightLine,
  },
  countdownText: {
    fontSize: 12,
    fontWeight: '700',
    color: CampusColors.lavender,
    marginBottom: 8,
    letterSpacing: 0.5,
  },
  questionText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#FFFFFF',
    lineHeight: 26,
    marginBottom: 12,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  metaText: {
    fontSize: 12,
    color: CampusColors.nightMuted,
  },
  submitSection: {
    backgroundColor: CampusColors.nightCard,
    borderRadius: CampusLayout.radius.card,
    padding: 16,
    borderWidth: 1,
    borderColor: CampusColors.nightLine,
    gap: 10,
  },
  sectionHeader: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  answerInput: {
    backgroundColor: CampusColors.nightFill,
    borderWidth: 1,
    borderColor: CampusColors.nightLine,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    color: '#FFFFFF',
    height: 90,
    textAlignVertical: 'top',
  },
  submitBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: CampusColors.violet,
    height: 44,
    borderRadius: CampusLayout.radius.pill,
    gap: 6,
  },
  submittedBtn: {
    backgroundColor: '#059669',
  },
  submitBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  answersSection: {
    gap: 12,
  },
  emptyText: {
    fontSize: 13,
    color: CampusColors.nightMuted,
    textAlign: 'center',
    paddingVertical: 16,
  },
  feedHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  answerCard: {
    backgroundColor: CampusColors.nightCard,
    borderRadius: CampusLayout.radius.card,
    padding: 14,
    borderWidth: 1,
    borderColor: CampusColors.nightLine,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  aliasWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: CampusColors.lavender,
  },
  aliasText: {
    fontSize: 12,
    fontWeight: '700',
    color: CampusColors.lavender,
  },
  timeText: {
    fontSize: 12,
    color: CampusColors.nightMuted,
  },
  answerBody: {
    fontSize: 14,
    lineHeight: 20,
    color: '#F4F1EA',
    marginBottom: 10,
  },
  cardBottom: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  upvoteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: CampusColors.nightFill,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: CampusLayout.radius.pill,
    gap: 5,
    borderWidth: 1,
    borderColor: CampusColors.nightLine,
  },
  upvoteBtnActive: {
    borderColor: CampusColors.lavender,
  },
  upvoteCount: {
    fontSize: 12,
    fontWeight: '600',
    color: CampusColors.nightMuted,
  },
  upvoteCountActive: {
    color: CampusColors.lavender,
    fontWeight: '700',
  },
}));
