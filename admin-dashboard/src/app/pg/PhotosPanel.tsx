"use client";
import { useMemo, useState } from 'react';
import { FIELD, MAX_PHOTOS, PGHostel, PHOTO_CATEGORIES, PHOTO_CATEGORY_LABEL, PgPhoto, PhotoCategory, pgRequest, uploadImage } from './pgApi';
import { SaveBar, errorText, useRoomTypes } from './contentShared';

type Draft = PgPhoto & { key: string };
let seq = 0;
const nextKey = () => `d${Date.now().toString(36)}${(seq++).toString(36)}`;

/** Saved gallery, or the legacy image list as "Other" photos (saving converts it). */
const toDrafts = (pg: PGHostel): Draft[] => {
  const photos = Array.isArray(pg.photos) && pg.photos.length ? [...pg.photos].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)) : null;
  if (photos) return photos.map(p => ({ ...p, caption: p.caption || '', roomType: p.roomType || null, key: p.id || nextKey() }));
  return (pg.images || []).filter(u => typeof u === 'string' && u && !u.startsWith('data:')).map((url, i) => ({ url, category: 'OTHER' as PhotoCategory, caption: '', roomType: null, isCover: i === 0, key: nextKey() }));
};
const strip = (d: Draft[]) => d.map((p, i) => ({ id: p.id, url: p.url, category: p.category, caption: p.caption.trim(), roomType: p.roomType || null, isCover: p.isCover, order: i }));

