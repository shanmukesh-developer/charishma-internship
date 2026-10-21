import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { ShieldAlert, ChevronRight } from '../../../components/lucide';
import { CampusProfileData, CampusUserData, FriendsSubTab, FRIENDS_SUB_TABS } from '../../../types/campus';
import { isCampusAuthError } from '../campusApi';
import { subscribeCampusConnection } from '../campusSocketClient';
import { fetchFriendsEligibility, FriendsEligibility } from './api/core';
import { FriendsColors, FS, FT } from './friendsTheme';
import { SubTabBar } from './shared/SubTabBar';
import { GuidelinesGate, EligibilityGate } from './shared/gates';
import { OfflineBanner } from './shared/OfflineBanner';
import { FriendsSkeleton, SkeletonBlock } from './shared/FriendsSkeleton';
import { PulseHome } from './pulse/PulseHome';
import { LegacyFeedSegment } from './pulse/LegacyPulse';
import { ForumHome } from './forum/ForumHome';
import { TasksHome } from './tasks/TasksHome';
import { ConnectHome } from './connect/ConnectHome';
import { SpacesHome } from './spaces/SpacesHome';

// Last eligibility answer, so switching tabs back to Friends renders instantly (refreshed in the background).
let cachedEligibility: { userId: string; value: FriendsEligibility } | null = null;

/** Clear the cached answer (sign-out, verification change). */
export const clearFriendsEligibilityCache = () => {
  cachedEligibility = null;
};

export interface FriendsTabProps {
  profile: CampusProfileData | null;
  user: CampusUserData | null;
  /** Deep link: sub-tab + item id. Applied once per `linkKey`. */
  linkSub?: FriendsSubTab | null;
  linkId?: string | null;
  linkKey?: string;
  /**
   * Friends > Pulse: the old campus feed's segment (kept by the shell so it survives tab switches).
   * With Pulse on, a ?segment=wall|posts link opens The Wall / Birthdays once instead.
   */
  pulseSegment: LegacyFeedSegment;
  onChangePulseSegment: (s: LegacyFeedSegment) => void;
  /** Old Whispers board: reachable only from the pre-launch fallback feed (Pulse off). */
  onOpenWhispers: () => void;
  onOpenNightQuestion: () => void;
  onOpenBranchWars: () => void;
  onOpenVerify: () => void;
  /** Me › Friends privacy & safety (restrictions, appeals, settings). */
  onOpenSafety: () => void;
  onOpenChat: (chatId: string, name: string) => void;
}

/**
 * Campus > Friends.
 * - Pulse is always there. With the pulse flag on it is the real campus feed (posts, polls, hashtags,
 *   trends, follows, reposts, bookmarks) with Campus Moments (9 PM, Branch Wars, Today, Birthdays,
 *   The Wall); with the flag off it stays the previous campus feed so nothing is lost before launch.
 * - Spaces, Forum, Tasks and Connect appear only when the server says they are on for this student
 *   (verified, same campus, not restricted, admin flag on and the phase shipped).
 * - New sub-tabs ask for the community guidelines once before first use.
 * - Visited sub-tabs stay mounted so scroll position and drafts survive switching.
 */
