"use client";
import { Suspense, useEffect, useRef } from 'react';
import { useSearchParams } from 'next/navigation';

function Watch({ onChange }: { onChange: (qs: URLSearchParams) => void }) {
  const key = useSearchParams().toString();
  const first = useRef(true);
  const cb = useRef(onChange);
  useEffect(() => { cb.current = onChange; }, [onChange]);
  useEffect(() => {
    // The page reads the URL it opened with itself; only later changes are reported.
    if (first.current) { first.current = false; return; }
    cb.current(new URLSearchParams(key));
  }, [key]);
  return null;
}

/**
 * Calls `onChange` when the query string changes while the page stays open: a header "New" item or a command
 * palette result that links to the page already on screen (`/catalogue?new=1`, `/restaurants?store=…`) only changes
 * the query, so a read on mount never sees it. Handlers must be idempotent: the page's own replaceState calls
 * (which keep `?store=` in step) are reported too.
 */
export function QueryChange({ onChange }: { onChange: (qs: URLSearchParams) => void }) {
  return (
    <Suspense fallback={null}>
      <Watch onChange={onChange} />
    </Suspense>
  );
}
