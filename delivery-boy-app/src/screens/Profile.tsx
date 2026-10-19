// Profile: identity, vehicle, documents status, voice, support, safety, account.
import React, { useEffect, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Constants from 'expo-constants';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { C, R, S, T } from '../theme';
import { Badge, Btn, Card, Label, Row, ScreenHeader } from '../ui/kit';
import { Sheet } from '../ui/Sheet';
import { NetImage } from '../ui/NetImage';
import { useRider } from '../state/RiderStore';
import { useVoice } from '../voice/useVoice';
import { LANG_LABEL } from '../voice/phrases';
import * as links from '../services/links';
import { ApiError, errorMessage } from '../services/apiClient';
import * as api from '../services/deliveryApi';
import { indianMobileDigits } from '../services/orderModel';
import { SUPPORT_PHONE } from '../config';
import { LEGAL_LABELS, SETTINGS_PAGES, openLegal } from '../services/legal';

const VEHICLES = ['Bicycle', 'Scooter', 'Motorcycle', 'E-bike'];

export function ProfileScreen() {
  const r = useRider();
  const voice = useVoice();
  const p = r.profile;
  const [refreshing, setRefreshing] = useState(false);
  const [edit, setEdit] = useState(false);
  const [pwd, setPwd] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    r.refreshProfile();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!p) return null;
  const rating = p.averageRating !== null ? `★ ${p.averageRating.toFixed(1)}${p.totalRatings ? ` (${p.totalRatings})` : ''}` : 'No ratings yet';
  const version = Constants.expoConfig?.version ?? null;

  return (
    <ScrollView
      contentContainerStyle={{ paddingBottom: S.xxl }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={async () => {
            setRefreshing(true);
            try {
              await r.refreshProfile();
            } finally {
              setRefreshing(false);
            }
          }}
        />
      }
    >
      <ScreenHeader title="Profile" />
      <View style={styles.content}>
        <Card style={styles.idCard}>
          <NetImage
            uri={p.photoUrl}
            style={styles.avatar}
            accessibilityLabel="Profile photo"
            fallback={
              <View style={[styles.avatar, { backgroundColor: C.ink, alignItems: 'center', justifyContent: 'center' }]}>
                <Text style={[T.h1, { color: C.white }]}>{(p.name || '?').charAt(0).toUpperCase()}</Text>
              </View>
            }
          />
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={[T.h2, { color: C.ink }]} numberOfLines={1}>
              {p.name || '—'}
            </Text>
            <Text style={[T.body, { color: C.ink2 }]}>+91 {p.phone}</Text>
            <Text style={[T.small, { color: C.muted }]}>
              {rating}
              {p.completedCount !== null ? ` · ${p.completedCount} deliver${p.completedCount === 1 ? 'y' : 'ies'}` : ''}
            </Text>
          </View>
        </Card>

        <Card style={{ gap: S.sm }}>
          <Label>DOCUMENTS</Label>
          {p.isApproved ? (
            <Badge tone="green" icon="check-decagram" label="Verified by Zenvy" />
          ) : (
            <Badge tone="amber" icon="clock-outline" label="Waiting for verification" />
          )}
          <Text style={[T.small, { color: C.ink2 }]}>Your licence and ID are checked by the Zenvy fleet team. Call support to update them.</Text>
        </Card>

        <Card style={{ paddingVertical: S.xs }}>
          <Row
            icon="moped-outline"
            label={p.vehicleType ?? 'Add vehicle type'}
            value={p.vehicleNumber ?? 'Add vehicle number'}
            warn={!p.vehicleType || !p.vehicleNumber}
            onPress={() => setEdit(true)}
          />
          <Row
            icon="account-heart-outline"
            label="Emergency contact"
            value={p.emergencyContact ? `+91 ${p.emergencyContact}` : 'Not added yet'}
            warn={!p.emergencyContact}
            onPress={() => setEdit(true)}
          />
          <Row
            icon={voice.enabled ? 'volume-high' : 'volume-off'}
            label="Voice announcements"
            value={voice.enabled ? LANG_LABEL[voice.effectiveLang] : 'Off'}
            onPress={() => r.setOverlay({ kind: 'voice' })}
          />
        </Card>

        <Card style={{ paddingVertical: S.xs }}>
          <Row icon="lifebuoy" label="Help & support" value="Raise a ticket, see replies" onPress={() => r.setOverlay({ kind: 'support' })} />
          <Row icon="phone-outline" label="Call Zenvy" value="Talk to the fleet team" onPress={() => links.callNumber(`+${SUPPORT_PHONE}`)} />
          <Row icon="lock-reset" label="Change password" onPress={() => setPwd(true)} />
          <Row icon="account-remove-outline" label="Delete account" value="Close your rider account" onPress={() => setDeleting(true)} />
        </Card>

        <Card style={{ paddingVertical: S.xs }}>
          {SETTINGS_PAGES.map((p) => (
            <Row key={p} icon="file-document-outline" label={LEGAL_LABELS[p]} onPress={() => openLegal(p)} />
          ))}
        </Card>

        <Btn title="Emergency 112" icon="phone-alert" variant="red" size="mid" onPress={() => links.callNumber('112')} />
        <Btn title="Log out" icon="logout" variant="outline" size="mid" textColor={C.red} onPress={() => setConfirmLogout(true)} />
        {version ? <Text style={[T.small, { color: C.muted, textAlign: 'center' }]}>Zenvy Rider {version}</Text> : null}
      </View>

      <EditProfileSheet visible={edit} onClose={() => setEdit(false)} />
      <ChangePasswordSheet visible={pwd} onClose={() => setPwd(false)} />
      <DeleteAccountSheet visible={deleting} onClose={() => setDeleting(false)} />
      <Sheet visible={confirmLogout} onClose={() => setConfirmLogout(false)} title="Log out?">
        <Text style={[T.body, { color: C.ink2 }]}>
          {r.active.data.length
            ? `You still have ${r.active.data.length} active deliver${r.active.data.length === 1 ? 'y' : 'ies'}. Finish first if you can.`
            : 'You will go offline and stop getting orders.'}
        </Text>
        {r.syncPendingIds.size ? (
          <Text style={[T.body, { color: C.red, fontWeight: '700' }]} accessibilityRole="alert">
            {`${r.syncPendingIds.size} order step${r.syncPendingIds.size === 1 ? ' is' : 's are'} not sent yet (no internet). Connect to the internet and wait a moment first, or ${r.syncPendingIds.size === 1 ? 'it' : 'they'} will be lost when you log out.`}
          </Text>
        ) : null}
        <View style={{ flexDirection: 'row', gap: S.md }}>
          <Btn title="Cancel" variant="outline" size="mid" onPress={() => setConfirmLogout(false)} style={{ flex: 1 }} />
          <Btn
            title="Log out"
            variant="red"
            size="mid"
            onPress={async () => {
              setConfirmLogout(false);
              await r.logout();
            }}
            style={{ flex: 1 }}
          />
        </View>
      </Sheet>
    </ScrollView>
  );
}

