"use client";
// Revenue page, top half: the plain "Money flow" summary (with every difference explained in words), the health
// banner (all amounts balance / these orders don't), the ZenWe earnings statement and the "How Revenue works" help.
import { useState, type ReactNode } from 'react';
import { Card, CardBody, CardHeader, Drawer, IconAlert, IconArrowRight, IconCheckCircle, IconChevronDown, IconChevronUp, IconXCircle, Skeleton, cn } from '@/components/ui';
import { Money, Tip } from './RevenueBits';
import { MISSING, count, ok, plural, rupees, sum, type RevenueReport } from './revenueModel';

/* ───────────────────────────────────────────── Money flow */

function FlowBox({ label, paise, sub, tip, tone = 'neutral' }: { label: string; paise: number; sub?: ReactNode; tip: string; tone?: 'neutral' | 'accent' }) {
  return (
    <div className={cn('min-w-0 rounded-lg border px-4 py-3', tone === 'accent' ? 'border-accent/30 bg-accent-soft' : 'border-line bg-surface-2/60')}>
      <p className="flex items-center gap-1 text-xs font-medium text-fg-muted">{label}<Tip text={tip} /></p>
      <p className="mt-1 text-xl font-semibold tracking-[-0.01em] text-fg sm:text-2xl"><Money paise={paise} /></p>
      {sub && <p className="mt-0.5 text-xs text-fg-muted">{sub}</p>}
    </div>
  );
}

const channelText = (t: RevenueReport['totals']) => {
  const parts: string[] = [];
  if (t.ordersByChannel.cod) parts.push(`cash to riders ${rupees(t.byChannel.cod)}`);
  if (t.ordersByChannel.wallet) parts.push(`Wallet ${rupees(t.byChannel.wallet)}`);
  if (t.ordersByChannel.stall) parts.push(`cash stalls took ${rupees(t.byChannel.stall)}`);
  if (t.ordersByChannel.other) parts.push(`UPI / card (old orders) ${rupees(t.byChannel.other)}`);
  return parts.join(' · ');
};

/** Plain-English reasons why the numbers differ from each other (each only when it applies). */
function reasons(r: RevenueReport): ReactNode[] {
  const t = r.totals;
  const out: ReactNode[] = [];
  const fees = sum([t.deliveryFeesPaise, t.platformFeesPaise, t.packagingFeesPaise, t.taxesPaise]);
  const feeParts = [
    t.deliveryFeesPaise ? `delivery ${rupees(t.deliveryFeesPaise)}` : '',
    t.platformFeesPaise ? `platform fee ${rupees(t.platformFeesPaise)}` : '',
    t.packagingFeesPaise ? `packaging ${rupees(t.packagingFeesPaise)}` : '',
    t.taxesPaise ? `taxes ${rupees(t.taxesPaise)}` : '',
  ].filter(Boolean).join(', ');
  const discParts = [
    t.discounts.coupon ? `coupons ${rupees(t.discounts.coupon)}` : '',
    t.discounts.perks ? `member perks such as free delivery from ZenWe Points or a member order discount ${rupees(t.discounts.perks)}` : '',
    t.discounts.sharedRide ? `shared-ride discounts ${rupees(t.discounts.sharedRide)}` : '',
    t.discounts.other ? `other discounts ${rupees(t.discounts.other)}` : '',
  ].filter(Boolean).join(', ');

  if (ok(t.collectedPaise) && ok(t.itemsPaise) && t.collectedPaise !== t.itemsPaise && t.orders > 0) {
    const diff = t.collectedPaise - t.itemsPaise;
    out.push(
      <>Customers paid <b>{rupees(Math.abs(diff))} {diff < 0 ? 'less' : 'more'}</b> than the item total ({rupees(t.itemsPaise)}): fees added {rupees(fees)}{feeParts ? ` (${feeParts})` : ''}
        {t.discountsPaise ? <> and discounts took off {rupees(t.discountsPaise)} ({discParts})</> : null}
        {t.refundsPaise ? <>; {rupees(t.refundsPaise)} was later refunded</> : null}.
        {t.discountsPaise ? ' ZenWe pays every discount: stores still get their full share.' : ''}</>,
    );
  }
  if (ok(t.keepsPaise) && ok(t.commissionPaise) && t.orders > 0) {
    out.push(
      <>ZenWe keeps {rupees(t.keepsPaise)} = commission {rupees(t.commissionPaise)} + fees {rupees(fees)} − discounts {rupees(t.discountsPaise)}
        {t.refundsPaise ? <> − refunds {rupees(t.refundsPaise)}</> : null}.</>,
    );
  }
  const nr = r.noRider;
  if (nr && nr.orders > 0) {
    const codes = nr.sample.slice(0, 6).map(o => o.orderCode).join(', ');
    const cod = nr.sample.some(o => o.channel === 'cod');
    out.push(
      <span className="text-warning-text">
        <b>{plural(nr.orders, 'order was', 'orders were')} marked delivered with no rider on {nr.orders === 1 ? 'it' : 'them'}</b>{codes ? ` (${codes}${nr.orders > 6 ? ', …' : ''})` : ''}.
        {cod ? ' Their cash is not on any rider\'s cash count: check who collected it.' : ' The money figures are not affected.'}
      </span>,
    );
  }
  if (t.stallCashPaise > 0) {
    out.push(<>Stalls collected {rupees(t.stallCashPaise)} in cash themselves. That cash never reached ZenWe, so it is taken off what they are owed; a stall can end up owing ZenWe its commission.</>);
  }
  if (t.counterPaidPaise > 0) {
    out.push(<>Riders paid shops {rupees(t.counterPaidPaise)} at the counter (buy-at-store orders). Those shops are already paid and take no commission.</>);
  }
  return out;
}

