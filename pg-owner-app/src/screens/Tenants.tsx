// Tenants: students whose booking was accepted, with room, move-in date, stay length and this month's rent
// status. Minimal fields only: first name + booking code (no phone numbers: the same privacy rule as Auto-Ride,
// where drivers never see passengers' phones). "Moved out" frees the bed. Past tenants (180 days) below.
import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { color, font, space } from '../theme';
import { Badge, Button, Card, EmptyState, ErrorStrip, Sheet, SkeletonCard } from '../ui/kit';
import { Banner, Screen, SectionTitle } from '../ui/Screen';
import { ListingSwitcher } from '../ui/ListingSwitcher';
import { useListing } from '../state/ListingProvider';
import { useHome } from '../state/HomeProvider';
import { useToast } from '../ui/Toast';
import { ownerApi } from '../api/ownerApi';
import { errorMessage } from '../lib/http';
import { dateLabel, monthsLabel } from '../lib/format';
import type { Booking, Tenant } from '../types';
import type { ScreenProps } from '../nav';

const RENT = {
  received: { text: 'Rent received', fg: color.ok, bg: color.okTint },
  due: { text: 'Rent due', fg: color.warn, bg: color.warnTint },
  not_started: { text: 'Moving in', fg: color.primaryDark, bg: color.primaryTint },
} as const;

export default function TenantsScreen({ navigation }: ScreenProps<'Tenants'>) {
  const { current, reload: reloadListing } = useListing();
  const { refresh: refreshHome } = useHome();
  const toast = useToast();
  const [data, setData] = useState<{ tenants: Tenant[]; past: Booking[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [leaving, setLeaving] = useState<Tenant | null>(null);
  const [busy, setBusy] = useState(false);
  const [leaveError, setLeaveError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!current) return;
    setLoading(true);
    try {
      const r = await ownerApi.tenants(current.id);
      setData({ tenants: r.tenants, past: r.past });
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [current]);
  useEffect(() => { load(); }, [load]);

  const moveOut = async () => {
    if (!leaving || busy) return;
    setBusy(true);
    setLeaveError(null);
    try {
      const r = await ownerApi.moveOut(leaving.id);
      toast.show(r.message, 'success');
      setLeaving(null);
      load();
      refreshHome();
      reloadListing();
    } catch (e) {
      setLeaveError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen title="Tenants" subtitle={current?.name} onBack={() => navigation.goBack()} right={<ListingSwitcher />} refreshing={loading && !!data} onRefresh={load}>
      {error && !data ? <ErrorStrip text={error} onRetry={load} busy={loading} /> : null}
      {!data && !error ? <><SkeletonCard /><SkeletonCard /></> : null}
      {data && !data.tenants.length ? (
        <EmptyState icon="people-outline" title="No tenants yet" body="Students show here once you accept their booking request." />
      ) : null}
      {data?.tenants.map((t) => {
        const r = RENT[t.rentThisMonth] || RENT.due;
        return (
          <Card key={t.id} style={{ gap: space.xs }}>
            <View style={st.row}>
              <View style={st.avatar}><Text style={[font.h3, { color: color.primaryDark }]}>{t.student.firstName.slice(0, 1)}</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={[font.h3, { color: color.text }]}>{t.student.firstName}</Text>
                <Text style={[font.small, { color: color.textMuted }]}>#{t.code} · {t.room ? `Room ${t.room.roomNumber} · ${t.room.label}` : 'Room'}</Text>
              </View>
              <Badge text={r.text} fg={r.fg} bg={r.bg} />
            </View>
            <Text style={[font.small, { color: color.textSecondary }]}>
              {t.checkInDate ? `Move-in ${dateLabel(t.checkInDate)}` : 'Move-in date not set'}{t.durationMonths ? ` · plans to stay ${monthsLabel(t.durationMonths)}` : ''}
            </Text>
            <Button label="Mark as moved out" variant="secondary" size="secondary" icon="exit-outline" onPress={() => { setLeaveError(null); setLeaving(t); }} />
          </Card>
        );
      })}
      {data && data.past.length ? (
        <>
          <SectionTitle text="Moved out (last 6 months)" />
          <Card style={{ gap: 2 }}>
            {data.past.map((p) => (
              <View key={p.id} style={st.past}>
                <Text style={[font.body, { color: color.text, fontWeight: '600', flex: 1 }]}>{p.student.firstName} · {p.room ? `Room ${p.room.roomNumber}` : ''}</Text>
                <Text style={[font.small, { color: color.textMuted }]}>{p.movedOutAt ? dateLabel(p.movedOutAt.slice(0, 10)) : ''}</Text>
              </View>
            ))}
          </Card>
        </>
      ) : null}

      <Sheet visible={!!leaving} onClose={() => setLeaving(null)} title={leaving ? `${leaving.student.firstName} moved out?` : 'Moved out'}>
        <View style={{ gap: space.md }}>
          <Text style={[font.body, { color: color.textSecondary }]}>
            The bed in {leaving?.room ? `room ${leaving.room.roomNumber}` : 'the room'} becomes free again for new students. Their rent records stay.
          </Text>
          {leaveError ? <Banner tone="error" text={leaveError} /> : null}
          <Button label="Yes, mark as moved out" onPress={moveOut} loading={busy} />
          <Button label="Cancel" variant="secondary" onPress={() => setLeaving(null)} />
        </View>
      </Sheet>
    </Screen>
  );
}

const st = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: color.primaryTint, alignItems: 'center', justifyContent: 'center' },
  past: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: color.border },
});
