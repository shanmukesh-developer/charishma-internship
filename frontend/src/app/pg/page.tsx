"use client";
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import Navbar from '@/components/Navbar';
import SafeImage from '@/components/SafeImage';
import Tilt from '@/components/Tilt';
import { API_URL } from '@/utils/api';

interface Room {
  id: string;
  sharingType: number;
  availableBeds: number;
  roomNumber: string;
  pricePerBed: number;
}

interface PG {
  id: string;
  name: string;
  address: string;
  genderType: string;
  distanceFromCollege: number;
  baseRent: number;
  description: string;
  rooms?: Room[];
}

export default function PGPage() {
  const router = useRouter();
  const [pgs, setPgs] = useState<PG[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPg, setSelectedPg] = useState<PG | null>(null);

  useEffect(() => {
    fetchPGs();
  }, []);

  const fetchPGs = async () => {
    try {
      const res = await fetch(`${API_URL}/api/pg`);
      if (res.ok) setPgs(await res.json());
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleBookRoom = async (roomId: string) => {
    const token = localStorage.getItem('token');
    if (!token) {
      alert("Please login first.");
      router.push('/login');
      return;
    }
    
    try {
      const res = await fetch(`${API_URL}/api/pg/${roomId}/book`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (res.ok) {
        alert("Booking request sent successfully!");
        setSelectedPg(null);
      } else {
        alert(data.message || "Booking failed.");
      }
    } catch (err) {
      alert("Error booking room.");
    }
  };

  const openPGDetails = async (id: string) => {
    try {
      const res = await fetch(`${API_URL}/api/pg/${id}`);
      if (res.ok) setSelectedPg(await res.json());
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="min-h-screen bg-app-black text-white selection:bg-indigo-500/30 font-sans overflow-hidden">
      <Navbar />
      <div className="pt-24 pb-20 px-4 max-w-7xl mx-auto relative z-10">
        
        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="text-3xl md:text-5xl font-black uppercase tracking-tight">
            ZENVY <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-indigo-500">HOMES</span> 🏠
          </h1>
          <p className="text-gray-400 text-xs md:text-sm mt-3 uppercase tracking-widest max-w-xl mx-auto">
            Find the perfect PG near your college. Zero broker fees. Verified listings.
          </p>
        </div>

        {/* Listings */}
        {loading ? (
          <div className="text-center text-gray-500">Loading PGs...</div>
        ) : pgs.length === 0 ? (
          <div className="text-center text-gray-500">No PGs listed yet.</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {pgs.map(pg => (
              <Tilt key={pg.id} className="glass-card-extreme p-6 border-white/[0.05] rounded-[30px] flex flex-col justify-between group">
                <div>
                  <h3 className="text-xl font-bold">{pg.name}</h3>
                  <p className="text-xs text-gray-400 mb-2">{pg.address}</p>
                  <div className="flex gap-2 mb-4">
                    <span className="text-[10px] bg-white/10 px-2 py-1 rounded-full">{pg.genderType}</span>
                    <span className="text-[10px] bg-indigo-500/20 text-indigo-400 px-2 py-1 rounded-full">{pg.distanceFromCollege} km away</span>
                  </div>
                  <p className="text-sm font-black text-emerald-400 mb-4">Starts @ ₹{pg.baseRent}/mo</p>
                </div>
                <button 
                  onClick={() => openPGDetails(pg.id)}
                  className="w-full bg-white/10 hover:bg-white/20 text-white font-bold py-3 rounded-xl transition-colors text-xs uppercase tracking-wider"
                >
                  View Details & Book
                </button>
              </Tilt>
            ))}
          </div>
        )}

      </div>

      {/* PG Details Modal */}
      <AnimatePresence>
        {selectedPg && (
          <motion.div 
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/90 backdrop-blur-md flex items-center justify-center p-4"
          >
            <div className="bg-[#141416] p-8 rounded-[30px] border border-white/10 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
              <h2 className="text-2xl font-black mb-2">{selectedPg.name}</h2>
              <p className="text-sm text-gray-400 mb-6">{selectedPg.description}</p>
              
              <h3 className="text-lg font-bold mb-4 border-b border-white/10 pb-2">Available Rooms</h3>
              {selectedPg.rooms && selectedPg.rooms.length > 0 ? (
                <div className="space-y-4 mb-6">
                  {selectedPg.rooms.map(room => (
                    <div key={room.id} className="flex justify-between items-center bg-white/5 p-4 rounded-xl border border-white/5">
                      <div>
                        <div className="font-bold">{room.sharingType} Seater Room</div>
                        <div className="text-xs text-gray-400">{room.availableBeds} beds left • Room {room.roomNumber}</div>
                      </div>
                      <div className="text-right flex flex-col gap-2">
                        <span className="font-black text-emerald-400">₹{room.pricePerBed}/mo</span>
                        <button 
                          onClick={() => handleBookRoom(room.id)}
                          className="bg-indigo-500 hover:bg-indigo-600 text-white text-[10px] font-bold py-1.5 px-3 rounded-full transition-colors uppercase"
                        >
                          Book Bed
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-gray-500 mb-6">No rooms available right now.</p>
              )}

              <button 
                onClick={() => setSelectedPg(null)}
                className="w-full border border-white/20 hover:bg-white/10 text-white font-bold py-3 rounded-xl transition-colors text-xs uppercase tracking-wider"
              >
                Close
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
