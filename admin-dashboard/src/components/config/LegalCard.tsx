"use client";
// C4 legal / compliance: business + grievance officer details and policy version shown on the public
// /legal pages (backend/utils/legalSettings.js). GET/PUT /api/admin/legal-settings (validated + audited).
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
    if (versionChanged && !confirm(`Change the policy version from ${data.settings.policyVersion} to ${form.policyVersion.trim()}? Every signed-in customer will be asked once to accept the updated Terms (they are never locked out). Only do this for a real change to the Terms or Privacy Policy.`)) return;
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

  const input = 'w-full bg-surface-2/60 border border-line rounded-lg p-3 text-fg font-semibold text-sm';
  const lbl = 'text-xs font-semibold text-fg-muted ml-1';
  const field = (id: string, label: string, value: string, onChange: (v: string) => void, placeholder = '', type = 'text') => (
    <div className="space-y-2">
      <label htmlFor={id} className={lbl}>{label}</label>
      <input id={id} type={type} className={input} placeholder={placeholder} value={value} onChange={e => onChange(e.target.value)} />
    </div>
  );

  return (
    <div className="rounded-lg border border-line bg-surface shadow-xs p-10 space-y-6">
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex-1 min-w-[200px]">
          <h4 className="text-lg font-semibold text-fg">Legal &amp; Compliance</h4>
          <p className="text-xs text-fg-muted font-semibold">Terms · Privacy · Refunds · Grievance officer · shown on the public /legal pages and in every app</p>
        </div>
        {data && (data.grievanceComplete
          ? <span className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-success-soft border border-success/30 text-success-text">Grievance officer published</span>
          : <span className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-warning-soft border border-warning/30 text-warning-text">Grievance officer missing</span>)}
      </div>

      <div className="rounded-lg border border-warning/30 bg-warning-soft p-4 text-xs leading-relaxed text-warning-text">
        <p className="font-semibold text-xs text-warning-text mb-1">Have these reviewed by a lawyer</p>
        These policies were written in plain English from what the app actually does. They are not legal advice. Before
        relying on them (and before a public launch), have a lawyer qualified in Indian law review the Terms, Privacy
        Policy and Refund Policy, and fill in the business details below. Never type placeholder or made-up details here:
        whatever you save is published as-is.
      </div>

      {data && !data.grievanceComplete && (
        <p className="text-xs text-warning-text leading-relaxed">
          The IT (Intermediary Guidelines) Rules 2021 and the Consumer Protection (E-Commerce) Rules 2020 require a named
          grievance officer with contact details. Until name, designation and email are filled, the pages say
          &quot;details will be published here&quot; and point to the contact email.
        </p>
      )}
      {data && data.missing.length > 0 && (
        <p className="text-xs text-fg-muted">Still empty: {data.missing.map(m => MISSING_LABELS[m] || m).join(', ')}.</p>
      )}

      {loadError && (
        <div className="flex items-center gap-3">
          <p className="text-xs font-semibold text-danger-text">{loadError}</p>
          <button onClick={load} className="px-3 py-1.5 bg-surface-2/60 border border-line rounded-xl text-xs font-semibold text-fg-muted">Retry</button>
        </div>
      )}

      {data && form && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {field('lg-biz', 'Business / brand name', form.businessName, v => set('businessName', v), 'Zenvy')}
            {field('lg-op', 'Operated by (legal name)', form.operatorName, v => set('operatorName', v), 'Person or registered company')}
            {field('lg-email', 'Contact email', form.contactEmail, v => set('contactEmail', v), '', 'email')}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2 md:col-span-2">
              <label htmlFor="lg-addr" className={lbl}>Registered / postal address</label>
              <textarea id="lg-addr" rows={2} maxLength={400} className={input} placeholder="Leave empty until you have the exact address" value={form.registeredAddress} onChange={e => set('registeredAddress', e.target.value)} />
            </div>
            {field('lg-city', 'Jurisdiction city (courts)', form.jurisdictionCity, v => set('jurisdictionCity', v), 'e.g. the city of your registered office')}
          </div>

          <div className="border-t border-line pt-5 space-y-4">
            <p className="text-sm font-semibold text-fg">Grievance officer</p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {field('lg-go-name', 'Name', form.grievanceOfficer.name, v => setOfficer('name', v))}
              {field('lg-go-des', 'Designation', form.grievanceOfficer.designation, v => setOfficer('designation', v), 'e.g. Grievance Officer')}
              {field('lg-go-email', 'Email', form.grievanceOfficer.email, v => setOfficer('email', v), '', 'email')}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {field('lg-go-phone', 'Phone (optional)', form.grievanceOfficer.phone, v => setOfficer('phone', v), '+91 …', 'tel')}
              <div className="space-y-2 md:col-span-2">
                <label htmlFor="lg-go-addr" className={lbl}>Address (optional, defaults to the registered address)</label>
                <textarea id="lg-go-addr" rows={2} maxLength={400} className={input} value={form.grievanceOfficer.address} onChange={e => setOfficer('address', e.target.value)} />
              </div>
            </div>
          </div>

          <div className="border-t border-line pt-5 grid grid-cols-1 md:grid-cols-3 gap-4">
            {field('lg-date', 'Effective date', form.effectiveDate, v => set('effectiveDate', v), '', 'date')}
            {field('lg-ver', 'Policy version', form.policyVersion, v => set('policyVersion', v), '1.0')}
            <p className="text-xs text-fg-muted leading-relaxed md:pt-6">
              Changing the version asks every signed-in customer once to accept the updated Terms (non-blocking).
              Keep it the same for small fixes such as a new address.
            </p>
          </div>

          <div className="flex items-center gap-4 flex-wrap">
            <button onClick={save} disabled={saving} className="px-6 py-3 bg-accent hover:bg-accent-hover disabled:opacity-50 rounded-lg text-xs font-semibold text-on-solid">
              {saving ? 'Saving…' : 'Save legal settings'}
            </button>
            {error && <p className="text-xs font-semibold text-danger-text">{error}</p>}
            {notice && <p className="text-xs font-semibold text-success-text">{notice}</p>}
          </div>

          <div className="border-t border-line pt-5 flex flex-wrap gap-2">
            {PAGE_LABELS.filter(([k]) => data.pages[k]).map(([k, label]) => (
              <a key={k} href={data.pages[k]} target="_blank" rel="noopener noreferrer" className="px-3 py-1.5 bg-surface-2/60 border border-line rounded-xl text-xs font-semibold text-fg-muted hover:bg-surface-2">
                {label} ↗
              </a>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
