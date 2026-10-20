"use client";
import { useState, useEffect, useCallback, useRef } from 'react';
import { useAdminAuth } from '@/utils/useAdminAuth';
import { adminRequest as apiRequest } from '@/lib/api';
import { useLiveSync } from '@/lib/useLiveSync';

type EditableKey = 'maintenanceMode' | 'campusOpen' | 'banners' | 'categories';
const EDITABLE_KEYS: EditableKey[] = ['maintenanceMode', 'campusOpen', 'banners', 'categories'];
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

interface Banner {
  imageUrl: string;
  tagline: string;
  title1: string;
  title2: string;
  description: string;
  buttonText: string;
  redirectUrl?: string;
  isActive: boolean;
}

interface Category {
  name: string;
  img: string;
  order: number;
  isActive: boolean;
}

interface AppConfig {
  maintenanceMode: boolean;
  campusOpen: boolean;
  banners: Banner[];
  categories: Category[];
  updatedAt?: string;
}

/** fetch against the one backend; throws an Error carrying the server's friendly `message`. */
const normalizeConfig = (raw: Partial<AppConfig> | null | undefined): AppConfig => ({
  maintenanceMode: !!raw?.maintenanceMode,
  campusOpen: raw?.campusOpen !== false,
  banners: Array.isArray(raw?.banners) ? raw!.banners : [],
  categories: Array.isArray(raw?.categories) ? raw!.categories : [],
  updatedAt: raw?.updatedAt,
});

