import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { Flag, Check, Circle, CircleCheck, Phone } from '../../../../components/lucide';
import * as Haptics from 'expo-haptics';
import { FriendsSheet } from './FriendsSheet';
import { FriendsColors, FS, FT, FR, fui } from '../friendsTheme';
import { fileReport, REPORT_CATEGORIES, REPORT_NOTE_MAX, ReportCategory, ReportTargetType } from '../api/modApi';
import { errorCode } from '../api/core';
import { dial } from '../../../../utils/dial';

/** C2: the confirmation every surface shows after a report (Google Play UGC policy). */
export const REPORTED_CONFIRMATION = 'Reported — thanks, our team will review it within 24 hours.';

export interface ReportTarget {
  type: ReportTargetType;
  id: string;
  /** Shown in the sheet subtitle, e.g. "post by Riya" or "this message". */
  label?: string;
}

/**
 * Report anything in Friends (and chat messages / profiles from the Campus hub).
 * Reports are reviewed by people; filing one never removes content by itself.
 */
export const ReportSheet: React.FC<{
  visible: boolean;
  onClose: () => void;
  target: ReportTarget | null;
  onReported?: (r: { reportId: string; duplicate: boolean }) => void;
}> = ({ visible, onClose, target, onReported }) => {
  const [category, setCategory] = useState<ReportCategory | null>(null);
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<null | { duplicate: boolean }>(null);

  // Fresh form for every target.
  useEffect(() => {
    if (!visible) return;
    setCategory(null);
    setNote('');
    setError(null);
    setDone(null);
    setSending(false);
  }, [visible, target?.type, target?.id]);

  const submit = async () => {
    if (!target || !category || sending) return;
    if (category === 'other' && !note.trim()) {
      setError('Please tell us briefly what is wrong.');
      return;
    }
    setSending(true);
    setError(null);
    try {
      const res = await fileReport({ targetType: target.type, targetId: target.id, category, note: note.trim() || undefined });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setDone({ duplicate: !!res.duplicate });
      onReported?.({ reportId: res.reportId, duplicate: !!res.duplicate });
    } catch (e: any) {
      const code = errorCode(e);
      if (code === 'RATE_LIMITED') setError("You've sent a lot of reports in the last hour. Please try again later.");
      else if (code === 'TARGET_NOT_FOUND') setError('This was already removed or is no longer available.');
      else if (code === 'CANNOT_REPORT_SELF') setError("You can't report your own content. You can delete it instead.");
      else setError(e?.message || "Couldn't send the report. Please try again.");
    } finally {
      setSending(false);
    }
  };

  const selfHarm = category === 'self_harm';

  return (
    <FriendsSheet
      visible={visible}
      onClose={onClose}
      title={done ? 'Thanks for telling us' : 'Report'}
      subtitle={done ? undefined : target?.label ? `Reporting ${target.label}` : 'Your report is private. The person is not told who reported.'}
      icon={<Flag size={18} color={FriendsColors.danger} />}
    >
      {done ? (
        <View style={{ alignItems: 'center', paddingVertical: FS.lg }}>
          <View style={styles.doneIcon}>
            <Check size={26} color={FriendsColors.accentInk} />
          </View>
          <Text style={[FT.h3, { textAlign: 'center', marginTop: FS.md }]}>
            {done.duplicate ? 'You already reported this' : 'Reported'}
          </Text>
          <Text style={[FT.muted, { textAlign: 'center', marginTop: 6 }]}>
            {REPORTED_CONFIRMATION} You can follow its status in Me › Friends privacy & safety.
          </Text>
          <TouchableOpacity style={[fui.primaryBtn, { alignSelf: 'stretch', marginTop: FS.xl }]} onPress={onClose} accessibilityRole="button">
            <Text style={fui.primaryBtnText}>Done</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <>
          <Text style={[FT.kicker, { marginBottom: FS.sm }]}>What's wrong?</Text>
          <View style={fui.card} accessibilityRole="radiogroup">
            {REPORT_CATEGORIES.map((c, i) => {
              const active = c.key === category;
              return (
                <TouchableOpacity
                  key={c.key}
                  style={[fui.row, i === REPORT_CATEGORIES.length - 1 && { borderBottomWidth: 0 }, active && { backgroundColor: FriendsColors.cardHi }]}
                  onPress={() => {
                    setCategory(c.key);
                    setError(null);
                  }}
                  activeOpacity={0.75}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: active }}
                  accessibilityLabel={`${c.label}. ${c.hint}`}
                >
                  {active ? <CircleCheck size={20} color={FriendsColors.accent} /> : <Circle size={20} color={FriendsColors.faint} />}
                  <View style={{ flex: 1 }}>
                    <Text style={FT.h3}>{c.label}</Text>
                    <Text style={[FT.small, { marginTop: 2 }]}>{c.hint}</Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>

          {selfHarm ? (
            <View style={styles.helpBox}>
              <Text style={[FT.h3, { color: FriendsColors.warn }]}>If someone is in danger right now</Text>
              <Text style={[FT.muted, { marginTop: 4 }]}>
                Call 112 for emergencies, or Tele-MANAS (free, 24×7) on 14416. Your report also reaches our team.
              </Text>
              <View style={{ flexDirection: 'row', gap: FS.sm, marginTop: FS.sm }}>
                <TouchableOpacity style={fui.ghostBtn} onPress={() => dial('14416', 'Tele-MANAS')} accessibilityRole="button" accessibilityLabel="Call Tele-MANAS 14416">
                  <Phone size={14} color={FriendsColors.ink} />
                  <Text style={fui.ghostBtnText}>14416</Text>
                </TouchableOpacity>
                <TouchableOpacity style={fui.ghostBtn} onPress={() => dial('112', 'emergency services')} accessibilityRole="button" accessibilityLabel="Call emergency 112">
                  <Phone size={14} color={FriendsColors.ink} />
                  <Text style={fui.ghostBtnText}>112</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : null}

          <Text style={[FT.kicker, { marginTop: FS.lg, marginBottom: FS.sm }]}>Add details {category === 'other' ? '' : '(optional)'}</Text>
          <TextInput
            style={[fui.input, { minHeight: 88, textAlignVertical: 'top' }]}
            value={note}
            onChangeText={(t) => setNote(t.slice(0, REPORT_NOTE_MAX))}
            placeholder="Anything that helps us understand"
            placeholderTextColor={FriendsColors.faint}
            multiline
            maxLength={REPORT_NOTE_MAX}
            accessibilityLabel="Report details"
          />
          <Text style={[FT.small, { textAlign: 'right', marginTop: 4 }]}>
            {note.length}/{REPORT_NOTE_MAX}
          </Text>

          {error ? (
            <View style={styles.errorBox} accessibilityRole="alert">
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          <TouchableOpacity
            style={[fui.primaryBtn, { marginTop: FS.md }, (!category || sending) && { opacity: 0.5 }]}
            onPress={submit}
            disabled={!category || sending}
            accessibilityRole="button"
            accessibilityState={{ disabled: !category || sending }}
          >
            {sending ? <ActivityIndicator color={FriendsColors.accentInk} /> : <Text style={fui.primaryBtnText}>Send report</Text>}
          </TouchableOpacity>
          <Text style={[FT.small, { textAlign: 'center', marginTop: FS.sm }]}>
            A report is reviewed by people. It is not proof by itself.
          </Text>
        </>
      )}
    </FriendsSheet>
  );
};

const styles = StyleSheet.create({
  doneIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: FriendsColors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  helpBox: {
    marginTop: FS.md,
    padding: FS.md,
    borderRadius: FR.md,
    backgroundColor: 'rgba(242,178,126,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(242,178,126,0.25)',
  },
  errorBox: { marginTop: FS.md, padding: FS.md, borderRadius: FR.md, backgroundColor: FriendsColors.dangerSoft },
  errorText: { fontSize: 13, lineHeight: 18, fontWeight: '600', color: FriendsColors.danger },
});
