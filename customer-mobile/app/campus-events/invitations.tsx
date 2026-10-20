// Zenvy Campus Events: my pending team invitations (accept / decline). Accepting re-checks eligibility, team size
// and the one-team-per-event rule on the server; an unaccepted invite never counts as a player.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, FlatList, RefreshControl, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { campusEventsApi, CampusEventsError, errorCopy, fmtWhen, fromNow, CATEGORY_META, type Invitation } from '../../modules/campusEvents/campusEventsApi';
import { EHeader, usePalette, Card, Btn, ErrorState, StateView, CE_HOME } from '../../modules/campusEvents/ui';
import { useCampusEventsLive } from '../../modules/campusEvents/useCampusEventsLive';

export default function InvitationsScreen() {
  const router = useRouter();
  const p = usePalette();
  const [list, setList] = useState<Invitation[] | null>(null);
  const [error, setError] = useState<CampusEventsError | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await campusEventsApi.invitations();
      setList(r.invitations);
      setError(null);
    } catch (e: any) {
      setError(e instanceof CampusEventsError ? e : new CampusEventsError(e?.message || 'Could not load invitations.'));
    }
  }, []);
  useEffect(() => { load(); }, [load]);
  useCampusEventsLive(() => load());

  const respond = async (inv: Invitation, accept: boolean) => {
    setBusy(`${inv.id}:${accept}`);
    try {
      const r = await campusEventsApi.respondInvitation(inv.id, accept);
      if (accept && r.team) router.push(`/campus-events/team/${r.team.id}` as any);
      load();
    } catch (e: any) {
      const c = errorCopy(e);
      Alert.alert(c.title, c.message);
      load();
    } finally {
      setBusy(null);
    }
  };
  const decline = (inv: Invitation) => Alert.alert('Decline invitation?', `You will not join ${inv.team?.name || 'this team'}.`, [
    { text: 'Cancel', style: 'cancel' }, { text: 'Decline', style: 'destructive', onPress: () => respond(inv, false) },
  ]);

  return (
    <View style={{ flex: 1, backgroundColor: p.bg }}>
      <EHeader title="Team invitations" />
      {error && !list ? <ErrorState error={error} onRetry={load} onNotFound={() => router.replace(CE_HOME as any)} /> : !list ? <StateView kind="loading" /> : (
        <FlatList
          data={list}
          keyExtractor={(x) => x.id}
          contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={p.accent} />}
          ListEmptyComponent={<StateView kind="empty" icon="mail-outline" title="No invitations" message="When a captain invites you to a team, it shows up here." actionLabel="Browse events" onAction={() => router.push('/campus-events' as any)} />}
          renderItem={({ item }) => {
            const cat = item.event ? CATEGORY_META[item.event.category] || CATEGORY_META.OTHER : CATEGORY_META.OTHER;
            return (
              <Card>
                <Text style={{ fontSize: 12, fontWeight: '800', color: p.accent, letterSpacing: 0.2 }}>{cat.label}</Text>
                <Text style={{ fontSize: 16, fontWeight: '900', color: p.text, marginTop: 4 }}>{item.event?.title}</Text>
                <Text style={{ fontSize: 13, color: p.text, marginTop: 6 }}><Ionicons name="people-outline" size={13} color={p.sub} /> {item.team?.name}{item.team?.captain ? ` · Captain: ${item.team.captain}` : ''}</Text>
                <Text style={{ fontSize: 12.5, color: p.sub, marginTop: 2 }}><Ionicons name="calendar-outline" size={13} color={p.sub} /> {fmtWhen(item.event?.startAt)}{item.event?.venue ? ` · ${item.event.venue}` : ''}</Text>
                {item.expiresAt ? <Text style={{ fontSize: 11.5, color: p.warn, marginTop: 6, fontWeight: '800' }}>Expires {fromNow(item.expiresAt)}</Text> : null}
                <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
                  <Btn label="Decline" small kind="secondary" style={{ flex: 1 }} loading={busy === `${item.id}:false`} onPress={() => decline(item)} />
                  <Btn label="Accept" small style={{ flex: 1 }} loading={busy === `${item.id}:true`} onPress={() => respond(item, true)} />
                </View>
                {item.event ? <Btn label="Event details" small kind="ghost" onPress={() => router.push(`/campus-events/${item.event!.id}` as any)} style={{ marginTop: 8 }} /> : null}
              </Card>
            );
          }}
        />
      )}
    </View>
  );
}