export function PhotosPanel({ pg, onSaved }: { pg: PGHostel; onSaved: (pg: Partial<PGHostel>) => void }) {
  const [initial, setInitial] = useState<Draft[]>(() => toDrafts(pg));
  const [photos, setPhotos] = useState<Draft[]>(initial);
  const [uploadCategory, setUploadCategory] = useState<PhotoCategory>('ROOM');
  const [uploading, setUploading] = useState<{ done: number; total: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [filter, setFilter] = useState<PhotoCategory | 'ALL'>('ALL');
  const roomTypes = useRoomTypes(pg.id);
  const legacy = !(Array.isArray(pg.photos) && pg.photos.length) && photos.length > 0 && JSON.stringify(strip(photos)) === JSON.stringify(strip(initial));
  const dirty = JSON.stringify(strip(photos)) !== JSON.stringify(strip(initial));
  const counts = useMemo(() => {
    const m: Partial<Record<PhotoCategory, number>> = {};
    photos.forEach(p => { m[p.category] = (m[p.category] || 0) + 1; });
    return m;
  }, [photos]);

  const update = (key: string, patch: Partial<Draft>) => { setMessage(null); setPhotos(prev => prev.map(p => (p.key === key ? { ...p, ...patch } : p))); };
  const setCover = (key: string) => { setMessage(null); setPhotos(prev => prev.map(p => ({ ...p, isCover: p.key === key }))); };
  const remove = (key: string) => {
    setMessage(null);
    setPhotos(prev => {
      const next = prev.filter(p => p.key !== key);
      if (next.length && !next.some(p => p.isCover)) next[0] = { ...next[0], isCover: true };
      return next;
    });
  };
  const move = (key: string, dir: -1 | 1) => {
    setMessage(null);
    setPhotos(prev => {
      const i = prev.findIndex(p => p.key === key);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  };

  const upload = async (files: FileList | null) => {
    if (!files || !files.length) return;
    const room = MAX_PHOTOS - photos.length;
    if (room <= 0) { setMessage({ kind: 'error', text: `A PG can have at most ${MAX_PHOTOS} photos. Remove some first.` }); return; }
    const list = Array.from(files).slice(0, room);
    const skipped = files.length - list.length;
    setMessage(null);
    setUploading({ done: 0, total: list.length });
    const failed: string[] = [];
    for (const file of list) {
      try {
        const url = await uploadImage(file);
        setPhotos(prev => [...prev, { url, category: uploadCategory, caption: '', roomType: null, isCover: prev.length === 0, key: nextKey() }]);
      } catch (e) {
        failed.push(`${file.name}: ${errorText(e, 'upload failed')}`);
      }
      setUploading(u => (u ? { ...u, done: u.done + 1 } : u));
    }
    setUploading(null);
    if (failed.length || skipped) {
      setMessage({ kind: 'error', text: [failed.join(' · '), skipped ? `${skipped} file${skipped === 1 ? '' : 's'} not added (limit ${MAX_PHOTOS}).` : ''].filter(Boolean).join(' ') });
    }
  };

  const save = async () => {
    if (saving || uploading) return;
    setSaving(true);
    setMessage(null);
    try {
      const saved = await pgRequest<{ photos: PgPhoto[]; images: string[] }>(`/api/pg/${pg.id}/photos`, { method: 'PUT', body: JSON.stringify({ photos: strip(photos) }) });
      const next = saved.photos.map(p => ({ ...p, key: p.id || nextKey() }));
      setInitial(next);
      setPhotos(next);
      onSaved({ photos: saved.photos, images: saved.images });
      setMessage({ kind: 'ok', text: `Photos saved (${saved.photos.length}).` });
    } catch (e) {
      setMessage({ kind: 'error', text: errorText(e, 'Could not save the photos.') });
    } finally {
      setSaving(false);
    }
  };

  const shown = filter === 'ALL' ? photos : photos.filter(p => p.category === filter);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-fg-muted">{photos.length} of {MAX_PHOTOS} photos</p>
          <p className="mt-1 text-xs text-fg-muted">JPEG, PNG or WEBP. Large phone photos are resized automatically. The cover is shown first in the app and on the list card.</p>
          {legacy && <p className="mt-1 text-xs text-warning-text">These photos were added before categories existed. Set a category for each and save.</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs text-fg-muted" htmlFor="pg-upload-cat">Upload as</label>
          <select id="pg-upload-cat" className={`${FIELD} w-40`} value={uploadCategory} onChange={e => setUploadCategory(e.target.value as PhotoCategory)}>
            {PHOTO_CATEGORIES.map(c => <option key={c} value={c}>{PHOTO_CATEGORY_LABEL[c]}</option>)}
          </select>
          <label className={`cursor-pointer rounded-lg bg-surface-2 px-4 py-2.5 text-sm font-semibold text-fg hover:bg-surface-3 ${uploading || photos.length >= MAX_PHOTOS ? 'pointer-events-none opacity-50' : ''}`}>
            {uploading ? `Uploading ${uploading.done + 1} of ${uploading.total}…` : 'Upload photos'}
            <input type="file" multiple accept="image/jpeg,image/png,image/webp" className="hidden" disabled={!!uploading || photos.length >= MAX_PHOTOS} onChange={e => { upload(e.target.files); e.target.value = ''; }} />
          </label>
        </div>
      </div>

      {photos.length > 0 && (
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Filter by category">
          {(['ALL', ...PHOTO_CATEGORIES.filter(c => counts[c])] as (PhotoCategory | 'ALL')[]).map(c => (
            <button key={c} type="button" role="tab" aria-selected={filter === c} onClick={() => setFilter(c)} className={`rounded-full border px-3 py-1 text-xs font-semibold ${filter === c ? 'border-line-strong bg-accent text-accent-fg' : 'border-line text-fg-muted hover:text-fg'}`}>
              {c === 'ALL' ? `All ${photos.length}` : `${PHOTO_CATEGORY_LABEL[c]} ${counts[c]}`}
            </button>
          ))}
        </div>
      )}

      {photos.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line p-10 text-center text-sm text-fg-muted">No photos yet. Upload room, bathroom, mess and building photos so students can see the place.</div>
      ) : (
        <ol className="space-y-2">
          {shown.map(p => {
            const index = photos.findIndex(x => x.key === p.key);
            return (
              <li key={p.key} className={`grid grid-cols-[112px_1fr] gap-4 rounded-xl border p-3 ${p.isCover ? 'border-info/30 bg-info-soft' : 'border-line'}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.url} alt={p.caption || `Photo ${index + 1}`} loading="lazy" decoding="async" className="h-[84px] w-[112px] rounded-lg border border-line object-cover" />
                <div className="min-w-0 space-y-2">
                  <div className="grid gap-2 md:grid-cols-[150px_1fr_200px]">
                    <select aria-label={`Category of photo ${index + 1}`} className={FIELD} value={p.category} onChange={e => update(p.key, { category: e.target.value as PhotoCategory })}>
                      {PHOTO_CATEGORIES.map(c => <option key={c} value={c}>{PHOTO_CATEGORY_LABEL[c]}</option>)}
                    </select>
                    <input aria-label={`Caption of photo ${index + 1}`} className={FIELD} maxLength={120} placeholder="Caption (optional), e.g. Twin room, window side" value={p.caption} onChange={e => update(p.key, { caption: e.target.value })} />
                    <select aria-label={`Room type of photo ${index + 1}`} className={FIELD} value={p.roomType || ''} onChange={e => update(p.key, { roomType: e.target.value || null })}>
                      <option value="">Not linked to a room type</option>
                      {roomTypes.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
                      {p.roomType && !roomTypes.some(o => o.key === p.roomType) && <option value={p.roomType}>{p.roomType} (no matching rooms)</option>}
                    </select>
                  </div>
                  <div className="flex flex-wrap items-center gap-3 text-xs">
                    <label className="flex items-center gap-2 text-fg-muted">
                      <input type="radio" name={`cover-${pg.id}`} checked={p.isCover} onChange={() => setCover(p.key)} className="h-4 w-4 accent-[rgb(var(--accent))]" />
                      Cover photo
                    </label>
                    <span className="text-fg-subtle">#{index + 1}</span>
                    <button type="button" disabled={index === 0} onClick={() => move(p.key, -1)} className="rounded border border-line px-2 py-1 text-fg-muted hover:text-fg disabled:opacity-30" aria-label={`Move photo ${index + 1} up`}>Move up</button>
                    <button type="button" disabled={index === photos.length - 1} onClick={() => move(p.key, 1)} className="rounded border border-line px-2 py-1 text-fg-muted hover:text-fg disabled:opacity-30" aria-label={`Move photo ${index + 1} down`}>Move down</button>
                    <button type="button" onClick={() => remove(p.key)} className="ml-auto text-danger-text hover:text-danger-text" aria-label={`Remove photo ${index + 1}`}>Remove</button>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      <SaveBar dirty={dirty || legacy} saving={saving} message={message} onSave={save} onDiscard={() => { setPhotos(initial); setMessage(null); }} />
    </div>
  );
}
