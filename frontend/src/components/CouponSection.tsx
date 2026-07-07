"use client";
import { motion } from 'framer-motion';

const COUPONS = [
  { code: 'ZENVYNEW', disc: '₹100 OFF', desc: 'First order reward', color: 'from-emerald-500/20 to-emerald-900/10' },
  { code: 'SRMFREE', disc: 'FREE DEL', desc: 'Min. order ₹249', color: 'from-[#C9A84C]/20 to-[#C9A84C]/5' },
  { code: 'NIGHTOWL', disc: '15% OFF', desc: 'Orders after 9 PM', color: 'from-purple-500/20 to-purple-900/10' },
  { code: 'BINGE25', disc: '25% OFF', desc: 'Mega party orders', color: 'from-orange-500/20 to-orange-500/5' },
];

export default function CouponSection() {
  const copyCoupon = (code: string) => {
    navigator.clipboard.writeText(code);
    // Could add a toast here
  };

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between px-2">
        <div>
          <h3 className="text-[10px] font-black uppercase tracking-[0.3em] text-primary-yellow">Gourmet Pass</h3>
          <h2 className="text-lg font-black text-white light:text-gray-900 uppercase">Active Coupons</h2>
        </div>
        <span className="text-[8px] font-bold text-secondary-text uppercase tracking-widest underline cursor-pointer">View All</span>
      </div>

      <div className="flex gap-4 overflow-x-auto scrollbar-hide pb-2 -mx-2 px-2">
        {COUPONS.map((cp, i) => (
          <motion.div 
            key={cp.code}
            initial={{ opacity: 0, x: 20 }}
            whileInView={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.1 }}
            viewport={{ once: true }}
            className={`shrink-0 w-64 p-6 rounded-[32px] border border-white/5 bg-gradient-to-br ${cp.color} relative overflow-hidden group`}
          >
            <div className="absolute -top-10 -right-10 w-24 h-24 bg-white/5 rounded-full blur-2xl group-hover:scale-150 transition-transform duration-700" />
            
            <div className="relative z-10">
              <span className="text-[9px] font-black text-primary-yellow uppercase tracking-widest">{cp.desc}</span>
              <h4 className="text-2xl font-black text-white light:text-gray-900 mt-1 mb-4">{cp.disc}</h4>
              
              <div className="flex items-center justify-between bg-black/40 backdrop-blur-md p-3 rounded-2xl border border-white/5">
                <span className="text-[11px] font-black tracking-widest text-[#C9A84C]">{cp.code}</span>
                <button 
                  onClick={() => copyCoupon(cp.code)}
                  className="text-[9px] font-black uppercase text-white light:text-gray-900/40 hover:text-white light:text-gray-900 transition-colors"
                >
                  Copy
                </button>
              </div>
            </div>
            
            {/* Cutout dots like a real ticket */}
            <div className="absolute left-0 top-1/2 -translate-y-1/2 w-4 h-8 bg-background rounded-r-full -ml-2 border-r border-white/5" />
            <div className="absolute right-0 top-1/2 -translate-y-1/2 w-4 h-8 bg-background rounded-l-full -mr-2 border-l border-white/5" />
          </motion.div>
        ))}
      </div>
    </section>
  );
}
