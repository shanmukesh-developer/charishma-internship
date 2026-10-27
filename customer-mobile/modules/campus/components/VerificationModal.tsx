import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, ActivityIndicator } from 'react-native';
import { Image } from 'expo-image';
import {
  Mail,
  ShieldCheck,
  Camera,
  CheckCircle2,
  Sparkles,
  AlertCircle,
  Clock,
  ImageIcon,
  ChevronRight,
  ChevronLeft,
} from '../../../components/lucide';
import * as Haptics from 'expo-haptics';
import type { ImagePickerAsset } from 'expo-image-picker';
import { CampusColors } from '../../../constants/campusTheme';
import { CampusProfileData, CampusItem } from '../../../types/campus';
import { getToken } from '../../../utils/auth';
import { pickImageAsset, compressImage, uploadImageFile } from '../../../utils/imageUpload';
import {
  requestCollegeEmailOtp,
  confirmCollegeEmailOtp,
  uploadIdCardForVerification,
  fetchVerificationStatus,
  CampusVerificationStatus,
  CampusVerificationMethods,
  CampusApiError,
} from '../campusApi';
import { Sheet, Button, ErrorState, T, S, R, ui } from '../ui';

interface VerificationModalProps {
  visible: boolean;
  onClose: () => void;
  profile: CampusProfileData | null;
  campuses: CampusItem[];
  onVerifiedSuccess: (updatedProfile: CampusProfileData) => void;
  /** Called after an ID card is submitted so the shell can refresh the profile. */
  onSubmitted?: () => void;
}

type Step = 'choose' | 'email' | 'otp' | 'id_card' | 'done';

const formatWhen = (v?: string | null) => {
  if (!v) return '';
  const d = new Date(v);
  return isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
};