export const FriendsTab: React.FC<FriendsTabProps> = ({
  profile,
  user,
  linkSub,
  linkId,
  linkKey,
  pulseSegment,
  onChangePulseSegment,
  onOpenWhispers,
  onOpenNightQuestion,
  onOpenBranchWars,
  onOpenVerify,
  onOpenSafety,
  onOpenChat,
}) => {
  const userId = user?.id || profile?.userId || '';
  const [elig, setElig] = useState<FriendsEligibility | null>(() =>
    cachedEligibility && cachedEligibility.userId === userId ? cachedEligibility.value : null
  );
  // Until the first eligibility answer arrives, show a loader instead of the locked/legacy Pulse
  // (that flashed for a few seconds before the real Friends page appeared).
  const [loaded, setLoaded] = useState<boolean>(() => !!(cachedEligibility && cachedEligibility.userId === userId));
  const [active, setActive] = useState<FriendsSubTab>('pulse');
  const [visited, setVisited] = useState<Set<FriendsSubTab>>(() => new Set<FriendsSubTab>(['pulse']));
  const [focus, setFocus] = useState<{ sub: FriendsSubTab; id: string | null } | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    try {
      const value = await fetchFriendsEligibility();
      if (!mounted.current) return;
      setElig(value);
      if (userId) cachedEligibility = { userId, value };
    } catch (e: any) {
      if (!mounted.current) return;
      // Signed out, or an older server without Friends (404): only the campus feed is shown.
      if (isCampusAuthError(e) || e?.status === 404) {
        setElig(null);
        cachedEligibility = null;
      }
      // Network / cold start: keep whatever we had; the next reconnect retries.
    } finally {
      if (mounted.current) setLoaded(true);
    }
  }, [userId]);

  // Load on open, and again when verification changes (verified → Friends unlocks without a restart).
  useEffect(() => {
    load();
  }, [load, profile?.verificationStatus, profile?.campusId]);

  // Refetch after the live connection comes back (flags or restrictions may have changed meanwhile).
  useEffect(() => {
    let wasDown = false;
    return subscribeCampusConnection((state) => {
      if (state === 'connected') {
        if (wasDown) load();
        wasDown = false;
      } else if (state === 'disconnected') {
        wasDown = true;
      }
    });
  }, [load]);

  // Sub-tabs to list: Pulse always; others when on for this student, or (if the server shares
  // `available`) when on for the campus, so an unverified / restricted student sees the gate explaining why.
  const enabled = useMemo<FriendsSubTab[]>(
    () =>
      FRIENDS_SUB_TABS.filter(
        (t) => t === 'pulse' || (!!elig?.eligible && !!elig.features?.[t]) || (!!elig && !elig.eligible && !!elig.available?.[t])
      ),
    [elig]
  );

  // A sub-tab that was switched off (or a restriction) while open: fall back to Pulse.
  useEffect(() => {
    if (!enabled.includes(active)) setActive('pulse');
  }, [enabled, active]);

  const select = useCallback((t: FriendsSubTab) => {
    setActive(t);
    setVisited((prev) => (prev.has(t) ? prev : new Set(prev).add(t)));
  }, []);

  // Deep link (notification / share link): open the sub-tab once it is known to be available.
  const appliedLink = useRef('');
  useEffect(() => {
    if (!linkSub || !linkKey || appliedLink.current === linkKey) return;
    if (linkSub !== 'pulse' && !enabled.includes(linkSub)) {
      // Not available (yet): wait for eligibility; if it never turns on, Pulse stays open.
      if (!elig) return;
      appliedLink.current = linkKey;
      return;
    }
    appliedLink.current = linkKey;
    select(linkSub);
    setFocus({ sub: linkSub, id: linkId || null });
  }, [linkSub, linkId, linkKey, enabled, elig, select]);

  const guidelinesAccepted = !!elig?.guidelines?.accepted;
  const sanctioned = !!elig && elig.reasons?.includes('FRIENDS_SANCTIONED');
  const showChrome = enabled.length > 1;
  const focusFor = (t: FriendsSubTab) => (focus && focus.sub === t ? focus.id : null);

  const renderSub = (t: FriendsSubTab) => {
    if (t === 'pulse') {
      const pulseOn = !!elig?.eligible && !!elig?.features?.pulse;
      // Pulse writes need the guidelines; ask once before the feed opens (like the other sub-tabs).
      if (pulseOn && !guidelinesAccepted) {
        return (
          <View style={styles.dark}>
            <GuidelinesGate
              onAccepted={(version) => {
                setElig((e) => (e ? { ...e, guidelines: { ...e.guidelines, accepted: true, acceptedVersion: version } } : e));
                load();
              }}
            />
          </View>
        );
      }
      return (
        <PulseHome
          enabled={pulseOn}
          eligibility={elig}
          focusId={focusFor('pulse')}
          linkKey={linkSub === 'pulse' ? linkKey || null : null}
          active={active === 'pulse'}
          profile={profile}
          user={user}
          segment={pulseSegment}
          onChangeSegment={onChangePulseSegment}
          onOpenWhispers={onOpenWhispers}
          onOpenNightQuestion={onOpenNightQuestion}
          onOpenBranchWars={onOpenBranchWars}
          onOpenSpace={(spaceId) => {
            if (!enabled.includes('spaces')) return;
            select('spaces');
            setFocus({ sub: 'spaces', id: spaceId });
          }}
          onGateError={load}
          onOpenVerify={onOpenVerify}
          onOpenSafety={onOpenSafety}
        />
      );
    }
    if (elig && !elig.eligible) {
      return (
        <View style={[styles.dark, { justifyContent: 'center' }]}>
          <EligibilityGate eligibility={elig} onVerify={onOpenVerify} onOpenSafety={onOpenSafety} />
        </View>
      );
    }
    if (!guidelinesAccepted) {
      return (
        <View style={styles.dark}>
          <GuidelinesGate
            onAccepted={(version) => {
              setElig((e) => (e ? { ...e, guidelines: { ...e.guidelines, accepted: true, acceptedVersion: version } } : e));
              load();
            }}
          />
        </View>
      );
    }
    const common = { focusId: focusFor(t), onOpenChat };
    return (
      <View style={styles.dark}>
        {t === 'spaces' ? <SpacesHome {...common} userId={userId || null} active={active === 'spaces'} onGateError={load} /> : null}
        {t === 'forum' ? <ForumHome {...common} userId={userId || null} roles={profile?.roles || []} active={active === 'forum'} onGateError={load} /> : null}
        {t === 'tasks' ? <TasksHome {...common} userId={userId || null} active={active === 'tasks'} onGateError={load} /> : null}
        {t === 'connect' ? <ConnectHome {...common} userId={userId || null} active={active === 'connect'} onGateError={load} onOpenSafety={onOpenSafety} /> : null}
      </View>
    );
  };

  if (!loaded) {
    return (
      <View style={styles.root} accessibilityLabel="Loading Friends">
        {/* Same shape as the tab strip + feed, so nothing jumps when Friends appears. */}
        <View style={styles.skelTabs}>
          {[64, 76, 70, 66].map((w, i) => (
            <SkeletonBlock key={i} width={w} height={14} radius={7} />
          ))}
        </View>
        <FriendsSkeleton rows={3} />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      {showChrome ? <SubTabBar tabs={enabled} value={active} onChange={select} /> : null}

      {sanctioned ? (
        <TouchableOpacity style={styles.sanction} onPress={onOpenSafety} activeOpacity={0.8} accessibilityRole="button" accessibilityLabel="Friends is restricted for you. See decision and appeal.">
          <ShieldAlert size={16} color={FriendsColors.danger} />
          <Text style={[FT.small, { color: FriendsColors.danger, flex: 1, fontWeight: '700' }]}>
            Parts of Friends are restricted for you. See the decision and appeal.
          </Text>
          <ChevronRight size={16} color={FriendsColors.danger} />
        </TouchableOpacity>
      ) : null}

      {showChrome && active !== 'pulse' ? <OfflineBanner /> : null}

      {enabled
        .filter((t) => visited.has(t) || t === active)
        .map((t) => (
          <View key={t} style={[styles.page, t !== active && styles.hidden]} accessibilityElementsHidden={t !== active} importantForAccessibility={t === active ? 'auto' : 'no-hide-descendants'}>
            {renderSub(t)}
          </View>
        ))}
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: FriendsColors.bg },
  page: { flex: 1 },
  hidden: { display: 'none' },
  dark: { flex: 1, backgroundColor: FriendsColors.bg },
  skelTabs: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 22,
    paddingHorizontal: FS.xl,
    height: 50,
    borderBottomWidth: StyleSheet.hairlineWidth * 2,
    borderBottomColor: FriendsColors.line,
  },
  sanction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: FS.lg,
    paddingVertical: 10,
    minHeight: 44,
    backgroundColor: FriendsColors.dangerSoft,
    borderBottomWidth: StyleSheet.hairlineWidth * 2,
    borderBottomColor: 'rgba(243,139,128,0.25)',
  },
});
