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
  MessageCircle,
  Heart,
  Plus,
  Sparkles,
  ShieldCheck,
  Send,
  RefreshCw,
  MoreHorizontal,
} from '../../../components/lucide';
import * as Haptics from 'expo-haptics';
import { CampusColors, CampusLayout } from '../../../constants/campusTheme';
import {
  fetchWhispers,
  createWhisper,
  reactWhisper,
  PulseWhisper,
} from '../campusApi';
import { ActionMenu } from '../friends/shared/ActionMenu';

interface CampusWhispersModalProps {
  visible: boolean;
  onClose: () => void;
  /** Posting needs a verified student ID (server returns 403 VERIFICATION_REQUIRED otherwise). */
  isVerified?: boolean;
  isPendingVerification?: boolean;
  onRequestVerify?: () => void;
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

export const CampusWhispersModal: React.FC<CampusWhispersModalProps> = ({
  visible,
  onClose,
  isVerified = true,
  isPendingVerification = false,
  onRequestVerify,
}) => {
  const [whispers, setWhispers] = useState<PulseWhisper[]>([]);
  const [topics, setTopics] = useState<string[]>(['All', 'Hostels', 'Academics', 'Canteen', 'Crushes', 'Late Night']);
  const [filter, setFilter] = useState('All');
  const [loading, setLoading] = useState(true);
  const [composerOpen, setComposerOpen] = useState(false);
  const [posting, setPosting] = useState(false);
  const [newText, setNewText] = useState('');
  const [newTopic, setNewTopic] = useState('Hostels');
  const [loadError, setLoadError] = useState<string | null>(null);
  // C2: Report on every whisper (anonymous: no Block, the app never knows the author).
  const [menuFor, setMenuFor] = useState<PulseWhisper | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const openMenu = (w: PulseWhisper) => {
    setMenuFor(w);
    setMenuOpen(true);
  };
  const [paused, setPaused] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const requestRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const load = useCallback(async (topic: string) => {
    const reqId = ++requestRef.current;
    setLoading(true);
    setLoadError(null);
    setPaused(null);
    try {
      const data = await fetchWhispers(topic);
      if (!mountedRef.current || reqId !== requestRef.current) return;
      setWhispers(data.whispers || []);
      if (data.topics?.length) setTopics(['All', ...data.topics.filter((t) => t !== 'General'), 'General']);
    } catch (e: any) {
      if (!mountedRef.current || reqId !== requestRef.current) return;
      setWhispers([]);
      // C2: the admin kill switch answers 403 FEATURE_OFF.
      if (e?.code === 'FEATURE_OFF') {
        setPaused(e?.message || 'Campus Whispers is paused right now. Please check back soon.');
        return;
      }
      setLoadError(e?.message || "We couldn't load whispers. Check your connection and try again.");
    } finally {
      if (mountedRef.current && reqId === requestRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (visible) load(filter);
  }, [visible, filter, load]);

  const handleLike = async (id: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      const res = await reactWhisper(id);
      if (!mountedRef.current) return;
      setWhispers((prev) =>
        prev.map((w) => (w.id === id ? { ...w, hearts: res.hearts, iHearted: res.iHearted } : w))
      );
    } catch (e: any) {
      if (mountedRef.current) Alert.alert("Couldn't react", e?.message || 'Please try again in a moment.');
    }
  };

  const handlePostWhisper = async () => {
    if (posting) return;
    if (!newText.trim()) {
      Alert.alert('Empty Whisper', 'Write down your anonymous thoughts first.');
      return;
    }
    setPosting(true);
    try {
      const created = await createWhisper(newText.trim(), newTopic);
      if (!mountedRef.current) return;
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      if (filter === 'All' || created?.topic === filter) {
        setWhispers((prev) => [created, ...prev]);
      }
      setNewText('');
      setComposerOpen(false);
    } catch (e: any) {
      if (!mountedRef.current) return;
      const msg = typeof e?.message === 'string' ? e.message : '';
      if (e?.code === 'CONTENT_BLOCKED') {
        Alert.alert('Please rephrase', msg || "That has words that aren't allowed on Zenvy. Please rephrase it and try again.");
      } else if (e?.code === 'RATE_LIMITED') {
        Alert.alert('Slow down a little', msg || 'You have posted a lot of whispers. Please try again later.');
      } else {
        Alert.alert("Couldn't post", msg ? `${msg} Your whisper is still here.` : 'Your whisper is still here. Please try again.');
      }
    } finally {
      if (mountedRef.current) setPosting(false);
    }
  };

  const filtered = whispers;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <KeyboardAvoidingView style={{ flex: 1 }}>
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
            <X size={22} color={CampusColors.ink} />
          </TouchableOpacity>
          <View style={styles.headerTitleWrap}>
            <Text style={styles.headerTitle}>Campus Whispers</Text>
            <Text style={styles.headerSubtitle}>100% Anonymous student feed</Text>
          </View>
          <TouchableOpacity
            style={styles.whisperBtn}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              if (paused) {
                Alert.alert('Whispers paused', paused);
                return;
              }
              if (!isVerified) {
                if (isPendingVerification) {
                  Alert.alert('ID under review', "You can post whispers as soon as your student ID is approved. Reading and hearting work right now.");
                } else {
                  Alert.alert('Verify to whisper', 'Whispers are anonymous, so only verified students can post. It keeps the feed safe for everyone.', [
                    { text: 'Not now', style: 'cancel' },
                    ...(onRequestVerify ? [{ text: 'Verify now', onPress: onRequestVerify }] : []),
                  ]);
                }
                return;
              }
              setComposerOpen(true);
            }}
          >
            <Plus size={16} color="#FFFFFF" strokeWidth={2.5} />
            <Text style={styles.whisperBtnText}>Whisper</Text>
          </TouchableOpacity>
        </View>