export const VerificationModal: React.FC<VerificationModalProps> = ({
  visible,
  onClose,
  profile,
  campuses,
  onVerifiedSuccess,
  onSubmitted,
}) => {
  const [status, setStatus] = useState<CampusVerificationStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [step, setStep] = useState<Step>('choose');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState('');

  // Email OTP
  const [email, setEmail] = useState('');
  const [sentTo, setSentTo] = useState('');
  const [otp, setOtp] = useState('');
  const [cooldown, setCooldown] = useState(0);
  const [emailUnavailable, setEmailUnavailable] = useState(false);

  // ID card
  const [asset, setAsset] = useState<ImagePickerAsset | null>(null);
  const [campusId, setCampusId] = useState<string | undefined>(undefined);
  const [collegeId, setCollegeId] = useState('');
  const uploadedRef = useRef<{ localUri: string; url: string } | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const methods: CampusVerificationMethods | undefined = status?.methods;
  const emailEnabled = !!methods?.email && !emailUnavailable;

  const loadStatus = useCallback(async () => {
    setStatusLoading(true);
    setStatusError(null);
    try {
      const token = await getToken();
      if (!token) throw new CampusApiError('Sign in to your ZCS account to verify.', 401, 'AUTH');
      const s = await fetchVerificationStatus();
      if (!mounted.current) return;
      setStatus(s);
    } catch (e: any) {
      if (mounted.current) setStatusError(e?.message || "Couldn't load your verification status.");
    } finally {
      if (mounted.current) setStatusLoading(false);
    }
  }, []);

  // Fresh state every time the sheet opens; reload when the status changes live (admin review).
  useEffect(() => {
    if (!visible) return;
    setStep('choose');
    setError(null);
    setOtp('');
    setAsset(null);
    uploadedRef.current = null;
    setCampusId(profile?.campusId || campuses[0]?.id);
    setCollegeId(profile?.collegeId || '');
    loadStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  useEffect(() => {
    if (visible) loadStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.verificationStatus]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const verificationStatus = status?.verificationStatus || profile?.verificationStatus || 'unverified';
  const last = status?.lastVerification || null;
  const rejectedReason = last?.status === 'rejected' ? last.reviewNotes || null : null;
  const isRejected = verificationStatus === 'rejected' || (last?.status === 'rejected' && verificationStatus !== 'verified');
  const isPending = verificationStatus === 'pending';
  const campusName =
    profile?.campus?.name || campuses.find((c) => c.id === profile?.campusId)?.name || '';
  const domains = (methods?.emailDomains && methods.emailDomains.length
    ? methods.emailDomains
    : campuses.flatMap((c) => c.emailDomains || [])
  ).filter(Boolean);

  // ── Email OTP ─────────────────────────────────────────────────────────────
  const handleSendOtp = async (override?: string) => {
    if (busy) return;
    setError(null);
    const full = (override ?? email).trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(full)) {
      setError(domains[0] ? `Enter your full college email, like name@${domains[0]}.` : 'Enter your full college email.');
      return;
    }
    setBusy(true);
    setBusyLabel('Sending code…');
    try {
      const res = await requestCollegeEmailOtp(full);
      if (!mounted.current) return;
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setSentTo(res?.email || full);
      setOtp('');
      setCooldown(Number(res?.resendAfterSeconds) || methods?.resendCooldownSeconds || 60);
      setStep('otp');
    } catch (e: any) {
      if (!mounted.current) return;
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      const code = e?.code;
      if (code === 'EMAIL_NOT_CONFIGURED') {
        setEmailUnavailable(true);
        setStep('id_card');
        setError("Email codes aren't available right now. Please verify with your college ID card instead.");
      } else if (code === 'OTP_COOLDOWN') {
        const wait = Number(e?.data?.retryAfter) || 60;
        setCooldown(wait);
        setSentTo(full);
        setStep('otp');
        setError(`A code was sent recently. You can ask for a new one in ${wait}s.`);
      } else if (code === 'DOMAIN_NOT_ALLOWED') {
        const allowed: string[] = e?.data?.allowedDomains || domains;
        setError(allowed.length ? `Use your college email ending in ${allowed.map((d) => '@' + d).join(', ')}.` : e.message);
      } else {
        setError(e?.message || "Couldn't send the code. Please try again.");
      }
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  const handleVerifyOtp = async () => {
    if (busy) return;
    setError(null);
    if (!/^\d{6}$/.test(otp.trim())) {
      setError('Enter the 6-digit code from the email.');
      return;
    }
    setBusy(true);
    setBusyLabel('Checking…');
    try {
      const res = await confirmCollegeEmailOtp(sentTo, otp.trim());
      if (!mounted.current) return;
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      if (res?.profile) onVerifiedSuccess(res.profile);
      setStatus((s) => (s ? { ...s, verificationStatus: 'verified' } : s));
      setStep('done');
    } catch (e: any) {
      if (!mounted.current) return;
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      const left = e?.data?.attemptsLeft;
      if (e?.code === 'OTP_INVALID' && typeof left === 'number') {
        setError(`That code is not right. ${left} ${left === 1 ? 'try' : 'tries'} left.`);
      } else if (e?.code === 'OTP_LOCKED' || e?.code === 'OTP_EXPIRED' || e?.code === 'OTP_NOT_FOUND') {
        const msg = String(e.message || 'This code can no longer be used.');
        setError(/new (code|one)/i.test(msg) ? msg : `${msg} Ask for a new code.`);
        setCooldown(0);
      } else {
        setError(e?.message || 'That code is invalid or has expired.');
      }
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  // ── ID card ───────────────────────────────────────────────────────────────
  const pickId = async (source: 'library' | 'camera') => {
    setError(null);
    const a = await pickImageAsset({ source, allowsEditing: true });
    if (a && mounted.current) {
      setAsset(a);
      uploadedRef.current = null;
    }
  };

  const handleSubmitId = async () => {
    if (busy) return;
    setError(null);
    if (!asset) {
      setError('Add a photo of the front of your college ID card first.');
      return;
    }
    setBusy(true);
    try {
      let url = uploadedRef.current?.localUri === asset.uri ? uploadedRef.current.url : '';
      if (!url) {
        setBusyLabel('Compressing photo…');
        const small = await compressImage(asset.uri, { width: asset.width, height: asset.height, maxEdge: 1600, quality: 0.75 });
        setBusyLabel('Uploading photo…');
        const up = await uploadImageFile(small, 'id_card');
        url = up.url;
        uploadedRef.current = { localUri: asset.uri, url };
      }
      setBusyLabel('Submitting…');
      await uploadIdCardForVerification(url, campusId, collegeId.trim() || undefined);
      if (!mounted.current) return;
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setAsset(null);
      onSubmitted?.();
      await loadStatus();
      setStep('choose');
    } catch (e: any) {
      if (!mounted.current) return;
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setError(e?.message || "Couldn't submit your ID card. Please try again.");
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  // ── Render pieces ─────────────────────────────────────────────────────────
  const renderVerified = () => (
    <View style={styles.center}>
      <CheckCircle2 size={56} color={CampusColors.accentDeep} strokeWidth={2} />
      <Text style={[T.h1, { marginTop: S.md, textAlign: 'center' }]}>
        {step === 'done' ? 'You are verified!' : "You're verified"}
      </Text>
      <Text style={[T.muted, { textAlign: 'center', marginTop: 6 }]}>
        {step === 'done'
          ? '+150 Campus points added. Whispers and verified-only features are now unlocked.'
          : `Your student identity is confirmed${campusName ? ` for ${campusName}` : ''}.`}
        {status?.collegeEmail ? `\n${status.collegeEmail}` : ''}
      </Text>
      <Button label="Done" onPress={onClose} style={{ alignSelf: 'stretch', marginTop: S.xl }} />
    </View>
  );

  const renderPendingCard = () => (
    <View style={[styles.statusCard, { backgroundColor: CampusColors.warmSoft }]}>
      <Clock size={20} color={CampusColors.warmDeep} />
      <View style={{ flex: 1 }}>
        <Text style={[T.h3, { color: CampusColors.warmDeep }]}>ID card under review</Text>
        <Text style={[T.muted, { color: CampusColors.warmDeep }]}>
          Submitted {formatWhen(last?.submittedAt) || 'recently'}. Our team usually reviews it within a few hours. You'll get a
          notification as soon as it's done.
        </Text>
      </View>
    </View>
  );

  const renderChoose = () => (
    <View>
      {isPending && renderPendingCard()}
      {isRejected && !isPending && (
        <View style={ui.errorBox}>
          <AlertCircle size={16} color="#A3321A" />
          <Text style={ui.errorText}>
            Your last ID card was not approved.
            {rejectedReason ? `\nReason: ${rejectedReason}` : '\nPlease upload a clear photo of the front of your ID card.'}
          </Text>
        </View>
      )}
      {!isPending && (
        <View style={styles.reward}>
          <Sparkles size={16} color={CampusColors.warm} />
          <Text style={[T.body, { flex: 1 }]}>
            Verify once to earn <Text style={{ fontWeight: '800' }}>150 Campus points</Text>, post Whispers and show the verified badge.
          </Text>
        </View>
      )}

      <Text style={[T.kicker, { marginTop: S.lg, marginBottom: S.sm }]}>
        {isPending ? 'Want it faster?' : 'Choose how to verify'}
      </Text>

      <TouchableOpacity
        style={[styles.option, !emailEnabled && styles.optionDisabled]}
        activeOpacity={0.8}
        onPress={() => {
          setError(null);
          if (emailEnabled) setStep('email');
        }}
        disabled={!emailEnabled}
      >
        <View style={[styles.optionIcon, { backgroundColor: CampusColors.accentSoft }]}>
          <Mail size={20} color={CampusColors.accentDeep} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={T.h3}>Verify with college email</Text>
          <Text style={T.muted}>
            {emailEnabled
              ? `Instant. We email a 6-digit code${domains.length ? ` to your @${domains[0]} address` : ''}.`
              : "Not available right now. Use your ID card below; it's reviewed by our team."}
          </Text>
        </View>
        {emailEnabled && <ChevronRight size={18} color={CampusColors.muted} />}
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.option}
        activeOpacity={0.8}
        onPress={() => {
          setError(null);
          setStep('id_card');
        }}
      >
        <View style={[styles.optionIcon, { backgroundColor: CampusColors.warmSoft }]}>
          <Camera size={20} color={CampusColors.warmDeep} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={T.h3}>{isPending ? 'Replace my ID card photo' : 'Upload college ID card'}</Text>
          <Text style={T.muted}>A clear photo of the front side. Only our review team can see it.</Text>
        </View>
        <ChevronRight size={18} color={CampusColors.muted} />
      </TouchableOpacity>
    </View>
  );

  const backRow = (to: Step) => (
    <TouchableOpacity
      onPress={() => {
        setError(null);
        setStep(to);
      }}
      style={styles.backRow}
      hitSlop={8}
    >
      <ChevronLeft size={16} color={CampusColors.accent} />
      <Text style={{ color: CampusColors.accent, fontWeight: '700', fontSize: 13 }}>All options</Text>
    </TouchableOpacity>
  );

  const renderEmail = () => (
    <View>
      {backRow('choose')}
      <Text style={T.body}>Enter your official college email. We'll send a 6-digit code to it.</Text>
      <Text style={ui.label}>College email</Text>
      <TextInput
        style={ui.input}
        placeholder={domains[0] ? `rollnumber@${domains[0]}` : 'you@college.edu.in'}
        placeholderTextColor={CampusColors.muted}
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        textContentType="emailAddress"
        returnKeyType="send"
        onSubmitEditing={() => handleSendOtp()}
        editable={!busy}
      />
      {domains.length > 0 && <Text style={[T.small, { marginTop: 6 }]}>Accepted: {domains.map((d) => '@' + d).join(', ')}</Text>}
      <Button label={busy ? busyLabel : 'Send code'} onPress={() => handleSendOtp()} loading={busy} style={{ marginTop: S.xl }} />
    </View>
  );

  const renderOtp = () => (
    <View>
      {backRow('email')}
      <Text style={T.body}>
        Enter the 6-digit code we sent to <Text style={{ fontWeight: '800' }}>{sentTo}</Text>. Check your spam folder if you
        don't see it. The code works for 10 minutes.
      </Text>
      <TextInput
        style={[ui.input, styles.otpInput]}
        placeholder="••••••"
        placeholderTextColor={CampusColors.muted}
        value={otp}
        onChangeText={(t) => setOtp(t.replace(/\D/g, '').slice(0, 6))}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="one-time-code"
        maxLength={6}
        autoFocus
        editable={!busy}
        onSubmitEditing={handleVerifyOtp}
      />
      <Button label={busy ? busyLabel : 'Verify'} onPress={handleVerifyOtp} loading={busy} disabled={otp.length !== 6} style={{ marginTop: S.lg }} />
      <TouchableOpacity
        style={{ alignSelf: 'center', marginTop: S.lg, padding: S.sm }}
        disabled={cooldown > 0 || busy}
        onPress={() => {
          setEmail(sentTo);
          handleSendOtp(sentTo);
        }}
      >
        <Text style={{ fontSize: 14, fontWeight: '700', color: cooldown > 0 ? CampusColors.muted : CampusColors.accent }}>
          {cooldown > 0 ? `Resend code in ${cooldown}s` : 'Resend code'}
        </Text>
      </TouchableOpacity>
    </View>
  );

  const renderIdCard = () => (
    <View>
      {backRow('choose')}
      <Text style={T.body}>Take or choose a clear photo of the front of your college ID (name, photo and roll number visible).</Text>

      {campuses.length > 1 && (
        <>
          <Text style={ui.label}>Your campus</Text>
          <View style={styles.chips}>
            {campuses.map((c) => {
              const active = c.id === campusId;
              return (
                <TouchableOpacity
                  key={c.id}
                  style={[styles.chip, active && styles.chipActive]}
                  onPress={() => setCampusId(c.id)}
                  disabled={busy}
                >
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>{c.code || c.name}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </>
      )}

      <Text style={ui.label}>Roll number (optional)</Text>
      <TextInput
        style={ui.input}
        value={collegeId}
        onChangeText={setCollegeId}
        placeholder="e.g. AP21110010123"
        placeholderTextColor={CampusColors.muted}
        autoCapitalize="characters"
        maxLength={50}
        editable={!busy}
      />

      {asset ? (
        <View style={styles.preview}>
          <Image source={{ uri: asset.uri }} style={styles.previewImg} contentFit="cover" />
          <TouchableOpacity style={styles.changeBtn} onPress={() => pickId('library')} disabled={busy}>
            <Text style={styles.changeText}>Change photo</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.pickRow}>
          <TouchableOpacity style={styles.pickCard} onPress={() => pickId('camera')} activeOpacity={0.8}>
            <Camera size={26} color={CampusColors.accent} />
            <Text style={[T.h3, { marginTop: 6 }]}>Take photo</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.pickCard} onPress={() => pickId('library')} activeOpacity={0.8}>
            <ImageIcon size={26} color={CampusColors.accent} />
            <Text style={[T.h3, { marginTop: 6 }]}>From gallery</Text>
          </TouchableOpacity>
        </View>
      )}

      <Button
        label={busy ? busyLabel : isPending ? 'Replace and resubmit' : 'Submit for review'}
        onPress={handleSubmitId}
        loading={busy}
        disabled={!asset}
        style={{ marginTop: S.xl }}
      />
      {busy && <Text style={[T.small, { textAlign: 'center', marginTop: S.sm }]}>{busyLabel}</Text>}
    </View>
  );

  let body: React.ReactNode;
  if (statusLoading && !status) {
    body = (
      <View style={[styles.center, { paddingVertical: 48 }]}>
        <ActivityIndicator color={CampusColors.accent} />
        <Text style={[T.muted, { marginTop: S.md }]}>Checking your status…</Text>
      </View>
    );
  } else if (statusError && !status) {
    body = <ErrorState message={statusError} onRetry={loadStatus} />;
  } else if (verificationStatus === 'verified' || step === 'done') {
    body = renderVerified();
  } else {
    body = (
      <>
        {error && (
          <View style={ui.errorBox}>
            <AlertCircle size={16} color="#A3321A" />
            <Text style={ui.errorText}>{error}</Text>
          </View>
        )}
        {step === 'choose' && renderChoose()}
        {step === 'email' && renderEmail()}
        {step === 'otp' && renderOtp()}
        {step === 'id_card' && renderIdCard()}
      </>
    );
  }

  return (
    <Sheet
      visible={visible}
      onClose={() => {
        if (busy) return;
        onClose();
      }}
      title="College verification"
      icon={<ShieldCheck size={20} color={CampusColors.accent} />}
    >
      {body}
    </Sheet>
  );
};

const styles = StyleSheet.create({
  center: { alignItems: 'center', paddingVertical: S.xl },
  statusCard: { flexDirection: 'row', gap: S.md, padding: S.lg, borderRadius: R.md, alignItems: 'flex-start' },
  reward: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: S.sm,
    backgroundColor: CampusColors.warmSoft,
    padding: S.md,
    borderRadius: R.md,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: S.md,
    padding: S.lg,
    borderRadius: R.card,
    borderWidth: 1,
    borderColor: CampusColors.line,
    backgroundColor: CampusColors.card,
    marginBottom: S.md,
  },
  optionDisabled: { opacity: 0.6, backgroundColor: CampusColors.paper },
  optionIcon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  backRow: { flexDirection: 'row', alignItems: 'center', gap: 2, marginBottom: S.md, alignSelf: 'flex-start' },
  otpInput: { marginTop: S.lg, height: 56, fontSize: 26, fontWeight: '800', letterSpacing: 10, textAlign: 'center' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: S.sm },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: R.pill,
    borderWidth: 1,
    borderColor: CampusColors.chipBorder,
    backgroundColor: CampusColors.card,
  },
  chipActive: { backgroundColor: CampusColors.ink, borderColor: CampusColors.ink },
  chipText: { fontSize: 13, fontWeight: '600', color: CampusColors.ink },
  chipTextActive: { color: '#FFFFFF', fontWeight: '800' },
  pickRow: { flexDirection: 'row', gap: S.md, marginTop: S.lg },
  pickCard: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: S.xl,
    borderRadius: R.card,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: CampusColors.chipBorder,
    backgroundColor: CampusColors.paper,
  },
  preview: { marginTop: S.lg, borderRadius: R.card, overflow: 'hidden', backgroundColor: CampusColors.placeholderFill },
  previewImg: { width: '100%', height: 200 },
  changeBtn: {
    position: 'absolute',
    right: S.sm,
    bottom: S.sm,
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: R.pill,
  },
  changeText: { color: '#FFFFFF', fontWeight: '700', fontSize: 12 },
});
