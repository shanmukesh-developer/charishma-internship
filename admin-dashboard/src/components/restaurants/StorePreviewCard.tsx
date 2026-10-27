"use client";
import { useState } from 'react';
import { formatTime, formatWhatsapp } from '@/app/restaurants/catalogue';
import { Segmented, cx } from './ui';

export interface PreviewData {
  name: string;
  imageUrl?: string | null;
  tags: string[];
  description?: string | null;
  deliveryTime?: number | null;
  isOpen: boolean;
  opensAt?: string | null;
  rating?: number | null;
  isFeatured?: boolean;
  featuredBadge?: string | null;
  promoOffer?: string | null;
  isLocal?: boolean;
  whatsappNumber?: string | null;
  logoUrl?: string | null;
  brand?: { primaryColor?: string; secondaryColor?: string; accentColor?: string; logoUrl?: string } | null;
}

/**
 * Mirrors the restaurant card on the customer app's Home grid (customer-mobile/app/(tabs)/index.tsx):
 * open/closed pill, promoted badge, time chip, offer ribbon, NEW / rating badge and cuisine line.
 */
export function StorePreviewCard({ data, showToggle = true }: { data: PreviewData; showToggle?: boolean }) {
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const dark = theme === 'dark';
  const rating = Number(data.rating) || 0;
  const time = data.deliveryTime ? `${data.deliveryTime} min` : null;
  const cuisine = data.tags.slice(0, 3).join(', ') || data.description || '';
  const offer = data.promoOffer?.trim() || null;
  return (
    <div className="space-y-3">
      {showToggle && (
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-semibold text-fg-muted">Customer app preview</p>
          <Segmented size="sm" label="Preview theme" value={theme} onChange={setTheme} options={[{ value: 'dark', label: 'Dark' }, { value: 'light', label: 'Light' }]} />
        </div>
      )}
      <div className={cx('rounded-lg p-3', dark ? 'bg-surface' : 'bg-surface')}>
        <div
          className={cx('w-[210px] overflow-hidden rounded-lg', dark ? 'bg-surface' : 'bg-white', data.isFeatured ? 'border-[1.5px] border-warning/30' : dark ? 'border border-line' : 'border border-line')}
          aria-label={`Preview of ${data.name || 'the store'} as customers see it`}
        >
          <div className="relative h-[120px] w-full overflow-hidden rounded-lg bg-surface-2">
            {data.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={data.imageUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-surface-2 text-xs text-fg-muted">No cover photo yet</div>
            )}
            <span className={cx('absolute left-2 top-2 flex items-center gap-1 rounded-md px-1.5 py-[3px] text-[7.5px] font-semibold text-fg', data.isOpen ? 'bg-success-soft' : 'bg-surface-3')}>
              <span className="h-[5px] w-[5px] rounded-full bg-white" />{data.isOpen ? 'OPEN' : 'CLOSED'}
            </span>
            {data.isFeatured && (
              <span className="absolute right-9 top-2 rounded-md bg-surface-2 px-1.5 py-[2.5px] text-[7px] font-semibold text-accent-fg">✨ {(data.featuredBadge || 'PROMOTED').toUpperCase()}</span>
            )}
            <span className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-surface-2 text-xs"></span>
            {!data.isLocal && (time || !data.isOpen) && (
              <span className="absolute bottom-2 right-2 rounded-md bg-surface-2 px-1.5 py-0.5 text-xs font-semibold text-fg">
                {data.isOpen ? time : data.opensAt ? `OPENS ${formatTime(data.opensAt)}` : 'CLOSED NOW'}
              </span>
            )}
            {!data.isOpen && <div className="absolute inset-0 rounded-lg bg-surface-2" />}
            {offer && (
              <span className={cx('absolute bottom-2 left-0 max-w-[70%] truncate rounded-r-md px-2 py-0.5 text-xs font-semibold', data.isFeatured ? 'bg-accent text-accent-fg' : 'bg-surface text-fg')}>{offer.toUpperCase()}</span>
            )}
          </div>
          <div className="px-2.5 pb-2.5 pt-2">
            <div className="flex items-center justify-between gap-2">
              {(data.logoUrl || data.brand?.logoUrl) && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={(data.logoUrl || data.brand?.logoUrl) as string} alt="" className="h-5 w-5 shrink-0 rounded-full border border-line bg-white object-cover" />
              )}
              <p className={cx('min-w-0 flex-1 truncate text-sm font-semibold', dark ? 'text-fg' : 'text-fg-subtle')}>{data.name || 'Store name'}</p>
              <span className="flex shrink-0 items-center gap-0.5 rounded-md bg-success px-1.5 py-0.5 text-xs font-semibold text-on-solid">
                {rating > 0 ? <>{rating.toFixed(1)} ★</> : 'NEW'}
              </span>
            </div>
            {cuisine && <p className={cx('mt-0.5 truncate text-[10.5px]', dark ? 'text-fg-muted' : 'text-fg-muted')}>{cuisine}</p>}
            {offer && (
              <p className={cx('mt-1.5 flex items-center gap-1 truncate border-t border-dashed pt-1.5 text-[9.5px] font-semibold', dark ? 'border-line text-fg-muted' : 'border-line text-fg-muted')}>🏷️ {offer}</p>
            )}
            {data.isLocal && (
              <p className={cx('mt-1.5 truncate text-[9.5px] font-semibold', dark ? 'text-success-text' : 'text-success-text')}>Cash on delivery · stall delivers</p>
            )}
          </div>
        </div>
      </div>
      {data.isLocal && (
        <p className="text-xs text-fg-muted">Local stalls appear in the CampusBites section. Customers order in ZCS and pay cash; the stall gets the order in ZCS Vendor{data.whatsappNumber ? ` and can be reached on ${formatWhatsapp(data.whatsappNumber)}` : ''}.</p>
      )}
      {data.brand && (
        <div className="flex items-center gap-2 text-xs text-fg-muted">
          <span className="h-4 w-4 rounded" style={{ background: `linear-gradient(135deg, ${data.brand.primaryColor || '#1A0000'}, ${data.brand.secondaryColor || '#111'})` }} />
          Store page uses the brand colours.
        </div>
      )}
    </div>
  );
}
