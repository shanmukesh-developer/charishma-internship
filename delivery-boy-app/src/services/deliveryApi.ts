import { apiFetch } from './apiClient';
import type { Order, RiderProfile, TodayStats, LeaderboardEntry, TaskStep } from '../types';

export interface LoginResponse {
  _id: string;
  name: string;
  phone: string;
  token: string;
  rating?: number;
  vehicleType?: string;
  vehicleNumber?: string;
  isApproved?: boolean;
  isAvailable?: boolean;
  zenPoints?: number;
  completedDeliveries?: number;
  loginStreak?: number;
}

export async function login(phone: string, password: string): Promise<LoginResponse> {
  return apiFetch<LoginResponse>('/delivery/login', {
    method: 'POST',
    body: JSON.stringify({ phone, password }),
  });
}

export async function fetchActiveOrders(): Promise<{ orders: Order[]; taskSequence: TaskStep[] }> {
  const data = await apiFetch<{ orders?: Order[]; taskSequence?: TaskStep[] } | Order[]>('/delivery/orders/active');
  if (Array.isArray(data)) {
    return { orders: normalizeOrders(data), taskSequence: [] };
  }
  return {
    orders: normalizeOrders(data.orders || []),
    taskSequence: data.taskSequence || [],
  };
}

export async function fetchPendingOrders(): Promise<Order[]> {
  const data = await apiFetch<Order[]>('/delivery/orders/pending');
  return normalizeOrders(Array.isArray(data) ? data : []);
}

export async function fetchOrderHistory(): Promise<Order[]> {
  const data = await apiFetch<Order[]>('/delivery/orders/history');
  return normalizeOrders(Array.isArray(data) ? data : []);
}

export async function fetchTodayStats(): Promise<TodayStats> {
  return apiFetch<TodayStats>('/delivery/stats/today');
}

export async function fetchLeaderboard(): Promise<LeaderboardEntry[]> {
  const data = await apiFetch<LeaderboardEntry[]>('/delivery/leaderboard');
  return Array.isArray(data) ? data : [];
}

export async function fetchProfile(): Promise<RiderProfile> {
  const data = await apiFetch<RiderProfile & { _id?: string }>('/delivery/profile');
  return {
    ...data,
    id: data._id || data.id,
    rating: data.rating ?? 4.9,
    totalEarnings: data.totalEarnings ?? 0,
    completedCount: data.completedCount ?? data.completedDeliveries ?? 0,
  };
}

export async function updateProfile(payload: Partial<RiderProfile>): Promise<RiderProfile> {
  return apiFetch<RiderProfile>('/delivery/profile', {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  await apiFetch('/delivery/profile/password', {
    method: 'PUT',
    body: JSON.stringify({ currentPassword, newPassword }),
  });
}

export async function toggleOnline(isOnline: boolean): Promise<{ isOnline: boolean }> {
  return apiFetch('/delivery/online', {
    method: 'PUT',
    body: JSON.stringify({ isOnline }),
  });
}

export async function acceptOrder(orderId: string): Promise<Order> {
  return apiFetch<Order>(`/delivery/accept/${orderId}`, { method: 'PUT' });
}

export async function updateOrderStatus(orderId: string, status: string, pin?: string): Promise<void> {
  await apiFetch(`/delivery/status/${orderId}`, {
    method: 'PUT',
    body: JSON.stringify({ status, ...(pin !== undefined ? { pin } : {}) }),
  });
}

export async function arriveAtGate(orderId: string): Promise<void> {
  await apiFetch(`/delivery/arrive/${orderId}`, { method: 'PUT' });
}

export async function cancelOrder(orderId: string): Promise<void> {
  await apiFetch(`/delivery/cancel/${orderId}`, { method: 'PUT' });
}

export async function saveFcmToken(fcmToken: string, appVersion = '1.0.0'): Promise<void> {
  await apiFetch('/delivery/fcm-token', {
    method: 'POST',
    body: JSON.stringify({ fcmToken, appVersion }),
  });
}

function normalizeOrders(orders: Order[]): Order[] {
  return orders.map((o) => {
    const items = Array.isArray(o.items) ? o.items : [];
    const totalQty = items.reduce((acc, item) => acc + (item.quantity || 1), 0);
    const totalPrice = o.totalPrice || o.finalPrice || items.reduce((acc, item) => acc + ((item.price || 0) * (item.quantity || 1)), 0);
    const isBulk = o.isBulk !== undefined ? o.isBulk : (totalQty >= 5 || totalPrice >= 500);

    let category = o.category;
    if (!category) {
      const text = `${o.restaurant} ${items.map(i => i.name).join(' ')}`.toLowerCase();
      if (text.includes('fruit') || text.includes('apple') || text.includes('mango') || text.includes('juice')) {
        category = 'Fruits';
      } else if (text.includes('grocery') || text.includes('soap') || text.includes('snack') || text.includes('biscuit') || text.includes('surf')) {
        category = 'Groceries';
      } else {
        category = 'Food';
      }
    }

    return {
      ...o,
      id: String(o._id || o.id),
      customerName: o.customerName || 'Customer',
      restaurant: o.restaurant || 'Restaurant',
      drop: o.drop || 'Delivery',
      items,
      status: o.status || 'Accepted',
      totalPrice,
      category,
      isBulk,
      deliverySlot: o.deliverySlot || 'Standard',
    };
  });
}

export function loginResponseToProfile(data: LoginResponse): RiderProfile {
  return {
    id: data._id,
    name: data.name,
    phone: data.phone,
    rating: data.rating ?? 4.9,
    totalEarnings: 0,
    completedCount: data.completedDeliveries ?? 0,
    vehicleType: data.vehicleType,
    zenPoints: data.zenPoints,
    loginStreak: data.loginStreak,
    isApproved: data.isApproved,
    token: data.token,
  };
}
