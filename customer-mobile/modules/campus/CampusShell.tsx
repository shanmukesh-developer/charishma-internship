import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, StyleSheet, StatusBar, Modal, Alert, Platform, BackHandler } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { LogIn, Car, Bike } from '../../components/lucide';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { CampusColors } from '../../constants/campusTheme';
import { CampusProfileData, CampusUserData, CampusItem, CampusTab as CampusTabKey } from '../../types/campus';
import {
  fetchCampuses,
  fetchCampusProfile,
  fetchChats,
  isCampusAuthError,
  joinCampusGroup,
  CampusLastVerification,
  CampusGroup,
} from './campusApi';
import { useAuth } from '../../context/AuthContext';
import { CampusLink } from './campusLinks';
import { useFriendRequests } from './useFriendRequests';
import { CampusHeader } from './components/CampusHeader';
import { CampusBottomNav } from './components/CampusBottomNav';
import { VerificationModal } from './components/VerificationModal';
import { ChatsTab } from './tabs/ChatsTab';
import { FriendsTab, clearFriendsEligibilityCache } from './friends/FriendsTab';
import { LegacyFeedSegment, isLegacyFeedSegment } from './friends/pulse/LegacyPulse';
import { FriendsSafetyScreen } from './friends/shared/FriendsSafetyScreen';
import { FriendsColors } from './friends/friendsTheme';
import { CampusTab, CampusSegment } from './tabs/CampusTab';
import { MeTab } from './tabs/MeTab';
import { ChatDetailScreen } from './components/ChatDetailScreen';
import { GroupsScreen, CreateGroupSheet } from './components/GroupsScreen';
import { ClassworkScreen } from './components/ClassworkScreen';
import { LostFoundModal } from './components/LostFoundModal';
import { RidePoolModal } from './components/RidePoolModal';
import { CampusWhispersModal } from './components/CampusWhispersModal';
import { NightQuestionModal } from './components/NightQuestionModal';
import { BranchWarsModal } from './components/BranchWarsModal';
import { StudySyncModal } from './components/StudySyncModal';
import { AssignmentPortalModal } from './components/AssignmentPortalModal';
import { ProximityRoomModal } from './components/ProximityRoomModal';
import { NewChatSheet } from './components/NewChatSheet';
import { FriendsScreen, AddFriendSheet } from './components/FriendsScreen';
import { CampusCallModal, IncomingCampusCallOverlay, CampusCallSession, IncomingCampusCall } from './components/CampusCallModal';
import { QrScannerModal } from './components/QrScannerModal';
import { connectCampusSocket, disconnectCampusSocket, rejectCampusCall } from './campusSocketClient';
import { EmptyState, ErrorState, SkeletonRows, Sheet, ListRow, S } from './ui';
import { goHome } from '../../utils/goHome';

// The campus socket is shared by every mounted shell (a notification can open a second one on top).
// It is closed only when the last shell unmounts, so a later logout/login never reuses the old identity.
let mountedShells = 0;
let pendingSocketTeardown: ReturnType<typeof setTimeout> | null = null;

const BANNER_KEY = 'campus_verify_banner_hidden_until';
const BANNER_SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;

const TAB_TITLES: Record<CampusTabKey, string> = {
  chats: 'Chats',
  friends: 'Friends',
  campus: 'Around campus',
  me: 'Me',
};

/** Overlays that can be open on top of the tabs. Only one at a time, so back / Android back is predictable. */
type Overlay =
  | null
  | 'verify'
  | 'newChat'
  | 'createGroup'
  | 'join'
  | 'addFriend'
  | 'friends'
  | 'groups'
  | 'classwork'
  | 'lostFound'
  | 'rides'
  | 'ridePool'
  | 'whispers'
  | 'nightQuestion'
  | 'branchWars'
  | 'studySync'
  | 'friendsSafety';

interface CampusShellProps {
  onBack?: () => void;
  /** Deep link from a notification or another screen (tab, chat, friend requests, verification). */
  link?: CampusLink | null;
}

