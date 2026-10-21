"use client";
import {
  Button, buttonClass, DataTable, Field, Input, Modal, Notice, PageHeader, StatusPill, Toolbar, useConfirm,
  type Column, IconPlus, IconRefresh,
} from '@/components/ui';
import { formatINR, formatNumber, formatRelative } from '@/lib/format';
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
  const confirm = useConfirm();
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
    if (item.isActive && !(await confirm({ title: `Hide “${item.name}” from the Vault?`, description: 'Students can no longer claim it. You can make it live again later.', confirmLabel: 'Hide deal' }))) return;
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
    if (!(await confirm({ title: `Delete “${item.name}” permanently?`, description: 'Coupons already claimed stay valid until midnight. This cannot be undone.', confirmLabel: 'Delete deal', tone: 'danger' }))) return;
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

  if (!isAuthed) return null; // AppShell shows the session check

  const live = items.filter(i => i.isActive && i.remainingCount > 0).length;
  const statusOf = (item: VaultItem) => (!item.isActive ? 'Hidden' : item.remainingCount <= 0 ? 'Sold out' : 'Live');
  const toneOf = { Live: 'success', 'Sold out': 'warning', Hidden: 'neutral' } as const;

  const columns: Column<VaultItem>[] = [
    {
      key: 'name',
      header: 'Deal',
      sortValue: i => i.name,
      cell: item => (
        <div className="flex min-w-0 items-center gap-3">
          {item.imageUrl ? (
            <ListImage thumb src={item.imageUrl} className="h-10 w-10 shrink-0 rounded-md border border-line object-cover" fallback={<div aria-hidden className="h-10 w-10 shrink-0 rounded-md border border-line bg-surface-2" />} />
          ) : <div aria-hidden className="h-10 w-10 shrink-0 rounded-md border border-line bg-surface-2" />}
          <span className="truncate font-medium text-fg">{item.name}</span>
        </div>
      ),
    },
    {
      key: 'price',
      header: 'Price',
      align: 'right',
      sortValue: i => Number(i.price) || 0,
      cell: item => {
        const off = item.originalPrice > item.price ? Math.round((1 - item.price / item.originalPrice) * 100) : 0;
        return (
          <div className="tabular-nums">
            <p className="text-fg">{formatINR(item.price)} <span className="text-xs text-fg-subtle line-through">{formatINR(item.originalPrice)}</span></p>
            {off ? <p className="text-xs text-success-text">{off}% off</p> : null}
          </div>
        );
      },
    },
    { key: 'stock', header: 'Stock left', align: 'right', sortValue: i => i.remainingCount, cell: i => <span className="tabular-nums">{formatNumber(i.remainingCount)}</span> },
    { key: 'streak', header: 'Streak needed', hideBelow: 'lg', sortValue: i => i.streakRequirement || 0, cell: i => <span className="text-fg-muted">{i.streakRequirement ? `${i.streakRequirement} days` : 'None'}</span> },
    { key: 'updated', header: 'Updated', hideBelow: 'xl', sortValue: i => (i.updatedAt ? new Date(i.updatedAt) : null), cell: i => <span className="whitespace-nowrap text-xs text-fg-muted">{i.updatedAt ? formatRelative(i.updatedAt) : '–'}</span> },
    { key: 'status', header: 'Status', sortValue: i => statusOf(i), cell: i => { const s = statusOf(i); return <StatusPill status={s} tone={toneOf[s]} label={s} />; } },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      align: 'right',
      cell: item => (
        <div className="flex justify-end gap-1" onClick={e => e.stopPropagation()}>
          <Button size="sm" variant="ghost" disabled={!!busy[item._id]} onClick={() => toggleActive(item)}>{item.isActive ? 'Hide' : 'Make live'}</Button>
          <Button size="sm" variant="ghost" onClick={() => setEditing(item)}>Edit</Button>
          <Button size="sm" variant="ghost" className="text-danger-text" disabled={!!busy[item._id]} onClick={() => remove(item)}>Delete</Button>
        </div>
      ),
    },
  ];

  return (
    <div className="text-fg">
      <PageHeader
        title="Daily deals"
        description="Limited daily deals. A claim gives the student a coupon valid until midnight (one claim per deal per day) and uses one unit of stock."
        actions={(
          <>
            <Button leftIcon={<IconRefresh size={14} />} loading={loading} onClick={load}>Refresh</Button>
            <Button variant="primary" leftIcon={<IconPlus size={14} />} onClick={() => setEditing('new')}>Add deal</Button>
          </>
        )}
      />

      <Toolbar end={<span className="text-sm tabular-nums text-fg-muted">{live} live of {items.length} deals</span>} />

      {notice && <Notice tone={notice.kind === 'error' ? 'danger' : 'success'} className="mb-3" onClose={() => setNotice(null)}>{notice.text}</Notice>}
      {loadError && items.length > 0 && <Notice tone="danger" className="mb-3" action={<Button size="sm" onClick={load}>Retry</Button>}>{loadError}</Notice>}

      <DataTable
        caption="Daily deals"
        columns={columns}
        rows={items}
        rowKey={i => i._id}
        loading={loading && items.length === 0}
        error={items.length === 0 && loadError ? loadError : null}
        onRetry={load}
        onRowClick={item => setEditing(item)}
        noun="deals"
        empty={{
          title: 'No daily deals yet',
          description: 'The Vault is empty in the app until you add a deal.',
          action: <Button variant="primary" leftIcon={<IconPlus size={14} />} onClick={() => setEditing('new')}>Add deal</Button>,
        }}
      />

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
    <Modal
      open
      onClose={onCancel}
      dismissible={!saving && !uploading}
      size="md"
      title={initial ? 'Edit deal' : 'Add daily deal'}
      description={initial ? undefined : 'New deals go live in the Vault as soon as you publish them.'}
      footer={(
        <>
          <Button onClick={onCancel} disabled={saving}>Cancel</Button>
          <Button variant="primary" type="submit" form="deal-form" loading={saving} disabled={uploading}>{initial ? 'Save deal' : 'Publish deal'}</Button>
        </>
      )}
    >
      <form id="deal-form" onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <Field label="Deal name" required className="sm:col-span-2">
          <Input value={form.name} onChange={e => set({ name: e.target.value })} required maxLength={120} />
        </Field>
        <Field label="Deal price" required>
          <Input prefix="₹" inputMode="decimal" value={form.price} onChange={e => set({ price: e.target.value })} required />
        </Field>
        <Field label="Original price" required>
          <Input prefix="₹" inputMode="decimal" value={form.originalPrice} onChange={e => set({ originalPrice: e.target.value })} required />
        </Field>
        <Field label="Stock left" required>
          <Input inputMode="numeric" value={form.remainingCount} onChange={e => set({ remainingCount: e.target.value })} required />
        </Field>
        <Field label="Streak needed (days)" hint="0 means anyone can claim it.">
          <Input inputMode="numeric" value={form.streakRequirement} onChange={e => set({ streakRequirement: e.target.value })} />
        </Field>
        <Field label="Image" optional className="sm:col-span-2" hint="JPG, PNG or WebP. Large photos are resized before upload.">
          <div className="flex flex-wrap items-center gap-2">
            {form.imageUrl && <ListImage thumb src={form.imageUrl} className="h-9 w-9 rounded-md border border-line object-cover" fallback={<div aria-hidden className="h-9 w-9 rounded-md border border-line bg-surface-2" />} />}
            <label className={buttonClass('secondary', 'md', 'cursor-pointer')}>
              {uploading ? 'Uploading…' : 'Upload'}
              <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" disabled={uploading} onChange={e => { upload(e.target.files?.[0]); e.target.value = ''; }} />
            </label>
            <Input className="min-w-[200px] flex-1" value={form.imageUrl.startsWith('data:') ? '' : form.imageUrl} onChange={e => set({ imageUrl: e.target.value })} placeholder={form.imageUrl.startsWith('data:') ? 'Uploaded image' : 'or paste an image URL'} />
            {form.imageUrl && <Button variant="ghost" className="text-danger-text" onClick={() => set({ imageUrl: '' })}>Remove</Button>}
          </div>
        </Field>
        {error && <Notice tone="danger" className="sm:col-span-2">{error}</Notice>}
      </form>
    </Modal>
  );
}
