"use client";
import { useState, useEffect, memo } from 'react';
import Image from 'next/image';
import { useAdminAuth } from '@/utils/useAdminAuth';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5005';

const LEGACY_DATA = [
  {
    "id": "biryani-hub",
    "name": "Biryani Hub",
    "imageUrl": "https://images.unsplash.com/photo-1589302168068-964664d93dc0?q=80&w=400&auto=format&fit=crop",
    "categories": ["Biryani", "Kebabs", "Main Course"],
    "vendorType": "RESTAURANT",
    "menu": [
      { "id": "bir-01", "name": "Special Mutton Fry", "price": 280, "description": "Tender goat cooked in traditional spices.", "image": "https://images.unsplash.com/photo-1514327605112-b887c0e61c0a?w=400", "category": "Biryani" },
      { "id": "bir-02", "name": "Royal Egg Biryani", "price": 220, "description": "Fragrant rice with double eggs.", "image": "https://images.unsplash.com/photo-1543339308-43e59d6b73a6?w=400", "category": "Biryani" }
    ]
  },
  {
    "id": "burger-club",
    "name": "The Burger Club",
    "imageUrl": "https://images.unsplash.com/photo-1571091718767-18b5b1457add?q=80&w=400",
    "categories": ["Burgers", "Sides", "Shakes"],
    "vendorType": "RESTAURANT",
    "menu": [
      { "id": "brg-01", "name": "Classic Cheeseburger", "price": 150, "description": "Juicy patty with melted cheddar.", "image": "https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=400", "category": "Burgers" }
    ]
  },
  {
    "id": "pizza-paradise",
    "name": "Pizza Paradise",
    "imageUrl": "https://images.unsplash.com/photo-1513104890138-7c749659a591?q=80&w=400",
    "categories": ["Pizza", "Pasta", "Sides"],
    "vendorType": "RESTAURANT",
    "menu": [
      { "id": "piz-01", "name": "Margherita Classica", "price": 280, "description": "San Marzano tomatoes & fresh mozzarella.", "image": "https://images.unsplash.com/photo-1574071318508-1cdbab80d002?w=400", "category": "Pizza" }
    ]
  },
  {
    "id": "campus-pharmacy",
    "name": "Campus MedPoint",
    "imageUrl": "https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=400",
    "categories": ["First Aid", "Vitamins", "Hygiene"],
    "vendorType": "PHARMACY",
    "menu": [
      { "id": "ph-01", "name": "First Aid Compact Kit", "price": 199, "description": "Essential campus first aid essentials.", "image": "https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=400", "category": "First Aid" },
      { "id": "ph-02", "name": "Vitamin C Booster", "price": 150, "description": "Immune support tablets.", "image": "https://images.unsplash.com/photo-1547489432-cf93fa6c71ee?w=400", "category": "Vitamins" },
      { "id": "ph-03", "name": "Hand Sanitizer Pack", "price": 80, "description": "Alcohol-based sanitizer 3-pack.", "image": "https://images.unsplash.com/photo-1584744982491-665216d95f8b?w=400", "category": "Hygiene" }
    ]
  },
  {
    "id": "campus-stationary",
    "name": "Nexus BookHouse",
    "imageUrl": "https://images.unsplash.com/photo-1531346878377-a5be20888e57?w=400",
    "categories": ["Notebooks", "Pens", "Drafting"],
    "vendorType": "STATIONARY",
    "menu": [
      { "id": "st-01", "name": "Executive Leather Journal", "price": 599, "description": "Premium leather-bound A5 journal.", "image": "https://images.unsplash.com/photo-1531346878377-a5be20888e57?w=400", "category": "Notebooks" },
      { "id": "st-02", "name": "Precision Pen Set", "price": 850, "description": "Professional drafting pen collection.", "image": "https://images.unsplash.com/photo-1583485088034-697b5bc54ccd?w=400", "category": "Pens" },
      { "id": "st-03", "name": "Graph Pad A4 (Pack of 5)", "price": 120, "description": "Engineering graph paper pads.", "image": "https://images.unsplash.com/photo-1456735190827-d1262f71b8a3?w=400", "category": "Drafting" }
    ]
  },
  {
    "id": "campus-laundry",
    "name": "FreshPress Laundry",
    "imageUrl": "https://images.unsplash.com/photo-1545173168-9f1947eebb7f?w=400",
    "categories": ["Dry Wash", "Ironing", "Sneaker Care"],
    "vendorType": "LAUNDRY",
    "menu": [
      { "id": "lnd-01", "name": "Express Dry Cleaning (Suit)", "price": 499, "description": "Premium dry wash for formal wear.", "image": "https://images.unsplash.com/photo-1545173168-9f1947eebb7f?w=400", "category": "Dry Wash" },
      { "id": "lnd-02", "name": "Sneaker Deep Restore", "price": 250, "description": "Full sneaker cleaning & whitening.", "image": "https://images.unsplash.com/photo-1595950653106-6c9ebd614d3a?w=400", "category": "Sneaker Care" },
      { "id": "lnd-03", "name": "Weekly Ironing Pack (10 pcs)", "price": 150, "description": "Iron & fold service for 10 items.", "image": "https://images.unsplash.com/photo-1567113463300-102a7eb3cb26?w=400", "category": "Ironing" }
    ]
  },
  {
    "id": "gym-nutrition-hq",
    "name": "Iron Kitchen: Pro Meals",
    "imageUrl": "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=400",
    "categories": ["Protein Bowls", "Shakes", "Supplements"],
    "vendorType": "GYM",
    "menu": [
      { "id": "gm-01", "name": "High-Protein Salmon Bowl", "price": 350, "description": "30g protein with quinoa & avocado.", "image": "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=400", "category": "Protein Bowls" },
      { "id": "gm-02", "name": "Whey Isolate Shake", "price": 199, "description": "Vanilla whey isolate, 25g protein.", "image": "https://images.unsplash.com/photo-1593095948071-474c5cc2989d?w=400", "category": "Shakes" },
      { "id": "gm-03", "name": "Vegan Protein Crisp Bar", "price": 120, "description": "Plant-based protein bar.", "image": "https://images.unsplash.com/photo-1590301157890-4810ed352733?w=400", "category": "Supplements" }
    ]
  },
  {
    "id": "campus-cafe",
    "name": "Zenvy Brew Bar",
    "imageUrl": "https://images.unsplash.com/photo-1485808191679-5f86510681a2?w=400",
    "categories": ["Coffee", "Tea", "Mocktails"],
    "vendorType": "DRINKS",
    "menu": [
      { "id": "dr-01", "name": "Iced Caramel Macchiato", "price": 160, "description": "Double-shot espresso with caramel drizzle.", "image": "https://images.unsplash.com/photo-1485808191679-5f86510681a2?w=400", "category": "Coffee" },
      { "id": "dr-02", "name": "Matcha Green Tea Latte", "price": 140, "description": "Premium matcha with steamed milk.", "image": "https://images.unsplash.com/photo-1515823064-d6e0c04616a7?w=400", "category": "Tea" },
      { "id": "dr-03", "name": "Nitro Cold Brew", "price": 220, "description": "Nitrogen-infused cold brew coffee.", "image": "https://images.unsplash.com/photo-1517701550927-30cf4bb1dba5?w=400", "category": "Coffee" }
    ]
  },
  {
    "id": "seasonal-gifting",
    "name": "Nexus Gift Lounge",
    "imageUrl": "https://images.unsplash.com/photo-1549465220-1a8b9238cd48?w=400",
    "categories": ["Hampers", "Merch", "Limited Edition"],
    "vendorType": "SEASONAL",
    "menu": [
      { "id": "se-01", "name": "Nexus Holiday Hamper", "price": 999, "description": "Curated premium gift box.", "image": "https://images.unsplash.com/photo-1549465220-1a8b9238cd48?w=400", "category": "Hampers" },
      { "id": "se-02", "name": "Limited Edition Campus Mug", "price": 299, "description": "Collector's edition SRMAP mug.", "image": "https://images.unsplash.com/photo-1514228742587-6b1558fcca3d?w=400", "category": "Merch" }
    ]
  },
  {
    "id": "campus-rentals",
    "name": "Nexus Campus Fleet",
    "imageUrl": "https://images.unsplash.com/photo-1571068316344-75bc76f77891?w=400",
    "categories": ["E-Bikes", "Scooters", "Boards"],
    "vendorType": "RENTAL",
    "menu": [
      { "id": "rn-01", "name": "Nexus E-Bike Pro (Hourly)", "price": 50, "description": "Electric bike rental per hour.", "image": "https://images.unsplash.com/photo-1571068316344-75bc76f77891?w=400", "category": "E-Bikes" },
      { "id": "rn-02", "name": "Electric Longboard X", "price": 75, "description": "Premium electric longboard rental.", "image": "https://images.unsplash.com/photo-1531565637446-32307b194362?w=400", "category": "Boards" },
      { "id": "rn-03", "name": "Classic Campus Cruiser", "price": 30, "description": "Standard bicycle rental per hour.", "image": "https://images.unsplash.com/photo-1485965120184-e220f721d03e?w=400", "category": "E-Bikes" }
    ]
  },
  {
    "id": "fruit-market",
    "name": "Fresh Harvest Hub",
    "imageUrl": "https://images.unsplash.com/photo-1464965211904-c72145311ad7?w=400",
    "categories": ["Exotic", "Seasonal", "Bundles"],
    "vendorType": "GROCERY",
    "menu": [
      { "id": "fr-01", "name": "Organic Dragon Fruit", "price": 120, "description": "Premium imported dragon fruit.", "image": "https://images.unsplash.com/photo-1527325541517-4506b7d44c8c?w=400", "category": "Exotic" },
      { "id": "fr-02", "name": "Exotic Berries Symphony", "price": 599, "description": "Mixed premium berry box.", "image": "https://images.unsplash.com/photo-1464965211904-c72145311ad7?w=400", "category": "Exotic" },
      { "id": "fr-03", "name": "Avocado Toast Kit", "price": 350, "description": "Everything for the perfect avocado toast.", "image": "https://images.unsplash.com/photo-1525351484163-7529414344d8?w=400", "category": "Bundles" }
    ]
  },
  {
    "id": "sweets-boutique",
    "name": "Le Macaron Boutique",
    "imageUrl": "https://images.unsplash.com/photo-1569864352342-fd43c330df47?w=400",
    "categories": ["Chocolates", "Pastries", "Pralines"],
    "vendorType": "SWEETS",
    "menu": [
      { "id": "sw-01", "name": "Gold Leaf Belgian Pralines", "price": 699, "description": "Handcrafted gold leaf chocolates.", "image": "https://images.unsplash.com/photo-1581798459219-3385269f0653?w=400", "category": "Pralines" },
      { "id": "sw-02", "name": "Macaron Collection (12 pcs)", "price": 450, "description": "Assorted French macarons.", "image": "https://images.unsplash.com/photo-1569864352342-fd43c330df47?w=400", "category": "Pastries" },
      { "id": "sw-03", "name": "Artisan Dark Chocolate Box", "price": 299, "description": "Single-origin 72% dark chocolate.", "image": "https://images.unsplash.com/photo-1549007994-cb92caebd54b?w=400", "category": "Chocolates" }
    ]
  }
];

