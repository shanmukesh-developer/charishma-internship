/**
 * QR for a Campus Events ticket. The QR holds only the server's opaque signed token (ZE1.<id>.<ver>.<mac>):
 * no name, phone or user id. Rendered only for an ACTIVE ticket whose token the server returned; anything
 * else shows why there is no QR (never a QR for a non-confirmed / cancelled / used ticket).
 * Always black on white with a quiet zone, whatever the app theme, so gate scanners can read it.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import QRCode from 'react-native-qrcode-svg';
import { TICKET_STATUS_META, type TicketStatus } from './campusEventsApi';

export default function TicketQR({ token, status, code, size = 220 }: { token: string | null | undefined; status: TicketStatus; code: string; size?: number }) {
  const show = status === 'ACTIVE' && typeof token === 'string' && token.length > 10;
  if (!show) {
    const m = TICKET_STATUS_META[status] || { label: 'Not valid', color: '#64748B' };
    const why = status === 'USED' ? 'This ticket was already used at the entry.' : status === 'ACTIVE' ? 'The QR is not available right now. Pull to refresh, or show the ticket code.' : 'This ticket is no longer valid and will not be admitted.';
    return (
      <View style={[s.box, { width: size + 32, minHeight: size + 32, borderColor: `${m.color}88` }]} accessibilityRole="image" accessibilityLabel={`No QR code. ${m.label}. ${why}`}>
        <Ionicons name={status === 'USED' ? 'checkmark-circle' : 'ban-outline'} size={40} color={status === 'USED' ? '#047857' : '#B91C1C'} />
        <Text style={{ fontSize: 16, fontWeight: '900', color: '#111827', marginTop: 8 }}>{m.label}</Text>
        <Text style={{ fontSize: 12, color: '#374151', textAlign: 'center', marginTop: 6, lineHeight: 17 }}>{why}</Text>
      </View>
    );
  }
  return (
    <View style={[s.box, { width: size + 32, borderColor: '#E5E7EB' }]} accessibilityRole="image" accessibilityLabel={`Entry QR code. Ticket code ${code.split('').join(' ')}`}>
      <QRCode value={token as string} size={size} color="#000000" backgroundColor="#FFFFFF" ecl="M" quietZone={8} />
    </View>
  );
}

/** '7KQ2-MX9T-AB' style grouping for reading a code aloud / typing it. */
export const groupCode = (code: string) => String(code || '').replace(/(.{4})(?=.)/g, '$1 ');

const s = StyleSheet.create({
  box: { backgroundColor: '#FFFFFF', borderRadius: 20, borderWidth: 1, padding: 16, alignItems: 'center', justifyContent: 'center', alignSelf: 'center' },
});
