"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { adminRequest } from '@/lib/api';
import { ALL_NAV_ITEMS, EXTRA_SEARCH_PAGES, NAV_GROUPS, type NavItem } from '@/lib/nav';
import { humanize, shortId } from '@/lib/format';
import { cn } from '@/components/ui/cn';
import { IconArrowRight, IconAuto, IconBike, IconPackage, IconSearch, IconStore, IconUser } from '@/components/ui/icons';
import { Spinner } from '@/components/ui/Feedback';
import { NavIcon } from './NavIcon';

/**
 * Global search (Ctrl/Cmd K): pages, stores, orders by ID, customers / riders / auto drivers by
 * name or phone (last 4 digits work). Read-only: every result just opens the right admin page.
 */

interface Result {
  id: string;
  section: string;
  title: string;
  subtitle?: string;
  href: string;
  icon: React.ReactNode;
}

const groupOf = (item: NavItem) => NAV_GROUPS.find(g => g.items.includes(item))?.label;

const pageScore = (item: NavItem, q: string) => {
  const label = item.label.toLowerCase();
  if (label.startsWith(q)) return 3;
  if (label.includes(q)) return 2;
  if (`${item.keywords || ''} ${item.description}`.toLowerCase().includes(q)) return 1;
  return 0;
};

const digits = (s: unknown) => String(s || '').replace(/\D/g, '');
/** Masked phone for search results: only the last 4 digits. */
const lastFour = (p: unknown) => {
  const d = digits(p);
  return d.length >= 4 ? `•••• ${d.slice(-4)}` : '';
};

// Lists without server-side search are fetched once per palette session and filtered here.
let storeCache: { at: number; rows: Array<{ id: string; name: string; type?: string; isActive?: boolean }> } | null = null;
let riderCache: { at: number; rows: Array<{ id: string; name: string; phone?: string; isApproved?: boolean; isOnline?: boolean }> } | null = null;
const CACHE_MS = 60_000;

async function loadStores() {
  if (storeCache && Date.now() - storeCache.at < CACHE_MS) return storeCache.rows;
  const list = await adminRequest<any[]>('/api/admin/restaurants');
  const rows = (Array.isArray(list) ? list : []).map(r => ({ id: String(r.id || r._id), name: String(r.name || 'Store'), type: r.storeType || r.type || r.category, isActive: r.isActive }));
  storeCache = { at: Date.now(), rows };
  return rows;
}

async function loadRiders() {
  if (riderCache && Date.now() - riderCache.at < CACHE_MS) return riderCache.rows;
  const d = await adminRequest<{ riders?: any[] }>('/api/admin/riders?limit=100&page=1');
  const rows = (Array.isArray(d?.riders) ? d.riders : []).map(r => ({ id: String(r.id || r._id), name: String(r.name || 'Rider'), phone: r.phone, isApproved: r.isApproved, isOnline: r.isOnline }));
  riderCache = { at: Date.now(), rows };
  return rows;
}

const ORDER_ID_RE = /^#?[0-9a-f-]{4,36}$/i;

