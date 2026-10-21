"use client";
import {
  Badge, Button, DataTable, Field, IconButton, Input, LoadingState, Modal, Notice, PageHeader, Select, Switch, Toolbar, useConfirm,
  type Column, IconChevronDown, IconChevronUp, IconPin, IconPlus, IconRefresh,
} from '@/components/ui';
import { humanize } from '@/lib/format';
import { useCallback, useEffect, useState } from 'react';
import { useAdminAuth } from '@/utils/useAdminAuth';
import { adminRequest } from '@/lib/api';
import { useLiveSync } from '@/lib/useLiveSync';

/**
 * Campus spots: the open chat rooms students see under Campus Buddy > Campus > "Campus spots"
 * (library, mess, gym…). Only spots created here exist; the app shows the active ones of the
 * student's campus (plus spots for every campus) in this order, and updates live.
 * Backend: /api/campus/admin/spots (modules/campus/controllers/spotAdminController.js).
 */

interface Spot {
  id: string;
  name: string;
  slug: string;
  description: string;
  emoji: string | null;
  icon: string;
  category: string;
  campusId: string | null;
  campusName: string | null;
  isActive: boolean;
  sortOrder: number;
}

interface Campus { id: string; name: string; code?: string }

type Notice = { kind: 'ok' | 'error'; text: string } | null;

const DEFAULT_ICONS = ['MapPin', 'BookOpen', 'Utensils', 'Dumbbell', 'Users', 'Sofa', 'Mic', 'Coffee', 'Music', 'Gamepad2', 'Trees', 'Bus', 'Laptop', 'Building'];
const DEFAULT_CATEGORIES = ['library', 'dining', 'sports', 'hostel', 'academic', 'common'];
const EMPTY_FORM = { name: '', emoji: '', description: '', icon: 'MapPin', category: 'common', campusId: '', isActive: true };

const errText = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);

