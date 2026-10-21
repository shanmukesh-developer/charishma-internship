import React, { useEffect, useState } from 'react';
import { View, Text, Linking, StyleSheet } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Camera, Clock, ScanFace, ShieldCheck, XCircle, Hourglass, RefreshCw } from '../../../../components/lucide';
import { FriendsColors, FS, FT, FR, fui } from '../friendsTheme';
import { errorCode } from '../api/core';
import { ConnectLiveness, startLiveness, submitLivenessSelfie } from '../api/connectApi';
import { pickAndUploadImage, alertUploadError } from '../../../../utils/imageUpload';
import { formatRelative } from '../shared/RelativeTime';
import { Checkbox } from './ConnectGate';
import { GhostButton, Notice, PrimaryButton } from './ConnectUi';
import { connectErrorMessage } from './connectShared';

const useCountdown = (iso: string | null) => {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!iso) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [iso]);
  if (!iso) return null;
  const left = Math.max(0, new Date(iso).getTime() - now);
  return { left, text: `${Math.floor(left / 60000)}:${String(Math.floor((left % 60000) / 1000)).padStart(2, '0')}` };
};

/**
 * Selfie check (free manual review by default): agree → random gesture prompt → fresh selfie within
 * 15 minutes → an admin compares it with the Connect photos → the selfie is deleted at the decision.
 */
