import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, TextInput, ActivityIndicator, Alert } from 'react-native';
import { Image } from 'expo-image';
import { Moon, Trophy, CalendarDays, Cake, Camera, ChevronRight, Utensils, MapPin, Heart, Plus, Send, Images } from '../../../../components/lucide';
import * as Haptics from 'expo-haptics';
import { ENDPOINTS } from '../../../../constants/api';
import { apiFetch } from '../../../../utils/auth';
import { pickImageAsset, prepareAndUploadImage, alertUploadError } from '../../../../utils/imageUpload';
import { fetchBranchWars, fetchDailyQuestion, fetchPulseToday, PulseBranchStanding, PulseToday } from '../../campusApi';
import { CommunityFeed } from '../../feed/CommunityFeed';
import { ScreenModal } from '../../ui';
import { FriendsColors, FS, FT, FR, fui } from '../friendsTheme';
import { FriendsSheet } from '../shared/FriendsSheet';
import { FriendsAvatar } from '../shared/FriendsAvatar';
import { SkeletonBlock } from '../shared/FriendsSkeleton';
import { formatRelative } from '../shared/RelativeTime';

import { themedSheet } from '../../../../utils/themeNow';
// ── Data ──────────────────────────────────────────────────────────────────────
interface Birthday {
  id: string;
  candidateName: string;
  candidatePhotoUrl: string | null;
  birthdayDate: string;
  wishCount: number;
  wishedByMe?: boolean;
}
interface Wish {
  id: string;
  userId?: string;
  wishedByMe?: boolean;
  userName: string;
  message: string;
  createdAt: string;
}

const readJson = async (res: Response) => res.json().catch(() => null);
const serverMessage = (json: any, fallback: string) => (json && typeof json.message === 'string' && json.message.length < 160 ? json.message : fallback);

const fetchActiveBirthdays = async (): Promise<Birthday[]> => {
  const res = await apiFetch((ENDPOINTS as any).birthdaysActive);
  const json = await readJson(res);
  if (!res.ok) throw new Error(serverMessage(json, "Couldn't load birthdays."));
  return Array.isArray(json) ? json : [];
};

const fetchWallEventTitle = async (): Promise<string | null> => {
  const res = await apiFetch((ENDPOINTS as any).wallActive);
  if (!res.ok) throw new Error('wall');
  const json = await readJson(res);
  return json?.activeEvent ? String(json.activeEvent.title || 'Photo contest') : null;
};

// IST calendar date fallback for older servers (the 9 PM question is an IST date).
const istToday = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);

const nextMeal = (mess: PulseToday['mess']) => {
  const hour = new Date().getHours();
  const order =
    hour < 10
      ? (['breakfast', 'lunch', 'snacks', 'dinner'] as const)
      : hour < 15
      ? (['lunch', 'snacks', 'dinner', 'breakfast'] as const)
      : hour < 18
      ? (['snacks', 'dinner', 'lunch', 'breakfast'] as const)
      : (['dinner', 'snacks', 'lunch', 'breakfast'] as const);
  for (const k of order) if (mess?.[k]) return { meal: k, menu: String(mess[k]) };
  return null;
};

let lastOpenKey = '';

// Last loaded cards, so the strip re-mounts instantly (Campus / Following switch) and refetches only when stale.
interface MomentsSnap {
  night: any;
  branches: any;
  today: any;
  birthdays: any;
  wall: any;
  at: number;
  refreshKey: number;
}
let snap: MomentsSnap | null = null;
const MOMENTS_MAX_AGE = 60000;

const MEAL_LABEL: Record<string, string> = { breakfast: 'Breakfast', lunch: 'Lunch', snacks: 'Snacks', dinner: 'Dinner' };

/**
 * Campus Moments: the old feed's daily rituals kept inside Pulse — the 9 PM question, Branch Wars,
 * Today on campus, Birthdays and The Wall. Each card loads on its own; a failed card says so and
 * retries on pull to refresh (the parent bumps `refreshKey`).
 */
