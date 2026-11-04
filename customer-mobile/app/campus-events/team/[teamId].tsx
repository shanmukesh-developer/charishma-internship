// Zenvy Campus Events: team screen (spec §5). Accepted members see the roster and status; the captain also
// sees pending invitations and can invite (Campus people search), share a secure join link (Share sheet),
// remove a player, hand over captaincy, submit the roster (-> registration with rules / payment) and withdraw
// the team. Members can leave (unless the roster is locked). An invitee sees only the invitation and can
// accept or decline. Nobody joins without their own consent; every change is in the roster history.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, RefreshControl, Alert, Share, TouchableOpacity } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import {
  campusEventsApi, CampusEventsError, errorCopy, fmtWhen, REG_STATUS_META, type Team, type Invitation, type TeamMember, type EventDetail,
} from '../../../modules/campusEvents/campusEventsApi';
import { EHeader, usePalette, Card, Btn, ErrorState, StateView, Notice, Pill, RegStatusPill, SectionTitle, CE_HOME } from '../../../modules/campusEvents/ui';
import PeoplePicker from '../../../modules/campusEvents/PeoplePicker';
import { useCampusEventsLive } from '../../../modules/campusEvents/useCampusEventsLive';

const MEMBER_LABEL: Record<string, { label: string; color: string }> = {
  ACCEPTED: { label: 'Joined', color: '#059669' },
  INVITED: { label: 'Invited · waiting', color: '#D97706' },
};
const HISTORY_LABEL: Record<string, string> = {
  'team.create': 'Team created', 'team.invite': 'Player invited', 'team.invite.revoke': 'Invitation withdrawn',
  'team.member.accept': 'Player joined', 'team.member.decline': 'Invitation declined', 'team.member.left': 'Player left',
  'team.member.remove': 'Player removed', 'team.member.substitute_in': 'Substitute joined', 'team.member.substitute_out': 'Player substituted out',
  'team.captain.transfer': 'Captain changed', 'team.join_link.rotate': 'New join link', 'team.submit': 'Roster submitted', 'team.cancel': 'Team withdrawn',
};

