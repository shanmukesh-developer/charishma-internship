"use client";
import { useConfirm } from '@/components/ui';
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

const input = 'w-full rounded-xl border border-line bg-surface-2/60 px-3 py-2 text-sm text-fg outline-none focus:border-accent';
const label = 'block text-xs font-semibold text-fg-muted mb-1';
const btn = 'rounded-xl px-4 py-2 text-xs font-semibold disabled:opacity-40 transition-colors';
const btnGhost = `${btn} border border-line bg-surface-2/60 text-fg-muted hover:text-fg`;
const card = 'rounded-lg border border-line bg-surface shadow-xs p-6 space-y-4';

function Toggle({ checked, onChange, disabled, labelText }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; labelText: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={labelText}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 shrink-0 rounded-full border transition-colors disabled:opacity-40 ${checked ? 'bg-success-soft border-success/30' : 'bg-surface-2 border-line'}`}
    >
      <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${checked ? 'left-[22px]' : 'left-0.5'}`} />
    </button>
  );
}

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
    if (lines.length && !(await confirm({ title: `${lines.join('\n')}\n\nSave these changes?` }))) return;
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

  if (!isAuthed) return <div className="p-20 text-center font-semibold text-fg animate-pulse">Checking access…</div>;

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((p) => (p ? { ...p, [key]: value } : p));

  return (
    <div className="space-y-8 animate-fade-in relative">
      <div className="flex flex-wrap gap-4 items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-fg">Friends app</h1>
          <p className="mt-1 max-w-3xl text-sm text-fg-muted">Friends features: connect, forum, pulse and spaces.</p>
        </div>
        <div className="flex gap-2">
          <Link href="/moderation" className={btnGhost}>Open moderation queue</Link>
          <button onClick={load} disabled={loading || saving} className={`${btn} bg-info-soft text-info-text border border-info/30`}>↻ Reload</button>
        </div>
      </div>

      {notice && (
        <div role="status" className={`rounded-lg border px-4 py-3 text-xs font-semibold flex items-center justify-between gap-4 ${notice.kind === 'ok' ? 'border-success/30 bg-success-soft text-success-text' : 'border-danger/30 bg-danger-soft text-danger-text'}`}>
          <span>{notice.text}</span>
          <button onClick={() => setNotice(null)} className="text-xs font-semibold opacity-70 hover:opacity-100">Dismiss</button>
        </div>
      )}

      {loading && !draft ? (
        <p className="text-xs text-fg-muted animate-pulse text-center py-16">Loading configuration…</p>
      ) : loadError && !draft ? (
        <div className="text-center py-16">
          <p className="text-xs text-danger-text font-semibold">{loadError}</p>
          <button onClick={load} className={`mt-3 ${btnGhost}`}>Try again</button>
        </div>
      ) : draft && data ? (
        <>
          {/* Feature flags */}
          <section className={card}>
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="text-sm font-semibold text-fg">Friends tab</h2>
                <p className="text-xs text-fg-muted">Master switch. Off hides Friends for every student, including chats started from it.</p>
              </div>
              <Toggle checked={draft.enabled} onChange={(v) => set('enabled', v)} labelText="Friends master switch" />
            </div>
            <div className="divide-y divide-line border-t border-line">
              {FEATURES.slice().sort((a, b) => FEATURE_INFO[a].phase - FEATURE_INFO[b].phase).map((f) => {
                const shipped = data.implemented[f];
                const live = data.effective[f];
                return (
                  <div key={f} className="flex items-center justify-between gap-4 py-3">
                    <div>
                      <p className="text-xs font-semibold text-fg">
                        {FEATURE_INFO[f].label}
                        <span className="ml-2 text-xs text-fg-muted">Phase {FEATURE_INFO[f].phase}</span>
                        <span className={`ml-2 text-xs px-2 py-0.5 rounded-md border ${live ? 'text-success-text border-success/30 bg-success-soft' : 'text-fg-muted border-line bg-surface-2/60'}`}>
                          {live ? 'Live' : shipped ? 'Off' : 'Not shipped yet'}
                        </span>
                      </p>
                      <p className="text-xs text-fg-muted">{FEATURE_INFO[f].blurb}</p>
                      {!shipped && draft.features[f] && <p className="text-xs text-warning-text">Flag is on, but this phase is not on the server yet. It goes live when it ships.</p>}
                    </div>
                    <Toggle checked={draft.features[f]} onChange={(v) => set('features', { ...draft.features, [f]: v })} labelText={`${FEATURE_INFO[f].label} flag`} />
                  </div>
                );
              })}
            </div>
          </section>

          {/* Guidelines */}
          <section className={card}>
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <h2 className="text-sm font-semibold text-fg">Community guidelines</h2>
                <p className="text-xs text-fg-muted">Students must accept the current version before they can post. Raising the version asks everyone to accept again.</p>
              </div>
              <div className="flex items-end gap-2">
                <div>
                  <span className={label}>Version</span>
                  <input type="number" min={data.config.guidelines.version} max={1000} className={`${input} w-24`} value={draft.guidelinesVersion} onChange={(e) => set('guidelinesVersion', e.target.value)} />
                </div>
                <button type="button" className={btnGhost} onClick={() => set('guidelinesVersion', String(data.config.guidelines.version + 1))}>Publish as new version</button>
              </div>
            </div>
            <div>
              <span className={label}>Text ({draft.guidelinesText.length}/8000)</span>
              <textarea className={`${input} min-h-[260px] font-mono text-xs leading-relaxed`} maxLength={8000} value={draft.guidelinesText} onChange={(e) => set('guidelinesText', e.target.value)} />
            </div>
            {draft.guidelinesText !== data.config.guidelines.text && Number(draft.guidelinesVersion) === data.config.guidelines.version && (
              <p className="text-xs text-warning-text">You changed the text without raising the version. Students who already accepted will not be asked again.</p>
            )}
          </section>

          {/* Content filters */}
          <section className={card}>
            <div>
              <h2 className="text-sm font-semibold text-fg">Content filters</h2>
              <p className="text-xs text-fg-muted">One word or phrase per line (or comma-separated). Matching is case-insensitive.</p>
            </div>
            <div className="grid md:grid-cols-3 gap-4">
              <div>
                <span className={label}>Block ({fromLines(draft.keywordsBlock).length})</span>
                <textarea className={`${input} min-h-[160px] text-xs`} value={draft.keywordsBlock} onChange={(e) => set('keywordsBlock', e.target.value)} placeholder="Refused outright" />
                <p className="text-xs text-fg-muted mt-1">The post is refused and the student is told why.</p>
              </div>
              <div>
                <span className={label}>Flag for review ({fromLines(draft.keywordsFlag).length})</span>
                <textarea className={`${input} min-h-[160px] text-xs`} value={draft.keywordsFlag} onChange={(e) => set('keywordsFlag', e.target.value)} placeholder="Held for review" />
                <p className="text-xs text-fg-muted mt-1">Saved as pending review and added to the queue as a system report.</p>
              </div>
              <div>
                <span className={label}>Blocked link hosts ({fromLines(draft.linkDenylist).length})</span>
                <textarea className={`${input} min-h-[160px] text-xs`} value={draft.linkDenylist} onChange={(e) => set('linkDenylist', e.target.value)} placeholder="example.com" />
                <p className="text-xs text-fg-muted mt-1">Links to these hosts are refused.</p>
              </div>
            </div>
          </section>

          {/* Review thresholds */}
          <section className={card}>
            <div>
              <h2 className="text-sm font-semibold text-fg">Review rules</h2>
              <p className="text-xs text-fg-muted">Reports never remove content by themselves. Only threats, self-harm and doxxing reports from enough distinct students hide content until a moderator decides.</p>
            </div>
            <div className="flex flex-wrap gap-6">
              <div>
                <span className={label}>Auto-hide after distinct reporters (2-20)</span>
                <input type="number" min={2} max={20} className={`${input} w-32`} value={draft.autoHideThreshold} onChange={(e) => set('autoHideThreshold', e.target.value)} />
              </div>
              <div>
                <span className={label}>Connect consent version</span>
                <input type="number" min={data.config.connectConsentVersion} className={`${input} w-32`} value={draft.connectConsentVersion} onChange={(e) => set('connectConsentVersion', e.target.value)} />
              </div>
            </div>
            <div>
              <span className={label}>Review SLA (hours until a report is overdue)</span>
              <div className="flex flex-wrap gap-4">
                {SEVERITIES.map((s) => (
                  <div key={s}>
                    <span className="block text-xs text-fg-muted font-semibold mb-1">{s}</span>
                    <input type="number" min={1} max={720} className={`${input} w-28`} value={draft.slaHours[s]} onChange={(e) => set('slaHours', { ...draft.slaHours, [s]: e.target.value })} />
                  </div>
                ))}
              </div>
              <p className="text-xs text-fg-muted mt-2">Applies to new reports.</p>
            </div>
          </section>

          {/* C2: Whispers / After Dark switches + whisper board */}
          <CampusSafetyPanel />

          {/* Per-phase admin */}
          <section className={card}>
            <h2 className="text-sm font-semibold text-fg">Sub-tab admin</h2>
            <div className="grid md:grid-cols-2 gap-3">
              {SUBPAGES.map((p) => {
                const feature = p.href.split('/').pop() as Feature;
                const shipped = data.implemented[feature];
                return shipped ? (
                  <Link key={p.href} href={p.href} className="rounded-lg border border-line bg-surface-2/60 p-4 hover:border-info/30">
                    <p className="text-xs font-semibold text-fg">{p.label}</p>
                    <p className="text-xs text-fg-muted">{p.detail}</p>
                  </Link>
                ) : (
                  <div key={p.href} className="rounded-lg border border-line bg-surface-2/60 p-4 opacity-60" aria-disabled="true">
                    <p className="text-xs font-semibold text-fg">{p.label} <span className="text-xs text-fg-muted ml-1">Arrives with phase {p.phase}</span></p>
                    <p className="text-xs text-fg-muted">{p.detail}</p>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Save bar */}
          <div className="sticky bottom-4 z-30">
            <div className="rounded-lg border border-line bg-surface shadow-xs flex flex-wrap items-center justify-between gap-3 px-6 py-4 border border-line">
              <div className="text-xs">
                {patch.errors.length ? (
                  <ul className="text-danger-text font-semibold space-y-0.5">{patch.errors.slice(0, 3).map((e) => <li key={e}>{e}</li>)}</ul>
                ) : patch.dirty ? (
                  <span className="text-warning-text font-semibold">Unsaved changes: {Object.keys(patch.body).join(', ')}</span>
                ) : (
                  <span className="text-fg-muted">All changes saved. Every save is recorded in the moderation audit log.</span>
                )}
              </div>
              <div className="flex gap-2">
                <button type="button" disabled={!patch.dirty || saving} onClick={() => setDraft(toDraft(data.config))} className={btnGhost}>Discard</button>
                <button type="button" disabled={!patch.dirty || saving || patch.errors.length > 0} onClick={save} className={`${btn} bg-success-soft text-success-text border border-success/30`}>
                  {saving ? 'Saving…' : 'Save changes'}
                </button>
              </div>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
