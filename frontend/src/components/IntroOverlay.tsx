"use client";
import { useEffect, useState } from 'react';

export default function IntroOverlay({ onComplete }: { onComplete: () => void }) {
  const [stage, setStage] = useState(0);

  useEffect(() => {
    // Lock body scroll while intro is visible
    document.body.style.overflow = 'hidden';

    // 🎞️ "Absolute Richness" Cinematic Pacing (Continuous hyper-smooth viscous drift)
    const timers = [
      setTimeout(() => setStage(1), 300),   // Stage 1: Darkness -> Ambient Liquid gradients drift in
      setTimeout(() => setStage(2), 1500),  // Stage 2: 🕯️ Slow burn lens flare glows continuous behind
      setTimeout(() => setStage(3), 3200),  // Stage 3: Noble 3D Glass Crest & Typography crystalize (Slightly slower)
      setTimeout(() => setStage(4), 5000),  // Stage 4: Continuous Aperture forward scale Drive
      setTimeout(() => {
        document.body.style.overflow = '';
        onComplete();
      }, 6200) 
    ];

    return () => {
      document.body.style.overflow = '';
      timers.forEach(clearTimeout);
    };
  }, []);

  // 🎇 Enhanced 15-Particle dense drift (Slowed deceleration for expensive motion feel)
  const embers = [
    { left: '12%', top: '80%', size: '3px', delay: '0s', duration: '15s' },
    { left: '22%', top: '70%', size: '1px', delay: '2s', duration: '19s' },
    { left: '38%', top: '90%', size: '2px', delay: '1s', duration: '13s' },
    { left: '55%', top: '65%', size: '1.5px', delay: '3.5s', duration: '17s' },
    { left: '62%', top: '85%', size: '3px', delay: '2s', duration: '14s', blur: '1px' },
    { left: '78%', top: '75%', size: '2px', delay: '4s', duration: '16s' },
    { left: '88%', top: '80%', size: '1px', delay: '0.8s', duration: '20s' },
    { left: '15%', top: '55%', size: '3.5px', delay: '3s', duration: '12s' },
    { left: '82%', top: '60%', size: '2px', delay: '1.2s', duration: '18s', blur: '1px' },
    { left: '48%', top: '50%', size: '1px', delay: '5s', duration: '20s' },
    { left: '32%', top: '40%', size: '2px', delay: '2.2s', duration: '15s' },
    { left: '18%', top: '35%', size: '1.5px', delay: '1.6s', duration: '17s' },
    { left: '68%', top: '30%', size: '2.5px', delay: '4.4s', duration: '14s' },
    { left: '28%', top: '25%', size: '2.5px', delay: '0.4s', duration: '13s', blur: '1.5px' },
    { left: '72%', top: '20%', size: '1px', delay: '3.8s', duration: '19s' }
  ];

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100%',
        height: '100dvh',
        zIndex: 999999,
        backgroundColor: '#010101', // Pure Black slate to make gold pop heavier
        overflow: 'hidden',
        perspective: '1500px',
        transitionDuration: '1300ms'
      }}
      className={`transition-all ${stage >= 4 ? 'opacity-0 scale-[1.04] blur-md' : 'opacity-100 scale-100'}`}
    >
      {/* 🔮 Deep Cinematic Atmospheric Drift (Slow slow nebula) */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        
        {/* Core Amber Nebula Backglow (Consolidation drift breathing) */}
        <div 
          style={{ transitionDuration: '2000ms' }}
          className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[160%] h-[160%] bg-[radial-gradient(circle_at_center,rgba(212,175,55,0.14)_0%,transparent_50%)] blur-[130px] transition-all ${stage >= 1 ? 'opacity-100 scale-100' : 'opacity-0 scale-95'}`} 
        />
        
        {/* 🌀 Enhanced Ember matrix (Slowed upwards float seamless) */}
        {stage >= 1 && embers.map((ember, i) => (
          <div 
            key={i}
            style={{
              position: 'absolute',
              left: ember.left,
              top: ember.top,
              width: ember.size,
              height: ember.size,
              backgroundColor: '#D4AF37',
              borderRadius: '50%',
              opacity: 0,
              filter: ember.blur ? `blur(${ember.blur})` : 'drop-shadow(0 0 5px rgba(212,175,55,0.85))',
              animation: `float-up ${ember.duration} infinite linear`,
              animationDelay: ember.delay
            }}
          />
        ))}

        {/* 🕯️ Soft Ambient Continuous pulse Breathe Light back swept */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div 
            style={{ transitionDuration: '2000ms' }}
            className={`w-[550px] h-[1px] bg-gradient-to-r from-transparent via-[#D4AF37]/85 to-transparent blur-[3px] scale-x-0 transition-transform ease-out-expo ${stage >= 2 ? 'scale-x-100 animate-[light-breathe_4s_infinite_ease-in-out]' : 'scale-x-0'}`} 
          />
        </div>
      </div>

      {/* 🎬 Premium Smooth Letterbox sweep (Movie Aspect Ratio) */}
      <div 
        style={{ transitionDuration: '1500ms', transitionTimingFunction: 'cubic-bezier(0.19, 1, 0.22, 1)' }}
        className={`absolute top-0 left-0 w-full bg-black z-50 transition-all ${stage >= 1 ? 'h-[6.5vh]' : 'h-[50dvh]'}`} 
      />
      <div 
        style={{ transitionDuration: '1500ms', transitionTimingFunction: 'cubic-bezier(0.19, 1, 0.22, 1)' }}
        className={`absolute bottom-0 left-0 w-full bg-black z-50 transition-all ${stage >= 1 ? 'h-[6.5vh]' : 'h-[50dvh]'}`} 
      />

      {/* 👑 ELITE SIGNATURE CENTER CARS (The 3D Glass Monogram) */}
      <div
        style={{
          position: 'absolute',
          top: '45%',
          left: '50%',
          transform: `translate(-50%, -50%)`,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          width: '100%',
          zIndex: 40,
          transitionDuration: '2000ms'
        }}
        className={`transition-all ease-out-expo ${stage >= 2 ? 'scale-100 opacity-100' : 'scale-[1.12] opacity-0 blur-md'}`}
      >
        <div className="relative flex items-center justify-center p-8">
          {/* Back Core Ambient Glow Burst */}
          <div className={`absolute inset-0 bg-[#C9A84C]/15 blur-[50px] rounded-full transition-opacity duration-1500 ${stage >= 3 ? 'opacity-100' : 'opacity-0'}`} />

          <div className="w-24 h-24 md:w-28 md:h-28 relative flex items-center justify-center">
            {/* Elegant outer slow decelerating halo frames */}
            <div className={`absolute inset-[-15px] border border-[#C9A84C]/15 rounded-full animate-[spin_45s_linear_infinite] transition-opacity ${stage >= 3 ? 'opacity-100' : 'opacity-0'}`} />
            
            {/* Main Center Bounding Box (Translucent Glass plate texture) */}
            <div className="w-[85%] h-[85%] bg-[#050505]/80 flex items-center justify-center relative border border-[#C9A84C]/45 shadow-[0_0_80px_rgba(201,168,76,0.18)] overflow-hidden rounded-[8px]">
              
              {/* Luxury light sweep laser inside the crest reticle */}
              <div className="absolute inset-0 overflow-hidden">
                <div className={`absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent skew-x-[-30deg] animate-[sweep-flare_3.5s_infinite_linear] transition-opacity ${stage >= 3 ? 'opacity-100' : 'opacity-0'}`} />
              </div>

              {/* Precise Vector Signature draws IN on stage 3 */}
              <svg className="w-12 h-12 md:w-14 md:h-14 text-[#D4AF37]" viewBox="0 0 100 100" fill="none">
                <path
                  style={{ strokeDasharray: 300, strokeDashoffset: stage >= 3 ? 0 : 300, transitionDuration: '2200ms' }}
                  className={`transition-all delay-500 ${stage >= 3 ? 'stroke-dashoffset-0' : 'stroke-dashoffset-[300]'}`}
                  d="M25 25 L75 25 L25 75 L75 75"
                  stroke="currentColor" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round"
                />
              </svg>
            </div>
          </div>
        </div>

        {/* 👑 ELEVATED 3D VOLUME CINEMATIC TYPOGRAPHY */}
        <div className="mt-12 text-center">
          <div className="overflow-hidden">
            <h1 
               style={{ fontFamily: "'Playfair Display', serif", transitionDuration: '2200ms', transitionTimingFunction: 'cubic-bezier(0.1, 1, 0.1, 1)' }}
               className={`text-6xl md:text-7xl font-light italic transition-all ${stage >= 3 ? 'translate-y-0 opacity-100 tracking-[0.25em] scale-100' : 'translate-y-full opacity-0 tracking-[0.05em] scale-110'}`}
            >
              <span 
                style={{ filter: 'drop-shadow(0px 3px 6px rgba(0,0,0,0.85)) drop-shadow(0px 0px 40px rgba(212,175,55,0.35))' }}
                className="bg-gradient-to-b from-[#FFFDF9] via-[#D4AF37] to-[#73510C] bg-clip-text text-transparent"
              >
                  Zenvy
              </span>
            </h1>
          </div>
          
          <p 
            style={{ color: '#EBE3CE', transitionDuration: '1500ms' }}
            className={`mt-5 text-[10px] md:text-[11px] font-bold uppercase tracking-[0.6em] opacity-0 transition-opacity delay-700 ${stage >= 3 ? 'opacity-45' : 'opacity-0'}`}
          >
             The Luxury of Convenience
          </p>
        </div>
      </div>

      <style dangerouslySetInnerHTML={{ __html: `
        .ease-out-expo {
          transition-timing-function: cubic-bezier(0.19, 1, 0.22, 1);
        }
        @keyframes float-up {
          0% { transform: translateY(100vh) scale(0.8); opacity: 0; }
          20% { opacity: 0.8; }
          80% { opacity: 0.8; }
          100% { transform: translateY(-80px) scale(1.1); opacity: 0; }
        }
        @keyframes light-breathe {
          0% { opacity: 0.8; transform: scaleX(1); }
          50% { opacity: 1; transform: scaleX(1.05); }
          100% { opacity: 0.8; transform: scaleX(1); }
        }
        @keyframes sweep-flare {
          0% { transform: translateX(-100%) skewX(-30deg); }
          40% { transform: translateX(200%) skewX(-30deg); }
          100% { transform: translateX(200%) skewX(-30deg); }
        }
      `}} />
    </div>
  );
}
