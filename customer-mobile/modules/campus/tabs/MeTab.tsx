import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Alert, RefreshControl } from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import {
  ShieldCheck,
  AlertCircle,
  Clock,
  Sparkles,
  Award,
  Edit3,
  Camera,
  Users,
  ChevronRight,
  Copy,
  Settings,
  Bell,
  School,
  Lock,
} from '../../../components/lucide';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { CampusColors } from '../../../constants/campusTheme';
import { CampusProfileData, CampusUserData, CampusRole, CampusItem } from '../../../types/campus';
import { updateCampusProfile, CampusLastVerification } from '../campusApi';
import { apiFetch } from '../../../utils/auth';
import { pickAndUploadImage, alertUploadError } from '../../../utils/imageUpload';
import { useAuth } from '../../../context/AuthContext';
import { Avatar, Button, Sheet, SectionTitle, ListRow, T, S, R, ui } from '../ui';

const ROLE_INFO: Record<CampusRole, { name: string; desc: string }> = {
  student: { name: 'Student', desc: 'Campus access and chats' },
  cr: { name: 'Class Representative', desc: 'Can post classwork and announcements' },
  faculty: { name: 'Faculty', desc: 'Can manage classrooms, assignments and announcements' },
  club_admin: { name: 'Club Admin', desc: 'Can manage club groups and members' },
  moderator: { name: 'Moderator', desc: 'Helps keep campus spaces safe' },
  campus_admin: { name: 'Campus Admin', desc: 'Full campus administration' },
};

// Must match the DB column sizes (CampusProfile) so saves never fail on length.
const LIMITS = { collegeId: 50, branch: 50, section: 20, hostelBlock: 50, roomNumber: 50, bio: 250 };

interface MeTabProps {
  profile: CampusProfileData | null;
  user: CampusUserData | null;
  campuses: CampusItem[];
  lastVerification: CampusLastVerification | null;
  incomingRequests: number;
  onOpenVerify: () => void;
  onOpenFriends: () => void;
  /** Me › Friends privacy & safety (settings, notifications, muted / blocked, reports, appeals, guidelines). */
  onOpenFriendsSafety?: () => void;
  onProfileUpdated: (updated: CampusProfileData) => void;
  onUserUpdated: (patch: Partial<CampusUserData>) => void;
  onRefresh: () => Promise<void>;
}

