"use client";

import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useState, useEffect, useCallback } from 'react';
import { useVisibleInterval } from '@/lib/useVisibleInterval';
import { API_URL } from '@/lib/config';
import { logout } from '@/lib/session';
import { useAdminAuth } from '@/utils/useAdminAuth';
import { useAdminSocket } from '@/components/AdminSocketProvider';
import { NAV_GROUPS, NAV_HOME, findNavItem, isNavActive, type NavItem } from '@/lib/nav';
import { cn } from '@/components/ui/cn';
import { Button, IconButton } from '@/components/ui/Button';
import { Menu } from '@/components/ui/Overlay';
import { Notice, Spinner } from '@/components/ui/Feedback';
import { useTheme } from '@/components/ui/Theme';
import {
  IconBell, IconCheck, IconChevronDown, IconLock, IconLogOut, IconMenu, IconMonitor, IconMoon, IconPlus,
  IconSearch, IconStore, IconSun, IconTag, IconAuto, IconList, IconX,
} from '@/components/ui/icons';
import { NavIcon } from './NavIcon';
import CommandPalette from './CommandPalette';

const COLLAPSE_KEY = 'zenvy_admin_nav_collapsed';

/** Full-screen message while the session is checked / redirected (no shell yet). */
function AuthScreen({ title, detail, action, busy }: { title: string; detail?: string; action?: React.ReactNode; busy?: boolean }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-bg p-6">
      <div className="w-full max-w-sm rounded-xl border border-line bg-surface p-8 text-center shadow-sm" role="status" aria-live="polite">
        <Wordmark className="mx-auto mb-6 justify-center" />
        {busy && <Spinner className="mx-auto mb-3 text-fg-subtle" />}
        <p className="text-base font-semibold text-fg">{title}</p>
        {detail && <p className="mt-2 text-sm text-fg-muted">{detail}</p>}
        {action && <div className="mt-6">{action}</div>}
      </div>
    </div>
  );
}

