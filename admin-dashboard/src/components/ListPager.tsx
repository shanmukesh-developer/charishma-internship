"use client";
import { useEffect, useMemo, useState } from 'react';

/**
 * Client-side paging for long lists already in memory: only `pageSize` rows are rendered.
 * The page resets to 1 whenever `resetKey` changes (e.g. a filter or search term).
 */
export function usePagedRows<T>(rows: T[], pageSize = 50, resetKey: unknown = null) {
  const [page, setPage] = useState(1);
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));

  useEffect(() => { setPage(1); }, [resetKey]);
  // Rows can shrink under the current page (live refresh, delete).
  useEffect(() => { if (page > pages) setPage(pages); }, [page, pages]);

  const visible = useMemo(() => rows.slice((page - 1) * pageSize, page * pageSize), [rows, page, pageSize]);
  return { visible, page: Math.min(page, pages), pages, setPage, total: rows.length, pageSize };
}

export function ListPager({ page, pages, total, pageSize, onPage, noun = 'rows' }: {
  page: number;
  pages: number;
  total: number;
  pageSize: number;
  onPage: (p: number) => void;
  noun?: string;
}) {
  if (pages <= 1) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  const btn = 'px-3 py-1.5 rounded-lg border border-line bg-surface-2/60 text-xs font-semibold text-fg-muted hover:text-fg disabled:opacity-30 disabled:hover:text-fg-muted';
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-t border-line">
      <span className="text-xs font-semibold text-fg-muted">
        {from}–{to} of {total} {noun}
      </span>
      <div className="flex items-center gap-2">
        <button type="button" className={btn} disabled={page <= 1} onClick={() => onPage(page - 1)}>Prev</button>
        <span className="text-xs font-semibold text-fg-muted">{page} / {pages}</span>
        <button type="button" className={btn} disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</button>
      </div>
    </div>
  );
}
