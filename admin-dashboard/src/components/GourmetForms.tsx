"use client";
import { useState, ChangeEvent } from 'react';

interface RestaurantFormProps {
  onCancel: () => void;
  onSubmit: (data: Record<string, unknown>, image: File | null) => void;
  isCreating: boolean;
  initialData?: any;
}

export function AddRestaurantForm({ onCancel, onSubmit, isCreating, initialData }: RestaurantFormProps) {
  const [formData, setFormData] = useState({ 
    name: initialData?.name || '', 
    location: initialData?.location || 'Main Campus', 
    imageUrl: initialData?.imageUrl || '', 
    commissionRate: initialData?.commissionRate || 10, 
    commissionType: initialData?.commissionType || 'percentage', 
    vendorType: initialData?.vendorType || 'RESTAURANT', 
    rating: initialData?.rating || 4.0, 
    deliveryTime: initialData?.deliveryTime || 30, 
    tags: Array.isArray(initialData?.tags) ? initialData.tags.join(', ') : initialData?.tags || '', 
    operatingHoursStart: initialData?.operatingHours?.start || '09:00', 
    operatingHoursEnd: initialData?.operatingHours?.end || '22:00', 
    isActive: initialData?.isActive ?? true, 
    isOffline: initialData?.isOffline ?? false, 
    password: '',
    ownerName: initialData?.ownerName || '',
    ownerPhone: initialData?.ownerPhone || '',
    // CampusBites: Local Vendor Fields
    campus: initialData?.campus || '',
    whatsappNumber: initialData?.whatsappNumber || '',
    promoOffer: initialData?.promoOffer || '',
    subscriptionTier: initialData?.subscriptionTier || 'free',
    stallDescription: initialData?.stallDescription || ''
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);

  const handleImageChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;
    setImageFile(file);
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => setImagePreview(reader.result as string);
      reader.readAsDataURL(file);
    } else {
      setImagePreview(null);
    }
  };

  const vendorIcons: Record<string, string> = {
    RESTAURANT: '🍽️', LOCAL_VENDOR: '🏪', GROCERY: '🍎', SWEETS: '🍩', DRINKS: '🥤', RENTAL: '🚗',
    GYM: '💪', LAUNDRY: '👔', PHARMACY: '💊', STATIONARY: '📚', SEASONAL: '🎁', GLOBAL_MARKET: '🌐'
  };

  return (
    <div className="glass-card p-10 border-emerald-500/20 animate-slide-up overflow-hidden relative">
       {/* Decorative glow */}
       <div className="absolute top-0 left-0 w-64 h-64 bg-emerald-500/5 blur-[100px] rounded-full pointer-events-none" />
       
       <div className="flex items-center gap-4 mb-10 relative">
          <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-xl">
            {vendorIcons[formData.vendorType] || '🍽️'}
          </div>
          <div>
            <h3 className="text-xl font-black text-white uppercase tracking-tight">{initialData ? 'Modify Restaurant Node' : 'Deploy New Restaurant Node'}</h3>
            <p className="text-[10px] text-gray-500 font-bold uppercase tracking-widest mt-0.5">{initialData ? 'Update existing operational parameters' : 'Fill in all operational parameters below'}</p>
          </div>
       </div>

       <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-7 relative">
          {/* Restaurant Name */}
          <div className="space-y-2">
            <label className="text-[10px] font-black uppercase tracking-widest text-gray-500 ml-1">Restaurant Name</label>
            <input 
              placeholder="e.g. Nexus Cafe" 
              className="nexus-input" 
              value={formData.name} 
              onChange={(e) => setFormData({...formData, name: e.target.value})} 
            />
          </div>

          {/* Cover Image */}
          <div className="space-y-2">
            <label className="text-[10px] font-black uppercase tracking-widest text-emerald-400 ml-1">Cover Image</label>
            <div className="flex gap-3">
              <input type="file" accept="image/*" id="rest-image" className="hidden" onChange={handleImageChange} />
              <label 
                htmlFor="rest-image"
                className="flex-1 nexus-input flex items-center justify-center gap-2 cursor-pointer hover:border-emerald-500/30 text-center text-sm"
              >
                {imagePreview ? (
                  <span className="flex items-center gap-2">
                    <span className="w-6 h-6 rounded-lg overflow-hidden inline-block border border-white/10">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={imagePreview} alt="Preview" className="w-full h-full object-cover" />
                    </span>
                    <span className="text-emerald-400 text-xs font-bold truncate max-w-[100px]">{imageFile?.name}</span>
                  </span>
                ) : (
                  <span className="text-gray-500">📂 Choose File</span>
                )}
              </label>
            </div>
          </div>

          {/* Location */}
          <div className="space-y-2">
            <label className="text-[10px] font-black uppercase tracking-widest text-gray-500 ml-1">Location Campus</label>
            <input 
              placeholder="e.g. Main Campus" 
              className="nexus-input" 
              value={formData.location} 
              onChange={(e) => setFormData({...formData, location: e.target.value})} 
            />
          </div>
          
          {/* Commission */}
          <div className="space-y-2">
            <label className="text-[10px] font-black uppercase tracking-widest text-gray-500 ml-1">Commission Split</label>
            <div className="flex gap-2">
              <input 
                type="number" 
                className="nexus-input flex-1" 
                value={formData.commissionRate} 
                onChange={(e) => setFormData({...formData, commissionRate: parseFloat(e.target.value)})} 
              />
              <select 
                className="nexus-select w-20" 
                value={formData.commissionType} 
                onChange={(e) => setFormData({...formData, commissionType: e.target.value})}
              >
                <option value="percentage">%</option>
                <option value="flat">₹</option>
              </select>
            </div>
          </div>
          
          {/* Vendor Type */}
          <div className="space-y-2">
            <label className="text-[10px] font-black uppercase tracking-widest text-gray-500 ml-1">Vendor Category</label>
            <select 
              className="nexus-select" 
              value={formData.vendorType} 
              onChange={(e) => setFormData({...formData, vendorType: e.target.value})}
            >
                <option value="RESTAURANT">🍽️ Restaurant (Food)</option>
                <option value="LOCAL_VENDOR">🏪 Local Vendor (CampusBites)</option>
                <option value="GROCERY">🍎 Grocery / Fresh Fruits</option>
                <option value="SWEETS">🍩 Sweets & Bakery</option>
                <option value="DRINKS">🥤 Drinks & Beverages</option>
                <option value="RENTAL">🚗 Rental (Bikes/Scooters)</option>
                <option value="GYM">💪 Gym & Nutrition</option>
                <option value="LAUNDRY">👔 Laundry & Dry Wash</option>
                <option value="PHARMACY">💊 Pharmacy & Wellness</option>
                <option value="STATIONARY">📚 Stationary & Books</option>
                <option value="SEASONAL">🎁 Seasonal & Gifts</option>
                <option value="GLOBAL_MARKET">🌐 Global Marketplace</option>
            </select>
          </div>

          {/* Operating Hours */}
          <div className="space-y-2">
            <label className="text-[10px] font-black uppercase tracking-widest text-gray-500 ml-1">Operating Hours</label>
            <div className="flex gap-3 items-center">
              <input 
                type="time" 
                className="nexus-input flex-1 text-center" 
                value={formData.operatingHoursStart} 
                onChange={(e) => setFormData({...formData, operatingHoursStart: e.target.value})} 
              />
              <span className="text-gray-600 font-bold text-xs">to</span>
              <input 
                type="time" 
                className="nexus-input flex-1 text-center" 
                value={formData.operatingHoursEnd} 
                onChange={(e) => setFormData({...formData, operatingHoursEnd: e.target.value})} 
              />
            </div>
          </div>

          {/* Rating & ETA */}
          <div className="space-y-2">
            <label className="text-[10px] font-black uppercase tracking-widest text-amber-500 ml-1">Rating & ETA (min)</label>
            <div className="flex gap-2">
              <input 
                type="number" 
                step="0.1"
                placeholder="4.5"
                className="nexus-input flex-1 text-center" 
                value={formData.rating} 
                onChange={(e) => setFormData({...formData, rating: parseFloat(e.target.value)})} 
              />
              <input 
                type="number" 
                placeholder="30"
                className="nexus-input flex-1 text-center" 
                value={formData.deliveryTime} 
                onChange={(e) => setFormData({...formData, deliveryTime: parseInt(e.target.value)})} 
              />
            </div>
          </div>

          {/* Tags */}
          <div className="space-y-2">
            <label className="text-[10px] font-black uppercase tracking-widest text-gray-500 ml-1">Tags (comma separated)</label>
            <input 
              placeholder="e.g. Veg, North Indian, Popular" 
              className="nexus-input" 
              value={formData.tags} 
              onChange={(e) => setFormData({...formData, tags: e.target.value})} 
            />
          </div>

          {formData.vendorType === 'RENTAL' && (
            <>
              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase tracking-widest text-amber-400 ml-1">Owner Name</label>
                <input 
                  placeholder="e.g. Shanmukesh K." 
                  className="nexus-input" 
                  value={formData.ownerName} 
                  onChange={(e) => setFormData({...formData, ownerName: e.target.value})} 
                />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase tracking-widest text-amber-400 ml-1">Owner Contact</label>
                <input 
                  placeholder="e.g. 9391955674" 
                  className="nexus-input" 
                  value={formData.ownerPhone} 
                  onChange={(e) => setFormData({...formData, ownerPhone: e.target.value})} 
                />
              </div>
            </>
          )}

          {/* CampusBites: Local Vendor Fields */}
          {formData.vendorType === 'LOCAL_VENDOR' && (
            <>
              <div className="col-span-full mt-2 mb-1">
                <div className="flex items-center gap-2">
                  <div className="h-px flex-1 bg-orange-500/20" />
                  <span className="text-[9px] font-black text-orange-400 uppercase tracking-[0.3em]">🏪 CampusBites Config</span>
                  <div className="h-px flex-1 bg-orange-500/20" />
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase tracking-widest text-orange-400 ml-1">Campus</label>
                <select
                  className="nexus-select"
                  value={formData.campus}
                  onChange={(e) => setFormData({...formData, campus: e.target.value})}
                >
                  <option value="">Select Campus</option>
                  <option value="SRM">🏛️ SRM University</option>
                  <option value="VIT">🎓 VIT Vellore</option>
                  <option value="KLU">📚 KL University</option>
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase tracking-widest text-orange-400 ml-1">WhatsApp Number</label>
                <input
                  placeholder="e.g. 919876543210 (with country code)"
                  className="nexus-input"
                  value={formData.whatsappNumber}
                  onChange={(e) => setFormData({...formData, whatsappNumber: e.target.value})}
                />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase tracking-widest text-orange-400 ml-1">Promotional Offer</label>
                <input
                  placeholder="e.g. Buy 2 Get 1 Free"
                  className="nexus-input"
                  value={formData.promoOffer}
                  onChange={(e) => setFormData({...formData, promoOffer: e.target.value})}
                />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase tracking-widest text-orange-400 ml-1">Subscription Tier</label>
                <select
                  className="nexus-select"
                  value={formData.subscriptionTier}
                  onChange={(e) => setFormData({...formData, subscriptionTier: e.target.value})}
                >
                  <option value="free">🆓 Free Tier</option>
                  <option value="premium">⭐ Premium (Featured)</option>
                </select>
              </div>
              <div className="space-y-2 col-span-full">
                <label className="text-[10px] font-black uppercase tracking-widest text-orange-400 ml-1">Stall Description</label>
                <textarea
                  placeholder="Describe the stall — what makes it special for students..."
                  className="nexus-input h-20 resize-none"
                  value={formData.stallDescription}
                  onChange={(e) => setFormData({...formData, stallDescription: e.target.value})}
                />
              </div>
            </>
          )}
       </div>

       <div className="flex gap-4 mt-10 relative">
          <button 
            disabled={isCreating}
            onClick={() => {
              const newErrors: Record<string, string> = {};
              if (!formData.name.trim()) newErrors.submit = "Name is required";
              if (formData.rating < 0 || formData.rating > 5) newErrors.submit = "Rating must be 0-5";
              if (formData.deliveryTime < 0) newErrors.submit = "ETA cannot be negative";
              if (formData.ownerPhone && formData.ownerPhone.length !== 10) newErrors.submit = "Phone must be 10 digits";
              
              if (Object.keys(newErrors).length > 0) {
                setErrors(newErrors);
                return;
              }
              onSubmit(formData, imageFile);
            }} 
            className="flex-1 py-4 bg-emerald-600 text-white font-black uppercase tracking-[0.2em] rounded-2xl text-xs disabled:opacity-40 hover:bg-emerald-500 hover:shadow-[0_0_30px_rgba(16,185,129,0.3)] transition-all duration-300"
          >
            {isCreating ? (
              <span className="flex items-center justify-center gap-3">
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Processing...
              </span>
            ) : initialData ? 'Commit Modifications' : 'Execute Deployment'}
          </button>
          <button 
            onClick={onCancel} 
            className="px-10 py-4 bg-white/5 hover:bg-white/10 text-gray-400 font-black uppercase tracking-widest rounded-2xl text-xs transition-all border border-white/5 hover:border-white/10"
          >
            Cancel
          </button>
       </div>
    </div>
  );
}

