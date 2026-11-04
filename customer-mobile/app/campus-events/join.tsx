// Zenvy Campus Events: open a team join link (zenvy://campus-events/join?t=<token>). Joining is the student's
// own action (consent): nothing happens until they tap Join. First the link is previewed (GET
// /team-join/preview: team name, event, roster count, captain's first name; no personal details), then the
// server checks the hashed token, expiry, blocks, eligibility, team size and the one-team-per-event rule.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../context/AuthContext';
import { campusEventsApi, errorCopy, needsVerification, fmtWhen, CATEGORY_META, type JoinPreview } from '../../modules/campusEvents/campusEventsApi';
import { EHeader, usePalette, Btn, Notice, StateView, CE_HOME } from '../../modules/campusEvents/ui';

export default function JoinTeamScreen() {
  const params = useLocalSearchParams<{ t?: string | string[] }>();
  const token = String(Array.isArray(params.t) ? params.t[0] : params.t || '').trim();
  const router = useRouter();
  const p = usePalette();
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<{ title: string; message: string; verify?: boolean } | null>(null);
  const [preview, setPreview] = useState<JoinPreview | null>(null);
  const [previewState, setPreviewState] = useState<'loading' | 'ok' | 'invalid' | 'error'>('loading');
  const valid = /^[A-Za-z0-9_-]{30,64}$/.test(token);
  const signedIn = !!((user as any)?.id || (user as any)?._id);

  const loadPreview = useCallback(async () => {
    if (!valid || !signedIn) return;
    setPreviewState('loading');
    try {
      const r = await campusEventsApi.joinPreview(token);
      setPreview(r.preview);
      setPreviewState('ok');
    } catch (e: any) {
      // 404 = bad / expired / revoked link. Anything else (offline, older server): joining still works.
      if (e?.status === 404) setPreviewState('invalid');
      else { setPreviewState('error'); setErr(e?.status === 429 ? errorCopy(e) : null); }
    }
  }, [token, valid, signedIn]);
  useEffect(() => { loadPreview(); }, [loadPreview]);

  const join = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await campusEventsApi.joinByLink(token);
      router.replace(`/campus-events/team/${r.team.id}` as any);
    } catch (e: any) {
      setErr({ ...errorCopy(e), verify: needsVerification(e) });
    } finally {
      setBusy(false);
    }
  };

  const pv = preview;
  const cat = pv ? CATEGORY_META[pv.event.category] : null;
  const size = pv ? (pv.team.teamMax ? `${pv.team.rosterCount} of ${pv.team.teamMax} players` : `${pv.team.rosterCount} player${pv.team.rosterCount === 1 ? '' : 's'}`) : '';

  return (
    <View style={{ flex: 1, backgroundColor: p.bg }}>
      <EHeader title="Join a team" onBack={() => (router.canGoBack() ? router.back() : router.replace(CE_HOME as any))} />
      {!signedIn ? (
        <StateView kind="empty" icon="lock-closed-outline" title="Sign in to join" message="Team join links work for verified students signed in to ZenWe." actionLabel="Sign in" onAction={() => router.push('/login' as any)} />
      ) : !valid || previewState === 'invalid' ? (
        <StateView kind="error" icon="link-outline" title="This link is not valid" message="It may have expired or been replaced. Ask your captain to share the join link again." actionLabel="Campus Events" onAction={() => router.replace(CE_HOME as any)} />
      ) : previewState === 'loading' ? (
        <StateView kind="loading" />
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, paddingTop: 32 }}>
          <Ionicons name="people-outline" size={54} color={p.accent} style={{ alignSelf: 'center' }} />
          {pv ? (
            <>
              <Text style={{ fontSize: 20, fontWeight: '900', color: p.text, textAlign: 'center', marginTop: 8 }} accessibilityRole="header">Join {pv.team.name}</Text>
              <Text style={{ fontSize: 13, color: p.sub, textAlign: 'center', marginTop: 4 }}>{pv.team.captainFirstName ? `Captain: ${pv.team.captainFirstName} · ` : ''}{size}</Text>
              <View style={{ marginTop: 16, marginBottom: 14, padding: 14, borderRadius: 16, borderWidth: 1, borderColor: p.border, backgroundColor: p.card2 }}
                accessible accessibilityLabel={`Event ${pv.event.title}, ${fmtWhen(pv.event.startAt)}${pv.event.venue ? `, ${pv.event.venue}` : ''}`}>
                <Text style={{ fontSize: 12, fontWeight: '800', color: cat ? cat.color : p.sub, letterSpacing: 0.2 }}>{cat ? cat.label : 'Event'}</Text>
                <Text style={{ fontSize: 16, fontWeight: '900', color: p.text, marginTop: 4 }}>{pv.event.title}</Text>
                <Text style={{ fontSize: 12.5, color: p.sub, marginTop: 4 }}><Ionicons name="calendar-outline" size={13} color={p.sub} /> {fmtWhen(pv.event.startAt)}</Text>
                {pv.event.venue ? <Text style={{ fontSize: 12.5, color: p.sub, marginTop: 2 }}><Ionicons name="location-outline" size={13} color={p.sub} /> {pv.event.venue}</Text> : null}
              </View>
              {!pv.canJoin && pv.message ? <Notice tone={pv.alreadyMember ? 'info' : 'warn'} icon={pv.alreadyMember ? 'checkmark-circle-outline' : 'warning-outline'}>{pv.message}</Notice> : null}
            </>
          ) : (
            <Text style={{ fontSize: 20, fontWeight: '900', color: p.text, textAlign: 'center', marginTop: 8 }}>You were invited to a team</Text>
          )}
          <Text style={{ fontSize: 13, color: p.sub, textAlign: 'center', marginTop: 6, marginBottom: 18, lineHeight: 19 }}>
            Joining adds you to the captain&apos;s roster for that event. The captain and teammates will see your name.
          </Text>
          {err ? <Notice tone="danger" icon="warning-outline">{err.title}: {err.message}</Notice> : null}
          {err?.verify ? <Btn label="Verify my college" kind="secondary" onPress={() => router.push('/friends?screen=verification' as any)} style={{ marginBottom: 10 }} /> : null}
          {pv?.alreadyMember ? (
            <Btn label="Open Campus Events" onPress={() => router.replace(CE_HOME as any)} />
          ) : (
            <Btn label="Join team" onPress={join} loading={busy} disabled={!!pv && !pv.canJoin && pv.reason !== 'VERIFICATION_REQUIRED' && pv.reason !== 'CAMPUS_REQUIRED'} />
          )}
          {pv && !pv.canJoin && (pv.reason === 'VERIFICATION_REQUIRED' || pv.reason === 'CAMPUS_REQUIRED') ? (
            <Btn label="Verify my college" kind="secondary" onPress={() => router.push('/friends?screen=verification' as any)} style={{ marginTop: 10 }} />
          ) : null}
          <Btn label="Not now" kind="ghost" onPress={() => router.replace(CE_HOME as any)} style={{ marginTop: 10 }} />
        </ScrollView>
      )}
    </View>
  );
}
