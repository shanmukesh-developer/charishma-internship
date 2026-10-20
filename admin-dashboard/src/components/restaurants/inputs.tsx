"use client";
import { useRef, useState, KeyboardEvent, DragEvent } from 'react';
import { DAYS, DAY_LABEL, DAY_SHORT, DayKey, Weekly, isUniform, resizeAndUpload, summarizeWeekly, IMAGE_PRESETS } from './helpers';
import { Button, INPUT, Spinner, Toggle, cx, FOCUS_RING } from './ui';

// ─── Weekly hours ────────────────────────────────────────────────────────────
const PRESETS: { label: string; start: string; end: string }[] = [
  { label: 'Breakfast–dinner 8 AM–10 PM', start: '08:00', end: '22:00' },
  { label: 'Lunch & dinner 11 AM–11 PM', start: '11:00', end: '23:00' },
  { label: 'Late night 6 PM–3 AM', start: '18:00', end: '03:00' },
  { label: '24 hours', start: '00:00', end: '00:00' },
];

export function WeeklyHoursEditor({ value, onChange, error }: { value: Weekly; onChange: (w: Weekly) => void; error?: string | null }) {
  const setDay = (d: DayKey, patch: Partial<Weekly[DayKey]>) => onChange({ ...value, [d]: { ...value[d], ...patch } });
  const copyToAll = (d: DayKey) => onChange(DAYS.reduce((acc, k) => ({ ...acc, [k]: { ...value[d] } }), {} as Weekly));
  const applyPreset = (start: string, end: string) => onChange(DAYS.reduce((acc, k) => ({ ...acc, [k]: { open: true, start, end } }), {} as Weekly));
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2" aria-label="Quick presets">
        {PRESETS.map(p => (
          <button key={p.label} type="button" onClick={() => applyPreset(p.start, p.end)} className={cx('rounded-full border border-line px-3 py-1 text-xs font-semibold text-fg-muted hover:border-success/30 hover:text-fg', FOCUS_RING)}>
            {p.label}
          </button>
        ))}
      </div>
      <div className="divide-y divide-line overflow-hidden rounded-xl border border-line" role="group" aria-label="Opening hours by day">
        {DAYS.map(d => {
          const day = value[d];
          const overnight = day.open && day.start !== day.end && day.end < day.start;
          return (
            <div key={d} className={cx('flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2.5', !day.open && 'bg-surface-2/60')}>
              <div className="w-28 shrink-0">
                <Toggle size="sm" checked={day.open} onChange={open => setDay(d, { open })} label={<span className="text-sm">{DAY_SHORT[d]}</span>} />
              </div>
              {day.open ? (
                <>
                  <div className="flex items-center gap-2">
                    <input type="time" aria-label={`${DAY_LABEL[d]} opens at`} className={cx(INPUT, 'w-[124px] py-1.5')} value={day.start} onChange={e => setDay(d, { start: e.target.value })} />
                    <span className="text-xs text-fg-muted">to</span>
                    <input type="time" aria-label={`${DAY_LABEL[d]} closes at`} className={cx(INPUT, 'w-[124px] py-1.5')} value={day.end} onChange={e => setDay(d, { end: e.target.value })} />
                  </div>
                  <span className="text-xs text-fg-muted">{day.start === day.end ? 'Open 24 h' : overnight ? 'Closes next day' : ''}</span>
                </>
              ) : (
                <span className="text-sm text-fg-muted">Closed all day</span>
              )}
              <button type="button" onClick={() => copyToAll(d)} className={cx('ml-auto rounded-md px-2 py-1 text-xs font-semibold text-success-text hover:bg-success-soft', FOCUS_RING)} aria-label={`Copy ${DAY_LABEL[d]} hours to every day`}>
                Copy to all days
              </button>
            </div>
          );
        })}
      </div>
      <p className="text-xs text-fg-muted"><span className="font-semibold text-fg-muted">Summary:</span> {summarizeWeekly(value)}. Times are IST.</p>
      {!isUniform(value) && (
        <p className="text-xs leading-relaxed text-fg-muted">
          Per-day hours: the app opens and closes the store by each day&apos;s window, and shows the next open day when it is closed.
        </p>
      )}
      {error && <p role="alert" className="text-xs text-danger-text">{error}</p>}
    </div>
  );
}