interface ItemFormProps {
  onCancel: () => void;
  onSubmit: (data: Record<string, unknown>, image: File | null) => void;
  vendorType?: string;
  initialData?: any;
}

export function AddMenuItemForm({ onCancel, onSubmit, vendorType, initialData }: ItemFormProps) {
  const [formData, setFormData] = useState({ 
    name: initialData?.name || '', 
    price: initialData?.price || 0, 
    category: initialData?.category || '', 
    description: initialData?.description || '', 
    image: initialData?.image || '', 
    isEliteOnly: initialData?.isEliteOnly || false, 
    tags: Array.isArray(initialData?.tags) ? initialData.tags.join(', ') : initialData?.tags || '', 
    isVegetarian: initialData?.isVegetarian || false,
    ownerName: initialData?.ownerName || '',
    ownerPhone: initialData?.ownerPhone || '',
    engine: initialData?.specs?.engine || '',
    topSpeed: initialData?.specs?.topSpeed || ''
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);

  const handleImageChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;
    setImageFile(file);
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => setImagePreview(reader.result as string);
      reader.readAsDataURL(file);
    } else {
      setImagePreview(null);
    }
  };

  return (
    <div className="glass-card p-10 border-blue-500/20 animate-slide-up overflow-hidden relative">
       <div className="absolute top-0 right-0 w-64 h-64 bg-blue-500/5 blur-[100px] rounded-full pointer-events-none" />
       
       <div className="flex items-center gap-4 mb-10 relative">
          <div className="w-12 h-12 rounded-2xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-xl">📦</div>
          <div>
            <h3 className="text-xl font-black text-white uppercase tracking-tight">{initialData ? 'Modify Menu Asset' : 'Deploy New Menu Asset'}</h3>
            <p className="text-[10px] text-gray-500 font-bold uppercase tracking-widest mt-0.5">{initialData ? 'Update existing asset parameters' : 'Configure item parameters and pricing'}</p>
          </div>
       </div>

       <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-7 relative">
          {/* Name */}
          <div className="space-y-2">
            <label className="text-[10px] font-black uppercase tracking-widest text-gray-500 ml-1">Asset Name</label>
            <input 
              placeholder="e.g. Premium Burger" 
              className="nexus-input nexus-input-blue" 
              value={formData.name} 
              onChange={(e) => setFormData({...formData, name: e.target.value})} 
            />
          </div>

          {/* Price */}
          <div className="space-y-2">
            <label className="text-[10px] font-black uppercase tracking-widest text-gray-500 ml-1">Price (₹)</label>
            <input 
              placeholder="e.g. 150" 
              type="number" 
              className="nexus-input nexus-input-blue" 
              value={formData.price || ''} 
              onChange={(e) => setFormData({...formData, price: parseInt(e.target.value) || 0})} 
            />
          </div>

          {/* Category */}
          <div className="space-y-2">
            <label className="text-[10px] font-black uppercase tracking-widest text-gray-500 ml-1">Category</label>
            <input 
              placeholder="e.g. Mains, Sides" 
              className="nexus-input nexus-input-blue" 
              value={formData.category} 
              onChange={(e) => setFormData({...formData, category: e.target.value})} 
            />
          </div>

          {/* Image */}
          <div className="space-y-2">
            <label className="text-[10px] font-black uppercase tracking-widest text-blue-400 ml-1">Item Image</label>
            <input type="file" accept="image/*" id="item-image" className="hidden" onChange={handleImageChange} />
            <label 
              htmlFor="item-image"
              className="nexus-input nexus-input-blue flex items-center justify-center gap-2 cursor-pointer text-center text-sm"
            >
              {imagePreview ? (
                <span className="flex items-center gap-2">
                  <span className="w-6 h-6 rounded-lg overflow-hidden inline-block border border-white/10">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={imagePreview} alt="Preview" className="w-full h-full object-cover" />
                  </span>
                  <span className="text-blue-400 text-xs font-bold truncate max-w-[120px]">{imageFile?.name}</span>
                </span>
              ) : (
                <span className="text-gray-500">📂 Choose File</span>
              )}
            </label>
          </div>

          {/* Description */}
          <div className="space-y-2 col-span-full">
            <label className="text-[10px] font-black uppercase tracking-widest text-gray-500 ml-1">Description / Ingredients</label>
            <textarea 
              placeholder="Describe the item perfectly..." 
              className="nexus-input nexus-input-blue h-24 resize-none" 
              value={formData.description} 
              onChange={(e) => setFormData({...formData, description: e.target.value})} 
            />
          </div>

          {/* Toggles */}
          <div className="col-span-full flex flex-wrap gap-4">
            <button
              type="button"
              onClick={() => setFormData({...formData, isVegetarian: !formData.isVegetarian})}
              className={`px-5 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest border transition-all ${
                formData.isVegetarian 
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' 
                  : 'bg-white/5 border-white/10 text-gray-500 hover:border-white/20'
              }`}
            >
              {formData.isVegetarian ? '🥬 Vegetarian' : '🥬 Mark Veg'}
            </button>
            <button
              type="button"
              onClick={() => setFormData({...formData, isEliteOnly: !formData.isEliteOnly})}
              className={`px-5 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest border transition-all ${
                formData.isEliteOnly 
                  ? 'bg-[#C9A84C]/10 border-[#C9A84C]/30 text-[#C9A84C]' 
                  : 'bg-white/5 border-white/10 text-gray-500 hover:border-white/20'
              }`}
            >
              {formData.isEliteOnly ? '★ Elite Only' : '☆ Standard'}
            </button>
          </div>

          {/* Tags */}
          <div className="space-y-2 col-span-full">
            <label className="text-[10px] font-black uppercase tracking-widest text-gray-500 ml-1">Tags (comma separated)</label>
            <input 
              placeholder="e.g. Spicy, Bestseller, New" 
              className="nexus-input nexus-input-blue" 
              value={formData.tags} 
              onChange={(e) => setFormData({...formData, tags: e.target.value})} 
            />
          </div>

          {vendorType === 'RENTAL' && (
            <>
              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase tracking-widest text-amber-400 ml-1">Owner Name</label>
                <input placeholder="e.g. Shanmukesh K." className="nexus-input" value={formData.ownerName} onChange={(e) => setFormData({...formData, ownerName: e.target.value})} />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase tracking-widest text-amber-400 ml-1">Owner Contact</label>
                <input placeholder="e.g. 9391955674" className="nexus-input" value={formData.ownerPhone} onChange={(e) => setFormData({...formData, ownerPhone: e.target.value})} />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase tracking-widest text-blue-400 ml-1">Engine / Battery Specs</label>
                <input placeholder="e.g. 250W Brushless" className="nexus-input nexus-input-blue" value={formData.engine} onChange={(e) => setFormData({...formData, engine: e.target.value})} />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase tracking-widest text-blue-400 ml-1">Top Speed (km/h)</label>
                <input placeholder="e.g. 25" className="nexus-input nexus-input-blue" value={formData.topSpeed} onChange={(e) => setFormData({...formData, topSpeed: e.target.value})} />
              </div>
            </>
          )}
       </div>

       <div className="flex gap-4 mt-10 relative">
          <button 
            onClick={() => {
              const newErrors: Record<string, string> = {};
              if (!formData.name.trim()) newErrors.submit = "Name is required";
              if (formData.price < 0) newErrors.submit = "Price cannot be negative";
              if (formData.ownerPhone && formData.ownerPhone.length !== 10) newErrors.submit = "Phone must be 10 digits";
              
              if (Object.keys(newErrors).length > 0) {
                setErrors(newErrors);
                return;
              }
              onSubmit(formData, imageFile);
            }} 
            className="flex-1 py-4 bg-blue-600 hover:bg-blue-500 hover:shadow-[0_0_30px_rgba(37,99,235,0.3)] text-white font-black uppercase tracking-[0.2em] rounded-2xl text-xs transition-all duration-300 disabled:opacity-40"
          >
            {initialData ? 'Commit Modifications' : 'Commit Asset'}
          </button>
          <button 
            onClick={onCancel} 
            className="px-10 py-4 bg-white/5 hover:bg-white/10 text-gray-400 font-black uppercase tracking-widest rounded-2xl text-xs transition-all border border-white/5 hover:border-white/10"
          >
            Cancel
          </button>
       </div>
    </div>
  );
}