interface Restaurant {
  _id: string;
  name: string;
  location: string;
  commissionRate: number;
  commissionType: 'percentage' | 'flat';
  operatingHours: { start: string, end: string };
  isActive: boolean;
  isOffline?: boolean;
  tags?: string[];
  imageUrl?: string;
  vendorType?: string;
}

interface MenuItem {
  _id: string;
  name: string;
  price: number;
  category: string;
  isAvailable: boolean;
  isEliteOnly: boolean;
  description?: string;
  image?: string;
  imageUrl?: string;
  tags?: string[];
  isVegetarian?: boolean;
  specs?: { engine?: string; topSpeed?: string };
  ownerName?: string;
  ownerPhone?: string;
}

import { AddRestaurantForm, AddMenuItemForm } from '@/components/GourmetForms';

// ... (LEGACY_DATA unchanged)

const VENDOR_TYPES = ['All', 'RESTAURANT', 'LOCAL_VENDOR', 'GROCERY', 'SWEETS', 'DRINKS', 'RENTAL', 'GYM', 'LAUNDRY', 'PHARMACY', 'STATIONARY', 'SEASONAL'];
const VENDOR_ICONS: Record<string, string> = {
  All: '🌐', RESTAURANT: '🍽️', LOCAL_VENDOR: '🏪', GROCERY: '🍎', SWEETS: '🍩', DRINKS: '🥤', RENTAL: '🚗',
  GYM: '💪', LAUNDRY: '👔', PHARMACY: '💊', STATIONARY: '📚', SEASONAL: '🎁'
};

