"use client";
import { useState, useEffect } from 'react';
import api from '@/lib/api';
import AdminSocketProvider from '@/components/AdminSocketProvider';

export default function CMSPage() {
  const [config, setConfig] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchConfig();
  }, []);

  const fetchConfig = async () => {
    try {
      setLoading(true);
      const res = await api.get('/config');
      setConfig(res.data.config);
    } catch (err) {
      console.error('Failed to fetch config:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      await api.put('/config', config);
      alert('Layout configuration updated and synced across all platforms!');
    } catch (err) {
      console.error('Failed to save config:', err);
      alert('Error saving configuration.');
    } finally {
      setSaving(false);
    }
  };

  const updateBanner = (index: number, field: string, value: any) => {
    const newBanners = [...config.banners];
    newBanners[index] = { ...newBanners[index], [field]: value };
    setConfig({ ...config, banners: newBanners });
  };

  const updateCategory = (index: number, field: string, value: any) => {
    const newCategories = [...config.categories];
    newCategories[index] = { ...newCategories[index], [field]: value };
    setConfig({ ...config, categories: newCategories });
  };

  if (loading || !config) {
    return <div className="p-10 text-white">Loading CMS Configuration...</div>;
  }

  return (
    <AdminSocketProvider>
      <div className="p-8 max-w-7xl mx-auto text-white">
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-3xl font-black uppercase tracking-widest text-emerald-400">Global CMS & Layout Engine</h1>
            <p className="text-gray-400 text-sm mt-1">Manage exactly what displays on the Mobile App and Web Portal in real-time.</p>
          </div>
          <button 
            onClick={handleSave} 
            disabled={saving}
            className="bg-emerald-500 hover:bg-emerald-600 px-8 py-3 rounded-xl font-bold uppercase tracking-widest text-sm shadow-lg shadow-emerald-500/20"
          >
            {saving ? 'Syncing...' : 'Deploy Changes 🚀'}
          </button>
        </div>

        {/* Global Settings */}
        <div className="bg-[#141416] border border-white/10 rounded-3xl p-6 mb-8">
          <h2 className="text-xl font-bold mb-4 text-white">Global Status Toggles</h2>
          <div className="flex gap-8">
            <label className="flex items-center gap-3 cursor-pointer">
              <input 
                type="checkbox" 
                checked={config.maintenanceMode} 
                onChange={(e) => setConfig({ ...config, maintenanceMode: e.target.checked })}
                className="w-5 h-5 accent-emerald-500"
              />
              <span className="font-bold">Maintenance Mode (Locks out users)</span>
            </label>
            <label className="flex items-center gap-3 cursor-pointer">
              <input 
                type="checkbox" 
                checked={config.campusOpen} 
                onChange={(e) => setConfig({ ...config, campusOpen: e.target.checked })}
                className="w-5 h-5 accent-emerald-500"
              />
              <span className="font-bold">Campus Open (Allow Orders)</span>
            </label>
          </div>
        </div>

        {/* Banners */}
        <div className="bg-[#141416] border border-white/10 rounded-3xl p-6 mb-8">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-bold text-white">Promotional Banners (Carousel)</h2>
            <button 
              onClick={() => setConfig({ 
                ...config, 
                banners: [...config.banners, { imageUrl: '', tagline: 'NEW PROMO', title1: 'TITLE', title2: '', description: '', buttonText: 'CLICK HERE', isActive: true }] 
              })}
              className="text-emerald-400 text-sm font-bold bg-emerald-500/10 px-4 py-2 rounded-lg"
            >
              + Add Banner
            </button>
          </div>
          
          <div className="space-y-4">
            {config.banners.map((banner: any, idx: number) => (
              <div key={idx} className={`p-4 border rounded-xl flex flex-col gap-3 ${banner.isActive ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-white/5 opacity-50'}`}>
                <div className="flex justify-between">
                  <span className="font-bold text-emerald-400">Banner #{idx + 1}</span>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={banner.isActive} onChange={(e) => updateBanner(idx, 'isActive', e.target.checked)} />
                    <span className="text-xs">Active</span>
                  </label>
                </div>
                <input placeholder="Image URL" value={banner.imageUrl} onChange={e => updateBanner(idx, 'imageUrl', e.target.value)} className="bg-black/50 border border-white/10 p-2 rounded text-sm w-full" />
                <div className="grid grid-cols-2 gap-3">
                  <input placeholder="Tagline (e.g. MEGA BASKET)" value={banner.tagline} onChange={e => updateBanner(idx, 'tagline', e.target.value)} className="bg-black/50 border border-white/10 p-2 rounded text-sm" />
                  <input placeholder="Redirect URL" value={banner.redirectUrl} onChange={e => updateBanner(idx, 'redirectUrl', e.target.value)} className="bg-black/50 border border-white/10 p-2 rounded text-sm" />
                  <input placeholder="Title Line 1" value={banner.title1} onChange={e => updateBanner(idx, 'title1', e.target.value)} className="bg-black/50 border border-white/10 p-2 rounded text-sm" />
                  <input placeholder="Title Line 2" value={banner.title2} onChange={e => updateBanner(idx, 'title2', e.target.value)} className="bg-black/50 border border-white/10 p-2 rounded text-sm" />
                </div>
                <textarea placeholder="Description" value={banner.description} onChange={e => updateBanner(idx, 'description', e.target.value)} className="bg-black/50 border border-white/10 p-2 rounded text-sm w-full h-16" />
                <div className="flex justify-end">
                   <button onClick={() => {
                     const nb = [...config.banners];
                     nb.splice(idx, 1);
                     setConfig({ ...config, banners: nb });
                   }} className="text-red-400 text-xs font-bold hover:underline">Remove Banner</button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* The Classics (Categories) */}
        <div className="bg-[#141416] border border-white/10 rounded-3xl p-6">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-bold text-white">Category Shortcuts (The Classics)</h2>
            <button 
              onClick={() => setConfig({ 
                ...config, 
                categories: [...config.categories, { name: 'New Category', img: '/assets/placeholder.png', order: config.categories.length, isActive: true }] 
              })}
              className="text-blue-400 text-sm font-bold bg-blue-500/10 px-4 py-2 rounded-lg"
            >
              + Add Category
            </button>
          </div>
          
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {config.categories.map((cat: any, idx: number) => (
              <div key={idx} className={`p-4 border rounded-xl flex flex-col gap-2 ${cat.isActive ? 'border-blue-500/30 bg-blue-500/5' : 'border-white/5 opacity-50'}`}>
                <div className="flex justify-between">
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={cat.isActive} onChange={(e) => updateCategory(idx, 'isActive', e.target.checked)} />
                    <span className="text-xs">Active</span>
                  </label>
                  <input type="number" value={cat.order} onChange={e => updateCategory(idx, 'order', parseInt(e.target.value))} className="w-12 bg-black/50 border border-white/10 p-1 rounded text-xs text-center" />
                </div>
                <input placeholder="Name (e.g. Fruits)" value={cat.name} onChange={e => updateCategory(idx, 'name', e.target.value)} className="bg-black/50 border border-white/10 p-2 rounded text-sm" />
                <input placeholder="Image URL or Path" value={cat.img} onChange={e => updateCategory(idx, 'img', e.target.value)} className="bg-black/50 border border-white/10 p-2 rounded text-sm" />
                <div className="flex justify-end mt-1">
                   <button onClick={() => {
                     const nc = [...config.categories];
                     nc.splice(idx, 1);
                     setConfig({ ...config, categories: nc });
                   }} className="text-red-400 text-[10px] font-bold hover:underline">Remove</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </AdminSocketProvider>
  );
}
