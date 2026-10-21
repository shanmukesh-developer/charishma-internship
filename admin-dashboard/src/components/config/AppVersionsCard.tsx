"use client";
// C3 force update: per-app minimum / latest versions (backend/utils/appVersionPolicy.js).
// GET/PUT /api/admin/app-versions (validated + audited on the server).
import {
  Button, Card, CardBody, CardFooter, CardHeader, Field, Input, LoadingState, Notice, SegmentedControl, Switch, Textarea, useConfirm,
} from '@/components/ui';
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
    if (raisingMin && !(await confirm({ title: `Block ${label} installs older than ${min || '(any version)'}${build ? ` / build ${build}` : ''}?`, description: 'Those users will see only an “Update required” screen until they update from the store. Make sure that version is live on the Play Store first.', confirmLabel: 'Block older versions', tone: 'danger' }))) return;
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
    if (next && !(await confirm({ title: 'Block old builds that do not report a version?', description: 'Every install from before the force-update release will stop working until updated. Web, admin and tests are not affected.', confirmLabel: 'Block old builds', tone: 'danger' }))) return;
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


  return (
    <Card>
      <CardHeader
        title="App versions (force update)"
        description="Retire broken or insecure app versions. An empty minimum means nobody is blocked. Apps pick up changes within about a minute."
      />
      <CardBody className="space-y-4">
        {loadError && <Notice tone="danger" action={<Button size="sm" onClick={() => load(app)}>Retry</Button>}>{loadError}</Notice>}
        {!data && !loadError && <LoadingState label="Loading app versions…" />}

        {data && form && (
          <>
            <SegmentedControl<AppKey>
              ariaLabel="App"
              value={app}
              onChange={pick}
              options={data.apps.map(k => {
                const p = data.policy.apps[k];
                return {
                  value: k,
                  label: <span className="inline-flex items-center gap-1.5">{data.labels[k]}{(p.minSupportedVersion || p.minSupportedBuild) ? <span aria-label="minimum version set" title="Minimum version set" className="h-1.5 w-1.5 rounded-full bg-warning" /> : null}</span>,
                };
              })}
            />

            <p className="text-xs text-fg-muted">Package <span className="font-mono">{data.packages[app]}</span>. A dot on a tab means that app has a minimum version set.</p>

            <div className="grid gap-3 md:grid-cols-3">
              <Field label="Minimum supported version" hint="Empty turns blocking off.">
                <Input placeholder="e.g. 1.0.6" value={form.min} onChange={e => setForm({ ...form, min: e.target.value })} />
              </Field>
              <Field label="Latest version">
                <Input placeholder="e.g. 1.0.7" value={form.latest} onChange={e => setForm({ ...form, latest: e.target.value })} />
              </Field>
              <Field label="Minimum build" optional hint="Android versionCode.">
                <Input placeholder="e.g. 9" inputMode="numeric" value={form.build} onChange={e => setForm({ ...form, build: e.target.value })} />
              </Field>
            </div>
            <Field label="Store link">
              <Input placeholder={`https://play.google.com/store/apps/details?id=${data.packages[app]}`} value={form.storeUrl} onChange={e => setForm({ ...form, storeUrl: e.target.value })} />
            </Field>
            <Field label="Message on the Update screen" optional hint="Up to 300 characters.">
              <Textarea rows={2} maxLength={300} placeholder={data.defaultMessage} value={form.message} onChange={e => setForm({ ...form, message: e.target.value })} />
            </Field>
            <Switch
              checked={form.soft}
              onChange={v => setForm({ ...form, soft: v })}
              label="Show a “new version available” banner"
              description="Dismissible; shown once per version to users below the latest version."
            />
            {error && <Notice tone="danger">{error}</Notice>}
            {notice && <Notice tone="success">{notice}</Notice>}
          </>
        )}
      </CardBody>
      {data && form && (
        <CardFooter>
          <Button variant="primary" loading={saving} onClick={save}>Save {data.labels[app]}</Button>
        </CardFooter>
      )}
      {data && (
        <div className="border-t border-line px-4 py-4">
          <Switch
            checked={data.policy.blockUnversionedClients}
            disabled={saving}
            onChange={() => toggleUnversioned()}
            label="Block old builds that do not send a version"
            description="Builds released before force update do not report their version, so the rules above cannot see them. Turn this on only once nearly everyone has updated: those installs then get “update required” errors. Account deletion, logout and the website keep working."
          />
        </div>
      )}
    </Card>
  );
}
