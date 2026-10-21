"use client";
import { useConfirm } from '@/components/ui';
import { useCallback, useEffect, useState } from 'react';
import { useAdminAuth } from '@/utils/useAdminAuth';
import { adminRequest } from '@/lib/api';
import { useLiveSync } from '@/lib/useLiveSync';

/**
 * Campus Pulse admin: the real content behind "Today on Campus" and "The 9 PM Question" in the
 * customer app. Uses the backend's admin endpoints under /api/campus/admin.
 */

const MEALS = ['breakfast', 'lunch', 'snacks', 'dinner'] as const;
type Meal = typeof MEALS[number];
const CATEGORIES = ['general', 'sports', 'cultural', 'academic'] as const;

interface CampusEvent {
  id: string;
  title: string;
  startsAt: string;
  endsAt?: string | null;
  location?: string | null;
  category?: string | null;
  description?: string | null;
}

interface SavedMenu { id: string; menuDate: string; meal: string; items: string }

type Notice = { kind: 'ok' | 'error'; text: string } | null;

const pad = (n: number) => String(n).padStart(2, '0');
const localDate = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
/** ISO string -> value for <input type="datetime-local"> in the admin's local time. */
const toLocalInput = (iso?: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${localDate(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const fromLocalInput = (v: string) => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};
const fmt = (iso?: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
};
const errText = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);

const input = 'w-full rounded-xl border border-line bg-surface-2/60 px-3 py-2 text-sm text-fg outline-none focus:border-accent';
const label = 'block text-xs font-semibold text-fg-muted mb-1';
const btn = 'rounded-xl px-4 py-2 text-xs font-semibold disabled:opacity-40';

const EMPTY_EVENT = { title: '', startsAt: '', endsAt: '', location: '', category: 'general', description: '' };

export default function CampusAdminPage() {
  const confirm = useConfirm();
  const { isAuthed } = useAdminAuth();
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // ── Mess menu ──
  const [today, setToday] = useState<{ date: string; mess: Record<string, string> } | null>(null);
  const [menuDate, setMenuDate] = useState(localDate());
  const [meal, setMeal] = useState<Meal>('lunch');
  const [menuItems, setMenuItems] = useState('');
  const [savedMenus, setSavedMenus] = useState<SavedMenu[]>([]);

  // ── Events ──
  const [events, setEvents] = useState<CampusEvent[]>([]);
  const [eventsError, setEventsError] = useState<string | null>(null);
  const [eventForm, setEventForm] = useState(EMPTY_EVENT);
  const [editingId, setEditingId] = useState<string | null>(null);

  // ── 9 PM question ──
  const [current, setCurrent] = useState<{ question: string; promptDate?: string; answerCount?: number } | null>(null);
  const [qDate, setQDate] = useState(localDate());
  const [qText, setQText] = useState('');
  const [qOpens, setQOpens] = useState('');
  const [qCloses, setQCloses] = useState('');

  const loadToday = useCallback(async () => {
    try {
      const data = await adminRequest<{ date: string; mess?: Record<string, string> }>('/api/campus/pulse/today');
      setToday({ date: data?.date || localDate(), mess: data?.mess || {} });
    } catch {
      setToday(null);
    }
  }, []);

  const loadEvents = useCallback(async () => {
    try {
      const data = await adminRequest<{ events?: CampusEvent[] }>('/api/campus/admin/events');
      setEvents(Array.isArray(data?.events) ? data.events : []);
      setEventsError(null);
    } catch (e) {
      setEventsError(errText(e, 'Could not load events.'));
    }
  }, []);

  const loadQuestion = useCallback(async () => {
    try {
      const data = await adminRequest<{ question?: { question?: string; promptDate?: string } | null; answerCount?: number }>('/api/campus/pulse/question');
      setCurrent(data?.question?.question ? { question: data.question.question, promptDate: data.question.promptDate, answerCount: data.answerCount } : null);
    } catch {
      setCurrent(null);
    }
  }, []);

  const loadAll = useCallback(() => {
    loadToday();
    loadEvents();
    loadQuestion();
  }, [loadToday, loadEvents, loadQuestion]);

  useEffect(() => {
    if (isAuthed) loadAll();
  }, [isAuthed, loadAll]);

  useLiveSync(['campus'], () => loadAll(), { enabled: isAuthed });

  const run = async (key: string, fn: () => Promise<string>) => {
    if (busy) return;
    setBusy(key);
    setNotice(null);
    try {
      setNotice({ kind: 'ok', text: await fn() });
    } catch (e) {
      setNotice({ kind: 'error', text: errText(e, 'Something went wrong.') });
    } finally {
      setBusy(null);
    }
  };

  const saveMenu = () => run('menu', async () => {
    const items = menuItems.split(/[,\n]/).map(s => s.trim()).filter(Boolean);
    if (!items.length) throw new Error('Add at least one menu item.');
    const data = await adminRequest<{ menu?: SavedMenu }>('/api/campus/admin/mess-menu', {
      method: 'PUT',
      body: JSON.stringify({ menuDate, meal, items }),
    });
    if (data?.menu?.id) {
      const m = data.menu;
      setSavedMenus(prev => [m, ...prev.filter(x => !(x.menuDate === m.menuDate && x.meal === m.meal))]);
    }
    setMenuItems('');
    loadToday();
    return `Mess menu saved for ${meal} on ${menuDate}.`;
  });

  const removeMenu = async (m: SavedMenu) => {
    if (!(await confirm({ title: `Remove the ${m.meal} menu for ${m.menuDate}?` }))) return;
    run(`menu-${m.id}`, async () => {
      await adminRequest(`/api/campus/admin/mess-menu/${encodeURIComponent(m.id)}`, { method: 'DELETE' });
      setSavedMenus(prev => prev.filter(x => x.id !== m.id));
      loadToday();
      return 'Menu entry removed.';
    });
  };

  const saveEvent = () => run('event', async () => {
    const title = eventForm.title.trim();
    const startsAt = fromLocalInput(eventForm.startsAt);
    if (!title) throw new Error('Event title is required.');
    if (!startsAt) throw new Error('Pick when the event starts.');
    const endsAt = fromLocalInput(eventForm.endsAt);
    if (endsAt && new Date(endsAt) < new Date(startsAt)) throw new Error('The event cannot end before it starts.');
    const body = JSON.stringify({
      title,
      startsAt,
      endsAt,
      location: eventForm.location.trim(),
      category: eventForm.category,
      description: eventForm.description.trim(),
    });
    if (editingId) {
      await adminRequest(`/api/campus/admin/events/${encodeURIComponent(editingId)}`, { method: 'PUT', body });
    } else {
      await adminRequest('/api/campus/admin/events', { method: 'POST', body });
    }
    const msg = editingId ? 'Event updated.' : 'Event published.';
    setEditingId(null);
    setEventForm(EMPTY_EVENT);
    loadEvents();
    loadToday();
    return msg;
  });

  const editEvent = (e: CampusEvent) => {
    setEditingId(e.id);
    setEventForm({
      title: e.title || '',
      startsAt: toLocalInput(e.startsAt),
      endsAt: toLocalInput(e.endsAt),
      location: e.location || '',
      category: e.category || 'general',
      description: e.description || '',
    });
  };

  const deleteEvent = async (e: CampusEvent) => {
    if (!(await confirm({ title: `Delete the event "${e.title}"? Students will no longer see it.` }))) return;
    run(`event-${e.id}`, async () => {
      await adminRequest(`/api/campus/admin/events/${encodeURIComponent(e.id)}`, { method: 'DELETE' });
      if (editingId === e.id) { setEditingId(null); setEventForm(EMPTY_EVENT); }
      setEvents(prev => prev.filter(x => x.id !== e.id));
      return 'Event removed.';
    });
  };

  const saveQuestion = () => run('question', async () => {
    const question = qText.trim();
    if (!question) throw new Error('Write the question first.');
    const opensAt = fromLocalInput(qOpens);
    const closesAt = fromLocalInput(qCloses);
    if (opensAt && closesAt && new Date(closesAt) <= new Date(opensAt)) throw new Error('The question must close after it opens.');
    await adminRequest('/api/campus/admin/daily-question', {
      method: 'PUT',
      body: JSON.stringify({ promptDate: qDate, question, opensAt, closesAt }),
    });
    setQText('');
    loadQuestion();
    return `Question scheduled for ${qDate}.`;
  });

  if (!isAuthed) return <div className="p-10 text-center text-sm text-fg-muted" role="status">Checking your admin session…</div>;

  return (
    <div className="mx-auto max-w-6xl space-y-8 text-fg">
      <header>
        <h1 className="text-2xl font-semibold text-fg">Campus Pulse</h1>
        <p className="mt-1 max-w-3xl text-sm text-fg-muted">&quot;Today on campus&quot; and &quot;The 9 PM question&quot; content.</p>
      </header>

      {notice && (
        <div role={notice.kind === 'error' ? 'alert' : 'status'} className={`flex items-center justify-between gap-3 rounded-lg border px-5 py-3 text-sm font-semibold ${notice.kind === 'error' ? 'border-danger/30 bg-danger-soft text-danger-text' : 'border-success/30 bg-success-soft text-success-text'}`}>
          {notice.text}
          <button type="button" onClick={() => setNotice(null)} className="text-xs underline">Dismiss</button>
        </div>
      )}

      {/* Mess menu */}
      <section className="rounded-lg border border-line bg-surface shadow-xs space-y-4 p-6" aria-labelledby="mess-h">
        <h2 id="mess-h" className="text-lg font-semibold">Mess menu</h2>
        {today && (
          <div className="grid gap-2 text-sm sm:grid-cols-4">
            {MEALS.map(m => (
              <div key={m} className="rounded-xl border border-line bg-surface-2/60 p-3">
                <p className="text-xs font-semibold text-fg-muted">{m} · {today.date}</p>
                <p className="mt-1 text-fg">{today.mess[m] || <span className="text-fg-subtle">Not set</span>}</p>
              </div>
            ))}
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-[160px_160px_1fr_auto] sm:items-end">
          <div>
            <label className={label} htmlFor="menu-date">Date</label>
            <input id="menu-date" type="date" className={input} value={menuDate} onChange={e => setMenuDate(e.target.value)} />
          </div>
          <div>
            <label className={label} htmlFor="menu-meal">Meal</label>
            <select id="menu-meal" className={input} value={meal} onChange={e => setMeal(e.target.value as Meal)}>
              {MEALS.map(m => <option key={m} value={m} className="bg-surface-2">{m}</option>)}
            </select>
          </div>
          <div>
            <label className={label} htmlFor="menu-items">Items (comma separated)</label>
            <input id="menu-items" className={input} value={menuItems} maxLength={255} onChange={e => setMenuItems(e.target.value)} placeholder="Idli, Sambar, Chutney, Tea" />
          </div>
          <button type="button" disabled={!!busy || !menuItems.trim() || !menuDate} onClick={saveMenu} className={`${btn} bg-success text-on-solid hover:bg-success/90`}>
            {busy === 'menu' ? 'Saving…' : 'Save menu'}
          </button>
        </div>
        <p className="text-xs text-fg-muted">Saving a meal for a date replaces what was there before.</p>
        {savedMenus.length > 0 && (
          <ul className="divide-y divide-line rounded-xl border border-line text-sm">
            {savedMenus.map(m => (
              <li key={m.id} className="flex items-center justify-between gap-3 p-3">
                <span><span className="font-semibold capitalize">{m.meal}</span> · {m.menuDate} · <span className="text-fg-muted">{m.items}</span></span>
                <button type="button" disabled={!!busy} onClick={() => removeMenu(m)} className="text-xs font-semibold text-danger-text hover:underline disabled:opacity-40">Remove</button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Events */}
      <section className="rounded-lg border border-line bg-surface shadow-xs space-y-4 p-6" aria-labelledby="events-h">
        <h2 id="events-h" className="text-lg font-semibold">{editingId ? 'Edit event' : 'Campus events'}</h2>
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <label className={label} htmlFor="ev-title">Title</label>
            <input id="ev-title" className={input} maxLength={255} value={eventForm.title} onChange={e => setEventForm({ ...eventForm, title: e.target.value })} />
          </div>
          <div>
            <label className={label} htmlFor="ev-loc">Location</label>
            <input id="ev-loc" className={input} maxLength={255} value={eventForm.location} onChange={e => setEventForm({ ...eventForm, location: e.target.value })} />
          </div>
          <div>
            <label className={label} htmlFor="ev-start">Starts</label>
            <input id="ev-start" type="datetime-local" className={input} value={eventForm.startsAt} onChange={e => setEventForm({ ...eventForm, startsAt: e.target.value })} />
          </div>
          <div>
            <label className={label} htmlFor="ev-end">Ends (optional)</label>
            <input id="ev-end" type="datetime-local" className={input} value={eventForm.endsAt} onChange={e => setEventForm({ ...eventForm, endsAt: e.target.value })} />
          </div>
          <div>
            <label className={label} htmlFor="ev-cat">Category</label>
            <select id="ev-cat" className={input} value={eventForm.category} onChange={e => setEventForm({ ...eventForm, category: e.target.value })}>
              {CATEGORIES.map(c => <option key={c} value={c} className="bg-surface-2">{c}</option>)}
            </select>
          </div>
          <div className="md:col-span-2">
            <label className={label} htmlFor="ev-desc">Description (optional)</label>
            <textarea id="ev-desc" rows={2} maxLength={2000} className={`${input} resize-none`} value={eventForm.description} onChange={e => setEventForm({ ...eventForm, description: e.target.value })} />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={!!busy || !eventForm.title.trim() || !eventForm.startsAt} onClick={saveEvent} className={`${btn} bg-success text-on-solid hover:bg-success/90`}>
            {busy === 'event' ? 'Saving…' : editingId ? 'Save changes' : 'Publish event'}
          </button>
          {editingId && (
            <button type="button" disabled={!!busy} onClick={() => { setEditingId(null); setEventForm(EMPTY_EVENT); }} className={`${btn} border border-line text-fg-muted`}>Cancel edit</button>
          )}
        </div>
        {eventsError && <p role="alert" className="text-sm font-semibold text-danger-text">{eventsError} <button type="button" onClick={loadEvents} className="underline">Retry</button></p>}
        {events.length === 0 && !eventsError ? (
          <p className="text-sm text-fg-muted">No events yet.</p>
        ) : (
          <ul className="divide-y divide-line rounded-xl border border-line text-sm">
            {events.map(e => (
              <li key={e.id} className="flex flex-wrap items-start justify-between gap-3 p-3">
                <div className="min-w-0">
                  <p className="font-semibold">{e.title} <span className="ml-1 text-xs text-fg-muted">{e.category || 'general'}</span></p>
                  <p className="text-xs text-fg-muted">{fmt(e.startsAt)}{e.endsAt ? ` – ${fmt(e.endsAt)}` : ''}{e.location ? ` · ${e.location}` : ''}</p>
                </div>
                <div className="flex gap-3">
                  <button type="button" disabled={!!busy} onClick={() => editEvent(e)} className="text-xs font-semibold text-info-text hover:underline disabled:opacity-40">Edit</button>
                  <button type="button" disabled={!!busy} onClick={() => deleteEvent(e)} className="text-xs font-semibold text-danger-text hover:underline disabled:opacity-40">{busy === `event-${e.id}` ? 'Deleting…' : 'Delete'}</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 9 PM question */}
      <section className="rounded-lg border border-line bg-surface shadow-xs space-y-4 p-6" aria-labelledby="q-h">
        <h2 id="q-h" className="text-lg font-semibold">The 9 PM Question</h2>
        <p className="text-sm text-fg-muted">
          {current
            ? <>Live now{current.promptDate ? ` (${current.promptDate})` : ''}: <span className="text-fg">{current.question}</span>{typeof current.answerCount === 'number' ? ` · ${current.answerCount} answers` : ''}</>
            : 'No question has been scheduled yet.'}
        </p>
        <div className="grid gap-3 md:grid-cols-[160px_1fr]">
          <div>
            <label className={label} htmlFor="q-date">Date</label>
            <input id="q-date" type="date" className={input} value={qDate} onChange={e => setQDate(e.target.value)} />
          </div>
          <div>
            <label className={label} htmlFor="q-text">Question</label>
            <input id="q-text" className={input} maxLength={255} value={qText} onChange={e => setQText(e.target.value)} placeholder="What is the best late-night snack on campus?" />
          </div>
          <div>
            <label className={label} htmlFor="q-open">Opens (optional)</label>
            <input id="q-open" type="datetime-local" className={input} value={qOpens} onChange={e => setQOpens(e.target.value)} />
          </div>
          <div>
            <label className={label} htmlFor="q-close">Closes (optional)</label>
            <input id="q-close" type="datetime-local" className={input} value={qCloses} onChange={e => setQCloses(e.target.value)} />
          </div>
        </div>
        <p className="text-xs text-fg-muted">Scheduling a question for a date that already has one replaces it.</p>
        <button type="button" disabled={!!busy || !qText.trim() || !qDate} onClick={saveQuestion} className={`${btn} bg-success text-on-solid hover:bg-success/90`}>
          {busy === 'question' ? 'Saving…' : 'Schedule question'}
        </button>
      </section>
    </div>
  );
}
