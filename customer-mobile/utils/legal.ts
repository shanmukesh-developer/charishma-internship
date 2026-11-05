// C4 legal: links to the public policy pages + the current policy version (GET /api/config/legal).
import { Alert, Linking } from 'react-native';
import { router } from 'expo-router';
import { ENDPOINTS } from '../constants/api';

export type LegalPage = 'terms' | 'privacy' | 'refunds' | 'grievance' | 'community' | 'index' | 'deleteAccount';

export const LEGAL_LINKS: Record<LegalPage, string> = {
  terms: ENDPOINTS.terms,
  privacy: ENDPOINTS.privacyPolicy,
  refunds: ENDPOINTS.refundPolicy,
  grievance: ENDPOINTS.grievance,
  community: ENDPOINTS.communityGuidelines,
  index: ENDPOINTS.legalIndex,
  deleteAccount: ENDPOINTS.deleteAccountInfo,
};

export const LEGAL_LABELS: Record<LegalPage, string> = {
  terms: 'Terms of Service',
  privacy: 'Privacy Policy',
  refunds: 'Cancellation & Refunds',
  grievance: 'Grievance Redressal',
  community: 'Community Guidelines',
  index: 'All policies',
  deleteAccount: 'Delete your account',
};

/**
 * Opens a policy page inside the app (app/legal-view.tsx, QA Q5 5 Nov 2026); if navigation is not ready yet (very early
 * in start-up) it falls back to the browser, and when that fails too it shows the address.
 */
export const openLegal = (page: LegalPage) => {
  try {
    router.push({ pathname: '/legal-view', params: { page } } as any);
  } catch {
    Linking.openURL(LEGAL_LINKS[page]).catch(() => {
      Alert.alert(LEGAL_LABELS[page], `We couldn't open the page here. You can read it at: ${LEGAL_LINKS[page]}`);
    });
  }
};

let cached: { at: number; version: string | null } | null = null;

/** Current policy version from the server (cached 10 min). null when offline: the server then records its own current version. */
export async function getPolicyVersion(): Promise<string | null> {
  if (cached && Date.now() - cached.at < 10 * 60 * 1000) return cached.version;
  try {
    const res = await fetch(ENDPOINTS.legalInfo);
    if (!res.ok) return cached ? cached.version : null;
    const data = await res.json();
    const v = typeof data?.policyVersion === 'string' ? data.policyVersion : null;
    cached = { at: Date.now(), version: v };
    return v;
  } catch {
    return cached ? cached.version : null;
  }
}

/** Fields to add to a sign-up body once the user ticked the Terms box. */
export async function consentFields(): Promise<{ acceptTerms: true; termsVersion?: string }> {
  const v = await getPolicyVersion();
  return v ? { acceptTerms: true, termsVersion: v } : { acceptTerms: true };
}
