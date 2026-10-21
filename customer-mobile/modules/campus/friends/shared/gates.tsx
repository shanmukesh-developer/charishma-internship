import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator, StyleSheet, Linking } from 'react-native';
import { ShieldCheck, ShieldAlert, Lock, LogIn, BookOpen, Clock, Check } from '../../../../components/lucide';
import * as Haptics from 'expo-haptics';
import {
  FriendsEligibility,
  FriendsReason,
  acceptFriendsGuidelines,
  fetchFriendsGuidelines,
  FriendsGuidelines,
  errorCode,
} from '../api/core';
import { sanctionScopeLabel } from '../api/modApi';
import { FriendsColors, FS, FT, FR, fui } from '../friendsTheme';
import { FriendsEmpty, FriendsError } from './FriendsEmpty';
import { FriendsSkeleton } from './FriendsSkeleton';
import { FriendsButton } from './FriendsUi';
import { LinearGradient } from 'expo-linear-gradient';
import { formatLocal } from './RelativeTime';

/** Plain-language copy for each eligibility reason (most fundamental first). */
const REASON_COPY: Record<FriendsReason, { title: string; body: string }> = {
  ACCOUNT_SUSPENDED: {
    title: 'Your account is suspended',
    body: 'Friends is not available while your Zenvy account is suspended. Contact support if you think this is a mistake.',
  },
  CAMPUS_REQUIRED: {
    title: 'Pick your campus',
    body: 'Friends is a private space for students of one campus. Choose your college to continue.',
  },
  VERIFICATION_REQUIRED: {
    title: 'Verify you are a student',
    body: 'Only verified students can use Friends, so everyone here is really from your campus. It takes a minute with your college email.',
  },
  CAMPUS_INACTIVE: {
    title: 'Not open on your campus yet',
    body: "Friends hasn't launched on your campus yet. We'll let you know when it does.",
  },
  FRIENDS_SANCTIONED: {
    title: 'Friends is restricted for you',
    body: 'A moderator restricted your access after a guideline violation. You can see the decision and appeal it.',
  },
  FRIENDS_OFF: {
    title: 'Friends is taking a short break',
    body: 'Friends is turned off for maintenance. Please check back soon.',
  },
};

/** The single reason the gate should explain (the server orders reasons most-fundamental first). */
export const primaryReason = (e: FriendsEligibility | null): FriendsReason | null => (e && !e.eligible ? e.reasons[0] || null : null);

/**
 * Shown instead of a Friends sub-tab when the student can't use it yet:
 * sign in, pick campus / verify, campus not live, restricted (with appeal), or Friends switched off.
 */
export const EligibilityGate: React.FC<{
  eligibility: FriendsEligibility | null;
  /** Signed out (no token / expired). */
  needsSignIn?: boolean;
  onSignIn?: () => void;
  onVerify?: () => void;
  /** Me › Friends privacy & safety (decisions + appeals). */
  onOpenSafety?: () => void;
  compact?: boolean;
}> = ({ eligibility, needsSignIn, onSignIn, onVerify, onOpenSafety, compact }) => {
  if (needsSignIn) {
    return (
      <FriendsEmpty
        compact={compact}
        icon={<LogIn size={22} color={FriendsColors.accent} />}
        title="Sign in to use Friends"
        subtitle="Friends is for verified students of your campus."
        actionLabel={onSignIn ? 'Sign in' : undefined}
        onAction={onSignIn}
      />
    );
  }
  const reason = primaryReason(eligibility);
  if (!reason) return null;
  const copy = REASON_COPY[reason] || REASON_COPY.VERIFICATION_REQUIRED;

  if (reason === 'FRIENDS_SANCTIONED') {
    const s = eligibility?.sanction;
    const until = s?.until ? `Until ${formatLocal(s.until)}` : 'No end date';
    return (
      <FriendsEmpty
        compact={compact}
        icon={<ShieldAlert size={22} color={FriendsColors.danger} />}
        title={copy.title}
        subtitle={`${copy.body}\n\nScope: ${sanctionScopeLabel(s?.scope || 'friends')} · ${until}`}
        actionLabel={onOpenSafety ? 'See decision & appeal' : undefined}
        onAction={onOpenSafety}
      />
    );
  }

  const canVerify = reason === 'CAMPUS_REQUIRED' || reason === 'VERIFICATION_REQUIRED';
  const pending = eligibility?.verification?.status === 'pending';
  return (
    <FriendsEmpty
      compact={compact}
      icon={
        reason === 'CAMPUS_INACTIVE' || reason === 'FRIENDS_OFF' ? (
          <Clock size={22} color={FriendsColors.accent} />
        ) : canVerify ? (
          <ShieldCheck size={22} color={FriendsColors.gold} />
        ) : (
          <Lock size={22} color={FriendsColors.accent} />
        )
      }
      title={pending && reason === 'VERIFICATION_REQUIRED' ? 'Your ID is being reviewed' : copy.title}
      subtitle={
        pending && reason === 'VERIFICATION_REQUIRED'
          ? "We'll unlock Friends as soon as your college ID is approved. You can also verify instantly with your college email."
          : copy.body
      }
      actionLabel={canVerify && onVerify ? (pending ? 'Check status' : 'Verify now') : undefined}
      onAction={onVerify}
    />
  );
};

