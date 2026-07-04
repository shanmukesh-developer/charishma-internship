import React from 'react';
import { motion } from 'framer-motion';

export function OrderDetailModal({ order, onClose }: { order: any; onClose: () => void }) {
  if (!order) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl"
      >
        <div className="p-6 border-b border-zinc-800 flex justify-between items-center bg-zinc-950">
          <div>
            <h3 className="text-xl font-bold text-white">Order #{String(order.id || order._id).slice(-6).toUpperCase()}</h3>
            <p className="text-xs text-zinc-500 mt-1">{new Date(order.createdAt).toLocaleString()}</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full bg-zinc-800 hover:bg-zinc-700 text-white">
            ✕
          </button>
        </div>
        
        <div id="printable-receipt" className="p-6 max-h-[60vh] overflow-y-auto space-y-6 bg-white text-black print:p-0 print:max-h-none print:bg-white print:text-black">
          <div className="space-y-4">
            <h4 className="text-[10px] font-black uppercase text-zinc-500 tracking-widest print:text-black">Order Items</h4>
            <div className="bg-zinc-950 rounded-xl p-4 border border-zinc-800/50 space-y-3 print:border-none print:p-0 print:bg-white">
              {order.items.map((item: any, i: number) => (
                <div key={i} className="flex justify-between items-center text-sm">
                  <span className="text-zinc-300 print:text-black">
                    <span className="text-orange-500 mr-2 font-bold print:text-black">{item.quantity}x</span> 
                    {item.name}
                  </span>
                  <span className="text-zinc-500 print:text-black">₹{item.price * item.quantity}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 print:grid-cols-1 print:gap-2">
             {/* Customer */}
             <div>
               <h4 className="text-[10px] font-black uppercase text-zinc-500 tracking-widest mb-2 print:text-black">Customer</h4>
               <div className="bg-zinc-950 rounded-xl p-4 border border-zinc-800/50 flex flex-col justify-center min-h-[76px] print:border-none print:p-0 print:bg-white print:min-h-0">
                  {order.user ? (
                     <>
                        <span className="text-sm font-bold text-white print:text-black">{order.user.name}</span>
                        {order.user.phone && <span className="text-xs text-zinc-500 mt-1 font-mono print:text-black">{order.user.phone}</span>}
                     </>
                  ) : (
                     <span className="text-xs text-zinc-500 italic print:text-black">No details</span>
                  )}
               </div>
             </div>
             
             {/* Delivery Partner */}
             <div>
               <h4 className="text-[10px] font-black uppercase text-zinc-500 tracking-widest mb-2 print:text-black">Delivery Partner</h4>
               <div className="bg-zinc-950 rounded-xl p-4 border border-zinc-800/50 flex flex-col justify-center min-h-[76px] print:border-none print:p-0 print:bg-white print:min-h-0">
                 {order.deliveryPartnerName ? (
                   <>
                     <span className="text-sm font-bold text-blue-400 print:text-black">{order.deliveryPartnerName}</span>
                     {order.deliveryPartner?.phone && <span className="text-xs text-zinc-500 mt-1 font-mono print:text-black">{order.deliveryPartner.phone}</span>}
                   </>
                 ) : (
                   <span className="text-xs text-zinc-500 italic print:text-black">Assigning...</span>
                 )}
               </div>
             </div>
             
             {/* Payment Details */}
             <div className="md:col-span-2 print:col-span-1">
               <h4 className="text-[10px] font-black uppercase text-zinc-500 tracking-widest mb-2 print:text-black">Payment Details</h4>
               <div className="bg-zinc-950 rounded-xl p-4 border border-zinc-800/50 flex justify-between items-center print:border-none print:p-0 print:bg-white">
                 <div className="flex flex-col">
                    <span className="text-xs text-zinc-500 print:text-black">Method</span>
                    <span className="text-sm font-bold text-white print:text-black">{order.paymentMethod}</span>
                 </div>
                 <div className="flex flex-col items-end">
                    <span className="text-xs text-zinc-500 print:text-black">Total</span>
                    <span className="text-xl font-black text-orange-500 print:text-black">₹{order.totalPrice}</span>
                 </div>
               </div>
             </div>
          </div>
        </div>

        <div className="p-4 border-t border-zinc-800 bg-zinc-950 flex justify-between print-hide">
          <button 
            onClick={() => window.print()} 
            className="px-6 py-2 bg-orange-500/20 text-orange-500 font-bold rounded-xl text-sm hover:bg-orange-500/30 transition-colors border border-orange-500/30"
          >
            🖨️ Print Receipt
          </button>
          <button onClick={onClose} className="px-6 py-2 bg-white text-black font-bold rounded-xl text-sm hover:bg-zinc-200 transition-colors">
            Close
          </button>
        </div>
      </motion.div>
    </div>
  );
}