export default function GourmetManagement() {
  const isAuthed = useAdminAuth();
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [selectedRestaurant, setSelectedRestaurant] = useState<Restaurant | null>(null);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'list' | 'menu'>('list');
  const [isSyncing, setIsSyncing] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [editingRestaurant, setEditingRestaurant] = useState<Restaurant | null>(null);
  const [isAddingItem, setIsAddingItem] = useState(false);
  const [editingItem, setEditingItem] = useState<MenuItem | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [isCreatingItem, setIsCreatingItem] = useState(false);
  const [search, setSearch] = useState('');
  const [vendorFilter, setVendorFilter] = useState('All');
  const [menuSearch, setMenuSearch] = useState('');
  const [selectedMenuCategory, setSelectedMenuCategory] = useState('All');

  useEffect(() => {
    fetchRestaurants();
  }, []);

  const fetchRestaurants = async () => {
    try {
      const token = 'cookie-managed';
      const res = await fetch(`${API_URL}/api/admin/restaurants`, {
        });
      const data = await res.json();
      if (res.ok) setRestaurants(data);
    } catch {
    } finally {
      setLoading(false);
    }
  };

  const handleSyncLegacy = async () => {
    if(!confirm('Import all current campus restaurants and items into the Nexus?')) return;
    setIsSyncing(true);
    try {
      const token = 'cookie-managed';
      const res = await fetch(`${API_URL}/api/admin/seed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', },
        body: JSON.stringify({ restaurants: LEGACY_DATA })
      });
      if (res.ok) fetchRestaurants();
    } catch { } finally { setIsSyncing(false); }
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleCreateRestaurant = async (newRest: any, imageFile: File | null) => {
    if (isCreating) return;
    setIsCreating(true);
    try {
      const token = 'cookie-managed';
      let finalImageUrl = newRest.imageUrl;
      if (imageFile) {
        const formData = new FormData();
        formData.append('image', imageFile);
        try {
          const uploadRes = await fetch(`${API_URL}/api/upload`, { method: 'POST', body: formData });
          const uploadData = await uploadRes.json();
          if (uploadData.imageUrl) finalImageUrl = uploadData.imageUrl;
        } catch (err) { console.error("Upload failed", err); }
      }

      const payload = {
        ...newRest,
        imageUrl: finalImageUrl,
        tags: (newRest.tags || '').split(',').map((t: string) => t.trim()).filter((t: string) => t),
        operatingHours: { start: newRest.operatingHoursStart, end: newRest.operatingHoursEnd }
      };
      
      const endpoint = editingRestaurant ? `${API_URL}/api/admin/restaurants/${editingRestaurant._id}` : `${API_URL}/api/admin/restaurants`;
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', },
        body: JSON.stringify(payload)
      });
      
      if (res.ok) { 
        setIsAdding(false); 
        setEditingRestaurant(null);
        fetchRestaurants(); 
      }
    } catch { 
    } finally {
      setIsCreating(false);
    }
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleCreateMenuItem = async (newItem: any, imageFile: File | null) => {
    if(!selectedRestaurant || isCreatingItem) return;
    setIsCreatingItem(true);
    try {
      const token = 'cookie-managed';
      let finalImageUrl = newItem.image;
      if (imageFile) {
        const formData = new FormData();
        formData.append('image', imageFile);
        try {
          const uploadRes = await fetch(`${API_URL}/api/upload`, { method: 'POST', body: formData });
          const uploadData = await uploadRes.json();
          if (uploadData.imageUrl) finalImageUrl = uploadData.imageUrl;
        } catch (err) { console.error("Item upload failed", err); }
      }

      const endpoint = editingItem ? `${API_URL}/api/admin/menu-items/${editingItem._id}` : `${API_URL}/api/admin/menu-items/new`;
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', },
        body: JSON.stringify({ 
          ...newItem, 
          image: finalImageUrl,
          imageUrl: finalImageUrl,
          restaurantId: selectedRestaurant._id,
          tags: (newItem.tags || '').split(',').map((t: string) => t.trim()).filter((t: string) => t),
          isVegetarian: newItem.isVegetarian,
          specs: { engine: newItem.engine, topSpeed: newItem.topSpeed },
          ownerName: newItem.ownerName,
          ownerPhone: newItem.ownerPhone
        })
      });
      
      if (res.ok) { 
        setIsAddingItem(false); 
        setEditingItem(null);
        fetchMenu(selectedRestaurant._id); 
      }
    } catch { 
    } finally { setIsCreatingItem(false); }
  };

  const fetchMenu = async (restaurantId: string) => {
    try {
      const token = 'cookie-managed';
      const res = await fetch(`${API_URL}/api/admin/menu-items?restaurantId=${restaurantId}`, {
         cache: 'no-store'
      });
      const data = await res.json();
      if (res.ok) setMenuItems(data);
    } catch { }
  };

  const toggleEliteItem = async (menuItem: MenuItem) => {
    try {
      const token = 'cookie-managed';
      const res = await fetch(`${API_URL}/api/admin/menu-items/${menuItem._id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', },
        body: JSON.stringify({ ...menuItem, isEliteOnly: !menuItem.isEliteOnly })
      });
      if (res.ok && selectedRestaurant) fetchMenu(selectedRestaurant._id);
    } catch { }
  };

  const toggleAvailability = async (menuItem: MenuItem) => {
    try {
      const token = 'cookie-managed';
      const res = await fetch(`${API_URL}/api/admin/menu-items/${menuItem._id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', },
        body: JSON.stringify({ ...menuItem, isAvailable: !menuItem.isAvailable })
      });
      if (res.ok && selectedRestaurant) fetchMenu(selectedRestaurant._id);
    } catch { }
  };

  const deleteMenuItem = async (menuItemId: string) => {
    if (!confirm('Remove this menu item from the Nexus?')) return;
    try {
      const token = 'cookie-managed';
      await fetch(`${API_URL}/api/admin/menu-items/${menuItemId}/delete`, {
        method: 'DELETE',
        });
      setMenuItems(prev => prev.filter(i => i._id !== menuItemId));
    } catch { }
  };

  const deleteRestaurant = async (restaurantId: string) => {
    if (!confirm('DANGER: This will permanently delete this restaurant node and ALL its menu items. Continue?')) return;
    try {
      const token = 'cookie-managed';
      const res = await fetch(`${API_URL}/api/admin/restaurants/${restaurantId}`, {
        method: 'DELETE',
        });
      if (res.ok) {
        setRestaurants(prev => prev.filter(r => r._id !== restaurantId));
      }
    } catch { }
  };

  const toggleRestaurantStatus = async (restaurant: Restaurant) => {
    try {
      const token = 'cookie-managed';
      const res = await fetch(`${API_URL}/api/admin/restaurants/${restaurant._id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', },
        body: JSON.stringify({ ...restaurant, isActive: !restaurant.isActive })
      });
      if (res.ok) fetchRestaurants();
    } catch { }
  };

  if (!isAuthed) return <div className="p-20 text-center font-black text-white uppercase tracking-widest animate-pulse">Authenticating...</div>;

  return (
    <div className="space-y-10 animate-fade-in relative pb-20">
      <header className="flex justify-between items-center bg-white/5 p-8 rounded-[40px] border border-white/5 glass">
        <div>
          <h2 className="text-3xl font-black text-white tracking-tighter uppercase">
            {view === 'list' ? 'Gourmet ' : 'Tactical '}
            <span className="text-emerald-500">{view === 'list' ? 'Terminal' : 'Menu Control'}</span>
          </h2>
          <p className="text-gray-400 text-sm font-bold uppercase tracking-widest mt-1">
            {view === 'list' ? 'Absolute Partner Oversight & Revenue splits' : `Managing Assets for ${selectedRestaurant?.name}`}
          </p>
        </div>
        <div className="flex gap-4">
           {view === 'list' && (
             <div className="flex gap-4">
               <button onClick={() => setIsAdding(true)} className="px-8 py-3 bg-emerald-600 text-white text-[10px] font-black uppercase tracking-widest rounded-2xl hover:scale-105 transition-all shadow-[0_0_20px_rgba(16,185,129,0.3)]">
                 Deploy New Node
               </button>
               <button onClick={handleSyncLegacy} disabled={isSyncing} className="px-8 py-3 bg-blue-600 text-white text-[10px] font-black uppercase tracking-widest rounded-2xl hover:scale-105 transition-all">
                 {isSyncing ? 'Syncing...' : 'Omni-Sync Assets'}
               </button>
             </div>
           )}
           {view === 'menu' && (
             <button onClick={() => setView('list')} className="px-6 py-3 bg-white/10 rounded-2xl text-[10px] font-black uppercase tracking-widest text-white hover:bg-white/20">
                Return to Terminal
             </button>
           )}
        </div>
      </header>

      {isAdding || editingRestaurant ? (
        <AddRestaurantForm 
          onCancel={() => { setIsAdding(false); setEditingRestaurant(null); }} 
          onSubmit={handleCreateRestaurant} 
          isCreating={isCreating} 
          initialData={editingRestaurant}
        />
      ) : null}

      {isAddingItem || editingItem ? (
        <AddMenuItemForm 
          onCancel={() => { setIsAddingItem(false); setEditingItem(null); }} 
          onSubmit={handleCreateMenuItem} 
          vendorType={selectedRestaurant?.vendorType}
          initialData={editingItem}
          isCreating={isCreatingItem}
        />
      ) : null}

      {/* Search & Filter Bar */}
      {view === 'list' && !isAdding && !editingRestaurant && (
        <div className="glass-card p-6 space-y-5">
          <div className="flex flex-col md:flex-row gap-4 items-center">
            <div className="relative flex-1 w-full">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 text-sm">🔍</span>
              <input 
                type="text" 
                placeholder="Search restaurants by name or location..." 
                className="w-full bg-white/5 border border-white/10 rounded-2xl py-3.5 pl-11 pr-6 text-sm text-white font-bold outline-none focus:border-emerald-500/30 transition-all placeholder:text-gray-600"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="text-[10px] font-black text-gray-500 uppercase tracking-widest whitespace-nowrap">
              {restaurants.filter(r => (vendorFilter === 'All' || r.vendorType === vendorFilter) && (r.name.toLowerCase().includes(search.toLowerCase()) || r.location?.toLowerCase().includes(search.toLowerCase()))).length} Nodes Active
            </div>
          </div>
          <div className="flex gap-2 flex-wrap">
            {VENDOR_TYPES.map(v => (
              <button 
                key={v}
                onClick={() => setVendorFilter(v)}
                className={`px-4 py-2 rounded-xl text-[9px] font-black uppercase tracking-widest border transition-all flex items-center gap-1.5 ${vendorFilter === v ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20 shadow-[0_0_12px_rgba(16,185,129,0.15)]' : 'bg-white/[0.02] text-gray-500 border-white/5 hover:text-white hover:border-white/10'}`}
              >
                <span className="text-xs">{VENDOR_ICONS[v]}</span> {v === 'All' ? 'All Types' : v}
              </button>
            ))}
          </div>
        </div>
      )}

      {view === 'list' && !isAdding && !editingRestaurant ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 text-white">
          {loading ? (
            <div className="col-span-full py-20 text-center font-black text-gray-600 animate-pulse tracking-widest uppercase">Initializing Gourmet Nodes...</div>
          ) : restaurants
            .filter(r => vendorFilter === 'All' || r.vendorType === vendorFilter)
            .filter(r => r.name.toLowerCase().includes(search.toLowerCase()) || r.location?.toLowerCase().includes(search.toLowerCase()))
            .map((rest) => (
            <RestaurantCard 
              key={rest._id} 
              rest={rest} 
              onManage={(r: Restaurant) => { setSelectedRestaurant(r); fetchMenu(r._id); setView('menu'); }}
              onEdit={(r: Restaurant) => setEditingRestaurant(r)}
              onToggleStatus={toggleRestaurantStatus}
              onDelete={deleteRestaurant}
            />
          ))}
          {!loading && restaurants.filter(r => vendorFilter === 'All' || r.vendorType === vendorFilter).filter(r => r.name.toLowerCase().includes(search.toLowerCase()) || r.location?.toLowerCase().includes(search.toLowerCase())).length === 0 && (
            <div className="col-span-full py-20 text-center">
              <p className="text-gray-500 text-sm font-bold">No restaurants match your filters.</p>
              <button onClick={() => { setSearch(''); setVendorFilter('All'); }} className="mt-4 text-[10px] font-black text-emerald-400 uppercase tracking-widest hover:underline">Clear Filters</button>
            </div>
          )}
        </div>
      ) : view === 'menu' && !isAddingItem ? (
        <div className="space-y-6">
          <div className="glass-card p-6 space-y-5">
             <div className="flex flex-col md:flex-row gap-4 items-center">
                <div className="relative flex-1 w-full">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 text-sm">🔍</span>
                  <input 
                    type="text" 
                    placeholder="Search assets by name or category..." 
                    className="w-full bg-white/5 border border-white/10 rounded-2xl py-3.5 pl-11 pr-6 text-sm text-white font-bold outline-none focus:border-blue-500/30 transition-all placeholder:text-gray-600"
                    value={menuSearch}
                    onChange={(e) => setMenuSearch(e.target.value)}
                  />
                </div>
                <div className="text-[10px] font-black text-gray-500 uppercase tracking-widest whitespace-nowrap">
                  {menuItems.filter(item => 
                    (selectedMenuCategory === 'All' || item.category === selectedMenuCategory) && 
                    (item.name.toLowerCase().includes(menuSearch.toLowerCase()) || item.category.toLowerCase().includes(menuSearch.toLowerCase()))
                  ).length} Assets Deployed
                </div>
             </div>
             <div className="flex gap-2 flex-wrap">
                {['All', ...Array.from(new Set(menuItems.map(item => item.category)))].map(category => (
                  <button 
                    key={category}
                    onClick={() => setSelectedMenuCategory(category)}
                    className={`px-5 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest border transition-all ${selectedMenuCategory === category ? 'bg-blue-500/10 text-blue-400 border-blue-500/20 shadow-[0_0_12px_rgba(37,99,235,0.15)]' : 'bg-white/[0.02] text-gray-500 border-white/5 hover:text-white hover:border-white/10'}`}
                  >
                    {category}
                  </button>
                ))}
             </div>
          </div>

          <div className="glass-card p-8 bg-white/[0.01]">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {menuItems
                  .filter(item => selectedMenuCategory === 'All' || item.category === selectedMenuCategory)
                  .filter(item => item.name.toLowerCase().includes(menuSearch.toLowerCase()) || item.category.toLowerCase().includes(menuSearch.toLowerCase()))
                  .map((item: MenuItem) => (
                    <MenuItemCard 
                      key={item._id} 
                      item={item} 
                      onToggleElite={toggleEliteItem} 
                      onToggleAvailability={toggleAvailability}
                      onEdit={(i: MenuItem) => setEditingItem(i)}
                      onDelete={deleteMenuItem} 
                    />
                  ))}
                <div onClick={() => setIsAddingItem(true)} className="p-10 rounded-3xl border border-dashed border-white/10 flex flex-col items-center justify-center gap-4 cursor-pointer hover:bg-white/5 group transition-all h-full min-h-[140px]">
                    <div className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center text-xl group-hover:scale-110 transition-transform">➕</div>
                    <span className="text-[10px] font-black text-gray-500 uppercase tracking-widest">Deploy New Asset</span>
                </div>
              </div>
          </div>
        </div>
      ) : null}
      <style jsx>{`
        .admin-input {
          background: rgba(255,255,255,0.05);
          border: 1px solid rgba(255,255,255,0.1);
          padding: 1.25rem;
          border-radius: 1.5rem;
          color: white;
          font-weight: 900;
          outline: none;
        }
        .admin-input:focus { border-color: rgba(16, 185, 129, 0.5); }
      `}</style>
    </div>
  );
}

