import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { Scale } from '../../../../components/lucide';
import * as Haptics from 'expo-haptics';
import { FriendsSheet } from './FriendsSheet';
import { FriendsColors, FS, FT, FR, fui } from '../friendsTheme';
import { fileAppeal, APPEAL_TEXT_MIN, APPEAL_TEXT_MAX, moderationActionLabel, MyModerationAction } from '../api/modApi';
import { errorCode } from '../api/core';

import { themedSheet } from '../../../../utils/themeNow';
/** Appeal one moderation decision (one appeal per decision; reviewed by a different moderator). */
export const AppealSheet: React.FC<{
  visible: boolean;
  onClose: () => void;
  action: MyModerationAction | null;
  onAppealed?: () => void;
}> = ({ visible, onClose, action, onAppealed }) => {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setText('');
    setError(null);
    setDone(false);
    setSending(false);
  }, [visible, action?.id]);

  const len = text.trim().length;
  const valid = len >= APPEAL_TEXT_MIN && len <= APPEAL_TEXT_MAX;

  const submit = async () => {
    if (!action || !valid || sending) return;
    setSending(true);
    setError(null);
    try {
      await fileAppeal(action.id, text.trim());
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setDone(true);
      onAppealed?.();
    } catch (e: any) {
      const code = errorCode(e);
      if (code === 'APPEAL_EXISTS') setError('You have already appealed this decision.');
      else if (code === 'NOT_APPEALABLE') setError("This decision can't be appealed.");
      else if (code === 'RATE_LIMITED') setError("You've sent several appeals today. Please try again tomorrow.");
      else setError(e?.message || "Couldn't send your appeal. Please try again.");
    } finally {
      setSending(false);
    }
  };

  return (
    <FriendsSheet
      visible={visible}
      onClose={onClose}
      title={done ? 'Appeal sent' : 'Appeal this decision'}
      subtitle={action ? moderationActionLabel(action.action) : undefined}
      icon={<Scale size={18} color={FriendsColors.accent} />}
    >
      {done ? (
        <>
          <Text style={FT.body}>Thanks. A moderator will review your appeal and you'll get a notification with the result.</Text>
          <TouchableOpacity style={[fui.primaryBtn, { marginTop: FS.xl }]} onPress={onClose} accessibilityRole="button">
            <Text style={fui.primaryBtnText}>Done</Text>
          </TouchableOpacity>
        </>
      ) : (
        <>
          {action?.reason ? (
            <View style={[fui.cardPad, { marginBottom: FS.md }]}>
              <Text style={FT.kicker}>Reason given</Text>
              <Text style={[FT.body, { marginTop: 4 }]}>{action.reason}</Text>
            </View>
          ) : null}
          <Text style={[FT.kicker, { marginBottom: FS.sm }]}>Why should this be reconsidered?</Text>
          <TextInput
            style={[fui.input, { minHeight: 120, textAlignVertical: 'top' }]}
            value={text}
            onChangeText={(t) => setText(t.slice(0, APPEAL_TEXT_MAX))}
            placeholder="Explain what happened (at least 10 characters)"
            placeholderTextColor={FriendsColors.faint}
            multiline
            maxLength={APPEAL_TEXT_MAX}
            accessibilityLabel="Appeal text"
          />
          <Text style={[FT.small, { textAlign: 'right', marginTop: 4 }]}>
            {text.length}/{APPEAL_TEXT_MAX}
          </Text>
          {error ? (
            <View style={styles.errorBox} accessibilityRole="alert">
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}
          <TouchableOpacity
            style={[fui.primaryBtn, { marginTop: FS.md }, (!valid || sending) && { opacity: 0.5 }]}
            onPress={submit}
            disabled={!valid || sending}
            accessibilityRole="button"
            accessibilityState={{ disabled: !valid || sending }}
          >
            {sending ? <ActivityIndicator color={FriendsColors.accentInk} /> : <Text style={fui.primaryBtnText}>Send appeal</Text>}
          </TouchableOpacity>
        </>
      )}
    </FriendsSheet>
  );
};

const styles = themedSheet(() => ({
  errorBox: { marginTop: FS.md, padding: FS.md, borderRadius: FR.md, backgroundColor: FriendsColors.dangerSoft },
  errorText: { fontSize: 13, lineHeight: 18, fontWeight: '600', color: FriendsColors.danger },
}));