export const CampusShell: React.FC<CampusShellProps> = ({ onBack, link }) => {
  const router = useRouter();
  // Set while this visit was opened only for college verification (link screen=verification, 3 Nov 2026).
  const verifyOnlyRef = useRef(false);
  const [activeTab, setActiveTab] = useState<CampusTabKey>('chats');
  // Friends > Pulse: the old campus feed's segment (posts | wall | pulse), kept across tab switches.
  const [pulseSegment, setPulseSegment] = useState<LegacyFeedSegment>('posts');
  const [campusSegment, setCampusSegment] = useState<CampusSegment>('around');
  const [profile, setProfile] = useState<CampusProfileData | null>(null);
  const [user, setUser] = useState<CampusUserData | null>(null);
  const [lastVerification, setLastVerification] = useState<CampusLastVerification | null>(null);
  const [campuses, setCampuses] = useState<CampusItem[]>([]);
  const [loading, setLoading] = useState(true);
  // null = ok; 'auth' = must sign in; otherwise a friendly network/server message.
  const [loadError, setLoadError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const [overlay, setOverlay] = useState<Overlay>(null);
  const [selectedChat, setSelectedChat] = useState<{ id: string; name: string } | null>(null);
  const [selectedAssignmentId, setSelectedAssignmentId] = useState<string | null>(null);
  const [proximityRoomSlug, setProximityRoomSlug] = useState<string | null>(null);
  const [activeCall, setActiveCall] = useState<CampusCallSession | null>(null);
  const [incomingCall, setIncomingCall] = useState<IncomingCampusCall | null>(null);
  const activeCallRef = useRef<CampusCallSession | null>(null);
  activeCallRef.current = activeCall;

  const [studyRefreshKey, setStudyRefreshKey] = useState(0);
  const [groupsRefreshKey, setGroupsRefreshKey] = useState(0);
  const [bannerHidden, setBannerHidden] = useState(true);

  // Live unread total reported by ChatsTab (drives the bottom-nav badge)
  const [totalUnread, setTotalUnread] = useState(0);
  // Bumped to make ChatsTab silently reload (after a join, or when a chat closes).
  const [chatsRefreshKey, setChatsRefreshKey] = useState(0);
  const activeTabRef = useRef<CampusTabKey>(activeTab);
  activeTabRef.current = activeTab;
  const selectedChatIdRef = useRef<string | null>(null);
  selectedChatIdRef.current = selectedChat?.id ?? null;

  useEffect(() => {
    mountedRef.current = true;
    mountedShells += 1;
    if (pendingSocketTeardown) {
      clearTimeout(pendingSocketTeardown);
      pendingSocketTeardown = null;
    }
    return () => {
      mountedRef.current = false;
      mountedShells = Math.max(0, mountedShells - 1);
      if (mountedShells > 0) return;
      // Deferred so child cleanups (leave chat, end call) run against the old socket first;
      // cancelled if a shell remounts right away (StrictMode / fast refresh).
      pendingSocketTeardown = setTimeout(() => {
        pendingSocketTeardown = null;
        if (mountedShells === 0) disconnectCampusSocket();
      }, 0);
    };
  }, []);

  // Logging out while Campus is open must not leave the previous student's profile on screen.
  const { user: authUser } = useAuth();
  useEffect(() => {
    if (!authUser) {
      clearFriendsEligibilityCache();
      setProfile(null);
      setUser(null);
      setSelectedChat(null);
      setOverlay(null);
      setLoadError('auth');
      setLoading(false);
    }
  }, [authUser]);

  const loadData = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) {
      setLoading(true);
      setLoadError(null);
    }
    const [campusesRes, profileRes] = await Promise.allSettled([fetchCampuses(), fetchCampusProfile()]);
    if (!mountedRef.current) return;

    if (campusesRes.status === 'fulfilled') setCampuses(campusesRes.value);
    if (profileRes.status === 'fulfilled') {
      setProfile(profileRes.value.profile);
      setUser(profileRes.value.user);
      setLastVerification(profileRes.value.lastVerification || null);
      setLoadError(null);
    } else if (!opts?.silent) {
      const err: any = profileRes.reason;
      setLoadError(isCampusAuthError(err) ? 'auth' : err?.message || "Couldn't reach Campus right now.");
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Coming back from the Sign in screen: retry so the student lands in Campus, not on the sign-in prompt.
  const loadErrorRef = useRef<string | null>(null);
  loadErrorRef.current = loadError;
  useFocusEffect(
    useCallback(() => {
      if (loadErrorRef.current === 'auth') loadData();
    }, [loadData])
  );

  // Only open sockets / friend inbox once we know the student is signed in (profile loaded).
  const hasProfile = !!profile;
  const requests = useFriendRequests(hasProfile);

  // Verification banner: one dismissible prompt for signed-in, unverified students (snoozed for a week).
  useEffect(() => {
    if (!hasProfile) return;
    AsyncStorage.getItem(BANNER_KEY)
      .then((v) => {
        if (mountedRef.current) setBannerHidden(!!v && Number(v) > Date.now());
      })
      .catch(() => {
        if (mountedRef.current) setBannerHidden(false);
      });
  }, [hasProfile]);

  const dismissBanner = () => {
    setBannerHidden(true);
    AsyncStorage.setItem(BANNER_KEY, String(Date.now() + BANNER_SNOOZE_MS)).catch(() => {});
  };

  // iOS can't present a modal while another one is still sliding away: wait for the dismissal.
  const afterModalDismiss = useCallback((fn: () => void) => {
    setTimeout(() => {
      if (mountedRef.current) fn();
    }, Platform.OS === 'ios' ? 450 : 0);
  }, []);

  const overlayRef = useRef<Overlay>(null);
  overlayRef.current = overlay;

  /** Close whatever is open, then open the next overlay. */
  const switchTo = useCallback(
    (next: Overlay) => {
      const cur = overlayRef.current;
      if (cur && cur !== next) {
        setOverlay(null);
        afterModalDismiss(() => setOverlay(next));
      } else {
        setOverlay(next);
      }
    },
    [afterModalDismiss]
  );

  const openChat = useCallback(
    (id: string, name: string) => {
      const hadOverlay = overlayRef.current !== null;
      setOverlay(null);
      setChatsRefreshKey((k) => k + 1);
      if (hadOverlay) afterModalDismiss(() => setSelectedChat({ id, name }));
      else setSelectedChat({ id, name });
    },
    [afterModalDismiss]
  );

  const closeChat = useCallback(() => {
    setSelectedChat(null);
    // Pick up our own last message + server-side read receipts in the list.
    setChatsRefreshKey((k) => k + 1);
  }, []);

  // Keep the Chats badge live while the user is on another tab (ChatsTab is unmounted then).
  useEffect(() => {
    if (!hasProfile) return;
    const socket = connectCampusSocket();
    const onChatUpdated = (data: any) => {
      if (!data?.chatId) return;
      if (activeTabRef.current === 'chats') return; // ChatsTab owns the count while mounted
      if (selectedChatIdRef.current === data.chatId) return; // being read right now
      setTotalUnread((n) => n + 1);
    };
    // Admin approved / rejected the ID card, or the email code succeeded on another device.
    const onProfileUpdated = (data: any) => {
      if (!data || !data.verificationStatus) return;
      setProfile((p) => (p ? { ...p, verificationStatus: data.verificationStatus } : p));
      loadData({ silent: true });
      // A late rejection of an old request for an already-verified student changes nothing: stay quiet.
      if (data.method === 'id_card' && !(data.decision === 'reject' && data.verificationStatus === 'verified')) {
        Haptics.notificationAsync(
          data.verificationStatus === 'verified' ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Warning
        ).catch(() => {});
        if (data.verificationStatus === 'verified') {
          Alert.alert('You are verified', 'Your college ID was approved. +150 Campus points added.');
        } else if (data.verificationStatus === 'rejected' || data.reviewNotes) {
          Alert.alert(
            'ID card not approved',
            data.reviewNotes ? `Reason: ${data.reviewNotes}` : 'Please upload a clearer photo of the front of your ID card.',
            [
              { text: 'Later', style: 'cancel' },
              { text: 'Try again', onPress: () => switchTo('verify') },
            ]
          );
        }
      }
    };
    socket.on('chat:updated', onChatUpdated);
    socket.on('profile:updated', onProfileUpdated);
    return () => {
      socket.off('chat:updated', onChatUpdated);
      socket.off('profile:updated', onProfileUpdated);
    };
  }, [hasProfile, loadData, switchTo]);

  // Incoming campus calls.
  useEffect(() => {
    if (!hasProfile) return;
    const socket = connectCampusSocket();
    const onIncoming = (data: IncomingCampusCall) => {
      if (!data?.callId) return;
      if (activeCallRef.current) {
        rejectCampusCall(data.callId, 'busy');
        return;
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setIncomingCall(data);
    };
    const onEnded = (data: { callId: string }) => {
      setIncomingCall((prev) => (prev?.callId === data.callId ? null : prev));
    };
    socket.on('call:incoming', onIncoming);
    socket.on('call:ended', onEnded);
    return () => {
      socket.off('call:incoming', onIncoming);
      socket.off('call:ended', onEnded);
    };
  }, [hasProfile]);

  // Deep links (notifications, Home cards): apply once the profile is loaded.
  const linkKey = link ? JSON.stringify(link) : '';
  const appliedLinkRef = useRef('');
  useEffect(() => {
    if (!link || !hasProfile || appliedLinkRef.current === linkKey) return;
    appliedLinkRef.current = linkKey;
    if (link.tab) setActiveTab(link.tab);
    if (isLegacyFeedSegment(link.segment)) setPulseSegment(link.segment);
    if (link.segment === 'around' || link.segment === 'study') setCampusSegment(link.segment);
    if (link.chatId) {
      const chatId = link.chatId;
      if (link.chatName) {
        openChat(chatId, link.chatName);
      } else {
        // Notifications carry only the id: look up the chat's name so the header is right.
        fetchChats()
          .then((list) => list.find((c) => String(c.id) === String(chatId))?.name || 'Chat')
          .catch(() => 'Chat')
          .then((name) => {
            if (mountedRef.current) openChat(chatId, name);
          });
      }
    } else if (link.screen === 'requests' || link.screen === 'friends') {
      setActiveTab('me');
      switchTo('friends');
    } else if (link.screen === 'verification') {
      // Opened only to verify (Rentals, Events, ...): closing the sheet goes back there, not into Campus.
      verifyOnlyRef.current = true;
      setActiveTab('me');
      switchTo('verify');
    } else if (link.screen === 'groups') {
      switchTo('groups');
    } else if (link.screen === 'friends_safety') {
      setActiveTab('me');
      switchTo('friendsSafety');
    } else if (link.screen === 'whispers' || link.screen === 'nightQuestion' || link.screen === 'branchWars') {
      // Opened from the Community screen's Whispers & 9 PM tab.
      switchTo(link.screen);
    }
  }, [link, linkKey, hasProfile, openChat, switchTo]);

  // Android back: close the open sheet first (Modals handle that), then go back to Chats, then leave.
  // Only while this screen is focused, so back on a screen pushed on top (Co-ride, Sign in) is not hijacked.
  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        if (overlayRef.current || selectedChatIdRef.current) return false; // the open Modal handles it
        if (activeTabRef.current !== 'chats') {
          setActiveTab('chats');
          return true;
        }
        return false;
      });
      return () => sub.remove();
    }, [])
  );

  const onJoinedGroup = useCallback(
    (group: { id?: string; name?: string; alreadyMember?: boolean }) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setGroupsRefreshKey((k) => k + 1);
      setActiveTab('chats');
      const name = group.name || 'the group';
      if (group.id) {
        openChat(group.id, name);
        if (group.alreadyMember) {
          afterModalDismiss(() => Alert.alert('Already a member', `You're already part of ${name}.`));
        }
      } else {
        setOverlay(null);
        setChatsRefreshKey((k) => k + 1);
        afterModalDismiss(() => Alert.alert(group.alreadyMember ? 'Already a member' : "You're in!", `Welcome to ${name}.`));
      }
    },
    [openChat, afterModalDismiss]
  );

  const onGroupCreated = useCallback(
    (group: CampusGroup) => {
      setGroupsRefreshKey((k) => k + 1);
      setActiveTab('chats');
      openChat(group.id, group.name);
    },
    [openChat]
  );

  // ── Signed out / unreachable ────────────────────────────────────────────────
  if (!loading && loadError && !profile) {
    const needsSignIn = loadError === 'auth';
    return (
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
        <StatusBar barStyle="dark-content" />
        <CampusHeader profile={null} title="Campus" onBack={onBack} />
        <View style={styles.centerContainer}>
          {needsSignIn ? (
            <EmptyState
              icon={<LogIn size={22} color={CampusColors.accent} />}
              title="Sign in to use Campus"
              subtitle="Chat with classmates, join your class and club groups, and see what's happening on campus."
              actionLabel="Sign in"
              onAction={() => router.push('/login')}
            />
          ) : (
            <ErrorState message={loadError} onRetry={() => loadData()} />
          )}
        </View>
      </SafeAreaView>
    );
  }

  const isVerified = profile?.verificationStatus === 'verified';
  const isRejected = profile?.verificationStatus === 'rejected';
  // Zenvy Friends uses the dark theme: header, bottom nav and status bar follow while it is open.
  const chromeTone: 'light' | 'dark' = activeTab === 'friends' && !loading ? 'dark' : 'light';
  const friendsLinkKey = link && link.tab === 'friends' ? linkKey : '';

  return (
    <SafeAreaView style={[styles.safeArea, chromeTone === 'dark' && { backgroundColor: FriendsColors.bg }]} edges={['top', 'bottom']}>
      <StatusBar barStyle={chromeTone === 'dark' ? 'light-content' : 'dark-content'} />

      <CampusHeader
        profile={profile}
        title={TAB_TITLES[activeTab]}
        onBack={onBack}
        onPlus={profile ? () => switchTo('newChat') : undefined}
        onOpenVerify={() => switchTo('verify')}
        // Me has its own verification card; elsewhere show one dismissible banner (rejections always show).
        showVerifyBanner={!!profile && !isVerified && activeTab !== 'me' && (isRejected || !bannerHidden)}
        onDismissVerifyBanner={dismissBanner}
        tone={chromeTone}
      />

      <View style={styles.tabContent}>
        {loading ? (
          <View style={{ padding: S.lg }}>
            <SkeletonRows rows={6} />
          </View>
        ) : (
          <>
            {activeTab === 'chats' && (
              <ChatsTab
                onSelectChat={(id, name) => setSelectedChat({ id, name })}
                onOpenNewChat={() => switchTo('newChat')}
                onOpenJoinGroup={() => switchTo('join')}
                onOpenGroups={() => switchTo('groups')}
                onOpenRequests={() => switchTo('friends')}
                incomingRequests={requests.incoming.length}
                onUnreadChange={setTotalUnread}
                activeChatId={selectedChat?.id ?? null}
                refreshKey={chatsRefreshKey}
              />
            )}

            {activeTab === 'friends' && (
              <FriendsTab
                profile={profile}
                user={user}
                linkSub={link && link.tab === 'friends' ? link.sub || null : null}
                linkId={link && link.tab === 'friends' ? link.id || null : null}
                linkKey={friendsLinkKey}
                pulseSegment={pulseSegment}
                onChangePulseSegment={setPulseSegment}
                onOpenWhispers={() => switchTo('whispers')}
                onOpenNightQuestion={() => switchTo('nightQuestion')}
                onOpenBranchWars={() => switchTo('branchWars')}
                onOpenVerify={() => switchTo('verify')}
                onOpenSafety={() => switchTo('friendsSafety')}
                onOpenChat={openChat}
              />
            )}

            {activeTab === 'campus' && (
              <CampusTab
                profile={profile}
                user={user}
                segment={campusSegment}
                onChangeSegment={setCampusSegment}
                onOpenLostFound={() => switchTo('lostFound')}
                onOpenRides={() => switchTo('rides')}
                onOpenRoom={(slug) => setProximityRoomSlug(slug)}
                onOpenStudySync={() => switchTo('studySync')}
                onOpenAssignment={(id) => setSelectedAssignmentId(id)}
                onOpenClasswork={() => switchTo('classwork')}
                studyRefreshKey={studyRefreshKey}
              />
            )}

            {activeTab === 'me' && (
              <MeTab
                profile={profile}
                user={user}
                campuses={campuses}
                lastVerification={lastVerification}
                incomingRequests={requests.incoming.length}
                onOpenVerify={() => switchTo('verify')}
                onOpenFriends={() => switchTo('friends')}
                onOpenFriendsSafety={() => switchTo('friendsSafety')}
                onProfileUpdated={(updated) => setProfile(updated)}
                onUserUpdated={(patch) => setUser((u) => (u ? { ...u, ...patch } : u))}
                onRefresh={async () => {
                  await Promise.all([loadData({ silent: true }), requests.reload()]);
                }}
              />
            )}
          </>
        )}
      </View>

      <CampusBottomNav
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        unreadCount={totalUnread}
        meBadge={requests.incoming.length}
        tone={chromeTone}
      />

      {/* ── Sheets & pages (one at a time) ─────────────────────────────────── */}
      <VerificationModal
        visible={overlay === 'verify'}
        onClose={() => {
          setOverlay(null);
          // Pick up a 'pending review' / verified status without a manual reload.
          loadData({ silent: true });
          if (verifyOnlyRef.current) {
            verifyOnlyRef.current = false;
            if (router.canGoBack()) router.back(); else goHome(router);
          }
        }}
        profile={profile}
        campuses={campuses}
        onVerifiedSuccess={(updated) => setProfile((p) => ({ ...(p || ({} as CampusProfileData)), ...updated }))}
        onSubmitted={() => loadData({ silent: true })}
      />

      <NewChatSheet
        visible={overlay === 'newChat'}
        onClose={() => setOverlay(null)}
        onOpenChat={openChat}
        onCreateGroup={() => switchTo('createGroup')}
        onJoinWithCode={() => switchTo('join')}
        onAddFriendByCode={() => switchTo('addFriend')}
        onOpenProfile={() => {
          setOverlay(null);
          setActiveTab('me');
        }}
        onOpenVerify={() => switchTo('verify')}
        onFriendsChanged={() => requests.reload()}
      />

      <CreateGroupSheet
        visible={overlay === 'createGroup'}
        onClose={() => setOverlay(null)}
        onCreated={(g) => {
          onGroupCreated(g);
          const code = g.joinCode;
          if (code) {
            afterModalDismiss(() =>
              Alert.alert('Group created', `Invite people with code ${code}. You can find it any time in Groups.`)
            );
          }
        }}
      />

      <AddFriendSheet
        visible={overlay === 'addFriend'}
        onClose={() => setOverlay(null)}
        myCode={user?.friendCode}
        onDone={() => requests.reload()}
      />

      <QrScannerModal
        visible={overlay === 'join'}
        onClose={() => setOverlay(null)}
        onScanCode={async (raw) => {
          const code = String(raw || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
          try {
            const group = await joinCampusGroup(code);
            if (!mountedRef.current) return;
            onJoinedGroup(group);
          } catch (e: any) {
            Alert.alert("Couldn't join", e?.message || 'Please check the code and try again.');
          }
        }}
      />

      <FriendsScreen
        visible={overlay === 'friends'}
        onClose={() => setOverlay(null)}
        myCode={user?.friendCode}
        myName={user?.name}
        requests={requests}
        onOpenChat={openChat}
      />

      <GroupsScreen
        visible={overlay === 'groups'}
        onClose={() => {
          setOverlay(null);
          setChatsRefreshKey((k) => k + 1);
        }}
        onOpenChat={openChat}
        onCreateGroup={() => switchTo('createGroup')}
        onJoinWithCode={() => switchTo('join')}
        refreshKey={groupsRefreshKey}
      />

      <Modal visible={overlay === 'classwork'} animationType="slide" onRequestClose={() => setOverlay(null)}>
        <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
          <ClassworkScreen currentUser={user} onBack={() => setOverlay(null)} />
        </SafeAreaView>
      </Modal>

      <LostFoundModal
        visible={overlay === 'lostFound'}
        onClose={() => setOverlay(null)}
        currentUser={user}
        campusCode={profile?.campus?.code || null}
        onRequestVerify={() => switchTo('verify')}
        onOpenChat={openChat}
      />

      {/* Rides: one entry for campus cab/auto pools and the main app's bike co-ride. */}
      <Sheet visible={overlay === 'rides'} onClose={() => setOverlay(null)} title="Rides" icon={<Car size={20} color={CampusColors.accent} />}>
        <ListRow
          left={<View style={styles.rowIcon}><Car size={18} color={CampusColors.accentDeep} /></View>}
          title="Cab & auto pools"
          subtitle="Share a cab or auto with students on your campus and split the fare"
          onPress={() => switchTo('ridePool')}
        />
        <ListRow
          last
          left={<View style={styles.rowIcon}><Bike size={18} color={CampusColors.accentDeep} /></View>}
          title="Bike co-ride"
          subtitle="Ride pillion with a student going your way and split the fuel"
          onPress={() => {
            setOverlay(null);
            afterModalDismiss(() => router.push({ pathname: '/(tabs)/others', params: { tab: 'coride' } } as any));
          }}
        />
      </Sheet>

      <RidePoolModal visible={overlay === 'ridePool'} onClose={() => setOverlay(null)} currentUser={user} onRequestVerify={() => switchTo('verify')} />

      <CampusWhispersModal
        visible={overlay === 'whispers'}
        onClose={() => setOverlay(null)}
        isVerified={isVerified}
        isPendingVerification={profile?.verificationStatus === 'pending'}
        onRequestVerify={() => switchTo('verify')}
      />

      <NightQuestionModal visible={overlay === 'nightQuestion'} onClose={() => setOverlay(null)} />

      <BranchWarsModal
        visible={overlay === 'branchWars'}
        onClose={() => setOverlay(null)}
        userBranch={profile?.branch || undefined}
      />

      <StudySyncModal visible={overlay === 'studySync'} onClose={() => setOverlay(null)} />

      <FriendsSafetyScreen
        visible={overlay === 'friendsSafety'}
        onClose={() => setOverlay(null)}
        onOpenBlocked={() => switchTo('friends')}
        onOpenVerify={() => switchTo('verify')}
      />

      {selectedAssignmentId && (
        <AssignmentPortalModal
          visible={!!selectedAssignmentId}
          onClose={() => {
            setSelectedAssignmentId(null);
            setStudyRefreshKey((k) => k + 1);
          }}
          assignmentId={selectedAssignmentId}
        />
      )}

      {proximityRoomSlug && (
        <ProximityRoomModal
          visible={!!proximityRoomSlug}
          onClose={() => setProximityRoomSlug(null)}
          roomSlug={proximityRoomSlug}
          currentUser={user}
        />
      )}

      {/* Chat (opened from the list, search, friends, groups or a notification) */}
      {selectedChat && (
        <Modal visible animationType="slide" onRequestClose={closeChat}>
          <ChatDetailScreen
            chatId={selectedChat.id}
            chatName={selectedChat.name}
            currentUser={user}
            onBack={closeChat}
            onStartCall={(callType) => {
              setActiveCall({
                chatId: selectedChat.id,
                peerName: selectedChat.name,
                callType: callType === 'video' ? 'video' : 'voice',
                role: 'caller',
              });
            }}
          />
        </Modal>
      )}

      {incomingCall && !activeCall && (
        <IncomingCampusCallOverlay
          incoming={incomingCall}
          onDecline={() => {
            rejectCampusCall(incomingCall.callId);
            setIncomingCall(null);
          }}
          onAccept={() => {
            const incoming = incomingCall;
            setIncomingCall(null);
            setActiveCall({
              chatId: incoming.chatId,
              peerName: incoming.callerName,
              callType: incoming.callType,
              role: 'callee',
              callId: incoming.callId,
            });
          }}
        />
      )}

      {activeCall && <CampusCallModal visible={!!activeCall} onClose={() => setActiveCall(null)} session={activeCall} />}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: CampusColors.paper,
  },
  tabContent: {
    flex: 1,
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: S.xl,
  },
  rowIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: CampusColors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
