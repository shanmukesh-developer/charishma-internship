'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { 
  ShoppingCart, 
  Stethoscope, 
  WashingMachine, 
  Printer, 
  Bicycle, 
  Cake, 
  Beef, 
  Apple 
} from 'lucide-react';

const ECOSYSTEM_SERVICES = [
  { id: 'grocery', name: 'Fresh Groceries', icon: Apple, color: 'bg-green-500/10', textColor: 'text-green-500', label: 'Daily' },
  { id: 'meat', name: 'Raw Meat & Fish', icon: Beef, color: 'bg-red-500/10', textColor: 'text-red-500', label: 'Fresh' },
  { id: 'bakery', name: 'Cakes & Sweets', icon: Cake, color: 'bg-pink-500/10', textColor: 'text-pink-500', label: 'Party' },
  { id: 'rentals', name: 'Rentals', icon: Bicycle, color: 'bg-blue-500/10', textColor: 'text-blue-500', label: 'Weekly' },
  { id: 'pharmacy', name: 'Pharmacy SOS', icon: Stethoscope, color: 'bg-teal-500/10', textColor: 'text-teal-500', label: '15 Min' },
  { id: 'laundry', name: 'Wash & Fold', icon: WashingMachine, color: 'bg-indigo-500/10', textColor: 'text-indigo-500', label: '48 Hrs' },
  { id: 'print', name: 'Print & Drop', icon: Printer, color: 'bg-gray-500/10', textColor: 'text-gray-300', label: 'Academic' },
  { id: 'mart', name: 'Zenvy Mart', icon: ShoppingCart, color: 'bg-yellow-500/10', textColor: 'text-yellow-500', label: '24/7' },
];

const containerVariants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.1 }
  }
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 300 } }
};

export default function ZenvyEcosystemGrid() {
  const router = useRouter();

  return (
    <section className="py-8 px-4 w-full max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-white tracking-tight">Explore the Ecosystem</h2>
          <p className="text-sm text-gray-400 mt-1">Everything you need, delivered.</p>
        </div>
      </div>

      <motion.div 
        variants={containerVariants}
        initial="hidden"
        animate="show"
        className="grid grid-cols-4 md:grid-cols-4 gap-4"
      >
        {ECOSYSTEM_SERVICES.map((service) => {
          const Icon = service.icon;
          return (
            <motion.div
              key={service.id}
              variants={itemVariants}
              whileHover={{ scale: 1.05, y: -5 }}
              whileTap={{ scale: 0.95 }}
              className="flex flex-col items-center justify-center p-3 rounded-2xl bg-[#1A1A1A] border border-white/5 cursor-pointer relative group overflow-hidden"
              onClick={() => router.push(`/services/${service.id}`)}
            >
              {/* Highlight Hover Effect */}
              <div className={`absolute inset-0 opacity-0 group-hover:opacity-10 transition-opacity duration-300 ${service.color.replace('/10', '')}`} />
              
              {/* Service Label Badge */}
              <div className="absolute top-2 right-2 text-[9px] font-bold uppercase tracking-wider text-white/50 bg-white/5 px-1.5 py-0.5 rounded-full">
                {service.label}
              </div>

              {/* Icon */}
              <div className={`w-14 h-14 rounded-full flex items-center justify-center mb-3 ${service.color}`}>
                <Icon className={`w-7 h-7 ${service.textColor}`} />
              </div>

              {/* Title */}
              <span className="text-xs md:text-sm font-semibold text-gray-200 text-center leading-tight">
                {service.name}
              </span>
            </motion.div>
          );
        })}
      </motion.div>
    </section>
  );
}
