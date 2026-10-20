"use client";
import { useCallback, useEffect, useState } from 'react';
import { useAdminAuth } from '@/utils/useAdminAuth';
import { adminRequest as request, uploadImage } from '@/lib/api';
import ListImage from '@/components/ListImage';

// Vault = limited daily deals. Claiming one (POST /api/vault/claim/:id in the app) creates a real coupon valid until
// midnight IST, one claim per deal per person per day, and takes one unit of stock.

interface VaultItem {
  _id: string;
  name: string;
  price: number;
  originalPrice: number;
  remainingCount: number;
  imageUrl?: string | null;
  isActive: boolean;
  streakRequirement?: number;
  updatedAt?: string;
}

interface DealForm {
  name: string;
  price: string;
  originalPrice: string;
  remainingCount: string;
  streakRequirement: string;
  imageUrl: string;
}

const EMPTY_FORM: DealForm = { name: '', price: '', originalPrice: '', remainingCount: '10', streakRequirement: '0', imageUrl: '' };
const FIELD = 'w-full rounded-lg border border-line bg-surface px-3 py-2.5 text-sm text-fg placeholder:text-fg-subtle outline-none focus:border-accent';
const LABEL = 'block space-y-1.5 text-xs font-semibold text-fg-muted';


const toForm = (item: VaultItem): DealForm => ({
  name: item.name,
  price: String(item.price ?? ''),
  originalPrice: String(item.originalPrice ?? ''),
  remainingCount: String(item.remainingCount ?? 0),
  streakRequirement: String(item.streakRequirement ?? 0),
  imageUrl: item.imageUrl || '',
});

/** Returns a payload or an error message. */
function validate(form: DealForm): { payload?: Record<string, unknown>; error?: string } {
  const name = form.name.trim();
  const price = Number(form.price);
  const originalPrice = Number(form.originalPrice);
  const remainingCount = Number(form.remainingCount);
  const streakRequirement = Number(form.streakRequirement || 0);
  if (!name) return { error: 'Deal name is required.' };
  if (form.price.trim() === '' || !Number.isFinite(price) || price < 0) return { error: 'Enter the deal price.' };
  if (form.originalPrice.trim() === '' || !Number.isFinite(originalPrice) || originalPrice <= 0) return { error: 'Enter the original price.' };
  if (originalPrice < price) return { error: 'The original price cannot be lower than the deal price.' };
  if (!Number.isInteger(remainingCount) || remainingCount < 0) return { error: 'Stock must be a whole number (0 or more).' };
  if (!Number.isInteger(streakRequirement) || streakRequirement < 0) return { error: 'Streak requirement must be a whole number (0 or more).' };
  return { payload: { name, price, originalPrice, remainingCount, streakRequirement, imageUrl: form.imageUrl.trim() || null } };
}

