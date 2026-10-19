// C4 legal: links to the public policy pages (backend routes/legalRoutes.js) + the "By continuing" line.
import React from 'react';
import { Linking, StyleSheet, Text } from 'react-native';
import { API_URL } from '../config';
import { C } from '../theme';

const ORIGIN = API_URL.replace(/\/+$/, '').replace(/\/api$/, '');

export type LegalPage = 'terms' | 'privacy' | 'refunds' | 'grievance' | 'community' | 'index' | 'deleteAccount';
const PATHS: Record<LegalPage, string> = {
  terms: '/legal/terms',
  privacy: '/legal/privacy',
  refunds: '/legal/refunds',
  grievance: '/legal/grievance',
  community: '/legal/community-guidelines',
  index: '/legal',
  deleteAccount: '/legal/delete-account',
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
/** Pages shown in this app's settings. */
export const SETTINGS_PAGES: LegalPage[] = ['terms', 'privacy', 'refunds', 'grievance', 'community'];

export const legalUrl = (page: LegalPage) => `${ORIGIN}${PATHS[page]}`;
export const openLegal = (page: LegalPage) => { Linking.openURL(legalUrl(page)).catch(() => {}); };

/** Current policy version (GET /api/config/legal); null when offline (the server then records its own). */
export async function getPolicyVersion(): Promise<string | null> {
  try {
    const res = await fetch(`${ORIGIN}/api/config/legal`);
    if (!res.ok) return null;
    const data = await res.json();
    return typeof data?.policyVersion === 'string' ? data.policyVersion : null;
  } catch {
    return null;
  }
}

/** "By continuing you agree to the Terms of Service and Privacy Policy." with tappable links. */
export function LegalLine({ prefix = 'By continuing you agree to the' }: { prefix?: string }) {
  return (
    <Text style={s.text}>
      {prefix}{' '}
      <Text style={s.link} onPress={() => openLegal('terms')} accessibilityRole="link">Terms of Service</Text>
      {' and '}
      <Text style={s.link} onPress={() => openLegal('privacy')} accessibilityRole="link">Privacy Policy</Text>.
    </Text>
  );
}

const s = StyleSheet.create({
  text: { fontSize: 13, lineHeight: 19, color: C.muted, textAlign: 'center' },
  link: { color: C.blue, fontWeight: '800', textDecorationLine: 'underline' },
});
