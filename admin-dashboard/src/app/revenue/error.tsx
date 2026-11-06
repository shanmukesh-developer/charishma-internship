'use client';
// Last-resort error boundary of the Revenue route (Next 16: `retry` re-fetches and re-renders the segment).
// Each panel of the page also has its own boundary (components/revenue/RevenueBits SectionBoundary).
import { useEffect } from 'react';
import { Button, ErrorState } from '@/components/ui';

export default function RevenueError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => { console.error('[Revenue] page crashed', error); }, [error]);
  return (
    <div className="rounded-lg border border-line bg-surface">
      <ErrorState
        title="The Revenue page could not be shown"
        message="Nothing was changed: no statement was created and nothing was marked paid. Try again; if it keeps happening, reload the page."
      />
      <div className="flex justify-center gap-2 pb-8">
        <Button variant="primary" onClick={() => retry()}>Try again</Button>
        <Button onClick={() => window.location.reload()}>Reload page</Button>
      </div>
    </div>
  );
}
