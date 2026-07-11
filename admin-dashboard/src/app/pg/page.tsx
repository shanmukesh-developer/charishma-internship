"use client";
import { useState, useEffect } from 'react';
import { useAdminAuth } from '@/utils/useAdminAuth';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5005';

interface PGHostel {
  id: string;
  name: string;
  address: string;
  distanceFromCollege: number;
  genderType: string;
  baseRent: number;
  isActive: boolean;
  amenities: string[];
  description?: string;
  securityDeposit: number;
  contactInfo: {
    phone: string;
    email: string;
    ownerName: string;
    warden: string;
  };
  rules: string[];
  foodTimetable: {
    breakfast: string;
    lunch: string;
    dinner: string;
  };
  messMenu: {
    Monday: { breakfast: string; lunch: string; dinner: string };
    Tuesday: { breakfast: string; lunch: string; dinner: string };
    Wednesday: { breakfast: string; lunch: string; dinner: string };
    Thursday: { breakfast: string; lunch: string; dinner: string };
    Friday: { breakfast: string; lunch: string; dinner: string };
    Saturday: { breakfast: string; lunch: string; dinner: string };
    Sunday: { breakfast: string; lunch: string; dinner: string };
  };
}

interface PGRoom {
  id: string;
  hostelId: string;
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
  isActive: boolean;
}

const AVAILABLE_AMENITIES = [
  'WiFi ⚡',
  'Food/Mess 🍽️',
  'AC ❄️',
  'Gym 💪',
  'Laundry 🧺',
  '24/7 Security 🛡️',
  'Power Backup 🔌',
  'Hot Water 🚿'
];

