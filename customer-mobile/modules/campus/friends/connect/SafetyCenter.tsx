import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Alert, ActivityIndicator, StyleSheet } from 'react-native';
import * as Haptics from 'expo-haptics';
import { PauseCircle, PlayCircle, EyeOff, Ban, FileText, Download, Trash2, ChevronRight, ShieldCheck, LifeBuoy, MapPinOff } from '../../../../components/lucide';
import { FriendsScreenModal } from '../shared/FriendsSheet';
import { FriendsColors, FS, FT, FR, fui } from '../friendsTheme';
import { formatLocal } from '../shared/RelativeTime';
import { ConnectMyData, ConnectStatus, deleteConnectProfile, fetchConnectMyData, pauseConnect, resumeConnect } from '../api/connectApi';
import { HelplineRows } from './ConnectPolicyScreen';
import { StatusPill } from './ConnectUi';
import { connectErrorMessage } from './connectShared';

import { themedSheet } from '../../../../utils/themeNow';
/**
 * Connect safety & privacy: pause / resume, hide from branches or years, blocked people, helplines,
 * guidance, the privacy notice, a copy of my data, and deleting Connect completely.
 */
export const SafetyCenter: React.FC<{
  visible: boolean;
  onClose: () => void;
  status: ConnectStatus;
  onChanged: () => void;
  onDeleted: () => void;
  onOpenPolicy: () => void;
  onOpenFriendsSafety: () => void;
  onEditPrivacy: () => void;
}> = ({ visible, onClose, status, onChanged, onDeleted, onOpenPolicy, onOpenFriendsSafety, onEditPrivacy }) => {
  const [busy, setBusy] = useState<string | null>(null);
  const [data, setData] = useState<ConnectMyData | null>(null);
  const profile = status.profile;
  const paused = profile?.status === 'paused';
  const active = profile?.status === 'active';

  const run = async (key: string, fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(key);
    try {
      await fn();
    } catch (e: any) {
      Alert.alert("Couldn't do that", connectErrorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const togglePause = () =>
    run('pause', async () => {
      if (paused) await resumeConnect();
      else await pauseConnect();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      onChanged();
    });

  const loadData = () =>
    run('data', async () => {
      setData(await fetchConnectMyData());
    });

  const remove = () => {
    Alert.alert(
      'Delete Connect?',
      'This erases your Connect profile, photos, selfie, likes, matches and all Connect chats, for you and your matches. It cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Continue',
          style: 'destructive',
          onPress: () =>
            Alert.alert('Are you sure?', 'Everything in Connect will be permanently deleted.', [
              { text: 'Keep Connect', style: 'cancel' },
              {
                text: 'Delete everything',
                style: 'destructive',
                onPress: () =>
                  run('delete', async () => {
                    const r = await deleteConnectProfile();
                    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
                    const s = r.summary || {};
                    Alert.alert(
                      'Connect deleted',
                      [
                        `Removed: ${s.photos || 0} photo(s), ${s.swipes || 0} like/pass record(s), ${s.matches || 0} match(es), ${s.messages || 0} message(s).`,
                        ...(r.retained || []),
                      ].join('\n\n')
                    );
                    setData(null);
                    onDeleted();
                  }),
              },
            ]),
        },
      ]
    );
  };

  return (
    <FriendsScreenModal visible={visible} onClose={onClose} title="Connect safety & privacy">
      <ScrollView contentContainerStyle={{ padding: FS.lg, paddingBottom: 80, gap: FS.lg }}>
        {profile ? (
          <View style={fui.cardPad}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: FS.sm }}>
              <Text style={[FT.h3, { flex: 1 }]}>Your Connect</Text>
              <StatusPill label={paused ? 'Paused' : active ? 'Visible' : profile.status === 'setup' ? 'Not turned on' : profile.status} tone={paused ? 'warn' : active ? 'success' : 'muted'} />
            </View>
            <Text style={[FT.small, { marginTop: 4 }]}>
              {paused
                ? `Paused${profile.pausedAt ? ` since ${formatLocal(profile.pausedAt)}` : ''}. Nobody new sees you; your matches and chats stay.`
                : active
                  ? 'Students on your campus who use Connect can see your card.'
                  : 'Your profile is not in discovery yet.'}
            </Text>
            {paused || active ? (
              <TouchableOpacity style={[fui.ghostBtn, { marginTop: FS.md }]} onPress={togglePause} disabled={!!busy} accessibilityRole="button" accessibilityLabel={paused ? 'Resume Connect' : 'Pause Connect'}>
                {busy === 'pause' ? <ActivityIndicator size="small" color={FriendsColors.ink} /> : paused ? <PlayCircle size={16} color={FriendsColors.ink} /> : <PauseCircle size={16} color={FriendsColors.ink} />}
                <Text style={fui.ghostBtnText}>{paused ? 'Resume Connect' : 'Pause Connect'}</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ) : null}

        <View style={fui.card}>
          <Row icon={<EyeOff size={18} color={FriendsColors.accent} />} label="Hide from branches or years" hint="Choose who can't see you" onPress={onEditPrivacy} />
          <Row icon={<Ban size={18} color={FriendsColors.accent} />} label="Blocked people, reports & appeals" hint="Friends privacy & safety" onPress={onOpenFriendsSafety} />
          <Row icon={<FileText size={18} color={FriendsColors.accent} />} label="Connect privacy notice" hint={`Version ${status.policy.version}`} onPress={onOpenPolicy} last />
        </View>

        <View style={styles.noGps}>
          <MapPinOff size={16} color={FriendsColors.muted} />
          <Text style={[FT.small, { flex: 1 }]}>Connect never uses your location. Photos are private, checked by a moderator, and shown through links that expire within an hour.</Text>
        </View>

        {status.guidance.length ? (
          <View style={{ gap: FS.sm }}>
            <View style={styles.title}>
              <ShieldCheck size={16} color={FriendsColors.accent} />
              <Text style={FT.kicker} accessibilityRole="header">
                Meeting safely
              </Text>
            </View>
            {status.guidance.map((g, i) => (
              <View key={i} style={styles.bullet}>
                <View style={styles.dot} />
                <Text style={[FT.body, { flex: 1 }]}>{g}</Text>
              </View>
            ))}
          </View>
        ) : null}

        <View style={{ gap: FS.sm }}>
          <View style={styles.title}>
            <LifeBuoy size={16} color={FriendsColors.accent} />
            <Text style={FT.kicker} accessibilityRole="header">
              Helplines
            </Text>
          </View>
          <HelplineRows helplines={status.helplines} />
        </View>

        <View style={{ gap: FS.sm }}>
          <Text style={FT.kicker} accessibilityRole="header">
            Your data
          </Text>
          <TouchableOpacity style={fui.ghostBtn} onPress={loadData} disabled={!!busy} accessibilityRole="button" accessibilityLabel="See what Connect stores about me">
            {busy === 'data' ? <ActivityIndicator size="small" color={FriendsColors.ink} /> : <Download size={16} color={FriendsColors.ink} />}
            <Text style={fui.ghostBtnText}>See what Connect stores about me</Text>
          </TouchableOpacity>
          {data ? <MyDataCard data={data} /> : null}
          <TouchableOpacity style={[fui.ghostBtn, { borderColor: 'rgba(243,139,128,0.4)' }]} onPress={remove} disabled={!!busy} accessibilityRole="button" accessibilityLabel="Delete Connect and all my Connect data">
            {busy === 'delete' ? <ActivityIndicator size="small" color={FriendsColors.danger} /> : <Trash2 size={16} color={FriendsColors.danger} />}
            <Text style={[fui.ghostBtnText, { color: FriendsColors.danger }]}>Delete Connect</Text>
          </TouchableOpacity>
          <Text style={FT.small}>Deleting erases your Connect profile, photos, selfie, likes, matches and chats. A record that you consented and then withdrew, and short copies inside reports, are kept as required by law.</Text>
        </View>
      </ScrollView>
    </FriendsScreenModal>
  );
};

const Row: React.FC<{ icon: React.ReactNode; label: string; hint?: string; onPress: () => void; last?: boolean }> = ({ icon, label, hint, onPress, last }) => (
  <TouchableOpacity style={[fui.row, last && { borderBottomWidth: 0 }]} onPress={onPress} accessibilityRole="button" accessibilityLabel={hint ? `${label}. ${hint}` : label}>
    {icon}
    <View style={{ flex: 1 }}>
      <Text style={FT.h3}>{label}</Text>
      {hint ? <Text style={FT.small}>{hint}</Text> : null}
    </View>
    <ChevronRight size={18} color={FriendsColors.muted} />
  </TouchableOpacity>
);

const MyDataCard: React.FC<{ data: ConnectMyData }> = ({ data }) => {
  const p = data.profile || {};
  const lines: [string, string][] = [
    ['Profile', data.profile ? `${p.displayName || '—'} · ${p.status}` : 'None'],
    ['Bio', p.bio || '—'],
    ['Interests', (p.interests || []).join(', ') || '—'],
    ['Looking for', (p.lookingFor || []).join(', ') || '—'],
    ['Hidden branches', (p.hiddenBranches || []).join(', ') || '—'],
    ['Hidden years', (p.hiddenYears || []).join(', ') || '—'],
    ['Photos', `${data.photos.length} (${data.photos.filter((x) => x.status === 'approved').length} approved)`],
    ['Selfie stored', data.selfieStored ? 'Yes, until a moderator reviews it' : 'No'],
    ['Likes given / passes', `${data.swipes.likesGiven} / ${data.swipes.passesGiven}`],
    ['Likes received', String(data.swipes.likesReceived)],
    ['Matches', `${data.matches.filter((m) => m.status === 'active').length} active, ${data.matches.length} total`],
    ['Consents', data.consents.map((c) => `${c.kind.replace(/_/g, ' ')} v${c.version}${c.withdrawnAt ? ' (withdrawn)' : ''}`).join('; ') || '—'],
    ['Location', data.location],
  ];
  return (
    <View style={[fui.card, { padding: FS.md, gap: 8 }]} accessible accessibilityLabel={lines.map(([k, v]) => `${k}: ${v}`).join('. ')}>
      {lines.map(([k, v]) => (
        <View key={k} style={{ flexDirection: 'row', gap: FS.sm }}>
          <Text style={[FT.small, { width: 120 }]}>{k}</Text>
          <Text style={[FT.small, { flex: 1, color: FriendsColors.ink }]} selectable>
            {v}
          </Text>
        </View>
      ))}
    </View>
  );
};

const styles = themedSheet(() => ({
  noGps: { flexDirection: 'row', gap: FS.sm, padding: FS.md, borderRadius: FR.md, backgroundColor: FriendsColors.card, borderWidth: 1, borderColor: FriendsColors.lineSoft },
  title: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  bullet: { flexDirection: 'row', gap: FS.sm, alignItems: 'flex-start' },
  dot: { width: 5, height: 5, borderRadius: 3, backgroundColor: FriendsColors.accent, marginTop: 8 },
}));
