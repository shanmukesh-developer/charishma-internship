import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { Sparkles, Copy } from '../../../../components/lucide';
import { FriendsColors, FS, FT, FR } from '../friendsTheme';

/** Daily Spark: the same conversation prompt for both people of a match, new every day (IST). */
export const SparkCard: React.FC<{ spark: { date: string; prompt: string } | null; compact?: boolean }> = ({ spark, compact }) => {
  if (!spark || !spark.prompt) return null;
  const copy = () => {
    Clipboard.setString(spark.prompt);
    Haptics.selectionAsync().catch(() => {});
  };
  if (compact) {
    return (
      <View style={styles.compact}>
        <Sparkles size={12} color={FriendsColors.gold} />
        <Text style={[FT.small, { flex: 1, color: '#D9D4E4' }]} numberOfLines={1}>
          {spark.prompt}
        </Text>
      </View>
    );
  }
  return (
    <LinearGradient colors={['rgba(232,196,127,0.08)', 'rgba(232,196,127,0.08)']} style={styles.card}>
      <View style={styles.head}>
        <Sparkles size={16} color={FriendsColors.gold} />
        <Text style={[FT.kicker, { color: FriendsColors.gold, flex: 1 }]}>Today's Spark</Text>
        <TouchableOpacity onPress={copy} style={styles.copy} accessibilityRole="button" accessibilityLabel="Copy the Spark prompt to use as an opener">
          <Copy size={14} color={FriendsColors.muted} />
          <Text style={FT.small}>Copy</Text>
        </TouchableOpacity>
      </View>
      <Text style={styles.prompt} accessibilityLabel={`Today's Spark: ${spark.prompt}`}>
        {spark.prompt}
      </Text>
      <Text style={FT.small}>You both see the same prompt today. Use it to break the ice.</Text>
    </LinearGradient>
  );
};

const styles = StyleSheet.create({
  card: { borderRadius: FR.card, padding: FS.lg, gap: FS.sm, borderWidth: 1, borderColor: 'rgba(232,196,127,0.25)' },
  head: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  copy: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 32, paddingHorizontal: 8 },
  prompt: { fontSize: 18, lineHeight: 25, fontWeight: '700', color: FriendsColors.ink },
  compact: { flexDirection: 'row', alignItems: 'center', gap: 5 },
});
