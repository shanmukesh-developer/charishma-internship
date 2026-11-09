/**
 * Shared building blocks for the Campus hub so every screen uses the same spacing,
 * type scale, sheets, empty / error states and skeletons.
 */
import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  Platform,
  ActivityIndicator,
  ScrollView,
  StyleProp,
  ViewStyle,
} from 'react-native';
import { KeyboardAvoidingView } from '../../components/KeyboardAvoidingView';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { X, ChevronLeft, WifiOff } from '../../components/lucide';
import { CampusColors, CampusLayout } from '../../constants/campusTheme';
import { resolveMediaUrl } from '../../utils/imageUpload';
import ShimmerLoader from '../../components/ShimmerLoader';

import { themedSheet } from '../../utils/themeNow';
export const S = CampusLayout.spacing;
export const R = CampusLayout.radius;

export const T = themedSheet(() => ({
  h1: { fontSize: 22, fontWeight: '800', color: CampusColors.ink, letterSpacing: -0.3 },
  h2: { fontSize: 17, fontWeight: '700', color: CampusColors.ink },
  h3: { fontSize: 15, fontWeight: '700', color: CampusColors.ink },
  body: { fontSize: 14, lineHeight: 20, color: CampusColors.ink },
  muted: { fontSize: 13, lineHeight: 18, color: CampusColors.muted },
  small: { fontSize: 12, color: CampusColors.muted },
  kicker: { fontSize: 12, fontWeight: '800', letterSpacing: 0.8, color: CampusColors.muted, textTransform: 'uppercase' },
}));

const initialsOf = (name?: string | null) => {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
};

export const Avatar: React.FC<{
  name?: string | null;
  uri?: string | null;
  size?: number;
  rounded?: boolean;
  bg?: string;
}> = ({ name, uri, size = 44, rounded = true, bg = CampusColors.placeholderFill }) => {
  const [failed, setFailed] = React.useState(false);
  const src = resolveMediaUrl(uri);
  React.useEffect(() => setFailed(false), [src]);
  const radius = rounded ? size / 2 : Math.round(size * 0.28);
  return (
    <View style={{ width: size, height: size, borderRadius: radius, backgroundColor: bg, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}>
      {src && !failed ? (
        <Image source={{ uri: src }} style={{ width: size, height: size }} contentFit="cover" onError={() => setFailed(true)} />
      ) : (
        <Text style={{ fontSize: Math.max(11, size * 0.34), fontWeight: '800', color: CampusColors.ink }}>{initialsOf(name)}</Text>
      )}
    </View>
  );
};

export const Button: React.FC<{
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  loading?: boolean;
  disabled?: boolean;
  small?: boolean;
  icon?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}> = ({ label, onPress, variant = 'primary', loading, disabled, small, icon, style }) => {
  const isPrimary = variant === 'primary';
  const isDanger = variant === 'danger';
  const bg = isPrimary ? CampusColors.accent : isDanger ? '#FDECEB' : variant === 'secondary' ? CampusColors.card : 'transparent';
  const fg = isPrimary ? '#FFFFFF' : isDanger ? CampusColors.sos : variant === 'ghost' ? CampusColors.accent : CampusColors.ink;
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled || loading}
      activeOpacity={0.85}
      accessibilityRole="button"
      style={[
        {
          height: small ? 36 : 48,
          paddingHorizontal: small ? 14 : 20,
          borderRadius: R.pill,
          backgroundColor: bg,
          borderWidth: variant === 'secondary' ? 1 : 0,
          borderColor: CampusColors.line,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          opacity: disabled ? 0.5 : 1,
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} size="small" />
      ) : (
        <>
          {icon}
          <Text style={{ fontSize: small ? 13 : 15, fontWeight: '700', color: fg }}>{label}</Text>
        </>
      )}
    </TouchableOpacity>
  );
};