export const CampusMomentsStrip: React.FC<{
  refreshKey: number;
  onOpenNightQuestion: () => void;
  onOpenBranchWars: () => void;
  /** Deep link: open The Wall / Birthdays once (key changes per link). */
  openRequest?: { key: string; target: 'wall' | 'birthdays' } | null;
  /** Signed-in user id (one wish per person). */
  me: string | null;
}> = ({ refreshKey, onOpenNightQuestion, onOpenBranchWars, openRequest, me }) => {
  const [night, setNight] = useState<{ text: string; count: number; isToday: boolean; isOpen: boolean; ended: boolean } | null | undefined>(snap?.night);
  const [branches, setBranches] = useState<{ list: PulseBranchStanding[]; mine: string | null } | null | undefined>(snap?.branches);
  const [today, setToday] = useState<PulseToday | null | undefined>(snap?.today);
  const [birthdays, setBirthdays] = useState<Birthday[] | null | undefined>(snap?.birthdays);
  const [wall, setWall] = useState<string | null | undefined | false>(snap?.wall);
  const [sheet, setSheet] = useState<null | 'today' | 'birthdays' | 'wall' | 'stories'>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    const [q, bw, td, bd, wl] = await Promise.allSettled([fetchDailyQuestion(), fetchBranchWars(), fetchPulseToday(), fetchActiveBirthdays(), fetchWallEventTitle()]);
    if (!mounted.current) return;
    if (q.status === 'fulfilled') {
      const qq = q.value.question;
      if (!qq) setNight({ text: '', count: 0, isToday: false, isOpen: false, ended: false });
      else {
        const isToday = typeof qq.isToday === 'boolean' ? qq.isToday : String(qq.promptDate).slice(0, 10) === istToday();
        const isOpen = typeof qq.isOpen === 'boolean' ? qq.isOpen : isToday;
        const opensAtMs = qq.opensAt ? new Date(qq.opensAt).getTime() : NaN;
        setNight({ text: qq.question, count: q.value.answerCount, isToday, isOpen, ended: isToday && !isOpen && !(opensAtMs > Date.now()) });
      }
    } else setNight((v) => (v === undefined ? null : v));
    if (bw.status === 'fulfilled') setBranches({ list: (bw.value.standings || []).slice(0, 3), mine: bw.value.userBranch || null });
    else setBranches((v) => (v === undefined ? null : v));
    if (td.status === 'fulfilled') setToday(td.value);
    else setToday((v) => (v === undefined ? null : v));
    if (bd.status === 'fulfilled') setBirthdays(bd.value);
    else setBirthdays((v) => (v === undefined ? null : v));
    if (wl.status === 'fulfilled') setWall(wl.value);
    else setWall((v) => (v === undefined ? false : v));
    snap = { ...(snap || { night: null, branches: null, today: null, birthdays: null, wall: false, refreshKey: 0 }), at: Date.now() } as MomentsSnap;
  }, []);

  useEffect(() => {
    if (snap && snap.refreshKey === refreshKey && Date.now() - snap.at < MOMENTS_MAX_AGE) return;
    load().then(() => {
      if (snap) snap.refreshKey = refreshKey;
    });
  }, [load, refreshKey]);

  // Keep the snapshot current for the next mount.
  useEffect(() => {
    if (night === undefined && branches === undefined && today === undefined) return;
    snap = { night, branches, today, birthdays, wall, at: snap?.at || Date.now(), refreshKey: snap?.refreshKey ?? refreshKey };
  }, [night, branches, today, birthdays, wall]); // eslint-disable-line react-hooks/exhaustive-deps

  // Deep links from notifications (birthday alerts, Wall events), applied once per link.
  useEffect(() => {
    if (!openRequest || lastOpenKey === openRequest.key) return;
    lastOpenKey = openRequest.key;
    setSheet(openRequest.target);
  }, [openRequest]);

  const meal = today ? nextMeal(today.mess) : null;
  const upcoming = today ? today.events.filter((e) => new Date(e.endsAt || e.startsAt).getTime() >= Date.now()) : [];
  const top = branches && branches.list.length ? branches.list[0] : null;

  return (
    <View style={{ marginBottom: FS.md }}>
      <Text style={[FT.kicker, { marginBottom: FS.sm }]}>Campus moments</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: FS.sm }}>
        {/* 9 PM question */}
        <TouchableOpacity
          style={[styles.card, styles.nightCard]}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
            onOpenNightQuestion();
          }}
          activeOpacity={0.88}
          accessibilityRole="button"
          accessibilityLabel={
            night?.isToday
              ? `The 9 PM question${night.isOpen ? ', live now' : night.ended ? ', answers closed' : ''}: ${night.text}. ${night.count} answers. Open`
              : "The 9 PM question. Today's question drops at 9 PM. Open"
          }
        >
          <View style={styles.cardTop}>
            <Moon size={14} color={FriendsColors.accent} />
            <Text style={[styles.cardKicker, { color: FriendsColors.accent }]}>9 PM QUESTION</Text>
            {night?.isOpen ? <View style={styles.liveDot} /> : null}
          </View>
          {night === undefined ? (
            <View style={{ gap: 6, marginTop: 8 }}>
              <SkeletonBlock width="90%" height={12} />
              <SkeletonBlock width="60%" height={12} />
            </View>
          ) : (
            <Text style={styles.nightText} numberOfLines={3}>
              {night === null ? "Couldn't load. Pull to refresh." : night.isToday ? `“${night.text}”` : 'Drops at 9 PM. Come back tonight.'}
            </Text>
          )}
          <Text style={styles.cardFoot} numberOfLines={1}>
            {night?.isToday ? (night.isOpen ? `Live · ${night.count} answers` : night.ended ? `Closed · ${night.count} answers` : 'Opens at 9 PM') : 'Anonymous answers'}
          </Text>
        </TouchableOpacity>

        {/* Branch Wars */}
        <TouchableOpacity
          style={styles.card}
          onPress={onOpenBranchWars}
          activeOpacity={0.88}
          accessibilityRole="button"
          accessibilityLabel={top ? `Branch Wars. ${top.code} leads with ${top.points} points this week. Open standings` : 'Branch Wars. Open standings'}
        >
          <View style={styles.cardTop}>
            <Trophy size={14} color={FriendsColors.gold} />
            <Text style={[styles.cardKicker, { color: FriendsColors.gold }]}>BRANCH WARS</Text>
          </View>
          {branches === undefined ? (
            <View style={{ gap: 6, marginTop: 8 }}>
              <SkeletonBlock width="80%" height={12} />
              <SkeletonBlock width="70%" height={12} />
            </View>
          ) : branches === null ? (
            <Text style={styles.body}>Couldn't load. Pull to refresh.</Text>
          ) : !branches.list.length ? (
            <Text style={styles.body}>No branch activity yet this week.</Text>
          ) : (
            <View style={{ marginTop: 6, gap: 3 }}>
              {branches.list.map((b) => (
                <View key={b.code} style={styles.branchRow}>
                  <Text style={[styles.branchRank, b.rank === 1 && { color: FriendsColors.gold }]}>{b.rank}</Text>
                  <Text style={[styles.branchCode, b.code === branches.mine && { color: FriendsColors.accent }]} numberOfLines={1}>
                    {b.code}
                  </Text>
                  <Text style={styles.branchPts}>{b.points.toLocaleString()}</Text>
                </View>
              ))}
            </View>
          )}
          <Text style={styles.cardFoot}>Last 7 days</Text>
        </TouchableOpacity>

        {/* Today */}
        <TouchableOpacity
          style={styles.card}
          onPress={() => setSheet('today')}
          activeOpacity={0.88}
          accessibilityRole="button"
          accessibilityLabel={`Today on campus. ${meal ? `${MEAL_LABEL[meal.meal]}: ${meal.menu}. ` : ''}${upcoming.length} events. Open`}
        >
          <View style={styles.cardTop}>
            <CalendarDays size={14} color={FriendsColors.success} />
            <Text style={[styles.cardKicker, { color: FriendsColors.success }]}>TODAY</Text>
          </View>
          {today === undefined ? (
            <View style={{ gap: 6, marginTop: 8 }}>
              <SkeletonBlock width="85%" height={12} />
              <SkeletonBlock width="50%" height={12} />
            </View>
          ) : today === null ? (
            <Text style={styles.body}>Couldn't load. Pull to refresh.</Text>
          ) : (
            <>
              <Text style={styles.body} numberOfLines={2}>
                {meal ? `${MEAL_LABEL[meal.meal]}: ${meal.menu}` : 'Mess menu not posted yet.'}
              </Text>
              <Text style={[styles.body, { color: FriendsColors.muted }]} numberOfLines={1}>
                {upcoming.length ? `${upcoming.length} event${upcoming.length === 1 ? '' : 's'} · ${upcoming[0].title}` : 'No events today'}
              </Text>
            </>
          )}
          <Text style={styles.cardFoot}>{new Date().toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}</Text>
        </TouchableOpacity>

        {/* Birthdays */}
        <TouchableOpacity
          style={styles.card}
          onPress={() => setSheet('birthdays')}
          activeOpacity={0.88}
          accessibilityRole="button"
          accessibilityLabel={`Birthdays. ${birthdays ? `${birthdays.length} today` : ''}. Open`}
        >
          <View style={styles.cardTop}>
            <Cake size={14} color={FriendsColors.danger} />
            <Text style={[styles.cardKicker, { color: FriendsColors.danger }]}>BIRTHDAYS</Text>
          </View>
          {birthdays === undefined ? (
            <View style={{ gap: 6, marginTop: 8 }}>
              <SkeletonBlock width="70%" height={12} />
            </View>
          ) : birthdays === null ? (
            <Text style={styles.body}>Couldn't load. Pull to refresh.</Text>
          ) : birthdays.length ? (
            <>
              <View style={styles.avatars}>
                {birthdays.slice(0, 4).map((b, i) => (
                  <View key={b.id} style={{ marginLeft: i ? -10 : 0 }}>
                    <FriendsAvatar name={b.candidateName} uri={b.candidatePhotoUrl} size={30} />
                  </View>
                ))}
              </View>
              <Text style={styles.body} numberOfLines={1}>
                {birthdays.length === 1 ? `${birthdays[0].candidateName}'s birthday` : `${birthdays.length} birthdays`}
              </Text>
            </>
          ) : (
            <Text style={styles.body}>No birthdays live. Nominate a friend.</Text>
          )}
          <Text style={styles.cardFoot}>Send wishes</Text>
        </TouchableOpacity>

        {/* The Wall */}
        <TouchableOpacity
          style={styles.card}
          onPress={() => setSheet('wall')}
          activeOpacity={0.88}
          accessibilityRole="button"
          accessibilityLabel={`The Wall photo contest. ${wall ? `${wall} is live` : 'Hall of fame'}. Open`}
        >
          <View style={styles.cardTop}>
            <Camera size={14} color={FriendsColors.warn} />
            <Text style={[styles.cardKicker, { color: FriendsColors.warn }]}>THE WALL</Text>
          </View>
          {wall === undefined ? (
            <View style={{ gap: 6, marginTop: 8 }}>
              <SkeletonBlock width="75%" height={12} />
            </View>
          ) : (
            <Text style={styles.body} numberOfLines={3}>
              {wall ? `Live: ${wall}` : wall === false ? 'Photo contests and the hall of fame.' : 'No contest right now. See past winners.'}
            </Text>
          )}
          <View style={styles.openRow}>
            <Text style={styles.cardFoot}>Open</Text>
            <ChevronRight size={12} color={FriendsColors.faint} />
          </View>
        </TouchableOpacity>

        {/* Stories: the earlier Community posts (48-hour stories, reviews, celebrations), kept here */}
        <TouchableOpacity
          style={styles.card}
          onPress={() => setSheet('stories')}
          activeOpacity={0.88}
          accessibilityRole="button"
          accessibilityLabel="Stories. 48-hour stories, reviews and celebrations from campus. Open"
        >
          <View style={styles.cardTop}>
            <Images size={14} color={FriendsColors.accent} />
            <Text style={[styles.cardKicker, { color: FriendsColors.accent }]}>STORIES</Text>
          </View>
          <Text style={styles.body} numberOfLines={3}>48-hour stories, reviews and celebrations from campus.</Text>
          <View style={styles.openRow}>
            <Text style={styles.cardFoot}>Open</Text>
            <ChevronRight size={12} color={FriendsColors.faint} />
          </View>
        </TouchableOpacity>
      </ScrollView>

      <TodaySheet visible={sheet === 'today'} onClose={() => setSheet(null)} today={today || null} />
      <BirthdaysSheet
        visible={sheet === 'birthdays'}
        onClose={() => setSheet(null)}
        birthdays={birthdays || []}
        onChanged={(list) => setBirthdays(list)}
        onReload={load}
        me={me}
      />
      <ScreenModal visible={sheet === 'wall'} onClose={() => setSheet(null)} title="The Wall" subtitle="Campus photo contest">
        {sheet === 'wall' ? <CommunityFeed embedded tab="wall" /> : null}
      </ScreenModal>
      <ScreenModal visible={sheet === 'stories'} onClose={() => setSheet(null)} title="Stories" subtitle="Stories, reviews and celebrations">
        {sheet === 'stories' ? <CommunityFeed embedded tab="all" /> : null}
      </ScreenModal>
    </View>
  );
};

