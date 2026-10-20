// Zenvy Campus Events: create a team (captain). Name only; players join by accepting an invitation or the
// secure join link. No place is reserved until the captain submits the roster.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, Alert } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { KeyboardAvoidingView } from '../../../../components/KeyboardAvoidingView';
import { campusEventsApi, CampusEventsError, errorCopy, fmtRange, inr, teamSizeLabel, type EventDetail } from '../../../../modules/campusEvents/campusEventsApi';
import { EHeader, usePalette, Card, Btn, Field, ErrorState, StateView, Notice, Row, CE_HOME } from '../../../../modules/campusEvents/ui';

export default function NewTeamScreen() {
  const params = useLocalSearchParams<{ eventId: string | string[] }>();
  const eventId = String(Array.isArray(params.eventId) ? params.eventId[0] : params.eventId || '');
  const router = useRouter();
  const p = usePalette();
  const [ev, setEv] = useState<EventDetail | null>(null);
  const [error, setError] = useState<CampusEventsError | null>(null);
  const [name, setName] = useState('');
  const [nameErr, setNameErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await campusEventsApi.event(eventId);
      setEv(r.event);
      setError(null);
      if (r.event.myTeam) router.replace(`/campus-events/team/${r.event.myTeam.id}` as any);
    } catch (e: any) {
      setError(e instanceof CampusEventsError ? e : new CampusEventsError(e?.message || 'Could not load this event.'));
    }
  }, [eventId, router]);
  useEffect(() => { load(); }, [load]);

  const create = async () => {
    const n = name.trim();
    if (n.length < 2) { setNameErr('Give your team a name (2+ characters).'); return; }
    setBusy(true);
    try {
      const r = await campusEventsApi.createTeam(eventId, n);
      router.replace(`/campus-events/team/${r.team.id}?created=1` as any);
    } catch (e: any) {
      if (e?.field === 'name') setNameErr(e.message);
      else {
        const c = errorCopy(e);
        Alert.alert(c.title, c.message);
      }
    } finally {
      setBusy(false);
    }
  };

  if (!ev) {
    return (
      <View style={{ flex: 1, backgroundColor: p.bg }}>
        <EHeader title="Create a team" />
        {error ? <ErrorState error={error} onRetry={load} notFoundTitle="Event not found" onNotFound={() => router.replace(CE_HOME as any)} /> : <StateView kind="loading" />}
      </View>
    );
  }
  const t = ev.team;
  return (
    <View style={{ flex: 1, backgroundColor: p.bg }}>
      <EHeader title="Create a team" subtitle={ev.title} />
      <KeyboardAvoidingView style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
          <Card>
            <Text style={{ fontSize: 15, fontWeight: '900', color: p.text }}>{ev.title}</Text>
            <Text style={{ fontSize: 12.5, color: p.sub, marginTop: 4 }}><Ionicons name="calendar-outline" size={13} color={p.sub} /> {fmtRange(ev.startAt, ev.endAt)}</Text>
            {t ? <Row label="Team size" value={teamSizeLabel(t.min, t.max)} /> : null}
            {t?.maxTeams && ev.capacity.remaining != null ? <Row label="Team places left" value={`${ev.capacity.remaining} of ${t.maxTeams}`} /> : null}
            <Row label="Team fee" value={ev.price.isFree ? 'Free' : inr(ev.price.total)} />
          </Card>
          {ev.registrationState === 'FULL' ? <Notice tone="warn" icon="list-outline">All team places are taken. You can still form a team and submit it to the waitlist.</Notice> : null}
          <Field label="Team name" required value={name} onChangeText={(v) => { setName(v); setNameErr(null); }} maxLength={40} error={nameErr} placeholder="e.g. Hostel 7 Strikers" autoFocus returnKeyType="done" onSubmitEditing={create} />
          <Notice icon="information-circle-outline">You will be the captain. Next, invite classmates or share a join link. Players count only after they accept. When the roster is ready, submit it to take a team place.</Notice>
          <Btn label="Create team" onPress={create} loading={busy} />
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
