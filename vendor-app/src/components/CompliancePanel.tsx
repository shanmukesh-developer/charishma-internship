// Licences & tax (Settings): FSSAI licence status + owner-editable licence / legal name / GSTIN, and the
// read-only payout details (PAN and payout changes go through Zenvy support; this app never sends them).
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { getCompliance, saveCompliance } from '../lib/api';
import { ApiError, errorMessage } from '../lib/http';
import { useStore } from '../state/StoreProvider';
import { color, font, radius, space, touch } from '../theme';
import type { Compliance, ComplianceEdit, FssaiStatus, FssaiType } from '../types';
import { Badge, Button, Card, Chip, ErrorStrip, IconName, Sheet, SkeletonCard } from '../ui/kit';
import { useToast } from '../ui/Toast';

const TYPES: { value: FssaiType; label: string; sub: string }[] = [
  { value: 'BASIC', label: 'Basic', sub: 'REGISTRATION' },
  { value: 'STATE', label: 'State', sub: 'LICENCE' },
  { value: 'CENTRAL', label: 'Central', sub: 'LICENCE' },
];
const TYPE_LABEL: Record<FssaiType, string> = { BASIC: 'Basic registration', STATE: 'State licence', CENTRAL: 'Central licence' };

const STATUS: Record<FssaiStatus, { text: string; fg: string; bg: string; icon: IconName }> = {
  MISSING: { text: 'MISSING', fg: color.alertDark, bg: color.alertTint, icon: 'alert-circle' },
  EXPIRED: { text: 'EXPIRED', fg: color.alertDark, bg: color.alertTint, icon: 'close-circle' },
  PENDING: { text: 'WAITING FOR ZenWe CHECK', fg: color.warning, bg: color.warningTint, icon: 'time' },
  VERIFIED: { text: 'VERIFIED', fg: color.openDark, bg: color.openTint, icon: 'checkmark-circle' },
};

type Field = 'legalName' | 'fssaiLicenseNumber' | 'fssaiLicenseType' | 'fssaiExpiry' | 'gstin';
type Errors = Partial<Record<Field, string>>;
interface Draft { legalName: string; fssaiLicenseNumber: string; fssaiLicenseType: FssaiType | null; fssaiExpiry: string; gstin: string }

const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

function validDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

function toDraft(c: Compliance | null): Draft {
  return {
    legalName: c?.legalName || '',
    fssaiLicenseNumber: c?.fssaiLicenseNumber || '',
    fssaiLicenseType: c?.fssaiLicenseType || null,
    fssaiExpiry: c?.fssaiExpiry || '',
    gstin: c?.gstin || '',
  };
}

function validate(d: Draft): Errors {
  const e: Errors = {};
  const num = d.fssaiLicenseNumber.trim();
  if (num && !/^\d{14}$/.test(num)) e.fssaiLicenseNumber = 'The FSSAI number has exactly 14 digits.';
  const exp = d.fssaiExpiry.trim();
  if (exp && !validDate(exp)) e.fssaiExpiry = 'Use year-month-day, e.g. 2027-03-31.';
  const gst = d.gstin.trim().toUpperCase();
  if (gst && !GSTIN_RE.test(gst)) e.gstin = 'A GSTIN has 15 characters, e.g. 36ABCDE1234F1Z5.';
  if (d.legalName.trim().length > 150) e.legalName = 'Keep the legal name under 150 characters.';
  return e;
}

/** Only the fields that changed ('' → null clears). */
function diff(d: Draft, c: Compliance | null): ComplianceEdit {
  const out: ComplianceEdit = {};
  const norm = (s: string) => (s.trim() ? s.trim() : null);
  const legalName = norm(d.legalName);
  if (legalName !== (c?.legalName || null)) out.legalName = legalName;
  const num = norm(d.fssaiLicenseNumber);
  if (num !== (c?.fssaiLicenseNumber || null)) out.fssaiLicenseNumber = num;
  if (d.fssaiLicenseType !== (c?.fssaiLicenseType || null)) out.fssaiLicenseType = d.fssaiLicenseType;
  const exp = norm(d.fssaiExpiry);
  if (exp !== (c?.fssaiExpiry || null)) out.fssaiExpiry = exp;
  const gst = norm(d.gstin.toUpperCase());
  if (gst !== (c?.gstin || null)) out.gstin = gst;
  return out;
}

function Row({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <View style={styles.kv}>
      <Text style={[font.small, { color: color.textMuted, width: 118 }]}>{label}</Text>
      <Text style={[font.body, { color: value ? color.text : color.textMuted, flex: 1, fontWeight: value ? '700' : '500' }]} selectable>
        {value || 'Not added'}
      </Text>
    </View>
  );
}