/**
 * First-visit community guidelines. Writing anything in Friends needs the current version accepted
 * (server answers 428 GUIDELINES_REQUIRED otherwise). `readOnly` just shows the text (Me › Safety).
 */
export const GuidelinesGate: React.FC<{
  onAccepted?: (version: number) => void;
  readOnly?: boolean;
}> = ({ onAccepted, readOnly }) => {
  const [g, setG] = useState<FriendsGuidelines | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setG(await fetchFriendsGuidelines());
    } catch (e: any) {
      setError(e?.message || "Couldn't load the guidelines.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const accept = async () => {
    if (!g || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await acceptFriendsGuidelines(g.version);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      onAccepted?.(res.version);
    } catch (e: any) {
      if (errorCode(e) === 'GUIDELINES_VERSION_MISMATCH') {
        setSaveError('The guidelines were just updated. Please read the latest version.');
        load();
      } else {
        setSaveError(e?.message || "Couldn't save that. Please try again.");
      }
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <FriendsSkeleton rows={2} />;
  if (error || !g) return <FriendsError message={error || "Couldn't load the guidelines."} onRetry={load} />;

  const lines = g.text.split('\n').filter((l) => l.trim());
  return (
    <ScrollView contentContainerStyle={{ padding: FS.lg, paddingBottom: FS.xxxl }}>
      {!readOnly ? (
        <View style={{ alignItems: 'center', marginBottom: FS.lg }}>
          <LinearGradient colors={['rgba(212,175,122,0.14)', 'rgba(212,175,122,0.14)']} start={{ x: 0.2, y: 0 }} end={{ x: 0.8, y: 1 }} style={styles.icon}>
            <BookOpen size={26} color={FriendsColors.accent} />
          </LinearGradient>
          <Text style={[FT.h1, { textAlign: 'center' }]} accessibilityRole="header">
            Welcome to Friends
          </Text>
          <Text style={[FT.muted, { textAlign: 'center', marginTop: 6 }]}>
            A space only for verified students of your campus. Please read our community guidelines.
          </Text>
        </View>
      ) : null}
      <View style={fui.cardPad}>
        {lines.map((line, i) => (
          <Text key={i} style={[FT.body, { marginTop: i ? FS.sm : 0 }, /^\d+\./.test(line.trim()) ? null : { color: FriendsColors.muted }]}>
            {line}
          </Text>
        ))}
        <Text style={[FT.small, { marginTop: FS.md }]}>Version {g.version}</Text>
      </View>
      {g.url ? (
        <TouchableOpacity onPress={() => Linking.openURL(g.url as string).catch(() => {})} style={{ marginTop: FS.md, minHeight: 44, justifyContent: 'center' }} accessibilityRole="link">
          <Text style={{ color: FriendsColors.accent, fontWeight: '700', textAlign: 'center' }}>Read the full guidelines</Text>
        </TouchableOpacity>
      ) : null}
      {readOnly ? (
        g.accepted ? (
          <View style={[styles.acceptedRow, { marginTop: FS.lg }]}>
            <Check size={16} color={FriendsColors.success} />
            <Text style={[FT.small, { color: FriendsColors.success }]}>You accepted these guidelines.</Text>
          </View>
        ) : null
      ) : (
        <>
          {saveError ? (
            <View style={styles.errorBox} accessibilityRole="alert">
              <Text style={styles.errorText}>{saveError}</Text>
            </View>
          ) : null}
          <FriendsButton label="I agree" onPress={accept} loading={saving} style={{ marginTop: FS.xl }} accessibilityHint="Accepts the community guidelines" />
        </>
      )}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  icon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 1,
    borderColor: FriendsColors.accentLine,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: FS.md,
  },
  acceptedRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  errorBox: { marginTop: FS.lg, padding: FS.md, borderRadius: FR.md, backgroundColor: FriendsColors.dangerSoft },
  errorText: { fontSize: 13, lineHeight: 18, fontWeight: '600', color: FriendsColors.danger },
});