/** Bottom sheet. Android back and the backdrop close it. */
export const Sheet: React.FC<{
  visible: boolean;
  onClose: () => void;
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
  scroll?: boolean;
  maxHeight?: `${number}%` | number;
}> = ({ visible, onClose, title, icon, children, scroll = true, maxHeight = '88%' }) => (
  <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
    <KeyboardAvoidingView style={ui.overlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onClose} accessibilityLabel="Close" />
      <View style={[ui.sheet, { maxHeight }]}>
        <View style={ui.grabber} />
        <View style={ui.sheetHeader}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
            {icon}
            <Text style={T.h2} numberOfLines={1}>{title}</Text>
          </View>
          <TouchableOpacity onPress={onClose} hitSlop={12} style={ui.iconBtn} accessibilityLabel="Close">
            <X size={20} color={CampusColors.muted} />
          </TouchableOpacity>
        </View>
        {scroll ? (
          <ScrollView contentContainerStyle={{ paddingBottom: S.xxl }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            {children}
          </ScrollView>
        ) : (
          children
        )}
      </View>
    </KeyboardAvoidingView>
  </Modal>
);

/** Full-screen page opened from a tab. Android back and the header arrow go back. */
export const ScreenModal: React.FC<{
  visible: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}> = ({ visible, onClose, title, subtitle, right, children }) => (
  <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
    <SafeAreaView style={{ flex: 1, backgroundColor: CampusColors.paper }} edges={['top', 'bottom']}>
      <View style={ui.pageHeader}>
        <TouchableOpacity onPress={onClose} hitSlop={12} style={ui.iconBtn} accessibilityLabel="Back">
          <ChevronLeft size={24} color={CampusColors.ink} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={T.h2} numberOfLines={1}>{title}</Text>
          {subtitle ? <Text style={T.small} numberOfLines={1}>{subtitle}</Text> : null}
        </View>
        {right}
      </View>
      <KeyboardAvoidingView style={{ flex: 1 }}>{children}</KeyboardAvoidingView>
    </SafeAreaView>
  </Modal>
);

export const EmptyState: React.FC<{
  icon?: React.ReactNode;
  title: string;
  subtitle?: string;
  actionLabel?: string;
  onAction?: () => void;
  compact?: boolean;
}> = ({ icon, title, subtitle, actionLabel, onAction, compact }) => (
  <View style={[ui.empty, compact && { paddingVertical: S.xl }]}>
    {icon ? <View style={ui.emptyIcon}>{icon}</View> : null}
    <Text style={[T.h3, { textAlign: 'center' }]}>{title}</Text>
    {subtitle ? <Text style={[T.muted, { textAlign: 'center', marginTop: 4 }]}>{subtitle}</Text> : null}
    {actionLabel && onAction ? <Button label={actionLabel} onPress={onAction} small style={{ marginTop: S.lg }} /> : null}
  </View>
);

export const ErrorState: React.FC<{ message: string; onRetry?: () => void; compact?: boolean }> = ({ message, onRetry, compact }) => (
  <EmptyState
    compact={compact}
    icon={<WifiOff size={22} color={CampusColors.warm} />}
    title="Something went wrong"
    subtitle={message}
    actionLabel={onRetry ? 'Retry' : undefined}
    onAction={onRetry}
  />
);

/** Inline banner for a non-blocking failure (keeps the old content on screen). */
export const RetryBanner: React.FC<{ message: string; onRetry: () => void }> = ({ message, onRetry }) => (
  <TouchableOpacity style={ui.banner} onPress={onRetry} activeOpacity={0.8}>
    <Text style={ui.bannerText}>{message}</Text>
    <Text style={[ui.bannerText, { fontWeight: '800' }]}>Retry</Text>
  </TouchableOpacity>
);

export const SkeletonRows: React.FC<{ rows?: number; avatar?: boolean }> = ({ rows = 4, avatar = true }) => (
  <View style={ui.card}>
    {Array.from({ length: rows }).map((_, i) => (
      <View key={i} style={[ui.row, i === rows - 1 && { borderBottomWidth: 0 }]}>
        {avatar ? <ShimmerLoader width={44} height={44} borderRadius={22} /> : null}
        <View style={{ flex: 1, gap: 8 }}>
          <ShimmerLoader width="55%" height={14} borderRadius={6} />
          <ShimmerLoader width="80%" height={12} borderRadius={6} />
        </View>
      </View>
    ))}
  </View>
);

export const SectionTitle: React.FC<{ title: string; action?: string; onAction?: () => void; style?: StyleProp<ViewStyle> }> = ({
  title,
  action,
  onAction,
  style,
}) => (
  <View style={[{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: S.sm, marginTop: S.lg }, style]}>
    <Text style={T.kicker}>{title}</Text>
    {action && onAction ? (
      <TouchableOpacity onPress={onAction} hitSlop={8}>
        <Text style={{ fontSize: 13, fontWeight: '700', color: CampusColors.accent }}>{action}</Text>
      </TouchableOpacity>
    ) : null}
  </View>
);

export const Segmented = <K extends string>({
  options,
  value,
  onChange,
  style,
}: {
  options: { key: K; label: string; badge?: number }[];
  value: K;
  onChange: (k: K) => void;
  style?: StyleProp<ViewStyle>;
}) => (
  <View style={[ui.segWrap, style]}>
    {options.map((o) => {
      const active = o.key === value;
      return (
        <TouchableOpacity
          key={o.key}
          style={[ui.segItem, active && ui.segItemActive]}
          onPress={() => onChange(o.key)}
          activeOpacity={0.8}
          accessibilityRole="tab"
          accessibilityState={{ selected: active }}
        >
          <Text style={[ui.segText, active && ui.segTextActive]} numberOfLines={1}>{o.label}</Text>
          {o.badge ? (
            <View style={ui.segBadge}>
              <Text style={ui.segBadgeText}>{o.badge > 99 ? '99+' : o.badge}</Text>
            </View>
          ) : null}
        </TouchableOpacity>
      );
    })}
  </View>
);

/** A tappable list row: icon / avatar, title, subtitle, right slot. */
export const ListRow: React.FC<{
  left?: React.ReactNode;
  title: string;
  subtitle?: string | null;
  right?: React.ReactNode;
  onPress?: () => void;
  last?: boolean;
}> = ({ left, title, subtitle, right, onPress, last }) => {
  const content = (
    <View style={[ui.row, last && { borderBottomWidth: 0 }]}>
      {left}
      <View style={{ flex: 1 }}>
        <Text style={T.h3} numberOfLines={1}>{title}</Text>
        {subtitle ? <Text style={[T.muted, { marginTop: 2 }]} numberOfLines={2}>{subtitle}</Text> : null}
      </View>
      {right}
    </View>
  );
  return onPress ? (
    <TouchableOpacity onPress={onPress} activeOpacity={0.7}>
      {content}
    </TouchableOpacity>
  ) : (
    content
  );
};

export const ui = themedSheet(() => ({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: CampusColors.card,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: S.xl,
    paddingTop: S.sm,
    paddingBottom: Platform.OS === 'ios' ? S.xxl : S.lg,
  },
  grabber: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: CampusColors.line, marginBottom: S.sm },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: S.md,
    marginBottom: S.md,
    borderBottomWidth: 1,
    borderBottomColor: CampusColors.line,
  },
  iconBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  pageHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: S.sm,
    paddingHorizontal: S.sm,
    paddingVertical: S.sm,
    backgroundColor: CampusColors.card,
    borderBottomWidth: 1,
    borderBottomColor: CampusColors.line,
  },
  card: {
    backgroundColor: CampusColors.card,
    borderRadius: R.card,
    borderWidth: 1,
    borderColor: CampusColors.line,
    overflow: 'hidden',
  },
  cardPad: {
    backgroundColor: CampusColors.card,
    borderRadius: R.card,
    borderWidth: 1,
    borderColor: CampusColors.line,
    padding: S.lg,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: S.md,
    paddingHorizontal: S.lg,
    paddingVertical: S.md,
    borderBottomWidth: 1,
    borderBottomColor: CampusColors.line,
    minHeight: 60,
  },
  empty: { alignItems: 'center', paddingVertical: 40, paddingHorizontal: S.xl },
  emptyIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: CampusColors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: S.md,
  },
  banner: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: CampusColors.warmSoft,
    borderRadius: R.md,
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginBottom: S.md,
    gap: S.md,
  },
  bannerText: { fontSize: 13, fontWeight: '600', color: CampusColors.warmDeep, flexShrink: 1 },
  input: {
    height: 48,
    borderRadius: R.md,
    borderWidth: 1,
    borderColor: CampusColors.line,
    backgroundColor: CampusColors.paper,
    paddingHorizontal: 14,
    fontSize: 15,
    color: CampusColors.ink,
  },
  label: { fontSize: 12, fontWeight: '700', color: CampusColors.muted, marginBottom: 6, marginTop: S.md },
  errorBox: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'flex-start',
    backgroundColor: '#FDECEB',
    borderRadius: R.md,
    padding: S.md,
    marginBottom: S.md,
  },
  errorText: { flex: 1, fontSize: 13, lineHeight: 18, color: '#A3321A', fontWeight: '600' },
  segWrap: {
    flexDirection: 'row',
    backgroundColor: CampusColors.placeholderFill,
    borderRadius: R.pill,
    padding: 3,
  },
  segItem: {
    flex: 1,
    height: 34,
    borderRadius: R.pill,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 6,
  },
  segItemActive: {
    backgroundColor: CampusColors.card,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },
  segText: { fontSize: 13, fontWeight: '600', color: CampusColors.muted },
  segTextActive: { color: CampusColors.ink, fontWeight: '800' },
  segBadge: { minWidth: 18, height: 18, borderRadius: 9, backgroundColor: CampusColors.accent, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 },
  segBadgeText: { fontSize: 12, fontWeight: '800', color: '#FFFFFF' },
  pill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: R.pill,
    backgroundColor: CampusColors.accentSoft,
  },
  pillText: { fontSize: 12, fontWeight: '800', color: CampusColors.accentDeep },
}));