export default function PGMonitorPage() {
  const isAuthed = useAdminAuth();
  const [pgs, setPgs] = useState<PGHostel[]>([]);
  const [loading, setLoading] = useState(true);

  // Modals / Action States
  const [isAddingPG, setIsAddingPG] = useState(false);
  const [editingPG, setEditingPG] = useState<PGHostel | null>(null);
  const [activeTab, setActiveTab] = useState<'details' | 'rooms'>('details');

  // PG Form States
  const [pgForm, setPgForm] = useState({
    name: '',
    address: '',
    distanceFromCollege: 1.0,
    genderType: 'Co-Ed',
    baseRent: 5000,
    securityDeposit: 0,
    description: '',
    isActive: true,
    amenities: [] as string[],
    contactInfo: {
      phone: '',
      email: '',
      ownerName: '',
      warden: ''
    },
    rules: [] as string[],
    foodTimetable: {
      breakfast: '8:00 AM - 9:30 AM',
      lunch: '1:00 PM - 2:30 PM',
      dinner: '8:00 PM - 9:30 PM'
    },
    messMenu: {
      Monday: { breakfast: '', lunch: '', dinner: '' },
      Tuesday: { breakfast: '', lunch: '', dinner: '' },
      Wednesday: { breakfast: '', lunch: '', dinner: '' },
      Thursday: { breakfast: '', lunch: '', dinner: '' },
      Friday: { breakfast: '', lunch: '', dinner: '' },
      Saturday: { breakfast: '', lunch: '', dinner: '' },
      Sunday: { breakfast: '', lunch: '', dinner: '' }
    }
  });

  const [newRule, setNewRule] = useState('');

  // Rooms States
  const [rooms, setRooms] = useState<PGRoom[]>([]);
  const [loadingRooms, setLoadingRooms] = useState(false);
  const [isAddingRoom, setIsAddingRoom] = useState(false);
  const [roomForm, setRoomForm] = useState({
    roomNumber: '',
    sharingType: 2,
    pricePerBed: 6000,
    totalBeds: 2,
    availableBeds: 2,
    floorNumber: 1,
    hasAttachedBathroom: true,
    hasAC: false,
    hasBalcony: false,
    furnishing: 'Fully Furnished',
    isActive: true
  });

  useEffect(() => {
    if (!isAuthed) return;
    fetchPGs();
  }, [isAuthed]);

  const fetchPGs = async () => {
    try {
      const res = await fetch(`${API_URL}/api/pg/admin/admin-all`);
      if (res.ok) setPgs(await res.json());
    } catch (err) {
      console.error('[FETCH_PGS_ERROR]', err);
    } finally {
      setLoading(false);
    }
  };

  const handleCreatePG = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch(`${API_URL}/api/pg`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(pgForm)
      });
      if (res.ok) {
        setIsAddingPG(false);
        setPgForm({
          name: '',
          address: '',
          distanceFromCollege: 1.0,
          genderType: 'Co-Ed',
          baseRent: 5000,
          securityDeposit: 0,
          description: '',
          isActive: true,
          amenities: [],
          contactInfo: { phone: '', email: '', ownerName: '', warden: '' },
          rules: [],
          foodTimetable: { breakfast: '8:00 AM - 9:30 AM', lunch: '1:00 PM - 2:30 PM', dinner: '8:00 PM - 9:30 PM' },
          messMenu: {
            Monday: { breakfast: '', lunch: '', dinner: '' },
            Tuesday: { breakfast: '', lunch: '', dinner: '' },
            Wednesday: { breakfast: '', lunch: '', dinner: '' },
            Thursday: { breakfast: '', lunch: '', dinner: '' },
            Friday: { breakfast: '', lunch: '', dinner: '' },
            Saturday: { breakfast: '', lunch: '', dinner: '' },
            Sunday: { breakfast: '', lunch: '', dinner: '' }
          }
        });
        fetchPGs();
      }
    } catch (err) {
      console.error('[CREATE_PG_ERROR]', err);
    }
  };

  const handleUpdatePG = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingPG) return;
    try {
      const res = await fetch(`${API_URL}/api/pg/${editingPG.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(pgForm)
      });
      if (res.ok) {
        setEditingPG(null);
        fetchPGs();
      }
    } catch (err) {
      console.error('[UPDATE_PG_ERROR]', err);
    }
  };

  const handleDeletePG = async (id: string) => {
    if (!confirm('Are you sure you want to delete this PG and all its rooms?')) return;
    try {
      const res = await fetch(`${API_URL}/api/pg/${id}`, { method: 'DELETE' });
      if (res.ok) {
        if (editingPG?.id === id) setEditingPG(null);
        fetchPGs();
      }
    } catch (err) {
      console.error('[DELETE_PG_ERROR]', err);
    }
  };

  // ─── Room Operations ──────────────────────────────────────────
  const fetchRooms = async (pgId: string) => {
    setLoadingRooms(true);
    try {
      const res = await fetch(`${API_URL}/api/pg/${pgId}/rooms-all`);
      if (res.ok) setRooms(await res.json());
    } catch (err) {
      console.error('[FETCH_ROOMS_ERROR]', err);
    } finally {
      setLoadingRooms(false);
    }
  };

  const handleCreateRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingPG) return;
    try {
      const res = await fetch(`${API_URL}/api/pg/${editingPG.id}/rooms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(roomForm)
      });
      if (res.ok) {
        setIsAddingRoom(false);
        setRoomForm({
          roomNumber: '',
          sharingType: 2,
          pricePerBed: 6000,
          totalBeds: 2,
          availableBeds: 2,
          floorNumber: 1,
          hasAttachedBathroom: true,
          hasAC: false,
          hasBalcony: false,
          furnishing: 'Fully Furnished',
          isActive: true
        });
        fetchRooms(editingPG.id);
      }
    } catch (err) {
      console.error('[CREATE_ROOM_ERROR]', err);
    }
  };

  const handleUpdateRoom = async (roomId: string, updatedRoom: Partial<PGRoom>) => {
    if (!editingPG) return;
    try {
      await fetch(`${API_URL}/api/pg/${editingPG.id}/rooms/${roomId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedRoom)
      });
      fetchRooms(editingPG.id);
    } catch (err) {
      console.error('[UPDATE_ROOM_ERROR]', err);
    }
  };

  const handleDeleteRoom = async (roomId: string) => {
    if (!editingPG || !confirm('Are you sure you want to delete this room?')) return;
    try {
      const res = await fetch(`${API_URL}/api/pg/${editingPG.id}/rooms/${roomId}`, { method: 'DELETE' });
      if (res.ok) fetchRooms(editingPG.id);
    } catch (err) {
      console.error('[DELETE_ROOM_ERROR]', err);
    }
  };

  const openEditModal = (pg: PGHostel) => {
    setEditingPG(pg);
    setActiveTab('details');
    setPgForm({
      name: pg.name,
      address: pg.address,
      distanceFromCollege: pg.distanceFromCollege,
      genderType: pg.genderType,
      baseRent: pg.baseRent,
      securityDeposit: pg.securityDeposit || 0,
      description: pg.description || '',
      isActive: pg.isActive,
      amenities: pg.amenities || [],
      contactInfo: pg.contactInfo || { phone: '', email: '', ownerName: '', warden: '' },
      rules: pg.rules || [],
      foodTimetable: pg.foodTimetable || { breakfast: '8:00 AM - 9:30 AM', lunch: '1:00 PM - 2:30 PM', dinner: '8:00 PM - 9:30 PM' },
      messMenu: pg.messMenu || {
        Monday: { breakfast: '', lunch: '', dinner: '' },
        Tuesday: { breakfast: '', lunch: '', dinner: '' },
        Wednesday: { breakfast: '', lunch: '', dinner: '' },
        Thursday: { breakfast: '', lunch: '', dinner: '' },
        Friday: { breakfast: '', lunch: '', dinner: '' },
        Saturday: { breakfast: '', lunch: '', dinner: '' },
        Sunday: { breakfast: '', lunch: '', dinner: '' }
      }
    });
    fetchRooms(pg.id);
  };

  const handleAmenityToggle = (amenity: string) => {
    const current = [...pgForm.amenities];
    const index = current.indexOf(amenity);
    if (index > -1) {
      current.splice(index, 1);
    } else {
      current.push(amenity);
    }
    setPgForm({ ...pgForm, amenities: current });
  };

  if (!isAuthed) {
    return <div className="p-20 text-center font-black text-white uppercase tracking-widest animate-pulse">Authenticating Command Terminal...</div>;
  }

  return (
    <div className="space-y-12 animate-fade-in relative pb-20 text-slate-200">
      <header className="flex justify-between items-center bg-white/5 p-8 rounded-[40px] border border-white/5 glass">
        <div className="flex flex-col">
          <h1 className="text-3xl font-black text-white italic tracking-tighter">PG & HOSTEL <span className="text-blue-500">MONITOR</span></h1>
          <p className="text-[10px] font-black text-gray-500 uppercase tracking-[0.4em] mt-1">Super Admin Housing Control</p>
        </div>
        <button
          onClick={() => {
            setIsAddingPG(true);
            setPgForm({
              name: '',
              address: '',
              distanceFromCollege: 1.0,
              genderType: 'Co-Ed',
              baseRent: 5000,
              securityDeposit: 0,
              description: '',
              isActive: true,
              amenities: [],
              contactInfo: { phone: '', email: '', ownerName: '', warden: '' },
              rules: [],
              foodTimetable: { breakfast: '8:00 AM - 9:30 AM', lunch: '1:00 PM - 2:30 PM', dinner: '8:00 PM - 9:30 PM' },
              messMenu: {
                Monday: { breakfast: '', lunch: '', dinner: '' },
                Tuesday: { breakfast: '', lunch: '', dinner: '' },
                Wednesday: { breakfast: '', lunch: '', dinner: '' },
                Thursday: { breakfast: '', lunch: '', dinner: '' },
                Friday: { breakfast: '', lunch: '', dinner: '' },
                Saturday: { breakfast: '', lunch: '', dinner: '' },
                Sunday: { breakfast: '', lunch: '', dinner: '' }
              }
            });
          }}
          className="px-8 py-3 bg-blue-600 text-white text-[10px] font-black uppercase tracking-widest rounded-2xl hover:scale-105 transition-all border border-blue-500/20 shadow-[0_0_20px_rgba(37,99,235,0.2)]"
        >
          Add New PG Hostel
        </button>
      </header>

      {/* ─── ADD PG MODAL ────────────────────────────────────────── */}
      {isAddingPG && (
        <div className="glass-card p-10 border-blue-500/20 animate-in fade-in slide-in-from-top-4 duration-500 bg-slate-950/90">
          <h3 className="text-xl font-black text-white uppercase tracking-tight mb-8 flex items-center gap-3">
             <span className="w-8 h-8 bg-blue-500/20 rounded-lg flex items-center justify-center text-sm">🏢</span>
             Deploy New Housing Node
          </h3>
          <form onSubmit={handleCreatePG} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase tracking-widest text-gray-500 block">Hostel Name</label>
                <input
                  required
                  placeholder="e.g. Premium Boys Residency"
                  className="nexus-input"
                  value={pgForm.name}
                  onChange={(e) => setPgForm({ ...pgForm, name: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase tracking-widest text-gray-500 block">Address</label>
                <input
                  required
                  placeholder="e.g. Lane 4, near East Gate"
                  className="nexus-input"
                  value={pgForm.address}
                  onChange={(e) => setPgForm({ ...pgForm, address: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-4 gap-4 md:col-span-2">
                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase tracking-widest text-gray-500 block">Distance (KM)</label>
                  <input
                    type="number"
                    step="0.1"
                    required
                    className="nexus-input"
                    value={pgForm.distanceFromCollege}
                    onChange={(e) => setPgForm({ ...pgForm, distanceFromCollege: parseFloat(e.target.value) })}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase tracking-widest text-gray-500 block">Gender Policy</label>
                  <select
                    className="nexus-select"
                    value={pgForm.genderType}
                    onChange={(e) => setPgForm({ ...pgForm, genderType: e.target.value })}
                  >
                    <option value="Girls">Girls Only</option>
                    <option value="Boys">Boys Only</option>
                    <option value="Co-Ed">Co-Ed</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase tracking-widest text-gray-500 block">Base Rent (₹/mo)</label>
                  <input
                    type="number"
                    required
                    className="nexus-input"
                    value={pgForm.baseRent}
                    onChange={(e) => setPgForm({ ...pgForm, baseRent: parseInt(e.target.value) })}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase tracking-widest text-gray-500 block">Deposit (₹)</label>
                  <input
                    type="number"
                    required
                    className="nexus-input"
                    value={pgForm.securityDeposit}
                    onChange={(e) => setPgForm({ ...pgForm, securityDeposit: parseInt(e.target.value) })}
                  />
                </div>
              </div>
              
              {/* Contact Info */}
              <div className="space-y-4 col-span-full">
                <h4 className="text-xs font-black text-blue-400 uppercase tracking-widest border-b border-white/5 pb-2">Contact Info & Administration</h4>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="space-y-1">
                    <label className="text-[8px] font-black text-gray-500 uppercase tracking-widest block">Owner Name</label>
                    <input 
                      placeholder="e.g. Ram Prasad"
                      className="nexus-input py-2 px-3 text-xs"
                      value={pgForm.contactInfo.ownerName}
                      onChange={(e) => setPgForm({ ...pgForm, contactInfo: { ...pgForm.contactInfo, ownerName: e.target.value } })}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[8px] font-black text-gray-500 uppercase tracking-widest block">Phone Number</label>
                    <input 
                      placeholder="e.g. +91 9876543210"
                      className="nexus-input py-2 px-3 text-xs"
                      value={pgForm.contactInfo.phone}
                      onChange={(e) => setPgForm({ ...pgForm, contactInfo: { ...pgForm.contactInfo, phone: e.target.value } })}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[8px] font-black text-gray-500 uppercase tracking-widest block">Email Address</label>
                    <input 
                      placeholder="e.g. owner@zenvy.com"
                      className="nexus-input py-2 px-3 text-xs"
                      value={pgForm.contactInfo.email}
                      onChange={(e) => setPgForm({ ...pgForm, contactInfo: { ...pgForm.contactInfo, email: e.target.value } })}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[8px] font-black text-gray-500 uppercase tracking-widest block">Warden Name</label>
                    <input 
                      placeholder="e.g. Suresh Kumar"
                      className="nexus-input py-2 px-3 text-xs"
                      value={pgForm.contactInfo.warden}
                      onChange={(e) => setPgForm({ ...pgForm, contactInfo: { ...pgForm.contactInfo, warden: e.target.value } })}
                    />
                  </div>
                </div>
              </div>

              {/* Timings */}
              <div className="space-y-4 col-span-full">
                <h4 className="text-xs font-black text-blue-400 uppercase tracking-widest border-b border-white/5 pb-2">Food Timetable (Timings)</h4>
                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-1">
                    <label className="text-[8px] font-black text-gray-500 uppercase tracking-widest block">Breakfast Time</label>
                    <input 
                      className="nexus-input py-2 px-3 text-xs"
                      value={pgForm.foodTimetable.breakfast}
                      onChange={(e) => setPgForm({ ...pgForm, foodTimetable: { ...pgForm.foodTimetable, breakfast: e.target.value } })}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[8px] font-black text-gray-500 uppercase tracking-widest block">Lunch Time</label>
                    <input 
                      className="nexus-input py-2 px-3 text-xs"
                      value={pgForm.foodTimetable.lunch}
                      onChange={(e) => setPgForm({ ...pgForm, foodTimetable: { ...pgForm.foodTimetable, lunch: e.target.value } })}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[8px] font-black text-gray-500 uppercase tracking-widest block">Dinner Time</label>
                    <input 
                      className="nexus-input py-2 px-3 text-xs"
                      value={pgForm.foodTimetable.dinner}
                      onChange={(e) => setPgForm({ ...pgForm, foodTimetable: { ...pgForm.foodTimetable, dinner: e.target.value } })}
                    />
                  </div>
                </div>
              </div>

              {/* Weekly Mess Menu */}
              <div className="space-y-4 col-span-full">
                <h4 className="text-xs font-black text-blue-400 uppercase tracking-widest border-b border-white/5 pb-2">Weekly Mess Menu</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map((day) => {
                    const dayMenu = pgForm.messMenu[day as keyof typeof pgForm.messMenu] || { breakfast: '', lunch: '', dinner: '' };
                    return (
                      <div key={day} className="p-4 rounded-2xl bg-white/[0.02] border border-white/5 space-y-2">
                        <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest block">{day} Menu</span>
                        <div className="grid grid-cols-3 gap-2">
                          <input 
                            placeholder="Breakfast"
                            className="nexus-input py-1.5 px-3 text-xs"
                            value={dayMenu.breakfast}
                            onChange={(e) => {
                              const updatedMenu = { ...pgForm.messMenu };
                              updatedMenu[day as keyof typeof pgForm.messMenu] = { ...dayMenu, breakfast: e.target.value };
                              setPgForm({ ...pgForm, messMenu: updatedMenu });
                            }}
                          />
                          <input 
                            placeholder="Lunch"
                            className="nexus-input py-1.5 px-3 text-xs"
                            value={dayMenu.lunch}
                            onChange={(e) => {
                              const updatedMenu = { ...pgForm.messMenu };
                              updatedMenu[day as keyof typeof pgForm.messMenu] = { ...dayMenu, lunch: e.target.value };
                              setPgForm({ ...pgForm, messMenu: updatedMenu });
                            }}
                          />
                          <input 
                            placeholder="Dinner"
                            className="nexus-input py-1.5 px-3 text-xs"
                            value={dayMenu.dinner}
                            onChange={(e) => {
                              const updatedMenu = { ...pgForm.messMenu };
                              updatedMenu[day as keyof typeof pgForm.messMenu] = { ...dayMenu, dinner: e.target.value };
                              setPgForm({ ...pgForm, messMenu: updatedMenu });
                            }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Rules */}
              <div className="space-y-4 col-span-full">
                <h4 className="text-xs font-black text-blue-400 uppercase tracking-widest border-b border-white/5 pb-2">Rules & Regulations</h4>
                <div className="space-y-2">
                  {pgForm.rules.map((rule, idx) => (
                    <div key={idx} className="flex justify-between items-center bg-white/5 border border-white/5 p-2 rounded-xl text-xs text-white">
                      <span>{idx + 1}. {rule}</span>
                      <button 
                        type="button" 
                        onClick={() => {
                          const updatedRules = [...pgForm.rules];
                          updatedRules.splice(idx, 1);
                          setPgForm({ ...pgForm, rules: updatedRules });
                        }}
                        className="text-red-400 hover:text-red-300 font-bold"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input 
                    placeholder="e.g. Curfew time is 10:00 PM"
                    className="nexus-input flex-1 py-2 px-3 text-xs"
                    value={newRule}
                    onChange={(e) => setNewRule(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        if (newRule.trim()) {
                          setPgForm({ ...pgForm, rules: [...pgForm.rules, newRule.trim()] });
                          setNewRule('');
                        }
                      }
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (newRule.trim()) {
                        setPgForm({ ...pgForm, rules: [...pgForm.rules, newRule.trim()] });
                        setNewRule('');
                      }
                    }}
                    className="px-4 py-2 bg-blue-600/20 text-blue-400 border border-blue-500/20 text-[10px] font-black uppercase tracking-widest rounded-xl hover:bg-blue-600/30"
                  >
                    Add Rule
                  </button>
                </div>
              </div>

              <div className="space-y-2 col-span-full">
                <label className="text-[10px] font-black uppercase tracking-widest text-gray-500 block">Description</label>
                <textarea
                  placeholder="Brief overview of amenities, food timing, rules..."
                  className="nexus-input h-20 resize-none"
                  value={pgForm.description}
                  onChange={(e) => setPgForm({ ...pgForm, description: e.target.value })}
                />
              </div>
              <div className="space-y-2 col-span-full">
                <label className="text-[10px] font-black uppercase tracking-widest text-gray-500 block mb-2">Amenities Checklist</label>
                <div className="flex flex-wrap gap-2">
                  {AVAILABLE_AMENITIES.map((amenity) => {
                    const isSelected = pgForm.amenities.includes(amenity);
                    return (
                      <button
                        key={amenity}
                        type="button"
                        onClick={() => handleAmenityToggle(amenity)}
                        className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest border transition-all ${
                          isSelected
                            ? 'bg-blue-500/10 border-blue-500/30 text-blue-400'
                            : 'bg-white/5 border-white/10 text-gray-500 hover:border-white/20'
                        }`}
                      >
                        {amenity}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
            <div className="flex gap-4 mt-8">
              <button
                type="submit"
                className="flex-1 py-4 bg-blue-600 hover:bg-blue-500 text-white font-black uppercase tracking-widest rounded-2xl text-xs"
              >
                Create Listing Node
              </button>
              <button
                type="button"
                onClick={() => setIsAddingPG(false)}
                className="px-8 py-4 bg-white/5 text-gray-400 hover:bg-white/10 font-black uppercase tracking-widest rounded-2xl text-xs"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ─── LISTING CARDS ────────────────────────────────────────── */}
      {loading ? (
        <div className="text-center py-20 text-gray-500 font-mono text-xs uppercase tracking-widest animate-pulse">Syncing housing records...</div>
      ) : pgs.length === 0 ? (
        <div className="text-center py-20 text-gray-600 text-xs italic tracking-wide">No PG listings detected on the grid.</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {pgs.map(pg => (
            <div key={pg.id} className="glass-card p-6 border-white/5 bg-slate-900/40 rounded-3xl flex flex-col justify-between group">
              <div>
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <h3 className="text-xl font-bold text-white group-hover:text-blue-400 transition-colors">{pg.name}</h3>
                    <p className="text-xs text-gray-500 font-mono mt-0.5">{pg.address}</p>
                  </div>
                  <span className={`text-[9px] font-black px-2.5 py-1 rounded-md uppercase tracking-wider ${
                    pg.isActive ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'
                  }`}>
                    {pg.isActive ? 'Active' : 'Suspended'}
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-4 py-4 border-y border-white/5 mb-4 text-center">
                  <div>
                    <p className="text-[9px] text-gray-500 font-black uppercase tracking-wider">Distance</p>
                    <p className="text-sm font-bold text-white mt-1">{pg.distanceFromCollege} KM</p>
                  </div>
                  <div>
                    <p className="text-[9px] text-gray-500 font-black uppercase tracking-wider">Gender Policy</p>
                    <p className="text-sm font-bold text-indigo-400 mt-1">{pg.genderType}</p>
                  </div>
                  <div>
                    <p className="text-[9px] text-gray-500 font-black uppercase tracking-wider">Base Rent</p>
                    <p className="text-sm font-bold text-emerald-400 mt-1">₹{pg.baseRent}/mo</p>
                  </div>
                </div>

                {pg.amenities && pg.amenities.length > 0 && (
                  <div className="mb-4">
                    <p className="text-[9px] text-gray-500 font-black uppercase tracking-wider mb-2">Amenities</p>
                    <div className="flex flex-wrap gap-1.5">
                      {pg.amenities.map((amenity, i) => (
                        <span key={i} className="text-[9px] font-bold bg-white/5 border border-white/5 px-2 py-0.5 rounded text-gray-400">
                          {amenity}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="flex gap-3 mt-4 pt-4 border-t border-white/5">
                <button
                  onClick={() => openEditModal(pg)}
                  className="flex-1 py-3 bg-blue-600/10 hover:bg-blue-600/20 text-blue-400 text-[10px] font-black uppercase tracking-widest rounded-xl transition-all border border-blue-500/20"
                >
                  Manage Listing
                </button>
                <button
                  onClick={() => handleDeletePG(pg.id)}
                  className="px-4 py-3 bg-red-950/20 hover:bg-red-950/40 text-red-400 text-[10px] font-black uppercase tracking-widest rounded-xl transition-all border border-red-900/30"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ─── EDIT MODAL (HOSTEL & ROOMS) ───────────────────────────── */}
      {editingPG && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 overflow-y-auto">
          <div className="glass-card max-w-4xl w-full border-blue-500/20 bg-slate-950 p-8 rounded-[40px] max-h-[90vh] overflow-y-auto relative animate-in zoom-in-95 duration-300">
            <button
              onClick={() => setEditingPG(null)}
              className="absolute top-6 right-6 text-gray-500 hover:text-white text-xl"
            >
              ✕
            </button>

            <header className="mb-8">
              <h2 className="text-2xl font-black text-white uppercase tracking-tight">{pgForm.name || 'Edit Listing'}</h2>
              <p className="text-[10px] font-black text-gray-500 uppercase tracking-widest mt-1">Operational Node Configuration</p>
            </header>

            {/* TAB SELECTOR */}
            <div className="flex gap-4 border-b border-white/5 mb-8 pb-3">
              <button
                onClick={() => setActiveTab('details')}
                className={`pb-2 px-4 text-xs font-black uppercase tracking-widest border-b-2 transition-all ${
                  activeTab === 'details' ? 'border-blue-500 text-blue-400' : 'border-transparent text-gray-500 hover:text-white'
                }`}
              >
                Hostel Details
              </button>
              <button
                onClick={() => setActiveTab('rooms')}
                className={`pb-2 px-4 text-xs font-black uppercase tracking-widest border-b-2 transition-all ${
                  activeTab === 'rooms' ? 'border-blue-500 text-blue-400' : 'border-transparent text-gray-500 hover:text-white'
                }`}
              >
                Room Inventory ({rooms.length})
              </button>
            </div>

            {/* TAB 1: DETAILS */}
            {activeTab === 'details' && (
              <form onSubmit={handleUpdatePG} className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase tracking-widest text-gray-500 block">Hostel Name</label>
                    <input
                      required
                      className="nexus-input"
                      value={pgForm.name}
                      onChange={(e) => setPgForm({ ...pgForm, name: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase tracking-widest text-gray-500 block">Address</label>
                    <input
                      required
                      className="nexus-input"
                      value={pgForm.address}
                      onChange={(e) => setPgForm({ ...pgForm, address: e.target.value })}
                    />
                  </div>
                  <div className="grid grid-cols-4 gap-4 md:col-span-2">
                    <div className="space-y-2">
                      <label className="text-[10px] font-black uppercase tracking-widest text-gray-500 block">Distance (KM)</label>
                      <input
                        type="number"
                        step="0.1"
                        required
                        className="nexus-input"
                        value={pgForm.distanceFromCollege}
                        onChange={(e) => setPgForm({ ...pgForm, distanceFromCollege: parseFloat(e.target.value) })}
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[10px] font-black uppercase tracking-widest text-gray-500 block">Gender Policy</label>
                      <select
                        className="nexus-select"
                        value={pgForm.genderType}
                        onChange={(e) => setPgForm({ ...pgForm, genderType: e.target.value })}
                      >
                        <option value="Girls">Girls Only</option>
                        <option value="Boys">Boys Only</option>
                        <option value="Co-Ed">Co-Ed</option>
                      </select>
                    </div>
                    <div className="space-y-2">
                      <label className="text-[10px] font-black uppercase tracking-widest text-gray-500 block">Base Rent (₹/mo)</label>
                      <input
                        type="number"
                        required
                        className="nexus-input"
                        value={pgForm.baseRent}
                        onChange={(e) => setPgForm({ ...pgForm, baseRent: parseInt(e.target.value) })}
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[10px] font-black uppercase tracking-widest text-gray-500 block">Deposit (₹)</label>
                      <input
                        type="number"
                        required
                        className="nexus-input"
                        value={pgForm.securityDeposit}
                        onChange={(e) => setPgForm({ ...pgForm, securityDeposit: parseInt(e.target.value) })}
                      />
                    </div>
                  </div>

                  {/* Contact Info */}
                  <div className="space-y-4 col-span-full">
                    <h4 className="text-xs font-black text-blue-400 uppercase tracking-widest border-b border-white/5 pb-2">Contact Info & Administration</h4>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <div className="space-y-1">
                        <label className="text-[8px] font-black text-gray-500 uppercase tracking-widest block">Owner Name</label>
                        <input 
                          placeholder="e.g. Ram Prasad"
                          className="nexus-input py-2 px-3 text-xs"
                          value={pgForm.contactInfo.ownerName}
                          onChange={(e) => setPgForm({ ...pgForm, contactInfo: { ...pgForm.contactInfo, ownerName: e.target.value } })}
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[8px] font-black text-gray-500 uppercase tracking-widest block">Phone Number</label>
                        <input 
                          placeholder="e.g. +91 9876543210"
                          className="nexus-input py-2 px-3 text-xs"
                          value={pgForm.contactInfo.phone}
                          onChange={(e) => setPgForm({ ...pgForm, contactInfo: { ...pgForm.contactInfo, phone: e.target.value } })}
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[8px] font-black text-gray-500 uppercase tracking-widest block">Email Address</label>
                        <input 
                          placeholder="e.g. owner@zenvy.com"
                          className="nexus-input py-2 px-3 text-xs"
                          value={pgForm.contactInfo.email}
                          onChange={(e) => setPgForm({ ...pgForm, contactInfo: { ...pgForm.contactInfo, email: e.target.value } })}
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[8px] font-black text-gray-500 uppercase tracking-widest block">Warden Name</label>
                        <input 
                          placeholder="e.g. Suresh Kumar"
                          className="nexus-input py-2 px-3 text-xs"
                          value={pgForm.contactInfo.warden}
                          onChange={(e) => setPgForm({ ...pgForm, contactInfo: { ...pgForm.contactInfo, warden: e.target.value } })}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Timings */}
                  <div className="space-y-4 col-span-full">
                    <h4 className="text-xs font-black text-blue-400 uppercase tracking-widest border-b border-white/5 pb-2">Food Timetable (Timings)</h4>
                    <div className="grid grid-cols-3 gap-4">
                      <div className="space-y-1">
                        <label className="text-[8px] font-black text-gray-500 uppercase tracking-widest block">Breakfast Time</label>
                        <input 
                          className="nexus-input py-2 px-3 text-xs"
                          value={pgForm.foodTimetable.breakfast}
                          onChange={(e) => setPgForm({ ...pgForm, foodTimetable: { ...pgForm.foodTimetable, breakfast: e.target.value } })}
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[8px] font-black text-gray-500 uppercase tracking-widest block">Lunch Time</label>
                        <input 
                          className="nexus-input py-2 px-3 text-xs"
                          value={pgForm.foodTimetable.lunch}
                          onChange={(e) => setPgForm({ ...pgForm, foodTimetable: { ...pgForm.foodTimetable, lunch: e.target.value } })}
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[8px] font-black text-gray-500 uppercase tracking-widest block">Dinner Time</label>
                        <input 
                          className="nexus-input py-2 px-3 text-xs"
                          value={pgForm.foodTimetable.dinner}
                          onChange={(e) => setPgForm({ ...pgForm, foodTimetable: { ...pgForm.foodTimetable, dinner: e.target.value } })}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Weekly Mess Menu */}
                  <div className="space-y-4 col-span-full">
                    <h4 className="text-xs font-black text-blue-400 uppercase tracking-widest border-b border-white/5 pb-2">Weekly Mess Menu</h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map((day) => {
                        const dayMenu = pgForm.messMenu[day as keyof typeof pgForm.messMenu] || { breakfast: '', lunch: '', dinner: '' };
                        return (
                          <div key={day} className="p-4 rounded-2xl bg-white/[0.02] border border-white/5 space-y-2">
                            <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest block">{day} Menu</span>
                            <div className="grid grid-cols-3 gap-2">
                              <input 
                                placeholder="Breakfast"
                                className="nexus-input py-1.5 px-3 text-xs"
                                value={dayMenu.breakfast}
                                onChange={(e) => {
                                  const updatedMenu = { ...pgForm.messMenu };
                                  updatedMenu[day as keyof typeof pgForm.messMenu] = { ...dayMenu, breakfast: e.target.value };
                                  setPgForm({ ...pgForm, messMenu: updatedMenu });
                                }}
                              />
                              <input 
                                placeholder="Lunch"
                                className="nexus-input py-1.5 px-3 text-xs"
                                value={dayMenu.lunch}
                                onChange={(e) => {
                                  const updatedMenu = { ...pgForm.messMenu };
                                  updatedMenu[day as keyof typeof pgForm.messMenu] = { ...dayMenu, lunch: e.target.value };
                                  setPgForm({ ...pgForm, messMenu: updatedMenu });
                                }}
                              />
                              <input 
                                placeholder="Dinner"
                                className="nexus-input py-1.5 px-3 text-xs"
                                value={dayMenu.dinner}
                                onChange={(e) => {
                                  const updatedMenu = { ...pgForm.messMenu };
                                  updatedMenu[day as keyof typeof pgForm.messMenu] = { ...dayMenu, dinner: e.target.value };
                                  setPgForm({ ...pgForm, messMenu: updatedMenu });
                                }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Rules */}
                  <div className="space-y-4 col-span-full">
                    <h4 className="text-xs font-black text-blue-400 uppercase tracking-widest border-b border-white/5 pb-2">Rules & Regulations</h4>
                    <div className="space-y-2">
                      {pgForm.rules.map((rule, idx) => (
                        <div key={idx} className="flex justify-between items-center bg-white/5 border border-white/5 p-2 rounded-xl text-xs text-white">
                          <span>{idx + 1}. {rule}</span>
                          <button 
                            type="button" 
                            onClick={() => {
                              const updatedRules = [...pgForm.rules];
                              updatedRules.splice(idx, 1);
                              setPgForm({ ...pgForm, rules: updatedRules });
                            }}
                            className="text-red-400 hover:text-red-300 font-bold"
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                    </div>
                    <div className="flex gap-2">
                      <input 
                        placeholder="e.g. Curfew time is 10:00 PM"
                        className="nexus-input flex-1 py-2 px-3 text-xs"
                        value={newRule}
                        onChange={(e) => setNewRule(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            if (newRule.trim()) {
                              setPgForm({ ...pgForm, rules: [...pgForm.rules, newRule.trim()] });
                              setNewRule('');
                            }
                          }
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => {
                          if (newRule.trim()) {
                            setPgForm({ ...pgForm, rules: [...pgForm.rules, newRule.trim()] });
                            setNewRule('');
                          }
                        }}
                        className="px-4 py-2 bg-blue-600/20 text-blue-400 border border-blue-500/20 text-[10px] font-black uppercase tracking-widest rounded-xl hover:bg-blue-600/30"
                      >
                        Add Rule
                      </button>
                    </div>
                  </div>

                  <div className="space-y-2 col-span-full">
                    <label className="text-[10px] font-black uppercase tracking-widest text-gray-500 block">Description</label>
                    <textarea
                      placeholder="Brief description..."
                      className="nexus-input h-20 resize-none"
                      value={pgForm.description}
                      onChange={(e) => setPgForm({ ...pgForm, description: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2 col-span-full">
                    <label className="text-[10px] font-black uppercase tracking-widest text-gray-500 block mb-2">Amenities Checklist</label>
                    <div className="flex flex-wrap gap-2">
                      {AVAILABLE_AMENITIES.map((amenity) => {
                        const isSelected = pgForm.amenities.includes(amenity);
                        return (
                          <button
                            key={amenity}
                            type="button"
                            onClick={() => handleAmenityToggle(amenity)}
                            className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest border transition-all ${
                              isSelected
                                ? 'bg-blue-500/10 border-blue-500/30 text-blue-400'
                                : 'bg-white/5 border-white/10 text-gray-500 hover:border-white/20'
                            }`}
                          >
                            {amenity}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 col-span-full bg-white/[0.02] border border-white/5 p-4 rounded-2xl">
                    <input
                      type="checkbox"
                      id="pgIsActive"
                      className="w-4 h-4 rounded border-white/10 bg-white/5 text-emerald-500 accent-emerald-500 cursor-pointer"
                      checked={pgForm.isActive}
                      onChange={(e) => setPgForm({ ...pgForm, isActive: e.target.checked })}
                    />
                    <label htmlFor="pgIsActive" className="text-xs font-bold text-gray-300 cursor-pointer select-none">
                      Operational (Active on Marketplace)
                    </label>
                  </div>
                </div>
                <div className="flex gap-4 pt-4 border-t border-white/5">
                  <button
                    type="submit"
                    className="flex-1 py-4 bg-blue-600 hover:bg-blue-500 text-white font-black uppercase tracking-widest rounded-2xl text-xs"
                  >
                    Save Hostel Details
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingPG(null)}
                    className="px-8 py-4 bg-white/5 text-gray-400 hover:bg-white/10 font-black uppercase tracking-widest rounded-2xl text-xs"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}

            {/* TAB 2: ROOMS */}
            {activeTab === 'rooms' && (
              <div className="space-y-8">
                <div className="flex justify-between items-center">
                  <h3 className="text-sm font-black text-white uppercase tracking-wider">Room Configurations</h3>
                  <button
                    onClick={() => setIsAddingRoom(!isAddingRoom)}
                    className="px-4 py-2 bg-blue-600/20 text-blue-400 border border-blue-500/20 text-[9px] font-black uppercase tracking-widest rounded-xl hover:bg-blue-600/30"
                  >
                    {isAddingRoom ? 'Close Adder' : 'Add New Room'}
                  </button>
                </div>

                {isAddingRoom && (
                  <form onSubmit={handleCreateRoom} className="p-6 border border-blue-500/20 bg-blue-500/[0.02] rounded-3xl space-y-4 animate-slide-up">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <div className="space-y-1">
                        <label className="text-[8px] font-black text-gray-500 uppercase tracking-widest block">Room Number</label>
                        <input
                          required
                          className="nexus-input py-2 px-3 text-xs"
                          value={roomForm.roomNumber}
                          onChange={(e) => setRoomForm({ ...roomForm, roomNumber: e.target.value })}
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[8px] font-black text-gray-500 uppercase tracking-widest block">Sharing Type</label>
                        <select
                          className="nexus-select py-2 px-3 text-xs"
                          value={roomForm.sharingType}
                          onChange={(e) => setRoomForm({ ...roomForm, sharingType: parseInt(e.target.value) })}
                        >
                          <option value="1">1 Seater</option>
                          <option value="2">2 Seater</option>
                          <option value="3">3 Seater</option>
                          <option value="4">4 Seater</option>
                        </select>
                      </div>
                      <div className="space-y-1">
                        <label className="text-[8px] font-black text-gray-500 uppercase tracking-widest block">Rent / Bed (₹)</label>
                        <input
                          type="number"
                          required
                          className="nexus-input py-2 px-3 text-xs"
                          value={roomForm.pricePerBed}
                          onChange={(e) => setRoomForm({ ...roomForm, pricePerBed: parseInt(e.target.value) })}
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[8px] font-black text-gray-500 uppercase tracking-widest block">Floor Number</label>
                        <input
                          type="number"
                          required
                          className="nexus-input py-2 px-3 text-xs"
                          value={roomForm.floorNumber}
                          onChange={(e) => setRoomForm({ ...roomForm, floorNumber: parseInt(e.target.value) })}
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[8px] font-black text-gray-500 uppercase tracking-widest block">Total Beds</label>
                        <input
                          type="number"
                          required
                          className="nexus-input py-2 px-3 text-xs"
                          value={roomForm.totalBeds}
                          onChange={(e) => setRoomForm({ ...roomForm, totalBeds: parseInt(e.target.value), availableBeds: parseInt(e.target.value) })}
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[8px] font-black text-gray-500 uppercase tracking-widest block">Furnishing</label>
                        <select
                          className="nexus-select py-2 px-3 text-xs"
                          value={roomForm.furnishing}
                          onChange={(e) => setRoomForm({ ...roomForm, furnishing: e.target.value })}
                        >
                          <option value="Fully Furnished">Fully Furnished</option>
                          <option value="Semi Furnished">Semi Furnished</option>
                          <option value="Unfurnished">Unfurnished</option>
                        </select>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-4 pt-2">
                      <label className="flex items-center gap-2 text-[9px] font-black uppercase text-gray-400">
                        <input
                          type="checkbox"
                          checked={roomForm.hasAttachedBathroom}
                          onChange={(e) => setRoomForm({ ...roomForm, hasAttachedBathroom: e.target.checked })}
                          className="w-3.5 h-3.5 rounded bg-white/5 border-white/10 accent-blue-500"
                        />
                        Attached Bath
                      </label>
                      <label className="flex items-center gap-2 text-[9px] font-black uppercase text-gray-400">
                        <input
                          type="checkbox"
                          checked={roomForm.hasAC}
                          onChange={(e) => setRoomForm({ ...roomForm, hasAC: e.target.checked })}
                          className="w-3.5 h-3.5 rounded bg-white/5 border-white/10 accent-blue-500"
                        />
                        AC Installed
                      </label>
                      <label className="flex items-center gap-2 text-[9px] font-black uppercase text-gray-400">
                        <input
                          type="checkbox"
                          checked={roomForm.hasBalcony}
                          onChange={(e) => setRoomForm({ ...roomForm, hasBalcony: e.target.checked })}
                          className="w-3.5 h-3.5 rounded bg-white/5 border-white/10 accent-blue-500"
                        />
                        Balcony
                      </label>
                    </div>
                    <button
                      type="submit"
                      className="w-full py-3 bg-blue-600 hover:bg-blue-500 text-white font-black uppercase tracking-widest rounded-xl text-[10px]"
                    >
                      Save Room Node
                    </button>
                  </form>
                )}

                {loadingRooms ? (
                  <div className="text-center py-10 text-gray-500 text-xs font-mono animate-pulse">Syncing rooms...</div>
                ) : rooms.length === 0 ? (
                  <div className="text-center py-10 text-gray-600 text-xs italic">No rooms onboarded for this PG.</div>
                ) : (
                  <div className="grid grid-cols-1 gap-4">
                    {rooms.map((room) => (
                      <div key={room.id} className="p-5 border border-white/5 bg-white/[0.01] rounded-2xl space-y-4">
                        <div className="flex justify-between items-start">
                          <div>
                            <span className="text-xs font-bold text-gray-400 block">Room Number</span>
                            <input
                              type="text"
                              defaultValue={room.roomNumber}
                              className="bg-transparent border-b border-transparent focus:border-blue-500 text-sm font-black text-white outline-none w-20"
                              onBlur={(e) => handleUpdateRoom(room.id, { roomNumber: e.target.value })}
                            />
                          </div>
                          <div className="flex gap-2">
                            <button
                              onClick={() => handleUpdateRoom(room.id, { isActive: !room.isActive })}
                              className={`px-3 py-1 text-[8px] font-black uppercase tracking-widest rounded border transition-all ${
                                room.isActive
                                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                                  : 'bg-red-500/10 border-red-500/30 text-red-400'
                              }`}
                            >
                              {room.isActive ? 'Active' : 'Inactive'}
                            </button>
                            <button
                              onClick={() => handleDeleteRoom(room.id)}
                              className="text-red-500/40 hover:text-red-500 text-xs px-2"
                            >
                              ✕
                            </button>
                          </div>
                        </div>

                        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                          <div>
                            <label className="text-[8px] font-black text-gray-500 uppercase tracking-widest block mb-1">Sharing</label>
                            <select
                              defaultValue={room.sharingType}
                              className="bg-white/5 border border-white/10 rounded px-2 py-1 text-xs text-white outline-none w-full"
                              onChange={(e) => handleUpdateRoom(room.id, { sharingType: parseInt(e.target.value) })}
                            >
                              <option value="1">1 Seater</option>
                              <option value="2">2 Seater</option>
                              <option value="3">3 Seater</option>
                              <option value="4">4 Seater</option>
                            </select>
                          </div>
                          <div>
                            <label className="text-[8px] font-black text-gray-500 uppercase tracking-widest block mb-1">Rent / Bed</label>
                            <input
                              type="number"
                              defaultValue={room.pricePerBed}
                              className="bg-white/5 border border-white/10 rounded px-2 py-1 text-xs text-white outline-none w-full"
                              onBlur={(e) => handleUpdateRoom(room.id, { pricePerBed: parseInt(e.target.value) })}
                            />
                          </div>
                          <div>
                            <label className="text-[8px] font-black text-gray-500 uppercase tracking-widest block mb-1">Floor</label>
                            <input
                              type="number"
                              defaultValue={room.floorNumber}
                              className="bg-white/5 border border-white/10 rounded px-2 py-1 text-xs text-white outline-none w-full"
                              onBlur={(e) => handleUpdateRoom(room.id, { floorNumber: parseInt(e.target.value) })}
                            />
                          </div>
                          <div>
                            <label className="text-[8px] font-black text-gray-500 uppercase tracking-widest block mb-1">Total Beds</label>
                            <input
                              type="number"
                              defaultValue={room.totalBeds}
                              className="bg-white/5 border border-white/10 rounded px-2 py-1 text-xs text-white outline-none w-full"
                              onBlur={(e) => handleUpdateRoom(room.id, { totalBeds: parseInt(e.target.value) })}
                            />
                          </div>
                          <div>
                            <label className="text-[8px] font-black text-blue-400 uppercase tracking-widest block mb-1">Avail Beds</label>
                            <input
                              type="number"
                              defaultValue={room.availableBeds}
                              className="bg-blue-950/10 border border-blue-900/20 rounded px-2 py-1 text-xs text-blue-400 outline-none w-full font-bold"
                              onBlur={(e) => handleUpdateRoom(room.id, { availableBeds: parseInt(e.target.value) })}
                            />
                          </div>
                        </div>

                        <div className="flex flex-wrap gap-4 pt-2">
                          <label className="flex items-center gap-2 text-[8px] font-black uppercase text-gray-400 cursor-pointer">
                            <input
                              type="checkbox"
                              defaultChecked={room.hasAttachedBathroom}
                              onChange={(e) => handleUpdateRoom(room.id, { hasAttachedBathroom: e.target.checked })}
                              className="w-3 h-3 accent-blue-500"
                            />
                            Attached Bath
                          </label>
                          <label className="flex items-center gap-2 text-[8px] font-black uppercase text-gray-400 cursor-pointer">
                            <input
                              type="checkbox"
                              defaultChecked={room.hasAC}
                              onChange={(e) => handleUpdateRoom(room.id, { hasAC: e.target.checked })}
                              className="w-3 h-3 accent-blue-500"
                            />
                            AC Installed
                          </label>
                          <label className="flex items-center gap-2 text-[8px] font-black uppercase text-gray-400 cursor-pointer">
                            <input
                              type="checkbox"
                              defaultChecked={room.hasBalcony}
                              onChange={(e) => handleUpdateRoom(room.id, { hasBalcony: e.target.checked })}
                              className="w-3 h-3 accent-blue-500"
                            />
                            Balcony
                          </label>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
