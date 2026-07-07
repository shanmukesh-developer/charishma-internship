"use client";
import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import Navbar from '@/components/Navbar';
import { API_URL } from '@/utils/api';
import Link from 'next/link';

interface Room {
  id: string;
  roomNumber: string;
  sharingType: number;
  pricePerBed: number;
  totalBeds: number;
  availableBeds: number;
  floorNumber: number;
  hasAttachedBathroom: boolean;
  hasAC: boolean;
  hasBalcony: boolean;
  furnishing: string;
  images: string[];
}

interface PG {
  id: string;
  name: string;
  address: string;
  genderType: string;
  distanceFromCollege: number;
  baseRent: number;
  securityDeposit: number;
  description: string;
  amenities: string[];
  images: string[];
  messMenu: Record<string, { breakfast: string; lunch: string; dinner: string }>;
  foodTimetable: { breakfast: string; lunch: string; dinner: string };
  rules: string[];
  totalRooms?: number;
  contactInfo: {
    phone: string;
    email: string;
    ownerName: string;
    wardenName: string;
    emergencyContact: string;
    lat: number;
    lng: number;
  };
  rooms?: Room[];
}

export default function PGDetailPage() {
  const params = useParams();
  const router = useRouter();
  const pgId = params.id as string;

  const [pg, setPg] = useState<PG | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeImage, setActiveImage] = useState('');
  const [bookingStatus, setBookingStatus] = useState<{ type: 'success' | 'error' | ''; message: string }>({ type: '', message: '' });
  const [bookingRoomId, setBookingRoomId] = useState('');
  const [checkInDate, setCheckInDate] = useState(new Date().toISOString().split('T')[0]);

  // Toast state
  const [toast, setToast] = useState<{ show: boolean; msg: string; type: 'success' | 'error' }>({ show: false, msg: '', type: 'success' });

  useEffect(() => {
    if (pgId) fetchPGDetails();
  }, [pgId]);

  const fetchPGDetails = async () => {
    try {
      const res = await fetch(`${API_URL}/api/pg/${pgId}`);
      if (res.ok) {
        const data = await res.json();
        setPg(data);
        if (data.images && data.images.length > 0) {
          setActiveImage(data.images[0]);
        } else {
          setActiveImage('/pg-images/pg_boys_exterior.png');
        }
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleBookRoom = async (roomId: string) => {
    const token = localStorage.getItem('token');
    if (!token) {
      showToast("Please login to book a room.", 'error');
      setTimeout(() => {
        router.push('/login');
      }, 1500);
      return;
    }

    try {
      setBookingRoomId(roomId);
      const res = await fetch(`${API_URL}/api/pg/${roomId}/book`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json', 
          Authorization: `Bearer ${token}` 
        },
        body: JSON.stringify({ checkInDate })
      });
      const data = await res.json();
      if (res.ok) {
        showToast("Booking request sent successfully! The warden will contact you shortly.", 'success');
        // Refresh PG details to update state
        fetchPGDetails();
      } else {
        showToast(data.message || "Booking failed. Please try again.", 'error');
      }
    } catch (err) {
      showToast("Error processing your booking request.", 'error');
    } finally {
      setBookingRoomId('');
    }
  };

  const showToast = (msg: string, type: 'success' | 'error') => {
    setToast({ show: true, msg, type });
    setTimeout(() => setToast(prev => ({ ...prev, show: false })), 4000);
  };

  const getAmenityEmoji = (amenity: string) => {
    const lower = amenity.toLowerCase();
    if (lower.includes('wifi')) return '📶';
    if (lower.includes('ac')) return '❄️';
    if (lower.includes('washing') || lower.includes('laundry')) return '🧺';
    if (lower.includes('housekeeping') || lower.includes('clean')) return '🧹';
    if (lower.includes('power') || lower.includes('backup')) return '🔋';
    if (lower.includes('gym')) return '🏋️';
    if (lower.includes('lounge')) return '🛋️';
    if (lower.includes('security') || lower.includes('cctv')) return '📹';
    if (lower.includes('biometric')) return '🔐';
    if (lower.includes('nurse') || lower.includes('medical')) return '🩺';
    if (lower.includes('kitchen')) return '🍳';
    if (lower.includes('tv')) return '📺';
    if (lower.includes('co-working') || lower.includes('study')) return '📚';
    if (lower.includes('bed')) return '🛏️';
    if (lower.includes('bathroom') || lower.includes('washroom')) return '🚿';
    return '✨';
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-app-black light:bg-[#f0ece4] flex items-center justify-center text-white light:text-[#1a1a1a]">
        <div className="text-center">
          <div className="inline-block w-8 h-8 border-4 border-[#C9A84C] border-t-transparent rounded-full animate-spin"></div>
          <p className="mt-4 font-black uppercase tracking-widest text-xs">Loading Residence Details...</p>
        </div>
      </div>
    );
  }

  if (!pg) {
    return (
      <div className="min-h-screen bg-app-black light:bg-[#f0ece4] flex items-center justify-center text-white light:text-[#1a1a1a]">
        <div className="text-center p-8 glass-card border border-white/5 light:border-[#d4cfc5] rounded-3xl">
          <span className="text-5xl">⚠️</span>
          <p className="mt-4 font-black text-sm uppercase tracking-widest">PG Property not found</p>
          <Link href="/pg" className="mt-6 inline-block bg-indigo-500 hover:bg-indigo-600 text-white font-bold py-2.5 px-6 rounded-xl text-xs uppercase tracking-wider transition-transform active:scale-95">
            Back to Portal
          </Link>
        </div>
      </div>
    );
  }

  // Lat and Lng defaults
  const lat = pg.contactInfo?.lat || 16.5062;
  const lng = pg.contactInfo?.lng || 80.5048;

  // Render gender color tags
  let genderColor = 'text-[#EF4F5F] bg-[#EF4F5F]/10 border-[#EF4F5F]/20';
  if (pg.genderType === 'Boys') genderColor = 'text-blue-400 bg-blue-500/10 border-blue-500/20';
  if (pg.genderType === 'Girls') genderColor = 'text-pink-400 bg-pink-500/10 border-pink-500/20';
  if (pg.genderType === 'Co-ed') genderColor = 'text-purple-400 bg-purple-500/10 border-purple-500/20';

  return (
    <div className="min-h-screen bg-app-black light:bg-[#f0ece4] text-white light:text-[#1a1a1a] selection:bg-indigo-500/30 font-sans pb-24">
      <Navbar />

      {/* Floating Toast Notification */}
      <AnimatePresence>
        {toast.show && (
          <motion.div 
            initial={{ opacity: 0, y: 50, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.9 }}
            className={`fixed bottom-6 right-6 z-[9999] px-6 py-4 rounded-2xl shadow-2xl border flex items-center gap-3 font-bold text-xs uppercase tracking-wider backdrop-blur-md ${
              toast.type === 'success' 
                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' 
                : 'bg-red-500/10 text-red-400 border-red-500/20'
            }`}
          >
            <span>{toast.type === 'success' ? '✅' : '⚠️'}</span>
            <span>{toast.msg}</span>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="pt-24 px-4 max-w-7xl mx-auto space-y-8">
        
        {/* Breadcrumb / Back Button */}
        <div>
          <Link href="/pg" className="inline-flex items-center gap-2 text-xs font-black text-gray-400 light:text-gray-600 hover:text-white light:hover:text-black uppercase tracking-widest transition-colors">
            <span>◀</span> Back to Zenvy Homes
          </Link>
        </div>

        {/* 1. Photo Gallery Section */}
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
          {/* Main big display */}
          <div className="lg:col-span-3 h-[450px] rounded-[36px] overflow-hidden border border-white/5 light:border-[#d4cfc5] shadow-xl relative bg-black/20">
            <img 
              src={activeImage} 
              alt={pg.name} 
              className="w-full h-full object-cover"
            />
            <div className="absolute top-6 left-6 flex gap-2">
              <span className={`text-[10px] font-black uppercase tracking-widest px-4 py-2 rounded-xl backdrop-blur-md border ${genderColor}`}>
                {pg.genderType}
              </span>
              <span className="text-[10px] font-black uppercase tracking-widest px-4 py-2 rounded-xl bg-black/60 text-white backdrop-blur-md border border-white/10">
                ⭐ 4.8 / 5 Rating
              </span>
            </div>
            <div className="absolute top-6 right-6">
              <span className="text-[10px] font-black uppercase tracking-widest px-4 py-2 rounded-xl bg-emerald-500/10 text-emerald-400 backdrop-blur-md border border-emerald-500/30">
                ⚡ ZENVY VERIFIED PROPERTY
              </span>
            </div>
          </div>

          {/* Side Thumbnail List */}
          <div className="flex lg:flex-col gap-3 overflow-x-auto lg:overflow-x-visible pb-2 lg:pb-0 h-auto lg:h-[450px]">
            {pg.images.map((img, idx) => (
              <button
                key={idx}
                onClick={() => setActiveImage(img)}
                className={`flex-1 shrink-0 w-28 lg:w-full h-24 lg:h-[105px] rounded-[24px] overflow-hidden border-2 transition-all ${
                  activeImage === img 
                    ? 'border-indigo-500 scale-[0.98]' 
                    : 'border-white/5 light:border-[#d4cfc5] hover:opacity-80'
                }`}
              >
                <img src={img} alt={`PG Thumbnail ${idx+1}`} className="w-full h-full object-cover" />
              </button>
            ))}
          </div>
        </div>

        {/* 2. Header details */}
        <div className="glass-card p-8 rounded-[36px] border border-white/5 light:border-[#d4cfc5] shadow-xl">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
            <div>
              <h1 className="text-3xl md:text-4xl font-black tracking-tight text-white light:text-[#1a1a1a]">{pg.name}</h1>
              <p className="text-sm text-gray-400 light:text-gray-600 font-bold uppercase tracking-wider mt-2 flex items-center gap-1.5">
                <span>📍</span> {pg.address}
              </p>
            </div>
            <div className="bg-[#C9A84C]/10 border border-[#C9A84C]/20 p-4 rounded-3xl flex items-center gap-3">
              <span className="text-3xl">🏃</span>
              <div>
                <p className="text-[9px] font-black text-gray-400 light:text-gray-600 uppercase tracking-widest">Campus Distance</p>
                <p className="text-lg font-black text-[#C9A84C]">{pg.distanceFromCollege} km away</p>
              </div>
            </div>
          </div>

          {/* Quick Stats Grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-8 pt-8 border-t border-white/5 light:border-[#d4cfc5]">
            {[
              { label: 'Security Deposit', value: `₹${pg.securityDeposit}`, desc: 'Fully Refundable', icon: '💰' },
              { label: 'Property Type', value: `${pg.genderType} Only`, desc: 'Strict Adherence', icon: '👥' },
              { label: 'Mess System', value: '7 Days Open', desc: 'Hygiene Certified', icon: '🍽️' },
              { label: 'Total Rooms', value: `${pg.totalRooms} Rooms`, desc: 'Well Ventilated', icon: '🏢' }
            ].map((stat, idx) => (
              <div key={idx} className="bg-white/5 light:bg-[#f5f3ee] border border-white/5 light:border-[#d4cfc5] p-4 rounded-2xl flex items-center gap-3.5">
                <span className="text-2xl">{stat.icon}</span>
                <div>
                  <p className="text-[8px] font-black text-gray-400 light:text-gray-600 uppercase tracking-widest">{stat.label}</p>
                  <p className="text-sm font-black text-white light:text-[#1a1a1a] mt-0.5">{stat.value}</p>
                  <p className="text-[8px] text-gray-500 font-medium">{stat.desc}</p>
                </div>
              </div>
            ))}
          </div>

          <p className="text-sm text-gray-400 light:text-gray-600 font-medium leading-relaxed mt-8">
            {pg.description}
          </p>
        </div>

        {/* 3. Room Cards Section */}
        <div>
          <h2 className="text-xl font-black uppercase tracking-[0.25em] pl-4 mb-6">🛌 Available Room Configurations</h2>
          
          {pg.rooms && pg.rooms.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {pg.rooms.map(room => (
                <div 
                  key={room.id}
                  className="glass-card rounded-[32px] border border-white/5 light:border-[#d4cfc5] overflow-hidden flex flex-col justify-between hover:border-indigo-500/20 transition-all duration-300 shadow-lg relative"
                >
                  {/* Absolute Bed Count Banner */}
                  <div className="absolute top-4 left-4 z-10">
                    <span className={`text-[8px] font-black uppercase tracking-widest px-2.5 py-1.5 rounded-lg backdrop-blur-md border ${
                      room.availableBeds > 0 
                        ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' 
                        : 'bg-red-500/10 text-red-400 border-red-500/20'
                    }`}>
                      {room.availableBeds} beds left
                    </span>
                  </div>

                  <div>
                    {/* Room Thumbnail Photo */}
                    <div className="h-44 w-full bg-black/20 overflow-hidden">
                      <img 
                        src={room.images && room.images.length > 0 ? room.images[0] : '/pg-images/room_double_sharing.png'} 
                        alt={`${room.sharingType} Seater Room`}
                        className="w-full h-full object-cover hover:scale-105 transition-transform duration-300"
                      />
                    </div>

                    <div className="p-6 space-y-4">
                      <div>
                        <h3 className="text-md font-black text-white light:text-[#1a1a1a]">{room.sharingType} Seater Room</h3>
                        <p className="text-[9px] text-gray-400 light:text-gray-600 font-bold uppercase tracking-wider mt-0.5">Room No: {room.roomNumber} • Floor: {room.floorNumber}F</p>
                      </div>

                      {/* Room specs checklist */}
                      <div className="grid grid-cols-2 gap-2 text-[10px] font-bold text-gray-400 light:text-gray-600">
                        <div className="flex items-center gap-1.5">
                          <span>{room.hasAC ? '✅' : '❌'}</span>
                          <span>Air Conditioning</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span>{room.hasAttachedBathroom ? '✅' : '❌'}</span>
                          <span>Private Bath</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span>🚪</span>
                          <span>{room.hasBalcony ? 'Balcony' : 'No Balcony'}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span>🪑</span>
                          <span className="truncate">{room.furnishing}</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Room Booking Footer */}
                  <div className="p-6 pt-0 border-t border-white/5 light:border-[#d4cfc5] mt-4 flex items-center justify-between gap-2">
                    <div>
                      <p className="text-[8px] font-black text-gray-400 light:text-gray-600 uppercase tracking-widest">Rent per bed</p>
                      <p className="text-lg font-black text-emerald-400">₹{room.pricePerBed}<span className="text-[10px] text-gray-400 light:text-gray-600 font-normal">/mo</span></p>
                    </div>

                    <div className="flex flex-col gap-2">
                      <input 
                        type="date" 
                        value={checkInDate}
                        onChange={(e) => setCheckInDate(e.target.value)}
                        className="bg-white/5 light:bg-[#f5f3ee] border border-white/10 light:border-[#d4cfc5] rounded-xl px-2 py-1.5 text-[9px] font-bold outline-none text-white light:text-black"
                      />
                      <button
                        onClick={() => handleBookRoom(room.id)}
                        disabled={room.availableBeds === 0 || bookingRoomId === room.id}
                        className={`font-black py-2.5 px-4 rounded-xl text-[9px] uppercase tracking-wider transition-all duration-200 active:scale-95 ${
                          room.availableBeds === 0 
                            ? 'bg-gray-800 text-gray-600 cursor-not-allowed border border-gray-700' 
                            : 'bg-indigo-500 hover:bg-indigo-600 text-white shadow-md shadow-indigo-500/10'
                        }`}
                      >
                        {bookingRoomId === room.id ? 'Booking...' : room.availableBeds === 0 ? 'Sold Out' : 'Book Bed'}
                      </button>
                    </div>
                  </div>

                </div>
              ))}
            </div>
          ) : (
            <div className="glass-card p-8 rounded-[32px] border border-white/5 light:border-[#d4cfc5] text-center">
              <span className="text-4xl">📭</span>
              <p className="text-gray-500 light:text-gray-600 mt-2 font-black uppercase tracking-wider text-xs">No active rooms found for this property.</p>
            </div>
          )}
        </div>

        {/* 4. Amenities Grid Section */}
        <div className="glass-card p-8 rounded-[36px] border border-white/5 light:border-[#d4cfc5] shadow-xl">
          <h2 className="text-lg font-black uppercase tracking-[0.25em] border-b border-white/5 light:border-[#d4cfc5] pb-4 mb-6">📶 Premium Amenities & Facility Scope</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {pg.amenities.map((amenity, idx) => (
              <div key={idx} className="bg-white/5 light:bg-[#f5f3ee] border border-white/5 light:border-[#d4cfc5] p-4 rounded-2xl flex items-center gap-3">
                <span className="text-2xl">{getAmenityEmoji(amenity)}</span>
                <div>
                  <span className="text-xs font-black text-white light:text-[#1a1a1a] block truncate">{amenity}</span>
                  <span className="text-[8px] text-gray-500 uppercase tracking-widest font-black block mt-0.5">Verified Facility</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 5. Mess Menu & food Timetable */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          {/* Mess Menu Table */}
          <div className="lg:col-span-2 glass-card p-8 rounded-[36px] border border-white/5 light:border-[#d4cfc5] shadow-xl">
            <h2 className="text-lg font-black uppercase tracking-[0.25em] border-b border-white/5 light:border-[#d4cfc5] pb-4 mb-6">🍽️ Weekly Mess Menu (7-Days)</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-white/10 light:border-[#d4cfc5]">
                    <th className="py-3 font-black text-[9px] uppercase tracking-widest text-gray-400 light:text-gray-600">Day</th>
                    <th className="py-3 font-black text-[9px] uppercase tracking-widest text-[#C9A84C]">Breakfast</th>
                    <th className="py-3 font-black text-[9px] uppercase tracking-widest text-indigo-400">Lunch</th>
                    <th className="py-3 font-black text-[9px] uppercase tracking-widest text-emerald-400">Dinner</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(pg.messMenu).map(([day, meal]) => (
                    <tr key={day} className="border-b border-white/5 light:border-[#d4cfc5] hover:bg-white/5 light:hover:bg-[#f5f3ee] transition-all">
                      <td className="py-4 font-black text-white light:text-black uppercase tracking-wider">{day}</td>
                      <td className="py-4 font-bold text-gray-300 light:text-gray-700">{meal.breakfast}</td>
                      <td className="py-4 font-bold text-gray-300 light:text-gray-700">{meal.lunch}</td>
                      <td className="py-4 font-bold text-gray-300 light:text-gray-700">{meal.dinner}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Food Timetable */}
          <div className="glass-card p-8 rounded-[36px] border border-white/5 light:border-[#d4cfc5] shadow-xl flex flex-col justify-between">
            <div>
              <h2 className="text-lg font-black uppercase tracking-[0.25em] border-b border-white/5 light:border-[#d4cfc5] pb-4 mb-6">⏰ Meal Timings</h2>
              <div className="space-y-6">
                {[
                  { meal: 'Breakfast Schedule', time: pg.foodTimetable.breakfast, icon: '🍳', color: 'text-[#C9A84C]' },
                  { meal: 'Lunch Schedule', time: pg.foodTimetable.lunch, icon: '🍛', color: 'text-indigo-400' },
                  { meal: 'Dinner Schedule', time: pg.foodTimetable.dinner, icon: '🍲', color: 'text-emerald-400' }
                ].map((item, idx) => (
                  <div key={idx} className="flex items-center gap-4 bg-white/5 light:bg-[#f5f3ee] border border-white/5 light:border-[#d4cfc5] p-4 rounded-2xl">
                    <span className="text-3xl">{item.icon}</span>
                    <div>
                      <p className="text-[8px] font-black text-gray-400 light:text-gray-600 uppercase tracking-widest">{item.meal}</p>
                      <p className={`text-md font-black mt-0.5 ${item.color}`}>{item.time}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-6 bg-[#C9A84C]/5 border border-[#C9A84C]/10 rounded-2xl p-4 text-center">
              <span className="text-xs font-black text-[#C9A84C] uppercase tracking-widest block">Quality Assurance</span>
              <p className="text-[9px] text-gray-400 light:text-gray-600 mt-1 font-bold">100% vegetarian separate kitchen options. FSSAI certified wardens oversee food prep daily.</p>
            </div>
          </div>

        </div>

        {/* 6. Rules & Regulations */}
        <div className="glass-card p-8 rounded-[36px] border border-white/5 light:border-[#d4cfc5] shadow-xl">
          <h2 className="text-lg font-black uppercase tracking-[0.25em] border-b border-white/5 light:border-[#d4cfc5] pb-4 mb-6">📜 Rules, Regulations & Guidelines</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {pg.rules.map((rule, idx) => (
              <div key={idx} className="bg-white/5 light:bg-[#f5f3ee] border border-white/5 light:border-[#d4cfc5] p-4 rounded-2xl flex items-start gap-3">
                <span className="text-lg mt-0.5">⚠️</span>
                <div>
                  <span className="text-[10px] font-black text-gray-400 light:text-gray-600 uppercase tracking-widest block">Rule #{idx+1}</span>
                  <p className="text-xs font-bold text-white light:text-black mt-1 leading-relaxed">{rule}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 7. Live Map Location & Contacts */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          {/* Map Embed */}
          <div className="lg:col-span-2 glass-card p-8 rounded-[36px] border border-white/5 light:border-[#d4cfc5] shadow-xl overflow-hidden">
            <h2 className="text-lg font-black uppercase tracking-[0.25em] border-b border-white/5 light:border-[#d4cfc5] pb-4 mb-6">🗺️ Live Campus Proximity Map</h2>
            
            {/* Direct Google Maps Iframe using coordinates */}
            <div className="w-full h-80 rounded-2xl overflow-hidden border border-white/10 light:border-[#d4cfc5] shadow-inner">
              <iframe
                title="PG Live Map"
                width="100%"
                height="100%"
                style={{ border: 0 }}
                loading="lazy"
                allowFullScreen
                src={`https://maps.google.com/maps?q=${lat},${lng}&t=&z=15&ie=UTF8&iwloc=&output=embed`}
              />
            </div>
            
            <div className="flex justify-between items-center mt-4 text-[10px] font-bold text-gray-400 light:text-gray-600 uppercase tracking-wider">
              <span>Latitude: {lat}</span>
              <span>Longitude: {lng}</span>
            </div>
          </div>

          {/* Contact Details */}
          <div className="glass-card p-8 rounded-[36px] border border-white/5 light:border-[#d4cfc5] shadow-xl flex flex-col justify-between">
            <div>
              <h2 className="text-lg font-black uppercase tracking-[0.25em] border-b border-white/5 light:border-[#d4cfc5] pb-4 mb-6">📞 Warden & Office Contacts</h2>
              <div className="space-y-4">
                {[
                  { label: 'Hostel Owner', value: pg.contactInfo.ownerName, sub: 'Administration', icon: '👤' },
                  { label: 'Campus Warden', value: pg.contactInfo.wardenName, sub: 'In-premises Support', icon: '🛡️' },
                  { label: 'Contact Phone', value: pg.contactInfo.phone, sub: '9:00 AM to 8:00 PM', icon: '📞' },
                  { label: 'Emergency Hotline', value: pg.contactInfo.emergencyContact, sub: '24/7 Availability', icon: '🚨', color: 'text-red-400' },
                  { label: 'Office Email', value: pg.contactInfo.email, sub: 'Official Queries', icon: '✉️' }
                ].map((item, idx) => (
                  <div key={idx} className="flex items-center gap-3">
                    <span className="text-xl">{item.icon}</span>
                    <div>
                      <p className="text-[8px] font-black text-gray-400 light:text-gray-600 uppercase tracking-widest">{item.label}</p>
                      <p className={`text-xs font-black mt-0.5 ${item.color || 'text-white light:text-black'}`}>{item.value}</p>
                      <p className="text-[8px] text-gray-500 font-medium">{item.sub}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            
            <div className="pt-6 border-t border-white/5 light:border-[#d4cfc5] mt-6">
              <button 
                onClick={() => {
                  navigator.clipboard.writeText(pg.contactInfo.phone);
                  showToast("Contact number copied to clipboard!", 'success');
                }}
                className="w-full bg-white/5 light:bg-[#f5f3ee] hover:bg-white/10 border border-white/10 light:border-[#d4cfc5] text-white light:text-black font-black py-3 rounded-2xl text-[9px] uppercase tracking-widest transition-transform active:scale-95"
              >
                Copy Contact Number
              </button>
            </div>
          </div>

        </div>

        {/* 8. Policies Section */}
        <div className="glass-card p-8 rounded-[36px] border border-white/5 light:border-[#d4cfc5] shadow-xl">
          <h2 className="text-lg font-black uppercase tracking-[0.25em] border-b border-white/5 light:border-[#d4cfc5] pb-4 mb-6">🔒 Booking Policies & Cancellation Terms</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-xs text-gray-400 light:text-gray-600 leading-relaxed font-bold">
            <div className="space-y-2">
              <p className="font-black text-white light:text-black uppercase tracking-widest text-[9px]">1. Deposit & Refunding</p>
              <p>The security deposit of ₹{pg.securityDeposit} is fully refundable at the end of the tenancy agreement, subject to clearance of any outstanding bills or structural damage assessment.</p>
            </div>
            <div className="space-y-2">
              <p className="font-black text-white light:text-black uppercase tracking-widest text-[9px]">2. Cancellation Guard</p>
              <p>Get a 100% refund of security deposit if cancelled within 48 hours of booking. Post 48 hours, a deduction of 10% will apply. No refunds allowed after checking in.</p>
            </div>
            <div className="space-y-2">
              <p className="font-black text-white light:text-black uppercase tracking-widest text-[9px]">3. Rent Billing Cycles</p>
              <p>Monthly rent must be paid in advance by the 5th of every calendar month. Late payments attract ₹100 daily fine. Electricity bills are charged separate based on actual meter consumption.</p>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
