import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, RefreshControl, StyleSheet } from 'react-native';
import { ChevronLeft, MoreHorizontal, MessageCircle, HeartOff, Ban, Flag, PhoneOff, HeartCrack } from '../../../../components/lucide';
import { FriendsColors, FS, FT, FR, fui } from '../friendsTheme';
import { FriendsSkeleton } from '../shared/FriendsSkeleton';
import { FriendsEmpty, FriendsError } from '../shared/FriendsEmpty';
import { ReportSheet } from '../shared/ReportSheet';
import { formatLocal } from '../shared/RelativeTime';
import { errorCode, isGateError } from '../api/core';
import { ConnectMatch, ConnectStatus, fetchConnectMatch, isUnavailableCard } from '../api/connectApi';
import { ConnectCardView } from './ConnectCardView';
import { ConnectPersonMenu, confirmAndBlock, confirmAndUnmatch } from './ConnectActions';
import { GhostButton, PrimaryButton } from './ConnectUi';
import { SparkCard } from './SparkCard';
import { connectBus, connectErrorMessage, isConnectGateError, matchName } from './connectShared';

import { themedSheet } from '../../../../utils/themeNow';
/** One match: their card, today's Spark, Message (existing campus chat), Unmatch, Block, Report. */
export const MatchScreen: React.FC<{
  id: string;
  initial?: ConnectMatch | null;
  status: ConnectStatus;
  onBack: () => void;
  onOpenChat: (conversationId: string, name: string) => void;
  onGate: (e: any) => void;
}> = ({ id, initial, status, onBack, onOpenChat, onGate }) => {
  const [match, setMatch] = useState<ConnectMatch | null>(initial || null);
  const [loading, setLoading] = useState(!initial);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ended, setEnded] = useState(false);
  const [menu, setMenu] = useState(false);
  const [report, setReport] = useState(false);
  const [photoIdx, setPhotoIdx] = useState(0);

  const load = useCallback(
    async (refresh = false) => {
      if (refresh) setRefreshing(true);
      setError(null);
      try {
        setMatch(await fetchConnectMatch(id));
      } catch (e: any) {
        if (errorCode(e) === 'MATCH_NOT_FOUND') {
          setEnded(true);
          connectBus.emit({ type: 'ended', matchId: id });
        } else {
          if (isGateError(e) || isConnectGateError(e)) onGate(e);
          setError(connectErrorMessage(e, "Couldn't load this match."));
        }
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [id, onGate]
  );

  useEffect(() => {
    load();
  }, [load]);

  useEffect(
    () =>
      connectBus.on((e) => {
        if (e.type === 'ended' && e.matchId === id) setEnded(true);
      }),
    [id]
  );

  const endHere = () => {
    setEnded(true);
    connectBus.emit({ type: 'ended', matchId: id });
  };

  const name = match ? matchName(match) : 'Match';
  const unavailable = match ? isUnavailableCard(match.profile) : false;
  const profileId = match?.profile.profileId || null;

  const top = (
    <View style={styles.top}>
      <TouchableOpacity onPress={onBack} style={styles.icon} accessibilityRole="button" accessibilityLabel="Back to matches">
        <ChevronLeft size={24} color={FriendsColors.ink} />
      </TouchableOpacity>
      <Text style={[FT.h2, { flex: 1 }]} numberOfLines={1} accessibilityRole="header">
        {ended ? 'Match ended' : name}
      </Text>
      {match && !ended ? (
        <TouchableOpacity onPress={() => setMenu(true)} style={styles.icon} accessibilityRole="button" accessibilityLabel={`More options for ${name}`}>
          <MoreHorizontal size={22} color={FriendsColors.ink} />
        </TouchableOpacity>
      ) : null}
    </View>
  );

  if (ended) {
    return (
      <View style={fui.screen}>
        {top}
        <FriendsEmpty icon={<HeartCrack size={22} color={FriendsColors.muted} />} title="This match has ended" subtitle="The chat is closed for both of you." actionLabel="Back to matches" onAction={onBack} />
      </View>
    );
  }

  return (
    <View style={fui.screen}>
      {top}
      {loading && !match ? (
        <FriendsSkeleton rows={2} />
      ) : error && !match ? (
        <FriendsError message={error} onRetry={() => load()} />
      ) : match ? (
        <ScrollView
          contentContainerStyle={{ padding: FS.lg, paddingBottom: 80, gap: FS.lg }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={FriendsColors.accent} colors={[FriendsColors.accent]} progressBackgroundColor={FriendsColors.card} />}
        >
          <Text style={FT.small}>Matched {formatLocal(match.matchedAt)}</Text>
          {match.conversationId ? (
            <PrimaryButton label={`Message ${name}`} onPress={() => onOpenChat(match.conversationId as string, name)} icon={<MessageCircle size={18} color={FriendsColors.accentInk} />} />
          ) : null}
          <SparkCard spark={match.spark} />
          {unavailable ? (
            <View style={fui.cardPad}>
              <Text style={FT.h3}>{name}'s profile isn't available</Text>
              <Text style={[FT.small, { marginTop: 4 }]}>It may be under review. You can still unmatch, block or report.</Text>
            </View>
          ) : (
            <ConnectCardView card={match.profile as any} status={status} onPhotoIndex={setPhotoIdx} />
          )}
          <View style={styles.callsOff} accessible accessibilityLabel="Calls are off in Connect. Chat only.">
            <PhoneOff size={14} color={FriendsColors.muted} />
            <Text style={[FT.small, { flex: 1 }]}>Calls are off in Connect, so it's chat only. Never share your number, room or passwords until you trust someone, and meet in public places on campus.</Text>
          </View>
          <View style={{ gap: FS.sm }}>
            <GhostButton
              label="Unmatch"
              icon={<HeartOff size={16} color={FriendsColors.ink} />}
              onPress={async () => {
                if (await confirmAndUnmatch(match.id, name)) endHere();
              }}
            />
            {profileId ? <GhostButton label={`Report ${name}`} icon={<Flag size={16} color={FriendsColors.danger} />} danger onPress={() => setReport(true)} /> : null}
            <GhostButton
              label={`Block ${name}`}
              icon={<Ban size={16} color={FriendsColors.danger} />}
              danger
              onPress={async () => {
                if (await confirmAndBlock({ name, matchId: match.id })) {
                  endHere();
                  connectBus.emit({ type: 'status' });
                }
              }}
            />
          </View>
        </ScrollView>
      ) : null}

      {match ? (
        <ConnectPersonMenu
          visible={menu}
          onClose={() => setMenu(false)}
          name={name}
          profileId={profileId}
          photoId={!unavailable ? match.profile.photos[photoIdx]?.id || null : null}
          matchId={match.id}
          onUnmatched={endHere}
          onBlocked={() => {
            endHere();
            connectBus.emit({ type: 'status' });
          }}
        />
      ) : null}
      <ReportSheet visible={report} onClose={() => setReport(false)} target={profileId ? { type: 'connect_profile', id: profileId, label: `${name}'s Connect profile` } : null} />
    </View>
  );
};

const styles = themedSheet(() => ({
  top: { flexDirection: 'row', alignItems: 'center', gap: FS.sm, paddingHorizontal: FS.sm, minHeight: 56, borderBottomWidth: 1, borderBottomColor: FriendsColors.lineSoft },
  icon: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  callsOff: { flexDirection: 'row', gap: FS.sm, padding: FS.md, borderRadius: FR.md, backgroundColor: FriendsColors.card, borderWidth: 1, borderColor: FriendsColors.lineSoft },
}));