export default function VaultPage() {
  const { isAuthed } = useAdminAuth();
  const [items, setItems] = useState<VaultItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [editing, setEditing] = useState<VaultItem | 'new' | null>(null);
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const data = await request<VaultItem[]>('/api/admin/vault');
      setItems(Array.isArray(data) ? data : []);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Could not load vault deals.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAuthed) load();
  }, [isAuthed, load]);

  const flash = (kind: 'ok' | 'error', text: string) => setNotice({ kind, text });

  const save = async (id: string, payload: Record<string, unknown>) => {
    const saved = await request<VaultItem>(`/api/admin/vault/${id}`, { method: 'POST', body: JSON.stringify(payload) });
    setItems(prev => (id === 'new' ? [saved, ...prev] : prev.map(i => (i._id === id ? { ...i, ...saved } : i))));
    return saved;
  };

  const toggleActive = async (item: VaultItem) => {
    if (busy[item._id]) return;
    if (item.isActive && !window.confirm(`Hide "${item.name}" from the Vault? Students can no longer claim it.`)) return;
    setBusy(prev => ({ ...prev, [item._id]: true }));
    try {
      await save(item._id, { isActive: !item.isActive });
      flash('ok', item.isActive ? `${item.name} hidden.` : `${item.name} is live in the Vault.`);
    } catch (e) {
      flash('error', e instanceof Error ? e.message : 'Could not update the deal.');
    } finally {
      setBusy(prev => ({ ...prev, [item._id]: false }));
    }
  };

  const remove = async (item: VaultItem) => {
    if (!window.confirm(`Delete "${item.name}" permanently? Coupons already claimed stay valid until midnight.`)) return;
    setBusy(prev => ({ ...prev, [item._id]: true }));
    try {
      await request(`/api/admin/vault/${item._id}`, { method: 'DELETE' });
      setItems(prev => prev.filter(i => i._id !== item._id));
      flash('ok', `${item.name} deleted.`);
    } catch (e) {
      flash('error', e instanceof Error ? e.message : 'Could not delete the deal.');
      setBusy(prev => ({ ...prev, [item._id]: false }));
    }
  };

  if (!isAuthed) return <div className="p-10 text-center text-sm text-fg-muted" role="status">Checking your admin session…</div>;

  const live = items.filter(i => i.isActive && i.remainingCount > 0).length;

  return (
    <div className="mx-auto max-w-6xl space-y-6 text-fg">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-line pb-5">
        <div>
          <h1 className="text-2xl font-semibold text-fg">Daily deals</h1>
          <p className="mt-1 max-w-3xl text-sm text-fg-muted">Limited daily deals. A claim gives the student a coupon valid until midnight (one claim per deal per day) and uses one unit of stock.</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-fg-muted">{live} live of {items.length}</span>
          <button type="button" disabled={loading} onClick={load} className="rounded-lg border border-line px-4 py-2 text-sm font-semibold text-fg-muted hover:text-fg disabled:opacity-50">{loading ? 'Loading…' : 'Refresh'}</button>
          <button type="button" onClick={() => setEditing('new')} className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-fg hover:bg-accent-hover">Add deal</button>
        </div>
      </header>

      {notice && (
        <div role={notice.kind === 'error' ? 'alert' : 'status'} className={`flex items-start justify-between gap-3 rounded-lg border p-3 text-sm ${notice.kind === 'error' ? 'border-danger/30 bg-danger-soft text-danger-text' : 'border-success/30 bg-success-soft text-success-text'}`}>
          <span>{notice.text}</span>
          <button type="button" onClick={() => setNotice(null)} className="text-xs font-semibold opacity-70 hover:opacity-100">Dismiss</button>
        </div>
      )}

      {loadError && (
        <div role="alert" className="flex items-center justify-between gap-3 rounded-lg border border-danger/30 bg-danger-soft p-4 text-sm text-danger-text">
          {loadError}
          <button type="button" onClick={load} className="font-semibold underline">Retry</button>
        </div>
      )}

      {loading ? (
        <div role="status" className="rounded-lg border border-line p-8 text-sm text-fg-muted">Loading vault deals…</div>
      ) : !loadError && items.length === 0 ? (
        <div className="rounded-lg border border-line p-10 text-center">
          <h2 className="font-semibold">No vault deals yet</h2>
          <p className="mt-2 text-sm text-fg-muted">The Vault is empty in the app until you add a deal.</p>
        </div>
      ) : (
        <section className="divide-y divide-line rounded-xl border border-line" aria-label="Vault deals">
          {items.map(item => {
            const off = item.originalPrice > item.price ? Math.round((1 - item.price / item.originalPrice) * 100) : 0;
            const status = !item.isActive ? 'Hidden' : item.remainingCount <= 0 ? 'Sold out' : 'Live';
            return (
              <article key={item._id} className="flex flex-wrap items-center gap-4 p-4">
                {item.imageUrl ? (
                  <ListImage thumb src={item.imageUrl} className="h-14 w-14 rounded-lg border border-line object-cover" fallback={<div aria-hidden className="h-14 w-14 rounded-lg border border-line bg-surface-2" />} />
                ) : <div aria-hidden className="h-14 w-14 rounded-lg border border-line bg-surface-2" />}
                <div className="min-w-[200px] flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-semibold">{item.name}</h2>
                    <span className={`rounded border px-1.5 py-0.5 text-xs font-semibold ${status === 'Live' ? 'border-success/30 text-success-text' : status === 'Sold out' ? 'border-warning/30 text-warning-text' : 'border-line text-fg-muted'}`}>{status}</span>
                  </div>
                  <p className="mt-1 text-sm text-fg-muted">
                    ₹{item.price} <span className="text-fg-muted line-through">₹{item.originalPrice}</span>{off ? <span className="ml-2 text-success-text">{off}% off</span> : null}
                  </p>
                  <p className="mt-0.5 text-xs text-fg-muted">{item.remainingCount} left · {item.streakRequirement ? `needs a ${item.streakRequirement}-day streak` : 'no streak needed'}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" disabled={!!busy[item._id]} onClick={() => toggleActive(item)} className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-fg-muted hover:text-fg disabled:opacity-50">{item.isActive ? 'Hide' : 'Make live'}</button>
                  <button type="button" onClick={() => setEditing(item)} className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-fg-muted hover:text-fg">Edit</button>
                  <button type="button" disabled={!!busy[item._id]} onClick={() => remove(item)} className="rounded-lg px-2 py-1.5 text-xs font-semibold text-danger-text hover:text-danger-text disabled:opacity-50">Delete</button>
                </div>
              </article>
            );
          })}
        </section>
      )}

      {editing && (
        <DealEditor
          initial={editing === 'new' ? null : editing}
          onCancel={() => setEditing(null)}
          onSave={async payload => {
            const id = editing === 'new' ? 'new' : editing._id;
            const saved = await save(id, editing === 'new' ? { ...payload, isActive: true } : payload);
            setEditing(null);
            flash('ok', editing === 'new' ? `${saved.name} is live in the Vault.` : `${saved.name} saved.`);
          }}
        />
      )}
    </div>
  );
}

