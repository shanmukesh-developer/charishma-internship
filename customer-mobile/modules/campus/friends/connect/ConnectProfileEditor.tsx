import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator, Alert, StyleSheet, Platform, ActionSheetIOS } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Plus, X, ImagePlus, EyeOff, Info } from '../../../../components/lucide';
import { FriendsColors, FS, FT, FR, fui } from '../friendsTheme';
import { pickAndUploadImage, alertUploadError, UploadedImage } from '../../../../utils/imageUpload';
import {
  ConnectLookingFor,
  ConnectMyPhoto,
  ConnectMyProfile,
  ConnectProfilePatch,
  ConnectStatus,
  CONNECT_LOOKING_FOR,
  addConnectPhoto,
  deleteConnectPhoto,
  updateConnectProfile,
} from '../api/connectApi';
import { ConnectChip, ConnectPhotoView, Notice, SectionTitle, StatusPill, ToggleRow } from './ConnectUi';
import { LOOKING_FOR_META, YEARS, connectErrorMessage, lookingForLabel, yearLabel } from './connectShared';

const mediaIdOf = (img: UploadedImage): string | null => {
  if (img.id) return img.id;
  const m = /\/api\/campus\/media\/([0-9a-f-]{36})/i.exec(img.url || '');
  return m ? m[1] : null;
};

const sameList = (a: readonly any[], b: readonly any[]) => a.length === b.length && a.every((x, i) => x === b[i]);

export interface ProfileDraft {
  displayName: string;
  bio: string;
  interests: string[];
  lookingFor: ConnectLookingFor[];
  showYear: boolean;
  showBranch: boolean;
  hiddenBranches: string[];
  hiddenYears: number[];
}

const draftOf = (p: ConnectMyProfile | null): ProfileDraft => ({
  displayName: p?.displayName || '',
  bio: p?.bio || '',
  interests: p?.interests || [],
  lookingFor: p?.lookingFor || [],
  showYear: p ? p.showYear : true,
  showBranch: p ? p.showBranch : true,
  hiddenBranches: p?.hiddenBranches || [],
  hiddenYears: p?.hiddenYears || [],
});

/** Only the changed fields (the server rejects unknown ones and re-checks everything). */
export const diffDraft = (p: ConnectMyProfile | null, d: ProfileDraft): ConnectProfilePatch => {
  const base = draftOf(p);
  const out: ConnectProfilePatch = {};
  if (d.displayName.trim() !== base.displayName) out.displayName = d.displayName.trim();
  if (d.bio.trim() !== base.bio.trim()) out.bio = d.bio.trim() || null;
  if (!sameList(d.interests, base.interests)) out.interests = d.interests;
  if (!sameList(d.lookingFor, base.lookingFor)) out.lookingFor = d.lookingFor;
  if (d.showYear !== base.showYear) out.showYear = d.showYear;
  if (d.showBranch !== base.showBranch) out.showBranch = d.showBranch;
  if (!sameList(d.hiddenBranches, base.hiddenBranches)) out.hiddenBranches = d.hiddenBranches;
  if (!sameList([...d.hiddenYears].sort(), [...base.hiddenYears].sort())) out.hiddenYears = d.hiddenYears;
  return out;
};

const PHOTO_STATUS: Record<ConnectMyPhoto['status'], { label: string; tone: 'warn' | 'success' | 'danger' }> = {
  pending: { label: 'In review', tone: 'warn' },
  approved: { label: 'Live', tone: 'success' },
  rejected: { label: 'Not approved', tone: 'danger' },
};

