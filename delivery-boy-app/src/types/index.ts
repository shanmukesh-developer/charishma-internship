export interface OrderItem {
  name: string;
  quantity: number;
  price?: number;
  restaurant?: string;
  restaurantAddress?: string;
  restaurantPhone?: string;
}

export interface Order {
  id: string;
  _id?: string;
  restaurant: string;
  restaurantAddress?: string;
  restaurantPhone?: string;
  customerName: string;
  customerPhone?: string;
  drop: string;
  items: OrderItem[];
  totalPrice?: number;
  finalPrice?: number;
  status: string;
  deliveryPin?: string;
  createdAt?: string;
  deliveredAt?: string;
  earnings?: string;
  note?: string;
  deliverySlot?: string;
  category?: 'Food' | 'Fruits' | 'Groceries' | 'Mega Basket' | string;
  isBulk?: boolean;
  megaBasketStep?: 'SHOPPING_AT_STORE' | 'BILL_UPLOADED' | 'PAYMENT_CONFIRMED' | 'DELIVERING_TO_APARTMENT';
  billProofUrl?: string;
  billAmount?: number;
  isBillApproved?: boolean;
  itemPhotoUrl?: string;
  isPurchasingApprovedByCustomer?: boolean;
}

export interface TaskStep {
  type: 'PICKUP' | 'DELIVERY';
  orderId: string;
  location: string;
  address: string;
}

export interface RiderProfile {
  id: string;
  _id?: string;
  name: string;
  email?: string;
  phone: string;
  rating: number;
  totalEarnings: number;
  completedCount: number;
  completedDeliveries?: number;
  vehicleNumber?: string;
  vehicleType?: string;
  bio?: string;
  emergencyContact?: string;
  photoUrl?: string;
  zenPoints?: number;
  loginStreak?: number;
  isApproved?: boolean;
  isOnline?: boolean;
  token?: string;
}

export interface TodayStats {
  earnings: number;
  orders: number;
  zenPoints: number;
  streak: number;
}

export interface LeaderboardEntry {
  id: string;
  name: string;
  deliveries?: number;
  orders?: number;
  earnings: number;
  rating?: number;
  isMe?: boolean;
}

export interface AppNotification {
  id: string;
  type: 'order' | 'warning' | 'info' | 'sos';
  title: string;
  message: string;
  timestamp: number;
}