// ─── Image picker: drag-drop / click, resize, upload, preview ───────────────
export function ImagePicker({ value, onChange, preset, label, hint, aspect = 'aspect-video', onError }: {
  value: string;
  onChange: (url: string) => void;
  preset: keyof typeof IMAGE_PRESETS;
  label: string;
  hint: string;
  aspect?: string;
  onError?: (msg: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const [err, setErr] = useState('');
  const [urlMode, setUrlMode] = useState(false);
  const input = useRef<HTMLInputElement | null>(null);

  const handle = async (file?: File | null) => {
    if (!file) return;
    setBusy(true);
    setErr('');
    try {
      onChange(await resizeAndUpload(file, preset));
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Upload failed.';
      setErr(msg);
      onError?.(msg);
    } finally {
      setBusy(false);
    }
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDrag(false);
    handle(e.dataTransfer.files?.[0]);
  };
  const { maxW, maxH } = IMAGE_PRESETS[preset];
  return (
    <div className="space-y-2">
      <div
        onDragOver={e => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={onDrop}
        className={cx('relative overflow-hidden rounded-xl border-2 border-dashed transition-colors', aspect, drag ? 'border-success/30 bg-success-soft' : 'border-line bg-surface-2/60')}
      >
        {value ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={value} alt={`${label} preview`} className="absolute inset-0 h-full w-full object-cover" />
        ) : (
          <button type="button" onClick={() => input.current?.click()} className={cx('absolute inset-0 flex flex-col items-center justify-center gap-1 p-3 text-center', FOCUS_RING)}>
            <span aria-hidden className="text-2xl"></span>
            <span className="text-sm font-semibold text-fg">Drop a photo or click to upload</span>
            <span className="text-xs text-fg-muted">{hint}</span>
          </button>
        )}
        {busy && (
          <div className="absolute inset-0 flex items-center justify-center gap-2 bg-surface-2 text-sm text-fg" role="status"><Spinner /> Resizing &amp; uploading…</div>
        )}
      </div>
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={e => { handle(e.target.files?.[0]); e.target.value = ''; }} aria-label={`Upload ${label}`} />
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => input.current?.click()} disabled={busy}>{value ? 'Replace' : 'Upload'}</Button>
        {value && <Button size="sm" variant="ghost" onClick={() => onChange('')} disabled={busy}>Remove</Button>}
        <button type="button" onClick={() => setUrlMode(m => !m)} className="text-xs font-semibold text-fg-muted hover:text-fg">{urlMode ? 'Hide link field' : 'Use an image link instead'}</button>
        <span className="ml-auto text-xs text-fg-subtle">Auto-resized to {maxW}×{maxH}</span>
      </div>
      {urlMode && (
        <input className={INPUT} aria-label={`${label} image link`} placeholder="https://…" value={value.startsWith('data:') ? '' : value} onChange={e => onChange(e.target.value.trim())} />
      )}
      {err && <p role="alert" className="text-xs text-danger-text">{err}</p>}
    </div>
  );
}

// ─── Tag input (chips) ───────────────────────────────────────────────────────
export function TagInput({ value, onChange, suggestions = [], id, describedBy, placeholder }: {
  value: string[]; onChange: (tags: string[]) => void; suggestions?: string[]; id?: string; describedBy?: string; placeholder?: string;
}) {
  const [draft, setDraft] = useState('');
  const add = (raw: string) => {
    const parts = raw.split(',').map(t => t.trim()).filter(Boolean);
    if (!parts.length) return;
    const next = [...value];
    for (const p of parts) if (!next.some(t => t.toLowerCase() === p.toLowerCase()) && next.length < 30) next.push(p);
    onChange(next);
    setDraft('');
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(draft); }
    if (e.key === 'Backspace' && !draft && value.length) onChange(value.slice(0, -1));
  };
  const unused = suggestions.filter(s => !value.some(v => v.toLowerCase() === s.toLowerCase())).slice(0, 8);
  return (
    <div className="space-y-2">
      <div className="flex min-h-[44px] flex-wrap items-center gap-1.5 rounded-lg border border-line bg-surface px-2 py-1.5 focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/30">
        {value.map(t => (
          <span key={t} className="inline-flex items-center gap-1 rounded-md bg-surface-2 px-2 py-0.5 text-xs text-fg">
            {t}
            <button type="button" onClick={() => onChange(value.filter(x => x !== t))} aria-label={`Remove ${t}`} className="text-fg-muted hover:text-fg">×</button>
          </span>
        ))}
        <input
          id={id}
          aria-describedby={describedBy}
          className="min-w-[120px] flex-1 bg-transparent px-1 py-1 text-sm text-fg outline-none placeholder:text-fg-subtle"
          value={draft}
          placeholder={value.length ? '' : placeholder}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={onKey}
          onBlur={() => add(draft)}
        />
      </div>
      {unused.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {unused.map(s => (
            <button key={s} type="button" onClick={() => add(s)} className={cx('rounded-full border border-line px-2 py-0.5 text-xs text-fg-muted hover:border-success/30 hover:text-fg', FOCUS_RING)}>+ {s}</button>
          ))}
        </div>
      )}
    </div>
  );
}
