"use client";
import { useEffect, useState } from 'react';
import { useAdminAuth } from '@/utils/useAdminAuth';
import { adminRequest as apiRequest } from '@/lib/api';

/** fetch against the one backend; throws an Error carrying the server's friendly `message`. */
const CATEGORIES = [
  { value: 'announcement', label: 'Announcement' },
  { value: 'service_update', label: 'Service update' },
  { value: 'offer', label: 'Offer' },
  { value: 'safety', label: 'Safety alert' },
];

const TITLE_MAX = 65;
const BODY_MAX = 240;

export default function NotificationsPage() {
  const { isAuthed } = useAdminAuth();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [targetBlock, setTargetBlock] = useState('');
  const [category, setCategory] = useState('announcement');
  const [blocks, setBlocks] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Known hostel block names come from the server (same list the block leaderboard uses).
  useEffect(() => {
    if (!isAuthed) return;
    apiRequest<{ name: string }[]>('/api/blocks/activity')
      .then(rows => setBlocks(Array.isArray(rows) ? rows.map(r => r.name).filter(Boolean) : []))
      .catch(() => setBlocks([]));
  }, [isAuthed]);

  const trimmedBlock = targetBlock.trim();
  const audienceLabel = trimmedBlock ? `students in "${trimmedBlock}"` : 'all active users';

  const handleSendNotification = async (e: React.FormEvent) => {
    e.preventDefault();
    if (sending) return;
    const t = title.trim();
    const b = body.trim();
    if (!t || !b) {
      setStatus({ type: 'error', message: 'Title and message are both required.' });
      return;
    }
    if (t.length > TITLE_MAX || b.length > BODY_MAX) {
      setStatus({ type: 'error', message: `Keep the title under ${TITLE_MAX} and the message under ${BODY_MAX} characters.` });
      return;
    }
    if (!confirm(`Send this push notification to ${audienceLabel}? It cannot be recalled once sent.`)) return;

    setSending(true);
    setStatus(null);
    try {
      const res = await apiRequest<{ message?: string }>('/api/admin/broadcast-push', {
        method: 'POST',
        body: JSON.stringify({
          title: t,
          body: b,
          targetBlock: trimmedBlock || undefined,
          category,
        }),
      });
      setStatus({ type: 'success', message: res?.message || 'Broadcast sent.' });
      setTitle('');
      setBody('');
    } catch (err) {
      setStatus({ type: 'error', message: err instanceof Error ? err.message : 'Could not send the broadcast.' });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto text-fg">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-fg">Push notifications</h1>
        <p className="mt-1 max-w-3xl text-sm text-fg-muted">
          Send a push notification to student devices. It is also saved in each targeted student&apos;s in-app notification list.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 bg-surface border border-line rounded-lg p-8">
          <form onSubmit={handleSendNotification} className="flex flex-col gap-5">
            {status && (
              <div className={`p-4 rounded-xl border font-semibold text-sm ${status.type === 'success' ? 'bg-success-soft border-success/30 text-success-text' : 'bg-danger-soft border-danger/30 text-danger-text'}`}>
                {status.message}
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="flex flex-col gap-2">
                <label htmlFor="target-block" className="text-sm font-semibold text-fg-muted">Hostel block (optional)</label>
                <input
                  id="target-block"
                  list="known-blocks"
                  placeholder="Everyone"
                  value={targetBlock}
                  onChange={(e) => setTargetBlock(e.target.value)}
                  className="bg-surface-2 border border-line p-4 rounded-xl text-fg outline-none focus:border-accent transition-colors placeholder:text-fg-subtle"
                />
                <datalist id="known-blocks">
                  {blocks.map(b => <option key={b} value={b} />)}
                </datalist>
                <p className="text-xs text-fg-muted">Matches the hostel block saved on the student&apos;s profile exactly. Leave empty for everyone.</p>
              </div>

              <div className="flex flex-col gap-2">
                <label htmlFor="category" className="text-sm font-semibold text-fg-muted">Category</label>
                <select
                  id="category"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="bg-surface-2 border border-line p-4 rounded-xl text-fg outline-none focus:border-accent transition-colors"
                >
                  {CATEGORIES.map(c => (
                    <option key={c.value} value={c.value} className="bg-surface text-fg">{c.label}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex justify-between">
                <label htmlFor="title" className="text-sm font-semibold text-fg-muted">Title</label>
                <span className={`text-xs ${title.length > TITLE_MAX ? 'text-danger-text' : 'text-fg-subtle'}`}>{title.length}/{TITLE_MAX}</span>
              </div>
              <input
                id="title"
                type="text"
                placeholder="e.g. Mess delivery delayed tonight"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="bg-surface-2 border border-line p-4 rounded-xl text-fg outline-none focus:border-accent transition-colors placeholder:text-fg-subtle"
                required
              />
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex justify-between">
                <label htmlFor="body" className="text-sm font-semibold text-fg-muted">Message</label>
                <span className={`text-xs ${body.length > BODY_MAX ? 'text-danger-text' : 'text-fg-subtle'}`}>{body.length}/{BODY_MAX}</span>
              </div>
              <textarea
                id="body"
                placeholder="Say what happened and what students should do."
                value={body}
                onChange={(e) => setBody(e.target.value)}
                className="bg-surface-2 border border-line p-4 rounded-xl text-fg outline-none focus:border-accent transition-colors min-h-[120px] placeholder:text-fg-subtle"
                required
              />
            </div>

            <div className="pt-4 border-t border-line mt-2 flex justify-end">
              <button
                type="submit"
                disabled={sending || !title.trim() || !body.trim()}
                className="bg-success hover:bg-success/90 disabled:opacity-50 disabled:cursor-not-allowed px-8 py-3 rounded-xl font-semibold text-sm shadow-emerald-500/20 transition-all"
              >
                {sending ? 'Sending...' : 'Send Notification'}
              </button>
            </div>
          </form>
        </div>

        <div className="flex flex-col gap-4">
          <div className="text-xs font-semibold text-fg-muted">Preview</div>
          <div className="bg-surface border border-line rounded-lg p-4">
            <div className="flex items-center justify-between pb-3 border-b border-line mb-3">
              <div className="flex items-center gap-2">
                <div className="w-5 h-5 rounded-md bg-surface-2 flex items-center justify-center text-xs font-semibold text-fg">Z</div>
                <span className="text-xs font-semibold text-fg">Zenvy</span>
              </div>
              <span className="text-xs text-fg-muted">now</span>
            </div>
            <div className="text-xs font-semibold text-fg mb-1 break-words">{title || 'Notification title'}</div>
            <div className="text-xs text-fg-muted line-clamp-3 break-words">{body || 'Your message appears here.'}</div>
            <div className="mt-3 pt-2 border-t border-line text-xs font-semibold text-success-text">
              To: {trimmedBlock || 'Everyone'}
            </div>
          </div>

          <div className="bg-info-soft border border-info/30 rounded-lg p-5 text-xs text-info-text leading-relaxed space-y-2">
            <h4 className="font-semibold text-info-text text-xs">What sending does</h4>
            <p>• Push to the devices of every matching active user, plus an entry in their in-app notification list.</p>
            <p>• A live in-app banner for everyone currently online.</p>
            {trimmedBlock && (
              <p className="text-warning-text">
                Note: the server also posts to the general &quot;all&quot; push topic and the live banner goes to everyone online,
                so a block-targeted message can still reach other blocks.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
