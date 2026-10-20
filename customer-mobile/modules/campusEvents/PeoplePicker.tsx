/**
 * Student picker over the existing Campus people search (GET /api/campus/search?type=people): verified
 * students of the same campus only, blocked users excluded, no phone numbers. Used for team invitations
 * and organizer check-in staff grants. The server re-checks eligibility on every invite / grant.
 */
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Modal, TextInput, FlatList, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import SafeImage from '../../components/SafeImage';
import { KeyboardAvoidingView } from '../../components/KeyboardAvoidingView';
import { campusEventsApi, type PersonResult } from './campusEventsApi';
import { usePalette, Btn } from './ui';

export default function PeoplePicker({ visible, title, actionLabel, onClose, onPick, busyId, disabledIds = [] }: {
  visible: boolean; title: string; actionLabel: string; onClose: () => void; onPick: (p: PersonResult) => void; busyId?: string | null; disabledIds?: string[];
}) {
  const p = usePalette();
  const [q, setQ] = useState('');
  const [list, setList] = useState<PersonResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);

  useEffect(() => { if (!visible) { setQ(''); setList(null); setError(null); } }, [visible]);
  useEffect(() => {
    const text = q.trim();
    if (text.length < 2) { setList(null); setError(null); return; }
    const my = ++seq.current;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const r = await campusEventsApi.searchPeople(text);
        if (my === seq.current) { setList(r.people || []); setError(null); }
      } catch (e: any) {
        if (my === seq.current) setError(e?.message || 'Search failed.');
      } finally {
        if (my === seq.current) setLoading(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' }}>
          <View style={{ height: '85%', backgroundColor: p.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 16 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
              <Text style={{ flex: 1, fontSize: 18, fontWeight: '900', color: p.text }} accessibilityRole="header">{title}</Text>
              <TouchableOpacity onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
                <Ionicons name="close" size={24} color={p.sub} />
              </TouchableOpacity>
            </View>
            <TextInput value={q} onChangeText={setQ} autoFocus placeholder="Search classmates by name" placeholderTextColor={p.muted} accessibilityLabel="Search classmates by name"
              style={{ minHeight: 48, borderRadius: 14, borderWidth: 1, borderColor: p.inputBorder, backgroundColor: p.input, color: p.text, paddingHorizontal: 14, fontSize: 15 }} maxLength={40} />
            <Text style={{ fontSize: 12, color: p.muted, marginTop: 6, marginBottom: 8 }}>Only verified students of your campus appear. They must accept before they join.</Text>
            {loading && !list ? <ActivityIndicator color={p.accent} style={{ marginTop: 20 }} /> : null}
            {error ? <Text style={{ color: p.danger, marginTop: 10 }}><Ionicons name="warning-outline" size={13} color={p.danger} /> {error}</Text> : null}
            <FlatList
              data={list || []}
              keyExtractor={(x) => x.userId}
              keyboardShouldPersistTaps="handled"
              ListEmptyComponent={list && !loading ? <Text style={{ color: p.sub, textAlign: 'center', marginTop: 24 }}>No verified classmates match “{q.trim()}”.</Text> : q.trim().length < 2 ? <Text style={{ color: p.sub, textAlign: 'center', marginTop: 24 }}>Type at least 2 letters.</Text> : null}
              renderItem={({ item }) => {
                const off = disabledIds.includes(item.userId);
                return (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: p.border }}>
                    <View style={{ width: 42, height: 42, borderRadius: 21, overflow: 'hidden', backgroundColor: p.card2, alignItems: 'center', justifyContent: 'center' }}>
                      {item.avatarUrl ? <SafeImage source={{ uri: item.avatarUrl }} style={{ width: 42, height: 42 }} fallback={<Text style={{ fontWeight: '900', color: p.sub }}>{item.name.slice(0, 1)}</Text>} /> : <Text style={{ fontWeight: '900', color: p.sub }}>{item.name.slice(0, 1)}</Text>}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 14, fontWeight: '800', color: p.text }} numberOfLines={1}>{item.name} <Ionicons name="checkmark-circle" size={13} color={p.accent} /></Text>
                      <Text style={{ fontSize: 12, color: p.sub }}>{[item.branch, item.year ? `Year ${item.year}` : null].filter(Boolean).join(' · ') || 'Verified student'}</Text>
                    </View>
                    <Btn label={off ? 'Added' : actionLabel} small kind={off ? 'secondary' : 'primary'} disabled={off} loading={busyId === item.userId} onPress={() => onPick(item)} />
                  </View>
                );
              }}
            />
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
