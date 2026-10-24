// Shapes of the /api/pg-owner replies (backend/modules/pgOwner/services/serialize.js + controllers/owner.js).
// Students appear as first name + booking code only; the server never sends their phone numbers.

export interface ListingBrief { id: string; name: string; area: string | null; isActive: boolean }

export interface OwnerSelf {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  status: 'ACTIVE' | 'SUSPENDED';
  mustChangePassword: boolean;
  deletionRequestedAt: string | null;
  listings: ListingBrief[];
}

export interface BedCounts { rooms: number; total: number; occupied: number; vacant: number }

export interface ListingSummary {
  id: string;
  name: string;
  area: string | null;
  address: string;
  genderType: string;
  isActive: boolean;
  isVerified: boolean;
  coverPhoto: string | null;
  beds: BedCounts;
}

export interface HomeResponse {
  owner: OwnerSelf;
  listings: ListingSummary[];
  totals: BedCounts;
  counts: { pendingRequests: number; tenants: number; openComplaints: number; rentReceived: number; rentDue: number };
  month: string;
}

export interface Room {
  id: string;
  roomNumber: string;
  label: string;
  roomTypeKey: string;
  sharingType: number;
  pricePerBed: number | null;
  totalBeds: number;
  availableBeds: number;
  floorNumber: number | null;
  hasAttachedBathroom: boolean;
  hasAC: boolean;
  hasBalcony: boolean;
  furnishing: string | null;
  isActive: boolean;
}

export interface RoomType {
  key: string;
  label: string;
  sharingType: number;
  hasAC: boolean;
  hasAttachedBathroom: boolean;
  rentFrom: number | null;
  rentTo: number | null;
  availableBeds: number;
  totalBeds: number;
  roomCount: number;
}

export type FoodTag = 'veg' | 'nonveg' | 'egg' | null;
export type DayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';
export interface MessMeal { key: string; label: string; start: string | null; end: string | null }
export interface MessCell { menu: string; tag: FoodTag; start?: string; end?: string }
export interface MessHoliday { date: string; meals: string[]; note: string }
export interface MessTimetable {
  meals: MessMeal[];
  days: Partial<Record<DayKey, Record<string, MessCell>>>;
  notes: string;
  holidays: MessHoliday[];
}

export type PhotoCategory = 'ROOM' | 'BATHROOM' | 'MESS' | 'BUILDING' | 'COMMON_AREA' | 'OTHER';
export interface Photo { id?: string; url: string; category: PhotoCategory; caption: string; order?: number; roomType: string | null; isCover: boolean }
export interface RuleGroup { category: string; rules: string[] }

export interface ListingDetail extends ListingSummary {
  description: string;
  amenities: string[];
  houseRules: RuleGroup[];
  photos: Photo[];
  messTimetable: MessTimetable | null;
  roomTypes: RoomType[];
  rooms: Room[];
  ruleCategories: { key: string; label: string }[];
  photoCategories: PhotoCategory[];
}

export type BookingStatus = 'Pending' | 'Confirmed' | 'Cancelled' | 'Rejected' | 'MovedOut';
export interface Booking {
  id: string;
  code: string;
  status: BookingStatus;
  checkInDate: string | null;
  durationMonths: number | null;
  note: string | null;
  decisionReason: string | null;
  decidedAt: string | null;
  movedOutAt: string | null;
  createdAt: string | null;
  student: { firstName: string };
  room: { id: string; roomNumber: string; label: string; sharingType: number; pricePerBed: number | null; hasAttachedBathroom: boolean; hasAC: boolean; availableBeds: number } | null;
  hostel: { id: string; name: string | null };
}
export interface Tenant extends Booking { rentThisMonth: 'received' | 'due' | 'not_started' }

export type RentMethod = 'cash' | 'upi' | 'bank' | 'other';
export interface RentRecord {
  id: string;
  bookingId: string;
  month: string;
  amount: number;
  method: RentMethod;
  note: string | null;
  status: 'RECEIVED' | 'VOIDED';
  receivedAt: string | null;
  voidedAt: string | null;
  voidReason: string | null;
}
export interface RentResponse {
  month: string;
  rows: { booking: Booking; expected: number; record: RentRecord | null }[];
  summary: { tenants: number; received: number; due: number; amountReceived: number; amountExpected: number };
  ledger: (RentRecord & { tenant: { firstName: string; code: string; roomNumber: string | null } | null })[];
}

export type ComplaintStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED';
export interface Complaint {
  id: string;
  code: string;
  hostel: { id: string; name: string | null };
  firstName: string;
  category: string;
  text: string;
  status: ComplaintStatus;
  ownerReply: string | null;
  repliedAt: string | null;
  resolvedAt: string | null;
  createdAt: string | null;
}

export interface OwnerNotification { id: string; title: string; body: string | null; type: string | null; data: Record<string, string>; readAt: string | null; createdAt: string | null }
export interface MediaUpload { id: string; url: string; mime?: string; size?: number }
