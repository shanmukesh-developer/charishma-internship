import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Alert,
} from 'react-native';
import { KeyboardAvoidingView } from '../../../components/KeyboardAvoidingView';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  X,
  Play,
  Pause,
  RotateCcw,
  CheckCircle2,
  Circle,
  Plus,
  Trash2,
} from '../../../components/lucide';
import * as Haptics from 'expo-haptics';
import { CampusColors, CampusLayout } from '../../../constants/campusTheme';

import { themedSheet } from '../../../utils/themeNow';
interface StudySyncModalProps {
  visible: boolean;
  onClose: () => void;
}


interface FocusTask {
  id: string;
  text: string;
  done: boolean;
}

export const StudySyncModal: React.FC<StudySyncModalProps> = ({
  visible,
  onClose,
}) => {
  const [secondsLeft, setSecondsLeft] = useState(50 * 60);
  const [isRunning, setIsRunning] = useState(false);
  const [sessionType, setSessionType] = useState<'focus' | 'break'>('focus');
  const [tasks, setTasks] = useState<FocusTask[]>([]);
  const [newTaskInput, setNewTaskInput] = useState('');

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Wall-clock end time so the countdown stays accurate even if the app is backgrounded.
  const endAtRef = useRef<number | null>(null);
  const secondsLeftRef = useRef(secondsLeft);
  secondsLeftRef.current = secondsLeft;
  const sessionTypeRef = useRef(sessionType);
  sessionTypeRef.current = sessionType;

  useEffect(() => {
    if (!isRunning) {
      endAtRef.current = null;
      return;
    }
    endAtRef.current = Date.now() + secondsLeftRef.current * 1000;
    timerRef.current = setInterval(() => {
      const left = Math.max(0, Math.round(((endAtRef.current || Date.now()) - Date.now()) / 1000));
      setSecondsLeft(left);
      if (left <= 0) {
        if (timerRef.current) clearInterval(timerRef.current);
        timerRef.current = null;
        setIsRunning(false);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        if (sessionTypeRef.current === 'focus') {
          Alert.alert('Focus session complete! 🎉', 'Great work. Take a 10-minute break and stretch.');
        } else {
          Alert.alert('Break over ⏰', 'Ready for another focus session?');
        }
      }
    }, 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
    };
  }, [isRunning]);

  const toggleTimer = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    if (!isRunning && secondsLeft <= 0) {
      setSecondsLeft((sessionType === 'focus' ? 50 : 10) * 60);
    }
    setIsRunning((r) => !r);
  };

  const resetTimer = (mins: number) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setIsRunning(false);
    setSecondsLeft(mins * 60);
  };

  const removeTask = (id: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== id));
  };

  const toggleTask = (id: string) => {
    Haptics.selectionAsync();
    setTasks((prev) =>
      prev.map((t) => (t.id === id ? { ...t, done: !t.done } : t))
    );
  };

  const addTask = () => {
    if (!newTaskInput.trim()) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const text = newTaskInput.trim();
    setTasks((prev) => [...prev, { id: `t-${Date.now()}`, text, done: false }]);
    setNewTaskInput('');
  };

  const mins = Math.floor(secondsLeft / 60);
  const secs = secondsLeft % 60;
  const timeStr = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

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
            <Text style={styles.headerTitle}>Study Sync Focus Room</Text>
            <Text style={styles.headerSubtitle}>Pomodoro focus timer • 50/10</Text>
          </View>
          {isRunning && (
            <View style={styles.liveRoomBadge}>
              <View style={styles.pulseDot} />
              <Text style={styles.liveRoomText}>{sessionType === 'focus' ? 'Focusing' : 'On break'}</Text>
            </View>
          )}
        </View>

        <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
          {/* Timer Card */}
          <View style={styles.timerCard}>
            <View style={styles.sessionToggle}>
              <TouchableOpacity
                style={[styles.sessionBtn, sessionType === 'focus' && styles.sessionBtnActive]}
                onPress={() => {
                  setSessionType('focus');
                  resetTimer(50);
                }}
              >
                <Text
                  style={[
                    styles.sessionBtnText,
                    sessionType === 'focus' && styles.sessionBtnTextActive,
                  ]}
                >
                  Deep Focus (50m)
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.sessionBtn, sessionType === 'break' && styles.sessionBtnActive]}
                onPress={() => {
                  setSessionType('break');
                  resetTimer(10);
                }}
              >
                <Text
                  style={[
                    styles.sessionBtnText,
                    sessionType === 'break' && styles.sessionBtnTextActive,
                  ]}
                >
                  Rest Break (10m)
                </Text>
              </TouchableOpacity>
            </View>

            {/* Big Clock Display */}
            <Text style={styles.clockText}>{timeStr}</Text>

            {/* Controls */}
            <View style={styles.controlsRow}>
              <TouchableOpacity style={styles.resetBtn} onPress={() => resetTimer(sessionType === 'focus' ? 50 : 10)}>
                <RotateCcw size={18} color={CampusColors.muted} />
              </TouchableOpacity>

              <TouchableOpacity style={styles.playPauseBtn} onPress={toggleTimer}>
                {isRunning ? (
                  <Pause size={24} color="#FFFFFF" />
                ) : (
                  <Play size={24} color="#FFFFFF" fill="#FFFFFF" />
                )}
              </TouchableOpacity>

              <View style={{ width: 44 }} />
            </View>
          </View>

          {/* Session Checklist */}
          <View style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>Session Goals</Text>
            {tasks.length === 0 && (
              <Text style={styles.taskText}>
                Add what you want to finish this session. Ticking goals off feels great ✨
              </Text>
            )}
            <View style={styles.taskList}>
              {tasks.map((task) => (
                <TouchableOpacity
                  key={task.id}
                  style={styles.taskItem}
                  onPress={() => toggleTask(task.id)}
                >
                  {task.done ? (
                    <CheckCircle2 size={18} color={CampusColors.accent} />
                  ) : (
                    <Circle size={18} color={CampusColors.muted} />
                  )}
                  <Text style={[styles.taskText, { flex: 1 }, task.done && styles.taskDone]}>
                    {task.text}
                  </Text>
                  <TouchableOpacity
                    onPress={() => removeTask(task.id)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    accessibilityLabel="Remove goal"
                  >
                    <Trash2 size={15} color={CampusColors.muted} />
                  </TouchableOpacity>
                </TouchableOpacity>
              ))}
            </View>

            {/* Add Task Input */}
            <View style={styles.addTaskRow}>
              <TextInput
                style={styles.taskInput}
                placeholder="Add goal for this session..."
                placeholderTextColor={CampusColors.muted}
                value={newTaskInput}
                onChangeText={setNewTaskInput}
                onSubmitEditing={addTask}
                returnKeyType="done"
                maxLength={120}
              />
              <TouchableOpacity style={styles.addTaskBtn} onPress={addTask}>
                <Plus size={18} color="#FFFFFF" />
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>
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
  liveRoomBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: CampusColors.accentSoft,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: CampusLayout.radius.pill,
    gap: 6,
  },
  pulseDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#059669',
  },
  liveRoomText: {
    fontSize: 12,
    fontWeight: '800',
    color: CampusColors.accentDeep,
  },
  scroll: {
    flex: 1,
  },
  content: {
    padding: 16,
    gap: 16,
    paddingBottom: 36,
  },
  timerCard: {
    backgroundColor: CampusColors.card,
    borderRadius: CampusLayout.radius.card,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: CampusColors.line,
  },
  sessionToggle: {
    flexDirection: 'row',
    backgroundColor: CampusColors.paper,
    borderRadius: CampusLayout.radius.pill,
    padding: 4,
    marginBottom: 24,
  },
  sessionBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: CampusLayout.radius.pill,
  },
  sessionBtnActive: {
    backgroundColor: CampusColors.accent,
  },
  sessionBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: CampusColors.muted,
  },
  sessionBtnTextActive: {
    color: '#FFFFFF',
  },
  clockText: {
    fontSize: 64,
    fontWeight: '800',
    color: CampusColors.ink,
    letterSpacing: 2,
    marginBottom: 24,
    fontVariant: ['tabular-nums'],
  },
  controlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 20,
  },
  playPauseBtn: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: CampusColors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  resetBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: CampusColors.paper,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: CampusColors.line,
  },
  sectionCard: {
    backgroundColor: CampusColors.card,
    borderRadius: CampusLayout.radius.card,
    padding: 16,
    borderWidth: 1,
    borderColor: CampusColors.line,
    gap: 12,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: CampusColors.ink,
  },
  muteText: {
    fontSize: 12,
    fontWeight: '600',
    color: CampusColors.rose,
  },
  soundGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  soundChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: CampusLayout.radius.pill,
    backgroundColor: CampusColors.paper,
    borderWidth: 1,
    borderColor: CampusColors.line,
  },
  soundChipActive: {
    backgroundColor: CampusColors.accentSoft,
    borderColor: CampusColors.accent,
  },
  soundText: {
    fontSize: 12,
    fontWeight: '600',
    color: CampusColors.muted,
  },
  soundTextActive: {
    color: CampusColors.accentDeep,
    fontWeight: '700',
  },
  taskList: {
    gap: 10,
  },
  taskItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 4,
  },
  taskText: {
    fontSize: 13,
    color: CampusColors.ink,
    flex: 1,
  },
  taskDone: {
    textDecorationLine: 'line-through',
    color: CampusColors.muted,
  },
  addTaskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    gap: 8,
  },
  taskInput: {
    flex: 1,
    backgroundColor: CampusColors.paper,
    borderWidth: 1,
    borderColor: CampusColors.line,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 13,
    color: CampusColors.ink,
  },
  addTaskBtn: {
    width: 38,
    height: 38,
    borderRadius: 8,
    backgroundColor: CampusColors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
}));
