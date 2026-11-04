/**
 * PG v2: no sample content (owner, 3 Nov 2026: "remove mock data from everywhere in the entire project"; the 24 Oct
 * layer that filled a listing's missing sections with invented text, amenities, mess menu, rules, safety details,
 * map pin and reviews is gone). A PG page shows exactly what its owner entered; a missing section shows the screen's
 * own empty state. The exports stay so the screens' imports are unchanged.
 */
import type { PgDetail, PgReview } from '../pg/pgApi';

export const PG_V2_DEMO_CONTENT = false;

/** Which sections of a PG came from sample content: none any more (kept for the screens that read it). */
export interface DemoFlags {
  isDemoContent: boolean;
  about: boolean; highlights: boolean; mess: boolean; rules: boolean; policies: boolean; safety: boolean;
  moveIn: boolean; location: boolean; nearby: boolean; faq: boolean; reviews: boolean; amenities: boolean;
}
export type PgWithDemo = PgDetail & { demo: DemoFlags };
export interface DemoReview extends PgReview { isDemoContent: true }

/** SRM University AP, main gate (approximate): the map's centre. */
export const SRM_AP = { lat: 16.4626, lng: 80.507 };

const NONE: DemoFlags = { isDemoContent: false, about: false, highlights: false, mess: false, rules: false, policies: false, safety: false, moveIn: false, location: false, nearby: false, faq: false, reviews: false, amenities: false };

/** The listing as its owner entered it. */
export const applyDemo = (pg: PgDetail): PgWithDemo => ({ ...pg, demo: NONE });

export const demoReviews = (_pg: PgDetail): DemoReview[] => [];

export const demoSummary = (list: { rating: number }[]) => (list.length ? { average: list.reduce((a, r) => a + r.rating, 0) / list.length, count: list.length } : { average: null, count: 0 });
