"use client";
// One-series daily bar chart for the Revenue page (single hue = the dashboard accent, so no legend; the
// title names the measure). Bars grow from a zero baseline (negative values go down), every bar has a
// hover / focus tooltip, and a table view shows the exact numbers.
import { useMemo, useState } from 'react';
import { SegmentedControl } from '@/components/ui';
import { rupees, type RevenueReport } from './revenueModel';

type Metric = 'collectedPaise' | 'keepsPaise' | 'owedPaise';
const METRICS: { value: Metric; label: string }[] = [
  { value: 'collectedPaise', label: 'Customers paid' },
  { value: 'keepsPaise', label: 'ZenWe keeps' },
  { value: 'owedPaise', label: 'Store gets' },
];

export default function RevenueChart({ series, highlight }: { series: RevenueReport['series']; highlight?: { start: string; end: string } }) {
  const [metric, setMetric] = useState<Metric>('collectedPaise');
  const [asTable, setAsTable] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  const values = series.map(d => d[metric]);
  const { max, min } = useMemo(() => ({ max: Math.max(0, ...values), min: Math.min(0, ...values) }), [values]);
  const span = max - min || 1;
  const zeroPct = (max / span) * 100; // distance of the baseline from the top
  const empty = series.every(d => d.orders === 0);
  const inPeriod = (date: string) => !highlight || (date >= highlight.start && date <= highlight.end);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <SegmentedControl size="sm" ariaLabel="Chart measure" options={METRICS} value={metric} onChange={setMetric} />
        <SegmentedControl size="sm" ariaLabel="Chart or table" options={[{ value: 'chart', label: 'Chart' }, { value: 'table', label: 'Table' }]} value={asTable ? 'table' : 'chart'} onChange={v => setAsTable(v === 'table')} />
      </div>
      {asTable ? (
        <div className="max-h-72 overflow-auto rounded-md border border-line">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-surface-2 text-xs text-fg-muted">
              <tr><th className="px-3 py-1.5 text-left font-medium">Day</th><th className="px-3 py-1.5 text-right font-medium">Orders</th><th className="px-3 py-1.5 text-right font-medium">Customers paid</th><th className="px-3 py-1.5 text-right font-medium">ZenWe keeps</th><th className="px-3 py-1.5 text-right font-medium">Store gets</th></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {series.map(d => (
                <tr key={d.date} className={inPeriod(d.date) ? '' : 'text-fg-subtle'}>
                  <td className="px-3 py-1.5">{d.label}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{d.orders}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{rupees(d.collectedPaise)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{rupees(d.keepsPaise)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{rupees(d.owedPaise)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : empty ? (
        <p className="flex h-48 items-center justify-center rounded-md border border-dashed border-line text-sm text-fg-muted">No delivered orders on these days.</p>
      ) : (
        <div className="relative">
          <div className="flex justify-between text-2xs tabular-nums text-fg-subtle"><span>{rupees(max)}</span></div>
          <div className="relative h-48" role="img" aria-label={`${METRICS.find(m => m.value === metric)?.label} per day`}>
            <div className="absolute inset-x-0 border-t border-line-strong" style={{ top: `${zeroPct}%` }} aria-hidden />
            <div className="absolute inset-0 flex items-stretch gap-[2px]">
              {series.map((d, i) => {
                const v = d[metric];
                const h = (Math.abs(v) / span) * 100;
                const top = v >= 0 ? zeroPct - h : zeroPct;
                return (
                  <button
                    key={d.date}
                    type="button"
                    className="group relative h-full flex-1 outline-none"
                    onMouseEnter={() => setHover(i)}
                    onMouseLeave={() => setHover(null)}
                    onFocus={() => setHover(i)}
                    onBlur={() => setHover(null)}
                    aria-label={`${d.label}: ${rupees(v)}, ${d.orders} orders`}
                  >
                    {v !== 0 && (
                      <span
                        className={`absolute inset-x-[15%] ${v >= 0 ? 'rounded-t' : 'rounded-b'} ${inPeriod(d.date) ? 'bg-accent' : 'bg-accent/35'} ${hover === i ? 'opacity-80' : ''}`}
                        style={{ top: `${top}%`, height: `${Math.max(h, 0.8)}%` }}
                      />
                    )}
                  </button>
                );
              })}
            </div>
            {hover !== null && series[hover] && (
              <div
                className="pointer-events-none absolute -top-2 z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs shadow-pop"
                style={{ left: `${((hover + 0.5) / series.length) * 100}%` }}
              >
                <p className="font-medium text-fg">{series[hover].label}</p>
                <p className="tabular-nums text-fg-muted">{rupees(series[hover][metric])} · {series[hover].orders} order{series[hover].orders === 1 ? '' : 's'}</p>
              </div>
            )}
          </div>
          {min < 0 && <div className="text-2xs tabular-nums text-fg-subtle">{rupees(min)}</div>}
          <div className="mt-1 flex justify-between text-2xs text-fg-subtle">
            <span>{series[0]?.label}</span>
            <span>{series[series.length - 1]?.label}</span>
          </div>
        </div>
      )}
    </div>
  );
}
