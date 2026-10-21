"use client";
import {
  Button, ButtonLink, Card, CardBody, CardHeader, ErrorState, Field, Input, LoadingState, Notice as NoticeBox, PageHeader, StatusPill, Switch, Textarea, useConfirm,
  IconChevronRight, IconRefresh,
} from '@/components/ui';
import { humanize } from '@/lib/format';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useAdminAuth } from '@/utils/useAdminAuth';
import { adminRequest } from '@/lib/api';
import CampusSafetyPanel from './CampusSafetyPanel';

/**
 * Zenvy Friends configuration hub (backend: GET/PUT /api/campus/mod/config, stored in GlobalConfig
 * "friends.config"). A sub-tab is live for students only when its flag is on AND its phase has
 * shipped on the server ("implemented"), so turning a flag on early is harmless.
 */

const FEATURES = ['pulse', 'forum', 'tasks', 'connect', 'spaces'] as const;
type Feature = typeof FEATURES[number];
const SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;
type Severity = typeof SEVERITIES[number];

interface FriendsConfig {
  enabled: boolean;
  features: Record<Feature, boolean>;
  guidelines: { version: number; text: string };
  keywords: { block: string[]; flag: string[] };
  linkDenylist: string[];
  autoHideThreshold: number;
  slaHours: Record<Severity, number>;
  connectConsentVersion: number;
}

interface ConfigResponse {
  config: FriendsConfig;
  implemented: Record<Feature, boolean>;
  effective: Record<Feature, boolean>;
}

interface Draft {
  enabled: boolean;
  features: Record<Feature, boolean>;
  guidelinesVersion: string;
  guidelinesText: string;
  keywordsBlock: string;
  keywordsFlag: string;
  linkDenylist: string;
  autoHideThreshold: string;
  slaHours: Record<Severity, string>;
  connectConsentVersion: string;
}

type Notice = { kind: 'ok' | 'error'; text: string } | null;

const FEATURE_INFO: Record<Feature, { label: string; phase: number; blurb: string }> = {
  forum: { label: 'Forum', phase: 1, blurb: 'Communities, questions and answers, reviews, Freshers Guide.' },
  pulse: { label: 'Pulse', phase: 2, blurb: 'Campus feed, posts, follows, verified clubs and departments.' },
  tasks: { label: 'Tasks', phase: 3, blurb: 'Peer help requests with applications, task chats and ratings.' },
  connect: { label: 'Connect', phase: 4, blurb: '18+ opt-in matching with photo review and selfie check.' },
  spaces: { label: 'Spaces', phase: 5, blurb: 'Live audio rooms (WebRTC).' },
};

const SUBPAGES: Array<{ href: string; label: string; phase: number; detail: string }> = [
  { href: '/friends/forum', label: 'Forum admin', phase: 1, detail: 'Communities, moderators, review-target approvals, Freshers Guide.' },
  { href: '/friends/pulse', label: 'Pulse admin', phase: 2, detail: 'Activity and trends, held posts, verified entities, badges, whisper import.' },
  { href: '/friends/connect', label: 'Connect admin', phase: 4, detail: 'Photo approvals, manual liveness review, consent versions.' },
  { href: '/friends/spaces', label: 'Spaces admin', phase: 5, detail: 'Live rooms monitor and force end.' },
];

const errText = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);
const toLines = (list: string[]) => list.join('\n');
const fromLines = (text: string) => [...new Set(text.split(/[\n,]/).map((w) => w.trim().toLowerCase()).filter(Boolean))];

const toDraft = (c: FriendsConfig): Draft => ({
  enabled: c.enabled,
  features: { ...c.features },
  guidelinesVersion: String(c.guidelines.version),
  guidelinesText: c.guidelines.text,
  keywordsBlock: toLines(c.keywords.block),
  keywordsFlag: toLines(c.keywords.flag),
  linkDenylist: toLines(c.linkDenylist),
  autoHideThreshold: String(c.autoHideThreshold),
  slaHours: Object.fromEntries(SEVERITIES.map((s) => [s, String(c.slaHours[s])])) as Record<Severity, string>,
  connectConsentVersion: String(c.connectConsentVersion),
});

