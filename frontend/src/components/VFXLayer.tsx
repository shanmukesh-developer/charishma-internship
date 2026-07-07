"use client";
import React, { useState, useEffect } from 'react';
import VFXParticles from './VFXParticles';
import CursorSpotlight from './CursorSpotlight';
import Meteors from './Meteors';

export default function VFXLayer() {
  const [isDesktop, setIsDesktop] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const checkDesktop = () => setIsDesktop(window.innerWidth >= 640);
    checkDesktop();
    window.addEventListener('resize', checkDesktop);
    return () => window.removeEventListener('resize', checkDesktop);
  }, []);

  if (!mounted) return null;

  if (!isDesktop) {
    return (
      <div className="fixed inset-0 z-0 pointer-events-none">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(201,168,76,0.06),transparent_60%)]" />
      </div>
    );
  }

  return (
    <>
      <div className="fixed inset-0 z-0 pointer-events-none overflow-hidden">
        <div className="film-grain" />
        <div className="vfx-bokeh  mix-blend-screen" />
        <div className="absolute -top-40 -right-40 w-[600px] h-[600px] bg-[#C9A84C]/[0.08] rounded-full blur-[100px] animate-[pulse_6s_ease-in-out_infinite]" style={{ willChange: 'transform' }} />
        <div className="absolute -bottom-40 -left-40 w-[500px] h-[500px] bg-[#38BDF8]/[0.05] rounded-full blur-[120px] animate-[pulse_8s_ease-in-out_infinite_2s]" style={{ willChange: 'transform' }} />
        <VFXParticles />
        <Meteors number={8} />
      </div>
      <CursorSpotlight />
    </>
  );
}
