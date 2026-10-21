import type { ReactNode } from 'react';
import { formatDateTime, humanize } from '@/lib/format';

/**
 * Shows a JSON value (audit details, moderation evidence, server metadata) in plain language instead of
 * raw JSON: keys become labels, booleans Yes / No, ISO dates IST, lists bullet points, nested objects
 * indented. Never runs HTML from the value.
 */

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/;

/** "assigneeName" / "assignee_name" -> "Assignee name". */
export const keyLabel = (k: string) => humanize(String(k));

const scalar = (v: unknown): string => {
  if (v === null || v === undefined || v === '') return '–';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'string' && ISO_RE.test(v)) return formatDateTime(v);
  return String(v);
};

/** One-line text version (for tables and toasts). */
export function readableText(value: unknown, depth = 0): string {
  let v = value;
  if (typeof v === 'string') {
    const t = v.trim();
    if ((t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'))) {
      try { v = JSON.parse(t); } catch { /* plain text */ }
    }
  }
  if (Array.isArray(v)) return v.length ? v.map(x => readableText(x, depth + 1)).join(', ') : 'None';
  if (v && typeof v === 'object') {
    const entries = Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== undefined);
    if (!entries.length) return '–';
    const body = entries.map(([k, x]) => `${keyLabel(k)}: ${readableText(x, depth + 1)}`).join(depth ? '; ' : ' · ');
    return depth ? `(${body})` : body;
  }
  return scalar(v);
}

/** Block version: labelled rows, nested objects indented. */
export function ReadableValue({ value, className }: { value: unknown; className?: string }): ReactNode {
  let v = value;
  if (typeof v === 'string') {
    const t = v.trim();
    if ((t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'))) {
      try { v = JSON.parse(t); } catch { /* plain text */ }
    }
  }
  if (Array.isArray(v)) {
    if (!v.length) return <span className={className}>None</span>;
    if (v.every(x => x === null || typeof x !== 'object')) return <span className={className}>{v.map(scalar).join(', ')}</span>;
    return (
      <ul className={`list-disc space-y-1 pl-5 ${className || ''}`}>
        {v.map((x, i) => <li key={i}><ReadableValue value={x} /></li>)}
      </ul>
    );
  }
  if (v && typeof v === 'object') {
    const entries = Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== undefined);
    if (!entries.length) return <span className={className}>–</span>;
    return (
      <dl className={`grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 ${className || ''}`}>
        {entries.map(([k, x]) => (
          <div key={k} className="contents">
            <dt className="text-fg-muted">{keyLabel(k)}</dt>
            <dd className="min-w-0 break-words text-fg"><ReadableValue value={x} /></dd>
          </div>
        ))}
      </dl>
    );
  }
  return <span className={className}>{scalar(v)}</span>;
}
