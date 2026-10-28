"use client";
import {
  Badge, Button, Card, CardBody, CardHeader, Drawer, EmptyState, ErrorState, Field, Input, LoadingState, Notice, PageHeader, Switch, Textarea, useConfirm,
  IconPlus,
} from '@/components/ui';
import ListImage from '@/components/ListImage';
import { formatDateTime } from '@/lib/format';
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
  const confirm = useConfirm();
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
      if (conflicts.length && !(await confirm({
        title: 'Someone else changed this page',
        description: `${conflicts.join(', ')} changed since this page loaded. Saving replaces their change with yours. Press Cancel, then Discard, to load their version first.`,
        confirmLabel: 'Save anyway',
        tone: 'danger',
      }))) {
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

  const [openBanner, setOpenBanner] = useState<number | null>(null);

  if (loading && !config) return <LoadingState label="Loading the home screen layout…" />;

  if (!config) {
    return (
      <div className="text-fg">
        <PageHeader title="Home screen layout" description="Banners, category shortcuts and status flags for the customer app home screen." />
        <ErrorState title="Could not load the configuration" message={error || undefined} onRetry={fetchConfig} />
      </div>
    );
  }

  const banner = openBanner != null ? config.banners[openBanner] : null;
  const addBanner = () => {
    edit({
      ...config,
      banners: [...config.banners, { imageUrl: '', tagline: '', title1: '', title2: '', description: '', buttonText: '', redirectUrl: '', isActive: false }],
    });
    setOpenBanner(config.banners.length);
  };
  const removeBanner = async (idx: number) => {
    if (!(await confirm({ title: `Remove banner ${idx + 1}?`, description: 'It is deleted when you save.', confirmLabel: 'Remove banner', tone: 'danger' }))) return;
    setOpenBanner(null);
    edit({ ...config, banners: config.banners.filter((_, i) => i !== idx) });
  };

  return (
    <div className="text-fg">
      <PageHeader
        title="Home screen layout"
        description="Banners, category shortcuts and status flags for the customer app home screen."
        meta={dirty ? <Badge tone="warning" dot>Unsaved changes</Badge> : config.updatedAt ? <span className="text-xs text-fg-subtle">Last saved {formatDateTime(config.updatedAt, { short: true })}</span> : undefined}
        actions={(
          <>
            <Button onClick={fetchConfig} disabled={saving}>{dirty ? 'Discard' : 'Reload'}</Button>
            <Button variant="primary" onClick={handleSave} loading={saving} disabled={!dirty}>Save changes</Button>
          </>
        )}
      />

      <div className="space-y-3">
        <Notice tone="warning" title="Not shown in the app yet">
          The current customer app does not read this config yet, so these banners, categories and flags are saved but not shown to students. Ordering hours and the delivery fee are set on Settings and fees.
        </Notice>
        {staleRemote && (
          <Notice tone="warning" title="Changed elsewhere">
            The app config was changed elsewhere while you were editing. Only the fields you edited will be saved, but use Discard to load the latest version if you are unsure.
          </Notice>
        )}
        {error && <Notice tone="danger" onClose={() => setError(null)}>{error}</Notice>}
        {notice && <Notice tone="success" onClose={() => setNotice(null)}>{notice}</Notice>}
      </div>

      <div className="mt-5 space-y-5">
        <Card>
          <CardHeader title="Status flags" description="Saved with the rest of the page." />
          <CardBody className="space-y-4">
            <Switch
              checked={config.maintenanceMode}
              onChange={v => edit({ ...config, maintenanceMode: v })}
              label="Maintenance mode"
              description="Marks the app as under maintenance."
            />
            <Switch
              checked={config.campusOpen}
              onChange={v => edit({ ...config, campusOpen: v })}
              label="Campus open"
              description="Off marks campus services as closed."
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Promotional banners"
            description="Click a banner to edit its text, image and link."
            actions={<Button size="sm" leftIcon={<IconPlus size={14} />} onClick={addBanner}>Add banner</Button>}
          />
          {config.banners.length === 0 ? (
            <EmptyState title="No banners yet" description="Add one to promote a store or feature." />
          ) : (
            <div className="overflow-x-auto">
              <table className="zv-table">
                <thead>
                  <tr><th className="w-10">#</th><th>Banner</th><th>Opens</th><th>Active</th><th className="text-right"><span className="sr-only">Actions</span></th></tr>
                </thead>
                <tbody>
                  {config.banners.map((b, idx) => (
                    <tr key={idx} className="cursor-pointer" onClick={() => setOpenBanner(idx)}>
                      <td className="tabular-nums text-fg-muted">{idx + 1}</td>
                      <td>
                        <div className="flex min-w-0 items-center gap-3">
                          {b.imageUrl ? <ListImage thumb src={b.imageUrl} className="h-9 w-14 shrink-0 rounded border border-line object-cover" fallback={<div aria-hidden className="h-9 w-14 shrink-0 rounded border border-line bg-surface-2" />} /> : <div aria-hidden className="h-9 w-14 shrink-0 rounded border border-line bg-surface-2" />}
                          <div className="min-w-0">
                            <p className="truncate font-medium text-fg">{[b.title1, b.title2].filter(Boolean).join(' ') || 'Untitled banner'}</p>
                            <p className="truncate text-xs text-fg-muted">{b.tagline || 'No tagline'}</p>
                          </div>
                        </div>
                      </td>
                      <td className="font-mono text-xs text-fg-muted">{b.redirectUrl || '–'}</td>
                      <td onClick={e => e.stopPropagation()}>
                        <Switch size="sm" checked={!!b.isActive} onChange={v => updateBanner(idx, 'isActive', v)} label={<span className="sr-only">Active</span>} />
                      </td>
                      <td className="text-right" onClick={e => e.stopPropagation()}>
                        <Button size="sm" variant="ghost" onClick={() => setOpenBanner(idx)}>Edit</Button>
                        <Button size="sm" variant="ghost" className="text-danger-text" onClick={() => removeBanner(idx)}>Remove</Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card>
          <CardHeader
            title="Category shortcuts"
            description="Lower order numbers show first."
            actions={(
              <Button
                size="sm"
                leftIcon={<IconPlus size={14} />}
                onClick={() => edit({
                  ...config,
                  categories: [...config.categories, { name: '', img: '', order: config.categories.length + 1, isActive: false }],
                })}
              >
                Add category
              </Button>
            )}
          />
          {config.categories.length === 0 ? (
            <EmptyState title="No categories yet" description="Add shortcuts such as Snacks or Groceries." />
          ) : (
            <div className="overflow-x-auto">
              <table className="zv-table">
                <thead>
                  <tr><th className="w-24">Order</th><th>Name</th><th>Image URL or path</th><th>Active</th><th className="text-right"><span className="sr-only">Actions</span></th></tr>
                </thead>
                <tbody>
                  {config.categories.map((cat, idx) => (
                    <tr key={idx}>
                      <td>
                        <Input
                          aria-label="Order"
                          type="number"
                          className="w-20"
                          value={Number.isFinite(cat.order) ? cat.order : 0}
                          onChange={e => updateCategory(idx, 'order', parseInt(e.target.value, 10) || 0)}
                        />
                      </td>
                      <td><Input aria-label="Name" placeholder="Name" value={cat.name || ''} onChange={e => updateCategory(idx, 'name', e.target.value)} /></td>
                      <td><Input aria-label="Image URL or path" placeholder="https://… or /images/…" value={cat.img || ''} onChange={e => updateCategory(idx, 'img', e.target.value)} /></td>
                      <td><Switch size="sm" checked={!!cat.isActive} onChange={v => updateCategory(idx, 'isActive', v)} label={<span className="sr-only">Active</span>} /></td>
                      <td className="text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-danger-text"
                          onClick={async () => {
                            if (!(await confirm({ title: `Remove “${cat.name || 'this category'}”?`, description: 'It is deleted when you save.', confirmLabel: 'Remove', tone: 'danger' }))) return;
                            edit({ ...config, categories: config.categories.filter((_, i) => i !== idx) });
                          }}
                        >
                          Remove
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      <Drawer
        open={!!banner}
        onClose={() => setOpenBanner(null)}
        size="md"
        title={openBanner != null ? `Banner ${openBanner + 1}` : 'Banner'}
        description="Changes are kept on this page until you press Save changes."
        footer={openBanner != null ? (
          <div className="flex w-full justify-between gap-2">
            <Button variant="ghost" className="text-danger-text" onClick={() => removeBanner(openBanner)}>Remove banner</Button>
            <Button variant="primary" onClick={() => setOpenBanner(null)}>Done</Button>
          </div>
        ) : undefined}
      >
        {banner && openBanner != null && (
          <div className="space-y-4">
            <Switch checked={!!banner.isActive} onChange={v => updateBanner(openBanner, 'isActive', v)} label="Active" description="Only active banners are shown." />
            <Field label="Image URL">
              <Input value={banner.imageUrl || ''} onChange={e => updateBanner(openBanner, 'imageUrl', e.target.value)} placeholder="https://…" />
            </Field>
            {banner.imageUrl && <ListImage src={banner.imageUrl} className="max-h-40 w-full rounded-lg border border-line object-cover" fallback={<div className="rounded-lg border border-line bg-surface-2 p-4 text-center text-xs text-fg-muted">Image could not be loaded.</div>} />}
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Title line 1"><Input value={banner.title1 || ''} onChange={e => updateBanner(openBanner, 'title1', e.target.value)} /></Field>
              <Field label="Title line 2"><Input value={banner.title2 || ''} onChange={e => updateBanner(openBanner, 'title2', e.target.value)} /></Field>
              <Field label="Tagline"><Input value={banner.tagline || ''} onChange={e => updateBanner(openBanner, 'tagline', e.target.value)} /></Field>
              <Field label="Button text"><Input value={banner.buttonText || ''} onChange={e => updateBanner(openBanner, 'buttonText', e.target.value)} /></Field>
            </div>
            <Field label="Opens" hint="An app path, for example /others.">
              <Input value={banner.redirectUrl || ''} onChange={e => updateBanner(openBanner, 'redirectUrl', e.target.value)} placeholder="/others" />
            </Field>
            <Field label="Description">
              <Textarea rows={3} value={banner.description || ''} onChange={e => updateBanner(openBanner, 'description', e.target.value)} />
            </Field>
          </div>
        )}
      </Drawer>
    </div>
  );
}
