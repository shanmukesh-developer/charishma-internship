// Prep-time and reject-reason pickers. Used inline in the full-screen new-order alert (a Modal on top of
// a Modal is unreliable on Android) and inside bottom sheets elsewhere.
import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { PREP_TIMES, REJECT_REASONS } from '../config';
import { rupees } from '../lib/model';
import { useStore } from '../state/StoreProvider';
import { color, font, radius, space } from '../theme';
import { Button, Chip, Sheet } from '../ui/kit';
import type { Order } from '../types';

export function defaultPrep(deliveryTime: number | null | undefined): number {
  if (!deliveryTime) return 15;
  // Closest chip to the store's usual time.
  return [...PREP_TIMES].sort((a, b) => Math.abs(a - deliveryTime) - Math.abs(b - deliveryTime))[0];
}

export function PrepPicker({ order, onDone, onBack, onRed }: {
  order: Order; onDone: () => void; onBack?: () => void; onRed?: boolean;
}) {
  const { accept, busy, store, restaurant, actionErrors } = useStore();
  const [mins, setMins] = useState(() => defaultPrep(store?.deliveryTime ?? restaurant.deliveryTime));
  const b = busy[order.id];
  return (
    <View style={{ gap: space.md }}>
      <Text style={[font.h2, { color: onRed ? color.textInverse : color.text }]}>Food ready in?</Text>
      <View style={styles.grid}>
        {PREP_TIMES.map((m) => (
          <Chip
            key={m}
            label={`${m}`}
            sub="MIN"
            tone="green"
            selected={m === mins}
            onPress={() => setMins(m)}
            a11y={`${m} minutes`}
            style={styles.cell4}
          />
        ))}
      </View>
      <ActionError text={!b ? actionErrors[order.id] : undefined} onRed={onRed} />
      <Button
        label={`ACCEPT · ${mins} MIN`}
        variant="accept"
        size="huge"
        icon="checkmark-circle"
        loading={b === 'accept'}
        disabled={!!b}
        onPress={async () => { if (await accept(order, mins)) onDone(); }}
      />
      {onBack ? <Button label="Back" variant={onRed ? 'outlineOnRed' : 'secondary'} size="secondary" onPress={onBack} disabled={!!b} /> : null}
    </View>
  );
}

export function RejectPicker({ order, onDone, onBack, onRed }: {
  order: Order; onDone: () => void; onBack?: () => void; onRed?: boolean;
}) {
  const { reject, busy, actionErrors } = useStore();
  const [reason, setReason] = useState<string | null>(null);
  const [other, setOther] = useState('');
  const isOther = reason === 'Other';
  const finalReason = isOther ? other.trim() : reason;
  const b = busy[order.id];
  return (
    <View style={{ gap: space.sm }}>
      <Text style={[font.h2, { color: onRed ? color.textInverse : color.text }]}>Why reject?</Text>
      <View style={[styles.grid, onRed && styles.panel]}>
        {[...REJECT_REASONS, 'Other'].map((r) => (
          <Chip key={r} label={r} tone="red" selected={reason === r} onPress={() => setReason(r)} style={styles.cell2} />
        ))}
      </View>
      {isOther ? (
        <TextInput
          value={other}
          onChangeText={(t) => setOther(t.slice(0, 250))}
          placeholder="Reason for the customer"
          placeholderTextColor={color.textMuted}
          style={styles.input}
          multiline
          maxLength={250}
          autoFocus
          accessibilityLabel="Other reason"
        />
      ) : null}
      {order.paymentMethod === 'Wallet' ? (
        <Text style={[font.small, { color: onRed ? color.textInverse : color.textSecondary }]}>
          The customer gets {rupees(order.finalPrice)} back in their ZCS Wallet automatically.
        </Text>
      ) : null}
      <ActionError text={!b ? actionErrors[order.id] : undefined} onRed={onRed} />
      <Button
        label="REJECT ORDER"
        variant={onRed ? 'onRed' : 'reject'}
        icon="close-circle"
        disabled={!finalReason || !!b}
        loading={b === 'reject'}
        onPress={async () => { if (finalReason && (await reject(order, finalReason))) onDone(); }}
      />
      {onBack ? <Button label="Back" variant={onRed ? 'outlineOnRed' : 'secondary'} size="secondary" onPress={onBack} disabled={!!b} /> : null}
    </View>
  );
}

/** Inline error under the pickers (a toast would be hidden behind the full-screen alert / sheet). */
function ActionError({ text, onRed }: { text?: string; onRed?: boolean }) {
  if (!text) return null;
  return (
    <View style={[styles.err, onRed && { backgroundColor: color.surface }]} accessibilityLiveRegion="assertive">
      <Text style={[font.body, { color: color.alertDark, fontWeight: '800' }]}>{text}</Text>
      <Text style={[font.small, { color: color.textSecondary }]}>Tap the button again to retry.</Text>
    </View>
  );
}

/** Accept / Reject sheets for any screen: `const { openAccept, openReject, sheets } = useOrderSheets()`. */
export function useOrderSheets() {
  const [acceptFor, setAcceptFor] = useState<Order | null>(null);
  const [rejectFor, setRejectFor] = useState<Order | null>(null);
  const sheets = (
    <>
      <Sheet visible={!!acceptFor} onClose={() => setAcceptFor(null)} title={acceptFor ? `Accept #${acceptFor.shortId}` : ''}>
        {acceptFor ? <PrepPicker key={acceptFor.id} order={acceptFor} onDone={() => setAcceptFor(null)} /> : null}
      </Sheet>
      <Sheet visible={!!rejectFor} onClose={() => setRejectFor(null)} title={rejectFor ? `Reject #${rejectFor.shortId}` : ''}>
        {rejectFor ? (
          <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 560 }}>
            <RejectPicker key={rejectFor.id} order={rejectFor} onDone={() => setRejectFor(null)} />
          </ScrollView>
        ) : null}
      </Sheet>
    </>
  );
  return { openAccept: setAcceptFor, openReject: setRejectFor, sheets };
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  cell4: { flexGrow: 1, flexBasis: '22%', minHeight: 72 },
  cell2: { flexGrow: 1, flexBasis: '46%', minHeight: 64 },
  err: { backgroundColor: color.alertTint, borderRadius: radius.md, padding: space.sm, gap: 2 },
  panel: { backgroundColor: color.surface, borderRadius: radius.lg, padding: space.xs },
  input: {
    minHeight: 72, borderWidth: 2, borderColor: color.border, borderRadius: radius.md, padding: space.sm,
    ...font.body, color: color.text, textAlignVertical: 'top', backgroundColor: color.surface,
  },
});