function Field({ label, ...props }: { label: string } & React.ComponentProps<typeof TextInput>) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={[T.label, { color: C.ink2 }]}>{label}</Text>
      <TextInput placeholderTextColor={C.muted} {...props} style={[T.body, styles.input]} accessibilityLabel={label} />
    </View>
  );
}

function ErrorLine({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }} accessibilityRole="alert">
      <MaterialCommunityIcons name="alert-circle" size={20} color={C.red} />
      <Text style={[T.body, { color: C.red, flex: 1, fontWeight: '700' }]}>{text}</Text>
    </View>
  );
}

function EditProfileSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const r = useRider();
  const p = r.profile;
  const [name, setName] = useState('');
  const [vehicleType, setVehicleType] = useState('');
  const [vehicleNumber, setVehicleNumber] = useState('');
  const [emergency, setEmergency] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible && p) {
      setName(p.name || '');
      setVehicleType(p.vehicleType || '');
      setVehicleNumber(p.vehicleNumber || '');
      setEmergency(p.emergencyContact || '');
      setError(null);
    }
    // only when opening
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // "+91 98765 43210" (pasted from contacts) is 9876543210; a number that is not 10 digits is refused, never cut
  // down to its last 10 digits (that saved a wrong emergency number).
  const emergencyDigits = indianMobileDigits(emergency);
  const emergencyOk = emergencyDigits.length === 0 || /^\d{10}$/.test(emergencyDigits);
  const valid = name.trim().length >= 2 && emergencyOk;

  const save = async () => {
    setError(null);
    try {
      await r.saveProfileEdits({
        name: name.trim(),
        vehicleType: vehicleType.trim(),
        vehicleNumber: vehicleNumber.trim().toUpperCase(),
        emergencyContact: emergencyDigits,
      });
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <Sheet visible={visible} onClose={onClose} title="Edit profile" footer={<Btn title="Save" icon="content-save" onPress={save} disabled={!valid} />}>
      <Field label="NAME" value={name} onChangeText={setName} autoCapitalize="words" />
      <View style={{ gap: 6 }}>
        <Text style={[T.label, { color: C.ink2 }]}>VEHICLE TYPE</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: S.sm }}>
          {VEHICLES.map((v) => (
            <Btn
              key={v}
              title={v}
              size="small"
              variant={vehicleType === v ? 'green' : 'outline'}
              icon={vehicleType === v ? 'check' : undefined}
              onPress={() => setVehicleType(v)}
            />
          ))}
        </View>
      </View>
      <Field label="VEHICLE NUMBER" value={vehicleNumber} onChangeText={setVehicleNumber} autoCapitalize="characters" placeholder="e.g. AP 39 AB 1234" />
      <Field label="EMERGENCY CONTACT (10 DIGITS)" value={emergency} onChangeText={setEmergency} keyboardType="phone-pad" maxLength={18} />
      <ErrorLine text={error ?? (emergencyOk ? null : 'Enter a 10-digit mobile number for your emergency contact.')} />
    </Sheet>
  );
}

function ChangePasswordSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { showToast, changePassword } = useRider();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (visible) {
      setCurrent('');
      setNext('');
      setError(null);
    }
  }, [visible]);
  const ok = current.length > 0 && next.length >= 6;
  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="Change password"
      footer={
        <Btn
          title="Update password"
          disabled={!ok}
          onPress={async () => {
            setError(null);
            try {
              await changePassword(current, next);
              showToast('Password updated.', 'success');
              onClose();
            } catch (e) {
              setError(errorMessage(e));
            }
          }}
        />
      }
    >
      <Field label="CURRENT PASSWORD" value={current} onChangeText={setCurrent} secureTextEntry autoCapitalize="none" />
      <Field label="NEW PASSWORD (6+ CHARACTERS)" value={next} onChangeText={setNext} secureTextEntry autoCapitalize="none" />
      <ErrorLine text={error} />
    </Sheet>
  );
}

// C9: Google Play account deletion. Server: /api/delivery/account/* (blockers, password or SMS code, DELETE).
function DeleteAccountSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { deleteAccount } = useRider();
  const [check, setCheck] = useState<api.DeletionCheck | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [useCode, setUseCode] = useState(false);
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [confirm, setConfirm] = useState('');
  const [codeInfo, setCodeInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setCheckError(null);
    try {
      setCheck(await api.fetchDeletionCheck());
    } catch (e) {
      setCheckError(errorMessage(e));
    }
  };
  useEffect(() => {
    if (visible) {
      setCheck(null);
      setUseCode(false);
      setPassword('');
      setOtp('');
      setConfirm('');
      setCodeInfo(null);
      setError(null);
      load();
    }
    // only when opening
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const sendCode = async () => {
    setError(null);
    setBusy(true);
    try {
      setCodeInfo(await api.sendDeleteOtp());
    } catch (e) {
      if (e instanceof ApiError && (e.code === 'SMS_UNAVAILABLE' || e.code === 'SMS_BUDGET')) {
        // SMS is switched off on the server: go back to the password, which always works.
        setUseCode(false);
        setError('SMS codes are not available right now. Confirm with your password, or call Zenvy support and we will close your account.');
      } else {
        setError(errorMessage(e));
      }
    } finally {
      setBusy(false);
    }
  };

  const ready = !!check?.canDelete && (useCode ? /^\d{6}$/.test(otp) : password.length > 0) && confirm.trim().toUpperCase() === 'DELETE';
  const remove = async () => {
    setError(null);
    setBusy(true);
    try {
      await deleteAccount(useCode ? { otp } : { password });
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="Delete account"
      footer={check?.canDelete ? <Btn title="Delete my account" icon="delete-outline" variant="red" onPress={remove} disabled={!ready || busy} /> : undefined}
    >
      <Text style={[T.body, { color: C.ink2 }]}>
        Deleted: your name, mobile number, password, photo, vehicle number, emergency contact, location, notifications, order chat
        and push tokens. You are signed out on every phone.
      </Text>
      <Text style={[T.body, { color: C.ink2 }]}>
        Kept without your personal details (the law requires it): past deliveries, cash deposits, earnings and payouts.
      </Text>
      <Text style={[T.body, { color: C.blue, fontWeight: '800' }]} onPress={() => openLegal('deleteAccount')} accessibilityRole="link">
        Read the full details
      </Text>
      {!check && !checkError ? <Text style={[T.small, { color: C.muted }]}>Checking your account…</Text> : null}
      {checkError ? (
        <View style={{ gap: S.sm }}>
          <ErrorLine text={checkError} />
          <Btn title="Try again" variant="outline" size="mid" onPress={load} />
        </View>
      ) : null}
      {check?.blockers.map((b) => (
        <ErrorLine key={b.code + b.message} text={b.message} />
      ))}
      {check?.canDelete ? (
        <>
          {useCode ? (
            <>
              <Btn
                title={codeInfo ? 'Send the code again' : `Send a code to ${check.phoneMasked || 'my number'}`}
                variant="outline"
                size="mid"
                onPress={sendCode}
                disabled={busy}
              />
              {codeInfo ? <Text style={[T.small, { color: C.ink2 }]}>{codeInfo}</Text> : null}
              <Field label="SMS CODE" value={otp} onChangeText={(t) => setOtp(t.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad" maxLength={6} />
            </>
          ) : (
            <Field label="YOUR PASSWORD" value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" />
          )}
          <Text
            style={[T.body, { color: C.blue, fontWeight: '800' }]}
            onPress={() => {
              setUseCode(!useCode);
              setError(null);
            }}
            accessibilityRole="button"
          >
            {useCode ? 'Use my password instead' : 'Forgot your password? Use an SMS code'}
          </Text>
          <Field label="TYPE DELETE TO CONFIRM" value={confirm} onChangeText={setConfirm} autoCapitalize="characters" />
          <ErrorLine text={error} />
          <Text
            style={[T.small, { color: C.ink2 }]}
            onPress={() => links.callNumber(`+${SUPPORT_PHONE}`)}
            accessibilityRole="button"
          >
            Forgot your password and no SMS code? Call Zenvy support to close your account.
          </Text>
        </>
      ) : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: S.lg, gap: S.lg },
  idCard: { flexDirection: 'row', alignItems: 'center', gap: S.lg },
  avatar: { width: 72, height: 72, borderRadius: 36 },
  input: {
    minHeight: 54,
    borderRadius: R.md,
    borderWidth: 2,
    borderColor: C.line,
    paddingHorizontal: S.lg,
    color: C.ink,
    backgroundColor: C.card,
  },
});