// ── Today ─────────────────────────────────────────────────────────────────────
const TodaySheet: React.FC<{ visible: boolean; onClose: () => void; today: PulseToday | null }> = ({ visible, onClose, today }) => {
  const meals = (['breakfast', 'lunch', 'snacks', 'dinner'] as const).filter((k) => today?.mess?.[k]);
  return (
    <FriendsSheet visible={visible} onClose={onClose} title="Today on campus" subtitle={new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}>
      {!today ? (
        <Text style={FT.muted}>Couldn't load today's details. Pull to refresh Pulse and try again.</Text>
      ) : (
        <View style={{ gap: FS.lg }}>
          <View>
            <Text style={[FT.kicker, { marginBottom: FS.sm }]}>Mess menu</Text>
            {meals.length ? (
              <View style={fui.card}>
                {meals.map((k, i) => (
                  <View key={k} style={[fui.row, i === meals.length - 1 && { borderBottomWidth: 0 }]}>
                    <Utensils size={16} color={FriendsColors.muted} />
                    <View style={{ flex: 1 }}>
                      <Text style={FT.h3}>{MEAL_LABEL[k]}</Text>
                      <Text style={FT.muted}>{today.mess[k]}</Text>
                    </View>
                  </View>
                ))}
              </View>
            ) : (
              <Text style={FT.muted}>The mess menu hasn't been posted today.</Text>
            )}
          </View>
          <View>
            <Text style={[FT.kicker, { marginBottom: FS.sm }]}>Events</Text>
            {today.events.length ? (
              <View style={fui.card}>
                {today.events.map((e, i) => (
                  <View key={e.id} style={[fui.row, i === today.events.length - 1 && { borderBottomWidth: 0 }]}>
                    <CalendarDays size={16} color={FriendsColors.accent} />
                    <View style={{ flex: 1 }}>
                      <Text style={FT.h3}>{e.title}</Text>
                      <Text style={FT.small}>
                        {new Date(e.startsAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
                        {e.endsAt ? ` – ${new Date(e.endsAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}` : ''}
                      </Text>
                      {e.location ? (
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 }}>
                          <MapPin size={11} color={FriendsColors.faint} />
                          <Text style={FT.small}>{e.location}</Text>
                        </View>
                      ) : null}
                      {e.description ? <Text style={[FT.muted, { marginTop: 4 }]}>{e.description}</Text> : null}
                    </View>
                  </View>
                ))}
              </View>
            ) : (
              <Text style={FT.muted}>No events listed for today.</Text>
            )}
          </View>
        </View>
      )}
    </FriendsSheet>
  );
};

