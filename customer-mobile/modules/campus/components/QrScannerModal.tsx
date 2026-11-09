import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { KeyboardAvoidingView } from '../../../components/KeyboardAvoidingView';
import { SafeAreaView } from 'react-native-safe-area-context';
import { X, KeyRound, Users, CheckCircle2, AlertCircle } from '../../../components/lucide';
import * as Haptics from 'expo-haptics';
import { CampusColors, CampusLayout } from '../../../constants/campusTheme';
import { previewCampusGroup } from '../campusApi';

import { themedSheet } from '../../../utils/themeNow';
interface QrScannerModalProps {
  visible: boolean;
  onClose: () => void;
  /** Called with a verified join code once the user confirms. */
  onScanCode: (code: string) => void;
}

type GroupPreview = {
  id: string;
  name: string;
  description?: string | null;
  type?: string | null;
  memberCount?: number;
};

/**
 * Accepts a raw join code ("G5EHFF") or a shared invite link
 * ("zenvy://join/G5EHFF", "https://…/join/G5EHFF") and returns the code.
 */
const extractJoinCode = (raw: string): string => {
  const trimmed = raw.trim();
  const match = trimmed.match(/join\/([A-Za-z0-9]+)/i);
  return (match ? match[1] : trimmed).replace(/[^A-Za-z0-9]/g, '').toUpperCase();
};

const TYPE_LABEL: Record<string, string> = {
  class: 'Classroom',
  club: 'Club',
  ride: 'Ride Group',
};

/**
 * Join a classroom / club with the code (or invite link) shared by its admin or CR.
 * The group is looked up on the server first so the student sees exactly what they
 * are joining before confirming. (Camera QR scanning needs expo-camera, which is not
 * part of this build, so it is not offered here.)
 */
export const QrScannerModal: React.FC<QrScannerModalProps> = ({ visible, onClose, onScanCode }) => {
  const [input, setInput] = useState('');
  const [checking, setChecking] = useState(false);
  const [preview, setPreview] = useState<GroupPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const requestRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!visible) {
      requestRef.current += 1;
      setInput('');
      setPreview(null);
      setError(null);
      setChecking(false);
    }
  }, [visible]);

  const code = extractJoinCode(input);

  const handleCheck = async () => {
    if (code.length < 4) {
      setError('Enter the full join code shared by your class admin or CR.');
      return;
    }
    const reqId = ++requestRef.current;
    setChecking(true);
    setError(null);
    setPreview(null);
    try {
      const group = await previewCampusGroup(code);
      if (!mountedRef.current || reqId !== requestRef.current) return;
      if (!group?.id) throw new Error('Code not found. Please check and try again.');
      Haptics.selectionAsync().catch(() => {});
      setPreview(group);
    } catch (e: any) {
      if (!mountedRef.current || reqId !== requestRef.current) return;
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      const msg = typeof e?.message === 'string' && e.message ? e.message : '';
      setError(
        /not found/i.test(msg)
          ? 'No group uses this code. Check it with your class admin and try again.'
          : 'Could not check this code right now. Please try again.'
      );
    } finally {
      if (mountedRef.current && reqId === requestRef.current) setChecking(false);
    }
  };

  const handleJoin = () => {
    if (!preview) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    onScanCode(code);
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          {/* Header */}
          <View style={styles.header}>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn} accessibilityLabel="Close">
              <X size={22} color="#FFFFFF" />
            </TouchableOpacity>
            <Text style={styles.headerTitle}>Join a Classroom or Club</Text>
            <View style={{ width: 32 }} />
          </View>

          <View style={styles.body}>
            <View style={styles.iconWrap}>
              <KeyRound size={34} color={CampusColors.accentOnDark} />
            </View>
            <Text style={styles.instructionText}>
              Enter the join code or paste the invite link your class admin or CR shared with you.
            </Text>

            <TextInput
              style={styles.codeInput}
              placeholder="e.g. G5EHFF"
              placeholderTextColor="#64748B"
              value={input}
              onChangeText={(t) => {
                setInput(t);
                if (preview || error) {
                  setPreview(null);
                  setError(null);
                }
              }}
              autoCapitalize="characters"
              autoCorrect={false}
              autoFocus
              returnKeyType="go"
              onSubmitEditing={handleCheck}
              editable={!checking}
            />

            {!!error && (
              <View style={styles.errorRow}>
                <AlertCircle size={14} color="#FCA5A5" />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}

            {preview ? (
              <View style={styles.previewCard}>
                <View style={styles.previewHeader}>
                  <View style={styles.previewIcon}>
                    <Users size={18} color="#FFFFFF" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.previewName} numberOfLines={2}>{preview.name}</Text>
                    <Text style={styles.previewMeta}>
                      {[
                        preview.type ? TYPE_LABEL[preview.type] || 'Group' : 'Group',
                        typeof preview.memberCount === 'number'
                          ? `${preview.memberCount} member${preview.memberCount === 1 ? '' : 's'}`
                          : null,
                      ]
                        .filter(Boolean)
                        .join(' • ')}
                    </Text>
                  </View>
                </View>
                {!!preview.description && (
                  <Text style={styles.previewDesc} numberOfLines={3}>{preview.description}</Text>
                )}
                <TouchableOpacity style={styles.primaryBtn} onPress={handleJoin}>
                  <CheckCircle2 size={16} color="#FFFFFF" />
                  <Text style={styles.primaryBtnText}>Join {TYPE_LABEL[preview.type || ''] || 'Group'}</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity
                style={[styles.primaryBtn, (checking || code.length < 4) && { opacity: 0.6 }]}
                onPress={handleCheck}
                disabled={checking || code.length < 4}
              >
                {checking ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={styles.primaryBtnText}>Find Group</Text>
                )}
              </TouchableOpacity>
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
    backgroundColor: '#0F172A',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
  },
  closeBtn: {
    padding: 6,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  body: {
    paddingHorizontal: 24,
    paddingTop: 24,
    gap: 16,
  },
  iconWrap: {
    alignSelf: 'center',
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#1E293B',
    alignItems: 'center',
    justifyContent: 'center',
  },
  instructionText: {
    fontSize: 13,
    color: '#94A3B8',
    textAlign: 'center',
    lineHeight: 19,
  },
  codeInput: {
    height: 56,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#334155',
    backgroundColor: '#1E293B',
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: 4,
    textAlign: 'center',
    paddingHorizontal: 16,
  },
  errorRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
  },
  errorText: {
    flex: 1,
    fontSize: 12,
    color: '#FCA5A5',
    lineHeight: 17,
  },
  previewCard: {
    backgroundColor: '#1E293B',
    borderRadius: 16,
    padding: 16,
    gap: 12,
    borderWidth: 1,
    borderColor: '#334155',
  },
  previewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  previewIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: CampusColors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  previewMeta: {
    fontSize: 12,
    color: '#94A3B8',
    marginTop: 2,
  },
  previewDesc: {
    fontSize: 13,
    color: '#CBD5E1',
    lineHeight: 18,
  },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 48,
    borderRadius: CampusLayout.radius.pill,
    backgroundColor: CampusColors.accent,
  },
  primaryBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
}));