export default function CampusSpotsPage() {
  const confirm = useConfirm();
  const { isAuthed } = useAdminAuth();
  const [spots, setSpots] = useState<Spot[]>([]);
  const [campuses, setCampuses] = useState<Campus[]>([]);
  const [icons, setIcons] = useState<string[]>(DEFAULT_ICONS);
  const [categories, setCategories] = useState<string[]>(DEFAULT_CATEGORIES);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [campusFilter, setCampusFilter] = useState<string>('all');
  const [spotModal, setSpotModal] = useState(false);

  const load = useCallback(async () => {
    try {
      const [data, camps] = await Promise.all([
        adminRequest<{ spots?: Spot[]; icons?: string[]; categories?: string[] }>('/api/campus/admin/spots'),
        adminRequest<Campus[]>('/api/campus/campuses').catch(() => [] as Campus[]),
      ]);
      setSpots(Array.isArray(data?.spots) ? data.spots : []);
      if (Array.isArray(data?.icons) && data.icons.length) setIcons(data.icons);
      if (Array.isArray(data?.categories) && data.categories.length) setCategories(data.categories);
      setCampuses(Array.isArray(camps) ? camps : []);
      setLoadError(null);
    } catch (e) {
      setLoadError(errText(e, 'Could not load campus spots.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAuthed) load();
  }, [isAuthed, load]);

  useLiveSync(['campus'], (events, { reconnect }) => {
    if (reconnect || events.some(e => !e.scope || e.scope === 'spots')) load();
  }, { enabled: isAuthed });

  const run = async (key: string, fn: () => Promise<string>) => {
    if (busy) return;
    setBusy(key);
    setNotice(null);
    try {
      setNotice({ kind: 'ok', text: await fn() });
      await load();
    } catch (e) {
      setNotice({ kind: 'error', text: errText(e, 'Something went wrong.') });
    } finally {
      setBusy(null);
    }
  };

  const resetForm = () => { setForm(EMPTY_FORM); setEditingId(null); setSpotModal(false); };

  const save = () => run('save', async () => {
    const name = form.name.trim();
    if (name.length < 2 || name.length > 60) throw new Error('Spot name must be 2 to 60 characters.');
    if (form.description.trim().length > 120) throw new Error('Description must be at most 120 characters.');
    const body = {
      name,
      emoji: form.emoji.trim() || null,
      description: form.description.trim(),
      icon: form.icon,
      category: form.category,
      campusId: form.campusId || null,
      isActive: form.isActive,
    };
    if (editingId) {
      await adminRequest(`/api/campus/admin/spots/${editingId}`, { method: 'PUT', body: JSON.stringify(body) });
      resetForm();
      return `Saved "${name}".`;
    }
    await adminRequest('/api/campus/admin/spots', { method: 'POST', body: JSON.stringify(body) });
    resetForm();
    return `Created "${name}". It is live in the app now${body.isActive ? '' : ' (disabled)'}.`;
  });

  const startEdit = (s: Spot) => {
    setEditingId(s.id);
    setForm({
      name: s.name,
      emoji: s.emoji || '',
      description: s.description || '',
      icon: s.icon || 'MapPin',
      category: s.category || 'common',
      campusId: s.campusId || '',
      isActive: s.isActive,
    });
    setNotice(null);
  };

  const toggle = (s: Spot) => run(`toggle-${s.id}`, async () => {
    await adminRequest(`/api/campus/admin/spots/${s.id}`, { method: 'PUT', body: JSON.stringify({ isActive: !s.isActive }) });
    return s.isActive ? `"${s.name}" is hidden from the app.` : `"${s.name}" is visible in the app.`;
  });

  const remove = async (s: Spot) => {
    if (!(await confirm({ title: `Delete “${s.name}”?`, description: 'Its chat room and messages are removed for everyone. To hide it for now, switch off Visible instead.', confirmLabel: 'Delete spot', tone: 'danger' }))) return;
    run(`delete-${s.id}`, async () => {
      await adminRequest(`/api/campus/admin/spots/${s.id}`, { method: 'DELETE' });
      if (editingId === s.id) resetForm();
      return `Deleted "${s.name}".`;
    });
  };

  const visible = spots
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => campusFilter === 'all' || (campusFilter === 'global' ? !s.campusId : s.campusId === campusFilter));

  // Reorder within the full list (the app sorts every campus's spots by the same order). With a campus
  // filter on, a spot swaps with the nearest spot the admin can SEE in that direction, not with a
  // hidden spot of another campus (which looked like the button did nothing).
  const move = async (visiblePos: number, dir: -1 | 1) => {
    if (busy) return;
    const from = visible[visiblePos];
    const to = visible[visiblePos + dir];
    if (!from || !to) return;
    const before = spots;
    const next = spots.slice();
    [next[from.i], next[to.i]] = [next[to.i], next[from.i]];
    setSpots(next);
    setBusy('reorder');
    setNotice(null);
    try {
      await adminRequest('/api/campus/admin/spots/reorder', { method: 'PUT', body: JSON.stringify({ ids: next.map(s => s.id) }) });
      setNotice({ kind: 'ok', text: 'Order saved.' });
    } catch (e) {
      // Roll back the optimistic swap, then reload the server's order.
      setSpots(before);
      setNotice({ kind: 'error', text: errText(e, 'Could not save the new order.') });
    } finally {
      setBusy(null);
    }
    load();
  };

  if (loading && spots.length === 0 && !loadError) return <LoadingState label="Loading campus spots…" />;

  const openNew = () => { setForm(EMPTY_FORM); setEditingId(null); setNotice(null); setSpotModal(true); };
  const openEdit = (s: Spot) => { startEdit(s); setSpotModal(true); };
  const closeModal = () => { if (busy === 'save') return; resetForm(); };

  type Row = { s: Spot; i: number };
  const columns: Column<Row>[] = [
    {
      key: 'order',
      header: 'Order',
      width: '76px',
      cell: r => { const vi = visible.indexOf(r); return (
        <div className="flex items-center gap-0.5" onClick={e => e.stopPropagation()}>
          <IconButton size="sm" label="Move up" disabled={!!busy || vi === 0} onClick={() => move(vi, -1)}><IconChevronUp size={14} /></IconButton>
          <IconButton size="sm" label="Move down" disabled={!!busy || vi === visible.length - 1} onClick={() => move(vi, 1)}><IconChevronDown size={14} /></IconButton>
        </div>
      ); },
    },
    {
      key: 'name',
      header: 'Spot',
      cell: ({ s }) => (
        <div className="flex min-w-0 items-center gap-3">
          <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-line bg-surface-2 text-lg text-fg-muted">
            {s.emoji || <IconPin size={16} />}
          </span>
          <div className="min-w-0">
            <p className="truncate font-medium text-fg">{s.name}{!s.isActive && <Badge tone="warning" className="ml-2">Hidden</Badge>}</p>
            {s.description && <p className="truncate text-xs text-fg-muted">{s.description}</p>}
          </div>
        </div>
      ),
    },
    { key: 'campus', header: 'Campus', cell: ({ s }) => <span className="text-fg-muted">{s.campusName || 'Every campus'}</span> },
    { key: 'category', header: 'Colour group', hideBelow: 'lg', cell: ({ s }) => <Badge>{humanize(s.category)}</Badge> },
    {
      key: 'active',
      header: 'Visible',
      cell: ({ s }) => (
        <div onClick={e => e.stopPropagation()}>
          <Switch size="sm" checked={s.isActive} disabled={!!busy} onChange={() => toggle(s)} label={<span className="sr-only">Visible in the app</span>} />
        </div>
      ),
    },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      align: 'right',
      cell: ({ s }) => (
        <div className="flex justify-end gap-1" onClick={e => e.stopPropagation()}>
          <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => openEdit(s)}>Edit</Button>
          <Button size="sm" variant="ghost" className="text-danger-text" disabled={!!busy} loading={busy === `delete-${s.id}`} onClick={() => remove(s)}>Delete</Button>
        </div>
      ),
    },
  ];

  return (
    <div className="text-fg">
      <PageHeader
        title="Campus spots"
        description="Open chat rooms in Campus Buddy > Campus, such as the library or mess. Only spots listed here exist; students see the visible ones for their campus, in this order."
        actions={(
          <>
            <Button leftIcon={<IconRefresh size={14} />} onClick={load}>Refresh</Button>
            <Button variant="primary" leftIcon={<IconPlus size={14} />} onClick={openNew}>New spot</Button>
          </>
        )}
      />

      <Toolbar end={<span className="text-sm tabular-nums text-fg-muted">{visible.length} of {spots.length} spots</span>}>
        <Select className="w-auto min-w-[220px]" value={campusFilter} onChange={(e) => setCampusFilter(e.target.value)} aria-label="Filter by campus">
          <option value="all">All campuses</option>
          <option value="global">Every-campus spots</option>
          {campuses.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
      </Toolbar>

      {notice && !spotModal && <Notice tone={notice.kind === 'error' ? 'danger' : 'success'} className="mb-3" onClose={() => setNotice(null)}>{notice.text}</Notice>}

      <DataTable
        caption="Campus spots"
        columns={columns}
        rows={visible}
        rowKey={r => r.s.id}
        error={spots.length === 0 ? loadError : null}
        onRetry={load}
        onRowClick={r => openEdit(r.s)}
        pageSize={500}
        noun="spots"
        empty={spots.length === 0
          ? { title: 'No campus spots yet', description: 'Students see “No campus spots yet” until you create one.', action: <Button variant="primary" leftIcon={<IconPlus size={14} />} onClick={openNew}>New spot</Button> }
          : { title: 'No spots for this campus' }}
      />
      {loadError && spots.length > 0 && <Notice tone="danger" className="mt-3" action={<Button size="sm" onClick={load}>Retry</Button>}>{loadError}</Notice>}

      <Modal
        open={spotModal}
        onClose={closeModal}
        dismissible={busy !== 'save'}
        size="lg"
        title={editingId ? 'Edit spot' : 'New spot'}
        description={editingId ? 'Changes show in the app straight away.' : 'A new spot is live in the app as soon as you create it.'}
        footer={(
          <>
            <Button onClick={closeModal} disabled={busy === 'save'}>Cancel</Button>
            <Button variant="primary" disabled={!!busy && busy !== 'save'} loading={busy === 'save'} onClick={save}>{editingId ? 'Save changes' : 'Create spot'}</Button>
          </>
        )}
      >
        <div className="grid gap-4 md:grid-cols-3">
          {notice?.kind === 'error' && <Notice tone="danger" className="md:col-span-3">{notice.text}</Notice>}
          <Field label="Name" required hint="2 to 60 characters." className="md:col-span-2">
            <Input maxLength={60} value={form.name} placeholder="Central Library 2F" onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label="Emoji" optional>
            <Input maxLength={16} value={form.emoji} placeholder="📚" onChange={(e) => setForm({ ...form, emoji: e.target.value })} />
          </Field>
          <Field label="Description" optional hint="Shown under the name. Up to 120 characters." className="md:col-span-3">
            <Input maxLength={120} value={form.description} placeholder="Quiet study zone, 2nd floor" onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </Field>
          <Field label="Campus">
            <Select value={form.campusId} onChange={(e) => setForm({ ...form, campusId: e.target.value })}>
              <option value="">Every campus</option>
              {campuses.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
          <Field label="Icon" hint="Used when there is no emoji.">
            <Select value={form.icon} onChange={(e) => setForm({ ...form, icon: e.target.value })}>
              {icons.map(i => <option key={i} value={i}>{i}</option>)}
            </Select>
          </Field>
          <Field label="Colour group">
            <Select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              {categories.map(c => <option key={c} value={c}>{humanize(c)}</option>)}
            </Select>
          </Field>
          <div className="md:col-span-3">
            <Switch checked={form.isActive} onChange={v => setForm({ ...form, isActive: v })} label="Visible in the app" description="Turn off to hide the spot without deleting its chat." />
          </div>
        </div>
      </Modal>
    </div>
  );
}
