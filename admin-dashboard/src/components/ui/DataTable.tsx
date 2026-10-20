"use client";
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { cn } from './cn';
import { EmptyState, ErrorState, Skeleton } from './Feedback';
import { Checkbox } from './Form';
import { IconArrowDown, IconArrowUp, IconChevronLeft, IconChevronRight, IconSort } from './icons';
import { formatNumber } from '@/lib/format';

export interface Column<T> {
  /** Unique key; also the sort key. */
  key: string;
  header: ReactNode;
  cell: (row: T, index: number) => ReactNode;
  /** Makes the column sortable (client side). Return null to sort last. */
  sortValue?: (row: T) => string | number | Date | boolean | null | undefined;
  align?: 'left' | 'right' | 'center';
  /** CSS width, e.g. '120px' or '20%'. */
  width?: string;
  className?: string;
  headerClassName?: string;
  /** Hide on narrow screens (tablets) to keep the table readable. */
  hideBelow?: 'md' | 'lg' | 'xl';
}

export interface ServerPagination {
  page: number;
  pages: number;
  total?: number;
  pageSize?: number;
  onPage: (page: number) => void;
}

type SortState = { key: string; dir: 'asc' | 'desc' } | null;

const hideCls = { md: 'max-md:hidden', lg: 'max-lg:hidden', xl: 'max-xl:hidden' } as const;
const alignCls = { left: 'text-left', right: 'text-right', center: 'text-center' } as const;

function compare(a: unknown, b: unknown): number {
  const na = a === null || a === undefined || a === '';
  const nb = b === null || b === undefined || b === '';
  if (na && nb) return 0;
  if (na) return 1;
  if (nb) return -1;
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b);
  return String(a).localeCompare(String(b), 'en-IN', { numeric: true, sensitivity: 'base' });
}

