"use client";
import {
  Badge, Button, Card, CardBody, CardFooter, CardHeader, DataTable, Field, Input, Modal, Notice, PageHeader, Select, Tabs, Textarea, useConfirm,
  type Column, IconPlus, IconRefresh,
} from '@/components/ui';
import { formatDateTime, humanize, plural } from '@/lib/format';
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
  return Number.isNaN(d.getTime()) ? '' : formatDateTime(d, { short: true });
};
const errText = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);


type PulseTab = 'menu' | 'events' | 'question';

const EMPTY_EVENT = { title: '', startsAt: '', endsAt: '', location: '', category: 'general', description: '' };

export default function CampusAdminPage() {
  const confirm = useConfirm();
  const { isAuthed } = useAdminAuth();
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [tab, setTab] = useState<PulseTab>('menu');
  const [eventModal, setEventModal] = useState(false);

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
    if (!(await confirm({ title: `Remove the ${m.meal} menu for ${m.menuDate}?`, confirmLabel: 'Remove', tone: 'danger' }))) return;
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
    setEventModal(false);
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
    if (!(await confirm({ title: `Delete “${e.title}”?`, description: 'Students will no longer see it.', confirmLabel: 'Delete event', tone: 'danger' }))) return;
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

  if (!isAuthed) return null; // AppShell shows the session check

  const openNewEvent = () => { setEditingId(null); setEventForm(EMPTY_EVENT); setNotice(null); setEventModal(true); };
  const openEditEvent = (e: CampusEvent) => { editEvent(e); setNotice(null); setEventModal(true); };
  const closeEventModal = () => { if (busy === 'event') return; setEventModal(false); setEditingId(null); setEventForm(EMPTY_EVENT); };

  const eventColumns: Column<CampusEvent>[] = [
    {
      key: 'title',
      header: 'Event',
      sortValue: e => e.title,
      cell: e => (
        <div className="min-w-0 max-w-[380px]">
          <p className="truncate font-medium text-fg">{e.title}</p>
          {e.description && <p className="truncate text-xs text-fg-muted">{e.description}</p>}
        </div>
      ),
    },
    { key: 'category', header: 'Category', sortValue: e => e.category || 'general', cell: e => <Badge>{humanize(e.category || 'general')}</Badge> },
    { key: 'when', header: 'When', sortValue: e => new Date(e.startsAt), cell: e => <span className="whitespace-nowrap text-sm">{fmt(e.startsAt)}{e.endsAt ? <span className="text-fg-muted"> – {fmt(e.endsAt)}</span> : ''}</span> },
    { key: 'location', header: 'Where', hideBelow: 'lg', sortValue: e => e.location || '', cell: e => <span className="text-fg-muted">{e.location || '–'}</span> },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      align: 'right',
      cell: e => (
        <div className="flex justify-end gap-1" onClick={ev => ev.stopPropagation()}>
          <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => openEditEvent(e)}>Edit</Button>
          <Button size="sm" variant="ghost" className="text-danger-text" disabled={!!busy} loading={busy === `event-${e.id}`} onClick={() => deleteEvent(e)}>Delete</Button>
        </div>
      ),
    },
  ];

  return (
    <div className="text-fg">
      <PageHeader
        title="Campus Pulse"
        description="Content behind “Today on campus” and “The 9 PM question” in the customer app: mess menu, campus events and the nightly question."
        actions={(
          <>
            <Button leftIcon={<IconRefresh size={14} />} onClick={loadAll}>Refresh</Button>
            {tab === 'events' && <Button variant="primary" leftIcon={<IconPlus size={14} />} onClick={openNewEvent}>Add event</Button>}
          </>
        )}
      />

      <Tabs<PulseTab>
        className="mb-4"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'menu', label: 'Mess menu' },
          { id: 'events', label: 'Events', count: events.length },
          { id: 'question', label: 'The 9 PM question' },
        ]}
      />

      {notice && !eventModal && <Notice tone={notice.kind === 'error' ? 'danger' : 'success'} className="mb-3" onClose={() => setNotice(null)}>{notice.text}</Notice>}

      {tab === 'menu' && (
        <div className="space-y-5">
          <Card>
            <CardHeader title="Today’s menu" description={today ? `As students see it for ${today.date}.` : 'Could not load today’s menu.'} />
            <CardBody>
              {today ? (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {MEALS.map(m => (
                    <div key={m} className="rounded-lg border border-line p-3">
                      <p className="text-xs text-fg-muted">{humanize(m)}</p>
                      <p className="mt-1 text-sm text-fg">{today.mess[m] || <span className="text-fg-subtle">Not set</span>}</p>
                    </div>
                  ))}
                </div>
              ) : <Button size="sm" onClick={loadToday}>Retry</Button>}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Set a meal" description="Separate items with commas. Saving a meal for a date replaces what was there before." />
            <CardBody>
              <div className="grid gap-3 sm:grid-cols-[170px_150px_1fr_auto] sm:items-end">
                <Field label="Date">
                  <Input type="date" value={menuDate} onChange={e => setMenuDate(e.target.value)} />
                </Field>
                <Field label="Meal">
                  <Select value={meal} onChange={e => setMeal(e.target.value as Meal)}>
                    {MEALS.map(m => <option key={m} value={m}>{humanize(m)}</option>)}
                  </Select>
                </Field>
                <Field label="Items">
                  <Input value={menuItems} maxLength={255} onChange={e => setMenuItems(e.target.value)} placeholder="Idli, Sambar, Chutney, Tea" />
                </Field>
                <Button variant="primary" disabled={!!busy || !menuItems.trim() || !menuDate} loading={busy === 'menu'} onClick={saveMenu}>Save menu</Button>
              </div>
            </CardBody>
            {savedMenus.length > 0 && (
              <div className="overflow-x-auto border-t border-line">
                <table className="zv-table">
                  <thead><tr><th>Saved this session</th><th>Date</th><th>Items</th><th className="text-right"><span className="sr-only">Actions</span></th></tr></thead>
                  <tbody>
                    {savedMenus.map(m => (
                      <tr key={m.id}>
                        <td className="font-medium">{humanize(m.meal)}</td>
                        <td className="whitespace-nowrap">{m.menuDate}</td>
                        <td className="text-fg-muted">{m.items}</td>
                        <td className="text-right"><Button size="sm" variant="ghost" className="text-danger-text" disabled={!!busy} onClick={() => removeMenu(m)}>Remove</Button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      )}

      {tab === 'events' && (
        <DataTable
          caption="Campus events"
          columns={eventColumns}
          rows={events}
          rowKey={e => e.id}
          error={eventsError}
          onRetry={loadEvents}
          onRowClick={e => openEditEvent(e)}
          initialSort={{ key: 'when', dir: 'desc' }}
          noun="events"
          empty={{ title: 'No events yet', description: 'Events show under “Today on campus” on their day.', action: <Button variant="primary" leftIcon={<IconPlus size={14} />} onClick={openNewEvent}>Add event</Button> }}
        />
      )}

      {tab === 'question' && (
        <div className="space-y-5">
          <Card>
            <CardHeader title="Live now" />
            <CardBody>
              {current ? (
                <div>
                  <p className="text-base text-fg">{current.question}</p>
                  <p className="mt-1 text-xs text-fg-muted">
                    {current.promptDate ? `For ${current.promptDate}` : 'Current question'}
                    {typeof current.answerCount === 'number' ? ` · ${plural(current.answerCount, 'answer')}` : ''}
                  </p>
                </div>
              ) : <p className="text-sm text-fg-muted">No question has been scheduled yet.</p>}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Schedule a question" description="Scheduling a question for a date that already has one replaces it." />
            <CardBody className="space-y-4">
              <div className="grid gap-3 md:grid-cols-[170px_1fr]">
                <Field label="Date" required>
                  <Input type="date" value={qDate} onChange={e => setQDate(e.target.value)} />
                </Field>
                <Field label="Question" required>
                  <Input maxLength={255} value={qText} onChange={e => setQText(e.target.value)} placeholder="What is the best late-night snack on campus?" />
                </Field>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Opens" optional>
                  <Input type="datetime-local" value={qOpens} onChange={e => setQOpens(e.target.value)} />
                </Field>
                <Field label="Closes" optional>
                  <Input type="datetime-local" value={qCloses} onChange={e => setQCloses(e.target.value)} />
                </Field>
              </div>
            </CardBody>
            <CardFooter>
              <Button variant="primary" disabled={!!busy || !qText.trim() || !qDate} loading={busy === 'question'} onClick={saveQuestion}>Schedule question</Button>
            </CardFooter>
          </Card>
        </div>
      )}

      <Modal
        open={eventModal}
        onClose={closeEventModal}
        dismissible={busy !== 'event'}
        size="lg"
        title={editingId ? 'Edit event' : 'Add campus event'}
        description="Shown under “Today on campus” on the day it happens."
        footer={(
          <>
            <Button onClick={closeEventModal} disabled={busy === 'event'}>Cancel</Button>
            <Button variant="primary" disabled={!!busy || !eventForm.title.trim() || !eventForm.startsAt} loading={busy === 'event'} onClick={saveEvent}>{editingId ? 'Save changes' : 'Publish event'}</Button>
          </>
        )}
      >
        <div className="grid gap-4 md:grid-cols-2">
          {notice?.kind === 'error' && <Notice tone="danger" className="md:col-span-2">{notice.text}</Notice>}
          <Field label="Title" required>
            <Input maxLength={255} value={eventForm.title} onChange={e => setEventForm({ ...eventForm, title: e.target.value })} />
          </Field>
          <Field label="Location" optional>
            <Input maxLength={255} value={eventForm.location} onChange={e => setEventForm({ ...eventForm, location: e.target.value })} />
          </Field>
          <Field label="Starts" required>
            <Input type="datetime-local" value={eventForm.startsAt} onChange={e => setEventForm({ ...eventForm, startsAt: e.target.value })} />
          </Field>
          <Field label="Ends" optional>
            <Input type="datetime-local" value={eventForm.endsAt} onChange={e => setEventForm({ ...eventForm, endsAt: e.target.value })} />
          </Field>
          <Field label="Category">
            <Select value={eventForm.category} onChange={e => setEventForm({ ...eventForm, category: e.target.value })}>
              {CATEGORIES.map(c => <option key={c} value={c}>{humanize(c)}</option>)}
            </Select>
          </Field>
          <Field label="Description" optional className="md:col-span-2">
            <Textarea rows={3} maxLength={2000} value={eventForm.description} onChange={e => setEventForm({ ...eventForm, description: e.target.value })} />
          </Field>
        </div>
      </Modal>
    </div>
  );
}