export default function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [remote, setRemote] = useState<Result[]>([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const seq = useRef(0);

  useEffect(() => {
    if (!open) return;
    setQ('');
    setRemote([]);
    setActive(0);
    const t = window.setTimeout(() => inputRef.current?.focus(), 10);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.clearTimeout(t); document.body.style.overflow = prev; };
  }, [open]);

  const term = q.trim().toLowerCase();

  const pageResults: Result[] = useMemo(() => {
    const pool = [...ALL_NAV_ITEMS, ...EXTRA_SEARCH_PAGES];
    const items = term
      ? pool.map(i => ({ i, s: pageScore(i, term) })).filter(x => x.s > 0).sort((a, b) => b.s - a.s).slice(0, 8).map(x => x.i)
      : ALL_NAV_ITEMS.slice(0, 8);
    return items.map(i => ({
      id: `page:${i.href}`,
      section: 'Pages',
      title: i.label,
      subtitle: groupOf(i) ? `${groupOf(i)} · ${i.description}` : i.description,
      href: i.href,
      icon: <NavIcon name={i.icon} size={16} />,
    }));
  }, [term]);

  // Records: debounced, newest query wins.
  useEffect(() => {
    if (!open) return;
    const raw = q.trim();
    if (raw.length < 2) { setRemote([]); setLoading(false); return; }
    const mySeq = ++seq.current;
    setLoading(true);
    const t = window.setTimeout(async () => {
      const lower = raw.toLowerCase();
      const qDigits = digits(raw);
      const isPhoneish = qDigits.length >= 4 && qDigits.length === raw.replace(/[\s+-]/g, '').length;
      const jobs: Array<Promise<Result[]>> = [];

      // Orders by ID (full ID or the short #ABC123 reference shown everywhere).
      if (ORDER_ID_RE.test(raw) && /[0-9a-f]{4,}/i.test(raw.replace(/-/g, ''))) {
        const idq = raw.replace(/^#/, '').toLowerCase();
        jobs.push(
          adminRequest<{ orders?: any[] }>(`/api/admin/orders?q=${encodeURIComponent(idq)}&limit=5`)
            .then(d => (Array.isArray(d?.orders) ? d.orders : []).map(o => {
              const id = String(o.id || o._id);
              return {
                id: `order:${id}`,
                section: 'Orders',
                title: `Order ${shortId(id)}`,
                subtitle: [o.restaurant?.name, o.user?.name, humanize(o.status)].filter(Boolean).join(' · '),
                href: `/orders?order=${encodeURIComponent(id)}`,
                icon: <IconPackage size={16} />,
              };
            }))
            .catch(() => []),
        );
      }

      jobs.push(
        loadStores()
          .then(rows => rows.filter(s => s.name.toLowerCase().includes(lower)).slice(0, 5).map(s => ({
            id: `store:${s.id}`,
            section: 'Stores',
            title: s.name,
            subtitle: [s.type ? humanize(s.type) : null, s.isActive === false ? 'Hidden' : null].filter(Boolean).join(' · ') || 'Store',
            href: `/restaurants?store=${encodeURIComponent(s.id)}`,
            icon: <IconStore size={16} />,
          })))
          .catch(() => []),
      );

      jobs.push(
        adminRequest<{ users?: any[] }>(`/api/admin/users?limit=5&search=${encodeURIComponent(raw)}`)
          .then(d => (Array.isArray(d?.users) ? d.users : []).slice(0, 5).map(u => ({
            id: `user:${u.id || u._id}`,
            section: 'Customers',
            title: String(u.name || 'Customer'),
            subtitle: [lastFour(u.phone), u.hostelBlock || u.hostel].filter(Boolean).join(' · ') || 'Customer',
            href: `/users?search=${encodeURIComponent(isPhoneish ? qDigits : String(u.name || raw))}`,
            icon: <IconUser size={16} />,
          })))
          .catch(() => []),
      );

      jobs.push(
        loadRiders()
          .then(rows => rows.filter(r => r.name.toLowerCase().includes(lower) || (isPhoneish && digits(r.phone).includes(qDigits))).slice(0, 5).map(r => ({
            id: `rider:${r.id}`,
            section: 'Riders',
            title: r.name,
            subtitle: [lastFour(r.phone), r.isApproved === false ? 'Waiting for approval' : r.isOnline ? 'Online' : 'Offline'].filter(Boolean).join(' · '),
            href: `/fleet?search=${encodeURIComponent(isPhoneish ? qDigits : r.name)}`,
            icon: <IconBike size={16} />,
          })))
          .catch(() => []),
      );

      jobs.push(
        adminRequest<{ drivers?: any[] }>(`/api/admin/auto-ride/drivers?status=ALL&limit=5&q=${encodeURIComponent(isPhoneish ? qDigits : raw)}`)
          .then(d => (Array.isArray(d?.drivers) ? d.drivers : []).slice(0, 5).map(dr => ({
            id: `driver:${dr.id}`,
            section: 'Auto drivers',
            title: String(dr.name || 'Driver'),
            subtitle: [lastFour(dr.phone) || (dr.phoneMasked ? String(dr.phoneMasked) : ''), dr.status ? humanize(dr.status) : null].filter(Boolean).join(' · '),
            href: `/auto-ride?tab=drivers&q=${encodeURIComponent(isPhoneish ? qDigits : String(dr.name || raw))}`,
            icon: <IconAuto size={16} />,
          })))
          .catch(() => []),
      );

      const all = (await Promise.all(jobs)).flat();
      if (seq.current !== mySeq) return;
      setRemote(all);
      setLoading(false);
    }, 250);
    return () => window.clearTimeout(t);
  }, [q, open]);

  const results = useMemo(() => [...pageResults, ...remote], [pageResults, remote]);
  useEffect(() => { setActive(0); }, [term, remote.length]);

  const go = useCallback((r: Result | undefined) => {
    if (!r) return;
    onClose();
    router.push(r.href);
  }, [onClose, router]);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  if (!open || typeof document === 'undefined') return null;

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(results.length - 1, a + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(0, a - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); go(results[active]); }
  };

  const sections: string[] = [];
  results.forEach(r => { if (!sections.includes(r.section)) sections.push(r.section); });
  let index = -1;

  return createPortal(
    <div className="fixed inset-0 z-[150] flex items-start justify-center p-4 pt-[12vh]" onKeyDown={onKey}>
      <div className="fixed inset-0 bg-scrim/50 animate-zv-fade-in" onClick={onClose} aria-hidden />
      <div role="dialog" aria-modal="true" aria-label="Search the admin" className="relative w-full max-w-xl overflow-hidden rounded-xl border border-line bg-surface shadow-pop animate-zv-pop-in">
        <div className="flex items-center gap-2 border-b border-line px-3">
          <IconSearch size={16} className="text-fg-subtle" />
          <input
            ref={inputRef}
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Search pages, stores, order ID, customer or phone (last 4)"
            aria-label="Search"
            aria-controls="zv-search-results"
            aria-activedescendant={results[active] ? `zv-res-${active}` : undefined}
            role="combobox"
            aria-expanded="true"
            className="h-12 flex-1 bg-transparent text-base text-fg outline-none placeholder:text-fg-subtle"
          />
          {loading && <Spinner size={14} className="text-fg-subtle" />}
          <kbd className="rounded border border-line bg-surface-2 px-1.5 text-2xs text-fg-subtle">Esc</kbd>
        </div>
        <div ref={listRef} id="zv-search-results" role="listbox" className="max-h-[60vh] overflow-y-auto p-1.5">
          {results.length === 0 && !loading && (
            <p className="px-3 py-8 text-center text-sm text-fg-muted">No matches for “{q.trim()}”.</p>
          )}
          {sections.map(section => (
            <div key={section} className="mb-1">
              <p className="px-2.5 pb-1 pt-2 text-xs font-medium text-fg-subtle">{section}</p>
              {results.filter(r => r.section === section).map(r => {
                index += 1;
                const i = index;
                return (
                  <button
                    key={r.id}
                    id={`zv-res-${i}`}
                    data-index={i}
                    type="button"
                    role="option"
                    aria-selected={i === active}
                    onMouseMove={() => setActive(i)}
                    onClick={() => go(r)}
                    className={cn('flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left', i === active ? 'bg-surface-2' : '')}
                  >
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-line bg-surface text-fg-muted">{r.icon}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-fg">{r.title}</span>
                      {r.subtitle && <span className="block truncate text-xs text-fg-muted">{r.subtitle}</span>}
                    </span>
                    {i === active && <IconArrowRight size={14} className="text-fg-subtle" />}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        <div className="flex items-center gap-4 border-t border-line bg-surface-2/50 px-3 py-2 text-2xs text-fg-subtle">
          <span><kbd className="font-sans">↑ ↓</kbd> to move</span>
          <span><kbd className="font-sans">Enter</kbd> to open</span>
          <span className="ml-auto">Phone numbers: type the last 4 digits</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}