/**
 * Table with a sticky header, client-side sorting, pagination and built-in loading / empty / error
 * states. Use `pagination` for server-paged lists (rows are then shown as given), otherwise the table
 * pages `rows` itself (`pageSize`, 0 = show all).
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  loading = false,
  error = null,
  onRetry,
  empty = { title: 'Nothing here yet' },
  pageSize = 25,
  pagination,
  onRowClick,
  rowClassName,
  initialSort = null,
  selection,
  maxHeight = 'calc(100vh - 260px)',
  noun = 'rows',
  caption,
  className,
  dense = false,
  resetPageKey,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T, index: number) => string;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  empty?: { title: string; description?: ReactNode; action?: ReactNode };
  pageSize?: number;
  pagination?: ServerPagination;
  onRowClick?: (row: T) => void;
  rowClassName?: (row: T) => string | undefined;
  initialSort?: SortState;
  /** Adds a checkbox column. `selected` holds row keys. */
  selection?: { selected: string[]; onChange: (keys: string[]) => void; isSelectable?: (row: T) => boolean };
  /** Height limit of the scroll area that keeps the header sticky. 'none' to grow with the page. */
  maxHeight?: string;
  /** Plural noun for the footer, e.g. 'orders'. */
  noun?: string;
  /** Accessible table name (visually hidden). */
  caption?: string;
  className?: string;
  dense?: boolean;
  /** Changing this value returns client paging to page 1 (pass the search/filter values). */
  resetPageKey?: unknown;
}) {
  const [sort, setSort] = useState<SortState>(initialSort);
  const [page, setPage] = useState(1);

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find(c => c.key === sort.key);
    if (!col?.sortValue) return rows;
    const get = col.sortValue;
    const out = [...rows].sort((a, b) => compare(get(a), get(b)));
    return sort.dir === 'desc' ? out.reverse() : out;
  }, [rows, sort, columns]);

  const clientPaged = !pagination && pageSize > 0;
  const pages = pagination ? Math.max(1, pagination.pages) : clientPaged ? Math.max(1, Math.ceil(sorted.length / pageSize)) : 1;
  const current = pagination ? pagination.page : Math.min(page, pages);

  useEffect(() => { setPage(1); }, [resetPageKey]);
  useEffect(() => { if (!pagination && page > pages) setPage(pages); }, [page, pages, pagination]);

  const visible = useMemo(
    () => (clientPaged ? sorted.slice((current - 1) * pageSize, current * pageSize) : sorted),
    [sorted, clientPaged, current, pageSize],
  );

  const toggleSort = (key: string) => {
    setSort(s => (!s || s.key !== key ? { key, dir: 'asc' } : s.dir === 'asc' ? { key, dir: 'desc' } : null));
  };

  const selectableRows = selection ? visible.filter(r => (selection.isSelectable ? selection.isSelectable(r) : true)) : [];
  const visibleKeys = selectableRows.map(r => rowKey(r, rows.indexOf(r)));
  const selectedSet = new Set(selection?.selected || []);
  const allOnPage = visibleKeys.length > 0 && visibleKeys.every(k => selectedSet.has(k));
  const someOnPage = visibleKeys.some(k => selectedSet.has(k));

  const total = pagination ? pagination.total ?? null : sorted.length;
  const per = pagination ? pagination.pageSize ?? visible.length : pageSize;
  const from = total === 0 ? 0 : (current - 1) * (per || 0) + 1;
  const to = pagination ? from + visible.length - 1 : Math.min(sorted.length, current * pageSize);

  const colCount = columns.length + (selection ? 1 : 0);
  const cellPad = dense ? 'px-3 py-1.5' : 'px-3 py-2.5';
  const showError = !!error && rows.length === 0;

  return (
    <div className={cn('overflow-hidden rounded-lg border border-line bg-surface shadow-xs', className)}>
      {error && rows.length > 0 && (
        <div className="flex items-center justify-between gap-3 border-b border-line bg-danger-soft px-3 py-2 text-sm text-danger-text" role="alert">
          <span>{error}</span>
          {onRetry && <button type="button" onClick={onRetry} className="font-medium underline underline-offset-2">Try again</button>}
        </div>
      )}
      <div className="overflow-auto" style={maxHeight === 'none' ? undefined : { maxHeight }}>
        <table className="w-full border-separate border-spacing-0 text-sm">
          {caption && <caption className="sr-only">{caption}</caption>}
          <thead>
            <tr>
              {selection && (
                <th scope="col" className="sticky top-0 z-10 w-10 border-b border-line bg-surface-2 px-3 py-2 text-left">
                  <Checkbox
                    aria-label={allOnPage ? 'Clear selection on this page' : 'Select all on this page'}
                    checked={allOnPage}
                    indeterminate={!allOnPage && someOnPage}
                    disabled={visibleKeys.length === 0}
                    onChange={() => {
                      const set = new Set(selection.selected);
                      if (allOnPage) visibleKeys.forEach(k => set.delete(k));
                      else visibleKeys.forEach(k => set.add(k));
                      selection.onChange(Array.from(set));
                    }}
                  />
                </th>
              )}
              {columns.map(col => {
                const sortable = !!col.sortValue;
                const active = sort?.key === col.key;
                const ariaSort = active ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : sortable ? 'none' : undefined;
                return (
                  <th
                    key={col.key}
                    scope="col"
                    aria-sort={ariaSort}
                    style={col.width ? { width: col.width } : undefined}
                    className={cn(
                      'sticky top-0 z-10 whitespace-nowrap border-b border-line bg-surface-2 px-3 py-2 text-xs font-medium text-fg-muted',
                      alignCls[col.align || 'left'],
                      col.hideBelow && hideCls[col.hideBelow],
                      col.headerClassName,
                    )}
                  >
                    {sortable ? (
                      <button
                        type="button"
                        onClick={() => toggleSort(col.key)}
                        className={cn('inline-flex items-center gap-1 rounded hover:text-fg', active && 'text-fg', col.align === 'right' && 'flex-row-reverse')}
                      >
                        {col.header}
                        {active ? (sort!.dir === 'asc' ? <IconArrowUp size={12} /> : <IconArrowDown size={12} />) : <IconSort size={12} className="opacity-40" />}
                      </button>
                    ) : (
                      col.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {loading && rows.length === 0 ? (
              Array.from({ length: 6 }, (_, i) => (
                <tr key={`sk-${i}`}>
                  {selection && <td className={cn(cellPad, 'border-b border-line')}><Skeleton className="h-4 w-4" /></td>}
                  {columns.map((c, j) => (
                    <td key={c.key} className={cn(cellPad, 'border-b border-line', c.hideBelow && hideCls[c.hideBelow])}>
                      <Skeleton className={cn('h-4', j === 0 ? 'w-3/4' : 'w-1/2', c.align === 'right' && 'ml-auto')} />
                    </td>
                  ))}
                </tr>
              ))
            ) : showError ? (
              <tr><td colSpan={colCount}><ErrorState message={error} onRetry={onRetry} /></td></tr>
            ) : visible.length === 0 ? (
              <tr><td colSpan={colCount}><EmptyState title={empty.title} description={empty.description} action={empty.action} /></td></tr>
            ) : (
              visible.map((row, i) => {
                const index = clientPaged ? (current - 1) * pageSize + i : i;
                const key = rowKey(row, rows.indexOf(row) >= 0 ? rows.indexOf(row) : index);
                const selected = selectedSet.has(key);
                const canSelect = selection ? (selection.isSelectable ? selection.isSelectable(row) : true) : false;
                return (
                  <tr
                    key={key}
                    onClick={onRowClick ? (e) => {
                      // Clicks on buttons, links and inputs inside the row keep their own behaviour.
                      if ((e.target as HTMLElement).closest('button,a,input,select,textarea,label,[data-row-stop]')) return;
                      onRowClick(row);
                    } : undefined}
                    onKeyDown={onRowClick ? (e) => {
                      if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) { e.preventDefault(); onRowClick(row); }
                    } : undefined}
                    tabIndex={onRowClick ? 0 : undefined}
                    className={cn(
                      'group transition-colors',
                      onRowClick && 'cursor-pointer hover:bg-surface-2/70 focus-visible:bg-surface-2',
                      selected && 'bg-accent-soft/60',
                      rowClassName?.(row),
                    )}
                  >
                    {selection && (
                      <td className={cn(cellPad, 'border-b border-line align-middle')}>
                        <Checkbox
                          aria-label="Select row"
                          checked={selected}
                          disabled={!canSelect}
                          onChange={() => {
                            const set = new Set(selection.selected);
                            if (selected) set.delete(key); else set.add(key);
                            selection.onChange(Array.from(set));
                          }}
                        />
                      </td>
                    )}
                    {columns.map(col => (
                      <td
                        key={col.key}
                        className={cn(
                          cellPad,
                          'border-b border-line align-middle text-fg',
                          alignCls[col.align || 'left'],
                          col.hideBelow && hideCls[col.hideBelow],
                          col.className,
                        )}
                      >
                        {col.cell(row, index)}
                      </td>
                    ))}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      {(pages > 1 || (pagination && (pagination.total ?? 0) > 0)) && visible.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-3 py-2 text-xs text-fg-muted">
          <span className="tabular-nums">
            {total !== null ? `${formatNumber(from)}–${formatNumber(Math.max(from, to))} of ${formatNumber(total)} ${noun}` : `Page ${current} of ${pages}`}
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              aria-label="Previous page"
              disabled={current <= 1 || loading}
              onClick={() => (pagination ? pagination.onPage(current - 1) : setPage(current - 1))}
              className="flex h-7 w-7 items-center justify-center rounded-md border border-line bg-surface text-fg hover:bg-surface-2 disabled:opacity-40"
            >
              <IconChevronLeft size={14} />
            </button>
            <span className="px-2 tabular-nums">{current} / {pages}</span>
            <button
              type="button"
              aria-label="Next page"
              disabled={current >= pages || loading}
              onClick={() => (pagination ? pagination.onPage(current + 1) : setPage(current + 1))}
              className="flex h-7 w-7 items-center justify-center rounded-md border border-line bg-surface text-fg hover:bg-surface-2 disabled:opacity-40"
            >
              <IconChevronRight size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Row of filters / search / actions above a table. Wraps on narrow screens. */
export function Toolbar({ children, className, end }: { children?: ReactNode; className?: string; end?: ReactNode }) {
  return (
    <div className={cn('mb-3 flex flex-wrap items-center gap-2', className)}>
      {children}
      {end && <div className="ml-auto flex flex-wrap items-center gap-2">{end}</div>}
    </div>
  );
}

/** Sticky bar that appears while rows are selected (bulk actions). */
export function BulkBar({ count, onClear, children, noun = 'selected' }: { count: number; onClear: () => void; children: ReactNode; noun?: string }) {
  if (count === 0) return null;
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-accent/25 bg-accent-soft px-3 py-2 text-sm" role="region" aria-label="Bulk actions">
      <span className="font-medium text-accent-text tabular-nums">{formatNumber(count)} {noun}</span>
      <button type="button" onClick={onClear} className="text-fg-muted underline-offset-2 hover:text-fg hover:underline">Clear</button>
      <div className="ml-auto flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}
