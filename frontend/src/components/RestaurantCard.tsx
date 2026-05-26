"use client";
import { motion, useMotionValue, useSpring, useTransform } from 'framer-motion';
import SafeImage from './SafeImage';

interface RestaurantCardProps {
  name: string;
  rating: string;
  time: string;
  imageUrl: string;
  imagePosition: 'left' | 'right';
  isFeatured?: boolean;
  featuredBadge?: string;
}

const RestaurantCard = ({ name, rating, time, imageUrl, imagePosition, isFeatured, featuredBadge }: RestaurantCardProps) => {
  // 3D Tilt Logic
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const mouseXSpring = useSpring(x);
  const mouseYSpring = useSpring(y);
  const rotateX = useTransform(mouseYSpring, [-0.5, 0.5], ["10deg", "-10deg"]);
  const rotateY = useTransform(mouseXSpring, [-0.5, 0.5], ["-10deg", "10deg"]);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const xPct = mouseX / width - 0.5;
    const yPct = mouseY / height - 0.5;
    x.set(xPct);
    y.set(yPct);
  };

  const handleMouseLeave = () => {
    x.set(0);
    y.set(0);
  };

  return (
    <motion.div 
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      style={{ rotateX, rotateY, transformStyle: "preserve-3d" }}
      whileHover={{ scale: 1.04 }}
      transition={{ type: "spring", stiffness: 300, damping: 20 }}
      className={`capsule-card mb-6 overflow-visible hover:z-30 group flex items-center relative ${
        isFeatured ? 'border border-[#C9A84C]/30' : ''
      } ${imagePosition === 'right' ? 'flex-row-reverse text-right pl-6' : 'pr-6'}`}
    >
      {/* Sponsored Badge (F9) */}
      {isFeatured && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-30 pointer-events-none">
          <span className="bg-[#C9A84C] text-black text-[8px] font-black uppercase tracking-widest px-3 py-1 rounded-full shadow-lg">
            ✦ {featuredBadge || 'Sponsored'}
          </span>
        </div>
      )}

      {/* Premium Glow Layer */}
      <div className={`absolute inset-0 rounded-[60px] opacity-0 group-hover:opacity-100 transition-opacity duration-500 blur-xl -z-10 ${
        isFeatured 
          ? 'bg-gradient-to-br from-[#C9A84C]/20 via-transparent to-[#C9A84C]/10'
          : 'bg-gradient-to-br from-primary-yellow/10 via-transparent to-primary-yellow/5'
      }`} />
      
      {/* Image Circle with Enhanced Glow */}
      <motion.div 
        style={{ translateZ: 50 }}
        className={`food-circle shadow-[0_0_30_px_rgba(201,168,76,0.15)] group-hover:shadow-[0_0_40px_rgba(201,168,76,0.3)] transition-all duration-500 ${imagePosition === 'left' ? '-ml-6' : '-mr-6'} relative z-20 overflow-hidden border-2 ${
          isFeatured ? 'border-[#C9A84C]' : 'border-primary-yellow/40 group-hover:border-primary-yellow'
        }`}
      >
        <SafeImage 
          src={imageUrl} 
          alt={name}
          fallback="/assets/placeholder_premium.png"
          fill
          className="group-hover:scale-110 transition-transform duration-700 object-cover"
        />
        {/* Subtle Lens Flare on Circle */}
        <div className="absolute inset-0 bg-gradient-to-tr from-white/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-700" />
      </motion.div>
      
      {/* Content Area with Premium Glassmorphism */}
      <div 
        className={`flex-1 flex flex-col justify-center px-6 ${imagePosition === 'right' ? 'mr-0' : 'ml-0'} relative z-10`}
        style={{ transform: "translateZ(30px)" }}
      >
        <h3 className="font-black text-[16px] leading-tight mb-2 text-white group-hover:text-primary-yellow transition-colors line-clamp-1 truncate" style={{ fontFamily: "'Syne', sans-serif" }}>{name}</h3>
        
        <div className={`flex items-center gap-3 ${imagePosition === 'right' ? 'justify-end' : 'justify-start'}`}>
            <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 shadow-[0_0_15px_rgba(16,185,129,0.1)]">
              <span className="text-[10px] font-black text-emerald-400">{rating} ★</span>
            </div>
            <span className="text-[10px] text-white/20 font-black">•</span>
            <div className="flex items-center gap-1.5 text-secondary-text text-[10px] font-black uppercase tracking-widest group-hover:text-white/60 transition-colors">
              <svg className="w-3.5 h-3.5 opacity-60 text-primary-yellow animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
               {time}
            </div>
        </div>
      </div>
      
      {/* Hover Internal Glow Border */}
      <div className={`absolute inset-0 rounded-[60px] border transition-colors pointer-events-none ${
        isFeatured ? 'border-[#C9A84C]/30' : 'border-white/5 group-hover:border-primary-yellow/30'
      }`} />
    </motion.div>
  );
};

export default RestaurantCard;
