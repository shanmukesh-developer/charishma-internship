import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { KeyboardAvoidingView } from '../../../../components/KeyboardAvoidingView';
import * as Haptics from 'expo-haptics';
import { ChevronLeft, Sparkles } from '../../../../components/lucide';
import { FriendsColors, FS, FT, fui } from '../friendsTheme';
import { errorCode } from '../api/core';
import { ConnectLiveness, ConnectMyProfile, ConnectStatus, activateConnect } from '../api/connectApi';
import { ConnectProfileEditor } from './ConnectProfileEditor';
import { LivenessPanel } from './LivenessPanel';
import { Notice, PrimaryButton, StepDots } from './ConnectUi';
import { ONBOARDING_STEPS } from './ConnectGate';
import { connectErrorMessage } from './connectShared';

import { themedSheet } from '../../../../utils/themeNow';
const profileReady = (p: ConnectMyProfile | null) => !!p && p.displayName.trim().length >= 2 && p.lookingFor.length > 0 && p.photos.length > 0;

/**
 * After consent: build the profile (photos first, since the selfie reviewer compares with them),
 * pass the selfie check, then turn Connect on. The server decides when it is allowed.
 */
export const ConnectOnboarding: React.FC<{
  status: ConnectStatus;
  onStatus: (patch: Partial<ConnectStatus>) => void;
  onChanged: () => void;
}> = ({ status, onStatus, onChanged }) => {
  const profile = status.profile as ConnectMyProfile;
  const [step, setStep] = useState<'profile' | 'verify'>(() => (profileReady(profile) ? 'verify' : 'profile'));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const liveness = profile?.liveness || status.liveness;
  const livenessOk = !liveness.required || liveness.status === 'passed';

  const setProfile = (p: ConnectMyProfile) => onStatus({ profile: p, liveness: p.liveness });
  const setLiveness = (l?: ConnectLiveness) => {
    if (l) onStatus({ liveness: l, profile: { ...profile, liveness: l } });
    onChanged();
  };

  const activate = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await activateConnect();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      onChanged();
    } catch (e: any) {
      const code = errorCode(e);
      if (code === 'PROFILE_INCOMPLETE') setStep('profile');
      if (['LIVENESS_REQUIRED', 'LIVENESS_NOT_CONFIGURED', 'CONSENT_REQUIRED', 'PROFILE_REMOVED'].includes(code)) onChanged();
      setError(connectErrorMessage(e, "Couldn't turn on Connect."));
    } finally {
      setBusy(false);
    }
  };

  if (!profile) return null;

  return (
    <KeyboardAvoidingView style={{ flex: 1 }}>
    <ScrollView style={fui.screen} contentContainerStyle={{ paddingBottom: 120 }} keyboardShouldPersistTaps="handled">
      <StepDots steps={ONBOARDING_STEPS} current={step === 'profile' ? 2 : 3} />
      <View style={{ padding: FS.lg }}>
        {step === 'profile' ? (
          <ConnectProfileEditor
            status={status}
            profile={profile}
            mode="setup"
            onProfile={setProfile}
            onSaved={() => setStep('verify')}
            header={
              <View style={{ gap: 4 }}>
                <Text style={FT.h1} accessibilityRole="header">
                  Your Connect profile
                </Text>
                <Text style={FT.muted}>Separate from your campus profile. Only what you add here is shown, plus your age{profile.year || profile.branch ? ' and, if you choose, your year and branch' : ''}.</Text>
              </View>
            }
          />
        ) : (
          <View style={{ gap: FS.lg }}>
            <TouchableOpacity style={styles.back} onPress={() => setStep('profile')} accessibilityRole="button" accessibilityLabel="Back to your profile">
              <ChevronLeft size={18} color={FriendsColors.muted} />
              <Text style={FT.small}>Edit profile</Text>
            </TouchableOpacity>
            <LivenessPanel liveness={liveness} hasPhotos={profile.photos.length > 0} onChanged={setLiveness} onAddPhotos={() => setStep('profile')} />
            {livenessOk ? (
              <View style={{ gap: FS.md }}>
                {!profile.photos.some((p) => p.status === 'approved') ? (
                  <Notice tone="muted" text="Your photos are still in review. You can turn Connect on now; others see your photos once they're approved." />
                ) : null}
                {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
                <PrimaryButton label="Turn on Connect" onPress={activate} busy={busy} icon={<Sparkles size={18} color={FriendsColors.accentInk} />} />
                <Text style={[FT.small, { textAlign: 'center' }]}>You can pause or delete Connect any time from Safety.</Text>
              </View>
            ) : error ? (
              <Text style={styles.error}>{error}</Text>
            ) : null}
          </View>
        )}
      </View>
    </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = themedSheet(() => ({
  back: { flexDirection: 'row', alignItems: 'center', gap: 2, minHeight: 36, alignSelf: 'flex-start' },
  error: { fontSize: 13, fontWeight: '600', color: FriendsColors.danger },
}));
