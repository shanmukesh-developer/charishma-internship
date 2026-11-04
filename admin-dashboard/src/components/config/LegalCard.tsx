"use client";
// C4 legal / compliance: business + grievance officer details and policy version shown on the public
// /legal pages (backend/utils/legalSettings.js). GET/PUT /api/admin/legal-settings (validated + audited).
import {
  Button, buttonClass, Card, CardBody, CardFooter, CardHeader, Field, FormSection, Input, LoadingState, Notice, StatusPill, Textarea, useConfirm,
  IconExternal,
} from '@/components/ui';
import { useCallback, useEffect, useState } from 'react';
import { adminRequest as apiRequest } from '@/lib/api';

interface Officer { name: string; designation: string; email: string; phone: string; address: string }
interface Settings {
  businessName: string;
  operatorName: string;
  contactEmail: string;
  registeredAddress: string;
  jurisdictionCity: string;
  grievanceOfficer: Officer;
  effectiveDate: string;
  policyVersion: string;
}
interface LegalResponse {
  settings: Settings;
  defaults: Settings;
  grievanceComplete: boolean;
  missing: string[];
  pages: Record<string, string>;
  updatedAt: string | null;
  changed?: boolean;
}

const PAGE_LABELS: [string, string][] = [
  ['index', 'All policies'],
  ['terms', 'Terms of Service'],
  ['privacy', 'Privacy Policy'],
  ['refunds', 'Cancellation & Refunds'],
  ['grievance', 'Grievance Redressal'],
  ['communityGuidelines', 'Community Guidelines'],
  ['deleteAccount', 'Delete account'],
];
const MISSING_LABELS: Record<string, string> = {
  'grievanceOfficer.name': 'grievance officer name',
  'grievanceOfficer.designation': 'grievance officer designation',
  'grievanceOfficer.email': 'grievance officer email',
  registeredAddress: 'registered / postal address',
  jurisdictionCity: 'jurisdiction city',
};
const EMAIL = /^[^\s@<>"']+@[^\s@<>"']+\.[A-Za-z]{2,24}$/;

export default function LegalCard() {
  const confirm = useConfirm();
  const [data, setData] = useState<LegalResponse | null>(null);
  const [form, setForm] = useState<Settings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const d = await apiRequest<LegalResponse>('/api/admin/legal-settings');
      setData(d);
      setForm(JSON.parse(JSON.stringify(d.settings)));
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load legal settings.');
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const set = (k: keyof Settings, v: string) => form && setForm({ ...form, [k]: v });
  const setOfficer = (k: keyof Officer, v: string) => form && setForm({ ...form, grievanceOfficer: { ...form.grievanceOfficer, [k]: v } });

  const save = async () => {
    if (!data || !form || saving) return;
    setError(null);
    setNotice(null);
    if (!form.businessName.trim()) return setError('Business name is required.');
    if (!EMAIL.test(form.contactEmail.trim())) return setError('Contact email is not a valid email address.');
    if (form.grievanceOfficer.email.trim() && !EMAIL.test(form.grievanceOfficer.email.trim())) return setError('Grievance officer email is not a valid email address.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(form.effectiveDate)) return setError('Effective date must be a date.');
    if (!/^[0-9A-Za-z][0-9A-Za-z.-]{0,19}$/.test(form.policyVersion.trim())) return setError('Policy version must be 1-20 letters, digits, dots or dashes (for example 1.1).');
    const versionChanged = form.policyVersion.trim() !== data.settings.policyVersion;
    if (versionChanged && !(await confirm({ title: `Change the policy version from ${data.settings.policyVersion} to ${form.policyVersion.trim()}?`, description: 'Every signed-in customer will be asked once to accept the updated Terms (they are never locked out). Only do this for a real change to the Terms or Privacy Policy.', confirmLabel: 'Change version' }))) return;
    setSaving(true);
    try {
      const d = await apiRequest<LegalResponse>('/api/admin/legal-settings', {
        method: 'PUT',
        body: JSON.stringify({ ...form, ifUpdatedAt: data.updatedAt || undefined }),
      });
      setData(d);
      setForm(JSON.parse(JSON.stringify(d.settings)));
      setNotice(d.changed === false ? 'No change to save.' : 'Saved. The public pages show it within about a minute.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.');
      if (err instanceof Error && /changed the legal settings/i.test(err.message)) load();
    } finally {
      setSaving(false);
    }
  };

  const field = (label: string, value: string, onChange: (v: string) => void, placeholder = '', type = 'text', optional = false) => (
    <Field label={label} optional={optional}>
      <Input type={type} placeholder={placeholder} value={value} onChange={e => onChange(e.target.value)} />
    </Field>
  );

  return (
    <Card>
      <CardHeader
        title="Legal and compliance"
        description="Terms, Privacy, Refunds and the grievance officer, shown on the public /legal pages and in every app."
        actions={data ? (data.grievanceComplete
          ? <StatusPill status="ok" tone="success" label="Grievance officer published" />
          : <StatusPill status="missing" tone="warning" label="Grievance officer missing" />) : undefined}
      />
      <CardBody className="space-y-5">
        <Notice tone="warning" title="Have these reviewed by a lawyer">
          These policies were written in plain English from what the app actually does. They are not legal advice. Before
          relying on them (and before a public launch), have a lawyer qualified in Indian law review the Terms, Privacy
          Policy and Refund Policy, and fill in the business details below. Never type placeholder or made-up details here:
          whatever you save is published as-is.
        </Notice>

        {data && !data.grievanceComplete && (
          <p className="text-sm text-fg-muted">
            The IT (Intermediary Guidelines) Rules 2021 and the Consumer Protection (E-Commerce) Rules 2020 require a named
            grievance officer with contact details. Until name, designation and email are filled, the pages say
            “details will be published here” and point to the contact email.
          </p>
        )}
        {data && data.missing.length > 0 && (
          <p className="text-sm text-warning-text">Still empty: {data.missing.map(m => MISSING_LABELS[m] || m).join(', ')}.</p>
        )}

        {loadError && <Notice tone="danger" action={<Button size="sm" onClick={load}>Retry</Button>}>{loadError}</Notice>}
        {!data && !loadError && <LoadingState label="Loading legal settings…" />}

        {data && form && (
          <>
            <FormSection title="Business">
              <div className="space-y-3">
                <div className="grid gap-3 md:grid-cols-3">
                  {field('Business or brand name', form.businessName, v => set('businessName', v), 'ZENV')}
                  {field('Operated by (legal name)', form.operatorName, v => set('operatorName', v), 'Person or registered company')}
                  {field('Contact email', form.contactEmail, v => set('contactEmail', v), '', 'email')}
                </div>
                <div className="grid gap-3 md:grid-cols-3">
                  <Field label="Registered or postal address" className="md:col-span-2">
                    <Textarea rows={2} maxLength={400} placeholder="Leave empty until you have the exact address" value={form.registeredAddress} onChange={e => set('registeredAddress', e.target.value)} />
                  </Field>
                  {field('Jurisdiction city (courts)', form.jurisdictionCity, v => set('jurisdictionCity', v), 'e.g. the city of your registered office')}
                </div>
              </div>
            </FormSection>

            <FormSection title="Grievance officer">
              <div className="space-y-3">
                <div className="grid gap-3 md:grid-cols-3">
                  {field('Name', form.grievanceOfficer.name, v => setOfficer('name', v))}
                  {field('Designation', form.grievanceOfficer.designation, v => setOfficer('designation', v), 'e.g. Grievance Officer')}
                  {field('Email', form.grievanceOfficer.email, v => setOfficer('email', v), '', 'email')}
                </div>
                <div className="grid gap-3 md:grid-cols-3">
                  {field('Phone', form.grievanceOfficer.phone, v => setOfficer('phone', v), '+91 …', 'tel', true)}
                  <Field label="Address" optional hint="Defaults to the registered address." className="md:col-span-2">
                    <Textarea rows={2} maxLength={400} value={form.grievanceOfficer.address} onChange={e => setOfficer('address', e.target.value)} />
                  </Field>
                </div>
              </div>
            </FormSection>

            <FormSection
              title="Policy version"
              description="Changing the version asks every signed-in customer once to accept the updated Terms (they are never locked out). Keep it the same for small fixes such as a new address."
            >
              <div className="grid gap-3 md:grid-cols-3">
                {field('Effective date', form.effectiveDate, v => set('effectiveDate', v), '', 'date')}
                {field('Policy version', form.policyVersion, v => set('policyVersion', v), '1.0')}
              </div>
            </FormSection>

            {error && <Notice tone="danger">{error}</Notice>}
            {notice && <Notice tone="success">{notice}</Notice>}
          </>
        )}
      </CardBody>
      {data && form && (
        <CardFooter className="justify-between">
          <div className="flex flex-wrap gap-1">
            {PAGE_LABELS.filter(([k]) => data.pages[k]).map(([k, label]) => (
              <a key={k} href={data.pages[k]} target="_blank" rel="noopener noreferrer" className={buttonClass('ghost', 'sm')}>
                {label} <IconExternal size={12} />
              </a>
            ))}
          </div>
          <Button variant="primary" loading={saving} onClick={save}>Save legal settings</Button>
        </CardFooter>
      )}
    </Card>
  );
}