/** Six private photo slots. Changes go to the server right away; every photo is checked by a moderator. */
export const PhotoGrid: React.FC<{
  profile: ConnectMyProfile;
  max: number;
  onProfile: (p: ConnectMyProfile) => void;
}> = ({ profile, max, onProfile }) => {
  const [busySlot, setBusySlot] = useState<number | null>(null);
  const byPos = useMemo(() => new Map(profile.photos.map((p) => [p.position, p])), [profile.photos]);

  const upload = async (position: number) => {
    if (busySlot !== null) return;
    setBusySlot(position);
    try {
      const img = await pickAndUploadImage('connect', { allowsEditing: true, aspect: [4, 5] });
      if (!img) return;
      const mediaId = mediaIdOf(img);
      if (!mediaId) throw new Error("Couldn't upload the photo. Please try again.");
      const r = await addConnectPhoto(mediaId, position);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      onProfile(r.profile);
    } catch (e: any) {
      if (e && typeof e.status === 'number') Alert.alert("Couldn't add the photo", connectErrorMessage(e));
      else alertUploadError(e, () => upload(position));
    } finally {
      setBusySlot(null);
    }
  };

  const remove = (photo: ConnectMyPhoto) => {
    Alert.alert('Remove this photo?', 'It is deleted from ZCS straight away.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          setBusySlot(photo.position);
          try {
            await deleteConnectPhoto(photo.id);
            onProfile({ ...profile, photos: profile.photos.filter((p) => p.id !== photo.id) });
          } catch (e: any) {
            Alert.alert("Couldn't remove the photo", connectErrorMessage(e));
          } finally {
            setBusySlot(null);
          }
        },
      },
    ]);
  };

  const manage = (photo: ConnectMyPhoto) => {
    const options = ['Replace photo', 'Remove photo', 'Cancel'];
    const handle = (i: number) => {
      if (i === 0) upload(photo.position);
      else if (i === 1) remove(photo);
    };
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions({ options, destructiveButtonIndex: 1, cancelButtonIndex: 2 }, handle);
    } else {
      Alert.alert('Photo', photo.status === 'rejected' && photo.rejectReason ? `Not approved: ${photo.rejectReason}` : undefined, [
        { text: 'Replace', onPress: () => handle(0) },
        { text: 'Remove', style: 'destructive', onPress: () => handle(1) },
        { text: 'Cancel', style: 'cancel' },
      ]);
    }
  };

  return (
    <View style={styles.grid}>
      {Array.from({ length: max }, (_, pos) => {
        const photo = byPos.get(pos);
        const busy = busySlot === pos;
        const meta = photo ? PHOTO_STATUS[photo.status] : null;
        return (
          <TouchableOpacity
            key={pos}
            style={[styles.slot, pos === 0 && styles.slotMain]}
            onPress={() => (photo ? manage(photo) : upload(pos))}
            disabled={busySlot !== null}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel={
              photo
                ? `Photo ${pos + 1}, ${meta?.label}${photo.status === 'rejected' && photo.rejectReason ? `: ${photo.rejectReason}` : ''}. Double tap to replace or remove.`
                : `Add photo ${pos + 1}${pos === 0 ? ', your main photo' : ''}`
            }
          >
            {photo ? (
              <>
                <ConnectPhotoView photo={photo} style={StyleSheet.absoluteFill} radius={FR.md} label={`Your photo ${pos + 1}`} />
                <View style={styles.slotBadge}>
                  <StatusPill label={meta!.label} tone={meta!.tone} />
                </View>
              </>
            ) : (
              <View style={styles.slotEmpty}>
                <ImagePlus size={pos === 0 ? 24 : 18} color={FriendsColors.faint} />
                {pos === 0 ? <Text style={FT.small}>Main photo</Text> : null}
              </View>
            )}
            {busy ? (
              <View style={styles.slotBusy}>
                <ActivityIndicator color={FriendsColors.accent} />
              </View>
            ) : null}
          </TouchableOpacity>
        );
      })}
    </View>
  );
};

/**
 * Connect profile: photos (immediate), and the text + privacy fields (saved together).
 * `mode='setup'` is the onboarding step; `mode='edit'` is the Profile tab.
 */
