/**
 * Food & groceries v2: "Can't find something?" shopping list page (Mega Basket).
 * Fixed header (back stays on screen), several item lines ("Add another item"), quantity per line and an
 * optional price estimate. Lines go to the campus store basket as shopping requests (POST at checkout).
 * Others → Food & groceries (modules/foodV2).
 */
import React from 'react';
import { View, Text, ScrollView, TextInput, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Image as ExpoImage } from 'expo-image';
import { PressScale } from '../../modules/others/motion';
import { FOOD } from './foodV2Theme';
import { POPULAR_REQUESTS } from './FoodV2Data';
import { s } from './FoodV2Styles';
import { useFoodV2 } from './useFoodV2';
import { CUT } from './FoodV2Art';
import { Icon } from './FoodV2Icons';
import { BUTTON_ROLE } from '../../utils/pressRole';

export default function FoodV2MegaBasket() {
  const { isDark, topPad, pageW, c, pop, reqLines, addReqLine, updateReqLine, removeReqLine, setFirstReqName, addRequest } = useFoodV2();
  const halfW = Math.floor((pageW - 40 - 10) / 2);
  const fieldBg = isDark ? FOOD.plate.dark : '#FFFFFF';
  const filled = reqLines.filter(l => l.name.trim()).length;
  return (
    <LinearGradient colors={['#03321E', '#021A10']} style={{ flex: 1 }}>
      {/* Fixed header: the back arrow never scrolls away */}
      <View style={[st.head, { paddingTop: topPad }]}>
        <View style={s.listHead}>
          <PressScale onPress={pop} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} accessibilityRole={BUTTON_ROLE} accessibilityLabel="Back" style={s.backBtn}>
            <Icon name="arrow-back" size={22} color="#FFFFFF" />
          </PressScale>
          <Text style={s.listTitle} numberOfLines={1} accessibilityRole="header">Send a list</Text>
        </View>
      </View>
      <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 28, flexGrow: 1 }}>
        <Text style={s.megaTitle}>Can't find something?</Text>
        <Text style={s.megaSub}>Type what you need and a shopper will buy it for you.</Text>
        <View style={[s.megaCard, { backgroundColor: isDark ? FOOD.card.dark : '#F2F7F5' }]}>
          {reqLines.map((l, i) => (
            <View key={l.key} style={[st.line, i > 0 && { borderTopWidth: 1, borderTopColor: c.line, paddingTop: 10 }]}>
              <View style={st.lineTop}>
                <Text style={[st.lineNo, { color: c.slate }]}>Item {i + 1}</Text>
                {(reqLines.length > 1 || !!l.name) && (
                  <PressScale style={st.remove} onPress={() => removeReqLine(l.key)} accessibilityRole={BUTTON_ROLE} accessibilityLabel={`Remove item ${i + 1}`}>
                    <Icon name="close" size={16} color={c.slate} />
                  </PressScale>
                )}
              </View>
              <View style={[s.megaField, { backgroundColor: fieldBg }]}>
                <Icon name="search" size={19} color="#8A9BA6" />
                <TextInput style={[s.megaInput, { color: c.title }]} value={l.name} onChangeText={t => updateReqLine(l.key, { name: t })} placeholder="e.g. protein powder, study lamp…" placeholderTextColor="#8A9BA6" maxLength={60} accessibilityLabel={`Item ${i + 1}: what should we buy`} />
              </View>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[st.label, { color: c.slate }]}>Quantity</Text>
                  <TextInput style={[s.megaSmall, { flex: 0, color: c.title, backgroundColor: fieldBg }]} value={l.qty} onChangeText={t => updateReqLine(l.key, { qty: t.replace(/[^0-9]/g, '') })} placeholder="1" placeholderTextColor="#8A9BA6" keyboardType="number-pad" maxLength={2} accessibilityLabel={`Item ${i + 1}: quantity, 1 to 20`} />
                </View>
                <View style={{ flex: 2, minWidth: 0 }}>
                  <Text style={[st.label, { color: c.slate }]}>Price per unit (optional)</Text>
                  <TextInput style={[s.megaSmall, { flex: 0, color: c.title, backgroundColor: fieldBg }]} value={l.price} onChangeText={t => updateReqLine(l.key, { price: t.replace(/[^0-9.]/g, '') })} placeholder="₹ if you know it" placeholderTextColor="#8A9BA6" keyboardType="decimal-pad" maxLength={7} accessibilityLabel={`Item ${i + 1}: estimated price per unit, optional`} />
                </View>
              </View>
            </View>
          ))}
          {reqLines.length < 15 && (
            <PressScale style={[st.addLine, { borderColor: isDark ? 'rgba(127,220,163,0.4)' : '#9FD3B2' }]} onPress={addReqLine} accessibilityRole={BUTTON_ROLE} accessibilityLabel="Add another item">
              <Icon name="add" size={18} color={isDark ? '#7FDCA3' : FOOD.primary} />
              <Text style={[st.addLineText, { color: isDark ? '#7FDCA3' : FOOD.primary }]}>Add another item</Text>
            </PressScale>
          )}
          <PressScale style={[s.megaBtn, { backgroundColor: FOOD.cta }]} onPress={addRequest} accessibilityRole={BUTTON_ROLE} accessibilityLabel="Send list: add these items to your basket">
            <Text style={s.megaBtnText}>{filled > 1 ? `Send list · ${filled} items` : 'Send list'}</Text>
          </PressScale>
          <Text style={[s.megaHint, { color: c.slate }]}>Prices are optional. You approve the real bill before paying (cash on delivery).</Text>
        </View>
        <Text style={s.megaPop}>Popular requests</Text>
        <View style={s.megaGrid}>
          {POPULAR_REQUESTS.map(r => (
            <PressScale key={r} style={[s.megaChip, { width: halfW, backgroundColor: isDark ? FOOD.card.dark : '#F4F8F6' }]} onPress={() => setFirstReqName(r)} accessibilityRole={BUTTON_ROLE} accessibilityLabel={`Add ${r} to the list`}>
              <Icon name="add" size={15} color={FOOD.primary} />
              <Text style={[s.megaChipText, { color: c.title }]} numberOfLines={1}>{r}</Text>
            </PressScale>
          ))}
        </View>
        <View style={{ flex: 1, minHeight: 20 }} />
        <View style={{ alignItems: 'center', marginTop: 16 }}>
          <ExpoImage source={CUT.hero} style={{ width: Math.min(230, pageW - 100), height: Math.round(Math.min(230, pageW - 100) * 0.96) }} contentFit="contain" accessibilityElementsHidden />
          <Text style={s.megaFoot}>We'll find it. You relax.</Text>
        </View>
      </ScrollView>
    </LinearGradient>
  );
}

const st = StyleSheet.create({
  head: { backgroundColor: '#03321E' },
  line: { gap: 8 },
  lineTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 28 },
  lineNo: { fontSize: 12.5, fontWeight: '500' },
  remove: { width: 44, height: 44, marginVertical: -8, marginRight: -10, alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: 11.5, fontWeight: '400', marginBottom: 4, marginLeft: 2 },
  addLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, height: 44, borderRadius: 14, borderWidth: 1, borderStyle: 'dashed' },
  addLineText: { fontSize: 14, fontWeight: '500' },
});
