"use client";
// C3 force update: per-app minimum / latest versions (backend/utils/appVersionPolicy.js).
// GET/PUT /api/admin/app-versions (validated + audited on the server).
import { useConfirm } from '@/components/ui';
import { useCallback, useEffect, useState } from 'react';
import { adminRequest as apiRequest } from '@/lib/api';

type AppKey = 'customer' | 'rider' | 'restaurant' | 'vendor' | 'autodriver';
interface AppPolicy {
  minSupportedVersion: string;
  latestVersion: string;
  minSupportedBuild: number | null;
  storeUrl: string;
  message: string;
  softPromptEnabled: boolean;
}
interface PolicyResponse {
  policy: { blockUnversionedClients: boolean; apps: Record<AppKey, AppPolicy> };
  apps: AppKey[];
  packages: Record<AppKey, string>;
  labels: Record<AppKey, string>;
  defaultMessage: string;
  updatedAt: string | null;
}
interface Form { min: string; latest: string; build: string; storeUrl: string; message: string; soft: boolean }

const SEMVER = /^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})$/;
const cmp = (a: string, b: string) => {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
  return 0;
};
const toForm = (p: AppPolicy): Form => ({
  min: p.minSupportedVersion || '',
  latest: p.latestVersion || '',
  build: p.minSupportedBuild ? String(p.minSupportedBuild) : '',
  storeUrl: p.storeUrl || '',
  message: p.message || '',
  soft: !!p.softPromptEnabled,
});

