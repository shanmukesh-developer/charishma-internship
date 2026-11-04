// Verification status hub, Documents upload, Suspended screen. Everything comes from GET /me
// (driver.status, rejection / suspension reason, documents + signed previews, vehicles, missing[]).
import React, { useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { color, font, space } from '../theme';
import { Badge, Button, Card, EmptyState, ErrorStrip, SkeletonCard } from '../ui/kit';
import { Banner, ListRow, Screen, SectionTitle } from '../ui/Screen';
import { DocSlot } from '../ui/DocSlot';
import { useToast } from '../ui/Toast';
import { call } from '../ui/Sos';
import { useSession } from '../state/SessionProvider';
import { driverApi } from '../api/driverApi';
import { ApiError, errorMessage } from '../lib/http';
import { DOC_LABEL, MISSING_LABEL, dateTimeIst } from '../lib/format';
import { SUPPORT_PHONE } from '../config';
import { DRIVER_DOC_KEYS, REQUIRED_DRIVER_DOCS, type DriverStatus, type VehicleStatus } from '../types';
import type { ScreenProps } from '../nav';

export const STATUS_COPY: Record<DriverStatus, { title: string; body: string; fg: string; bg: string }> = {
  PENDING_DOCS: { title: 'Add your details', body: 'Upload your documents and add your auto. Then send them to ZenWe for checking.', fg: color.warning, bg: color.warningTint },
  PENDING_REVIEW: { title: 'ZenWe is checking', body: 'Your documents are with the ZenWe team. You can take bookings as soon as you are verified.', fg: color.info, bg: color.infoTint },
  VERIFIED: { title: 'Verified', body: 'You can go online and publish trips.', fg: color.openDark, bg: color.openTint },
  REJECTED: { title: 'Changes needed', body: 'Fix the points below and send again.', fg: color.alertDark, bg: color.alertTint },
  SUSPENDED: { title: 'Account suspended', body: 'Please contact ZenWe support.', fg: color.alertDark, bg: color.alertTint },
};

export const VEHICLE_BADGE: Record<VehicleStatus, { text: string; fg: string; bg: string }> = {
  PENDING_REVIEW: { text: 'WAITING FOR CHECK', fg: color.info, bg: color.infoTint },
  APPROVED: { text: 'APPROVED', fg: color.openDark, bg: color.openTint },
  REJECTED: { text: 'REJECTED', fg: color.alertDark, bg: color.alertTint },
  SUSPENDED: { text: 'SUSPENDED', fg: color.alertDark, bg: color.alertTint },
};

export function VerificationScreen({ navigation }: ScreenProps<'Verification'>) {
  const { me, meLoading, meError, refreshMe } = useSession();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      const r = await driverApi.submit();
      toast.show(r.message, 'success');
      await refreshMe();
    } catch (e) {
      const miss = e instanceof ApiError && Array.isArray(e.data?.missing) ? e.data.missing.map(MISSING_LABEL).join(', ') : null;
      toast.show(miss ? `Add these first: ${miss}` : errorMessage(e), 'error');
      refreshMe();
    } finally {
      setBusy(false);
    }
  };

  if (!me) {
    return (
      <Screen title="Your account">
        {meError ? <ErrorStrip text={meError} onRetry={refreshMe} busy={meLoading} /> : <><SkeletonCard /><SkeletonCard /></>}
      </Screen>
    );
  }
  const d = me.driver;
  const copy = STATUS_COPY[d.status];
  const canSubmit = d.status === 'PENDING_DOCS' || d.status === 'REJECTED';
  return (
    <Screen
      title="Your account"
      refreshing={meLoading}
      onRefresh={refreshMe}
      footer={canSubmit ? <Button label="Send for review" icon="send" variant="accept" onPress={submit} loading={busy} disabled={me.missing.length > 0} /> :
        d.status === 'PENDING_REVIEW' ? <Button label="Check again" icon="refresh" variant="secondary" onPress={refreshMe} loading={meLoading} /> : null}
    >
      <Card style={{ backgroundColor: copy.bg, borderColor: copy.bg, gap: space.xs }}>
        <Text style={[font.label, { color: copy.fg }]}>VERIFICATION</Text>
        <Text style={[font.h1, { color: copy.fg }]}>{copy.title}</Text>
        <Text style={[font.body, { color: copy.fg }]}>{copy.body}</Text>
        {d.status === 'REJECTED' && d.rejectionReason ? <Text style={[font.h3, { color: copy.fg }]}>Reason: {d.rejectionReason}</Text> : null}
        {d.submittedAt ? <Text style={[font.small, { color: copy.fg }]}>Sent: {dateTimeIst(d.submittedAt)}</Text> : null}
        {d.reviewedAt ? <Text style={[font.small, { color: copy.fg }]}>Checked: {dateTimeIst(d.reviewedAt)}</Text> : null}
      </Card>
      {!me.featureEnabled ? <Banner tone="info" text="Auto-Ride bookings are not open yet. You can finish your verification now." /> : null}
      {me.missing.length && d.status !== 'PENDING_REVIEW' ? (
        <Card style={{ gap: space.xs }}>
          <Text style={[font.h3, { color: color.text }]}>Still needed</Text>
          {me.missing.map((m) => <Text key={m} style={[font.body, { color: color.alertDark }]}>• {MISSING_LABEL(m)}</Text>)}
        </Card>
      ) : null}
      <SectionTitle text="Steps" />
      <ListRow icon="document-text" title="1. Documents" sub={`${REQUIRED_DRIVER_DOCS.filter((k) => d.documents[k]).length} of ${REQUIRED_DRIVER_DOCS.length} required added`} onPress={() => navigation.navigate('Documents')} />
      <ListRow icon="person" title="2. Licence and emergency contact" sub={d.licenceNumber ? `Licence ${d.licenceNumber}` : 'Licence number, expiry date, emergency contact'} onPress={() => navigation.navigate('Profile')} />
      <ListRow icon="car" title="3. Your auto" sub={me.vehicles.length ? me.vehicles.map((v) => `${v.registration || v.registrationNumber}: ${VEHICLE_BADGE[v.status].text.toLowerCase()}`).join(' · ') : 'Add registration, seats and papers'} onPress={() => navigation.navigate('Vehicles')} />
      <SectionTitle text="More" />
      <ListRow icon="key" title="Change password" sub="Set your own password if ZenWe gave you a temporary one" onPress={() => navigation.navigate('Profile')} />
      <ListRow icon="notifications" title="Notifications" onPress={() => navigation.navigate('Notifications')} />
      <ListRow icon="help-buoy" title="Help and support" onPress={() => navigation.navigate('Support')} />
      <ListRow icon="settings" title="Settings" onPress={() => navigation.navigate('Settings')} />
    </Screen>
  );
}