export default function CMSPage() {
  const { isAuthed } = useAdminAuth();
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** The config as last loaded from the server: only fields that differ from it are saved. */
  const baseline = useRef<AppConfig | null>(null);
  /** Set when another tab / page (e.g. a store banner) changed the config while this one had edits. */
  const [staleRemote, setStaleRemote] = useState(false);

  const fetchConfig = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiRequest<{ config: AppConfig }>('/api/config');
      const next = normalizeConfig(data?.config);
      baseline.current = next;
      setConfig(next);
      setDirty(false);
      setStaleRemote(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the configuration.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAuthed) fetchConfig();
  }, [isAuthed, fetchConfig]);

  // Config changed elsewhere (another admin tab, a store's Home banner added or removed): reload when
  // there are no local edits, otherwise warn so a save cannot silently undo that change.
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;
  useLiveSync(['config'], () => {
    if (dirtyRef.current) setStaleRemote(true);
    else fetchConfig();
  }, { enabled: isAuthed });

  const edit = (next: AppConfig) => {
    setConfig(next);
    setDirty(true);
    setNotice(null);
  };

  const handleSave = async () => {
    if (!config || saving) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const base = baseline.current;
      const changed = EDITABLE_KEYS.filter(k => !base || !same(config[k], base[k]));
      if (!changed.length) {
        setDirty(false);
        setNotice('Nothing to save.');
        return;
      }
      // Re-read the server copy: if a field this page is about to overwrite was changed elsewhere
      // since it loaded, ask before replacing it (the server itself has no version check).
      // cache: 'reload' skips the few-second read cache, so the conflict check sees the server copy.
      const latest = normalizeConfig((await apiRequest<{ config: AppConfig }>('/api/config', { cache: 'reload' }))?.config);
      const conflicts = base ? changed.filter(k => !same(latest[k], base[k])) : [];
      if (conflicts.length && !confirm(`Someone else changed ${conflicts.join(', ')} since this page loaded. Saving replaces their change with yours.

Press Cancel, then Discard, to load their version first.`)) {
        setStaleRemote(true);
        return;
      }
      const body: Partial<Record<EditableKey | 'ifUpdatedAt', unknown>> = {};
      changed.forEach(k => { body[k] = config[k]; });
      // Version check on the server: the save is refused (409) if the config changed again after the
      // copy just read, so a store banner added in between is never overwritten.
      if (latest.updatedAt) body.ifUpdatedAt = latest.updatedAt;
      const data = await apiRequest<{ config: AppConfig }>('/api/config', {
        method: 'PUT',
        body: JSON.stringify(body),
      }).catch((err: unknown) => {
        if (err instanceof Error && /changed the app config/i.test(err.message)) setStaleRemote(true);
        throw err;
      });
      const saved = normalizeConfig(data?.config);
      baseline.current = saved;
      setConfig(saved);
      setStaleRemote(false);
      setDirty(false);
      setNotice('Configuration saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the configuration.');
    } finally {
      setSaving(false);
    }
  };

  const updateBanner = <K extends keyof Banner>(index: number, field: K, value: Banner[K]) => {
    if (!config) return;
    const banners = [...config.banners];
    banners[index] = { ...banners[index], [field]: value };
    edit({ ...config, banners });
  };

  const updateCategory = <K extends keyof Category>(index: number, field: K, value: Category[K]) => {
    if (!config) return;
    const categories = [...config.categories];
    categories[index] = { ...categories[index], [field]: value };
    edit({ ...config, categories });
  };

  if (loading) {
    return (
      <div className="flex justify-center">
        <div className="w-8 h-8 border-2 border-success/30 border-t-success/30 rounded-full animate-spin" />
      </div>
    );
  }

  if (!config) {
    return (
      <div className="max-w-xl mx-auto mt-16 rounded-lg border border-line bg-surface shadow-xs p-8 text-center space-y-4">
        <p className="text-sm font-semibold text-danger-text">{error || 'Could not load the configuration.'}</p>
        <button onClick={fetchConfig} className="px-6 py-2.5 bg-surface-2/60 hover:bg-surface-2 border border-line rounded-xl text-xs font-semibold text-fg">
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-7xl mx-auto text-fg">
      <div className="flex justify-between items-start gap-6 mb-6 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-fg">Home screen layout</h1>
          <p className="mt-1 max-w-3xl text-sm text-fg-muted">Banners and sections on the customer app home screen.</p>
          {config.updatedAt && (
            <p className="text-fg-subtle text-xs mt-1">Last saved {new Date(config.updatedAt).toLocaleString()}</p>
          )}
        </div>
        <div className="flex gap-3 items-center">
          {dirty && <span className="text-xs font-semibold text-warning-text">Unsaved changes</span>}
          <button
            onClick={fetchConfig}
            disabled={saving}
            className="px-5 py-3 rounded-xl text-xs font-semibold bg-surface-2/60 hover:bg-surface-2 border border-line disabled:opacity-50"
          >
            {dirty ? 'Discard' : 'Reload'}
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !dirty}
            className="bg-success hover:bg-success/90 disabled:opacity-50 disabled:cursor-not-allowed px-8 py-3 rounded-xl font-semibold text-sm shadow-emerald-500/20"
          >
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>

      <div className="mb-6 p-4 rounded-lg border border-warning/30 bg-warning-soft text-xs text-warning-text leading-relaxed">
        Heads-up: the current customer app does not read this config yet, so these banners, categories and flags are saved
        but not shown to students. Ordering hours and the delivery fee are controlled elsewhere (Config page and backend env).
      </div>

      {staleRemote && (
        <div role="alert" className="mb-6 rounded-xl border border-warning/30 bg-warning-soft px-4 py-3 text-sm font-semibold text-warning-text">
          The app config was changed elsewhere while you were editing. Only the fields you edited will be saved, but use Discard to load the latest version if you are unsure.
        </div>
      )}
      {error && (
        <div className="mb-6 p-4 rounded-xl border border-danger/30 bg-danger-soft text-sm font-semibold text-danger-text">{error}</div>
      )}
      {notice && (
        <div className="mb-6 p-4 rounded-xl border border-success/30 bg-success-soft text-sm font-semibold text-success-text">{notice}</div>
      )}

      {/* Global flags */}
      <div className="bg-surface border border-line rounded-lg p-6 mb-8">
        <h2 className="text-xl font-semibold mb-4 text-fg">Status Flags</h2>
        <div className="flex gap-8 flex-wrap">
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={config.maintenanceMode}
              onChange={(e) => edit({ ...config, maintenanceMode: e.target.checked })}
              className="w-5 h-5 accent-[rgb(var(--accent))]"
            />
            <span className="font-semibold">Maintenance mode</span>
          </label>
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={config.campusOpen}
              onChange={(e) => edit({ ...config, campusOpen: e.target.checked })}
              className="w-5 h-5 accent-[rgb(var(--accent))]"
            />
            <span className="font-semibold">Campus open</span>
          </label>
        </div>
      </div>

      {/* Banners */}
      <div className="bg-surface border border-line rounded-lg p-6 mb-8">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-semibold text-fg">Promotional Banners</h2>
          <button
            onClick={() => edit({
              ...config,
              banners: [...config.banners, { imageUrl: '', tagline: '', title1: '', title2: '', description: '', buttonText: '', redirectUrl: '', isActive: false }],
            })}
            className="text-success-text text-sm font-semibold bg-success-soft px-4 py-2 rounded-lg"
          >
            + Add Banner
          </button>
        </div>

        {config.banners.length === 0 ? (
          <p className="text-sm text-fg-muted py-6 text-center">No banners yet.</p>
        ) : (
          <div className="space-y-4">
            {config.banners.map((banner, idx) => (
              <div key={idx} className={`p-4 border rounded-xl flex flex-col gap-3 ${banner.isActive ? 'border-success/30 bg-success-soft' : 'border-line opacity-60'}`}>
                <div className="flex justify-between">
                  <span className="font-semibold text-success-text">Banner #{idx + 1}</span>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={!!banner.isActive} onChange={(e) => updateBanner(idx, 'isActive', e.target.checked)} />
                    <span className="text-xs">Active</span>
                  </label>
                </div>
                <input placeholder="Image URL" value={banner.imageUrl || ''} onChange={e => updateBanner(idx, 'imageUrl', e.target.value)} className="bg-surface-2 border border-line p-2 rounded text-sm w-full" />
                <div className="grid grid-cols-2 gap-3">
                  <input placeholder="Tagline" value={banner.tagline || ''} onChange={e => updateBanner(idx, 'tagline', e.target.value)} className="bg-surface-2 border border-line p-2 rounded text-sm" />
                  <input placeholder="Redirect path (e.g. /mega-basket)" value={banner.redirectUrl || ''} onChange={e => updateBanner(idx, 'redirectUrl', e.target.value)} className="bg-surface-2 border border-line p-2 rounded text-sm" />
                  <input placeholder="Title line 1" value={banner.title1 || ''} onChange={e => updateBanner(idx, 'title1', e.target.value)} className="bg-surface-2 border border-line p-2 rounded text-sm" />
                  <input placeholder="Title line 2" value={banner.title2 || ''} onChange={e => updateBanner(idx, 'title2', e.target.value)} className="bg-surface-2 border border-line p-2 rounded text-sm" />
                  <input placeholder="Button text" value={banner.buttonText || ''} onChange={e => updateBanner(idx, 'buttonText', e.target.value)} className="bg-surface-2 border border-line p-2 rounded text-sm col-span-2" />
                </div>
                <textarea placeholder="Description" value={banner.description || ''} onChange={e => updateBanner(idx, 'description', e.target.value)} className="bg-surface-2 border border-line p-2 rounded text-sm w-full h-16" />
                <div className="flex justify-end">
                  <button
                    onClick={() => {
                      if (!confirm(`Remove banner #${idx + 1}? It is deleted when you save.`)) return;
                      edit({ ...config, banners: config.banners.filter((_, i) => i !== idx) });
                    }}
                    className="text-danger-text text-xs font-semibold hover:underline"
                  >
                    Remove Banner
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Categories */}
      <div className="bg-surface border border-line rounded-lg p-6">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-semibold text-fg">Category Shortcuts</h2>
          <button
            onClick={() => edit({
              ...config,
              categories: [...config.categories, { name: '', img: '', order: config.categories.length + 1, isActive: false }],
            })}
            className="text-info-text text-sm font-semibold bg-info-soft px-4 py-2 rounded-lg"
          >
            + Add Category
          </button>
        </div>

        {config.categories.length === 0 ? (
          <p className="text-sm text-fg-muted py-6 text-center">No categories yet.</p>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {config.categories.map((cat, idx) => (
              <div key={idx} className={`p-4 border rounded-xl flex flex-col gap-2 ${cat.isActive ? 'border-info/30 bg-info-soft' : 'border-line opacity-60'}`}>
                <div className="flex justify-between items-center">
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={!!cat.isActive} onChange={(e) => updateCategory(idx, 'isActive', e.target.checked)} />
                    <span className="text-xs">Active</span>
                  </label>
                  <label className="flex items-center gap-1 text-xs text-fg-muted">
                    Order
                    <input
                      type="number"
                      value={Number.isFinite(cat.order) ? cat.order : 0}
                      onChange={e => updateCategory(idx, 'order', parseInt(e.target.value, 10) || 0)}
                      className="w-12 bg-surface-2 border border-line p-1 rounded text-xs text-center text-fg"
                    />
                  </label>
                </div>
                <input placeholder="Name" value={cat.name || ''} onChange={e => updateCategory(idx, 'name', e.target.value)} className="bg-surface-2 border border-line p-2 rounded text-sm" />
                <input placeholder="Image URL or path" value={cat.img || ''} onChange={e => updateCategory(idx, 'img', e.target.value)} className="bg-surface-2 border border-line p-2 rounded text-sm" />
                <div className="flex justify-end mt-1">
                  <button
                    onClick={() => {
                      if (!confirm(`Remove "${cat.name || 'this category'}"? It is deleted when you save.`)) return;
                      edit({ ...config, categories: config.categories.filter((_, i) => i !== idx) });
                    }}
                    className="text-danger-text text-xs font-semibold hover:underline"
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
