"use client";
// C3 force update: per-app minimum / latest versions (backend/utils/appVersionPolicy.js).
// GET/PUT /api/admin/app-versions (validated + audited on the server).
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
    if (raisingMin && !confirm(`Block every ${label} install older than ${min || '(any version)'}${build ? ` / build ${build}` : ''}? Those users will see only an "Update required" screen until they update from the store. Make sure that version is LIVE on the Play Store first.`)) return;
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
    if (next && !confirm('Block OLD app builds that do not report their version at all? Every install from before the force-update release will stop working until updated. Web, admin and tests are not affected.')) return;
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

  const input = 'w-full bg-white/5 border border-white/10 rounded-2xl p-3 text-white font-bold text-sm';
  const lbl = 'text-[10px] font-black text-gray-500 uppercase tracking-widest ml-1';

  return (
    <div className="glass-card p-10 space-y-6">
      <div className="flex items-center gap-4">
        <div className="w-10 h-10 bg-amber-600/20 rounded-xl flex items-center justify-center text-xl">📲</div>
        <div>
          <h4 className="text-lg font-black text-white uppercase tracking-tight">App Versions (force update)</h4>
          <p className="text-[10px] text-gray-500 font-bold uppercase tracking-widest">Retire broken or insecure app versions · empty minimum = nobody is blocked</p>
        </div>
      </div>

      {loadError && (
        <div className="flex items-center gap-3">
          <p className="text-xs font-bold text-red-400">{loadError}</p>
          <button onClick={() => load(app)} className="px-3 py-1.5 bg-white/5 border border-white/10 rounded-xl text-[10px] font-black uppercase text-gray-300">Retry</button>
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
                  className={`px-4 py-2 rounded-xl text-[11px] font-black uppercase tracking-wider border ${active ? 'bg-blue-600 border-blue-500 text-white' : 'bg-white/5 border-white/10 text-gray-400 hover:bg-white/10'}`}
                >
                  {data.labels[k]}{p.minSupportedVersion || p.minSupportedBuild ? ' 🔒' : ''}
                </button>
              );
            })}
          </div>

          <p className="text-[11px] text-gray-500">Package <span className="font-mono text-gray-300">{data.packages[app]}</span></p>

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
          <label className="flex items-center gap-3 text-sm text-gray-300">
            <input type="checkbox" checked={form.soft} onChange={e => setForm({ ...form, soft: e.target.checked })} />
            Show a dismissible &quot;new version available&quot; banner to users below the latest version (once per version)
          </label>
          <div className="flex items-center gap-4 flex-wrap">
            <button onClick={save} disabled={saving} className="px-6 py-3 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-2xl text-[10px] font-black uppercase tracking-widest text-white">
              {saving ? 'Saving…' : `Save ${data.labels[app]}`}
            </button>
            {error && <p className="text-xs font-bold text-red-400">{error}</p>}
            {notice && <p className="text-xs font-bold text-emerald-400">{notice}</p>}
          </div>

          <div className="border-t border-white/5 pt-5 flex items-start justify-between gap-4 flex-wrap">
            <div className="max-w-xl">
              <p className="text-sm font-black text-white">Block old builds that do not send a version</p>
              <p className="text-[11px] text-gray-500 mt-1 leading-relaxed">
                Builds released before force update do not report their version, so the rules above cannot see them.
                Turn this on only once nearly everyone has updated: those installs then get &quot;update required&quot; errors.
                Account deletion, logout and the website keep working.
              </p>
            </div>
            <button
              onClick={toggleUnversioned}
              disabled={saving}
              className={`px-5 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest border ${data.policy.blockUnversionedClients ? 'bg-red-600/20 border-red-500/40 text-red-300' : 'bg-white/5 border-white/10 text-gray-300'}`}
            >
              {data.policy.blockUnversionedClients ? 'On · blocking old builds' : 'Off'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
