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
      <div className="min-h-screen bg-[#11111A] light:bg-[#FAFAFA] flex items-center justify-center text-white light:text-gray-900 transition-colors duration-500">
        <div className="text-center">
          <div className="inline-block w-8 h-8 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
          <p className="mt-6 font-black uppercase tracking-[0.2em] text-[10px] text-gray-500">Loading Premium Residence...</p>
        </div>
      </div>
    );
  }

  if (!pg) {
    return (
      <div className="min-h-screen bg-[#11111A] light:bg-[#FAFAFA] flex items-center justify-center text-white light:text-gray-900 transition-colors duration-500">
        <div className="text-center p-10 bg-white/5 light:bg-white border border-white/5 light:border-gray-100 rounded-[36px] shadow-[0_8px_30px_rgba(0,0,0,0.04)] max-w-sm w-full mx-4">
          <span className="text-6xl">⚠️</span>
          <p className="mt-6 font-black text-sm uppercase tracking-widest text-gray-400 light:text-gray-600">Property Not Found</p>
          <Link href="/pg" className="mt-8 block bg-indigo-600 hover:bg-indigo-700 text-white font-black py-4 px-6 rounded-2xl text-[10px] uppercase tracking-[0.2em] transition-transform active:scale-95 shadow-lg shadow-indigo-600/20">
            Back to Zenvy Homes
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
    <div className="min-h-screen bg-[#11111A] light:bg-[#FAFAFA] text-white light:text-gray-900 selection:bg-indigo-500/30 font-sans pb-32 transition-colors duration-500 relative overflow-hidden">
      {/* Subtle top glow */}
      <div className="absolute top-0 left-0 right-0 h-[600px] bg-gradient-radial from-indigo-50/60 via-transparent to-transparent opacity-80 pointer-events-none hidden light:block" />
      <div className="absolute top-0 left-0 right-0 h-[600px] bg-gradient-radial from-indigo-900/20 via-transparent to-transparent opacity-80 pointer-events-none block light:hidden" />

      <Navbar />

      {/* Floating Toast Notification */}
      <AnimatePresence>
        {toast.show && (
          <motion.div 
            initial={{ opacity: 0, y: 50, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.9 }}
            className={`fixed bottom-8 right-6 z-[9999] px-6 py-4 rounded-2xl shadow-2xl border flex items-center gap-4 font-black text-[10px] uppercase tracking-widest backdrop-blur-md ${
              toast.type === 'success' 
                ? 'bg-[#11111A] text-emerald-400 border-emerald-500/30' 
                : 'bg-[#11111A] text-red-400 border-red-500/30'
            }`}
          >
            <span className="text-lg">{toast.type === 'success' ? '✅' : '⚠️'}</span>
            <span>{toast.msg}</span>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="pt-24 px-4 sm:px-6 max-w-7xl mx-auto space-y-10 relative z-10">
        
        {/* Breadcrumb / Back Button */}
        <div>
          <Link href="/pg" className="inline-flex items-center gap-2 text-[10px] font-black text-gray-400 light:text-gray-500 hover:text-white light:hover:text-indigo-600 uppercase tracking-widest transition-colors bg-white/5 light:bg-white px-4 py-2 rounded-xl border border-white/5 light:border-gray-200 shadow-sm">
            <span>◀</span> Back to Zenvy Homes
          </Link>
        </div>

        {/* 1. Dynamic Photo Gallery Section */}
        <div className="bg-[#1A1A24] light:bg-white p-4 sm:p-6 rounded-[36px] border border-white/5 light:border-gray-100 shadow-[0_8px_30px_rgba(0,0,0,0.04)] relative">
          
          <div className={`grid grid-cols-1 md:grid-cols-4 gap-3 h-[50vh] md:h-[65vh] min-h-[400px]`}>
            {/* Main Hero Image (Spans 2x2) */}
            <div className="md:col-span-2 md:row-span-2 relative rounded-3xl overflow-hidden group">
              <img 
                src={pg.images && pg.images.length > 0 ? pg.images[0] : '/pg-images/pg_boys_exterior.png'} 
                alt={`${pg.name} Main`} 
                className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent pointer-events-none" />
              
              <div className="absolute top-5 left-5 flex gap-2">
                <span className={`text-[10px] font-black uppercase tracking-widest px-4 py-2 rounded-full backdrop-blur-md shadow-sm border ${genderColor}`}>
                  {pg.genderType}
                </span>
              </div>
              <div className="absolute top-5 right-5">
                <span className="text-[10px] font-black uppercase tracking-widest px-4 py-2 rounded-full bg-emerald-500/90 text-white shadow-lg shadow-emerald-500/20">
                  VERIFIED PROPERTY
                </span>
              </div>
              <div className="absolute bottom-5 left-5">
                <span className="text-[10px] font-black uppercase tracking-widest px-4 py-2 rounded-full bg-black/50 text-white backdrop-blur-md border border-white/20">
                  ⭐ 4.8 / 5 Rating
                </span>
              </div>
            </div>

            {/* Sub Image 1 */}
            <div className="hidden md:block relative rounded-3xl overflow-hidden group">
              <img src={pg.images && pg.images.length > 1 ? pg.images[1] : '/pg-images/room_double_sharing.png'} alt="Room View" className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110" />
            </div>

            {/* Sub Image 2 */}
            <div className="hidden md:block relative rounded-3xl overflow-hidden group">
              <img src={pg.images && pg.images.length > 2 ? pg.images[2] : '/pg-images/pg_boys_exterior.png'} alt="Amenity View" className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110" />
            </div>

            {/* Sub Image 3 */}
            <div className="hidden md:block relative rounded-3xl overflow-hidden group">
              <img src={pg.images && pg.images.length > 3 ? pg.images[3] : '/pg-images/room_single_sharing.png'} alt="Common Area View 1" className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105" />
            </div>

            {/* Sub Image 4 (If more than 4 images) or View All button */}
            <div className="hidden md:block relative rounded-3xl overflow-hidden group">
              <img src={pg.images && pg.images.length > 4 ? pg.images[4] : (pg.images && pg.images.length > 0 ? pg.images[0] : '/pg-images/room_double_sharing.png')} alt="View More" className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105" />
              <div className="absolute inset-0 bg-black/40 hover:bg-black/20 transition-colors flex items-center justify-center cursor-pointer">
                <span className="text-xs font-black text-white uppercase tracking-widest border border-white/30 px-6 py-3 rounded-full backdrop-blur-md hover:bg-white hover:text-black transition-colors shadow-lg">
                  View All {pg.images?.length > 4 ? pg.images.length : 15} Photos
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* 2. Header details */}
        <div className="bg-[#1A1A24] light:bg-white p-6 md:p-10 rounded-[36px] border border-white/5 light:border-gray-100 shadow-[0_8px_30px_rgba(0,0,0,0.04)] relative">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
            <div>
              <h1 className="text-4xl md:text-5xl font-black tracking-tight text-white light:text-gray-900" style={{ fontFamily: "'Syne', sans-serif" }}>{pg.name}</h1>
              <p className="text-xs text-gray-400 light:text-gray-500 font-bold uppercase tracking-widest mt-4 flex items-center gap-1.5">
                <span className="text-indigo-500 text-lg">📍</span> {pg.address}
              </p>
            </div>
            <div className="bg-indigo-500/10 light:bg-indigo-50 border border-indigo-500/20 light:border-indigo-100 p-5 rounded-3xl flex items-center gap-4 shrink-0">
              <span className="text-3xl">🏃</span>
              <div>
                <p className="text-[9px] font-black text-gray-400 light:text-gray-500 uppercase tracking-[0.2em]">Campus Proximity</p>
                <p className="text-xl font-black text-indigo-500 mt-1">{pg.distanceFromCollege} <span className="text-[10px] uppercase text-indigo-400">km away</span></p>
              </div>
            </div>
          </div>

          <p className="text-[13px] text-gray-400 light:text-gray-600 font-medium leading-relaxed mt-8 max-w-4xl">
            {pg.description}
          </p>

          {/* Quick Stats Grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-10 pt-10 border-t border-white/5 light:border-gray-100">
            {[
              { label: 'Security Deposit', value: `₹${pg.securityDeposit}`, desc: 'Fully Refundable', icon: '💰' },
              { label: 'Property Type', value: `${pg.genderType} Only`, desc: 'Strict Adherence', icon: '👥' },
              { label: 'Mess System', value: '7 Days Open', desc: 'Hygiene Certified', icon: '🍽️' },
              { label: 'Total Rooms', value: `${pg.totalRooms || 24} Rooms`, desc: 'Well Ventilated', icon: '🏢' }
            ].map((stat, idx) => (
              <div key={idx} className="bg-white/5 light:bg-[#F8F9FA] border border-white/5 light:border-gray-100 p-5 rounded-2xl flex flex-col sm:flex-row items-start sm:items-center gap-4 hover:shadow-lg transition-all duration-300 hover:-translate-y-1">
                <div className="w-12 h-12 rounded-full bg-white/10 light:bg-white flex items-center justify-center shrink-0 border border-white/5 light:border-gray-200">
                  <span className="text-2xl">{stat.icon}</span>
                </div>
                <div>
                  <p className="text-[9px] font-black text-gray-400 light:text-gray-500 uppercase tracking-[0.2em]">{stat.label}</p>
                  <p className="text-sm font-black text-white light:text-gray-900 mt-1">{stat.value}</p>
                  <p className="text-[9px] text-gray-500 light:text-gray-400 font-bold mt-1 uppercase">{stat.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 3. Room Inventory & Details Section */}
        <div>
          <div className="flex flex-col md:flex-row justify-between items-start md:items-end mb-8 pl-2 gap-4">
            <div>
              <h2 className="text-xl md:text-2xl font-black uppercase tracking-[0.2em] text-white light:text-gray-900" style={{ fontFamily: "'Syne', sans-serif" }}>Room Inventory</h2>
              <p className="text-xs text-gray-400 light:text-gray-500 font-bold uppercase tracking-widest mt-2">
                Detailed real-time availability breakdown
              </p>
            </div>
            
            {/* Summary Tag */}
            {pg.rooms && pg.rooms.length > 0 && (
              <div className="flex items-center gap-3 bg-[#1A1A24] light:bg-white border border-white/5 light:border-gray-200 px-5 py-3 rounded-2xl shadow-sm">
                <div className="flex -space-x-2">
                  {pg.rooms.map((r, i) => (
                    <div key={i} className="w-8 h-8 rounded-full bg-indigo-500/20 light:bg-indigo-100 border-2 border-[#1A1A24] light:border-white flex items-center justify-center text-[9px] font-black text-indigo-400 light:text-indigo-600 z-10 relative shadow-sm">
                      {r.sharingType}S
                    </div>
                  ))}
                </div>
                <div className="h-6 w-px bg-white/10 light:bg-gray-200" />
                <div className="text-[10px] font-black uppercase tracking-widest text-emerald-400 light:text-emerald-600">
                  {pg.rooms.reduce((acc, curr) => acc + curr.availableBeds, 0)} Total Beds Left
                </div>
              </div>
            )}
          </div>
          
          {pg.rooms && pg.rooms.length > 0 ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {pg.rooms.map(room => (
                <div 
                  key={room.id}
                  className="bg-[#1A1A24] light:bg-white rounded-[32px] border border-white/5 light:border-gray-100 overflow-hidden flex flex-col md:flex-row hover:shadow-[0_20px_40px_rgba(0,0,0,0.12)] hover:-translate-y-1 transition-all duration-300 shadow-[0_8px_24px_rgba(0,0,0,0.04)] relative"
                >
                  {/* Room Thumbnail Photo */}
                  <div className="h-48 md:h-auto md:w-2/5 bg-black/20 overflow-hidden relative group shrink-0">
                    <img 
                      src={room.images && room.images.length > 0 ? room.images[0] : '/pg-images/room_double_sharing.png'} 
                      alt={`${room.sharingType} Seater Room`}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent pointer-events-none" />
                    
                    <div className="absolute top-4 left-4 z-10 flex flex-col gap-2">
                      <span className={`inline-flex items-center text-[9px] font-black uppercase tracking-widest px-3 py-1.5 rounded-lg backdrop-blur-md border shadow-sm ${
                        room.availableBeds > 0 
                          ? 'bg-emerald-500/90 text-white border-emerald-400' 
                          : 'bg-red-500/90 text-white border-red-400'
                      }`}>
                        {room.availableBeds} beds available
                      </span>
                      <span className="inline-flex w-max text-[9px] font-black uppercase tracking-widest px-3 py-1.5 rounded-lg bg-black/50 text-gray-200 border border-white/20 backdrop-blur-md shadow-sm">
                        Total Capacity: {room.totalBeds} Beds
                      </span>
                    </div>

                    <div className="absolute bottom-4 left-4">
                      <span className="text-[10px] bg-black/50 text-white px-3 py-1.5 rounded-lg backdrop-blur-md border border-white/20 font-black uppercase tracking-wider">
                        Room {room.roomNumber}
                      </span>
                    </div>
                  </div>

                  <div className="p-6 flex flex-col justify-between w-full">
                    <div>
                      <h3 className="text-xl font-black text-white light:text-gray-900" style={{ fontFamily: "'Syne', sans-serif" }}>{room.sharingType} Seater Setup</h3>
                      
                      <div className="mt-4 grid grid-cols-2 gap-3 text-[9px] font-bold text-gray-400 light:text-gray-600 uppercase tracking-wider">
                        <div className="flex items-center gap-2 bg-white/5 light:bg-[#F8F9FA] p-2 rounded-xl">
                          <span className="text-sm">{room.hasAC ? '❄️' : '🌬️'}</span>
                          <span>{room.hasAC ? 'Air Conditioned' : 'Non-AC'}</span>
                        </div>
                        <div className="flex items-center gap-2 bg-white/5 light:bg-[#F8F9FA] p-2 rounded-xl">
                          <span className="text-sm">{room.hasAttachedBathroom ? '🚿' : '🚪'}</span>
                          <span>{room.hasAttachedBathroom ? 'Private Bath' : 'Shared Bath'}</span>
                        </div>
                        <div className="flex items-center gap-2 bg-white/5 light:bg-[#F8F9FA] p-2 rounded-xl col-span-2">
                          <span className="text-sm">🛏️</span>
                          <span>{room.totalBeds} Individual Beds (Standard Size)</span>
                        </div>
                      </div>
                    </div>

                    <div className="mt-6 pt-5 border-t border-white/5 light:border-gray-100 flex items-end justify-between">
                      <div>
                        <p className="text-[9px] font-black text-gray-400 light:text-gray-500 uppercase tracking-widest">Pricing per bed</p>
                        <p className="text-2xl font-black text-indigo-500 mt-0.5">₹{room.pricePerBed}<span className="text-[11px] text-gray-400 light:text-gray-400 font-bold uppercase tracking-wider ml-1">/mo</span></p>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="bg-[#1A1A24] light:bg-white p-12 rounded-[36px] border border-white/5 light:border-gray-100 text-center shadow-sm">
              <span className="text-6xl">📭</span>
              <p className="text-gray-500 light:text-gray-600 mt-4 font-black uppercase tracking-[0.2em] text-sm">No active rooms found.</p>
            </div>
          )}
        </div>

        {/* 4. Amenities Grid Section */}
        <div className="bg-[#1A1A24] light:bg-white p-6 md:p-10 rounded-[36px] border border-white/5 light:border-gray-100 shadow-[0_8px_30px_rgba(0,0,0,0.04)]">
          <h2 className="text-xl md:text-2xl font-black uppercase tracking-[0.2em] border-b border-white/5 light:border-gray-100 pb-6 mb-8 text-white light:text-gray-900" style={{ fontFamily: "'Syne', sans-serif" }}>Premium Amenities</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {pg.amenities.map((amenity, idx) => (
              <div key={idx} className="bg-white/5 light:bg-[#F8F9FA] border border-white/5 light:border-gray-100 p-5 rounded-2xl flex flex-col items-center text-center gap-3 hover:-translate-y-1 transition-transform">
                <span className="text-4xl">{getAmenityEmoji(amenity)}</span>
                <div>
                  <span className="text-[11px] font-black text-white light:text-gray-900 block truncate">{amenity}</span>
                  <span className="text-[9px] text-gray-500 uppercase tracking-widest font-bold block mt-1">Included</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 5. Mess Menu & food Timetable */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          {/* Daily Schedule / Timeline */}
          <div className="bg-[#1A1A24] light:bg-white p-6 md:p-10 rounded-[36px] border border-white/5 light:border-gray-100 shadow-[0_8px_30px_rgba(0,0,0,0.04)] flex flex-col justify-between">
            <div>
              <h2 className="text-xl font-black uppercase tracking-[0.2em] border-b border-white/5 light:border-gray-100 pb-6 mb-8 text-white light:text-gray-900" style={{ fontFamily: "'Syne', sans-serif" }}>Daily Schedule</h2>
              
              <div className="relative pl-6 space-y-8 before:absolute before:inset-0 before:ml-[11px] before:-translate-x-px md:before:mx-auto md:before:translate-x-0 before:h-full before:w-0.5 before:bg-gradient-to-b before:from-indigo-500 before:via-indigo-500/20 before:to-transparent">
                
                <div className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group is-active">
                  <div className="flex items-center justify-center w-6 h-6 rounded-full border-4 border-[#1A1A24] light:border-white bg-indigo-500 absolute -left-[35px] text-[8px] text-transparent shadow-sm">1</div>
                  <div className="w-full bg-white/5 light:bg-[#F8F9FA] p-4 rounded-2xl border border-white/5 light:border-gray-100">
                    <p className="text-[9px] font-black text-indigo-500 uppercase tracking-widest mb-1">Breakfast</p>
                    <p className="text-sm font-black text-white light:text-gray-900">{pg.foodTimetable.breakfast}</p>
                  </div>
                </div>

                <div className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group is-active">
                  <div className="flex items-center justify-center w-6 h-6 rounded-full border-4 border-[#1A1A24] light:border-white bg-indigo-500 absolute -left-[35px] text-[8px] text-transparent shadow-sm">2</div>
                  <div className="w-full bg-white/5 light:bg-[#F8F9FA] p-4 rounded-2xl border border-white/5 light:border-gray-100">
                    <p className="text-[9px] font-black text-indigo-500 uppercase tracking-widest mb-1">Lunch</p>
                    <p className="text-sm font-black text-white light:text-gray-900">{pg.foodTimetable.lunch}</p>
                  </div>
                </div>

                <div className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group is-active">
                  <div className="flex items-center justify-center w-6 h-6 rounded-full border-4 border-[#1A1A24] light:border-white bg-indigo-500 absolute -left-[35px] text-[8px] text-transparent shadow-sm">3</div>
                  <div className="w-full bg-white/5 light:bg-[#F8F9FA] p-4 rounded-2xl border border-white/5 light:border-gray-100">
                    <p className="text-[9px] font-black text-indigo-500 uppercase tracking-widest mb-1">Dinner</p>
                    <p className="text-sm font-black text-white light:text-gray-900">{pg.foodTimetable.dinner}</p>
                  </div>
                </div>

              </div>
            </div>

            <div className="mt-8 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl p-5 text-center">
              <span className="text-[10px] font-black text-emerald-500 uppercase tracking-[0.2em] block">Quality Assured</span>
              <p className="text-[10px] text-emerald-600/70 light:text-emerald-700 mt-2 font-bold leading-relaxed">FSSAI certified wardens oversee food prep daily. 100% vegetarian separate kitchen options available.</p>
            </div>
          </div>

          {/* Mess Menu Table */}
          <div className="lg:col-span-2 bg-[#1A1A24] light:bg-white p-6 md:p-10 rounded-[36px] border border-white/5 light:border-gray-100 shadow-[0_8px_30px_rgba(0,0,0,0.04)] overflow-hidden flex flex-col">
            <h2 className="text-xl md:text-2xl font-black uppercase tracking-[0.2em] border-b border-white/5 light:border-gray-100 pb-6 mb-8 text-white light:text-gray-900" style={{ fontFamily: "'Syne', sans-serif" }}>7-Day Mess Menu</h2>
            <div className="overflow-x-auto flex-1">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr>
                    <th className="py-4 font-black text-[10px] uppercase tracking-[0.2em] text-gray-500 border-b border-white/10 light:border-gray-200">Day</th>
                    <th className="py-4 font-black text-[10px] uppercase tracking-[0.2em] text-[#C9A84C] border-b border-white/10 light:border-gray-200">Breakfast</th>
                    <th className="py-4 font-black text-[10px] uppercase tracking-[0.2em] text-indigo-500 border-b border-white/10 light:border-gray-200">Lunch</th>
                    <th className="py-4 font-black text-[10px] uppercase tracking-[0.2em] text-emerald-500 border-b border-white/10 light:border-gray-200">Dinner</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5 light:divide-gray-100">
                  {Object.entries(pg.messMenu).map(([day, meal]) => (
                    <tr key={day} className="hover:bg-white/5 light:hover:bg-[#F8F9FA] transition-colors group">
                      <td className="py-5 font-black text-white light:text-gray-900 uppercase tracking-widest text-[11px]">{day}</td>
                      <td className="py-5 font-bold text-[13px] text-gray-300 light:text-gray-600 group-hover:text-white light:group-hover:text-gray-900 pr-4">{meal.breakfast}</td>
                      <td className="py-5 font-bold text-[13px] text-gray-300 light:text-gray-600 group-hover:text-white light:group-hover:text-gray-900 pr-4">{meal.lunch}</td>
                      <td className="py-5 font-bold text-[13px] text-gray-300 light:text-gray-600 group-hover:text-white light:group-hover:text-gray-900 pr-4">{meal.dinner}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* 6. Rules & Regulations */}
        <div className="bg-[#1A1A24] light:bg-white p-6 md:p-10 rounded-[36px] border border-white/5 light:border-gray-100 shadow-[0_8px_30px_rgba(0,0,0,0.04)] relative overflow-hidden">
          {/* Subtle watermark */}
          <div className="absolute -bottom-10 -right-10 text-9xl opacity-[0.03] pointer-events-none select-none">📜</div>
          
          <h2 className="text-xl md:text-2xl font-black uppercase tracking-[0.2em] border-b border-white/5 light:border-gray-100 pb-6 mb-8 text-white light:text-gray-900 relative z-10" style={{ fontFamily: "'Syne', sans-serif" }}>Property Guidelines</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5 relative z-10">
            {pg.rules.map((rule, idx) => (
              <div key={idx} className="bg-white/5 light:bg-[#F8F9FA] border border-white/5 light:border-gray-100 p-5 rounded-2xl flex items-start gap-4">
                <span className="text-2xl mt-0.5">⚠️</span>
                <div>
                  <span className="text-[9px] font-black text-gray-500 uppercase tracking-[0.2em] block mb-1">Regulation 0{idx+1}</span>
                  <p className="text-sm font-bold text-gray-300 light:text-gray-800 leading-relaxed">{rule}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 7. Live Map Location & Contacts */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          {/* Map Embed */}
          <div className="lg:col-span-2 bg-[#1A1A24] light:bg-white p-4 sm:p-6 rounded-[36px] border border-white/5 light:border-gray-100 shadow-[0_8px_30px_rgba(0,0,0,0.04)]">
            <div className="w-full h-80 md:h-[450px] rounded-[24px] overflow-hidden border border-white/5 light:border-gray-200 relative group">
              <iframe
                title="PG Live Map"
                width="100%"
                height="100%"
                style={{ border: 0 }}
                loading="lazy"
                allowFullScreen
                src={`https://maps.google.com/maps?q=${lat},${lng}&t=&z=16&ie=UTF8&iwloc=&output=embed`}
                className="grayscale-[20%] group-hover:grayscale-0 transition-all duration-700"
              />
              <div className="absolute bottom-4 left-4 right-4 md:right-auto bg-black/80 backdrop-blur-md px-5 py-3 rounded-2xl border border-white/10 flex items-center justify-between md:justify-start gap-6">
                <div>
                  <p className="text-[8px] font-black text-gray-400 uppercase tracking-[0.2em]">Coordinates</p>
                  <p className="text-[10px] font-bold text-white mt-0.5">{lat.toFixed(4)}, {lng.toFixed(4)}</p>
                </div>
                <div className="w-px h-6 bg-white/20 hidden md:block" />
                <a 
                  href={`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`}
                  target="_blank" rel="noreferrer"
                  className="bg-indigo-600 hover:bg-indigo-500 text-white text-[9px] font-black uppercase tracking-widest px-4 py-2 rounded-xl transition-colors shrink-0"
                >
                  Get Directions
                </a>
              </div>
            </div>
          </div>

          {/* Contact Details */}
          <div className="bg-[#1A1A24] light:bg-white p-6 md:p-8 rounded-[36px] border border-white/5 light:border-gray-100 shadow-[0_8px_30px_rgba(0,0,0,0.04)] flex flex-col justify-between">
            <div>
              <h2 className="text-xl font-black uppercase tracking-[0.2em] border-b border-white/5 light:border-gray-100 pb-5 mb-6 text-white light:text-gray-900" style={{ fontFamily: "'Syne', sans-serif" }}>Administration</h2>
              <div className="space-y-5">
                {[
                  { label: 'Hostel Owner', value: pg.contactInfo.ownerName, sub: 'Administration', icon: '👤' },
                  { label: 'Campus Warden', value: pg.contactInfo.wardenName, sub: 'In-premises Support', icon: '🛡️' },
                  { label: 'Contact Phone', value: pg.contactInfo.phone, sub: '9:00 AM to 8:00 PM', icon: '📞' },
                  { label: 'Emergency Hotline', value: pg.contactInfo.emergencyContact, sub: '24/7 Availability', icon: '🚨', color: 'text-red-400' }
                ].map((item, idx) => (
                  <div key={idx} className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-full bg-white/5 light:bg-[#F8F9FA] flex items-center justify-center shrink-0 text-xl border border-white/5 light:border-gray-100">
                      {item.icon}
                    </div>
                    <div>
                      <p className="text-[8px] font-black text-gray-400 light:text-gray-500 uppercase tracking-widest">{item.label}</p>
                      <p className={`text-[13px] font-black mt-0.5 ${item.color || 'text-white light:text-gray-900'}`}>{item.value}</p>
                      <p className="text-[8px] text-gray-500 light:text-gray-400 font-bold mt-0.5">{item.sub}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            
            <div className="pt-6 mt-6">
              <button 
                onClick={() => {
                  navigator.clipboard.writeText(pg.contactInfo.phone);
                  showToast("Contact number copied to clipboard!", 'success');
                }}
                className="w-full bg-white/5 light:bg-[#F8F9FA] hover:bg-white/10 light:hover:bg-gray-100 border border-white/10 light:border-gray-200 text-white light:text-gray-900 font-black py-4 rounded-2xl text-[10px] uppercase tracking-[0.2em] transition-all active:scale-95 flex items-center justify-center gap-2"
              >
                Copy Contact Number
                <svg className="w-4 h-4 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
              </button>
            </div>
          </div>

        </div>

        {/* 8. Policies Section */}
        <div className="bg-[#1A1A24] light:bg-white p-6 md:p-10 rounded-[36px] border border-white/5 light:border-gray-100 shadow-[0_8px_30px_rgba(0,0,0,0.04)] relative overflow-hidden">
          <div className="absolute top-0 left-0 w-1.5 h-full bg-gradient-to-b from-indigo-500 to-[#C9A84C]" />
          <h2 className="text-xl md:text-2xl font-black uppercase tracking-[0.2em] border-b border-white/5 light:border-gray-100 pb-6 mb-8 text-white light:text-gray-900 ml-4" style={{ fontFamily: "'Syne', sans-serif" }}>Booking Terms</h2>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 text-[13px] text-gray-300 light:text-gray-600 leading-relaxed font-medium ml-4">
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <span className="w-6 h-6 rounded-full bg-indigo-500/10 light:bg-indigo-50 flex items-center justify-center text-indigo-500 text-[10px] font-black border border-indigo-500/20">1</span>
                <p className="font-black text-white light:text-gray-900 uppercase tracking-widest text-[10px]">Deposit & Refunding</p>
              </div>
              <p>The security deposit of ₹{pg.securityDeposit} is fully refundable at the end of the tenancy agreement, subject to clearance of any outstanding bills or structural damage assessment.</p>
            </div>
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <span className="w-6 h-6 rounded-full bg-indigo-500/10 light:bg-indigo-50 flex items-center justify-center text-indigo-500 text-[10px] font-black border border-indigo-500/20">2</span>
                <p className="font-black text-white light:text-gray-900 uppercase tracking-widest text-[10px]">Cancellation Guard</p>
              </div>
              <p>Get a 100% refund of security deposit if cancelled within 48 hours of booking. Post 48 hours, a deduction of 10% will apply. No refunds allowed after checking in.</p>
            </div>
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <span className="w-6 h-6 rounded-full bg-indigo-500/10 light:bg-indigo-50 flex items-center justify-center text-indigo-500 text-[10px] font-black border border-indigo-500/20">3</span>
                <p className="font-black text-white light:text-gray-900 uppercase tracking-widest text-[10px]">Rent Billing Cycles</p>
              </div>
              <p>Monthly rent must be paid in advance by the 5th of every calendar month. Late payments attract ₹100 daily fine. Electricity bills are charged separate based on actual meter consumption.</p>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
