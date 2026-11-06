"use client";
// Small shared pieces of the Revenue section: an amount, a "what is this" tip, a copy button and an error boundary
// that keeps one broken panel from blanking the whole page.
import { Component, useState, type ErrorInfo, type ReactNode } from 'react';
import { cn, IconCheck, IconCopy, IconInfo, useToast } from '@/components/ui';
import { ok, rupees } from './revenueModel';

/** An amount in tabular figures; negative in red; missing ("—") muted. */
export function Money({ paise, className, strong = false, neutral = false }: { paise: number | null | undefined; className?: string; strong?: boolean; neutral?: boolean }) {
  return (
    <span className={cn('whitespace-nowrap tabular-nums', strong && 'font-semibold', !ok(paise) ? 'text-fg-subtle' : !neutral && paise < 0 ? 'text-danger-text' : '', className)}>
      {rupees(paise)}
    </span>
  );
}

/** A small (i) that explains a line in one sentence (hover or keyboard focus). */
export function Tip({ text, className }: { text: string; className?: string }) {
  return (
    <span className={cn('group relative inline-flex align-middle', className)}>
      <button type="button" aria-label={text} className="rounded-full p-0.5 text-fg-subtle outline-none hover:text-fg focus-visible:text-fg focus-visible:ring-2 focus-visible:ring-accent/40">
        <IconInfo size={13} />
      </button>
      <span role="tooltip" className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-1.5 hidden w-64 -translate-x-1/2 rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs font-normal leading-snug text-fg shadow-pop group-hover:block group-focus-within:block">
        {text}
      </span>
    </span>
  );
}

export function CopyButton({ value, label }: { value: string; label: string }) {
  const toast = useToast();
  const [done, setDone] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setDone(true);
      setTimeout(() => setDone(false), 1500);
    } catch {
      toast.error('Could not copy. Select the text and copy it by hand.');
    }
  };
  return (
    <button type="button" onClick={copy} aria-label={label} title={label} className="rounded p-1 text-fg-subtle hover:bg-surface-2 hover:text-fg">
      {done ? <IconCheck size={13} className="text-success-text" /> : <IconCopy size={13} />}
    </button>
  );
}

/** Keeps a crash in one panel inside that panel ("This part could not be shown"), with a Try again. */
export class SectionBoundary extends Component<{ name: string; children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error(`[Revenue] ${this.props.name} crashed`, error, info.componentStack); }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" className="mb-4 rounded-lg border border-danger/25 bg-danger-soft px-4 py-3 text-sm">
        <p className="font-medium text-fg">{this.props.name} could not be shown.</p>
        <p className="mt-0.5 text-fg-muted">The rest of the page is fine. No money was changed. Try again, or refresh the page.</p>
        <button type="button" onClick={() => this.setState({ error: null })} className="mt-2 inline-flex h-7 items-center rounded-md border border-line-strong/80 bg-surface px-2.5 text-xs font-medium text-fg hover:bg-surface-2">
          Try again
        </button>
      </div>
    );
  }
}