export function MoneyFlow({ report, loading }: { report: RevenueReport | null; loading: boolean }) {
  if (!report) {
    return (
      <Card className="mb-4">
        <CardBody className="grid gap-3 md:grid-cols-[1.2fr_auto_1fr_1fr_1fr] md:items-center">
          {[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-20 w-full" />)}
          {loading ? null : <p className="text-sm text-fg-muted">{MISSING}</p>}
        </CardBody>
      </Card>
    );
  }
  const t = report.totals;
  if (t.orders === 0) {
    return (
      <Card className="mb-4">
        <CardBody className="py-10 text-center">
          <p className="text-base font-semibold text-fg">No delivered orders in this period</p>
          <p className="mt-1 text-sm text-fg-muted">Money only counts once an order is delivered. Pick another day, week or month, or check Orders for orders still on the way.</p>
        </CardBody>
      </Card>
    );
  }
  const why = reasons(report);
  return (
    <Card className="mb-4">
      <CardHeader title="Money flow" description="Where the money customers paid for delivered orders goes." />
      <CardBody>
        <div className="grid items-stretch gap-3 md:grid-cols-3 lg:grid-cols-[1.15fr_auto_1fr_1fr]">
          <FlowBox
            label="Customers paid"
            paise={t.collectedPaise}
            tone="accent"
            tip="Everything customers paid for delivered orders: items + fees − discounts. Cash, Wallet and cash that stalls took themselves."
            sub={<>{plural(t.orders, 'order')}{channelText(t) ? ` · ${channelText(t)}` : ''}</>}
          />
          <div className="hidden items-center justify-center text-fg-subtle lg:flex" aria-hidden><IconArrowRight size={20} /></div>
          <FlowBox label="Stores get" paise={t.storeSharePaise} tip="Each store's item total minus ZenWe's commission. Paid to stores by statement (or already paid at the counter / kept as stall cash)." sub="item total − commission" />
          <FlowBox label="ZenWe keeps" paise={t.keepsPaise} tip="Commission + delivery fees + platform fees + packaging − discounts ZenWe paid − refunds. Delivery fees are ZenWe income." sub="commission + fees − discounts" />
        </div>
        {(t.refundsPaise !== 0 || t.discountsPaise !== 0) && (
          <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-fg-muted">
            {t.discountsPaise !== 0 && <span>Discounts ZenWe paid: <Money paise={t.discountsPaise} className="text-fg" /> <span className="text-fg-subtle">(already taken off what customers paid)</span></span>}
            {t.refundsPaise !== 0 && <span>Refunded to customers: <Money paise={t.refundsPaise} className="text-fg" /> <span className="text-fg-subtle">(ZenWe pays refunds)</span></span>}
          </div>
        )}
        <p className="mt-3 text-sm text-fg">
          Customers paid <b><Money paise={t.collectedPaise} /></b> for {plural(t.orders, 'delivered order')}.{' '}
          <b><Money paise={t.storeSharePaise} /></b> belongs to the stores{t.refundsPaise ? <>, <b><Money paise={t.refundsPaise} /></b> was refunded</> : null} and ZenWe keeps <b><Money paise={t.keepsPaise} /></b>.
        </p>
        <p className="mt-1 text-xs text-fg-subtle">Riders are not paid from delivery fees (rider pay is handled separately), so delivery fees count as ZenWe income here.</p>
        {why.length > 0 && (
          <div className="mt-3 rounded-md border border-line bg-surface-2/50 px-3 py-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-fg-subtle">Why the numbers differ</p>
            <ul className="mt-1 grid gap-1 text-sm text-fg-muted">
              {why.map((w, i) => <li key={i} className="flex gap-2"><span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-fg-subtle" aria-hidden /><span>{w}</span></li>)}
            </ul>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

/* ───────────────────────────────────────────── Health banner */

export function HealthBanner({ report, flags }: { report: RevenueReport | null; flags: string[] }) {
  const [open, setOpen] = useState(false);
  if (!report) return null;
  const rec = report.reconciliation;
  const t = report.totals;
  const items: ReactNode[] = [];

  if (flags.length > 0) {
    items.push(
      <div key="flags" role="alert" className="flex items-start gap-2.5 rounded-lg border border-danger/25 bg-danger-soft px-3 py-2.5 text-sm">
        <IconXCircle size={16} className="mt-0.5 shrink-0 text-danger-text" />
        <div className="min-w-0">
          <p className="font-medium text-fg">Some figures did not come through from the server ({flags.length}). They show as “{MISSING}”.</p>
          <p className="mt-0.5 text-fg-muted">Do not pay anyone from these numbers until a refresh shows them. Missing: <span className="font-mono text-xs">{flags.slice(0, 6).join(', ')}{flags.length > 6 ? ', …' : ''}</span></p>
        </div>
      </div>,
    );
  }

  if (t.orders > 0 || !rec.ok) {
    items.push(rec.ok ? (
      <div key="rec" role="status" className="flex items-start gap-2.5 rounded-lg border border-success/25 bg-success-soft px-3 py-2.5 text-sm">
        <IconCheckCircle size={16} className="mt-0.5 shrink-0 text-success-text" />
        <div>
          <p className="font-medium text-fg">All amounts balance ✓</p>
          <p className="mt-0.5 text-fg-muted">Checked order by order: what customers paid ({rupees(rec.collectedLessRefundsPaise)}{t.refundsPaise ? ' after refunds' : ''}) = stores + ZenWe ({rupees(rec.storeSharePlusKeepsPaise)}). Difference ₹0.00.</p>
        </div>
      </div>
    ) : (
      <div key="rec" role="alert" className="rounded-lg border border-danger/25 bg-danger-soft px-3 py-2.5 text-sm">
        <div className="flex items-start gap-2.5">
          <IconXCircle size={16} className="mt-0.5 shrink-0 text-danger-text" />
          <div className="min-w-0 flex-1">
            <p className="font-medium text-fg">
              {rec.mismatchedOrders > 0 ? `${plural(rec.mismatchedOrders, 'order doesn’t', 'orders don’t')} balance` : 'The amounts don’t balance'} – difference {rupees(rec.differencePaise)}
            </p>
            <p className="mt-0.5 text-fg-muted">For {rec.mismatchedOrders === 1 ? 'this order' : 'these orders'}, what the customer paid does not equal the parts of the bill. Nothing was adjusted. Check them in Orders before you pay the stores involved.</p>
            {rec.mismatches.length > 0 && (
              <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-danger-text hover:underline">
                {open ? <IconChevronUp size={13} /> : <IconChevronDown size={13} />}{open ? 'Hide the list' : 'See the list'}
              </button>
            )}
          </div>
        </div>
        {open && (
          <div className="mt-2 max-h-72 overflow-auto rounded-md border border-line bg-surface">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-surface-2 text-xs text-fg-muted">
                <tr><th className="px-3 py-1.5 text-left font-medium">Order</th><th className="px-3 py-1.5 text-left font-medium">Store</th><th className="px-3 py-1.5 text-right font-medium">Customer paid</th><th className="px-3 py-1.5 text-right font-medium">Difference</th><th className="hidden px-3 py-1.5 text-left font-medium lg:table-cell">Likely reason</th></tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rec.mismatches.map(m => (
                  <tr key={m.orderId || m.orderCode}>
                    <td className="px-3 py-1.5 font-mono text-xs">{m.orderCode}</td>
                    <td className="px-3 py-1.5">{m.storeName || MISSING}</td>
                    <td className="px-3 py-1.5 text-right"><Money paise={m.collectedPaise} /></td>
                    <td className="px-3 py-1.5 text-right"><Money paise={m.differencePaise} strong /></td>
                    <td className="hidden px-3 py-1.5 text-xs text-fg-muted lg:table-cell">{m.reason || MISSING}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rec.mismatchedOrders > rec.mismatches.length && <p className="px-3 py-1.5 text-xs text-fg-muted">…and {count(rec.mismatchedOrders - rec.mismatches.length)} more.</p>}
          </div>
        )}
      </div>
    ));
  }

  if (report.commissionEstimated.orders > 0) {
    items.push(
      <div key="est" className="flex items-start gap-2.5 rounded-lg border border-warning/30 bg-warning-soft px-3 py-2.5 text-sm">
        <IconAlert size={16} className="mt-0.5 shrink-0 text-warning-text" />
        <p className="text-fg">
          Includes {plural(report.commissionEstimated.orders, 'older order')} calculated at today&apos;s commission rate.{' '}
          <span className="text-fg-muted">They are from before ZenWe saved the rate on each order, so the rate at that time is not known. Newer orders use the rate fixed when they were placed.</span>
        </p>
      </div>,
    );
  }
  if (!items.length) return null;
  return <div className="mb-4 grid gap-2">{items}</div>;
}

/* ───────────────────────────────────────────── ZenWe earnings statement */

const LINE_TEXT: Record<string, { label: string; tip: string }> = {
  commission: { label: 'Commission from stores', tip: 'ZenWe’s cut of each store’s item total, at the rate fixed when the order was placed.' },
  deliveryFees: { label: 'Delivery fees', tip: 'Delivery fees on the bills are ZenWe income (riders are paid separately). Free-delivery discounts are a line below.' },
  platformFees: { label: 'Platform fees', tip: 'The fixed platform fee per order that customers pay ZenWe.' },
  packagingFees: { label: 'Packaging fees', tip: 'Packaging charged on bills. It stays with ZenWe (not passed on to stores).' },
  taxes: { label: 'Taxes on bills', tip: 'Taxes added to bills.' },
  discountCoupon: { label: 'Coupons', tip: 'Coupon savings customers got. ZenWe pays these, not the store.' },
  discountPerks: { label: 'Member perks', tip: 'Free delivery (200+ ZenWe Points, member tiers) and member order discounts. ZenWe pays these.' },
  discountSharedRide: { label: 'Shared-ride discounts', tip: 'Delivery discount when orders from one block share a rider. ZenWe pays these.' },
  discountOther: { label: 'Other discounts', tip: 'Any other discount on the bills. ZenWe pays these.' },
  refunds: { label: 'Refunds', tip: 'Money given back to customers on delivered orders. ZenWe pays refunds; store shares are not reduced.' },
};

export function EarningsStatement({ report }: { report: RevenueReport }) {
  const t = report.totals;
  const plus = report.keepsLines.filter(l => l.sign === 1);
  const minus = report.keepsLines.filter(l => l.sign === -1);
  const row = (l: RevenueReport['keepsLines'][number]) => {
    const txt = LINE_TEXT[l.key] || { label: l.label, tip: l.label };
    const extra = '';
    return (
      <div key={l.key} className="flex items-baseline justify-between gap-3 py-1.5">
        <span className="flex min-w-0 items-center gap-1 text-fg-muted">{l.sign === -1 ? 'minus ' : ''}{txt.label}{extra && <span className="text-xs text-fg-subtle">{extra}</span>}<Tip text={txt.tip} /></span>
        <Money paise={l.paise} className={l.paise === 0 ? 'text-fg-subtle' : 'text-fg'} neutral={l.sign === -1} />
      </div>
    );
  };
  return (
    <Card className="mb-4">
      <CardHeader title="What ZenWe earns" description="ZenWe keeps = money in − money out, line by line." />
      <CardBody className="grid gap-x-8 text-sm md:grid-cols-2">
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-fg-subtle">Money in</p>
          <div className="divide-y divide-line">{plus.map(row)}</div>
        </div>
        <div>
          <p className="mb-1 mt-3 text-xs font-semibold uppercase tracking-wide text-fg-subtle md:mt-0">Money out (ZenWe pays)</p>
          <div className="divide-y divide-line">{minus.map(row)}</div>
          <p className="mt-2 text-xs text-fg-subtle">Riders are not paid from delivery fees (handled separately), so there is no rider line here.</p>
        </div>
        <div className="mt-2 flex items-baseline justify-between gap-3 border-t border-line-strong pt-2 md:col-span-2">
          <span className="font-semibold text-fg">ZenWe keeps</span>
          <Money paise={t.keepsPaise} strong className="text-base" />
        </div>
        {report.context.riderCashHeldNowPaise !== null && report.context.riderCashHeldNowPaise > 0 && (
          <p className="mt-2 text-xs text-fg-subtle md:col-span-2">
            Separately: riders are holding {rupees(report.context.riderCashHeldNowPaise)} of cash-on-delivery money right now (all days, not just this period). Collect it in Payments and payouts &gt; Rider cash.
          </p>
        )}
        {report.excluded.testOrders > 0 && <p className="mt-1 text-xs text-fg-subtle md:col-span-2">{plural(report.excluded.testOrders, 'test order')} (owner test stores) left out of every number.</p>}
      </CardBody>
    </Card>
  );
}

/* ───────────────────────────────────────────── Help */

export function HelpDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const items: [string, string][] = [
    ['Customers paid', 'Everything customers paid for delivered orders: the items, plus delivery, platform and packaging fees, minus discounts. Cash, Wallet, and cash that stalls took themselves.'],
    ['Commission', 'ZenWe’s cut of each store’s item total. The rate is fixed when the order is placed, so changing a store’s rate later never changes old orders.'],
    ['Stores get', 'Item total minus commission. This is what ZenWe owes each store. Discounts and fees never come out of it.'],
    ['ZenWe keeps', 'Commission + delivery fees + platform fees + packaging − discounts ZenWe paid − refunds. Delivery fees are ZenWe’s income; riders are paid separately, not from here.'],
    ['Balance check', 'For every order, what the customer paid must equal what the store gets + what ZenWe keeps. If any order is off, the page lists it in red. Don’t pay from a red page until you’ve checked.'],
    ['Payment details', 'Each store needs a UPI ID or a bank account before you can mark it paid. Add them with “Payment details” in the store table. Account numbers are shown as ••••1234; Show reveals the full number (recorded).'],
    ['Cycles', 'Each store is paid Daily, Weekly (Mon–Sun) or Monthly. Change it in the store table. The app never sends money: you pay by UPI or bank yourself.'],
    ['Cutoffs and statements', '“Create statements” takes every delivered order not yet on a statement up to the cutoff (yesterday, last Sunday, or the end of last month, 11:59 pm IST). Pay each store, then press Mark paid and type the UTR / UPI reference.'],
  ];
  return (
    <Drawer open={open} onClose={onClose} title="How Revenue works" description="Eight short points. All times are India time (IST)." size="md">
      <ol className="grid gap-3 text-sm">
        {items.map(([h, b], i) => (
          <li key={h} className="flex gap-3">
            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-surface-2 text-xs font-semibold tabular-nums text-fg-muted">{i + 1}</span>
            <div><p className="font-medium text-fg">{h}</p><p className="mt-0.5 text-fg-muted">{b}</p></div>
          </li>
        ))}
      </ol>
    </Drawer>
  );
}
