"use client";
import { useState } from 'react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (rating: number, review: string, tipAmount: number) => void;
}

const TIP_OPTIONS = [
  { label: '₹5', value: 5 },
  { label: '₹10', value: 10 },
  { label: '₹20', value: 20 },
];

export default function RatingModal({ isOpen, onClose, onSubmit }: Props) {
  const [rating, setRating] = useState(0);
  const [review, setReview] = useState('');
  const [tip, setTip] = useState<number | null>(null);
  const [customTip, setCustomTip] = useState('');
  const [showCustomTip, setShowCustomTip] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  if (!isOpen) return null;

  const finalTip = showCustomTip ? (parseFloat(customTip) || 0) : (tip || 0);

  const handleSubmit = () => {
    if (rating === 0) return;
    onSubmit(rating, review, finalTip);
    setSubmitted(true);
    setTimeout(() => onClose(), 2500);
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-end justify-center bg-black/80 backdrop-blur-md" style={{ pointerEvents: 'auto' }}>
      {/* Mobile bottom sheet */}
      <div className="w-full max-w-lg bg-[#141416] border border-white/10 rounded-t-[32px] p-6 pb-10 shadow-2xl relative overflow-hidden pointer-events-auto animate-in slide-in-from-bottom duration-300">
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-emerald-500 via-primary-yellow to-emerald-500" />
        {/* Drag indicator */}
        <div className="w-12 h-1 bg-white/20 rounded-full mx-auto mb-6" />

        {!submitted ? (
          <>
            {/* Header */}
            <div className="text-center mb-6">
              <div className="w-16 h-16 bg-emerald-500/10 rounded-full flex items-center justify-center text-3xl mx-auto mb-3 animate-bounce">
                🎉
              </div>
              <h2 className="text-lg font-black text-white">Meal Delivered!</h2>
              <p className="text-white/50 text-xs mt-1 font-bold">How was your Zenvy Captain?</p>
            </div>

            {/* Stars — large tap targets for mobile */}
            <div className="flex justify-center gap-3 mb-6">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  type="button"
                  onClick={() => setRating(star)}
                  className={`text-4xl transition-transform active:scale-90 select-none ${
                    rating >= star ? 'text-primary-yellow' : 'text-white/20'
                  }`}
                >
                  ★
                </button>
              ))}
            </div>

            {/* Review */}
            <textarea
              value={review}
              onChange={(e) => setReview(e.target.value)}
              placeholder="Any feedback? (Optional)"
              className="w-full bg-white/5 border border-white/10 rounded-2xl p-4 text-white text-sm outline-none focus:border-emerald-500/50 transition-all h-20 mb-5 resize-none"
            />

            {/* Tip Section */}
            <div className="mb-6">
              <p className="text-[10px] font-black text-white/40 uppercase tracking-widest mb-3">
                🛵 Tip your rider (goes directly to them)
              </p>
              <div className="flex gap-2">
                {TIP_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => { setTip(opt.value); setShowCustomTip(false); setCustomTip(''); }}
                    className={`flex-1 py-3 rounded-2xl text-sm font-black transition-all active:scale-95 border ${
                      tip === opt.value && !showCustomTip
                        ? 'bg-[#C9A84C]/20 border-[#C9A84C] text-[#C9A84C]'
                        : 'bg-white/5 border-white/10 text-white/60'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => { setShowCustomTip(true); setTip(null); }}
                  className={`flex-1 py-3 rounded-2xl text-sm font-black transition-all active:scale-95 border ${
                    showCustomTip
                      ? 'bg-[#C9A84C]/20 border-[#C9A84C] text-[#C9A84C]'
                      : 'bg-white/5 border-white/10 text-white/60'
                  }`}
                >
                  Custom
                </button>
              </div>
              {showCustomTip && (
                <input
                  type="number"
                  inputMode="numeric"
                  value={customTip}
                  onChange={(e) => setCustomTip(e.target.value)}
                  placeholder="Enter amount ₹"
                  className="mt-2 w-full bg-white/5 border border-[#C9A84C]/40 rounded-2xl px-4 py-3 text-white text-sm outline-none font-bold"
                />
              )}
              {finalTip > 0 && (
                <p className="text-[10px] text-emerald-400 font-black uppercase tracking-widest mt-2 text-center">
                  ₹{finalTip} tip selected ✓
                </p>
              )}
            </div>

            {/* Actions */}
            <div className="flex gap-3">
              <button
                onClick={onClose}
                className="flex-1 py-4 text-white/40 font-black uppercase tracking-widest text-[10px] bg-white/5 rounded-2xl active:scale-95 transition-transform"
              >
                Skip
              </button>
              <button
                onClick={handleSubmit}
                disabled={rating === 0}
                className="flex-[2] bg-emerald-600 disabled:bg-white/10 disabled:text-white/20 py-4 rounded-2xl text-white font-black uppercase tracking-widest text-[10px] transition-all active:scale-95"
              >
                Submit Review
              </button>
            </div>
          </>
        ) : (
          <div className="text-center py-8 animate-in fade-in zoom-in duration-500">
            <div className="w-20 h-20 bg-emerald-500 rounded-full flex items-center justify-center text-4xl mx-auto mb-4 text-black shadow-[0_0_30px_rgba(16,185,129,0.4)]">
              ✓
            </div>
            <h2 className="text-lg font-black text-white">Thank You!</h2>
            <p className="text-white/50 text-xs mt-1 font-bold">Your feedback helps us be better.</p>
            <div className="mt-4 flex flex-col items-center gap-2">
              <span className="text-[10px] text-emerald-500 font-black uppercase tracking-widest animate-pulse">+10 ZenPoints Earned</span>
              {finalTip > 0 && (
                <span className="text-[10px] text-[#C9A84C] font-black uppercase tracking-widest">₹{finalTip} tip sent to rider 🛵</span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