// ── Birthdays ─────────────────────────────────────────────────────────────────
const todayLocalYmd = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const QUICK_WISHES = ['Happy birthday! 🎉', 'Have an amazing year ahead!', 'Many happy returns of the day!'];

const BirthdaysSheet: React.FC<{
  visible: boolean;
  onClose: () => void;
  birthdays: Birthday[];
  onChanged: (list: Birthday[]) => void;
  onReload: () => void;
  me: string | null;
}> = ({ visible, onClose, birthdays, onChanged, onReload, me }) => {
  const [open, setOpen] = useState<Birthday | null>(null);
  const [wishes, setWishes] = useState<Wish[] | null>(null);
  const [wishErr, setWishErr] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [nominate, setNominate] = useState(false);
  const [name, setName] = useState('');
  const [date, setDate] = useState(todayLocalYmd);
  const [photo, setPhoto] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formErr, setFormErr] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) {
      setOpen(null);
      setNominate(false);
    }
  }, [visible]);

  const loadWishes = async (b: Birthday) => {
    setWishes(null);
    setWishErr(null);
    try {
      const res = await apiFetch((ENDPOINTS as any).birthdaysWishes(b.id));
      const json = await readJson(res);
      if (!res.ok) throw new Error(serverMessage(json, "Couldn't load wishes."));
      setWishes(Array.isArray(json) ? json : []);
    } catch (e: any) {
      setWishErr(e?.message || "Couldn't load wishes.");
    }
  };

  const openBirthday = (b: Birthday) => {
    setOpen(b);
    setMessage('');
    loadWishes(b);
  };

  const sendWish = async (preset?: string) => {
    if (!open || sending) return;
    const msg = (preset || message).trim();
    if (!msg) return;
    setSending(true);
    try {
      const res = await apiFetch((ENDPOINTS as any).birthdaysWish(open.id), { method: 'POST', body: JSON.stringify({ message: msg }) });
      const json = await readJson(res);
      if (!res.ok) {
        if (json?.code === 'ALREADY_WISHED') {
          const marked = { ...open, wishedByMe: true };
          setOpen(marked);
          onChanged(birthdays.map((b) => (b.id === open.id ? marked : b)));
        }
        throw new Error(serverMessage(json, "Couldn't send your wish."));
      }
      const count = typeof json?.wishCount === 'number' ? json.wishCount : open.wishCount + 1;
      const updated = { ...open, wishCount: count, wishedByMe: true };
      setOpen(updated);
      onChanged(birthdays.map((b) => (b.id === open.id ? updated : b)));
      setMessage('');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      loadWishes(updated);
    } catch (e: any) {
      Alert.alert("Couldn't send", e?.message || 'Please try again.');
    } finally {
      setSending(false);
    }
  };

  const pickPhoto = async () => {
    if (uploading) return;
    const asset = await pickImageAsset({ allowsEditing: true, aspect: [1, 1] });
    if (!asset) return;
    const run = async () => {
      setUploading(true);
      try {
        const up = await prepareAndUploadImage(asset, 'post');
        setPhoto(up.absoluteUrl);
      } catch (e) {
        alertUploadError(e, run);
      } finally {
        setUploading(false);
      }
    };
    await run();
  };

  const submitNomination = async () => {
    if (submitting || uploading) return;
    if (!name.trim()) return setFormErr('Add their name.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date.trim())) return setFormErr('Enter the date as YYYY-MM-DD.');
    setSubmitting(true);
    setFormErr(null);
    try {
      const res = await apiFetch((ENDPOINTS as any).birthdaysSubmit, {
        method: 'POST',
        body: JSON.stringify({ candidateName: name.trim(), birthdayDate: date.trim(), candidatePhoto: photo }),
      });
      const json = await readJson(res);
      if (!res.ok) throw new Error(serverMessage(json, "Couldn't send the nomination."));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setNominate(false);
      setName('');
      setPhoto(null);
      setDate(todayLocalYmd());
      Alert.alert('Nomination sent', 'An admin will review it. Once approved, it goes live and the campus is notified.');
      onReload();
    } catch (e: any) {
      setFormErr(e?.message || 'Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  // The server flags the viewer's own wish (wishedByMe); the list no longer carries account ids.
  const wished = !!me && (!!open?.wishedByMe || (!!wishes && wishes.some((w) => w.wishedByMe || String(w.userId) === String(me))));

  return (
    <FriendsSheet
      visible={visible}
      onClose={onClose}
      title={open ? `${open.candidateName}'s birthday` : nominate ? 'Nominate a birthday' : 'Birthdays'}
      subtitle={open ? `${open.wishCount} wish${open.wishCount === 1 ? '' : 'es'}` : nominate ? 'Reviewed by an admin before it goes live' : 'Celebrate your campus'}
    >
      {open ? (
        <View>
          <View style={{ alignItems: 'center', marginBottom: FS.lg }}>
            {open.candidatePhotoUrl ? (
              <Image source={{ uri: open.candidatePhotoUrl }} style={styles.bdPhoto} contentFit="cover" accessibilityLabel={`Photo of ${open.candidateName}`} />
            ) : (
              <FriendsAvatar name={open.candidateName} size={96} />
            )}
          </View>
          {wished ? (
            <Text style={[FT.small, { textAlign: 'center', marginBottom: FS.sm, color: FriendsColors.success }]}>You sent your wishes. Thank you!</Text>
          ) : null}
          <View style={styles.quickRow}>
            {QUICK_WISHES.map((q) => (
              <TouchableOpacity key={q} style={fui.pill} onPress={() => sendWish(q)} disabled={sending || wished} accessibilityRole="button" accessibilityLabel={`Send wish: ${q}`}>
                <Text style={fui.pillText}>{q}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <View style={styles.wishInputRow}>
            <TextInput
              style={[fui.input, { flex: 1 }]}
              value={message}
              onChangeText={setMessage}
              placeholder="Write a wish"
              placeholderTextColor={FriendsColors.faint}
              maxLength={200}
              accessibilityLabel="Your birthday wish"
            />
            <TouchableOpacity style={[styles.sendBtn, (wished || !message.trim()) && { opacity: 0.45 }]} onPress={() => sendWish()} disabled={sending || wished || !message.trim()} accessibilityRole="button" accessibilityLabel="Send wish">
              {sending ? <ActivityIndicator size="small" color={FriendsColors.accentInk} /> : <Send size={16} color={FriendsColors.accentInk} />}
            </TouchableOpacity>
          </View>
          <Text style={[FT.kicker, { marginTop: FS.lg, marginBottom: FS.sm }]}>Wishes</Text>
          {wishes === null && !wishErr ? (
            <ActivityIndicator color={FriendsColors.accent} />
          ) : wishErr ? (
            <TouchableOpacity onPress={() => loadWishes(open)} accessibilityRole="button">
              <Text style={[FT.small, { color: FriendsColors.warn }]}>{wishErr} Tap to retry.</Text>
            </TouchableOpacity>
          ) : wishes && wishes.length ? (
            <View style={fui.card}>
              {wishes.map((w, i) => (
                <View key={w.id} style={[fui.row, i === wishes.length - 1 && { borderBottomWidth: 0 }]}>
                  <Heart size={14} color={FriendsColors.danger} />
                  <View style={{ flex: 1 }}>
                    <Text style={FT.h3}>{w.userName}</Text>
                    <Text style={FT.muted}>{w.message}</Text>
                  </View>
                  <Text style={FT.small}>{formatRelative(w.createdAt)}</Text>
                </View>
              ))}
            </View>
          ) : (
            <Text style={FT.muted}>Be the first to wish.</Text>
          )}
          <TouchableOpacity style={[fui.ghostBtn, { marginTop: FS.lg }]} onPress={() => setOpen(null)} accessibilityRole="button">
            <Text style={fui.ghostBtnText}>All birthdays</Text>
          </TouchableOpacity>
        </View>
      ) : nominate ? (
        <View style={{ gap: FS.sm }}>
          <Text style={FT.kicker}>Name</Text>
          <TextInput style={fui.input} value={name} onChangeText={setName} maxLength={60} placeholder="Their name" placeholderTextColor={FriendsColors.faint} accessibilityLabel="Name" />
          <Text style={[FT.kicker, { marginTop: FS.sm }]}>Birthday (YYYY-MM-DD)</Text>
          <TextInput style={fui.input} value={date} onChangeText={setDate} maxLength={10} placeholder="2026-10-21" placeholderTextColor={FriendsColors.faint} keyboardType="numbers-and-punctuation" accessibilityLabel="Birthday date, year month day" />
          <Text style={FT.small}>From today up to 60 days ahead.</Text>
          <Text style={[FT.kicker, { marginTop: FS.sm }]}>Photo (optional)</Text>
          <TouchableOpacity style={styles.photoPick} onPress={pickPhoto} accessibilityRole="button" accessibilityLabel={photo ? 'Change photo' : 'Add photo'}>
            {uploading ? (
              <ActivityIndicator color={FriendsColors.muted} />
            ) : photo ? (
              <Image source={{ uri: photo }} style={{ width: 88, height: 88, borderRadius: FR.md }} contentFit="cover" />
            ) : (
              <>
                <Plus size={18} color={FriendsColors.muted} />
                <Text style={FT.small}>Add photo</Text>
              </>
            )}
          </TouchableOpacity>
          {formErr ? <Text style={[FT.small, { color: FriendsColors.danger }]} accessibilityRole="alert">{formErr}</Text> : null}
          <TouchableOpacity style={[fui.primaryBtn, { marginTop: FS.md }]} onPress={submitNomination} disabled={submitting || uploading} accessibilityRole="button" accessibilityState={{ busy: submitting }}>
            {submitting ? <ActivityIndicator color={FriendsColors.accentInk} /> : <Text style={fui.primaryBtnText}>Send for review</Text>}
          </TouchableOpacity>
          <TouchableOpacity style={fui.ghostBtn} onPress={() => setNominate(false)} accessibilityRole="button">
            <Text style={fui.ghostBtnText}>Back</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View>
          {birthdays.length ? (
            <View style={fui.card}>
              {birthdays.map((b, i) => (
                <TouchableOpacity
                  key={b.id}
                  style={[fui.row, i === birthdays.length - 1 && { borderBottomWidth: 0 }]}
                  onPress={() => openBirthday(b)}
                  accessibilityRole="button"
                  accessibilityLabel={`${b.candidateName}'s birthday, ${b.wishCount} wishes. Open to wish`}
                >
                  <FriendsAvatar name={b.candidateName} uri={b.candidatePhotoUrl} size={40} />
                  <View style={{ flex: 1 }}>
                    <Text style={FT.h3}>{b.candidateName}</Text>
                    <Text style={FT.small}>
                      {b.wishCount} wish{b.wishCount === 1 ? '' : 'es'}
                    </Text>
                  </View>
                  <ChevronRight size={18} color={FriendsColors.muted} />
                </TouchableOpacity>
              ))}
            </View>
          ) : (
            <Text style={[FT.muted, { textAlign: 'center', marginVertical: FS.lg }]}>No birthdays are live right now.</Text>
          )}
          <TouchableOpacity style={[fui.primaryBtn, { marginTop: FS.lg }]} onPress={() => setNominate(true)} accessibilityRole="button">
            <Cake size={17} color={FriendsColors.accentInk} />
            <Text style={fui.primaryBtnText}>Nominate a birthday</Text>
          </TouchableOpacity>
        </View>
      )}
    </FriendsSheet>
  );
};

const styles = themedSheet(() => ({
  card: {
    width: 188,
    minHeight: 148,
    padding: FS.md,
    borderRadius: FR.card,
    backgroundColor: FriendsColors.card,
    borderWidth: 1,
    borderColor: FriendsColors.line,
    justifyContent: 'space-between',
  },
  nightCard: { width: 236, backgroundColor: '#15112A', borderColor: 'rgba(212,175,122,0.35)' },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  cardKicker: { fontSize: 12, fontWeight: '900', letterSpacing: 0.9 },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: FriendsColors.danger, marginLeft: 'auto' },
  nightText: { fontSize: 15, lineHeight: 20, fontWeight: '700', color: FriendsColors.ink, marginTop: 8, fontStyle: 'italic' },
  body: { fontSize: 13, lineHeight: 18, fontWeight: '600', color: FriendsColors.ink, marginTop: 6 },
  cardFoot: { fontSize: 12, fontWeight: '700', color: FriendsColors.faint, marginTop: 8 },
  openRow: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  branchRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  branchRank: { width: 14, fontSize: 13, fontWeight: '900', color: FriendsColors.faint },
  branchCode: { flex: 1, fontSize: 13, fontWeight: '800', color: FriendsColors.ink },
  branchPts: { fontSize: 12, fontWeight: '700', color: FriendsColors.muted },
  avatars: { flexDirection: 'row', marginTop: 8 },
  bdPhoto: { width: 120, height: 120, borderRadius: 60, backgroundColor: FriendsColors.cardHi },
  quickRow: { flexDirection: 'row', flexWrap: 'wrap', gap: FS.sm },
  wishInputRow: { flexDirection: 'row', alignItems: 'center', gap: FS.sm, marginTop: FS.md },
  sendBtn: { width: 46, height: 46, borderRadius: 23, backgroundColor: FriendsColors.accent, alignItems: 'center', justifyContent: 'center' },
  photoPick: {
    width: 96,
    height: 96,
    borderRadius: FR.md,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: FriendsColors.line,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
}));
