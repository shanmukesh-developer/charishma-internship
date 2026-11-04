// Admin-set product choices (weights with their own prices, flavours, types, add-ons, a typed message).
// Contract: docs/PRODUCT_OPTIONS.md. The server prices every line from the same rules
// (backend/utils/productOptions.js); the prices shown here are only the preview.
//  - productOptions(p) / hasOptions(p): the groups of a product (catalogue `options` or menu `specs.options`).
//  - OptionsPicker: the groups drawn inline (product page).
//  - OptionsSheetProvider + useAskOptions(): a bottom sheet asking for the choices before an "Add" from a list.
import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../context/ThemeContext';
import SafeImage from './SafeImage';

export type OptionChoice = { label: string; price: number; mrp?: number; isDefault?: boolean };
export type OptionGroup = {
  name: string;
  type: 'variant' | 'single' | 'multi' | 'text';
  required?: boolean;
  max?: number;
  maxLength?: number;
  choices?: OptionChoice[];
};
/** The customer's picks: group name -> label (variant / single), labels (multi) or typed text. */
export type OptionPicks = Record<string, string | string[]>;

const TYPES = ['variant', 'single', 'multi', 'text'];

/** The product's choice groups (catalogue items carry `options`, menu items `specs.options`). */
export function productOptions(p: any): OptionGroup[] {
  let raw = p?.options;
  if (!Array.isArray(raw)) {
    let specs = p?.specs;
    if (typeof specs === 'string') { try { specs = JSON.parse(specs); } catch { specs = null; } }
    raw = specs && Array.isArray(specs.options) ? specs.options : [];
  }
  return (raw as any[]).filter((g) => g && typeof g.name === 'string' && TYPES.includes(g.type))
    .map((g) => ({ ...g, choices: Array.isArray(g.choices) ? g.choices.filter((c: any) => c && typeof c.label === 'string').map((c: any) => ({ label: c.label, price: Number(c.price) || 0, ...(Number(c.mrp) > 0 ? { mrp: Number(c.mrp) } : {}), ...(c.isDefault ? { isDefault: true } : {}) })) : [] }));
}
export const hasOptions = (p: any) => productOptions(p).length > 0;

/** Ordered product details the admin entered ({ label, value } rows), or null. */
export function productDetails(p: any): { label: string; value: string }[] | null {
  let rows = p?.details;
  if (!Array.isArray(rows)) {
    let specs = p?.specs;
    if (typeof specs === 'string') { try { specs = JSON.parse(specs); } catch { specs = null; } }
    rows = specs && Array.isArray(specs.details) ? specs.details : null;
  }
  const out = (rows || []).filter((r: any) => r && r.label && r.value).map((r: any) => ({ label: String(r.label), value: String(r.value) }));
  return out.length ? out : null;
}

/** Default picks: the weight / size marked default (a product's own pack), else the first one listed. */
export function defaultPicks(groups: OptionGroup[]): OptionPicks {
  const v = groups.find((g) => g.type === 'variant');
  const c = v && v.choices ? (v.choices.find((x) => x.isDefault) || v.choices[0]) : null;
  return v && c ? { [v.name]: c.label } : {};
}

/** The lowest weight / size price ("from ₹..."), or null when the product has no weight / size group. */
export function fromPrice(groups: OptionGroup[]): number | null {
  const v = groups.find((g) => g.type === 'variant');
  return v && v.choices && v.choices.length ? Math.min(...v.choices.map((c) => c.price)) : null;
}

/** The chosen weight / size (its own price and MRP), or null. */
export function chosenVariant(groups: OptionGroup[], picks: OptionPicks): OptionChoice | null {
  const v = groups.find((g) => g.type === 'variant');
  if (!v) return null;
  return (v.choices || []).find((c) => c.label === picks[v.name]) || null;
}

/** Unit price for these picks: chosen weight's price (else the product price) + chosen extras. */
export function optionsUnitPrice(basePrice: number, groups: OptionGroup[], picks: OptionPicks): number {
  let base = Number(basePrice) || 0;
  let extra = 0;
  for (const g of groups) {
    const v = picks[g.name];
    if (g.type === 'text' || v === undefined) continue;
    const labels = Array.isArray(v) ? v : [v];
    const chosen = (g.choices || []).filter((c) => labels.includes(c.label));
    if (g.type === 'variant' && chosen[0]) base = chosen[0].price;
    else extra += chosen.reduce((s, c) => s + c.price, 0);
  }
  return Math.round((base + extra) * 100) / 100;
}

/** The first missing required choice, as a message, or null when the picks are complete. */
export function missingChoice(groups: OptionGroup[], picks: OptionPicks): string | null {
  for (const g of groups) {
    if (!g.required && g.type !== 'variant') continue;
    const v = picks[g.name];
    const empty = v === undefined || (Array.isArray(v) ? v.length === 0 : String(v).trim() === '');
    if (empty) return g.type === 'text' ? `Fill in ${g.name}` : `Choose ${g.name}`;
  }
  return null;
}

