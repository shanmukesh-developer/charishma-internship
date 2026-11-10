/**
 * Food & groceries v2: one icon set everywhere (lucide-react-native, 1.75 stroke).
 * `Icon` keeps the old Ionicons-style names used across Food & groceries and maps them to lucide.
 * Others → Food & groceries (modules/foodV2).
 */
import React from 'react';
import {
  Apple, ArrowLeft, ArrowRight, Bell, Check, ChevronLeft, ChevronRight, Clock, Cookie, CupSoda, Croissant, Heart,
  Leaf, Minus, Plug, Plus, Puzzle, Search, Server, Share, ShoppingBasket, ShoppingCart, Sparkles, Sprout, Star,
  Store, TriangleAlert, WifiOff, X, CircleX, Wheat, Bean, Droplet, Flame, Package, LayoutGrid, Milk, Truck, Gift, type LucideIcon,
} from 'lucide-react-native';

const MAP: Record<string, LucideIcon> = {
  add: Plus, remove: Minus, search: Search, 'search-outline': Search,
  'arrow-back': ArrowLeft, 'arrow-forward': ArrowRight, 'chevron-forward': ChevronRight, 'chevron-back': ChevronLeft,
  heart: Heart, 'heart-outline': Heart, star: Star, close: X, 'close-circle': CircleX, checkmark: Check,
  'time-outline': Clock, 'warning-outline': TriangleAlert, 'storefront-outline': Store, 'share-outline': Share,
  'cart-outline': ShoppingCart, 'basket-outline': ShoppingBasket, 'notifications-outline': Bell, leaf: Leaf,
  'wifi-off': WifiOff, server: Server,
  // category placeholders
  apple: Apple, cookie: Cookie, 'cup-soda': CupSoda, croissant: Croissant, sparkles: Sparkles, puzzle: Puzzle,
  sprout: Sprout, plug: Plug,
  wheat: Wheat, bean: Bean, droplet: Droplet, flame: Flame, package: Package, grid: LayoutGrid, milk: Milk, truck: Truck, gift: Gift,
};
/** Filled variants (saved heart, rating star). */
const FILLED = new Set(['heart', 'star']);

export function Icon({ name, size = 20, color = '#FFFFFF', strokeWidth = 1.75 }: { name: string; size?: number; color?: string; strokeWidth?: number; style?: any }) {
  const C = MAP[name] || ChevronRight;
  return <C size={size} color={color} strokeWidth={strokeWidth} fill={FILLED.has(name) ? color : 'none'} />;
}

/** Placeholder icon per product group (image failed to load). */
export const GROUP_ICON: Record<string, string> = {
  Groceries: 'basket-outline', Snacks: 'cookie', Beverages: 'cup-soda', Fresh: 'apple', Bakery: 'croissant',
  'Personal care': 'droplet', 'Gifts & toys': 'gift', Seeds: 'sprout', Electronics: 'plug',
};
