import { Customizations } from '@/context/CartContext';

export interface MenuItem {
  isBestseller?: boolean;
  _id?: string;
  id?: string;
  name: string;
  price: number;
  image?: string;
  imageUrl?: string;
  description?: string;
  category?: string;
  restaurantId?: string;
  restaurantName?: string;
  tags?: string[];
   isVegetarian?: boolean;
   isAvailable?: boolean;
   isEliteOnly?: boolean;
   customizations?: Customizations;
}

export interface Restaurant {
  _id: string;
  id?: string;
  name: string;
  menu: MenuItem[];
  rating?: string;
  image?: string;
  imageUrl?: string;
  description?: string;
  lat?: number;
  lon?: number;
  time?: string;
  calculatedTime?: string;
  tags?: string[];
  vendorType?: string;
  categories?: string[];
  isFeatured?: boolean;
  featuredBadge?: string;
  featuredUntil?: string;
  // CampusBites: Local Vendor Fields
  campus?: string;
  isOpenNow?: boolean;
  whatsappNumber?: string;
  subscriptionTier?: string;
  stallDescription?: string;
  promoOffer?: string;
  clickCount?: number;
  operatingHours?: { start?: string; end?: string };
  canteenType?: string;
}

export interface User {
  _id?: string;
  id?: string;
  name?: string;
  phone?: string;
  isElite?: boolean;
  defaultAddress?: string;
  zenPoints?: number;
  hostelBlock?: string;
  profileImage?: string | null;
  walletBalance?: number;
}

export interface NexusItem {
  id?: string;
  _id?: string;
  name?: string;
  price?: number | string;
  imageUrl?: string;
  category?: string;
  tags?: string[];
  isVegetarian?: boolean;
  restaurantName?: string;
  restaurantId?: string;
  rating?: number | string;
}