/** Picks cleaned for the basket / server (empty groups dropped, text trimmed), in the admin's group order. */
export function cleanPicks(groups: OptionGroup[], picks: OptionPicks): OptionPicks {
  const out: OptionPicks = {};
  for (const g of groups) {
    const v = picks[g.name];
    if (v === undefined) continue;
    if (Array.isArray(v)) { if (v.length) out[g.name] = v; continue; }
    const t = String(v).trim();
    if (t) out[g.name] = t;
  }
  return out;
}

const rupee = (n: number) => `₹${Number.isInteger(n) ? n : n.toFixed(2)}`;

/** The choice groups drawn inline. `accent` colours the selection (green in Groceries, red elsewhere). */
export function OptionsPicker({ groups, picks, onChange, accent = '#EF4F5F' }: {
  groups: OptionGroup[]; picks: OptionPicks; onChange: (p: OptionPicks) => void; accent?: string;
}) {
  const { colors } = useTheme();
  const set = (name: string, v: string | string[] | undefined) => {
    const next = { ...picks };
    if (v === undefined) delete next[name]; else next[name] = v;
    onChange(next);
  };
  return (
    <View style={{ gap: 18 }}>
      {groups.map((g) => {
        const hint = g.type === 'variant' ? 'Choose 1'
          : g.type === 'single' ? (g.required ? 'Choose 1' : 'Optional')
            : g.type === 'multi' ? (g.max ? `Up to ${g.max}` : 'Choose any')
              : (g.required ? 'Required' : 'Optional');
        return (
          <View key={g.name}>
            <View style={st.groupHead}>
              <Text style={[st.groupName, { color: colors.text }]}>{g.name}</Text>
              <Text style={[st.groupHint, { color: colors.textMuted }]}>{hint}</Text>
            </View>
            {g.type === 'text' ? (
              <TextInput
                value={typeof picks[g.name] === 'string' ? (picks[g.name] as string) : ''}
                onChangeText={(t) => set(g.name, t.slice(0, g.maxLength || 40))}
                placeholder={`Type ${g.name.toLowerCase()}`}
                placeholderTextColor={colors.textMuted}
                maxLength={g.maxLength || 40}
                style={[st.input, { color: colors.text, backgroundColor: colors.inputBg, borderColor: colors.inputBorder }]}
              />
            ) : g.type === 'variant' ? (
              <View style={st.variantRow}>
                {(g.choices || []).map((c) => {
                  const on = picks[g.name] === c.label;
                  return (
                    <Pressable
                      key={c.label}
                      onPress={() => set(g.name, c.label)}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: on }}
                      style={[st.variant, { borderColor: on ? accent : colors.border, backgroundColor: on ? `${accent}14` : colors.card }]}
                    >
                      <Text style={[st.variantLabel, { color: on ? accent : colors.text }]} numberOfLines={1}>{c.label}</Text>
                      <Text style={[st.variantPrice, { color: on ? accent : colors.text }]}>{rupee(c.price)}</Text>
                      {/* That weight's MRP struck through, with its % off (owner, 29 Oct 2026). */}
                      {!!c.mrp && c.mrp > c.price && (
                        <View style={st.mrpRow}>
                          <Text style={[st.mrp, { color: colors.textMuted }]}>{rupee(c.mrp)}</Text>
                          <Text style={st.off}>{Math.round((1 - c.price / c.mrp) * 100)}% off</Text>
                        </View>
                      )}
                    </Pressable>
                  );
                })}
              </View>
            ) : (
              <View style={[st.list, { borderColor: colors.border, backgroundColor: colors.card }]}>
                {(g.choices || []).map((c, i) => {
                  const cur = picks[g.name];
                  const on = Array.isArray(cur) ? cur.includes(c.label) : cur === c.label;
                  const press = () => {
                    if (g.type === 'single') set(g.name, on && !g.required ? undefined : c.label);
                    else {
                      const list = Array.isArray(cur) ? cur : [];
                      if (on) set(g.name, list.filter((x) => x !== c.label));
                      else if (!g.max || list.length < g.max) set(g.name, [...list, c.label]);
                    }
                  };
                  return (
                    <Pressable
                      key={c.label}
                      onPress={press}
                      accessibilityRole={g.type === 'single' ? 'radio' : 'checkbox'}
                      accessibilityState={g.type === 'single' ? { selected: on } : { checked: on }}
                      style={[st.row, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }]}
                    >
                      <Text style={[st.rowLabel, { color: colors.text }]} numberOfLines={2}>{c.label}</Text>
                      <Text style={[st.rowPrice, { color: colors.textSecondary }]}>{c.price > 0 ? `+ ${rupee(c.price)}` : 'Free'}</Text>
                      <Ionicons
                        name={g.type === 'single' ? (on ? 'radio-button-on' : 'radio-button-off') : (on ? 'checkbox' : 'square-outline')}
                        size={20}
                        color={on ? accent : colors.textMuted}
                      />
                    </Pressable>
                  );
                })}
              </View>
            )}
          </View>
        );
      })}
    </View>
  );
}