export function Wordmark({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <div className={cn('flex items-center gap-2', className)}>
      {/* ZenWe logo (owner, 4 Nov 2026): the yellow disc with the scooter rider. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/zenwe-brand-badge-2026-11-04.png" alt="" width={28} height={28} className="h-7 w-7 shrink-0 rounded-full" aria-hidden />
      {!compact && (
        <span className="flex items-baseline gap-1.5">
          <span className="text-[15px] font-semibold tracking-[-0.01em] text-fg">ZenWe</span>
          <span className="text-sm text-fg-subtle">Admin</span>
        </span>
      )}
    </div>
  );
}

function SidebarLink({ item, active }: { item: NavItem; active: boolean }) {
  return (
    <Link
      href={item.href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'group flex h-8 items-center gap-2.5 rounded-md px-2 text-sm transition-colors',
        active ? 'bg-surface-3/70 font-medium text-fg' : 'text-fg-muted hover:bg-surface-2 hover:text-fg',
      )}
    >
      <NavIcon name={item.icon} size={16} className={active ? 'text-fg' : 'text-fg-subtle group-hover:text-fg-muted'} />
      <span className="truncate">{item.label}</span>
    </Link>
  );
}

function Sidebar({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  useEffect(() => {
    try { setCollapsed(JSON.parse(localStorage.getItem(COLLAPSE_KEY) || '{}') || {}); } catch { /* ignore */ }
  }, []);
  const toggle = (id: string) => setCollapsed(prev => {
    const next = { ...prev, [id]: !prev[id] };
    try { localStorage.setItem(COLLAPSE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
    return next;
  });
  return (
    <nav aria-label="Admin sections" className="flex-1 space-y-4 overflow-y-auto px-3 pb-4" onClick={e => { if ((e.target as HTMLElement).closest('a')) onNavigate?.(); }}>
      <div>
        <SidebarLink item={NAV_HOME} active={isNavActive(NAV_HOME, pathname)} />
      </div>
      {NAV_GROUPS.map(group => {
        const hasActive = group.items.some(i => isNavActive(i, pathname));
        // The group with the open page is always expanded.
        const isCollapsed = !!collapsed[group.id] && !hasActive;
        const listId = `nav-group-${group.id}`;
        return (
          <div key={group.id}>
            <button
              type="button"
              onClick={() => toggle(group.id)}
              aria-expanded={!isCollapsed}
              aria-controls={listId}
              className="mb-0.5 flex w-full items-center justify-between rounded px-2 py-1 text-xs font-medium text-fg-subtle hover:text-fg-muted"
            >
              {group.label}
              <IconChevronDown size={12} className={cn('transition-transform', isCollapsed && '-rotate-90')} />
            </button>
            <div id={listId} hidden={isCollapsed} className="space-y-px">
              {group.items.map(item => <SidebarLink key={item.href} item={item} active={isNavActive(item, pathname)} />)}
            </div>
          </div>
        );
      })}
    </nav>
  );
}

function LiveStatus() {
  const { isConnected } = useAdminSocket();
  return (
    <div className="flex items-center gap-2 px-2 text-xs text-fg-muted" title={isConnected ? 'Pages update live as things change.' : 'Live updates are offline; pages refresh every 15 to 60 seconds.'}>
      <span className={cn('h-2 w-2 rounded-full', isConnected ? 'bg-success' : 'bg-warning')} aria-hidden />
      {isConnected ? 'Live updates on' : 'Live updates paused, refreshing periodically'}
    </div>
  );
}

function useThemeMenuItems() {
  const { pref, setPref } = useTheme();
  const opt = (value: 'light' | 'dark' | 'system', label: string, icon: React.ReactNode) => ({
    label: <span className="flex items-center justify-between gap-3">{label}{pref === value && <IconCheck size={14} className="text-accent-text" />}</span>,
    icon,
    onSelect: () => setPref(value),
  });
  return [
    { heading: 'Theme' } as const,
    opt('light', 'Light', <IconSun size={14} />),
    opt('dark', 'Dark', <IconMoon size={14} />),
    opt('system', 'Same as device', <IconMonitor size={14} />),
  ];
}

const maskPhone = (p?: string | null) => {
  const d = String(p || '').replace(/\D/g, '');
  return d.length >= 4 ? `Phone ending ${d.slice(-4)}` : null;
};

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || '/';
  const router = useRouter();
  const isLoginPage = pathname.replace(/\/+$/, '') === '/login';
  const auth = useAdminAuth();
  const [systemHealth, setSystemHealth] = useState<{ database: string; persistence: string }>({ database: '...', persistence: '...' });
  const [searchOpen, setSearchOpen] = useState(false);

  const isAuthed = auth.status === 'authed';
  // Below lg the sidebar is a drawer opened from the header's menu button.
  const [navOpen, setNavOpen] = useState(false);
  useEffect(() => { setNavOpen(false); }, [pathname]);
  useEffect(() => {
    if (!navOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setNavOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navOpen]);

  // Ctrl/Cmd K, or "/" outside a text field, opens the global search.
  useEffect(() => {
    if (!isAuthed || isLoginPage) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
      if ((e.key === 'k' || e.key === 'K') && (e.ctrlKey || e.metaKey)) { e.preventDefault(); setSearchOpen(o => !o); }
      else if (e.key === '/' && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); setSearchOpen(true); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isAuthed, isLoginPage]);

  // Signed out (or not an admin): go to the login page and come back afterwards.
  useEffect(() => {
    if (isLoginPage || auth.status !== 'denied') return;
    const next = pathname && pathname !== '/' ? `?next=${encodeURIComponent(pathname)}` : '';
    router.replace(`/login${next}`);
  }, [isLoginPage, auth.status, pathname, router]);

  // S1: 2-step sign-in is required and not set up yet: only the Account security page is usable.
  const mustSetUp2fa = isAuthed && !!auth.user?.mfaSetupRequired;
  const onSecurityPage = pathname.replace(/\/+$/, '') === '/security';
  useEffect(() => {
    if (mustSetUp2fa && !onSecurityPage) router.replace('/security');
  }, [mustSetUp2fa, onSecurityPage, router]);

  const fetchHealth = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/admin/health`);
      if (!res.ok) return;
      const data = await res.json();
      setSystemHealth(data);
    } catch { /* ignore */ }
  }, []);
  useEffect(() => {
    if (isLoginPage || !isAuthed) return;
    fetchHealth();
  }, [isLoginPage, isAuthed, fetchHealth]);
  // Every 2 minutes, paused while the tab is hidden.
  useVisibleInterval(fetchHealth, 120000, !isLoginPage && isAuthed);

  // Document title follows the page name from the navigation model.
  useEffect(() => {
    if (isLoginPage) { document.title = 'Sign in · ZenWe Admin'; return; }
    const hit = findNavItem(pathname);
    document.title = hit ? `${hit.item.label} · ZenWe Admin` : 'ZenWe Admin';
  }, [pathname, isLoginPage]);

  const themeItems = useThemeMenuItems();

  if (isLoginPage) {
    return <>{children}</>;
  }

  if (auth.status === 'checking') {
    return <AuthScreen busy title="Checking your session" detail="Confirming your admin access with the ZenWe server." />;
  }

  if (auth.status === 'error') {
    return (
      <AuthScreen
        title="Could not check your session"
        detail={auth.message || 'The server could not be reached.'}
        action={
          <div className="flex justify-center gap-2">
            <Button variant="primary" onClick={auth.retry}>Try again</Button>
            <Button onClick={() => { logout(); }}>Sign out</Button>
          </div>
        }
      />
    );
  }

  if (!isAuthed) {
    return <AuthScreen busy title="Opening sign in" />;
  }

  if (mustSetUp2fa && !onSecurityPage) {
    return <AuthScreen busy title="Set up 2-step sign-in" detail="Admin access needs 2-step sign-in. Opening Account security." />;
  }

  const volatile = systemHealth.persistence === 'VOLATILE';
  const phoneLine = maskPhone(auth.user?.phone);
  const initials = (auth.user?.name || 'Admin').split(/\s+/).map(w => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();

  const sidebarInner = (
    <>
      <div className="flex h-14 shrink-0 items-center justify-between px-4">
        <Link href="/" aria-label="ZenWe Admin overview"><Wordmark /></Link>
        <IconButton label="Close menu" className="lg:hidden" onClick={() => setNavOpen(false)}><IconX size={16} /></IconButton>
      </div>
      <div className="px-3 pb-3">
        <button
          type="button"
          onClick={() => { setNavOpen(false); setSearchOpen(true); }}
          className="flex h-8 w-full items-center gap-2 rounded-md border border-line bg-surface px-2.5 text-sm text-fg-subtle shadow-xs hover:border-line-strong hover:text-fg-muted"
        >
          <IconSearch size={14} />
          <span className="flex-1 text-left">Search</span>
          <kbd className="rounded border border-line bg-surface-2 px-1 font-sans text-2xs">Ctrl K</kbd>
        </button>
      </div>
      <Sidebar pathname={pathname} onNavigate={() => setNavOpen(false)} />
      <div className="shrink-0 border-t border-line px-3 py-3">
        <LiveStatus />
      </div>
    </>
  );

  return (
    <div className="flex min-h-screen bg-bg">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[300] focus:rounded-md focus:bg-surface focus:px-3 focus:py-2 focus:shadow-pop">Skip to content</a>

      {/* Sidebar: fixed column from 1024 px, drawer below. */}
      <aside id="admin-sidebar" aria-label="Sidebar" className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-line bg-surface-2/40 lg:flex">
        {sidebarInner}
      </aside>
      {navOpen && (
        <div className="fixed inset-0 z-[60] lg:hidden">
          <button type="button" aria-label="Close menu" onClick={() => setNavOpen(false)} className="absolute inset-0 bg-scrim/40 animate-zv-fade-in" />
          <aside aria-label="Sidebar" className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col border-r border-line bg-surface shadow-pop animate-zv-fade-in">
            {sidebarInner}
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-40 flex h-14 shrink-0 items-center gap-2 border-b border-line bg-bg/85 px-4 backdrop-blur supports-[backdrop-filter]:bg-bg/75 md:px-6">
          <IconButton label="Open menu" className="lg:hidden" onClick={() => setNavOpen(true)} aria-expanded={navOpen} aria-controls="admin-sidebar">
            <IconMenu size={18} />
          </IconButton>

          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            className="flex h-8 min-w-0 max-w-md flex-1 items-center gap-2 rounded-md border border-line bg-surface px-2.5 text-sm text-fg-subtle shadow-xs transition-colors hover:border-line-strong hover:text-fg-muted"
            aria-label="Search stores, orders, customers, riders and pages"
          >
            <IconSearch size={14} className="shrink-0" />
            <span className="truncate">Search stores, order ID, customer or phone</span>
            <kbd className="ml-auto hidden rounded border border-line bg-surface-2 px-1 font-sans text-2xs sm:inline">Ctrl K</kbd>
          </button>

          <div className="ml-auto flex items-center gap-1.5">
            <Menu
              label="Create"
              trigger={p => (
                <Button {...p} variant="secondary" leftIcon={<IconPlus size={14} />} rightIcon={<IconChevronDown size={12} className="text-fg-subtle" />}>
                  <span className="max-sm:hidden">New</span>
                </Button>
              )}
              items={[
                { label: 'Item in catalogue', icon: <IconList size={14} />, href: '/catalogue?new=1' },
                { label: 'Store', icon: <IconStore size={14} />, href: '/restaurants?new=1' },
                { label: 'Auto driver', icon: <IconAuto size={14} />, href: '/auto-ride?tab=drivers&new=1' },
                { label: 'Coupon', icon: <IconTag size={14} />, href: '/coupons?new=1' },
                { label: 'Push notification', icon: <IconBell size={14} />, href: '/notifications' },
              ]}
            />
            <Menu
              label="Account"
              trigger={p => (
                <button
                  {...p}
                  type="button"
                  className="flex h-8 items-center gap-2 rounded-md pl-1 pr-1.5 text-sm text-fg hover:bg-surface-2"
                  aria-label={`Account: ${auth.user?.name || 'Admin'}`}
                >
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-accent-soft text-2xs font-semibold text-accent-text">{initials || 'A'}</span>
                  <span className="max-w-[140px] truncate max-md:hidden">{auth.user?.name || 'Admin'}</span>
                  <IconChevronDown size={12} className="text-fg-subtle" />
                </button>
              )}
              items={[
                { heading: [auth.user?.name || 'Admin', phoneLine].filter(Boolean).join(' · ') },
                { label: 'Account security', icon: <IconLock size={14} />, href: '/security' },
                'separator',
                ...themeItems,
                'separator',
                { label: 'Sign out', icon: <IconLogOut size={14} />, onSelect: () => { logout(); } },
              ]}
            />
          </div>
        </header>

        <main id="main" className="min-w-0 flex-1 px-4 py-6 md:px-8 md:py-8" tabIndex={-1}>
          <div className="mx-auto w-full max-w-[1400px]">
            {auth.user?.weakPassword && (
              <Notice tone="danger" title="Change your admin password now" className="mb-6">
                This admin account still uses a password that the old setup scripts published, so anyone who has seen the code can sign in as you. Change it in the ZenWe app: Sign in, then Forgot password (a code comes to this account&apos;s phone). Or set ADMIN_RESET_PASSWORD (12 or more characters) in Render, Environment. Then turn on 2-step sign-in in Account security.
              </Notice>
            )}
            {volatile && (
              <Notice tone="danger" title="Storage is temporary on this server" className="mb-6">
                The backend is not connected to its permanent database, so changes made now will be lost when it restarts. Check the database settings on Render before editing anything.
              </Notice>
            )}
            {children}
          </div>
        </main>
      </div>

      <CommandPalette open={searchOpen} onClose={() => setSearchOpen(false)} />
    </div>
  );
}
