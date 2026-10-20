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
import { X, BarChart2, Plus } from '../../../components/lucide';
import * as Haptics from 'expo-haptics';
import { CampusColors } from '../../../constants/campusTheme';
import { CampusUserData } from '../../../types/campus';
import { CampusPoll, fetchCampusPolls, createCampusPoll, voteCampusPoll } from '../campusApi';
import { ReportSheet } from '../friends/shared/ReportSheet';

interface PollsSheetProps {
  chatId: string;
  currentUser: CampusUserData | null;
  onClose: () => void;
}

export const PollsSheet: React.FC<PollsSheetProps> = ({ chatId, currentUser, onClose }) => {
  const [polls, setPolls] = useState<CampusPoll[]>([]);
  const [reportPoll, setReportPoll] = useState<CampusPoll | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [question, setQuestion] = useState('');
  const [opts, setOpts] = useState<string[]>(['', '']);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [votingId, setVotingId] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const friendly = (e: any, fallback: string) =>
    typeof e?.message === 'string' && e.message && !/^Failed/i.test(e.message) ? e.message : fallback;

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setLoadError(null);
    try {
      const data = await fetchCampusPolls(chatId);
      if (mountedRef.current) setPolls(data);
    } catch (e: any) {
      if (mountedRef.current) setLoadError(friendly(e, "Couldn't load polls. Check your connection and try again."));
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [chatId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleCreate = async () => {
    const cleanOpts = opts.map((o) => o.trim()).filter(Boolean);
    if (!question.trim()) {
      Alert.alert('Add a question', 'What would you like to ask the group?');
      return;
    }
    if (cleanOpts.length < 2) {
      Alert.alert('Add options', 'A poll needs at least two options.');
      return;
    }
    if (new Set(cleanOpts.map((o) => o.toLowerCase())).size !== cleanOpts.length) {
      Alert.alert('Duplicate options', 'Each option should be different.');
      return;
    }
    setCreating(true);
    try {
      await createCampusPoll({ conversationId: chatId, question: question.trim(), options: cleanOpts });
      if (!mountedRef.current) return;
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setQuestion('');
      setOpts(['', '']);
      load(true);
    } catch (e: any) {
      if (mountedRef.current) Alert.alert("Couldn't post poll", friendly(e, 'Please try again.'));
    } finally {
      if (mountedRef.current) setCreating(false);
    }
  };

  const handleVote = async (poll: CampusPoll, index: number) => {
    if (votingId) return;
    setVotingId(poll.id);
    Haptics.selectionAsync().catch(() => {});
    try {
      const updated = await voteCampusPoll(poll.id, [index]);
      if (!mountedRef.current) return;
      if (updated?.id) {
        setPolls((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
      } else {
        load(true);
      }
    } catch (e: any) {
      if (mountedRef.current) Alert.alert("Vote not counted", friendly(e, 'Please try again.'));
    } finally {
      if (mountedRef.current) setVotingId(null);
    }
  };

  const totalVotes = (p: CampusPoll) =>
    p.options.reduce((sum, _o, i) => sum + optionCount(p, i), 0);
  // Prefer the server's voteCounts (anonymous polls); fall back to the voter list length.
  const optionCount = (p: CampusPoll, i: number) => {
    const c = Number(p.voteCounts?.[String(i)]);
    return Number.isFinite(c) && c >= 0 ? c : (p.votes?.[String(i)] || []).length;
  };

  return (
    <KeyboardAvoidingView style={styles.overlay}>
      <View style={styles.sheet}>
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <BarChart2 size={18} color={CampusColors.accent} />
            <Text style={styles.headerTitle}>Campus Polls</Text>
          </View>
          <TouchableOpacity onPress={onClose}>
            <X size={20} color={CampusColors.muted} />
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.body} keyboardShouldPersistTaps="handled">
          <Text style={styles.label}>CREATE A POLL</Text>
          <TextInput
            style={styles.input}
            placeholder="Ask a question..."
            placeholderTextColor={CampusColors.muted}
            value={question}
            onChangeText={setQuestion}
          />
          {opts.map((o, i) => (
            <View key={i} style={styles.optInputRow}>
              <TextInput
                style={[styles.input, { flex: 1 }]}
                placeholder={`Option ${i + 1}`}
                placeholderTextColor={CampusColors.muted}
                value={o}
                maxLength={80}
                onChangeText={(t) => setOpts((prev) => prev.map((p, idx) => (idx === i ? t : p)))}
              />
              {opts.length > 2 && (
                <TouchableOpacity
                  onPress={() => setOpts((prev) => prev.filter((_, idx) => idx !== i))}
                  style={styles.removeOpt}
                  accessibilityLabel={`Remove option ${i + 1}`}
                >
                  <X size={16} color={CampusColors.muted} />
                </TouchableOpacity>
              )}
            </View>
          ))}
          <View style={styles.createRow}>
            {opts.length < 6 ? (
              <TouchableOpacity style={styles.addOpt} onPress={() => setOpts((p) => [...p, ''])}>
                <Plus size={14} color={CampusColors.accent} />
                <Text style={styles.addOptText}>Option</Text>
              </TouchableOpacity>
            ) : (
              <View />
            )}
            <TouchableOpacity style={styles.createBtn} onPress={handleCreate} disabled={creating}>
              {creating ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.createBtnText}>Post poll</Text>}
            </TouchableOpacity>
          </View>

          <Text style={styles.label}>ACTIVE POLLS</Text>
          {loading ? (
            <ActivityIndicator color={CampusColors.accent} />
          ) : loadError ? (
            <View style={{ gap: 8, alignItems: 'flex-start' }}>
              <Text style={styles.none}>{loadError}</Text>
              <TouchableOpacity style={styles.createBtn} onPress={() => load()}>
                <Text style={styles.createBtnText}>Retry</Text>
              </TouchableOpacity>
            </View>
          ) : polls.length === 0 ? (
            <Text style={styles.none}>No polls in this chat yet. Ask the first question above!</Text>
          ) : (
            polls.map((p) => {
              const total = totalVotes(p);
              const myVotes = Object.entries(p.votes || {})
                .filter(([, arr]) => (arr || []).includes(currentUser?.id || ''))
                .map(([k]) => Number(k));
              return (
                <View key={p.id} style={styles.pollCard}>
                  <Text style={styles.pollQuestion}>{p.question}</Text>
                  {p.options.map((opt, i) => {
                    const count = optionCount(p, i);
                    const pct = total ? Math.round((count / total) * 100) : 0;
                    const mine = myVotes.includes(i);
                    return (
                      <TouchableOpacity
                        key={i}
                        style={[styles.optionRow, mine && styles.optionRowMine]}
                        onPress={() => handleVote(p, i)}
                        disabled={!!votingId}
                        activeOpacity={0.8}
                      >
                        <Text style={styles.optionText} numberOfLines={1}>{opt}</Text>
                        <Text style={styles.optionPct}>{pct}%</Text>
                      </TouchableOpacity>
                    );
                  })}
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Text style={styles.pollMeta}>{total} vote{total === 1 ? '' : 's'}</Text>
                    {p.creatorId && p.creatorId !== currentUser?.id ? (
                      // C2: report a poll (question / options).
                      <TouchableOpacity onPress={() => setReportPoll(p)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} accessibilityRole="button" accessibilityLabel="Report this poll">
                        <Text style={[styles.pollMeta, { color: '#A3321A', fontWeight: '700' }]}>Report</Text>
                      </TouchableOpacity>
                    ) : null}
                  </View>
                </View>
              );
            })
          )}
        </ScrollView>
      </View>
      <ReportSheet
        visible={!!reportPoll}
        onClose={() => setReportPoll(null)}
        target={reportPoll ? { type: 'poll', id: reportPoll.id, label: 'this poll' } : null}
        onReported={() => {
          const id = reportPoll?.id;
          if (id) setPolls((prev) => prev.filter((x) => x.id !== id));
        }}
      />
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: CampusColors.card,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '85%',
    paddingBottom: 24,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: CampusColors.line,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerTitle: { fontSize: 16, fontWeight: '700', color: CampusColors.ink },
  body: { paddingHorizontal: 20, paddingTop: 14 },
  label: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1.5,
    color: CampusColors.muted,
    marginVertical: 8,
  },
  input: {
    backgroundColor: CampusColors.paper,
    borderWidth: 1,
    borderColor: CampusColors.line,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 14,
    color: CampusColors.ink,
    marginBottom: 8,
  },
  optInputRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  removeOpt: { paddingHorizontal: 6, paddingVertical: 10 },
  createRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  addOpt: { flexDirection: 'row', alignItems: 'center', gap: 4, padding: 6 },
  addOptText: { fontSize: 13, fontWeight: '700', color: CampusColors.accent },
  createBtn: {
    backgroundColor: CampusColors.accent,
    paddingHorizontal: 18,
    paddingVertical: 9,
    borderRadius: 16,
  },
  createBtnText: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },
  none: { fontSize: 13, color: CampusColors.muted },
  pollCard: {
    backgroundColor: CampusColors.paper,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: CampusColors.line,
    padding: 12,
    marginBottom: 12,
    gap: 6,
  },
  pollQuestion: { fontSize: 14, fontWeight: '700', color: CampusColors.ink },
  optionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: CampusColors.card,
    borderWidth: 1,
    borderColor: CampusColors.line,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  optionRowMine: { borderColor: CampusColors.accent, borderWidth: 1.5 },
  optionText: { fontSize: 13, color: CampusColors.ink, flex: 1 },
  optionPct: { fontSize: 12, fontWeight: '700', color: CampusColors.accent },
  pollMeta: { fontSize: 12, color: CampusColors.muted },
});