        {/* Security Banner */}
        <View style={styles.securityBanner}>
          <ShieldCheck size={14} color={CampusColors.roseDeep} />
          <Text style={styles.securityText}>
            Verified students only. Identity is cryptographically detached from posts.
          </Text>
        </View>

        {/* Topic Filters */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.topicScroll}
          contentContainerStyle={styles.topicContent}
        >
          {topics.map((t) => {
            const active = filter === t;
            return (
              <TouchableOpacity
                key={t}
                style={[styles.topicChip, active && styles.topicChipActive]}
                onPress={() => {
                  Haptics.selectionAsync();
                  setFilter(t);
                }}
              >
                <Text style={[styles.topicChipText, active && styles.topicChipTextActive]}>{t}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {/* Feed */}
        <ScrollView style={styles.feedScroll} contentContainerStyle={styles.feedContent}>
          {loading ? (
            <ActivityIndicator color={CampusColors.rose} style={{ marginVertical: 24 }} />
          ) : paused ? (
            <Text style={styles.emptyText}>{paused}</Text>
          ) : loadError ? (
            <View style={styles.errorWrap}>
              <Text style={styles.emptyText}>{loadError}</Text>
              <TouchableOpacity style={styles.retryBtn} onPress={() => load(filter)}>
                <RefreshCw size={14} color="#FFFFFF" />
                <Text style={styles.retryText}>Retry</Text>
              </TouchableOpacity>
            </View>
          ) : filtered.length === 0 ? (
            <Text style={styles.emptyText}>No whispers in this channel yet. Start one.</Text>
          ) : (
            filtered.map((item) => (
              <TouchableOpacity key={item.id} style={styles.whisperCard} activeOpacity={0.9} onLongPress={() => openMenu(item)} delayLongPress={350}>
                <View style={styles.cardHeader}>
                  <View style={styles.aliasWrap}>
                    <View style={styles.aliasDot} />
                    <Text style={styles.aliasText}>{item.alias}</Text>
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <View style={styles.topicBadge}>
                      <Text style={styles.topicBadgeText}>{item.topic}</Text>
                    </View>
                    <TouchableOpacity
                      onPress={() => openMenu(item)}
                      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                      accessibilityRole="button"
                      accessibilityLabel="Whisper options"
                    >
                      <MoreHorizontal size={18} color={CampusColors.muted} />
                    </TouchableOpacity>
                  </View>
                </View>

                <Text style={styles.whisperBody}>{item.text}</Text>

                <View style={styles.cardFooter}>
                  <Text style={styles.timeText}>{timeAgo(item.createdAt)}</Text>
                  <TouchableOpacity
                    style={[styles.likeBtn, item.iHearted && styles.likeBtnActive]}
                    onPress={() => handleLike(item.id)}
                  >
                    <Heart
                      size={14}
                      color={item.iHearted ? CampusColors.rose : CampusColors.muted}
                      fill={item.iHearted ? CampusColors.rose : 'none'}
                    />
                    <Text style={[styles.likeCount, item.iHearted && styles.likeCountActive]}>
                      {item.hearts}
                    </Text>
                  </TouchableOpacity>
                </View>
              </TouchableOpacity>
            ))
          )}
        </ScrollView>

        <ActionMenu
          visible={menuOpen}
          onClose={() => setMenuOpen(false)}
          title="Whisper"
          report={menuFor ? { type: 'whisper', id: menuFor.id, label: `this whisper by ${menuFor.alias}` } : null}
          onReported={() => {
            // Hidden for the reporter straight away; our team reviews it.
            const id = menuFor?.id;
            if (id) setWhispers((prev) => prev.filter((w) => w.id !== id));
          }}
        />

        {/* Composer Modal */}
        <Modal
          visible={composerOpen}
          animationType="slide"
          transparent
          onRequestClose={() => setComposerOpen(false)}
        >
          <KeyboardAvoidingView style={styles.modalOverlay}>
            <View style={styles.composerSheet}>
              <View style={styles.sheetHeader}>
                <Text style={styles.sheetTitle}>Whisper Anonymously</Text>
                <TouchableOpacity onPress={() => setComposerOpen(false)}>
                  <X size={20} color={CampusColors.muted} />
                </TouchableOpacity>
              </View>

              {/* Topic Select */}
              <Text style={styles.inputLabel}>Pick Topic Channel</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: 8, marginBottom: 14 }}
              >
                {topics.filter((t) => t !== 'All').map((top) => (
                  <TouchableOpacity
                    key={top}
                    style={[styles.topicChip, newTopic === top && styles.topicChipActive]}
                    onPress={() => setNewTopic(top)}
                  >
                    <Text style={[styles.topicChipText, newTopic === top && styles.topicChipTextActive]}>
                      {top}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              <Text style={styles.inputLabel}>Your Anonymous Message</Text>
              <TextInput
                style={styles.composerInput}
                placeholder="Share a confession, funny incident, or academic thought..."
                placeholderTextColor={CampusColors.muted}
                value={newText}
                onChangeText={setNewText}
                multiline
                maxLength={400}
                autoFocus
              />

              <View style={styles.composerFooter}>
                <Text style={styles.charCount}>{newText.length}/400</Text>
                <TouchableOpacity style={styles.sendWhisperBtn} onPress={handlePostWhisper} disabled={posting}>
                  {posting ? <ActivityIndicator color="#FFFFFF" /> : <Send size={15} color="#FFFFFF" />}
                  <Text style={styles.sendWhisperText}>Post Whisper</Text>
                </TouchableOpacity>
              </View>
            </View>
          </KeyboardAvoidingView>
        </Modal>
      </View>
      </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  errorWrap: {
    alignItems: 'center',
    gap: 12,
    marginVertical: 16,
  },
  retryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: CampusColors.rose,
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
    color: CampusColors.rose,
    fontWeight: '600',
  },
  whisperBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: CampusColors.rose,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: CampusLayout.radius.pill,
    gap: 4,
  },
  whisperBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  securityBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: CampusColors.roseSoft,
    paddingHorizontal: 14,
    paddingVertical: 8,
    gap: 8,
  },
  securityText: {
    fontSize: 12,
    color: CampusColors.roseDeep,
    flex: 1,
    lineHeight: 15,
  },
  topicScroll: {
    maxHeight: 52,
    backgroundColor: CampusColors.card,
    borderBottomWidth: 1,
    borderBottomColor: CampusColors.line,
  },
  topicContent: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 8,
  },
  topicChip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: CampusLayout.radius.pill,
    backgroundColor: CampusColors.paper,
    borderWidth: 1,
    borderColor: CampusColors.line,
  },
  topicChipActive: {
    backgroundColor: CampusColors.rose,
    borderColor: CampusColors.rose,
  },
  topicChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: CampusColors.muted,
  },
  topicChipTextActive: {
    color: '#FFFFFF',
  },
  feedScroll: {
    flex: 1,
  },
  feedContent: {
    padding: 16,
    gap: 12,
    paddingBottom: 32,
  },
  emptyText: {
    fontSize: 13,
    color: CampusColors.muted,
    textAlign: 'center',
    paddingVertical: 24,
  },
  whisperCard: {
    backgroundColor: CampusColors.card,
    borderRadius: CampusLayout.radius.card,
    padding: 16,
    borderWidth: 1,
    borderColor: CampusColors.line,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  aliasWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  aliasDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: CampusColors.rose,
  },
  aliasText: {
    fontSize: 13,
    fontWeight: '700',
    color: CampusColors.ink,
  },
  topicBadge: {
    backgroundColor: CampusColors.paper,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  topicBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: CampusColors.muted,
  },
  whisperBody: {
    fontSize: 14,
    lineHeight: 21,
    color: CampusColors.ink,
    marginBottom: 12,
  },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: CampusColors.line,
  },
  timeText: {
    fontSize: 12,
    color: CampusColors.muted,
  },
  likeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: CampusColors.paper,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: CampusLayout.radius.pill,
    gap: 5,
  },
  likeBtnActive: {
    backgroundColor: CampusColors.roseSoft,
  },
  likeCount: {
    fontSize: 12,
    fontWeight: '600',
    color: CampusColors.muted,
  },
  likeCountActive: {
    color: CampusColors.rose,
    fontWeight: '700',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  composerSheet: {
    backgroundColor: CampusColors.card,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 32,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: CampusColors.line,
    marginBottom: 14,
  },
  sheetTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: CampusColors.ink,
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: CampusColors.ink,
    marginBottom: 8,
  },
  composerInput: {
    backgroundColor: CampusColors.paper,
    borderWidth: 1,
    borderColor: CampusColors.line,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    color: CampusColors.ink,
    height: 120,
    textAlignVertical: 'top',
    marginBottom: 12,
  },
  composerFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  charCount: {
    fontSize: 12,
    color: CampusColors.muted,
  },
  sendWhisperBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: CampusColors.rose,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: CampusLayout.radius.pill,
    gap: 6,
  },
  sendWhisperText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});
