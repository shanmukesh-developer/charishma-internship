import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Linking, StyleSheet } from 'react-native';
import { ExternalLink, Phone, Globe, ShieldCheck } from '../../../../components/lucide';
import { FriendsScreenModal } from '../shared/FriendsSheet';
import { FriendsSkeleton } from '../shared/FriendsSkeleton';
import { FriendsError } from '../shared/FriendsEmpty';
import { formatLocal } from '../shared/RelativeTime';
import { FriendsColors, FS, FT, FR, fui } from '../friendsTheme';
import { ConnectHelpline, ConnectPolicy, fetchConnectPolicy } from '../api/connectApi';
import { connectErrorMessage } from './connectShared';

import { themedSheet } from '../../../../utils/themeNow';
/** Opens a helpline's phone or https link. */
export const openHelpline = (h: ConnectHelpline) => {
  if (h.phone) Linking.openURL(`tel:${h.phone.replace(/[^\d+]/g, '')}`).catch(() => {});
  else if (h.url && /^https:\/\//i.test(h.url)) Linking.openURL(h.url).catch(() => {});
};

export const HelplineRows: React.FC<{ helplines: ConnectHelpline[] }> = ({ helplines }) =>
  helplines.length ? (
    <View style={fui.card}>
      {helplines.map((h, i) => {
        const tappable = !!(h.phone || (h.url && /^https:\/\//i.test(h.url)));
        return (
          <TouchableOpacity
            key={`${h.name}-${i}`}
            style={[fui.row, i === helplines.length - 1 && { borderBottomWidth: 0 }]}
            onPress={() => openHelpline(h)}
            disabled={!tappable}
            accessibilityRole={h.phone ? 'button' : 'link'}
            accessibilityLabel={`${h.name}${h.phone ? `, call ${h.phone}` : ''}${h.note ? `. ${h.note}` : ''}`}
          >
            {h.phone ? <Phone size={18} color={FriendsColors.accent} /> : <Globe size={18} color={FriendsColors.accent} />}
            <View style={{ flex: 1 }}>
              <Text style={FT.h3}>{h.name}</Text>
              {h.phone ? <Text style={[FT.small, { color: FriendsColors.accent }]}>{h.phone}</Text> : null}
              {h.note ? <Text style={FT.small}>{h.note}</Text> : null}
            </View>
          </TouchableOpacity>
        );
      })}
    </View>
  ) : (
    <Text style={FT.muted}>No helplines are listed for your campus yet.</Text>
  );

/**
 * The Connect privacy notice (DPDP): what is collected, why, who sees it, how long it is kept, and how to
 * withdraw. Text comes from the server config; a hosted page is linked when the owner sets one.
 */
export const ConnectPolicyScreen: React.FC<{ visible: boolean; onClose: () => void }> = ({ visible, onClose }) => {
  const [policy, setPolicy] = useState<ConnectPolicy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setPolicy(await fetchConnectPolicy());
    } catch (e: any) {
      setError(connectErrorMessage(e, "Couldn't load the privacy notice."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (visible && !policy) load();
  }, [visible, policy, load]);

  return (
    <FriendsScreenModal visible={visible} onClose={onClose} title="Connect privacy notice" subtitle={policy ? `Version ${policy.version}` : undefined}>
      {loading && !policy ? (
        <FriendsSkeleton rows={3} variant="row" />
      ) : error && !policy ? (
        <FriendsError message={error} onRetry={load} />
      ) : policy ? (
        <ScrollView contentContainerStyle={{ padding: FS.lg, paddingBottom: 60, gap: FS.lg }}>
          <View style={styles.hero}>
            <ShieldCheck size={20} color={FriendsColors.accent} />
            <Text style={[FT.small, { flex: 1, color: FriendsColors.ink }]}>
              Connect never collects your location. Your photos are private, shown only after a moderator approves them, and only to students on your campus who can see you.
            </Text>
          </View>
          <Text style={[FT.body, { lineHeight: 22 }]} selectable>
            {policy.text}
          </Text>
          {policy.updatedAt ? <Text style={FT.small}>Last updated {formatLocal(policy.updatedAt)}</Text> : null}
          {policy.url ? (
            <TouchableOpacity style={fui.ghostBtn} onPress={() => Linking.openURL(policy.url as string).catch(() => {})} accessibilityRole="link" accessibilityLabel="Open the full privacy policy in your browser">
              <ExternalLink size={16} color={FriendsColors.ink} />
              <Text style={fui.ghostBtnText}>Full privacy policy</Text>
            </TouchableOpacity>
          ) : null}
          {policy.guidance.length ? (
            <View style={{ gap: FS.sm }}>
              <Text style={FT.kicker} accessibilityRole="header">
                Staying safe
              </Text>
              {policy.guidance.map((g, i) => (
                <View key={i} style={styles.bullet}>
                  <View style={styles.dot} />
                  <Text style={[FT.body, { flex: 1 }]}>{g}</Text>
                </View>
              ))}
            </View>
          ) : null}
          <View style={{ gap: FS.sm }}>
            <Text style={FT.kicker} accessibilityRole="header">
              Need help now?
            </Text>
            <HelplineRows helplines={policy.helplines} />
          </View>
        </ScrollView>
      ) : null}
    </FriendsScreenModal>
  );
};

const styles = themedSheet(() => ({
  hero: { flexDirection: 'row', gap: FS.sm, padding: FS.md, borderRadius: FR.md, backgroundColor: FriendsColors.accentSoft },
  bullet: { flexDirection: 'row', gap: FS.sm, alignItems: 'flex-start' },
  dot: { width: 5, height: 5, borderRadius: 3, backgroundColor: FriendsColors.accent, marginTop: 8 },
}));