export default function AppVersionsCard() {
  const confirm = useConfirm();
  const [data, setData] = useState<PolicyResponse | null>(null);
  const [app, setApp] = useState<AppKey>('customer');
  const [form, setForm] = useState<Form | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async (keepApp?: AppKey) => {
    setLoadError(null);
    try {
      const d = await apiRequest<PolicyResponse>('/api/admin/app-versions');
      setData(d);
      setForm(toForm(d.policy.apps[keepApp || 'customer']));
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load app versions.');
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const pick = (k: AppKey) => {
    if (!data) return;
    setApp(k);
    setForm(toForm(data.policy.apps[k]));
    setError(null);
    setNotice(null);
  };

  const save = async () => {
    if (!data || !form || saving) return;
    setError(null);
    setNotice(null);
    const min = form.min.trim();
    const latest = form.latest.trim();
    const build = form.build.trim();
    if (min && !SEMVER.test(min)) return setError('Minimum version must look like 1.0.6 (three whole numbers), or be empty.');
    if (latest && !SEMVER.test(latest)) return setError('Latest version must look like 1.0.6 (three whole numbers), or be empty.');
    if (min && latest && cmp(min, latest) > 0) return setError('The minimum supported version cannot be newer than the latest version.');
    if (build && !/^[1-9]\d{0,9}$/.test(build)) return setError('Minimum build must be a whole number (Android versionCode), or empty.');
    if (form.message.trim().length > 300) return setError('Message is too long (max 300 characters).');
    const before = data.policy.apps[app];
    const label = data.labels[app];
    const raisingMin = (min && min !== before.minSupportedVersion) || (build && Number(build) !== (before.minSupportedBuild || 0));
    if (raisingMin && !(await confirm({ title: `Block every ${label} install older than ${min || '(any version)'}${build ? ` / build ${build}` : ''}? Those users will see only an "Update required" screen until they update from the store. Make sure that version is LIVE on the Play Store first.` }))) return;
    setSaving(true);
    try {
      const d = await apiRequest<PolicyResponse & { changed?: boolean }>('/api/admin/app-versions', {
        method: 'PUT',
        body: JSON.stringify({
          ifUpdatedAt: data.updatedAt || undefined,
          apps: {
            [app]: {
              minSupportedVersion: min,
              latestVersion: latest,
              minSupportedBuild: build ? Number(build) : null,
              storeUrl: form.storeUrl.trim(),
              message: form.message.trim(),
              softPromptEnabled: form.soft,
            },
          },
        }),
      });
      setData(d);
      setForm(toForm(d.policy.apps[app]));
      setNotice(d.changed === false ? 'No change to save.' : `${label} versions saved. Apps pick it up within about a minute.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.');
      if (err instanceof Error && /changed the app versions/i.test(err.message)) load(app);
    } finally {
      setSaving(false);
    }
  };

  const toggleUnversioned = async () => {
    if (!data || saving) return;
    const next = !data.policy.blockUnversionedClients;
    if (next && !(await confirm({ title: 'Block OLD app builds that do not report their version at all? Every install from before the force-update release will stop working until updated. Web, admin and tests are not affected.' }))) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const d = await apiRequest<PolicyResponse>('/api/admin/app-versions', {
        method: 'PUT',
        body: JSON.stringify({ ifUpdatedAt: data.updatedAt || undefined, blockUnversionedClients: next }),
      });
      setData(d);
      setNotice(next ? 'Old builds without a version are now blocked.' : 'Old builds without a version are allowed again.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.');
    } finally {
      setSaving(false);
    }
  };

  const input = 'w-full bg-surface-2/60 border border-line rounded-lg p-3 text-fg font-semibold text-sm';
  const lbl = 'text-xs font-semibold text-fg-muted ml-1';

  return (
    <div className="rounded-lg border border-line bg-surface shadow-xs p-10 space-y-6">
      <div className="flex items-center gap-4">
        <div>
          <h4 className="text-lg font-semibold text-fg">App Versions (force update)</h4>
          <p className="text-xs text-fg-muted font-semibold">Retire broken or insecure app versions · empty minimum = nobody is blocked</p>
        </div>
      </div>

      {loadError && (
        <div className="flex items-center gap-3">
          <p className="text-xs font-semibold text-danger-text">{loadError}</p>
          <button onClick={() => load(app)} className="px-3 py-1.5 bg-surface-2/60 border border-line rounded-xl text-xs font-semibold text-fg-muted">Retry</button>
        </div>
      )}

      {data && form && (
        <>
          <div className="flex flex-wrap gap-2" role="tablist">
            {data.apps.map(k => {
              const p = data.policy.apps[k];
              const active = k === app;
              return (
                <button
                  key={k}
                  role="tab"
                  aria-selected={active}
                  onClick={() => pick(k)}
                  className={`px-4 py-2 rounded-xl text-xs font-semibold border ${active ? 'bg-accent border-info/30 text-on-solid' : 'bg-surface-2/60 border-line text-fg-muted hover:bg-surface-2'}`}
                >
                  {data.labels[k]}{p.minSupportedVersion || p.minSupportedBuild ? ' (minimum version set)' : ''}
                </button>
              );
            })}
          </div>

          <p className="text-xs text-fg-muted">Package <span className="font-mono text-fg-muted">{data.packages[app]}</span></p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <label htmlFor="av-min" className={lbl}>Minimum supported version</label>
              <input id="av-min" className={input} placeholder="e.g. 1.0.6 (empty = off)" value={form.min} onChange={e => setForm({ ...form, min: e.target.value })} />
            </div>
            <div className="space-y-2">
              <label htmlFor="av-latest" className={lbl}>Latest version</label>
              <input id="av-latest" className={input} placeholder="e.g. 1.0.7" value={form.latest} onChange={e => setForm({ ...form, latest: e.target.value })} />
            </div>
            <div className="space-y-2">
              <label htmlFor="av-build" className={lbl}>Minimum build (optional)</label>
              <input id="av-build" className={input} placeholder="Android versionCode" inputMode="numeric" value={form.build} onChange={e => setForm({ ...form, build: e.target.value })} />
            </div>
          </div>
          <div className="space-y-2">
            <label htmlFor="av-url" className={lbl}>Store link</label>
            <input id="av-url" className={input} placeholder={`https://play.google.com/store/apps/details?id=${data.packages[app]}`} value={form.storeUrl} onChange={e => setForm({ ...form, storeUrl: e.target.value })} />
          </div>
          <div className="space-y-2">
            <label htmlFor="av-msg" className={lbl}>Message on the Update screen</label>
            <textarea id="av-msg" rows={2} maxLength={300} className={input} placeholder={data.defaultMessage} value={form.message} onChange={e => setForm({ ...form, message: e.target.value })} />
          </div>
          <label className="flex items-center gap-3 text-sm text-fg-muted">
            <input type="checkbox" checked={form.soft} onChange={e => setForm({ ...form, soft: e.target.checked })} />
            Show a dismissible &quot;new version available&quot; banner to users below the latest version (once per version)
          </label>
          <div className="flex items-center gap-4 flex-wrap">
            <button onClick={save} disabled={saving} className="px-6 py-3 bg-accent hover:bg-accent-hover disabled:opacity-50 rounded-lg text-xs font-semibold text-on-solid">
              {saving ? 'Saving…' : `Save ${data.labels[app]}`}
            </button>
            {error && <p className="text-xs font-semibold text-danger-text">{error}</p>}
            {notice && <p className="text-xs font-semibold text-success-text">{notice}</p>}
          </div>

          <div className="border-t border-line pt-5 flex items-start justify-between gap-4 flex-wrap">
            <div className="max-w-xl">
              <p className="text-sm font-semibold text-fg">Block old builds that do not send a version</p>
              <p className="text-xs text-fg-muted mt-1 leading-relaxed">
                Builds released before force update do not report their version, so the rules above cannot see them.
                Turn this on only once nearly everyone has updated: those installs then get &quot;update required&quot; errors.
                Account deletion, logout and the website keep working.
              </p>
            </div>
            <button
              onClick={toggleUnversioned}
              disabled={saving}
              className={`px-5 py-2.5 rounded-xl text-xs font-semibold border ${data.policy.blockUnversionedClients ? 'bg-danger-soft border-danger/30 text-danger-text' : 'bg-surface-2/60 border-line text-fg-muted'}`}
            >
              {data.policy.blockUnversionedClients ? 'On · blocking old builds' : 'Off'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
