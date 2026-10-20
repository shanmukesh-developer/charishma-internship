"use client";
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

const input = 'w-full rounded-xl border border-line bg-surface-2/60 px-3 py-2 text-sm text-fg outline-none focus:border-accent';
const label = 'block text-xs font-semibold text-fg-muted mb-1';
const btn = 'rounded-xl px-4 py-2 text-xs font-semibold disabled:opacity-40';
const errText = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);

export default function CampusSpotsPage() {
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

  const resetForm = () => { setForm(EMPTY_FORM); setEditingId(null); };

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
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const toggle = (s: Spot) => run(`toggle-${s.id}`, async () => {
    await adminRequest(`/api/campus/admin/spots/${s.id}`, { method: 'PUT', body: JSON.stringify({ isActive: !s.isActive }) });
    return s.isActive ? `"${s.name}" is hidden from the app.` : `"${s.name}" is visible in the app.`;
  });

  const remove = (s: Spot) => {
    if (!confirm(`Delete "${s.name}"? Its chat room and messages are removed for everyone. To hide it for now, disable it instead.`)) return;
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

  if (loading) {
    return (
      <div className="flex justify-center">
        <div className="w-8 h-8 border-2 border-success/30 border-t-success/30 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-fade-in pb-20">
      <header className="bg-surface-2/60 p-8 rounded-lg border border-line bg-surface border border-line flex justify-between items-start gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-fg">Campus spots</h1>
          <p className="mt-1 max-w-3xl text-sm text-fg-muted">
            Open chat rooms in Campus Buddy &gt; Campus. Only spots listed here exist; students see the active ones for their campus.
          </p>
        </div>
        <button onClick={load} className="px-4 py-2 bg-surface-2/60 border border-line rounded-xl text-xs font-semibold text-fg-muted hover:bg-surface-2">
          ↻ Refresh
        </button>
      </header>

      {loadError && (
        <div className="rounded-lg border border-line bg-surface shadow-xs p-6 text-sm font-semibold text-danger-text flex items-center justify-between gap-4">
          <span>{loadError}</span>
          <button onClick={load} className={`${btn} bg-surface-2/60 border border-line text-fg`}>Retry</button>
        </div>
      )}

      {notice && (
        <p className={`text-xs font-semibold ${notice.kind === 'ok' ? 'text-success-text' : 'text-danger-text'}`}>{notice.text}</p>
      )}

      {/* Create / edit */}
      <div className="rounded-lg border border-line bg-surface shadow-xs p-8 space-y-5">
        <h4 className="text-lg font-semibold text-fg">{editingId ? 'Edit spot' : 'New spot'}</h4>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="md:col-span-2">
            <label className={label} htmlFor="spot-name">Name</label>
            <input id="spot-name" className={input} maxLength={60} value={form.name} placeholder="Central Library 2F"
              onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div>
            <label className={label} htmlFor="spot-emoji">Emoji (optional)</label>
            <input id="spot-emoji" className={input} maxLength={16} value={form.emoji} placeholder="📚"
              onChange={(e) => setForm({ ...form, emoji: e.target.value })} />
          </div>
          <div className="md:col-span-3">
            <label className={label} htmlFor="spot-desc">Description (optional, shown under the name)</label>
            <input id="spot-desc" className={input} maxLength={120} value={form.description} placeholder="Quiet study zone, 2nd floor"
              onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>
          <div>
            <label className={label} htmlFor="spot-campus">Campus</label>
            <select id="spot-campus" className={input} value={form.campusId} onChange={(e) => setForm({ ...form, campusId: e.target.value })}>
              <option value="">Every campus</option>
              {campuses.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className={label} htmlFor="spot-icon">Icon (used when no emoji)</label>
            <select id="spot-icon" className={input} value={form.icon} onChange={(e) => setForm({ ...form, icon: e.target.value })}>
              {icons.map(i => <option key={i} value={i}>{i}</option>)}
            </select>
          </div>
          <div>
            <label className={label} htmlFor="spot-cat">Colour group</label>
            <select id="spot-cat" className={input} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              {categories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm text-fg-muted">
          <input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />
          Active (visible in the app)
        </label>
        <div className="flex gap-3">
          <button onClick={save} disabled={!!busy} className={`${btn} bg-success hover:bg-success/90 text-on-solid`}>
            {busy === 'save' ? 'Saving...' : editingId ? 'Save changes' : 'Create spot'}
          </button>
          {editingId && (
            <button onClick={resetForm} disabled={!!busy} className={`${btn} bg-surface-2/60 border border-line text-fg-muted`}>Cancel</button>
          )}
        </div>
      </div>

      {/* List */}
      <div className="rounded-lg border border-line bg-surface shadow-xs p-8 space-y-4">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <h4 className="text-lg font-semibold text-fg">Spots ({spots.length})</h4>
          <select className={`${input} max-w-xs`} value={campusFilter} onChange={(e) => setCampusFilter(e.target.value)} aria-label="Filter by campus">
            <option value="all">All campuses</option>
            <option value="global">Every-campus spots</option>
            {campuses.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        {spots.length === 0 ? (
          <p className="text-sm text-fg-muted">No campus spots yet. Students see &quot;No campus spots yet&quot; until you create one.</p>
        ) : visible.length === 0 ? (
          <p className="text-sm text-fg-muted">No spots for this campus.</p>
        ) : (
          <ul className="space-y-2">
            {visible.map(({ s }, vi) => (
              <li key={s.id} className={`flex items-center gap-4 rounded-lg border border-line p-4 ${s.isActive ? 'bg-surface-2/60' : 'bg-surface-2/60 opacity-60'}`}>
                <div className="flex flex-col gap-1">
                  <button onClick={() => move(vi, -1)} disabled={!!busy || vi === 0} className="text-fg-muted hover:text-fg disabled:opacity-20" aria-label={`Move ${s.name} up`}>▲</button>
                  <button onClick={() => move(vi, 1)} disabled={!!busy || vi === visible.length - 1} className="text-fg-muted hover:text-fg disabled:opacity-20" aria-label={`Move ${s.name} down`}>▼</button>
                </div>
                <div className="w-10 h-10 rounded-xl bg-surface-2/60 flex items-center justify-center text-xl">{s.emoji || '📍'}</div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-fg truncate">
                    {s.name}
                    {!s.isActive && <span className="ml-2 text-xs font-semibold text-warning-text">Disabled</span>}
                  </p>
                  <p className="text-xs text-fg-muted truncate">
                    {s.campusName || 'Every campus'} · {s.category} · {s.icon}{s.description ? ` · ${s.description}` : ''}
                  </p>
                </div>
                <div className="flex gap-2 flex-wrap justify-end">
                  <button onClick={() => startEdit(s)} disabled={!!busy} className={`${btn} bg-surface-2/60 border border-line text-fg`}>Edit</button>
                  <button onClick={() => toggle(s)} disabled={!!busy} className={`${btn} bg-surface-2/60 border border-line ${s.isActive ? 'text-warning-text' : 'text-success-text'}`}>
                    {busy === `toggle-${s.id}` ? '...' : s.isActive ? 'Disable' : 'Enable'}
                  </button>
                  <button onClick={() => remove(s)} disabled={!!busy} className={`${btn} bg-danger-soft border border-danger/30 text-danger-text`}>
                    {busy === `delete-${s.id}` ? '...' : 'Delete'}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
