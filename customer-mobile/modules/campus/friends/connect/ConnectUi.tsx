import React from 'react';
import { View, Text, TouchableOpacity, Switch, StyleSheet, StyleProp, ViewStyle, ActivityIndicator } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Check, Heart } from '../../../../components/lucide';
import { FriendsColors, FS, FT, FR, fui, SectionTints } from '../friendsTheme';
import { FriendsButton } from '../shared/FriendsUi';
import { initialOf, photoSource } from './connectShared';

/** A private Connect photo (memory cache only), or a quiet monogram when there is none. */
export const ConnectPhotoView: React.FC<{
  photo?: { id: string; url: string | null } | null;
  name?: string;
  style?: StyleProp<ViewStyle>;
  radius?: number;
  label?: string;
}> = ({ photo, name, style, radius = FR.card, label }) => {
  const src = photoSource(photo);
  return (
    <View style={[{ borderRadius: radius, overflow: 'hidden', backgroundColor: FriendsColors.cardHi }, style]} accessible accessibilityRole="image" accessibilityLabel={label || (name ? `Photo of ${name}` : 'Photo')}>
      {src ? (
        <Image source={src} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory" transition={150} />
      ) : (
        <LinearGradient colors={['#222226', '#222226']} style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
          <Text style={styles.monogram}>{initialOf(name)}</Text>
        </LinearGradient>
      )}
    </View>
  );
};

/** Toggle chip (filters, interests, looking for). */
export const ConnectChip: React.FC<{
  label: string;
  selected?: boolean;
  onPress?: () => void;
  icon?: React.ReactNode;
  disabled?: boolean;
  a11yHint?: string;
}> = ({ label, selected, onPress, icon, disabled, a11yHint }) => (
  <TouchableOpacity
    onPress={onPress}
    disabled={disabled || !onPress}
    style={[fui.pill, selected && fui.pillActive, disabled && { opacity: 0.5 }]}
    activeOpacity={0.8}
    accessibilityRole={onPress ? 'checkbox' : 'text'}
    accessibilityState={onPress ? { checked: !!selected, disabled: !!disabled } : undefined}
    accessibilityLabel={label}
    accessibilityHint={a11yHint}
  >
    {selected && onPress ? <Check size={13} color={FriendsColors.accentInk} /> : icon}
    <Text style={[fui.pillText, selected && fui.pillTextActive]}>{label}</Text>
  </TouchableOpacity>
);

/** Read-only tag on a card. */
export const ConnectTag: React.FC<{ label: string; tone?: 'accent' | 'muted' }> = ({ label, tone = 'muted' }) => (
  <View style={[styles.tag, tone === 'accent' && { backgroundColor: SectionTints.connect.soft, borderColor: SectionTints.connect.line }]}>
    <Text style={[styles.tagText, tone === 'accent' && { color: SectionTints.connect.fg }]}>{label}</Text>
  </View>
);

export const SectionTitle: React.FC<{ title: string; hint?: string; right?: React.ReactNode }> = ({ title, hint, right }) => (
  <View style={styles.section}>
    <View style={{ flex: 1 }}>
      <Text style={FT.kicker} accessibilityRole="header">
        {title}
      </Text>
      {hint ? <Text style={[FT.small, { marginTop: 2 }]}>{hint}</Text> : null}
    </View>
    {right}
  </View>
);

export const ToggleRow: React.FC<{
  label: string;
  hint?: string;
  value: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  last?: boolean;
}> = ({ label, hint, value, onChange, disabled, last }) => (
  <View style={[fui.row, last && { borderBottomWidth: 0 }]}>
    <View style={{ flex: 1 }}>
      <Text style={FT.h3}>{label}</Text>
      {hint ? <Text style={FT.small}>{hint}</Text> : null}
    </View>
    <Switch
      value={value}
      onValueChange={onChange}
      disabled={disabled}
      trackColor={{ false: FriendsColors.line, true: FriendsColors.accent }}
      thumbColor={value ? FriendsColors.accentInk : FriendsColors.muted}
      accessibilityLabel={label}
      accessibilityHint={hint}
    />
  </View>
);

type Tone = 'accent' | 'warn' | 'danger' | 'success' | 'muted';
const toneOf = (t: Tone) =>
  t === 'accent'
    ? { fg: FriendsColors.accent, bg: FriendsColors.accentSoft }
    : t === 'warn'
      ? { fg: FriendsColors.warn, bg: FriendsColors.warnSoft }
      : t === 'danger'
        ? { fg: FriendsColors.danger, bg: FriendsColors.dangerSoft }
        : t === 'success'
          ? { fg: FriendsColors.success, bg: FriendsColors.successSoft }
          : { fg: FriendsColors.muted, bg: FriendsColors.cardHi };