export default function CompliancePanel() {
  const { restaurant } = useStore();
  const rid = restaurant.id;
  const toast = useToast();
  const [data, setData] = useState<Compliance | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Draft>(toDraft(null));
  const [errors, setErrors] = useState<Errors>({});
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  const load = useCallback(async () => {
    if (!rid) return;
    setLoading(true);
    setLoadErr(null);
    try {
      setData(await getCompliance(rid));
    } catch (e) {
      setLoadErr(errorMessage(e, 'Could not load your licence details.'));
    } finally {
      setLoading(false);
    }
  }, [rid]);

  useEffect(() => { load(); }, [load]);

  const openEdit = () => {
    setDraft(toDraft(data));
    setErrors({});
    setSaveErr(null);
    setEditing(true);
  };
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => {
    setDraft((d) => ({ ...d, [k]: v }));
    setErrors((e) => ({ ...e, [k]: undefined }));
  };

  const save = async () => {
    if (savingRef.current) return;
    const errs = validate(draft);
    setErrors(errs);
    setSaveErr(null);
    if (Object.keys(errs).length) return;
    const body = diff(draft, data);
    if (!Object.keys(body).length) { setEditing(false); return; }
    savingRef.current = true;
    setSaving(true);
    try {
      const res = await saveCompliance(rid, body);
      setData(res.compliance);
      setEditing(false);
      toast.show(res.compliance.fssaiStatus === 'PENDING' ? 'Saved. ZenWe will check your licence.' : 'Saved.', 'success');
      load();
    } catch (e) {
      const field = e instanceof ApiError ? (e.data?.field as Field | undefined) : undefined;
      if (field && ['legalName', 'fssaiLicenseNumber', 'fssaiLicenseType', 'fssaiExpiry', 'gstin'].includes(field)) {
        setErrors((x) => ({ ...x, [field]: errorMessage(e) }));
      } else {
        setSaveErr(errorMessage(e, 'Could not save. Please try again.'));
      }
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const st = data ? STATUS[data.fssaiStatus] || STATUS.MISSING : null;

  return (
    <>
      <Text style={[font.label, { color: color.textMuted }]}>LICENCES & TAX</Text>
      {loading && !data ? <SkeletonCard lines={3} /> : null}
      {loadErr && !data ? <ErrorStrip text={loadErr} onRetry={load} busy={loading} /> : null}
      {data && st ? (
        <Card style={{ gap: space.sm }}>
          <View style={[styles.kv, { flexWrap: 'wrap' }]}>
            <Text style={[font.h3, { color: color.text }]}>FSSAI licence</Text>
            <Badge text={st.text} fg={st.fg} bg={st.bg} icon={st.icon} />
            {data.fssaiExpiringSoon && data.fssaiStatus !== 'EXPIRED' ? (
              <Badge text="EXPIRES SOON" fg={color.warning} bg={color.warningTint} icon="warning" />
            ) : null}
          </View>
          <Text style={[font.small, { color: color.textMuted }]}>
            Customers see your FSSAI licence number on your shop page and on their receipts.
          </Text>
          <Row label="Licence number" value={data.fssaiLicenseNumber} />
          <Row label="Type" value={data.fssaiLicenseType ? TYPE_LABEL[data.fssaiLicenseType] : null} />
          <Row label="Valid until" value={data.fssaiExpiry} />
          <Row label="Legal name" value={data.legalName} />
          <Row label="GSTIN" value={data.gstin} />
          <Button label="Edit licence details" icon="create-outline" variant="secondary" size="secondary" onPress={openEdit} />

          <View style={{ height: 1, backgroundColor: color.surfaceAlt }} />
          <Text style={[font.label, { color: color.textSecondary }]}>PAYOUT (READ ONLY)</Text>
          <Row label="UPI ID" value={data.payoutUpiId} />
          <Row label="Bank account" value={data.bankAccountLast4 ? `****${data.bankAccountLast4}` : null} />
          {data.bankAccountHolder ? <Row label="Account name" value={data.bankAccountHolder} /> : null}
          <Row label="IFSC" value={data.bankIfsc} />
          <Row label="PAN" value={data.hasPan ? data.panMasked || 'On file' : null} />
          <Text style={[font.small, { color: color.textMuted }]}>To change PAN or payout details, contact ZenWe support.</Text>
          {loadErr ? <ErrorStrip text={loadErr} onRetry={load} busy={loading} /> : null}
        </Card>
      ) : null}

      <Sheet visible={editing} onClose={() => !saving && setEditing(false)} title="Licence details">
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: space.xs, paddingBottom: space.md }}>
          <Text style={[font.small, { color: color.textMuted }]}>
            Customers see your FSSAI licence number on your shop page and receipts. A new number, type or expiry date
            shows as “Waiting for ZenWe check” until ZenWe verifies it.
          </Text>

          <Text style={styles.label}>FSSAI LICENCE NUMBER</Text>
          <TextInput
            value={draft.fssaiLicenseNumber}
            onChangeText={(t) => set('fssaiLicenseNumber', t.replace(/\D/g, '').slice(0, 14))}
            placeholder="14 digits"
            placeholderTextColor={color.textMuted}
            keyboardType="number-pad"
            maxLength={14}
            style={[styles.input, errors.fssaiLicenseNumber ? styles.inputBad : null]}
            editable={!saving}
            accessibilityLabel="FSSAI licence number"
          />
          <Text style={styles.hint}>{draft.fssaiLicenseNumber.length}/14 digits</Text>
          {errors.fssaiLicenseNumber ? <Text style={styles.err}>{errors.fssaiLicenseNumber}</Text> : null}

          <Text style={styles.label}>LICENCE TYPE</Text>
          <View style={styles.chips}>
            {TYPES.map((t) => (
              <Chip
                key={t.value}
                label={t.label}
                sub={t.sub}
                selected={draft.fssaiLicenseType === t.value}
                onPress={() => set('fssaiLicenseType', draft.fssaiLicenseType === t.value ? null : t.value)}
                a11y={TYPE_LABEL[t.value]}
                style={{ flex: 1 }}
              />
            ))}
          </View>
          {errors.fssaiLicenseType ? <Text style={styles.err}>{errors.fssaiLicenseType}</Text> : null}

          <Text style={styles.label}>VALID UNTIL (YYYY-MM-DD)</Text>
          <TextInput
            value={draft.fssaiExpiry}
            onChangeText={(t) => set('fssaiExpiry', t.replace(/[^\d-]/g, '').slice(0, 10))}
            placeholder="e.g. 2027-03-31"
            placeholderTextColor={color.textMuted}
            keyboardType="numbers-and-punctuation"
            maxLength={10}
            style={[styles.input, errors.fssaiExpiry ? styles.inputBad : null]}
            editable={!saving}
            accessibilityLabel="Licence expiry date, year month day"
          />
          {errors.fssaiExpiry ? <Text style={styles.err}>{errors.fssaiExpiry}</Text> : null}

          <Text style={styles.label}>LEGAL NAME (AS ON THE LICENCE)</Text>
          <TextInput
            value={draft.legalName}
            onChangeText={(t) => set('legalName', t)}
            placeholderTextColor={color.textMuted}
            autoCapitalize="words"
            maxLength={150}
            style={[styles.input, errors.legalName ? styles.inputBad : null]}
            editable={!saving}
            accessibilityLabel="Legal name"
          />
          {errors.legalName ? <Text style={styles.err}>{errors.legalName}</Text> : null}

          <Text style={styles.label}>GSTIN (OPTIONAL)</Text>
          <TextInput
            value={draft.gstin}
            onChangeText={(t) => set('gstin', t.replace(/[^0-9a-z]/gi, '').toUpperCase().slice(0, 15))}
            placeholder="15 characters, if registered"
            placeholderTextColor={color.textMuted}
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={15}
            style={[styles.input, errors.gstin ? styles.inputBad : null]}
            editable={!saving}
            accessibilityLabel="GSTIN, optional"
          />
          {errors.gstin ? <Text style={styles.err}>{errors.gstin}</Text> : null}

          <Text style={[styles.hint, { marginTop: space.xs }]}>Leave a box empty to remove it. PAN and payout details can only be changed by ZenWe support.</Text>
          {saveErr ? <Text style={styles.err}>{saveErr}</Text> : null}
          <Button label="SAVE" icon="checkmark" variant="accept" onPress={save} loading={saving} style={{ marginTop: space.sm }} />
          <Button label="Cancel" variant="secondary" size="secondary" onPress={() => setEditing(false)} disabled={saving} />
        </ScrollView>
      </Sheet>
    </>
  );
}

const styles = StyleSheet.create({
  kv: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  chips: { flexDirection: 'row', gap: space.xs },
  label: { ...font.label, color: color.textMuted, marginTop: space.sm },
  hint: { ...font.small, color: color.textMuted },
  err: { ...font.body, color: color.alertDark, fontWeight: '700', marginTop: 2 },
  input: {
    ...font.body, color: color.text, backgroundColor: color.surface, borderWidth: 2, borderColor: color.border,
    borderRadius: radius.md, paddingHorizontal: space.sm, minHeight: touch.secondary + 4,
  },
  inputBad: { borderColor: color.alert, backgroundColor: color.alertTint },
});