export const MeTab: React.FC<MeTabProps> = ({
  profile,
  user,
  campuses,
  lastVerification,
  incomingRequests,
  onOpenVerify,
  onOpenFriends,
  onOpenFriendsSafety,
  onProfileUpdated,
  onUserUpdated,
  onRefresh,
}) => {
  const router = useRouter();
  const { setUser: setAuthUser, user: authUser } = useAuth();
  const status = profile?.verificationStatus || 'unverified';
  const isVerified = status === 'verified';
  // Verified students can set an empty roll number once; a saved one is locked (support can change it).
  const rollLocked = isVerified && !!String(profile?.collegeId || '').trim();
  const isPending = status === 'pending';
  const isRejected = status === 'rejected' || (lastVerification?.status === 'rejected' && !isVerified && !isPending);

  const [refreshing, setRefreshing] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ campusId: '', collegeId: '', branch: '', year: '', section: '', hostelBlock: '', roomNumber: '', bio: '' });

  const openEditor = () => {
    setForm({
      campusId: profile?.campusId || '',
      collegeId: profile?.collegeId || '',
      branch: profile?.branch || '',
      year: profile?.year ? String(profile.year) : '',
      section: profile?.section || '',
      hostelBlock: profile?.hostelBlock || '',
      roomNumber: profile?.roomNumber || '',
      bio: profile?.bio || '',
    });
    setEditOpen(true);
  };

  const save = async () => {
    if (saving) return;
    const yearNum = form.year.trim() ? Number(form.year) : null;
    if (yearNum !== null && (!Number.isInteger(yearNum) || yearNum < 1 || yearNum > 6)) {
      Alert.alert('Check your year', 'Year should be a number between 1 and 6.');
      return;
    }
    const changes: Record<string, any> = {};
    const diff = (key: keyof typeof form, prev?: string | null) => {
      if (form[key].trim() !== (prev || '').trim()) changes[key] = form[key].trim();
    };
    diff('collegeId', profile?.collegeId);
    diff('branch', profile?.branch);
    diff('section', profile?.section);
    diff('hostelBlock', profile?.hostelBlock);
    diff('roomNumber', profile?.roomNumber);
    diff('bio', profile?.bio);
    if (form.campusId && form.campusId !== (profile?.campusId || '')) changes.campusId = form.campusId;
    if (yearNum !== null && yearNum !== profile?.year) changes.year = yearNum;
    if (!Object.keys(changes).length) {
      setEditOpen(false);
      return;
    }
    setSaving(true);
    try {
      const updated = await updateCampusProfile(changes);
      if (updated) {
        const campus = campuses.find((c) => c.id === (updated.campusId || form.campusId)) || profile?.campus;
        onProfileUpdated({ ...(profile || ({} as CampusProfileData)), ...updated, campus: updated.campus || campus });
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setEditOpen(false);
      }
    } catch (e: any) {
      Alert.alert("Couldn't save", e?.message || 'Please try again in a moment.');
    } finally {
      setSaving(false);
    }
  };

  const changePhoto = async () => {
    if (photoBusy) return;
    try {
      setPhotoBusy(true);
      const up = await pickAndUploadImage('avatar', { allowsEditing: true, aspect: [1, 1], maxEdge: 640 });
      if (!up) return;
      const res = await apiFetch('/api/users/profile', { method: 'PUT', body: JSON.stringify({ profileImage: up.absoluteUrl }) });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.message || "Couldn't save your photo.");
      onUserUpdated({ profileImage: up.absoluteUrl });
      setAuthUser(data && typeof data === 'object' && data.id ? data : { ...(authUser || {}), profileImage: up.absoluteUrl });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: any) {
      alertUploadError(e, changePhoto, "Photo didn't update");
    } finally {
      setPhotoBusy(false);
    }
  };

  const copyCode = () => {
    if (!user?.friendCode) return;
    Clipboard.setString(user.friendCode);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    Alert.alert('Copied', 'Your friend code is copied.');
  };

  const roles: CampusRole[] = (Array.isArray(profile?.roles) && profile!.roles.length ? profile!.roles : ['student']).filter(
    (r): r is CampusRole => !!ROLE_INFO[r as CampusRole]
  );
  const classLine = [profile?.branch, profile?.year ? `Year ${profile.year}` : null, profile?.section ? `Sec ${profile.section}` : null]
    .filter(Boolean)
    .join(' • ');
  const campusName = profile?.campus?.name || campuses.find((c) => c.id === profile?.campusId)?.name || null;

  const verifyCard = (() => {
    if (isVerified) {
      return (
        <View style={[styles.verifyCard, { backgroundColor: CampusColors.accentSoft }]}>
          <ShieldCheck size={20} color={CampusColors.accentDeep} />
          <View style={{ flex: 1 }}>
            <Text style={[T.h3, { color: CampusColors.accentDeep }]}>Verified student</Text>
            <Text style={[T.small, { color: CampusColors.accentDeep }]}>{profile?.collegeEmail || campusName || 'Identity confirmed'}</Text>
          </View>
        </View>
      );
    }
    if (isPending) {
      return (
        <TouchableOpacity style={[styles.verifyCard, { backgroundColor: CampusColors.warmSoft }]} onPress={onOpenVerify} activeOpacity={0.85}>
          <Clock size={20} color={CampusColors.warmDeep} />
          <View style={{ flex: 1 }}>
            <Text style={[T.h3, { color: CampusColors.warmDeep }]}>ID card under review</Text>
            <Text style={[T.small, { color: CampusColors.warmDeep }]}>We'll notify you when it's approved. Tap to verify instantly by email.</Text>
          </View>
          <ChevronRight size={18} color={CampusColors.warmDeep} />
        </TouchableOpacity>
      );
    }
    return (
      <TouchableOpacity style={[styles.verifyCard, { backgroundColor: isRejected ? '#FDECEB' : CampusColors.card, borderWidth: isRejected ? 0 : 1 }]} onPress={onOpenVerify} activeOpacity={0.85}>
        <AlertCircle size={20} color={isRejected ? '#A3321A' : CampusColors.warm} />
        <View style={{ flex: 1 }}>
          <Text style={[T.h3, isRejected && { color: '#A3321A' }]}>{isRejected ? 'Verification not approved' : 'Verify you are a student'}</Text>
          <Text style={[T.small, isRejected && { color: '#A3321A' }]} numberOfLines={3}>
            {isRejected
              ? lastVerification?.reviewNotes
                ? `Reason: ${lastVerification.reviewNotes}. Tap to try again.`
                : 'Tap to try again with a clearer photo or your college email.'
              : 'College email or ID card. Earn +150 points and post Whispers.'}
          </Text>
        </View>
        <View style={styles.verifyCta}>
          <Text style={styles.verifyCtaText}>{isRejected ? 'Retry' : 'Verify'}</Text>
        </View>
      </TouchableOpacity>
    );
  })();

  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: CampusColors.paper }}
      contentContainerStyle={{ padding: S.lg, paddingBottom: 40 }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          tintColor={CampusColors.accent}
          onRefresh={async () => {
            setRefreshing(true);
            await onRefresh();
            setRefreshing(false);
          }}
        />
      }
    >
      {/* Profile */}
      <View style={styles.hero}>
        <TouchableOpacity onPress={changePhoto} activeOpacity={0.85} accessibilityLabel="Change profile photo">
          <Avatar name={user?.name} uri={user?.profileImage} size={72} bg={CampusColors.accent} />
          <View style={styles.camBadge}>
            <Camera size={12} color="#FFFFFF" />
          </View>
          {photoBusy && (
            <View style={styles.photoBusy}>
              <Text style={{ color: '#FFFFFF', fontSize: 12, fontWeight: '800' }}>Uploading…</Text>
            </View>
          )}
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text style={styles.name} numberOfLines={1}>{user?.name || 'Your name'}</Text>
            {isVerified && <ShieldCheck size={16} color={CampusColors.accentOnDark} />}
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
            <School size={12} color={CampusColors.inkMuted} />
            <Text style={styles.heroSub} numberOfLines={1}>{campusName || 'Campus not set'}</Text>
          </View>
          <Text style={[styles.heroSub, { color: CampusColors.accentOnDark, fontWeight: '700' }]} numberOfLines={1}>
            {classLine || 'Add your branch & year'}
          </Text>
        </View>
        <TouchableOpacity style={styles.editBtn} onPress={openEditor} accessibilityLabel="Edit campus profile">
          <Edit3 size={16} color="#FFFFFF" />
        </TouchableOpacity>
      </View>

      <View style={{ marginTop: S.md }}>{verifyCard}</View>

      {/* Friends */}
      <SectionTitle title="Friends" />
      <View style={ui.card}>
        <ListRow
          left={<View style={styles.rowIcon}><Users size={18} color={CampusColors.accentDeep} /></View>}
          title="Friends & requests"
          subtitle={incomingRequests > 0 ? `${incomingRequests} new request${incomingRequests === 1 ? '' : 's'}` : 'Your friends, requests and blocked people'}
          onPress={onOpenFriends}
          right={
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              {incomingRequests > 0 && (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{incomingRequests > 99 ? '99+' : incomingRequests}</Text>
                </View>
              )}
              <ChevronRight size={18} color={CampusColors.muted} />
            </View>
          }
        />
        <ListRow
          last={!onOpenFriendsSafety}
          left={<View style={styles.rowIcon}><Copy size={18} color={CampusColors.accentDeep} /></View>}
          title={user?.friendCode ? `Friend code: ${user.friendCode}` : 'Friend code'}
          subtitle={user?.friendCode ? 'Tap to copy and share with classmates' : 'Not available yet'}
          onPress={user?.friendCode ? copyCode : undefined}
        />
        {onOpenFriendsSafety ? (
          <ListRow
            last
            left={<View style={styles.rowIcon}><Lock size={18} color={CampusColors.accentDeep} /></View>}
            title="Friends privacy & safety"
            subtitle="Who sees you, notifications, muted and blocked people, reports and appeals"
            onPress={onOpenFriendsSafety}
            right={<ChevronRight size={18} color={CampusColors.muted} />}
          />
        ) : null}
      </View>

      {/* Details */}
      <SectionTitle title="Campus details" action="Edit" onAction={openEditor} />
      <View style={ui.cardPad}>
        {[
          ['Campus', campusName],
          ['Roll number', profile?.collegeId],
          ['Class', classLine],
          ['Hostel / room', [profile?.hostelBlock, profile?.roomNumber].filter(Boolean).join(' / ')],
          ['Bio', profile?.bio],
        ].map(([label, value], i) => (
          <View key={String(label)} style={[styles.detailRow, i === 4 && { borderBottomWidth: 0 }]}>
            <Text style={T.small}>{label}</Text>
            <Text style={[T.body, { flex: 1, textAlign: 'right', color: value ? CampusColors.ink : CampusColors.muted }]} numberOfLines={2}>
              {value || 'Not set'}
            </Text>
          </View>
        ))}
      </View>

      {/* Points */}
      <SectionTitle title="Buddy points" />
      <View style={[ui.cardPad, { flexDirection: 'row', alignItems: 'center', gap: S.md }]}>
        <Sparkles size={22} color={CampusColors.warm} />
        <View style={{ flex: 1 }}>
          <Text style={T.h2}>{profile?.buddyPoints ?? 0} pts</Text>
          <Text style={T.small}>
            {isVerified ? 'Earned from campus activity.' : 'Verify your student identity to earn +150 points.'}
          </Text>
        </View>
      </View>

      {roles.some((r) => r !== 'student') && (
        <>
          <SectionTitle title="Campus roles" />
          <View style={ui.card}>
            {roles.map((r, i) => (
              <ListRow
                key={r}
                last={i === roles.length - 1}
                left={<View style={styles.rowIcon}><Award size={18} color={CampusColors.accentDeep} /></View>}
                title={ROLE_INFO[r].name}
                subtitle={ROLE_INFO[r].desc}
              />
            ))}
          </View>
        </>
      )}

      <SectionTitle title="Settings" />
      <View style={ui.card}>
        <ListRow
          left={<View style={styles.rowIcon}><Bell size={18} color={CampusColors.accentDeep} /></View>}
          title="Notifications"
          subtitle="Requests, messages and verification updates"
          onPress={() => router.push('/notifications' as any)}
          right={<ChevronRight size={18} color={CampusColors.muted} />}
        />
        <ListRow
          last
          left={<View style={styles.rowIcon}><Settings size={18} color={CampusColors.accentDeep} /></View>}
          title="Account settings"
          subtitle="Name, phone, email and app settings"
          onPress={() => router.push('/(tabs)/profile' as any)}
          right={<ChevronRight size={18} color={CampusColors.muted} />}
        />
      </View>

      {/* Edit sheet */}
      <Sheet visible={editOpen} onClose={() => !saving && setEditOpen(false)} title="Edit campus profile" icon={<Edit3 size={18} color={CampusColors.accent} />}>
        {campuses.length > 0 && (
          <>
            <Text style={[ui.label, { marginTop: 0 }]}>Campus{isVerified ? ' (locked after verification)' : ''}</Text>
            <View style={styles.chips}>
              {campuses.map((c) => {
                const active = c.id === form.campusId;
                return (
                  <TouchableOpacity
                    key={c.id}
                    style={[styles.chip, active && styles.chipActive, isVerified && !active && { opacity: 0.4 }]}
                    disabled={isVerified}
                    onPress={() => set('campusId')(c.id)}
                  >
                    <Text style={[styles.chipText, active && styles.chipTextActive]}>{c.name}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </>
        )}
        <Text style={ui.label}>Roll number{isVerified && !rollLocked ? ' (can be set once)' : ''}</Text>
        <TextInput style={[ui.input, rollLocked && { opacity: 0.6 }]} value={form.collegeId} onChangeText={set('collegeId')} editable={!rollLocked} maxLength={LIMITS.collegeId} autoCapitalize="characters" placeholder="e.g. AP21110010123" placeholderTextColor={CampusColors.muted} />
        <View style={{ flexDirection: 'row', gap: S.sm }}>
          <View style={{ flex: 1 }}>
            <Text style={ui.label}>Branch</Text>
            <TextInput style={ui.input} value={form.branch} onChangeText={set('branch')} maxLength={LIMITS.branch} autoCapitalize="characters" placeholder="CSE" placeholderTextColor={CampusColors.muted} />
          </View>
          <View style={{ width: 72 }}>
            <Text style={ui.label}>Year</Text>
            <TextInput style={ui.input} value={form.year} onChangeText={(t) => set('year')(t.replace(/[^0-9]/g, ''))} maxLength={1} keyboardType="number-pad" placeholder="1-6" placeholderTextColor={CampusColors.muted} />
          </View>
          <View style={{ width: 72 }}>
            <Text style={ui.label}>Sec</Text>
            <TextInput style={ui.input} value={form.section} onChangeText={set('section')} maxLength={LIMITS.section} autoCapitalize="characters" placeholder="A" placeholderTextColor={CampusColors.muted} />
          </View>
        </View>
        <View style={{ flexDirection: 'row', gap: S.sm }}>
          <View style={{ flex: 1 }}>
            <Text style={ui.label}>Hostel block</Text>
            <TextInput style={ui.input} value={form.hostelBlock} onChangeText={set('hostelBlock')} maxLength={LIMITS.hostelBlock} placeholder="Block" placeholderTextColor={CampusColors.muted} />
          </View>
          <View style={{ width: 110 }}>
            <Text style={ui.label}>Room</Text>
            <TextInput style={ui.input} value={form.roomNumber} onChangeText={set('roomNumber')} maxLength={LIMITS.roomNumber} placeholder="Room" placeholderTextColor={CampusColors.muted} />
          </View>
        </View>
        <Text style={ui.label}>Bio</Text>
        <TextInput style={[ui.input, { height: 80, paddingTop: 12, textAlignVertical: 'top' }]} value={form.bio} onChangeText={set('bio')} maxLength={LIMITS.bio} multiline placeholder="Coffee, code and cricket" placeholderTextColor={CampusColors.muted} />
        <Text style={[T.small, { alignSelf: 'flex-end', marginTop: 4 }]}>{form.bio.length}/{LIMITS.bio}</Text>
        <Button label="Save" onPress={save} loading={saving} style={{ marginTop: S.lg }} />
      </Sheet>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  hero: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: S.lg,
    backgroundColor: CampusColors.inkCard,
    borderRadius: R.hero,
    padding: S.xl,
  },
  name: { fontSize: 19, fontWeight: '800', color: '#FFFFFF', flexShrink: 1 },
  heroSub: { fontSize: 12, color: CampusColors.inkMuted, marginTop: 2 },
  camBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: CampusColors.accent,
    borderWidth: 2,
    borderColor: CampusColors.inkCard,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoBusy: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 36,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  editBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' },
  verifyCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: S.md,
    padding: S.lg,
    borderRadius: R.card,
    borderColor: CampusColors.line,
  },
  verifyCta: { backgroundColor: CampusColors.accent, borderRadius: R.pill, paddingHorizontal: 14, paddingVertical: 8 },
  verifyCtaText: { color: '#FFFFFF', fontWeight: '800', fontSize: 13 },
  rowIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: CampusColors.accentSoft, alignItems: 'center', justifyContent: 'center' },
  badge: { minWidth: 22, height: 22, borderRadius: 11, backgroundColor: CampusColors.accent, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  badgeText: { color: '#FFFFFF', fontSize: 12, fontWeight: '800' },
  detailRow: { flexDirection: 'row', gap: S.lg, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: CampusColors.line, alignItems: 'center' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: S.sm },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: R.pill, borderWidth: 1, borderColor: CampusColors.chipBorder, backgroundColor: CampusColors.card },
  chipActive: { backgroundColor: CampusColors.ink, borderColor: CampusColors.ink },
  chipText: { fontSize: 13, fontWeight: '600', color: CampusColors.ink },
  chipTextActive: { color: '#FFFFFF', fontWeight: '800' },
});
