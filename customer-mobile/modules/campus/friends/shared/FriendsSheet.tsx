import React from 'react';
import { Modal, View, Text, TouchableOpacity, ScrollView, Platform, StyleSheet } from 'react-native';
import { KeyboardAvoidingView } from '../../../../components/KeyboardAvoidingView';
import { SafeAreaView } from 'react-native-safe-area-context';
import { X, ChevronLeft } from '../../../../components/lucide';
import { FriendsColors, FElevation, FR, FS, FT } from '../friendsTheme';

import { themedSheet } from '../../../../utils/themeNow';
/** Dark bottom sheet for Friends. Android back and the backdrop close it. */
export const FriendsSheet: React.FC<{
  visible: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
  scroll?: boolean;
  maxHeight?: `${number}%` | number;
  footer?: React.ReactNode;
}> = ({ visible, onClose, title, subtitle, icon, children, scroll = true, maxHeight = '88%', footer }) => (
  <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
    <KeyboardAvoidingView style={styles.overlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onClose} accessibilityLabel="Close" />
      <View style={[styles.sheet, { maxHeight }]}>
        <View style={styles.grabber} />
        <View style={styles.header}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
            {icon}
            <View style={{ flex: 1 }}>
              <Text style={FT.h2} numberOfLines={1} accessibilityRole="header">
                {title}
              </Text>
              {subtitle ? (
                <Text style={FT.small} numberOfLines={2}>
                  {subtitle}
                </Text>
              ) : null}
            </View>
          </View>
          <TouchableOpacity onPress={onClose} hitSlop={6} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel="Close">
            <View style={styles.closeDisc}>
              <X size={18} color={FriendsColors.ink} />
            </View>
          </TouchableOpacity>
        </View>
        {scroll ? (
          <ScrollView contentContainerStyle={{ paddingBottom: FS.xl }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            {children}
          </ScrollView>
        ) : (
          children
        )}
        {footer}
      </View>
    </KeyboardAvoidingView>
  </Modal>
);

/** Dark full-screen page for Friends. Android back and the header arrow go back. */
export const FriendsScreenModal: React.FC<{
  visible: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
  /** Lift the content above the keyboard (off for screens that place their own KeyboardAvoidingView). */
  avoidKeyboard?: boolean;
}> = ({ visible, onClose, title, subtitle, right, children, avoidKeyboard = true }) => (
  <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
    <SafeAreaView style={{ flex: 1, backgroundColor: FriendsColors.bg }} edges={['top', 'bottom']}>
      <View style={styles.pageHeader}>
        <TouchableOpacity onPress={onClose} hitSlop={12} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel="Back">
          <ChevronLeft size={24} color={FriendsColors.ink} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={FT.h2} numberOfLines={1} accessibilityRole="header">
            {title}
          </Text>
          {subtitle ? (
            <Text style={FT.small} numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        {right}
      </View>
      {avoidKeyboard ? <KeyboardAvoidingView style={{ flex: 1 }}>{children}</KeyboardAvoidingView> : children}
    </SafeAreaView>
  </Modal>
);

const styles = themedSheet(() => ({
  overlay: { flex: 1, backgroundColor: FriendsColors.overlay, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: FriendsColors.overlaySurface,
    borderTopLeftRadius: FR.sheet,
    borderTopRightRadius: FR.sheet,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: FriendsColors.lineStrong,
    ...(FElevation.floating as object),
    paddingHorizontal: FS.xl,
    paddingTop: FS.sm,
    paddingBottom: Platform.OS === 'ios' ? FS.xxl : FS.lg,
  },
  grabber: { alignSelf: 'center', width: 36, height: 5, borderRadius: 3, backgroundColor: FriendsColors.lineStrong, marginBottom: FS.sm },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: FS.md,
    marginBottom: FS.md,
    borderBottomWidth: StyleSheet.hairlineWidth * 2,
    borderBottomColor: FriendsColors.line,
  },
  iconBtn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  closeDisc: { width: 30, height: 30, borderRadius: 15, backgroundColor: FriendsColors.cardHi, alignItems: 'center', justifyContent: 'center' },
  pageHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: FS.sm,
    paddingHorizontal: FS.sm,
    paddingVertical: FS.sm,
    minHeight: 56,
    backgroundColor: FriendsColors.bg,
    borderBottomWidth: StyleSheet.hairlineWidth * 2,
    borderBottomColor: FriendsColors.lineSoft,
  },
}));
