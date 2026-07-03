"use client";
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import Navbar from '@/components/Navbar';
import SafeImage from '@/components/SafeImage';
import Tilt from '@/components/Tilt';
import Magnetic from '@/components/Magnetic';
import { API_URL } from '@/utils/api';

interface UserProfile {
  _id?: string;
  id?: string;
  name: string;
  phone: string;
  gender: string;
  genderPreference: string;
  walletBalance: number;
}

interface RidePool {
  id: string;
  creatorId: string;
  creatorRole: 'rider' | 'passenger';
  coRiderId: string | null;
  origin: string;
  destination: string;
  departureTime: string;
  estimatedFuelCost: number;
  splitAmount: number;
  vehicleInfo: string | null;
  genderPreference: string;
  status: 'Available' | 'Matched' | 'Completed' | 'Cancelled';
  paymentStatus: 'Unpaid' | 'Paid';
  notes: string | null;
  creator?: {
    id: string;
    name: string;
    phone: string;
    gender: string;
    genderPreference: string;
    profileImage: string | null;
  };
  coRider?: {
    id: string;
    name: string;
    phone: string;
    gender: string;
    profileImage: string | null;
  };
  createdAt: string;
}

export default function BikePoolPage() {
  const router = useRouter();
  const [user, setUser] = useState<UserProfile | null>(null);
  const [activeTab, setActiveTab] = useState<'browse' | 'my-rides'>('browse');
  
  // Available Pools List
  const [pools, setPools] = useState<RidePool[]>([]);
  const [loadingPools, setLoadingPools] = useState(true);

  // My Pools (active & history)
  const [myRides, setMyRides] = useState<RidePool[]>([]);
  const [loadingMyRides, setLoadingMyRides] = useState(true);

  // Form State
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [formData, setFormData] = useState({
    creatorRole: 'rider' as 'rider' | 'passenger',
    origin: '',
    destination: '',
    departureTime: '',
    estimatedFuelCost: 100,
    vehicleInfo: '',
    notes: ''
  });

  // Profile Setup State (for inline editing of gender & pref)
  const [showProfileSetup, setShowProfileSetup] = useState(false);
  const [updatingProfile, setUpdatingProfile] = useState(false);
  const [genderData, setGenderData] = useState({
    gender: 'Prefer not to say',
    genderPreference: 'Any'
  });

  // Modal / Receipt Overlays
  const [selectedRide, setSelectedRide] = useState<RidePool | null>(null);
  const [joiningRideId, setJoiningRideId] = useState<string | null>(null);
  const [completingRideId, setCompletingRideId] = useState<string | null>(null);
  const [cancellingRideId, setCancellingRideId] = useState<string | null>(null);
  const [feedbackOverlay, setFeedbackOverlay] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    type: 'success' | 'error' | 'info';
  }>({ isOpen: false, title: '', message: '', type: 'info' });

  const triggerFeedback = (title: string, message: string, type: 'success' | 'error' | 'info' = 'info') => {
    setFeedbackOverlay({ isOpen: true, title, message, type });
  };

  // Sync profile & local user data
  const syncLocalUser = (updatedData: Partial<UserProfile>) => {
    const stored = localStorage.getItem('user');
    if (stored) {
      const parsed = JSON.parse(stored);
      const merged = { ...parsed, ...updatedData };
      localStorage.setItem('user', JSON.stringify(merged));
      setUser(merged);
    }
  };

  const fetchProfile = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/users/profile`);
      if (res.status === 401) {
        router.push('/login');
        return;
      }
      if (res.ok) {
        const data = await res.json();
        setUser(data);
        setGenderData({
          gender: data.gender || 'Prefer not to say',
          genderPreference: data.genderPreference || 'Any'
        });
        // Check if details are unset to nudge configuration
        if (!data.gender || data.gender === 'Prefer not to say') {
          setShowProfileSetup(true);
        }
      } else {
        // Fallback to local
        const stored = localStorage.getItem('user');
        if (stored) {
          const parsed = JSON.parse(stored);
          setUser(parsed);
          setGenderData({
            gender: parsed.gender || 'Prefer not to say',
            genderPreference: parsed.genderPreference || 'Any'
          });
        } else {
          router.push('/login');
        }
      }
    } catch {
      const stored = localStorage.getItem('user');
      if (stored) {
        const parsed = JSON.parse(stored);
        setUser(parsed);
      }
    }
  }, [router]);

  const fetchAvailablePools = useCallback(async () => {
    setLoadingPools(true);
    try {
      const res = await fetch(`${API_URL}/api/bikepool/posts`);
      if (res.ok) {
        const data = await res.json();
        setPools(data);
      }
    } catch (err) {
      console.error('Failed to fetch available pools', err);
    } finally {
      setLoadingPools(false);
    }
  }, []);

  const fetchMyRides = useCallback(async () => {
    setLoadingMyRides(true);
    try {
      const res = await fetch(`${API_URL}/api/bikepool/my-rides`);
      if (res.ok) {
        const data = await res.json();
        setMyRides(data);
      }
    } catch (err) {
      console.error('Failed to fetch my rides', err);
    } finally {
      setLoadingMyRides(false);
    }
  }, []);

  useEffect(() => {
    fetchProfile();
    fetchAvailablePools();
    fetchMyRides();
  }, [fetchProfile, fetchAvailablePools, fetchMyRides]);

  // Handle Profile Update
  const handleUpdateGenderSettings = async () => {
    setUpdatingProfile(true);
    try {
      const res = await fetch(`${API_URL}/api/users/profile`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(genderData)
      });
      if (res.ok) {
        const updated = await res.json();
        syncLocalUser(updated);
        triggerFeedback('Preferences Updated 🔒', 'Your safety matching preferences are secured.', 'success');
        setShowProfileSetup(false);
      } else {
        triggerFeedback('Error', 'Failed to update preferences.', 'error');
      }
    } catch {
      triggerFeedback('Network Error', 'Check your connection.', 'error');
    } finally {
      setUpdatingProfile(false);
    }
  };

  // Create Listing
  const handleCreatePool = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.origin || !formData.destination || !formData.departureTime) {
      triggerFeedback('Missing Info', 'Please fill in all required fields.', 'error');
      return;
    }
    setCreating(true);
    try {
      const res = await fetch(`${API_URL}/api/bikepool/posts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });
      if (res.ok) {
        triggerFeedback('Co-Ride Posted! 🏍️', 'Your listing is online. We will match you shortly.', 'success');
        setShowCreateModal(false);
        setFormData({
          creatorRole: 'rider',
          origin: '',
          destination: '',
          departureTime: '',
          estimatedFuelCost: 100,
          vehicleInfo: '',
          notes: ''
        });
        fetchAvailablePools();
        fetchMyRides();
      } else {
        const data = await res.json();
        triggerFeedback('Error', data.message || 'Failed to create post.', 'error');
      }
    } catch {
      triggerFeedback('Network Error', 'Unable to reach servers.', 'error');
    } finally {
      setCreating(false);
    }
  };

  // Join Pool matching request
  const handleJoinPool = async (id: string) => {
    setJoiningRideId(id);
    try {
      const res = await fetch(`${API_URL}/api/bikepool/posts/${id}/join`, {
        method: 'POST'
      });
      const data = await res.json();
      if (res.ok) {
        triggerFeedback('Matched! 🎉', 'You have matched successfully. Connect with your co-rider now!', 'success');
        fetchAvailablePools();
        fetchMyRides();
        setActiveTab('my-rides');
      } else {
        triggerFeedback('Cannot Match', data.message || 'Gender or wallet validation failed.', 'error');
      }
    } catch {
      triggerFeedback('Network Error', 'Failed to join pool.', 'error');
    } finally {
      setJoiningRideId(null);
    }
  };

  // Complete Ride (Split Petrol Invoice)
  const handleCompletePool = async (id: string) => {
    setCompletingRideId(id);
    try {
      const res = await fetch(`${API_URL}/api/bikepool/posts/${id}/complete`, {
        method: 'POST'
      });
      const data = await res.json();
      if (res.ok) {
        triggerFeedback('Completed & Split! 💳', `Petrol share transferred successfully. Your wallet balance is now ₹${data.walletBalance}.`, 'success');
        
        // Sync local user wallet
        syncLocalUser({ walletBalance: data.walletBalance });

        fetchAvailablePools();
        fetchMyRides();
        setSelectedRide(null);
      } else {
        triggerFeedback('Unable to Complete', data.message || 'Split transaction failed.', 'error');
      }
    } catch {
      triggerFeedback('Network Error', 'Could not complete transaction.', 'error');
    } finally {
      setCompletingRideId(null);
    }
  };

  // Cancel Pool
  const handleCancelPool = async (id: string) => {
    setCancellingRideId(id);
    try {
      const res = await fetch(`${API_URL}/api/bikepool/posts/${id}/cancel`, {
        method: 'POST'
      });
      if (res.ok) {
        triggerFeedback('Cancelled', 'Listing status updated.', 'info');
        fetchAvailablePools();
        fetchMyRides();
        setSelectedRide(null);
      } else {
        const data = await res.json();
        triggerFeedback('Failed', data.message || 'Unable to update status.', 'error');
      }
    } catch {
      triggerFeedback('Network Error', 'Connection lost.', 'error');
    } finally {
      setCancellingRideId(null);
    }
  };

  const getActiveRides = () => {
    return myRides.filter(r => r.status === 'Available' || r.status === 'Matched');
  };

  const getHistoryRides = () => {
    return myRides.filter(r => r.status === 'Completed' || r.status === 'Cancelled');
  };

  const formatDateTime = (dateStr: string) => {
    try {
      const d = new Date(dateStr);
      return d.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return dateStr;
    }
  };

  return (
    <>
      <Navbar />
      <main className="min-h-screen text-white pb-32 bg-[#0A0A0B] relative overflow-hidden">
        {/* Futuristic Background VFX Layer */}
        <div className="absolute inset-0 z-0 pointer-events-none overflow-hidden">
          <div className="absolute inset-0 opacity-60 bg-[radial-gradient(circle_at_50%_0%,rgba(165,180,252,0.08),transparent_70%)]" />
          <div className="fixed inset-0 pointer-events-none z-0">
            <div className="absolute top-1/4 -right-40 w-96 h-96 rounded-full blur-[120px] bg-indigo-500/[0.05]" />
            <div className="absolute bottom-1/3 -left-32 w-80 h-80 rounded-full blur-[100px] bg-primary-yellow/[0.03]" />
          </div>
        </div>

        <div className="max-w-[1200px] mx-auto px-4 pt-24 relative z-10">
          
          {/* Header Title */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-8">
            <div>
              <h2 className="text-[10px] font-black uppercase tracking-[0.4em] text-indigo-400 mb-1">Collaborative Commute</h2>
              <h1 className="text-3xl md:text-4xl font-black text-white italic tracking-tighter uppercase" style={{ fontFamily: "'Syne', sans-serif" }}>
                Zenvy Co-Ride 🏍️
              </h1>
              <p className="text-xs text-gray-400 mt-1">Split petrol bills. Enforce strict safety matching. Travel together.</p>
            </div>
            
            <div className="flex items-center gap-3">
              <div className="bg-white/5 border border-white/10 rounded-2xl px-4 py-2 flex flex-col items-end">
                <span className="text-[8px] font-bold text-[#C9A84C] uppercase tracking-widest leading-none">Wallet</span>
                <span className="text-sm font-black text-white mt-1">₹{user?.walletBalance || 0}</span>
              </div>
              
              <Magnetic>
                <button
                  onClick={() => setShowCreateModal(true)}
                  className="bg-primary-yellow text-black text-xs font-black px-6 py-3.5 rounded-2xl uppercase tracking-tighter shadow-lg shadow-primary-yellow/20 hover:scale-105 active:scale-95 transition-all"
                >
                  Post a Ride +
                </button>
              </Magnetic>
            </div>
          </div>

          {/* Interactive Profile Gender Setup Banner */}
          <AnimatePresence>
            {showProfileSetup && (
              <motion.div
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="mb-8 p-6 glass-card-extreme border-indigo-500/20 rounded-[30px] relative overflow-hidden"
              >
                <div className="absolute inset-0 bg-gradient-to-r from-indigo-500/5 to-transparent pointer-events-none" />
                <h3 className="text-sm font-black text-indigo-300 uppercase tracking-widest mb-1">Setup Your Matching Preferences 🔒</h3>
                <p className="text-xs text-gray-400 mb-4 max-w-2xl">
                  Co-Ride uses gender matching checks to ensure maximum safety. Set your gender and preferences to query matches.
                </p>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-xl">
                  <div>
                    <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-2">My Gender</label>
                    <select
                      value={genderData.gender}
                      onChange={(e) => setGenderData(prev => ({ ...prev, gender: e.target.value }))}
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-xs text-white focus:border-indigo-400 outline-none"
                    >
                      <option value="Prefer not to say" className="bg-[#141416]">Prefer Not to Say</option>
                      <option value="Male" className="bg-[#141416]">Male</option>
                      <option value="Female" className="bg-[#141416]">Female</option>
                      <option value="Other" className="bg-[#141416]">Other</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-2">Matching Safety Preference</label>
                    <select
                      value={genderData.genderPreference}
                      onChange={(e) => setGenderData(prev => ({ ...prev, genderPreference: e.target.value }))}
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-xs text-white focus:border-indigo-400 outline-none"
                    >
                      <option value="Any" className="bg-[#141416]">Match with Any Gender</option>
                      <option value="Same Gender Only" className="bg-[#141416]">Strictly Same Gender Only</option>
                    </select>
                  </div>
                </div>

                <div className="mt-4 flex gap-3">
                  <button
                    onClick={handleUpdateGenderSettings}
                    disabled={updatingProfile}
                    className="bg-indigo-500 hover:bg-indigo-600 disabled:bg-indigo-500/50 text-white text-[10px] font-black uppercase px-6 py-2.5 rounded-xl tracking-wider transition-all"
                  >
                    {updatingProfile ? 'Saving...' : 'Save Settings'}
                  </button>
                  <button
                    onClick={() => setShowProfileSetup(false)}
                    className="text-gray-400 hover:text-white text-[10px] font-bold uppercase px-4 py-2.5"
                  >
                    Dismiss
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Navigation Tabs */}
          <div className="flex gap-4 border-b border-white/10 pb-4 mb-6">
            <button
              onClick={() => setActiveTab('browse')}
              className={`text-xs font-black uppercase tracking-widest pb-1 transition-all relative ${activeTab === 'browse' ? 'text-white' : 'text-gray-500 hover:text-white'}`}
            >
              Browse Matches
              {activeTab === 'browse' && (
                <motion.div layoutId="tabLine" className="absolute -bottom-[17px] left-0 right-0 h-0.5 bg-primary-yellow" />
              )}
            </button>
            <button
              onClick={() => setActiveTab('my-rides')}
              className={`text-xs font-black uppercase tracking-widest pb-1 transition-all relative ${activeTab === 'my-rides' ? 'text-white' : 'text-gray-500 hover:text-white'}`}
            >
              My Commutes & Active Matches
              {getActiveRides().length > 0 && (
                <span className="ml-2 bg-indigo-500 text-white text-[9px] px-1.5 py-0.5 rounded-full font-black animate-pulse">
                  {getActiveRides().length}
                </span>
              )}
              {activeTab === 'my-rides' && (
                <motion.div layoutId="tabLine" className="absolute -bottom-[17px] left-0 right-0 h-0.5 bg-primary-yellow" />
              )}
            </button>
          </div>

          {/* TABS CONTAINER */}
          <div>
            {/* Browse Matches Tab */}
            {activeTab === 'browse' && (
              <div>
                {loadingPools ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {[1, 2, 3].map(i => (
                      <div key={i} className="glass-card-extreme p-6 rounded-[30px] min-h-[180px] skeleton" />
                    ))}
                  </div>
                ) : pools.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-20 bg-white/[0.02] border border-white/5 rounded-[30px] text-center p-6">
                    <span className="text-4xl mb-4">🏍️</span>
                    <h3 className="text-sm font-black uppercase tracking-wider text-gray-400">No Active Pool Listings</h3>
                    <p className="text-xs text-gray-500 mt-1 max-w-sm">No one is currently pooling to your destinations. Be the first to post a ride!</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {pools.map(pool => {
                      const isRider = pool.creatorRole === 'rider';
                      const badgeColor = isRider ? 'border-primary-yellow/30 bg-primary-yellow/10 text-primary-yellow' : 'border-indigo-400/30 bg-indigo-400/10 text-indigo-400';
                      
                      return (
                        <Tilt key={pool.id} className="glass-card-extreme p-6 border-white/[0.05] rounded-[30px] relative overflow-hidden flex flex-col justify-between group hover:border-white/10 transition-all">
                          <div>
                            {/* Card Header */}
                            <div className="flex justify-between items-start mb-4">
                              <span className={`text-[8px] font-black uppercase px-2.5 py-1 rounded-full border ${badgeColor}`}>
                                {isRider ? '🏍️ Rider (Owner)' : '🎒 Passenger'}
                              </span>
                              <div className="text-right">
                                <span className="text-[8px] text-gray-400 uppercase tracking-widest block">Cost Split</span>
                                <span className="text-sm font-black text-emerald-400">₹{pool.splitAmount}</span>
                              </div>
                            </div>

                            {/* Origin & Destination */}
                            <div className="mb-4">
                              <div className="flex items-center gap-2 mb-1.5 min-w-0">
                                <span className="text-xs text-gray-400 shrink-0">From</span>
                                <span className="text-xs font-bold text-white truncate" title={pool.origin}>{pool.origin}</span>
                              </div>
                              <div className="flex items-center gap-2 min-w-0">
                                <span className="text-xs text-gray-400 shrink-0">To</span>
                                <span className="text-xs font-bold text-white truncate" title={pool.destination}>{pool.destination}</span>
                              </div>
                            </div>

                            {/* Info Row */}
                            <div className="grid grid-cols-2 gap-2 border-t border-white/5 pt-3 mb-4">
                              <div>
                                <span className="text-[7px] text-gray-500 uppercase tracking-wider block">Departure</span>
                                <span className="text-[10px] font-bold text-white">{formatDateTime(pool.departureTime)}</span>
                              </div>
                              <div>
                                <span className="text-[7px] text-gray-500 uppercase tracking-wider block">Co-rider Gender</span>
                                <span className="text-[10px] font-bold text-white flex items-center gap-1">
                                  👤 {pool.creator?.gender || 'Unknown'} 
                                  <span className="text-[7px] text-gray-500">({pool.creator?.genderPreference === 'Same Gender Only' ? 'Strict' : 'Any'})</span>
                                </span>
                              </div>
                            </div>

                            {pool.vehicleInfo && (
                              <p className="text-[9px] text-gray-400 italic mb-2">Vehicle: {pool.vehicleInfo}</p>
                            )}
                            {pool.notes && (
                              <p className="text-[9px] text-gray-500 line-clamp-2">"{pool.notes}"</p>
                            )}
                          </div>

                          <div className="mt-4 pt-3 border-t border-white/5 flex items-center justify-between gap-4">
                            <div className="flex items-center gap-2">
                              <div className="w-8 h-8 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-xs shrink-0 overflow-hidden relative">
                                {pool.creator?.profileImage ? (
                                  <SafeImage src={pool.creator.profileImage} alt={pool.creator.name} fill className="object-cover" />
                                ) : (
                                  pool.creator?.name?.slice(0, 2).toUpperCase() || 'ZV'
                                )}
                              </div>
                              <div className="min-w-0">
                                <span className="text-[9px] text-gray-400 block leading-none">Posted By</span>
                                <span className="text-[10px] font-bold text-white truncate block max-w-[100px]">{pool.creator?.name}</span>
                              </div>
                            </div>

                            <button
                              onClick={() => handleJoinPool(pool.id)}
                              disabled={joiningRideId === pool.id}
                              className="bg-white hover:bg-primary-yellow hover:text-black text-black text-[10px] font-black px-4 py-2.5 rounded-xl uppercase tracking-tighter disabled:opacity-50 transition-all shrink-0"
                            >
                              {joiningRideId === pool.id ? 'Matching...' : 'Join Ride'}
                            </button>
                          </div>
                        </Tilt>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* My Commutes Tab */}
            {activeTab === 'my-rides' && (
              <div>
                {/* Active Matches & Listings */}
                <section className="mb-10">
                  <h2 className="text-[10px] font-black uppercase tracking-[0.3em] text-indigo-300 mb-4">Active Link Matches</h2>
                  
                  {loadingMyRides ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div className="glass-card-extreme p-6 rounded-[30px] min-h-[160px] skeleton" />
                    </div>
                  ) : getActiveRides().length === 0 ? (
                    <div className="py-12 bg-white/[0.01] border border-white/5 rounded-[30px] text-center p-6">
                      <p className="text-xs text-gray-500">You have no active ride shares or pending listings.</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      {getActiveRides().map(ride => {
                        const isCreator = ride.creatorId === user?.id || ride.creatorId === user?._id;
                        const isMatched = ride.status === 'Matched';
                        
                        // Resolve co-rider information
                        const otherPerson = isCreator 
                          ? ride.coRider 
                          : ride.creator;

                        return (
                          <div key={ride.id} className="glass-card-extreme p-6 border-white/[0.05] rounded-[30px] relative overflow-hidden flex flex-col justify-between">
                            <div className="absolute top-0 right-0 bg-indigo-500/10 border-l border-b border-indigo-500/20 text-indigo-400 text-[8px] font-black px-3 py-1.5 uppercase rounded-bl-xl">
                              {ride.status}
                            </div>
                            
                            <div>
                              <div className="flex items-center gap-3 mb-4">
                                <span className="text-[8px] font-black uppercase px-2.5 py-1 rounded-full border border-white/10 bg-white/5">
                                  {ride.creatorRole === 'rider' ? (isCreator ? '🏍️ You are Rider' : '🎒 You are Passenger') : (isCreator ? '🎒 You are Passenger' : '🏍️ You are Rider')}
                                </span>
                              </div>

                              <div className="grid grid-cols-2 gap-4 mb-4">
                                <div>
                                  <span className="text-[7px] text-gray-500 uppercase block">Route</span>
                                  <p className="text-xs font-black text-white">{ride.origin} → {ride.destination}</p>
                                </div>
                                <div>
                                  <span className="text-[7px] text-gray-500 uppercase block">Departure</span>
                                  <p className="text-xs font-black text-white">{formatDateTime(ride.departureTime)}</p>
                                </div>
                              </div>

                              {isMatched && otherPerson ? (
                                <div className="p-4 bg-white/5 border border-white/5 rounded-2xl mb-4">
                                  <span className="text-[7px] text-indigo-400 uppercase tracking-widest block mb-2">Matched Co-rider</span>
                                  <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                      <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-xs overflow-hidden relative">
                                        {otherPerson.profileImage ? (
                                          <SafeImage src={otherPerson.profileImage} alt={otherPerson.name} fill className="object-cover" />
                                        ) : (
                                          otherPerson.name?.slice(0, 2).toUpperCase()
                                        )}
                                      </div>
                                      <div>
                                        <span className="text-xs font-bold text-white block">{otherPerson.name}</span>
                                        <span className="text-[9px] text-gray-400 block">{otherPerson.phone}</span>
                                      </div>
                                    </div>
                                    
                                    <a
                                      href={`https://wa.me/91${otherPerson.phone.replace(/[^0-9]/g, '')}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[9px] font-black px-3 py-1.5 rounded-lg uppercase tracking-wider hover:bg-emerald-500/20 transition-all"
                                    >
                                      Chat on WA
                                    </a>
                                  </div>
                                </div>
                              ) : (
                                <div className="py-4 text-center border border-dashed border-white/10 rounded-2xl mb-4">
                                  <span className="text-xs text-gray-500 animate-pulse">Waiting for a co-rider to match...</span>
                                </div>
                              )}
                            </div>

                            <div className="flex gap-3 pt-3 border-t border-white/5">
                              {isMatched && (
                                <button
                                  onClick={() => setSelectedRide(ride)}
                                  className="flex-1 bg-emerald-500 hover:bg-emerald-600 text-black text-[10px] font-black py-3 rounded-xl uppercase tracking-wider transition-all"
                                >
                                  Invoice & Complete
                                </button>
                              )}
                              <button
                                onClick={() => handleCancelPool(ride.id)}
                                disabled={cancellingRideId === ride.id}
                                className="bg-red-500/10 border border-red-500/20 text-red-400 text-[10px] font-black px-4 py-3 rounded-xl uppercase tracking-wider hover:bg-red-500/20 transition-all"
                              >
                                {cancellingRideId === ride.id ? 'Updating...' : isMatched ? 'Unmatch' : 'Cancel Listing'}
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </section>

                {/* Ride History */}
                <section>
                  <h2 className="text-[10px] font-black uppercase tracking-[0.3em] text-gray-500 mb-4">Commute History Archive</h2>
                  
                  {loadingMyRides ? (
                    <div className="glass-card-extreme p-4 rounded-[24px] skeleton h-12" />
                  ) : getHistoryRides().length === 0 ? (
                    <div className="py-6 bg-white/[0.005] border border-white/5 rounded-2xl text-center text-xs text-gray-600">
                      No past rides archived.
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {getHistoryRides().map(ride => {
                        const isCompleted = ride.status === 'Completed';
                        return (
                          <div key={ride.id} className="glass-card-extreme p-4 border-white/[0.03] rounded-2xl flex items-center justify-between gap-4">
                            <div>
                              <div className="flex items-center gap-2 mb-1">
                                <span className={`text-[7px] font-black uppercase px-2 py-0.5 rounded ${isCompleted ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'}`}>
                                  {ride.status}
                                </span>
                                <span className="text-[10px] font-bold text-white">{ride.origin} → {ride.destination}</span>
                              </div>
                              <span className="text-[9px] text-gray-500">{formatDateTime(ride.departureTime)}</span>
                            </div>
                            
                            <div className="text-right">
                              <span className="text-[9px] text-gray-400 block leading-none">{isCompleted ? 'Split Share Paid' : 'Cancelled'}</span>
                              <span className={`text-xs font-black ${isCompleted ? 'text-emerald-400' : 'text-gray-600 line-through'}`}>₹{ride.splitAmount}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </section>
              </div>
            )}
          </div>

        </div>
      </main>

      {/* CREATE POST MODAL */}
      <AnimatePresence>
        {showCreateModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowCreateModal(false)}
              className="absolute inset-0 bg-black/60 backdrop-blur-md"
            />
            
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-[#141416] border border-white/10 rounded-[30px] w-full max-w-lg p-6 relative z-10 overflow-y-auto max-h-[90vh]"
            >
              <h2 className="text-xl font-black text-white italic tracking-tighter uppercase mb-2">Post Co-Ride Offer</h2>
              <p className="text-xs text-gray-400 mb-6">Create a ride share post. Matching algorithm applies safety parameters automatically.</p>
              
              <form onSubmit={handleCreatePool} className="space-y-4">
                
                {/* Role Switcher */}
                <div>
                  <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-2">Your Commute Role</label>
                  <div className="grid grid-cols-2 gap-2 bg-white/5 p-1.5 rounded-2xl border border-white/5">
                    <button
                      type="button"
                      onClick={() => setFormData(prev => ({ ...prev, creatorRole: 'rider' }))}
                      className={`py-2 text-[10px] font-black uppercase tracking-wider rounded-xl transition-all ${formData.creatorRole === 'rider' ? 'bg-primary-yellow text-black' : 'text-gray-400 hover:text-white'}`}
                    >
                      🏍️ Rider (I have a bike)
                    </button>
                    <button
                      type="button"
                      onClick={() => setFormData(prev => ({ ...prev, creatorRole: 'passenger' }))}
                      className={`py-2 text-[10px] font-black uppercase tracking-wider rounded-xl transition-all ${formData.creatorRole === 'passenger' ? 'bg-indigo-400 text-black' : 'text-gray-400 hover:text-white'}`}
                    >
                      🎒 Passenger (No bike)
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-1">Origin Point *</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Shakti Canteen, SRM AP"
                      value={formData.origin}
                      onChange={(e) => setFormData(prev => ({ ...prev, origin: e.target.value }))}
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-xs text-white placeholder-gray-600 outline-none focus:border-indigo-400"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-1">Destination *</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Vijayawada Station"
                      value={formData.destination}
                      onChange={(e) => setFormData(prev => ({ ...prev, destination: e.target.value }))}
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-xs text-white placeholder-gray-600 outline-none focus:border-indigo-400"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-1">Departure Time *</label>
                  <input
                    type="datetime-local"
                    required
                    value={formData.departureTime}
                    onChange={(e) => setFormData(prev => ({ ...prev, departureTime: e.target.value }))}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-xs text-white outline-none focus:border-indigo-400"
                  />
                </div>

                {/* Split Petrol Pricing Calculator */}
                <div>
                  <div className="flex justify-between items-center mb-1">
                    <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Estimated Fuel Cost (₹)</label>
                    <span className="text-xs font-black text-emerald-400">₹{formData.estimatedFuelCost}</span>
                  </div>
                  <input
                    type="range"
                    min="50"
                    max="500"
                    step="10"
                    value={formData.estimatedFuelCost}
                    onChange={(e) => setFormData(prev => ({ ...prev, estimatedFuelCost: parseInt(e.target.value) }))}
                    className="w-full accent-primary-yellow bg-white/10 h-1 rounded-lg"
                  />
                  <span className="text-[9px] text-gray-500 block mt-1">
                    Cost Split Amount: ₹{formData.estimatedFuelCost / 2} deducted from Passenger's wallet, credited to Rider.
                  </span>
                </div>

                {formData.creatorRole === 'rider' && (
                  <div>
                    <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-1">Vehicle Description</label>
                    <input
                      type="text"
                      placeholder="e.g. Black Activa, AP-16-XX"
                      value={formData.vehicleInfo}
                      onChange={(e) => setFormData(prev => ({ ...prev, vehicleInfo: e.target.value }))}
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-xs text-white placeholder-gray-600 outline-none focus:border-indigo-400"
                    />
                  </div>
                )}

                <div>
                  <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-1">Notes / Instructions</label>
                  <textarea
                    rows={2}
                    placeholder="e.g. Carrying luggage, need to leave on time."
                    value={formData.notes}
                    onChange={(e) => setFormData(prev => ({ ...prev, notes: e.target.value }))}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-xs text-white placeholder-gray-600 outline-none focus:border-indigo-400 resize-none"
                  />
                </div>

                <div className="flex gap-4 pt-4 border-t border-white/5">
                  <button
                    type="submit"
                    disabled={creating}
                    className="flex-1 bg-primary-yellow text-black text-xs font-black py-3.5 rounded-xl uppercase tracking-tighter shadow-lg shadow-primary-yellow/10"
                  >
                    {creating ? 'Publishing...' : 'Publish Ride'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowCreateModal(false)}
                    className="bg-white/5 border border-white/10 text-white text-xs font-bold px-6 py-3.5 rounded-xl uppercase tracking-wider hover:bg-white/10"
                  >
                    Cancel
                  </button>
                </div>

              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* RIDE INVOICE / COMPLETE OVERLAY */}
      <AnimatePresence>
        {selectedRide && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedRide(null)}
              className="absolute inset-0 bg-black/60 backdrop-blur-md"
            />
            
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-[#141416] border border-emerald-500/20 rounded-[30px] w-full max-w-sm p-6 relative z-10 text-center"
            >
              {/* Receipt Header */}
              <div className="w-16 h-16 rounded-full bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 text-2xl mx-auto mb-4 animate-pulse">
                🧾
              </div>
              <h2 className="text-xl font-black text-white italic tracking-tighter uppercase mb-1">Co-Ride Invoice</h2>
              <span className="text-[8px] font-black text-gray-500 uppercase tracking-widest block mb-4">Transaction Split Receipt</span>
              
              <div className="p-4 bg-white/5 rounded-2xl text-left space-y-2.5 mb-6 text-xs">
                <div className="flex justify-between">
                  <span className="text-gray-400">Origin:</span>
                  <span className="font-bold text-white">{selectedRide.origin}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Destination:</span>
                  <span className="font-bold text-white">{selectedRide.destination}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Scheduled Time:</span>
                  <span className="font-bold text-white">{formatDateTime(selectedRide.departureTime)}</span>
                </div>
                <div className="h-px bg-white/10 my-2" />
                <div className="flex justify-between text-sm">
                  <span className="font-black text-[#C9A84C] uppercase tracking-wider">Petrol Split Cost:</span>
                  <span className="font-black text-emerald-400">₹{selectedRide.splitAmount}</span>
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <button
                  onClick={() => handleCompletePool(selectedRide.id)}
                  disabled={completingRideId === selectedRide.id}
                  className="w-full bg-emerald-500 text-black text-xs font-black py-4 rounded-xl uppercase tracking-widest shadow-lg shadow-emerald-500/10"
                >
                  {completingRideId === selectedRide.id ? 'Processing Ledger...' : 'Approve & Release Funds'}
                </button>
                <button
                  onClick={() => setSelectedRide(null)}
                  className="w-full bg-white/5 text-gray-400 text-[10px] font-bold py-2.5 rounded-xl uppercase tracking-wider hover:text-white"
                >
                  Dismiss
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* FEEDBACK POPUP */}
      <AnimatePresence>
        {feedbackOverlay.isOpen && (
          <div className="fixed inset-0 z-[999] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/45 backdrop-blur-sm" onClick={() => setFeedbackOverlay(prev => ({ ...prev, isOpen: false }))} />
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-[#18181B] border border-white/10 rounded-3xl p-6 max-w-sm w-full text-center relative z-10 shadow-2xl"
            >
              <h3 className="text-lg font-black text-white mb-2">{feedbackOverlay.title}</h3>
              <p className="text-xs text-gray-400 leading-relaxed mb-6">{feedbackOverlay.message}</p>
              <button
                onClick={() => setFeedbackOverlay(prev => ({ ...prev, isOpen: false }))}
                className="bg-white text-black text-[10px] font-black uppercase px-6 py-2.5 rounded-xl tracking-wider hover:scale-105 active:scale-95 transition-all"
              >
                Continue
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}