export const LivenessPanel: React.FC<{
  liveness: ConnectLiveness;
  hasPhotos: boolean;
  onChanged: (l?: ConnectLiveness) => void;
  onAddPhotos?: () => void;
}> = ({ liveness, hasPhotos, onChanged, onAddPhotos }) => {
  const [consent, setConsent] = useState(false);
  const [challenge, setChallenge] = useState<{ text: string; expiresAt: string; instructions: string[] } | null>(
    liveness.challenge ? { text: liveness.challenge.text, expiresAt: liveness.challenge.expiresAt, instructions: [] } : null
  );
  const [busy, setBusy] = useState<'start' | 'upload' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const countdown = useCountdown(challenge?.expiresAt || null);
  const expired = !!countdown && countdown.left <= 0;

  useEffect(() => {
    if (liveness.challenge) setChallenge((c) => c || { text: liveness.challenge!.text, expiresAt: liveness.challenge!.expiresAt, instructions: [] });
  }, [liveness.challenge]);

  if (!liveness.required || liveness.status === 'passed') {
    return <Notice tone="success" icon={<ShieldCheck size={16} color={FriendsColors.success} />} title="Selfie check done" text="You're verified as a real person." />;
  }

  if (!liveness.configured) {
    return (
      <View style={styles.center}>
        <View style={styles.icon}>
          <Hourglass size={22} color={FriendsColors.warn} />
        </View>
        <Text style={[FT.h2, { textAlign: 'center' }]} accessibilityRole="header">
          Not available yet
        </Text>
        <Text style={[FT.muted, { textAlign: 'center' }]}>
          Connect needs a selfie check to keep fake profiles out, and it isn't switched on for your campus yet. Your profile is saved; we'll let you in as soon as it's ready.
        </Text>
        <GhostButton label="Check again" onPress={() => onChanged()} icon={<RefreshCw size={16} color={FriendsColors.ink} />} style={{ alignSelf: 'stretch', marginTop: FS.md }} />
      </View>
    );
  }

  if (liveness.status === 'pending') {
    return (
      <View style={styles.center}>
        <View style={styles.icon}>
          <Clock size={22} color={FriendsColors.accent} />
        </View>
        <Text style={[FT.h2, { textAlign: 'center' }]} accessibilityRole="header">
          Selfie in review
        </Text>
        <Text style={[FT.muted, { textAlign: 'center' }]}>
          A Zenvy moderator is comparing your selfie with your Connect photos{liveness.submittedAt ? ` (sent ${formatRelative(liveness.submittedAt)})` : ''}. You'll get a notification. The selfie is deleted as soon as they decide.
        </Text>
        <GhostButton label="Refresh" onPress={() => onChanged()} icon={<RefreshCw size={16} color={FriendsColors.ink} />} style={{ alignSelf: 'stretch', marginTop: FS.md }} />
      </View>
    );
  }

  const start = async () => {
    if (busy) return;
    setBusy('start');
    setError(null);
    try {
      const r = await startLiveness(consent);
      if (r.mode === 'provider' && r.sessionUrl) {
        await Linking.openURL(r.sessionUrl);
        return;
      }
      setChallenge({ text: r.challenge || '', expiresAt: r.expiresAt || new Date(Date.now() + 15 * 60000).toISOString(), instructions: r.instructions || [] });
      Haptics.selectionAsync().catch(() => {});
    } catch (e: any) {
      const code = errorCode(e);
      if (code === 'LIVENESS_CONSENT_REQUIRED') setError('Tick the box to agree to the selfie check first.');
      else if (['LIVENESS_PENDING', 'LIVENESS_ALREADY_PASSED', 'LIVENESS_NOT_REQUIRED', 'LIVENESS_NOT_CONFIGURED'].includes(code)) onChanged();
      else setError(connectErrorMessage(e, "Couldn't start the selfie check."));
    } finally {
      setBusy(null);
    }
  };

  const takeSelfie = async () => {
    if (busy || !challenge) return;
    setBusy('upload');
    setError(null);
    try {
      const img = await pickAndUploadImage('liveness_selfie', { source: 'camera', maxEdge: 1280 });
      if (!img) return;
      const mediaId = img.id || (/\/api\/campus\/media\/([0-9a-f-]{36})/i.exec(img.url || '') || [])[1];
      if (!mediaId) throw new Error("Couldn't upload the selfie. Please try again.");
      const r = await submitLivenessSelfie(mediaId);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setChallenge(null);
      onChanged(r.liveness);
    } catch (e: any) {
      const code = errorCode(e);
      if (code === 'LIVENESS_CHALLENGE_EXPIRED') {
        setChallenge(null);
        setError('That prompt expired. Start again to get a new one.');
      } else if (code === 'SELFIE_TOO_OLD') setError('Take a new selfie now, doing the gesture shown.');
      else if (code === 'LIVENESS_PENDING' || code === 'LIVENESS_ALREADY_PASSED') onChanged();
      else if (e && typeof e.status === 'number') setError(connectErrorMessage(e, "Couldn't send your selfie."));
      else alertUploadError(e, takeSelfie, "Selfie didn't upload");
    } finally {
      setBusy(null);
    }
  };

  if (challenge && !expired) {
    return (
      <View style={{ gap: FS.lg }}>
        <View style={styles.prompt} accessible accessibilityRole="alert" accessibilityLabel={`Your gesture: ${challenge.text}. Time left ${countdown?.text || ''}`}>
          <Text style={FT.kicker}>Your gesture</Text>
          <Text style={styles.promptText}>{challenge.text}</Text>
          <View style={styles.timer}>
            <Clock size={13} color={FriendsColors.muted} />
            <Text style={FT.small}>{countdown?.text} left</Text>
          </View>
        </View>
        <View style={{ gap: 6 }}>
          {(challenge.instructions.length
            ? challenge.instructions
            : ['Use the front camera now (not a gallery photo).', 'Face fully visible, good light, no filters, masks or sunglasses.', 'A moderator compares it with your Connect photos, then it is deleted.']
          ).map((t, i) => (
            <Text key={i} style={FT.small}>
              {i + 1}. {t}
            </Text>
          ))}
        </View>
        {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
        <PrimaryButton label="Take selfie" onPress={takeSelfie} busy={busy === 'upload'} icon={<Camera size={18} color={FriendsColors.accentInk} />} />
      </View>
    );
  }

  return (
    <View style={{ gap: FS.lg }}>
      <View style={styles.center}>
        <View style={styles.icon}>
          <ScanFace size={22} color={FriendsColors.accent} />
        </View>
        <Text style={[FT.h2, { textAlign: 'center' }]} accessibilityRole="header">
          Quick selfie check
        </Text>
        <Text style={[FT.muted, { textAlign: 'center' }]}>
          One selfie doing a random gesture shows you're a real person and match your photos. Only a Zenvy moderator sees it, and it's deleted once they decide.
        </Text>
      </View>
      {liveness.status === 'failed' ? (
        <Notice tone="danger" icon={<XCircle size={16} color={FriendsColors.danger} />} title="Last selfie wasn't approved" text={liveness.note || 'Please try again with your face clearly visible.'} />
      ) : null}
      {!hasPhotos ? (
        <Notice tone="warn" text="Add at least one Connect photo first. The moderator compares your selfie with it." actionLabel={onAddPhotos ? 'Add photos' : undefined} onAction={onAddPhotos} />
      ) : null}
      {expired ? <Notice tone="muted" text="Your last prompt expired. Start again for a new one." /> : null}
      <View style={fui.cardPad}>
        <Checkbox checked={consent} onToggle={() => setConsent((v) => !v)} label="I agree to a one-time selfie check. Zenvy keeps the selfie only until a moderator reviews it." />
      </View>
      {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
      <PrimaryButton label="Start selfie check" onPress={start} busy={busy === 'start'} disabled={!hasPhotos} a11yHint="Shows a gesture to do in your selfie" />
    </View>
  );
};

const styles = StyleSheet.create({
  center: { alignItems: 'center', gap: FS.sm, paddingVertical: FS.md },
  icon: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', backgroundColor: FriendsColors.accentSoft, marginBottom: 4 },
  prompt: { padding: FS.xl, borderRadius: FR.hero, backgroundColor: FriendsColors.card, borderWidth: 1, borderColor: 'rgba(212,175,122,0.4)', alignItems: 'center', gap: FS.sm },
  promptText: { fontSize: 20, lineHeight: 27, fontWeight: '800', color: FriendsColors.ink, textAlign: 'center' },
  timer: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  error: { fontSize: 13, fontWeight: '600', color: FriendsColors.danger },
});