export default function TeamScreen() {
  const params = useLocalSearchParams<{ teamId: string | string[]; created?: string }>();
  const teamId = String(Array.isArray(params.teamId) ? params.teamId[0] : params.teamId || '');
  const router = useRouter();
  const p = usePalette();
  const [team, setTeam] = useState<Team | null>(null);
  const [inv, setInv] = useState<Invitation | null>(null);
  const [ev, setEv] = useState<EventDetail | null>(null);
  const [history, setHistory] = useState<{ action: string; at: string | null }[]>([]);
  const [error, setError] = useState<CampusEventsError | null>(null);
  const [picker, setPicker] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // People invited from this screen in this session (the roster has no user ids), so they cannot be picked twice.
  const [invitedIds, setInvitedIds] = useState<string[]>([]);

  const load = useCallback(async () => {
    try {
      const r = await campusEventsApi.team(teamId);
      setTeam(r.team || null);
      setInv(r.invitation || null);
      const eventId = r.team?.event?.id || r.invitation?.event?.id;
      if (eventId) campusEventsApi.event(eventId).then((e) => setEv(e.event)).catch(() => {});
      if (r.team) campusEventsApi.teamHistory(teamId).then((h) => setHistory(h.history)).catch(() => {});
      setError(null);
    } catch (e: any) {
      setError(e instanceof CampusEventsError ? e : new CampusEventsError(e?.message || 'Could not load this team.'));
    }
  }, [teamId]);
  useEffect(() => { load(); }, [load]);
  useCampusEventsLive((e) => { if (!e.id || e.id === teamId || e.kind === 'reconnect' || e.kind === 'registration' || e.kind === 'team') load(); });

  const run = async (tag: string, fn: () => Promise<any>, done?: (r: any) => void) => {
    setBusy(tag);
    try {
      const r = await fn();
      if (r?.team && r.team.members) setTeam(r.team);
      done?.(r);
      load();
    } catch (e: any) {
      const c = errorCopy(e);
      Alert.alert(c.title, c.message);
      load();
    } finally {
      setBusy(null);
    }
  };

  if (!team && !inv) {
    return (
      <View style={{ flex: 1, backgroundColor: p.bg }}>
        <EHeader title="Team" />
        {error ? <ErrorState error={error} onRetry={load} notFoundTitle="Team not found" onNotFound={() => router.replace(CE_HOME as any)} /> : <StateView kind="loading" />}
      </View>
    );
  }

  // Invitee view: only the invitation.
  if (!team && inv) {
    const open = inv.status === 'INVITED' && (!inv.expiresAt || new Date(inv.expiresAt).getTime() > Date.now());
    return (
      <View style={{ flex: 1, backgroundColor: p.bg }}>
        <EHeader title="Team invitation" subtitle={inv.event?.title} />
        <ScrollView contentContainerStyle={{ padding: 16 }}>
          <Card>
            <Text style={{ fontSize: 18, fontWeight: '900', color: p.text }}><Ionicons name="people-outline" size={18} color={p.accent} /> {inv.team?.name}</Text>
            {inv.team?.captain ? <Text style={{ fontSize: 13, color: p.sub, marginTop: 4 }}>Captain: {inv.team.captain}</Text> : null}
            <Text style={{ fontSize: 13, color: p.text, marginTop: 10 }}>{inv.event?.title}</Text>
            <Text style={{ fontSize: 12.5, color: p.sub, marginTop: 2 }}><Ionicons name="calendar-outline" size={13} color={p.sub} /> {fmtWhen(inv.event?.startAt)}{inv.event?.venue ? ` · ${inv.event.venue}` : ''}</Text>
            {inv.expiresAt ? <Text style={{ fontSize: 12, color: p.warn, marginTop: 8, fontWeight: '800' }}>Respond by {fmtWhen(inv.expiresAt)}</Text> : null}
          </Card>
          {open ? (
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Btn label="Decline" kind="secondary" style={{ flex: 1 }} loading={busy === 'decline'} onPress={() => run('decline', () => campusEventsApi.respondInvitation(inv.id, false), () => router.back())} />
              <Btn label="Accept & join" style={{ flex: 2 }} loading={busy === 'accept'} onPress={() => run('accept', () => campusEventsApi.respondInvitation(inv.id, true))} />
            </View>
          ) : <Notice tone="warn" icon="hourglass-outline">This invitation is no longer open.</Notice>}
          {inv.event ? <Btn label="Event details" kind="ghost" small onPress={() => router.push(`/campus-events/${inv.event!.id}` as any)} style={{ marginTop: 12 }} /> : null}
        </ScrollView>
      </View>
    );
  }

  const t = team as Team;
  const captain = t.isCaptain;
  const accepted = t.members.filter((m) => m.status === 'ACCEPTED');
  const invited = t.members.filter((m) => m.status === 'INVITED');
  const min = t.event?.teamMin ?? 1;
  // No maximum set = unlimited team size (invites stay open, no "team is full").
  const max: number | null = t.event?.teamMax ?? null;
  const full = max != null && accepted.length + invited.length >= max;
  const forming = t.status === 'FORMING';
  const editable = forming || (t.status === 'SUBMITTED' && !!t.event?.allowSubstitutions);
  const reg = t.registration;
  const regOpen = reg && !['CANCELLED', 'EXPIRED', 'REJECTED'].includes(reg.status);

  const shareLink = () => run('link', () => campusEventsApi.joinLink(t.id), async (r) => {
    try {
      await Share.share({ message: `Join my team "${t.name}" for ${t.event?.title || 'a campus event'} on ZenWe. Open this link on your phone (verified students only, expires ${fmtWhen(r.expiresAt)}):\n${r.url}` });
    } catch { /* share sheet dismissed */ }
  });
  const confirmRemove = (m: TeamMember) => Alert.alert(m.status === 'INVITED' ? 'Withdraw invitation?' : `Remove ${m.name}?`, m.status === 'INVITED' ? 'They will no longer be able to join with this invitation.' : 'They leave the team. This is recorded in the roster history.', [
    { text: 'Keep', style: 'cancel' },
    { text: m.status === 'INVITED' ? 'Withdraw' : 'Remove', style: 'destructive', onPress: () => run(`rm-${m.id}`, () => campusEventsApi.removeMember(t.id, m.id), (r) => { if (r?.belowMinimum) Alert.alert('Below minimum size', `The team now has fewer than ${min} players.`); }) },
  ]);
  const confirmCaptain = (m: TeamMember) => Alert.alert(`Make ${m.name} captain?`, 'They will manage the roster and registration. You stay in the team as a player.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Hand over', onPress: () => run(`cap-${m.id}`, () => campusEventsApi.transferCaptain(t.id, m.id)) },
  ]);
  const leave = () => Alert.alert('Leave this team?', captain ? 'Hand over the captaincy first.' : 'You can only rejoin if the captain invites you again.', captain ? [{ text: 'OK' }] : [
    { text: 'Stay', style: 'cancel' },
    { text: 'Leave', style: 'destructive', onPress: () => run('leave', () => campusEventsApi.leaveTeam(t.id), () => router.replace('/campus-events/my' as any)) },
  ]);
  const withdraw = () => Alert.alert('Withdraw the team?', reg ? 'The team place is released. Refunds follow the event cancellation policy.' : 'The team is deleted for everyone.', [
    { text: 'Keep team', style: 'cancel' },
    { text: 'Withdraw', style: 'destructive', onPress: () => run('cancel', () => campusEventsApi.cancelTeam(t.id), () => router.replace('/campus-events/my' as any)) },
  ]);
  const submit = () => {
    if (accepted.length < min) { Alert.alert('Team too small', `You need at least ${min} players who accepted (now ${accepted.length}).`); return; }
    router.push(`/campus-events/register/${t.event?.id}?teamId=${t.id}${ev?.registrationState === 'FULL' ? '&waitlist=1' : ''}` as any);
  };

  return (
    <View style={{ flex: 1, backgroundColor: p.bg }}>
      <EHeader title={t.name} subtitle={t.event?.title} right={<Pill label={t.status === 'FORMING' ? 'Forming' : t.status === 'SUBMITTED' ? 'Registered' : 'Withdrawn'} color={t.status === 'FORMING' ? '#D97706' : t.status === 'SUBMITTED' ? '#059669' : '#64748B'} />} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={p.accent} />}>
        {params.created === '1' && forming ? <Notice tone="success" icon="checkmark-circle-outline">Team created. Invite your players: they join only after accepting.</Notice> : null}
        {reg ? (
          <TouchableOpacity onPress={() => router.push(`/campus-events/registration/${reg.id}` as any)} accessibilityRole="button" accessibilityLabel={`Team registration ${reg.code}, ${REG_STATUS_META[reg.status].label}. Open details`}>
            <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 12, fontWeight: '800', color: p.muted, letterSpacing: 0.2 }}>Team registration</Text>
                <Text style={{ fontSize: 17, fontWeight: '900', color: p.text, letterSpacing: 1.5, marginTop: 2 }}>{reg.code}</Text>
              </View>
              <RegStatusPill status={reg.status} />
              <Ionicons name="chevron-forward" size={18} color={p.accent} />
            </Card>
          </TouchableOpacity>
        ) : null}

        <Card>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
            <Text style={{ flex: 1, fontSize: 15, fontWeight: '900', color: p.text }}>Roster · {max != null ? `${accepted.length}/${max}` : `${accepted.length} player${accepted.length === 1 ? '' : 's'}`}</Text>
            <Text style={{ fontSize: 12, color: accepted.length >= min ? p.success : p.warn, fontWeight: '800' }}>{accepted.length >= min ? <><Ionicons name="checkmark" size={13} color={p.success} /> Minimum met</> : `Need ${min - accepted.length} more`}</Text>
          </View>
          <View style={{ height: 6, borderRadius: 3, backgroundColor: p.card2, overflow: 'hidden', marginBottom: 8 }}>
            <View style={{ width: `${Math.min(100, Math.round((accepted.length / Math.max(1, max ?? Math.max(min, accepted.length))) * 100))}%`, height: '100%', backgroundColor: accepted.length >= min ? p.success : p.warn }} />
          </View>
          {[...accepted, ...invited].map((m) => (
            <View key={m.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderTopWidth: 1, borderTopColor: p.border }}>
              <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: p.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
                {m.role === 'CAPTAIN' ? <Ionicons name="star" size={16} color={p.accent} accessibilityLabel="Captain" /> : <Text style={{ fontWeight: '900', color: p.accent }}>{m.name.slice(0, 1)}</Text>}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 14, fontWeight: '800', color: p.text }} numberOfLines={1}>{m.name}{m.isMe ? ' (you)' : ''}</Text>
                <Text style={{ fontSize: 12, color: MEMBER_LABEL[m.status]?.color || p.sub, fontWeight: '700' }}>{m.role === 'CAPTAIN' ? 'Captain' : MEMBER_LABEL[m.status]?.label || 'Updated'}</Text>
              </View>
              {captain && !m.isMe && editable ? (
                <View style={{ flexDirection: 'row', gap: 6 }}>
                  {m.status === 'ACCEPTED' ? <Btn label="Make captain" small kind="ghost" loading={busy === `cap-${m.id}`} onPress={() => confirmCaptain(m)} /> : null}
                  <Btn label={m.status === 'INVITED' ? 'Withdraw' : 'Remove'} small kind="secondary" loading={busy === `rm-${m.id}`} onPress={() => confirmRemove(m)} />
                </View>
              ) : null}
            </View>
          ))}
        </Card>

        {captain && editable ? (
          <View style={{ gap: 10, marginBottom: 12 }}>
            <Btn label="Invite classmates" icon="person-add-outline" onPress={() => setPicker(true)} disabled={full} />
            <Btn label={t.joinLinkActive ? 'Share join link again' : 'Share a join link'} icon="link-outline" kind="secondary" loading={busy === 'link'} onPress={shareLink} />
            {t.joinLinkActive ? <Btn label="Turn off join link" small kind="ghost" loading={busy === 'revoke'} onPress={() => run('revoke', () => campusEventsApi.revokeJoinLink(t.id))} /> : null}
            {full ? <Text style={{ color: p.sub, fontSize: 12, textAlign: 'center' }}>The team is full (pending invitations count).</Text> : null}
          </View>
        ) : null}
        {!editable && t.status === 'SUBMITTED' ? <Notice icon="lock-closed-outline">The roster is locked: this event does not allow substitutions after registration.</Notice> : null}

        {captain && forming ? (
          <>
            <Notice icon="information-circle-outline">Submitting takes one team place{ev && !ev.price.isFree ? ' and asks how the team fee is paid' : ''}. Players who have not accepted are not counted.</Notice>
            <Btn label={ev?.registrationState === 'FULL' ? 'Submit to the waitlist' : 'Submit roster & register'} onPress={submit} disabled={accepted.length < min || (!!ev && ['CLOSED', 'COMPLETED', 'CANCELLED', 'NOT_OPEN'].includes(ev.registrationState))} />
            {ev && ['CLOSED', 'NOT_OPEN'].includes(ev.registrationState) ? <Text style={{ color: p.sub, fontSize: 12, textAlign: 'center', marginTop: 6 }}>{ev.cta?.label}</Text> : null}
          </>
        ) : null}

        {history.length ? (
          <>
            <SectionTitle>Roster history</SectionTitle>
            <Card>
              {history.slice().reverse().slice(0, 20).map((h, i) => (
                <Text key={i} style={{ fontSize: 12.5, color: p.sub, paddingVertical: 3 }}>• {HISTORY_LABEL[h.action] || 'Roster change'}{h.at ? ` · ${fmtWhen(h.at)}` : ''}</Text>
              ))}
            </Card>
          </>
        ) : null}

        <View style={{ flexDirection: 'row', gap: 10, marginTop: 8 }}>
          {t.event ? <Btn label="Event details" kind="secondary" small onPress={() => router.push(`/campus-events/${t.event!.id}` as any)} style={{ flex: 1 }} /> : null}
          {!captain && t.status !== 'CANCELLED' ? <Btn label="Leave team" kind="secondary" small loading={busy === 'leave'} onPress={leave} style={{ flex: 1 }} /> : null}
          {captain && t.status !== 'CANCELLED' && (forming || regOpen) ? <Btn label="Withdraw team" kind="danger" small loading={busy === 'cancel'} onPress={withdraw} style={{ flex: 1 }} /> : null}
        </View>
      </ScrollView>

      <PeoplePicker visible={picker} title="Invite to your team" actionLabel="Invite" onClose={() => setPicker(false)} busyId={busy?.startsWith('inv-') ? busy.slice(4) : null}
        disabledIds={invitedIds}
        onPick={(person) => run(`inv-${person.userId}`, () => campusEventsApi.invite(t.id, person.userId), () => { setInvitedIds((ids) => [...ids, person.userId]); Alert.alert('Invitation sent', `${person.name} gets a notification and joins once they accept.`); })} />
    </View>
  );
}
