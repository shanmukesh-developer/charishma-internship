"use client";
import { useState } from 'react';

const CAMPUS_SLOTS = [
  { id: '1:00 PM', time: '13:00', label: 'Lunch Rush', desc: 'Peak energy delivery for hostelers.' },
  { id: '5:00 PM', time: '17:00', label: 'Post-Class', desc: 'Evening snacks and refreshers.' },
  { id: '7:30 PM', time: '19:30', label: 'Dinner Peak', desc: 'Primary dinner delivery window.' },
  { id: '8:50 PM', time: '20:50', label: 'Last Call', desc: 'Final doorstep delivery of the day.' },
  { id: '9:30 PM', time: '21:30', label: 'Gate Drop', desc: 'Night mode. Pickup at Hostel Gate.' },
];

export default function TemporalSlider() {
  const [activeIdx, setActiveIdx] = useState(0);

  return (
    <div className="relative py-8 overflow-hidden group">
      {/* Cinematic Backdrop */}
      <div className="absolute inset-0 bg-gradient-to-r from-[#C9A84C]/[0.03] to-transparent rounded-[35px] -z-10" />
      
      <div className="flex items-center justify-between mb-8 px-2">
         <div>
            <h3 className="text-[10px] font-black uppercase tracking-[0.3em] text-[#C9A84C] mb-1">Temporal Navigator</h3>
            <p className="text-[7px] font-bold text-secondary-text uppercase tracking-widest italic ">Predictive Batching Activated</p>
         </div>
         <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-[#C9A84C] animate-pulse" />
            <span className="text-[8px] font-black uppercase tracking-widest text-[#C9A84C]">Live System</span>
         </div>
      </div>

      {/* The Slider Interface */}
      <div className="relative flex items-center justify-between gap-4 px-2">
         {CAMPUS_SLOTS.map((slot, idx) => {
           const isActive = activeIdx === idx;
           
           return (
             <button 
               key={slot.id}
               onClick={() => setActiveIdx(idx)}
               className={`flex flex-col items-center gap-3 transition-all duration-500 relative group/btn ${isActive ? 'scale-110' : 'opacity-30 hover:opacity-100'}`}
             >
                <div className={`w-10 h-10 rounded-2xl flex items-center justify-center transition-all duration-500 border ${isActive ? 'bg-[#C9A84C] border-[#C9A84C] shadow-[0_0_20px_rgba(201,168,76,0.3)]' : 'bg-white/5 border-white/10'}`}>
                   <span className={`text-[10px] font-black ${isActive ? 'text-black' : 'text-white light:text-gray-900'}`}>{slot.id.split(' ')[0]}</span>
                </div>
                {isActive && (
                  <div className="absolute -bottom-2 w-1 h-1 bg-[#C9A84C] rounded-full" />
                )}
             </button>
           );
         })}
      </div>

      {/* Info Card (Cinematic Reveal) */}
      <div className="mt-10 p-6 glass-card border-white/[0.05] animate-page relative overflow-hidden">
         <div className="absolute top-[-20%] right-[-10%] w-32 h-32 bg-[#C9A84C]/5 blur-3xl rounded-full" />
         
         <div className="flex justify-between items-start relative z-10">
            <div>
               <p className="text-[8px] font-black uppercase tracking-[0.4em] text-[#C9A84C] mb-2">{CAMPUS_SLOTS[activeIdx].label}</p>
               <h4 className="text-lg font-black text-white light:text-gray-900 italic tracking-tighter mb-1">{CAMPUS_SLOTS[activeIdx].id} Window</h4>
               <p className="text-[10px] font-medium text-secondary-text max-w-[200px] leading-relaxed italic">{CAMPUS_SLOTS[activeIdx].desc}</p>
            </div>
            <div className="text-right">
               <span className="text-[8px] font-black text-secondary-text uppercase tracking-widest block mb-4">Batch Capacity</span>
               <div className="flex gap-1 justify-end">
                  {[1,2,3,4,5].map(i => (
                    <div key={i} className={`w-1 h-6 rounded-full transition-colors duration-500 ${i <= 3 ? 'bg-[#C9A84C]' : 'bg-white/5'}`} />
                  ))}
               </div>
            </div>
         </div>
         
         <div className="mt-6 flex justify-between items-center bg-white/[0.02] -mx-6 -mb-6 p-4 px-6 border-t border-white/5">
            <span className="text-[8px] font-black text-secondary-text uppercase tracking-widest">Pre-order status</span>
            <span className="text-[9px] font-black text-emerald-500 uppercase tracking-widest">Open</span>
         </div>
      </div>

      <style dangerouslySetInnerHTML={{ __html: `
        .slider-thumb::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 24px;
          height: 24px;
          background: #C9A84C;
          border-radius: 50%;
          cursor: pointer;
          box-shadow: 0 0 20px rgba(201, 168, 76, 0.5);
          border: 2px solid white;
        }
      `}} />
    </div>
  );
}
