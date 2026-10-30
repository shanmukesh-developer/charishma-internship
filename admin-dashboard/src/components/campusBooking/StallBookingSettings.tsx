"use client";
// In-Campus Booking settings of one stall (admin): the on / off switch, the UPI ID students pay to, the name on that
// UPI account, the stall's own UPI QR photo (optional) and its usual prep time. PUT /api/admin/campus-booking/stores/:id
// (audited on the server). Used on the In-Campus Booking page and in the store drawer of a local vendor.
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { adminRequest, uploadImage } from '@/lib/api';
import { Button, Field, Input, Notice, Switch, useToast } from '@/components/ui';

export interface CampusStall {
  id: string;
  name: string;
  location: string | null;
  campus: string | null;
  isActive: boolean;
  isOpen: boolean;
  category: string;
  enabled: boolean;
  upiId: string | null;
  upiName: string | null;
  qrUrl: string | null;
  prepMinutes: number | null;
  effectivePrepMinutes: number;
  takingBookings: boolean;
}

export function StallBookingSettings({ stall, onSaved }: { stall: CampusStall; onSaved: (s: CampusStall) => void }) {
  const toast = useToast();
  const initial = useMemo(() => ({
    enabled: stall.enabled,
    upiId: stall.upiId || '',
    upiName: stall.upiName || '',
    qrUrl: stall.qrUrl || '',
    prep: stall.prepMinutes == null ? '' : String(stall.prepMinutes),
  }), [stall]);
  const [form, setForm] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { setForm(initial); setError(''); }, [initial]);
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);

  const save = async () => {
    const upi = form.upiId.trim().toLowerCase();
    if (upi && !/^[a-z0-9][a-z0-9._-]{1,255}@[a-z][a-z0-9.-]{1,63}$/.test(upi)) return setError('Enter the UPI ID like stallname@okaxis.');
    const prep = form.prep.trim() === '' ? null : Number(form.prep);
    if (prep !== null && (!Number.isInteger(prep) || prep < 2 || prep > 90)) return setError('Prep time must be 2 to 90 minutes, or empty for the 10 minute default.');
    if (form.enabled && !upi) return setError("Add the stall's UPI ID before switching bookings on. Students pay the stall on it.");
    setSaving(true);
    setError('');
    try {
      const res = await adminRequest<{ store: CampusStall }>(`/api/admin/campus-booking/stores/${stall.id}`, {
        method: 'PUT',
        body: JSON.stringify({ upiId: upi || null, upiName: form.upiName.trim() || null, qrUrl: form.qrUrl || null, prepMinutes: prep, enabled: form.enabled }),
      });
      onSaved(res.store);
      toast.success(res.store.takingBookings ? `${stall.name} takes In-Campus Bookings.` : `${stall.name}: saved.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.');
    } finally {
      setSaving(false);
    }
  };

  const pickQr = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    setError('');
    try {
      const url = await uploadImage(file);
      setForm((f) => ({ ...f, qrUrl: url }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not upload the QR photo.');
    } finally {
      setUploading(false);
    }
  };

  const stationery = /stationery/i.test(stall.category);
  return (
    <div className="max-w-2xl space-y-5">
      {/* The section comes from the stall's FIRST tag (Stores > the stall > Edit > Basics). */}
      <p className="rounded-lg border border-line bg-surface-2/60 px-3 py-2 text-sm text-fg-muted">
        Students find this stall under <span className="font-medium text-fg">{stall.category}</span>.{' '}
        {stationery
          ? 'Students can attach PDFs to print and type page counts (up to 200).'
          : 'For printing with PDF uploads, make "stationery" or "xerox" its first tag in Stores > Edit > Basics.'}
      </p>
      <Switch
        checked={form.enabled}
        onChange={(v) => setForm((f) => ({ ...f, enabled: v }))}
        label="In-Campus Booking"
        description={form.enabled ? 'Students pre-book this stall for pickup while it is open and pay the stall directly by UPI. It is pickup-only: it is not listed with the delivery stalls.' : 'Off: the stall is not listed for In-Campus Booking.'}
      />
      <Field label="Stall UPI ID" hint="Students pay this UPI ID directly. ZCS never holds the money." required={form.enabled}>
        <Input value={form.upiId} onChange={(e) => setForm((f) => ({ ...f, upiId: e.target.value.replace(/\s/g, '') }))} placeholder="stallname@okaxis" autoComplete="off" />
      </Field>
      <Field label="Name on the UPI account" optional hint="Shown as 'Pay to' on the student's payment screen.">
        <Input value={form.upiName} onChange={(e) => setForm((f) => ({ ...f, upiName: e.target.value }))} maxLength={120} />
      </Field>
      <Field label="Usual prep time (minutes)" optional hint="Students see when their order should be ready. Empty = 10 minutes.">
        <Input value={form.prep} onChange={(e) => setForm((f) => ({ ...f, prep: e.target.value.replace(/\D/g, '') }))} inputMode="numeric" className="max-w-[140px]" />
      </Field>
      <Field label="Stall UPI QR photo" optional hint="Without it, students get a QR made from the UPI ID with the exact amount.">
        <div className="flex flex-wrap items-center gap-4">
          {form.qrUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={form.qrUrl} alt="Stall UPI QR" className="h-32 w-32 rounded-lg border border-line bg-white object-contain" />
          ) : <span className="text-sm text-fg-muted">No QR photo</span>}
          <label className="cursor-pointer text-sm font-medium text-accent-text">
            {uploading ? 'Uploading…' : form.qrUrl ? 'Replace photo' : 'Upload photo'}
            <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(e) => pickQr(e.target.files?.[0])} disabled={uploading} />
          </label>
          {form.qrUrl ? <button type="button" className="text-sm text-fg-muted hover:text-fg" onClick={() => setForm((f) => ({ ...f, qrUrl: '' }))}>Remove</button> : null}
        </div>
      </Field>
      <div className="rounded-lg border border-line p-3 text-sm">
        <p className="font-medium text-fg">Stall login (ZCS Campus Stall app)</p>
        <p className="mt-0.5 text-fg-muted">The stall signs in with its phone number and a password, then checks payments, accepts and marks orders ready.</p>
        <Link href={`/restaurants/?store=${encodeURIComponent(stall.id)}&tab=login`} className="mt-1.5 inline-block font-semibold text-accent-text hover:underline">Set or reset the login →</Link>
      </div>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      {!stall.isActive ? <Notice tone="warning">This stall is hidden from customers. It takes bookings only once it is live.</Notice> : null}
      <div className="flex items-center gap-3">
        <Button variant="primary" loading={saving} disabled={!dirty || uploading} onClick={save}>{dirty ? 'Save' : 'Saved'}</Button>
        {dirty ? <Button variant="ghost" onClick={() => { setForm(initial); setError(''); }}>Undo changes</Button> : null}
      </div>
    </div>
  );
}
