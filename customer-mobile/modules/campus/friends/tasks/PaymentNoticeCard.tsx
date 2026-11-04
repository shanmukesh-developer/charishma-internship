import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Linking, StyleSheet } from 'react-native';
import { ShieldAlert, ExternalLink, IndianRupee } from '../../../../components/lucide';
import { FriendsColors, FS, FT, FR, fui } from '../friendsTheme';
import { FriendsSheet } from '../shared/FriendsSheet';
import { PAYMENT_NOTICE, buildUpiLink, isValidUpiId } from '../api/tasksApi';
import { ErrorBox, taskUi } from './TasksUi';
import { formatInr } from './tasksShared';

/**
 * The payment notice, shown exactly as the server sends it (spec text). Zenvy is not an escrow,
 * processor or guarantor; there are no fees or commission.
 */
export const PaymentNoticeCard: React.FC<{ text?: string | null; compact?: boolean; children?: React.ReactNode }> = ({ text, compact, children }) => (
  <View style={[styles.card, compact && { padding: FS.md }]} accessible={!children} accessibilityRole="text" accessibilityLabel={`Payment notice. ${text || PAYMENT_NOTICE}`}>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <ShieldAlert size={16} color={FriendsColors.warn} />
      <Text style={[FT.kicker, { color: FriendsColors.warn }]}>Payment notice</Text>
    </View>
    <Text style={[FT.muted, { marginTop: 6, color: FriendsColors.ink }]}>{text || PAYMENT_NOTICE}</Text>
    {!compact ? <Text style={[FT.small, { marginTop: 6 }]}>No posting, application or commission fees. Ever.</Text> : null}
    {children}
  </View>
);

/**
 * Optional UPI hand-off. The UPI id is typed here, checked on the phone, turned into a upi:// link and
 * opened only when the user taps the button. It is never stored or sent to Zenvy, and opening it
 * never marks the task as paid.
 */
export const UpiSheet: React.FC<{
  visible: boolean;
  onClose: () => void;
  amountInr: number;
  payeeName?: string | null;
  taskTitle: string;
  notice?: string | null;
}> = ({ visible, onClose, amountInr, payeeName, taskTitle, notice }) => {
  const [upiId, setUpiId] = useState('');
  const [amount, setAmount] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setUpiId('');
    setAmount(amountInr > 0 ? String(amountInr) : '');
    setError(null);
  }, [visible, amountInr]);

  const open = async () => {
    const id = upiId.trim();
    if (!isValidUpiId(id)) {
      setError('Enter a UPI id like name@bank. Ask your helper for it in the task chat.');
      return;
    }
    const amt = amount.trim() ? Number(amount.replace(/[^\d]/g, '')) : 0;
    if (amount.trim() && (!Number.isFinite(amt) || amt <= 0 || amt > 100000)) {
      setError('Enter a valid amount in rupees, or leave it empty.');
      return;
    }
    const url = buildUpiLink({ upiId: id, name: payeeName, amountInr: amt || null, note: `ZenWe task: ${taskTitle}` });
    try {
      await Linking.openURL(url);
      onClose();
    } catch {
      setError('No UPI app was found on this phone. Pay using any UPI app directly.');
    }
  };

  return (
    <FriendsSheet visible={visible} onClose={onClose} title="Pay with a UPI app" subtitle="Optional. ZenWe is not part of the payment." icon={<IndianRupee size={18} color={FriendsColors.gold} />}>
      <PaymentNoticeCard text={notice} compact />
      <Text style={taskUi.label}>Helper's UPI id</Text>
      <TextInput
        style={fui.input}
        value={upiId}
        onChangeText={(t) => {
          setUpiId(t.replace(/\s/g, '').slice(0, 120));
          setError(null);
        }}
        placeholder="name@bank"
        placeholderTextColor={FriendsColors.faint}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        accessibilityLabel="Helper's UPI id. Stays on your phone."
      />
      <Text style={[FT.small, { marginTop: 4 }]}>Stays on your phone. ZenWe never stores it.</Text>
      <Text style={taskUi.label}>Amount (₹)</Text>
      <TextInput
        style={fui.input}
        value={amount}
        onChangeText={(t) => {
          setAmount(t.replace(/[^\d]/g, '').slice(0, 6));
          setError(null);
        }}
        placeholder={amountInr > 0 ? String(amountInr) : 'Optional'}
        placeholderTextColor={FriendsColors.faint}
        keyboardType="number-pad"
        accessibilityLabel={`Amount in rupees. Agreed reward ${formatInr(amountInr)}.`}
      />
      <Text style={[FT.small, { marginTop: 4 }]}>Agreed reward on the task: {formatInr(amountInr)}. Check the amount and the name your UPI app shows before paying.</Text>
      <ErrorBox message={error} />
      <TouchableOpacity style={[fui.primaryBtn, { marginTop: FS.lg }]} onPress={open} accessibilityRole="button" accessibilityLabel="Open UPI app">
        <ExternalLink size={16} color={FriendsColors.accentInk} />
        <Text style={fui.primaryBtnText}>Open UPI app</Text>
      </TouchableOpacity>
      <Text style={[FT.small, { textAlign: 'center', marginTop: FS.sm }]}>Opening the app does not mark anything as paid.</Text>
    </FriendsSheet>
  );
};

const styles = StyleSheet.create({
  card: {
    padding: FS.lg,
    borderRadius: FR.card,
    backgroundColor: 'rgba(242,178,126,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(242,178,126,0.25)',
  },
});