// ─── Optimized Sub-Components ─────────────────────────────────

const RestaurantCard = memo(({ rest, onManage, onEdit, onToggleStatus, onDelete }: { rest: Restaurant, onManage: (r: Restaurant) => void, onEdit: (r: Restaurant) => void, onToggleStatus: (r: Restaurant) => void, onDelete: (id: string) => void }) => (
  <div className={`glass-card p-8 group relative overflow-hidden flex flex-col justify-between h-full transition-all duration-500 ${!rest.isActive ? 'opacity-60 grayscale-[0.5] border-red-500/20' : ''}`}>
    <div className="flex gap-6 items-start mb-6">
      <div className="w-24 h-24 rounded-3xl overflow-hidden border border-white/10 shrink-0 relative bg-slate-900">
        <Image 
          src={rest.imageUrl || "/assets/placeholder.png"} 
          fill 
          style={{ objectFit: 'cover' }} 
          alt={rest.name} 
          className="group-hover:scale-110 transition-transform duration-700 ease-out" 
        />
        {!rest.isActive && (
           <div className="absolute inset-0 bg-red-900/40 flex items-center justify-center">
              <span className="text-[9px] font-black text-white bg-red-600 px-2 py-0.5 rounded uppercase tracking-widest">Deactivated</span>
           </div>
        )}
        {rest.isActive && rest.isOffline && (
           <div className="absolute inset-0 bg-amber-900/40 flex flex-col items-center justify-center backdrop-blur-[1px]">
              <span className="text-xl mb-1">⚠️</span>
              <span className="text-[8px] font-black text-white bg-amber-600 px-2 py-0.5 rounded uppercase tracking-widest text-center">Store Marked<br/>Offline</span>
           </div>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex justify-between items-start">
           <span className={`text-[8px] font-black uppercase tracking-[0.2em] mb-1 ${rest.isActive ? 'text-emerald-500' : 'text-red-500'}`}>{rest.vendorType || 'RESTAURANT'}</span>
           <button onClick={() => onDelete(rest._id)} className="text-red-500/30 hover:text-red-500 hover:scale-125 transition-all text-xs">✕</button>
        </div>
        <h4 className="text-xl font-black text-white uppercase tracking-tight truncate">{rest.name}</h4>
        <p className="text-[10px] text-gray-500 font-bold uppercase tracking-widest mt-1">📍 {rest.location}</p>
        <div className="flex gap-2 mt-3">
           <button 
             onClick={() => onToggleStatus(rest)}
             className={`px-3 py-1 rounded-lg border text-[8px] font-black uppercase tracking-widest transition-all ${rest.isActive ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400 hover:bg-red-500/20 hover:text-red-400 hover:border-red-500/30' : 'bg-red-500 border-red-500 text-white'}`}
           >
             {rest.isActive ? '⚡ Active' : '🌑 Inactive'}
           </button>
        </div>
      </div>
    </div>
    <div className="flex items-center justify-between pt-6 border-t border-white/5 mt-auto">
       <div className="flex flex-col">
          <span className="text-[8px] font-black text-gray-500 uppercase tracking-widest">Revenue Split</span>
          <span className="text-sm font-black text-white">{rest.commissionRate}{rest.commissionType === 'percentage' ? '%' : '₹'}</span>
       </div>
       <div className="flex gap-2 items-center">
          <button 
            onClick={() => onEdit(rest)}
            className="px-4 py-2.5 bg-white/5 border border-white/10 rounded-2xl text-[9px] font-black uppercase tracking-widest text-emerald-400 hover:bg-emerald-500/10 hover:border-emerald-500/20 transition-all"
          >
            Edit
          </button>
          <button 
            onClick={() => onManage(rest)}
            className="px-6 py-2.5 bg-white/5 border border-white/10 rounded-2xl text-[9px] font-black uppercase tracking-widest text-white hover:bg-white/10 hover:border-white/20 transition-all"
          >
            Manage Assets →
          </button>
       </div>
    </div>
  </div>
));
RestaurantCard.displayName = 'RestaurantCard';

const MenuItemCard = memo(({ item, onToggleElite, onToggleAvailability, onEdit, onDelete }: { 
  item: MenuItem, 
  onToggleElite: (i: MenuItem) => void, 
  onToggleAvailability: (i: MenuItem) => void,
  onEdit: (i: MenuItem) => void,
  onDelete: (id: string) => void 
}) => (
  <div className={`glass-card p-6 group transition-all duration-300 ${!item.isAvailable ? 'opacity-60 grayscale-[0.5]' : ''} ${item.isEliteOnly ? 'border-[#C9A84C]/30 bg-[#C9A84C]/[0.02]' : 'border-white/5'}`}>
     <div className="flex gap-6">
        <div className="w-20 h-20 rounded-2xl overflow-hidden border border-white/10 shrink-0 relative bg-slate-900">
           <Image src={item.imageUrl || item.image || "/assets/placeholder.png"} fill style={{ objectFit: 'cover' }} alt={item.name} />
           {item.isEliteOnly && <div className="absolute top-1 left-1 bg-[#C9A84C] text-black text-[7px] font-black px-1 rounded">ELITE</div>}
           {!item.isAvailable && <div className="absolute inset-0 bg-red-900/40 flex items-center justify-center"><span className="text-[8px] font-black text-white bg-red-600 px-1.5 py-0.5 rounded uppercase">Out of Stock</span></div>}
        </div>
        <div className="flex-1 min-w-0 flex flex-col justify-between py-1">
           <div>
              <div className="flex justify-between items-start">
                 <h5 className={`text-sm font-black text-white uppercase tracking-tight truncate ${!item.isAvailable ? 'line-through decoration-red-500/50' : ''}`}>{item.name}</h5>
                 <button onClick={() => onDelete(item._id)} className="text-red-500/40 hover:text-red-500 text-[10px]">✕</button>
              </div>
              <div className="flex items-center gap-2">
                 <p className="text-[10px] font-bold text-gray-500 uppercase">{item.category}</p>
                 {item.isVegetarian && (
                    <div className="w-2.5 h-2.5 border border-emerald-500/50 flex items-center justify-center p-[1px] rounded-[2px]">
                       <div className="w-full h-full bg-emerald-500 rounded-full" />
                    </div>
                 )}
              </div>
           </div>
           <div className="flex justify-between items-end">
              <span className={`text-sm font-black ${item.isAvailable ? 'text-emerald-400' : 'text-gray-500'}`}>₹{item.price}</span>
              <div className="flex gap-2">
                 <button 
                   onClick={() => onEdit(item)}
                   className="p-1.5 rounded-lg border border-white/10 bg-white/5 text-gray-500 hover:text-white hover:border-white/20 transition-all"
                   title="Edit Asset"
                 >
                   <span className="text-[8px] font-black uppercase">Edit</span>
                 </button>
                 <button 
                   onClick={() => onToggleAvailability(item)}
                   className={`p-1.5 rounded-lg border transition-all ${item.isAvailable ? 'bg-white/5 border-white/10 text-gray-500 hover:border-emerald-500/30' : 'bg-red-500 border-red-500 text-white'}`}
                   title={item.isAvailable ? "Mark as Unavailable" : "Mark as Available"}
                 >
                   <span className="text-[8px] font-black uppercase">{item.isAvailable ? '📦 In Stock' : '🚫 Out of Stock'}</span>
                 </button>
                 <button 
                   onClick={() => onToggleElite(item)}
                   className={`p-1.5 rounded-lg border transition-all ${item.isEliteOnly ? 'bg-[#C9A84C] border-[#C9A84C] text-black' : 'bg-white/5 border-white/10 text-gray-500 hover:border-white/20'}`}
                 >
                   <span className="text-[8px] font-black uppercase">{item.isEliteOnly ? '★ Elite' : '☆ Standard'}</span>
                 </button>
              </div>
           </div>
        </div>
     </div>
  </div>
));
MenuItemCard.displayName = 'MenuItemCard';