export function DocumentsScreen({ navigation }: ScreenProps<'Documents'>) {
  const { me, refreshMe, meLoading, meError } = useSession();
  const d = me?.driver;
  const save = async (key: string, path: string) => {
    const doIt = async () => { await driverApi.putDocuments({ [key]: path }); await refreshMe(); };
    if (d?.status === 'VERIFIED') {
      await new Promise<void>((resolve, reject) => {
        Alert.alert('Send for checking again?', 'Changing a document after verification sends your account back to ZenWe for checking. You will go offline until then.', [
          { text: 'Keep old one', style: 'cancel', onPress: () => reject(new Error('Not changed.')) },
          { text: 'Change it', style: 'destructive', onPress: () => { doIt().then(resolve, reject); } },
        ]);
      });
    } else await doIt();
  };
  return (
    <Screen title="Documents" onBack={() => navigation.goBack()} refreshing={meLoading} onRefresh={refreshMe}>
      <Banner tone="info" text="Only ZenWe's verification team can see these. We never ask for Aadhaar." />
      {!d ? (meError ? <ErrorStrip text={meError} onRetry={refreshMe} busy={meLoading} /> : <SkeletonCard />) : DRIVER_DOC_KEYS.map((k) => (
        <DocSlot
          key={k}
          label={DOC_LABEL[k]}
          required={REQUIRED_DRIVER_DOCS.includes(k)}
          hasDoc={!!d.documents[k]}
          previewUrl={d.documentPreviews[k]}
          onUploaded={(path) => save(k, path)}
        />
      ))}
    </Screen>
  );
}

export function SuspendedScreen({ message, onSignOut }: { message: string; onSignOut: () => void }) {
  return (
    <Screen title="ZenWe Auto Driver">
      <EmptyState icon="ban" title="Account suspended" body={message} />
      <Button label="Call ZenWe support" icon="call" onPress={() => call(`+${SUPPORT_PHONE}`)} />
      <Button label="Sign out" icon="log-out" variant="secondary" onPress={onSignOut} />
      <View style={{ alignItems: 'center' }}><Badge text="SUSPENDED" fg={color.alertDark} bg={color.alertTint} /></View>
    </Screen>
  );
}