export default function FriendsConfigPage() {
  const confirm = useConfirm();
  const { isAuthed } = useAdminAuth();
  const [data, setData] = useState<ConfigResponse | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminRequest<ConfigResponse>('/api/campus/mod/config');
      if (!res?.config) throw new Error('The server returned no configuration.');
      setData(res);
      setDraft(toDraft(res.config));
      setLoadError(null);
    } catch (e) {
      setLoadError(errText(e, 'Could not load the Friends configuration.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAuthed) load();
  }, [isAuthed, load]);

  /** Builds the PUT body from fields that changed; returns errors for invalid input. */
  const patch = useMemo(() => {
    if (!data || !draft) return { body: {} as Record<string, unknown>, errors: [] as string[], dirty: false };
    const c = data.config;
    const body: Record<string, unknown> = {};
    const errors: string[] = [];

    if (draft.enabled !== c.enabled) body.enabled = draft.enabled;
    const featureChanges = Object.fromEntries(FEATURES.filter((f) => draft.features[f] !== c.features[f]).map((f) => [f, draft.features[f]]));
    if (Object.keys(featureChanges).length) body.features = featureChanges;

    const gv = Number(draft.guidelinesVersion);
    const g: Record<string, unknown> = {};
    if (!Number.isInteger(gv) || gv < c.guidelines.version || gv > 1000) errors.push(`Guidelines version must be a whole number from ${c.guidelines.version} to 1000.`);
    else if (gv !== c.guidelines.version) g.version = gv;
    if (!draft.guidelinesText.trim() || draft.guidelinesText.length > 8000) errors.push('Guidelines text must be 1-8000 characters.');
    else if (draft.guidelinesText !== c.guidelines.text) g.text = draft.guidelinesText;
    if (Object.keys(g).length) body.guidelines = g;

    const block = fromLines(draft.keywordsBlock);
    const flag = fromLines(draft.keywordsFlag);
    for (const [name, list] of [['Blocked', block], ['Flagged', flag]] as const) {
      if (list.length > 500) errors.push(`${name} words: at most 500.`);
      if (list.some((w) => w.length > 60)) errors.push(`${name} words must be 60 characters or fewer.`);
    }
    const k: Record<string, string[]> = {};
    if (toLines(block) !== toLines(c.keywords.block)) k.block = block;
    if (toLines(flag) !== toLines(c.keywords.flag)) k.flag = flag;
    if (Object.keys(k).length) body.keywords = k;

    const hosts = fromLines(draft.linkDenylist);
    const badHost = hosts.find((h) => !/^[a-z0-9.-]{3,100}$/.test(h));
    if (badHost) errors.push(`"${badHost}" is not a host name (use e.g. example.com).`);
    else if (hosts.length > 500) errors.push('Link denylist: at most 500 hosts.');
    else if (toLines(hosts) !== toLines(c.linkDenylist)) body.linkDenylist = hosts;

    const t = Number(draft.autoHideThreshold);
    if (!Number.isInteger(t) || t < 2 || t > 20) errors.push('Auto-hide threshold must be 2-20 reporters.');
    else if (t !== c.autoHideThreshold) body.autoHideThreshold = t;

    const sla: Record<string, number> = {};
    for (const s of SEVERITIES) {
      const v = Number(draft.slaHours[s]);
      if (!Number.isFinite(v) || v < 1 || v > 720) errors.push(`SLA for ${s} must be 1-720 hours.`);
      else if (v !== c.slaHours[s]) sla[s] = v;
    }
    if (Object.keys(sla).length) body.slaHours = sla;

    const cv = Number(draft.connectConsentVersion);
    if (!Number.isInteger(cv) || cv < c.connectConsentVersion) errors.push(`Connect consent version cannot go below ${c.connectConsentVersion}.`);
    else if (cv !== c.connectConsentVersion) body.connectConsentVersion = cv;

    return { body, errors, dirty: Object.keys(body).length > 0 };
  }, [data, draft]);

  const save = async () => {
    if (!data || !patch.dirty || patch.errors.length) return;
    const lines: string[] = [];
    if (patch.body.enabled === false) lines.push('Turn OFF Friends for every student.');
    const g = patch.body.guidelines as { version?: number } | undefined;
    if (g?.version) lines.push(`Publish guidelines v${g.version}: every student must accept them again before posting.`);
    if (typeof patch.body.connectConsentVersion === 'number') lines.push(`Connect consent v${patch.body.connectConsentVersion}: Connect users must consent again.`);
    const on = Object.entries((patch.body.features || {}) as Record<string, boolean>).filter(([, v]) => v).map(([f]) => f);
    if (on.length) lines.push(`Turn ON: ${on.join(', ')} (only shipped phases go live).`);
    if (lines.length && !(await confirm({
      title: 'Save these changes?',
      description: <ul className="list-disc space-y-1 pl-4">{lines.map(l => <li key={l}>{l}</li>)}</ul>,
      confirmLabel: 'Save changes',
      tone: patch.body.enabled === false ? 'danger' : 'default',
    }))) return;
    setSaving(true);
    try {
      const res = await adminRequest<ConfigResponse>('/api/campus/mod/config', { method: 'PUT', body: JSON.stringify(patch.body) });
      setData(res);
      setDraft(toDraft(res.config));
      setNotice({ kind: 'ok', text: 'Saved. Students see the change within about 30 seconds.' });
    } catch (e) {
      setNotice({ kind: 'error', text: errText(e, 'Could not save the configuration.') });
    } finally {
      setSaving(false);
    }
  };

  if (!isAuthed) return null; // AppShell shows the session check

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((p) => (p ? { ...p, [key]: value } : p));

  return (
    <div className="pb-24 text-fg">
      <PageHeader
        title="Friends app"
        description="Switches, guidelines, content filters and review rules for Friends (Forum, Pulse, Tasks, Connect, Spaces). Every save is recorded in the moderation log."
        actions={(
          <>
            <ButtonLink href="/moderation">Moderation queue</ButtonLink>
            <Button leftIcon={<IconRefresh size={14} />} disabled={saving} loading={loading} onClick={load}>Reload</Button>
          </>
        )}
      />

      {notice && <NoticeBox tone={notice.kind === 'ok' ? 'success' : 'danger'} className="mb-4" onClose={() => setNotice(null)}>{notice.text}</NoticeBox>}

      {loading && !draft ? (
        <LoadingState label="Loading configuration…" />
      ) : loadError && !draft ? (
        <ErrorState title="Could not load the Friends configuration" message={loadError} onRetry={load} />
      ) : draft && data ? (
        <div className="space-y-5">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {SUBPAGES.map((p) => {
              const feature = p.href.split('/').pop() as Feature;
              const shipped = data.implemented[feature];
              return shipped ? (
                <Link key={p.href} href={p.href} className="group rounded-lg border border-line bg-surface p-4 shadow-xs transition-colors hover:border-line-strong hover:bg-surface-2">
                  <p className="flex items-center justify-between text-sm font-medium text-fg">{p.label}<IconChevronRight size={14} className="text-fg-subtle group-hover:text-fg" /></p>
                  <p className="mt-0.5 text-xs text-fg-muted">{p.detail}</p>
                </Link>
              ) : (
                <div key={p.href} className="rounded-lg border border-line bg-surface p-4 opacity-60" aria-disabled="true">
                  <p className="text-sm font-medium text-fg">{p.label} <span className="ml-1 text-xs font-normal text-fg-muted">Arrives with phase {p.phase}</span></p>
                  <p className="mt-0.5 text-xs text-fg-muted">{p.detail}</p>
                </div>
              );
            })}
          </div>

          <Card>
            <CardHeader title="Switches" description="A section is live for students only when its switch is on and its phase has shipped on the server, so turning one on early is harmless." />
            <div className="border-b border-line px-4 py-3">
              <Switch
                checked={draft.enabled}
                onChange={(v) => set('enabled', v)}
                label="Friends tab"
                description="Master switch. Off hides Friends for every student, including chats started from it."
              />
            </div>
            <ul className="divide-y divide-line">
              {FEATURES.slice().sort((a, b) => FEATURE_INFO[a].phase - FEATURE_INFO[b].phase).map((f) => {
                const shipped = data.implemented[f];
                const live = data.effective[f];
                return (
                  <li key={f} className="px-4 py-3">
                    <Switch
                      checked={draft.features[f]}
                      onChange={(v) => set('features', { ...draft.features, [f]: v })}
                      label={(
                        <span className="inline-flex flex-wrap items-center gap-2">
                          {FEATURE_INFO[f].label}
                          <span className="text-xs font-normal text-fg-subtle">Phase {FEATURE_INFO[f].phase}</span>
                          <StatusPill status={live ? 'live' : shipped ? 'off' : 'not shipped'} tone={live ? 'success' : 'neutral'} label={live ? 'Live' : shipped ? 'Off' : 'Not shipped yet'} />
                        </span>
                      )}
                      description={(
                        <>
                          {FEATURE_INFO[f].blurb}
                          {!shipped && draft.features[f] && <span className="mt-0.5 block text-warning-text">The switch is on, but this phase is not on the server yet. It goes live when it ships.</span>}
                        </>
                      )}
                    />
                  </li>
                );
              })}
            </ul>
          </Card>

          <Card>
            <CardHeader
              title="Community guidelines"
              description="Students must accept the current version before they can post. Raising the version asks everyone to accept again."
              actions={(
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    aria-label="Guidelines version"
                    min={data.config.guidelines.version}
                    max={1000}
                    className="w-20"
                    value={draft.guidelinesVersion}
                    onChange={(e) => set('guidelinesVersion', e.target.value)}
                  />
                  <Button size="sm" onClick={() => set('guidelinesVersion', String(data.config.guidelines.version + 1))}>Publish as new version</Button>
                </div>
              )}
            />
            <CardBody className="space-y-2">
              <Field label="Text" hint={`${draft.guidelinesText.length}/8000 characters`}>
                <Textarea className="min-h-[260px] font-mono text-xs leading-relaxed" maxLength={8000} value={draft.guidelinesText} onChange={(e) => set('guidelinesText', e.target.value)} />
              </Field>
              {draft.guidelinesText !== data.config.guidelines.text && Number(draft.guidelinesVersion) === data.config.guidelines.version && (
                <NoticeBox tone="warning">You changed the text without raising the version. Students who already accepted will not be asked again.</NoticeBox>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Content filters" description="One word or phrase per line (or comma-separated). Matching ignores upper and lower case." />
            <CardBody>
              <div className="grid gap-4 md:grid-cols-3">
                <Field label={`Block (${fromLines(draft.keywordsBlock).length})`} hint="The post is refused and the student is told why.">
                  <Textarea className="min-h-[160px] text-xs" value={draft.keywordsBlock} onChange={(e) => set('keywordsBlock', e.target.value)} placeholder="Refused outright" />
                </Field>
                <Field label={`Flag for review (${fromLines(draft.keywordsFlag).length})`} hint="Saved as pending review and added to the queue as a system report.">
                  <Textarea className="min-h-[160px] text-xs" value={draft.keywordsFlag} onChange={(e) => set('keywordsFlag', e.target.value)} placeholder="Held for review" />
                </Field>
                <Field label={`Blocked link hosts (${fromLines(draft.linkDenylist).length})`} hint="Links to these hosts are refused.">
                  <Textarea className="min-h-[160px] text-xs" value={draft.linkDenylist} onChange={(e) => set('linkDenylist', e.target.value)} placeholder="example.com" />
                </Field>
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Review rules" description="Reports never remove content by themselves. Only threats, self-harm and doxxing reports from enough different students hide content until a moderator decides." />
            <CardBody className="space-y-4">
              <div className="flex flex-wrap gap-4">
                <Field label="Auto-hide after this many reporters" hint="2 to 20.">
                  <Input type="number" min={2} max={20} className="w-32" value={draft.autoHideThreshold} onChange={(e) => set('autoHideThreshold', e.target.value)} />
                </Field>
                <Field label="Connect consent version" hint="Raising it asks Connect users to consent again.">
                  <Input type="number" min={data.config.connectConsentVersion} className="w-32" value={draft.connectConsentVersion} onChange={(e) => set('connectConsentVersion', e.target.value)} />
                </Field>
              </div>
              <div>
                <p className="mb-1.5 text-sm font-medium text-fg">Review deadline (hours until a report is overdue)</p>
                <div className="flex flex-wrap gap-3">
                  {SEVERITIES.map((s) => (
                    <Field key={s} label={humanize(s)}>
                      <Input type="number" min={1} max={720} className="w-28" value={draft.slaHours[s]} onChange={(e) => set('slaHours', { ...draft.slaHours, [s]: e.target.value })} />
                    </Field>
                  ))}
                </div>
                <p className="mt-1 text-xs text-fg-muted">1 to 720 hours. Applies to new reports.</p>
              </div>
            </CardBody>
          </Card>

          {/* C2: Whispers / After Dark switches + whisper board */}
          <CampusSafetyPanel />

          <div className="sticky bottom-4 z-30">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-surface px-4 py-3 shadow-pop">
              <div className="text-sm">
                {patch.errors.length ? (
                  <ul className="space-y-0.5 text-danger-text">{patch.errors.slice(0, 3).map((e) => <li key={e}>{e}</li>)}</ul>
                ) : patch.dirty ? (
                  <span className="text-warning-text">Unsaved changes: {Object.keys(patch.body).map(humanize).join(', ')}</span>
                ) : (
                  <span className="text-fg-muted">All changes saved.</span>
                )}
              </div>
              <div className="flex gap-2">
                <Button disabled={!patch.dirty || saving} onClick={() => setDraft(toDraft(data.config))}>Discard</Button>
                <Button variant="primary" disabled={!patch.dirty || patch.errors.length > 0} loading={saving} onClick={save}>Save changes</Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
