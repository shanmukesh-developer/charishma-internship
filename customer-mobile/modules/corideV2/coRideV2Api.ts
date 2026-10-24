/**
 * Co-Ride v2 API for the new backend pieces (backend/routes/rideTemplateRoutes.js, bikePoolRoutes.js):
 *   regular rides   GET/POST /api/bikepool/templates, PATCH/DELETE /:id, POST /:id/skip | /pause | /resume
 *   passenger SOS   POST /api/bikepool/posts/:id/sos
 *   profile gender  PUT /api/users/profile { gender }   (women-only rides need gender Female)
 * Errors come back as one friendly sentence (server codes mapped below).
 */
import { apiFetch, readJson, NETWORK_ERROR_MESSAGE, SERVER_BUSY_MESSAGE } from '../../utils/auth';
import { API_URL } from '../../constants/api';

export interface Template {
  id: string; name: string | null; origin: string; destination: string;
  days: number[]; time: string; vehicleType: 'Bike' | 'Car'; seats: number; estimatedFuelCost: number;
  rideVibe?: string; notes?: string | null; vehicleInfo?: string | null;
  autoApprove: boolean; autoAcceptKnown: boolean; womenOnly: boolean; active: boolean; skipDates: string[];
  lastPublishedDate: string | null; nextDepartureAt: string | null;
  upcomingRide: { poolId: string; rideDate: string; departureAt: string; status: string | null } | null;
}
export interface TemplateInput {
  origin: string; destination: string; days: number[]; time: string; vehicleType: 'bike' | 'car'; seats: number;
  estimatedFuelCost?: number; name?: string; rideVibe?: string; notes?: string; autoApprove?: boolean; autoAcceptKnown?: boolean; womenOnly?: boolean;
}
export type ApiResult<T> = { ok: true; data: T } | { ok: false; code?: string; field?: string; message: string; status?: number };

const FRIENDLY: Record<string, string> = {
  WOMEN_ONLY_HOST: 'Women-only rides can be posted by hosts whose profile gender is Female. Set your gender first.',
  WOMEN_ONLY: 'This ride is for women only, so you cannot join it.',
  NOT_ON_RIDE: 'SOS from the app works for the host and confirmed riders of this ride. Call 112 for any emergency.',
  SOS_RATE_LIMIT: 'Your SOS was already sent a moment ago. ZCS support is on it. Call 112 if you are in danger.',
  TEMPLATE_LIMIT: 'You can save up to 10 regular rides. Delete one first.',
};
export const friendly = (code?: string, message?: string) => (code && FRIENDLY[code]) || message || 'Something went wrong. Please try again.';

async function call<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
  try {
    const res = await apiFetch(`${API_URL}${path}`, init);
    const data = await readJson(res);
    if (!data) return { ok: false, message: SERVER_BUSY_MESSAGE, status: res.status };
    if (!res.ok) {
      const msg = res.status >= 500 ? 'Something went wrong on our side. Try again in a moment.' : friendly(data.code, typeof data.message === 'string' ? data.message : undefined);
      return { ok: false, code: data.code, field: data.field, message: msg, status: res.status };
    }
    return { ok: true, data: data as T };
  } catch {
    return { ok: false, message: NETWORK_ERROR_MESSAGE };
  }
}
const json = (method: string, body?: any): RequestInit => ({ method, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
const T = '/api/bikepool/templates';

export const coRideApi = {
  templates: () => call<{ templates: Template[] }>(T),
  createTemplate: (b: TemplateInput) => call<{ template: Template }>(T, json('POST', b)),
  updateTemplate: (id: string, b: Partial<TemplateInput> & { active?: boolean }) => call<{ template: Template }>(`${T}/${encodeURIComponent(id)}`, json('PATCH', b)),
  deleteTemplate: (id: string) => call<{ ok: boolean; id: string }>(`${T}/${encodeURIComponent(id)}`, json('DELETE')),
  skip: (id: string, date: string) => call<{ template: Template; cancelledRideId: string | null }>(`${T}/${encodeURIComponent(id)}/skip`, json('POST', { date })),
  pause: (id: string) => call<{ template: Template }>(`${T}/${encodeURIComponent(id)}/pause`, json('POST', {})),
  resume: (id: string) => call<{ template: Template }>(`${T}/${encodeURIComponent(id)}/resume`, json('POST', {})),
  sos: (rideId: string, note?: string) => call<{ ok: boolean; ticketId: string; emergencyNumber: string; locationShared: boolean; message: string }>(`/api/bikepool/posts/${encodeURIComponent(rideId)}/sos`, json('POST', note ? { note } : {})),
  setGender: (gender: 'Male' | 'Female' | 'Other' | 'Prefer not to say') => call<any>('/api/users/profile', json('PUT', { gender })),
};

/** 'YYYY-MM-DD' in India time, `offset` days from today. */
export const istDate = (offset = 0) => new Date(Date.now() + 330 * 60000 + offset * 86400000).toISOString().slice(0, 10);
