"use client";
import { useState } from 'react';
import { FIELD, MAX_VIDEOS, PGHostel, PgVideo, parseYouTubeId, pgRequest, youtubeThumb } from './pgApi';
import { SaveBar, errorText, useRoomTypes } from './contentShared';

type Draft = { key: string; id?: string; link: string; title: string; roomType: string | null };
let seq = 0;
const nextKey = () => `v${Date.now().toString(36)}${(seq++).toString(36)}`;
const toDrafts = (videos?: PgVideo[] | null): Draft[] => (Array.isArray(videos) ? [...videos] : [])
  .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  .map(v => ({ key: v.id || nextKey(), id: v.id, link: `https://youtu.be/${v.youtubeId}`, title: v.title || '', roomType: v.roomType || null }));
const payload = (d: Draft[]) => d.map((v, i) => ({ id: v.id, youtubeUrl: v.link.trim(), title: v.title.trim(), roomType: v.roomType || null, order: i }));

/**
 * Room tour videos: links to videos on Zenvy's own YouTube channel (admins only; PG owners cannot add
 * videos). Only youtube.com/watch?v=…, youtu.be/… and youtube.com/shorts/… links are accepted.
 */
export function VideosPanel({ pg, onSaved }: { pg: PGHostel; onSaved: (pg: Partial<PGHostel>) => void }) {
  const [initial, setInitial] = useState<Draft[]>(() => toDrafts(pg.videos));
  const [videos, setVideos] = useState<Draft[]>(initial);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const roomTypes = useRoomTypes(pg.id);
  const dirty = JSON.stringify(payload(videos)) !== JSON.stringify(payload(initial));

  const update = (key: string, patch: Partial<Draft>) => { setMessage(null); setVideos(prev => prev.map(v => (v.key === key ? { ...v, ...patch } : v))); };
  const move = (key: string, dir: -1 | 1) => setVideos(prev => {
    const i = prev.findIndex(v => v.key === key);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= prev.length) return prev;
    const next = [...prev];
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  });

  const ids = videos.map(v => parseYouTubeId(v.link));
  const problem = videos.map((v, i) => {
    if (!v.link.trim()) return 'Paste a YouTube link.';
    if (!ids[i]) return 'Not a YouTube video link. Use youtube.com/watch?v=…, youtu.be/… or youtube.com/shorts/….';
    if (ids.indexOf(ids[i]) !== i) return 'This video is already listed.';
    return null;
  });

  const save = async () => {
    if (saving) return;
    if (problem.some(Boolean)) { setMessage({ kind: 'error', text: 'Fix the highlighted links first.' }); return; }
    setSaving(true);
    setMessage(null);
    try {
      const saved = await pgRequest<{ videos: PgVideo[] }>(`/api/pg/${pg.id}/videos`, { method: 'PUT', body: JSON.stringify({ videos: payload(videos) }) });
      const next = toDrafts(saved.videos);
      setInitial(next);
      setVideos(next);
      onSaved({ videos: saved.videos });
      setMessage({ kind: 'ok', text: saved.videos.length ? `Videos saved (${saved.videos.length}).` : 'Videos removed.' });
    } catch (e) {
      setMessage({ kind: 'error', text: errorText(e, 'Could not save the videos.') });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-fg-muted">{videos.length} of {MAX_VIDEOS} videos</p>
          <p className="mt-1 text-xs text-fg-muted">Upload room tours to the ZCS YouTube channel, then paste the link here. Students play them inside the app.</p>
        </div>
        <button type="button" disabled={videos.length >= MAX_VIDEOS} onClick={() => setVideos(prev => [...prev, { key: nextKey(), link: '', title: '', roomType: null }])} className="rounded-lg bg-surface-2 px-4 py-2.5 text-sm font-semibold text-fg hover:bg-surface-3 disabled:opacity-40">Add video</button>
      </div>

      {videos.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line p-10 text-center text-sm text-fg-muted">No videos yet.</div>
      ) : (
        <ol className="space-y-2">
          {videos.map((v, i) => (
            <li key={v.key} className="grid grid-cols-[136px_1fr] gap-4 rounded-xl border border-line p-3">
              {ids[i] ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={youtubeThumb(ids[i] as string)} alt="" loading="lazy" className="h-[76px] w-[136px] rounded-lg border border-line object-cover" />
              ) : (
                <div className="flex h-[76px] w-[136px] items-center justify-center rounded-lg border border-dashed border-line text-xs text-fg-muted">No preview</div>
              )}
              <div className="min-w-0 space-y-2">
                <div className="grid gap-2 md:grid-cols-[1fr_1fr]">
                  <input aria-label={`YouTube link ${i + 1}`} aria-invalid={!!problem[i] && !!v.link.trim()} className={`${FIELD} ${problem[i] && v.link.trim() ? 'border-danger/30' : ''}`} placeholder="https://youtu.be/…" value={v.link} onChange={e => update(v.key, { link: e.target.value })} />
                  <input aria-label={`Title of video ${i + 1}`} className={FIELD} maxLength={100} placeholder="Title, e.g. Twin room tour" value={v.title} onChange={e => update(v.key, { title: e.target.value })} />
                </div>
                {problem[i] && v.link.trim() ? <p className="text-xs text-danger-text">{problem[i]}</p> : null}
                <div className="flex flex-wrap items-center gap-3 text-xs">
                  <select aria-label={`Room type of video ${i + 1}`} className={`${FIELD} w-auto py-1.5`} value={v.roomType || ''} onChange={e => update(v.key, { roomType: e.target.value || null })}>
                    <option value="">Not linked to a room type</option>
                    {roomTypes.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
                    {v.roomType && !roomTypes.some(o => o.key === v.roomType) && <option value={v.roomType}>{v.roomType} (no matching rooms)</option>}
                  </select>
                  <button type="button" disabled={i === 0} onClick={() => move(v.key, -1)} className="rounded border border-line px-2 py-1 text-fg-muted hover:text-fg disabled:opacity-30">Move up</button>
                  <button type="button" disabled={i === videos.length - 1} onClick={() => move(v.key, 1)} className="rounded border border-line px-2 py-1 text-fg-muted hover:text-fg disabled:opacity-30">Move down</button>
                  {ids[i] && <a href={`https://www.youtube.com/watch?v=${ids[i]}`} target="_blank" rel="noreferrer" className="text-info-text hover:underline">Open on YouTube</a>}
                  <button type="button" onClick={() => { setMessage(null); setVideos(prev => prev.filter(x => x.key !== v.key)); }} className="ml-auto text-danger-text hover:text-danger-text">Remove</button>
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}

      <SaveBar dirty={dirty} saving={saving} message={message} onSave={save} onDiscard={() => { setVideos(initial); setMessage(null); }} />
    </div>
  );
}