function DealEditor({ initial, onCancel, onSave }: {
  initial: VaultItem | null;
  onCancel: () => void;
  onSave: (payload: Record<string, unknown>) => Promise<void>;
}) {
  const [form, setForm] = useState<DealForm>(initial ? toForm(initial) : EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const set = (patch: Partial<DealForm>) => setForm(prev => ({ ...prev, ...patch }));

  const upload = async (file?: File) => {
    if (!file) return;
    setUploading(true);
    setError('');
    try {
      // Shared uploader: resizes large phone photos and retries once on a dropped connection.
      set({ imageUrl: await uploadImage(file) });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Image upload failed.');
    } finally {
      setUploading(false);
    }
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (saving || uploading) return;
    const { payload, error: invalid } = validate(form);
    if (!payload) return setError(invalid || 'Check the form.');
    setSaving(true);
    setError('');
    try {
      await onSave(payload);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the deal.');
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-scrim/50 p-4" role="dialog" aria-modal="true" aria-labelledby="deal-title">
      <form onSubmit={submit} className="my-8 w-full max-w-xl rounded-lg border border-line bg-surface p-6 text-fg shadow-pop">
        <h2 id="deal-title" className="text-xl font-semibold">{initial ? 'Edit deal' : 'Add vault deal'}</h2>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <label className={`${LABEL} sm:col-span-2`}>Deal name
            <input className={FIELD} value={form.name} onChange={e => set({ name: e.target.value })} required maxLength={120} />
          </label>
          <label className={LABEL}>Deal price (₹)
            <input inputMode="decimal" className={FIELD} value={form.price} onChange={e => set({ price: e.target.value })} required />
          </label>
          <label className={LABEL}>Original price (₹)
            <input inputMode="decimal" className={FIELD} value={form.originalPrice} onChange={e => set({ originalPrice: e.target.value })} required />
          </label>
          <label className={LABEL}>Stock left
            <input inputMode="numeric" className={FIELD} value={form.remainingCount} onChange={e => set({ remainingCount: e.target.value })} required />
          </label>
          <label className={LABEL}>Streak needed (days)
            <input inputMode="numeric" className={FIELD} value={form.streakRequirement} onChange={e => set({ streakRequirement: e.target.value })} />
          </label>
          <div className="space-y-1.5 sm:col-span-2">
            <span className="block text-xs font-semibold text-fg-muted">Image</span>
            <div className="flex flex-wrap items-center gap-3">
              <label className="cursor-pointer rounded-lg border border-line px-3 py-2 text-sm text-fg hover:bg-surface-2/60">
                {uploading ? 'Uploading…' : 'Upload'}
                <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" disabled={uploading} onChange={e => { upload(e.target.files?.[0]); e.target.value = ''; }} />
              </label>
              <input className={`${FIELD} min-w-[200px] flex-1`} value={form.imageUrl.startsWith('data:') ? '' : form.imageUrl} onChange={e => set({ imageUrl: e.target.value })} placeholder={form.imageUrl.startsWith('data:') ? 'Uploaded image' : 'or paste an image URL'} />
              {form.imageUrl && <button type="button" onClick={() => set({ imageUrl: '' })} className="text-sm text-danger-text hover:underline">Remove</button>}
            </div>
          </div>
        </div>
        {error && <p role="alert" className="mt-4 rounded-lg border border-danger/30 bg-danger-soft p-3 text-sm text-danger-text">{error}</p>}
        <div className="mt-6 flex justify-end gap-3">
          <button type="button" onClick={onCancel} className="rounded-lg border border-line px-4 py-2.5 text-sm font-semibold text-fg-muted hover:text-fg">Cancel</button>
          <button type="submit" disabled={saving || uploading} className="rounded-lg bg-accent px-5 py-2.5 text-sm font-semibold text-accent-fg hover:bg-accent-hover disabled:opacity-50">{saving ? 'Saving…' : initial ? 'Save deal' : 'Publish deal'}</button>
        </div>
      </form>
    </div>
  );
}