export const ConnectProfileEditor: React.FC<{
  status: ConnectStatus;
  profile: ConnectMyProfile;
  mode: 'setup' | 'edit';
  onProfile: (p: ConnectMyProfile) => void;
  /** After a successful save (setup: continue to the next step). */
  onSaved?: (p: ConnectMyProfile, info: { underReview: boolean }) => void;
  header?: React.ReactNode;
  footer?: React.ReactNode;
}> = ({ status, profile, mode, onProfile, onSaved, header, footer }) => {
  const [draft, setDraft] = useState<ProfileDraft>(() => draftOf(profile));
  const [interest, setInterest] = useState('');
  const [branch, setBranch] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const limits = status.limits;

  // A fresh profile from the server (another screen saved) replaces the draft only when nothing is pending.
  const patch = diffDraft(profile, draft);
  const dirty = Object.keys(patch).length > 0;
  useEffect(() => {
    if (!dirty) setDraft(draftOf(profile));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile]);

  const set = <K extends keyof ProfileDraft>(k: K, v: ProfileDraft[K]) => setDraft((d) => ({ ...d, [k]: v }));

  const addInterest = () => {
    const v = interest.trim().replace(/\s+/g, ' ');
    if (v.length < 2) return;
    if (draft.interests.length >= limits.interestsMax) {
      setError(`You can add up to ${limits.interestsMax} interests.`);
      return;
    }
    if (!draft.interests.some((x) => x.toLowerCase() === v.toLowerCase())) set('interests', [...draft.interests, v.slice(0, 30)]);
    setInterest('');
    setError(null);
  };

  const addBranch = () => {
    const v = branch.trim().toUpperCase();
    if (!v) return;
    if (draft.hiddenBranches.length >= limits.hiddenBranchesMax) {
      setError(`You can hide up to ${limits.hiddenBranchesMax} branches.`);
      return;
    }
    if (!draft.hiddenBranches.includes(v)) set('hiddenBranches', [...draft.hiddenBranches, v.slice(0, 50)]);
    setBranch('');
    setError(null);
  };

  const missing =
    draft.displayName.trim().length < 2 ? 'Add the first name you want to show.' : !draft.lookingFor.length ? 'Choose what you are looking for.' : null;

  const save = async () => {
    if (busy) return;
    if (mode === 'setup' && missing) {
      setError(missing);
      return;
    }
    if (mode === 'setup' && !profile.photos.length) {
      setError('Add at least one photo. A moderator compares it with your selfie check.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (!dirty) {
        onSaved?.(profile, { underReview: profile.underReview });
        return;
      }
      const r = await updateConnectProfile(patch);
      onProfile(r.profile);
      setDraft(draftOf(r.profile));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      onSaved?.(r.profile, { underReview: r.underReview });
      if (mode === 'edit' && r.underReview) {
        Alert.alert('Saved, waiting for a quick check', "Part of your profile needs a moderator's look. You're hidden from discovery until then.");
      }
    } catch (e: any) {
      setError(connectErrorMessage(e, "Couldn't save your profile."));
    } finally {
      setBusy(false);
    }
  };

  const shown = [draft.showYear && profile.year ? yearLabel(profile.year) : null, draft.showBranch && profile.branch ? profile.branch : null].filter(Boolean).join(' · ');

  return (
    <View>
      {header}
      {profile.underReview ? (
        <Notice tone="warn" icon={<Info size={14} color={FriendsColors.warn} />} text="Your profile text is waiting for a moderator. You're hidden from discovery until it's checked." style={{ marginBottom: FS.md }} />
      ) : null}

      <SectionTitle title="Photos" hint={`Up to ${limits.photosMax}. Private, and shown to others only after a moderator approves them.`} />
      <PhotoGrid profile={profile} max={limits.photosMax} onProfile={onProfile} />

      <SectionTitle title="About you" />
      <View style={fui.cardPad}>
        <Text style={FT.h3}>Name on Connect</Text>
        <Text style={FT.small}>First name only. Letters, spaces and hyphens.</Text>
        <TextInput
          style={[fui.input, { marginTop: FS.sm }]}
          value={draft.displayName}
          onChangeText={(t) => set('displayName', t.slice(0, limits.displayNameMax))}
          placeholder="Your first name"
          placeholderTextColor={FriendsColors.faint}
          autoCapitalize="words"
          maxLength={limits.displayNameMax}
          accessibilityLabel="Name on Connect"
        />
        <View style={styles.labelRow}>
          <Text style={FT.h3}>Bio</Text>
          <Text style={[FT.small, draft.bio.length > limits.bioMax - 20 && { color: FriendsColors.warn }]}>
            {draft.bio.length}/{limits.bioMax}
          </Text>
        </View>
        <TextInput
          style={[fui.input, { minHeight: 90, textAlignVertical: 'top', marginTop: FS.sm }]}
          value={draft.bio}
          onChangeText={(t) => set('bio', t.slice(0, limits.bioMax))}
          placeholder="A few lines about you. No phone numbers, handles or links."
          placeholderTextColor={FriendsColors.faint}
          multiline
          maxLength={limits.bioMax}
          accessibilityLabel={`Bio, ${draft.bio.length} of ${limits.bioMax} characters`}
        />
      </View>

      <SectionTitle title="Looking for" hint="Pick one or more. You can change it any time." />
      <View style={styles.wrap}>
        {CONNECT_LOOKING_FOR.map((k) => {
          const on = draft.lookingFor.includes(k);
          const Icon = LOOKING_FOR_META[k].icon;
          return (
            <ConnectChip
              key={k}
              label={lookingForLabel(k, status)}
              selected={on}
              icon={<Icon size={13} color={FriendsColors.muted} />}
              onPress={() => set('lookingFor', on ? draft.lookingFor.filter((x) => x !== k) : [...draft.lookingFor, k])}
            />
          );
        })}
      </View>

      <SectionTitle title="Interests" hint={`${draft.interests.length}/${limits.interestsMax}`} />
      <View style={styles.addRow}>
        <TextInput
          style={[fui.input, { flex: 1 }]}
          value={interest}
          onChangeText={(t) => setInterest(t.slice(0, 30))}
          placeholder="Music, football, chai, startups…"
          placeholderTextColor={FriendsColors.faint}
          returnKeyType="done"
          onSubmitEditing={addInterest}
          accessibilityLabel="Add an interest"
        />
        <TouchableOpacity style={styles.addBtn} onPress={addInterest} disabled={interest.trim().length < 2} accessibilityRole="button" accessibilityLabel="Add interest">
          <Plus size={20} color={FriendsColors.accentInk} />
        </TouchableOpacity>
      </View>
      {draft.interests.length ? (
        <View style={[styles.wrap, { marginTop: FS.sm }]}>
          {draft.interests.map((x) => (
            <RemovableChip key={x} label={x} onRemove={() => set('interests', draft.interests.filter((y) => y !== x))} />
          ))}
        </View>
      ) : null}

      <SectionTitle title="What others see" hint="From your verified campus profile." />
      <View style={fui.card}>
        <ToggleRow label="Show my year" hint={profile.year ? yearLabel(profile.year) : 'Not set on your campus profile'} value={draft.showYear} onChange={(v) => set('showYear', v)} />
        <ToggleRow label="Show my branch" hint={profile.branch || 'Not set on your campus profile'} value={draft.showBranch} onChange={(v) => set('showBranch', v)} last />
      </View>
      <Text style={[FT.small, { marginTop: FS.sm }]}>
        {profile.age !== null ? `Shown: ${draft.displayName.trim() || 'You'}, ${profile.age}${shown ? ` · ${shown}` : ''}. ` : ''}
        Year and branch filters only find people who show them.
      </Text>

      <SectionTitle title="Hide from" hint="People in these years or branches won't see you, and you won't see them." />
      <View style={styles.wrap}>
        {YEARS.map((y) => {
          const on = draft.hiddenYears.includes(y);
          return (
            <ConnectChip
              key={y}
              label={yearLabel(y)}
              selected={on}
              icon={<EyeOff size={12} color={FriendsColors.muted} />}
              onPress={() => set('hiddenYears', on ? draft.hiddenYears.filter((x) => x !== y) : [...draft.hiddenYears, y])}
              a11yHint="Hide from this year"
            />
          );
        })}
      </View>
      <View style={[styles.addRow, { marginTop: FS.md }]}>
        <TextInput
          style={[fui.input, { flex: 1 }]}
          value={branch}
          onChangeText={(t) => setBranch(t.slice(0, 50))}
          placeholder="Hide a branch, e.g. CSE"
          placeholderTextColor={FriendsColors.faint}
          autoCapitalize="characters"
          returnKeyType="done"
          onSubmitEditing={addBranch}
          accessibilityLabel="Branch to hide from"
        />
        <TouchableOpacity style={styles.addBtn} onPress={addBranch} disabled={!branch.trim()} accessibilityRole="button" accessibilityLabel="Hide this branch">
          <Plus size={20} color={FriendsColors.accentInk} />
        </TouchableOpacity>
      </View>
      {draft.hiddenBranches.length ? (
        <View style={[styles.wrap, { marginTop: FS.sm }]}>
          {draft.hiddenBranches.map((x) => (
            <RemovableChip key={x} label={x} onRemove={() => set('hiddenBranches', draft.hiddenBranches.filter((y) => y !== x))} />
          ))}
        </View>
      ) : null}

      {error ? (
        <Text style={styles.error} accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
      <TouchableOpacity
        style={[fui.primaryBtn, { marginTop: FS.xl }, (busy || (mode === 'edit' && !dirty)) && { opacity: 0.55 }]}
        onPress={save}
        disabled={busy || (mode === 'edit' && !dirty)}
        accessibilityRole="button"
        accessibilityLabel={mode === 'setup' ? 'Save and continue' : 'Save changes'}
        accessibilityState={{ disabled: busy || (mode === 'edit' && !dirty), busy }}
      >
        {busy ? <ActivityIndicator color={FriendsColors.accentInk} /> : null}
        <Text style={fui.primaryBtnText}>{mode === 'setup' ? 'Save and continue' : dirty ? 'Save changes' : 'All changes saved'}</Text>
      </TouchableOpacity>
      {footer}
    </View>
  );
};

const RemovableChip: React.FC<{ label: string; onRemove: () => void }> = ({ label, onRemove }) => (
  <TouchableOpacity style={[fui.pill, { paddingRight: 10 }]} onPress={onRemove} accessibilityRole="button" accessibilityLabel={`Remove ${label}`}>
    <Text style={[fui.pillText, { color: FriendsColors.ink }]}>{label}</Text>
    <X size={13} color={FriendsColors.muted} />
  </TouchableOpacity>
);

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: FS.sm },
  slot: { width: '31.5%', aspectRatio: 4 / 5, borderRadius: FR.md, overflow: 'hidden', backgroundColor: FriendsColors.card, borderWidth: 1, borderColor: FriendsColors.line, borderStyle: 'dashed' },
  slotMain: { borderColor: 'rgba(212,175,122,0.45)' },
  slotEmpty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 4 },
  slotBadge: { position: 'absolute', left: 6, bottom: 6 },
  slotBusy: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(14,13,18,0.6)', alignItems: 'center', justifyContent: 'center' },
  labelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: FS.lg },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: FS.sm },
  addRow: { flexDirection: 'row', gap: FS.sm, alignItems: 'center' },
  addBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: FriendsColors.accent, alignItems: 'center', justifyContent: 'center' },
  error: { marginTop: FS.md, fontSize: 13, fontWeight: '600', color: FriendsColors.danger },
});