// ── The "choose before adding" sheet ─────────────────────────────────────────────────────────
type AskInput = { name: string; price: number; image?: string | null; groups: OptionGroup[]; accent?: string; cta?: string };
export type AskResult = { customizations: OptionPicks; unitPrice: number };
type Ask = (p: AskInput) => Promise<AskResult | null>;
const AskCtx = createContext<Ask | null>(null);

/** Asks for a product's choices; resolves null when the customer closes the sheet. */
export function useAskOptions(): Ask {
  const ask = useContext(AskCtx);
  return ask || (async () => null);
}

export function OptionsSheetProvider({ children }: { children: React.ReactNode }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [req, setReq] = useState<AskInput | null>(null);
  const [picks, setPicks] = useState<OptionPicks>({});
  const resolver = useRef<((r: AskResult | null) => void) | null>(null);

  const ask = useCallback<Ask>((p) => new Promise((resolve) => {
    if (resolver.current) resolver.current(null);
    resolver.current = resolve;
    setPicks(defaultPicks(p.groups));
    setReq(p);
  }), []);
  const close = (r: AskResult | null) => {
    const done = resolver.current;
    resolver.current = null;
    setReq(null);
    done?.(r);
  };

  const accent = req?.accent || colors.red;
  const unit = req ? optionsUnitPrice(req.price, req.groups, picks) : 0;
  const missing = req ? missingChoice(req.groups, picks) : null;
  const value = useMemo(() => ask, [ask]);

  return (
    <AskCtx.Provider value={value}>
      {children}
      <Modal visible={!!req} transparent animationType="slide" onRequestClose={() => close(null)} statusBarTranslucent>
        <Pressable style={st.backdrop} onPress={() => close(null)} accessibilityLabel="Close" />
        {req ? (
          <View style={[st.sheet, { backgroundColor: colors.bg, paddingBottom: Math.max(insets.bottom, 12) }]}>
            <View style={[st.handle, { backgroundColor: colors.border }]} />
            <View style={st.head}>
              {req.image ? <SafeImage source={{ uri: req.image }} style={st.thumb} /> : null}
              <View style={{ flex: 1 }}>
                <Text style={[st.title, { color: colors.text }]} numberOfLines={2}>{req.name}</Text>
                <Text style={[st.sub, { color: colors.textMuted }]}>Choose what you want</Text>
              </View>
              <Pressable onPress={() => close(null)} hitSlop={10} accessibilityLabel="Close">
                <Ionicons name="close" size={22} color={colors.textSecondary} />
              </Pressable>
            </View>
            <ScrollView style={{ maxHeight: 460 }} contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: 16 }} keyboardShouldPersistTaps="handled">
              <OptionsPicker groups={req.groups} picks={picks} onChange={setPicks} accent={accent} />
            </ScrollView>
            <View style={[st.foot, { borderTopColor: colors.border }]}>
              <Pressable
                disabled={!!missing}
                onPress={() => close({ customizations: cleanPicks(req.groups, picks), unitPrice: unit })}
                style={[st.cta, { backgroundColor: missing ? colors.border : accent }]}
                accessibilityRole="button"
              >
                <Text style={st.ctaText}>{missing || `${req.cta || 'Add to basket'} · ${rupee(unit)}`}</Text>
              </Pressable>
            </View>
          </View>
        ) : null}
      </Modal>
    </AskCtx.Provider>
  );
}

const st = StyleSheet.create({
  groupHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10 },
  groupName: { fontSize: 15, fontWeight: '800' },
  groupHint: { fontSize: 12, fontWeight: '600' },
  variantRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  variant: { minWidth: 92, paddingVertical: 10, paddingHorizontal: 14, borderRadius: 14, borderWidth: 1.5, alignItems: 'center' },
  variantLabel: { fontSize: 14, fontWeight: '800' },
  variantPrice: { fontSize: 14, fontWeight: '800', marginTop: 2 },
  mrpRow: { flexDirection: 'row', alignItems: 'baseline', gap: 5, marginTop: 2 },
  mrp: { fontSize: 11.5, fontWeight: '500', textDecorationLine: 'line-through' },
  off: { fontSize: 11.5, fontWeight: '700', color: '#16A34A' },
  list: { borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 13, paddingHorizontal: 14 },
  rowLabel: { flex: 1, fontSize: 14, fontWeight: '600' },
  rowPrice: { fontSize: 13, fontWeight: '700' },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 11, fontSize: 14 },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 8 },
  handle: { width: 42, height: 5, borderRadius: 3, alignSelf: 'center', marginBottom: 10 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 18, paddingBottom: 14 },
  thumb: { width: 52, height: 52, borderRadius: 12 },
  title: { fontSize: 16, fontWeight: '800' },
  sub: { fontSize: 12, fontWeight: '600', marginTop: 2 },
  foot: { paddingHorizontal: 18, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth },
  cta: { borderRadius: 14, paddingVertical: 15, alignItems: 'center' },
  ctaText: { color: '#fff', fontSize: 15, fontWeight: '800' },
});
