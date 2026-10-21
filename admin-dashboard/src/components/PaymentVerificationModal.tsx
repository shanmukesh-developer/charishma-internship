/* eslint-disable @next/next/no-img-element */
"use client";
import { useConfirm } from '@/components/ui';
import { useEffect, useState } from 'react';


interface PaymentVerificationModalProps {
  isOpen: boolean;
  onClose: () => void;
  order: {
    id: string;
    customer: string;
    upiUTR?: string;
    upiScreenshot?: string;
    price: number;
  } | null;
  /** Resolves to an error message on failure (modal stays open), or null on success. */
  onVerify: (orderId: string, isVerified: boolean) => Promise<string | null>;
}

export default function PaymentVerificationModal({ isOpen, onClose, order, onVerify }: PaymentVerificationModalProps) {
  const confirm = useConfirm();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    setError(null);
    setImageFailed(false);
  }, [order?.id]);

  if (!isOpen || !order) return null;

  const handleAction = async (isVerified: boolean) => {
    if (loading) return;
    if (!isVerified && !(await confirm({ title: 'Reject this payment?', description: 'The order will be cancelled.', confirmLabel: 'Reject payment', tone: 'danger' }))) return;
    setLoading(true);
    setError(null);
    const failure = await onVerify(order.id, isVerified);
    setLoading(false);
    if (failure) setError(failure);
    else onClose();
  };

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center p-6 bg-scrim/50 animate-in fade-in duration-300">
      <div className="bg-surface border border-line w-full max-w-xl rounded-lg overflow-hidden shadow-pop animate-in zoom-in-95 duration-300">
        <div className="p-8 border-b border-line flex justify-between items-center bg-surface-2/60">
          <div>
            <h2 className="text-xl font-semibold text-fg">Verify UPI payment</h2>
            <p className="text-xs text-fg-muted font-semibold mt-1">Order #{order.id.slice(-8)}</p>
          </div>
          <button onClick={onClose} className="w-10 h-10 rounded-full bg-surface-2/60 border border-line flex items-center justify-center text-fg-muted hover:text-fg transition-all" aria-label="Dismiss"><span aria-hidden="true" className="text-base leading-none">×</span></button>
        </div>

        <div className="p-8 space-y-8">
          <div className="grid grid-cols-2 gap-8">
            <div className="space-y-1">
              <p className="text-xs font-semibold text-info-text">Customer</p>
              <p className="text-lg font-semibold text-fg">{order.customer}</p>
            </div>
            <div className="space-y-1 text-right">
              <p className="text-xs font-semibold text-info-text">Amount</p>
              <p className="text-lg font-semibold text-fg">₹{order.price.toFixed(2)}</p>
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-xs font-semibold text-fg-muted">UTR Reference</p>
            <div className="bg-surface-2/60 p-4 rounded-lg border border-line font-mono text-sm text-info-text">
              {order.upiUTR || 'No UTR provided'}
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-xs font-semibold text-fg-muted">Payment screenshot</p>
            <div className="aspect-video bg-surface-2 rounded-lg border border-line overflow-hidden relative group">
              {order.upiScreenshot && !imageFailed ? (
                <img 
                  src={order.upiScreenshot} 
                  alt="Payment Screenshot" 
                  className="w-full h-full object-contain cursor-zoom-in transition-transform duration-500" 
                  onClick={() => { if (/^https?:\/\//i.test(order.upiScreenshot!)) window.open(order.upiScreenshot!, '_blank', 'noopener,noreferrer'); }}
                  onError={() => setImageFailed(true)}
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-fg-muted text-xs">
                  {order.upiScreenshot ? 'The screenshot could not be loaded.' : 'No screenshot uploaded.'}
                </div>
              )}
            </div>
          </div>
        </div>

        {error && (
          <p role="alert" className="mx-8 mb-6 rounded-xl border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger-text">{error}</p>
        )}

        <div className="p-8 bg-surface-2/60 border-t border-line flex gap-4">
          <button
            disabled={loading}
            onClick={() => handleAction(false)}
            className="flex-1 py-4 bg-danger-soft border border-danger/30 text-danger-text rounded-lg text-xs font-semibold hover:bg-danger/90 hover:text-fg transition-all disabled:opacity-30"
          >
            Reject Payment
          </button>
          <button
            disabled={loading}
            onClick={() => handleAction(true)}
            className="flex-[2] py-4 bg-success rounded-lg text-xs font-semibold text-on-solid hover:scale-[1.02] transition-all disabled:opacity-30"
          >
            {loading ? 'Saving...' : 'Mark payment verified'}
          </button>
        </div>
      </div>
    </div>
  );
}