export const StatusPill: React.FC<{ label: string; tone?: Tone }> = ({ label, tone = 'muted' }) => {
  const c = toneOf(tone);
  return (
    <View style={[styles.pill, { backgroundColor: c.bg }]}>
      <Text style={[styles.pillText, { color: c.fg }]}>{label}</Text>
    </View>
  );
};

/** Inline notice (info / warning / error) with an optional action. */
export const Notice: React.FC<{
  icon?: React.ReactNode;
  title?: string;
  text: string;
  tone?: Tone;
  actionLabel?: string;
  onAction?: () => void;
  style?: StyleProp<ViewStyle>;
}> = ({ icon, title, text, tone = 'accent', actionLabel, onAction, style }) => {
  const c = toneOf(tone);
  return (
    <View style={[styles.notice, { backgroundColor: c.bg }, style]} accessible={!onAction} accessibilityRole={onAction ? undefined : 'alert'}>
      {icon ? <View style={{ marginTop: 1 }}>{icon}</View> : null}
      <View style={{ flex: 1 }}>
        {title ? <Text style={[FT.h3, { color: c.fg }]}>{title}</Text> : null}
        <Text style={[FT.small, { color: FriendsColors.ink, lineHeight: 17 }]}>{text}</Text>
        {actionLabel && onAction ? (
          <TouchableOpacity onPress={onAction} style={{ marginTop: 6, minHeight: 32, justifyContent: 'center' }} accessibilityRole="button" accessibilityLabel={actionLabel}>
            <Text style={{ fontSize: 13, fontWeight: '800', color: c.fg }}>{actionLabel}</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
};

/** Primary button with a busy state. */
export const PrimaryButton: React.FC<{
  label: string;
  onPress: () => void;
  busy?: boolean;
  disabled?: boolean;
  icon?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  a11yHint?: string;
}> = ({ label, onPress, busy, disabled, icon, style, a11yHint }) => (
  <FriendsButton label={label} onPress={onPress} loading={busy} disabled={disabled} icon={icon} style={style} accessibilityHint={a11yHint} />
);

export const GhostButton: React.FC<{
  label: string;
  onPress: () => void;
  busy?: boolean;
  disabled?: boolean;
  icon?: React.ReactNode;
  danger?: boolean;
  style?: StyleProp<ViewStyle>;
}> = ({ label, onPress, busy, disabled, icon, danger, style }) => (
  <FriendsButton label={label} onPress={onPress} loading={busy} disabled={disabled} icon={icon} style={style} variant={danger ? 'danger' : 'ghost'} />
);

/** Onboarding progress: Age · Consent · Selfie · Profile. */
export const StepDots: React.FC<{ steps: string[]; current: number }> = ({ steps, current }) => (
  <View style={styles.steps} accessible accessibilityLabel={`Step ${current + 1} of ${steps.length}: ${steps[current] || ''}`}>
    {steps.map((s, i) => (
      <View key={s} style={{ flex: 1, gap: 4 }}>
        <View style={[styles.stepBar, i <= current && { backgroundColor: FriendsColors.accent }]} />
        <Text style={[styles.stepText, i === current && { color: FriendsColors.ink }]} numberOfLines={1}>
          {s}
        </Text>
      </View>
    ))}
  </View>
);

const styles = StyleSheet.create({
  monogram: { fontSize: 44, fontWeight: '800', color: 'rgba(245,168,196,0.6)', letterSpacing: -1 },
  tag: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: FR.pill, backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  tagText: { fontSize: 12, fontWeight: '700', color: FriendsColors.ink },
  section: { flexDirection: 'row', alignItems: 'flex-end', gap: FS.sm, marginTop: FS.xl, marginBottom: FS.sm },
  pill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: FR.pill, alignSelf: 'flex-start' },
  pillText: { fontSize: 12, fontWeight: '800', letterSpacing: 0.2 },
  notice: { flexDirection: 'row', gap: FS.sm, padding: FS.md, borderRadius: FR.md },
  steps: { flexDirection: 'row', gap: 6, paddingHorizontal: FS.lg, paddingTop: FS.md },
  stepBar: { height: 3, borderRadius: 2, backgroundColor: FriendsColors.line },
  stepText: { fontSize: 12, fontWeight: '700', color: FriendsColors.faint, textTransform: 'uppercase', letterSpacing: 0.5 },
});

/** The Connect mark: a filled lavender heart. */
export const ConnectHeart: React.FC<{ size?: number; color?: string }> = ({ size = 22, color = FriendsColors.accent }) => (
  <Heart size={size} color={color} fill={color} />
);
