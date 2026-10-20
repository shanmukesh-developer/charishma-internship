import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  ScrollView,
  TextInput,
  ActivityIndicator,
  RefreshControl,
  Alert,
} from 'react-native';
import { KeyboardAvoidingView } from '../../../components/KeyboardAvoidingView';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  X,
  Plus,
  Car,
  Bike,
  Navigation,
  Clock,
  Users,
  IndianRupee,
  Check,
  ChevronRight,
  Sparkles,
} from '../../../components/lucide';
import * as Haptics from 'expo-haptics';
import { CampusColors, CampusLayout } from '../../../constants/campusTheme';
import {
  CampusRidePool,
  fetchRidePools,
  createRidePool,
  joinRidePool,
  leaveRidePool,
} from '../campusApi';
import { CampusUserData } from '../../../types/campus';

interface RidePoolModalProps {
  visible: boolean;
  onClose: () => void;
  currentUser: CampusUserData | null;
  /** Opens college verification (the board is for verified students of this campus only). */
  onRequestVerify?: () => void;
}

export const RidePoolModal: React.FC<RidePoolModalProps> = ({
  visible,
  onClose,
  currentUser,
  onRequestVerify,
}) => {
  const [rides, setRides] = useState<CampusRidePool[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filterType, setFilterType] = useState<'All' | 'Car' | 'Auto' | 'Bike'>('All');

  // Create form modal state
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [origin, setOrigin] = useState('Campus Main Gate');
  const [destination, setDestination] = useState('');
  const [departInMins, setDepartInMins] = useState(30);
  const [loadError, setLoadError] = useState<string | null>(null);
  // 403 VERIFICATION_REQUIRED: verified students of the same campus only
  const [needsVerify, setNeedsVerify] = useState(false);
  const verifyGate = (e: any) => {
    if (e?.code !== 'VERIFICATION_REQUIRED') return false;
    setNeedsVerify(true);
    Alert.alert('Verify your college', 'This is only for verified students of your campus.', [
      { text: 'Not now', style: 'cancel' },
      ...(onRequestVerify ? [{ text: 'Verify now', onPress: onRequestVerify }] : []),
    ]);
    return true;
  };
  const [totalSeats, setTotalSeats] = useState('3');
  const [farePerSeat, setFarePerSeat] = useState('80');
  const [vehicleType, setVehicleType] = useState<'Car' | 'Auto' | 'Bike'>('Car');
  const [submitting, setSubmitting] = useState(false);
  const joinPendingRef = useRef<Set<string>>(new Set());

  const loadData = async () => {
    try {
      setLoading(true);
      setLoadError(null);
      setNeedsVerify(false);
      const data = await fetchRidePools();
      setRides(data);
    } catch (e: any) {
      if (e?.code === 'VERIFICATION_REQUIRED') setNeedsVerify(true);
      setLoadError(
        typeof e?.message === 'string' && e.message && !/^Failed/i.test(e.message)
          ? e.message
          : "Couldn't load rides. Check your connection and try again."
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    if (visible) {
      loadData();
    }
  }, [visible]);

  const handleCreate = async () => {
    if (submitting) return;
    if (!destination.trim()) {
      Alert.alert('Destination Required', 'Please enter where you are heading.');
      return;
    }
    const seats = parseInt(totalSeats, 10);
    if (!Number.isFinite(seats) || seats < 2 || seats > 8) {
      Alert.alert('Check seats', 'Total seats should be between 2 and 8 (including you).');
      return;
    }
    const fare = farePerSeat.trim() === '' ? 0 : parseInt(farePerSeat, 10);
    if (!Number.isFinite(fare) || fare < 0 || fare > 5000) {
      Alert.alert('Check fare', 'Enter a fare per seat in rupees (0 for a free ride).');
      return;
    }
    try {
      setSubmitting(true);
      const departureIso = new Date(Date.now() + departInMins * 60 * 1000).toISOString();
      const created = await createRidePool({
        origin: origin.trim() || 'Campus Main Gate',
        destination: destination.trim(),
        departureTime: departureIso,
        totalSeats: seats,
        farePerSeat: fare,
        vehicleType,
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setRides((prev) => [created, ...prev]);
      setCreateModalVisible(false);
      setDestination('');
    } catch (e: any) {
      if (verifyGate(e)) return;
      Alert.alert('Post Failed', e?.message || 'Could not post ride pool');
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleJoin = async (ride: CampusRidePool) => {
    // One tap = one request (a fast double tap would join and then immediately leave).
    if (joinPendingRef.current.has(ride.id)) return;
    joinPendingRef.current.add(ride.id);
    const isJoined = (ride.passengers || []).some((p) => p.id === currentUser?.id);
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      if (isJoined) {
        const updated = await leaveRidePool(ride.id);
        setRides((prev) => prev.map((r) => (r.id === ride.id ? updated : r)));
        Alert.alert('Seat Cancelled', 'You have left this ride pool.');
      } else {
        if (ride.availableSeats <= 0) {
          Alert.alert('Ride Full', 'Sorry, all seats are booked for this ride.');
          return;
        }
        const updated = await joinRidePool(ride.id);
        setRides((prev) => prev.map((r) => (r.id === ride.id ? updated : r)));
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        Alert.alert('Seat Booked!', `Your seat is confirmed with ${ride.creatorName}. Coordinate via campus chat.`);
      }
    } catch (e: any) {
      if (verifyGate(e)) return;
      Alert.alert("Couldn't update your seat", e?.message || 'Please try again in a moment.');
    } finally {
      joinPendingRef.current.delete(ride.id);
    }
  };

  const filteredRides = rides.filter((r) => {
    if (filterType !== 'All' && r.vehicleType !== filterType) return false;
    return true;
  });

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <KeyboardAvoidingView style={{ flex: 1 }}>
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
            <X size={22} color={CampusColors.ink} />
          </TouchableOpacity>
          <View style={styles.headerTitleWrap}>
            <Text style={styles.headerTitle}>Campus Ride Pool</Text>
            <Text style={styles.headerSubtitle}>Split cabs, autos & bike rides</Text>
          </View>
          <TouchableOpacity
            style={styles.postBtn}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setCreateModalVisible(true);
            }}
          >
            <Plus size={16} color="#FFFFFF" strokeWidth={2.5} />
            <Text style={styles.postBtnText}>Offer Ride</Text>
          </TouchableOpacity>
        </View>

        {/* Filter Row */}
        <View style={styles.filterRow}>
          {(['All', 'Car', 'Auto', 'Bike'] as const).map((vt) => {
            const active = filterType === vt;
            return (
              <TouchableOpacity
                key={vt}
                style={[styles.filterChip, active && styles.filterChipActive]}
                onPress={() => {
                  Haptics.selectionAsync();
                  setFilterType(vt);
                }}
              >
                <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>
                  {vt === 'All' ? 'All Rides' : vt === 'Car' ? '🚗 Cab/Car' : vt === 'Auto' ? '🛺 Auto' : '🏍️ Bike'}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Rides List */}
        {loading && !refreshing ? (
          <View style={styles.centerContainer}>
            <ActivityIndicator size="large" color={CampusColors.accent} />
          </View>
        ) : needsVerify ? (
          <View style={[styles.centerContainer, { paddingHorizontal: 32 }]}>
            <Text style={styles.emptyTitle}>Verify your college to use this</Text>
            <Text style={[styles.emptySubtitle, { textAlign: 'center', marginVertical: 8 }]}>Ride pooling is only for verified students of your campus.</Text>
            {onRequestVerify ? (
              <TouchableOpacity style={[styles.submitBtn, { paddingHorizontal: 28 }]} onPress={onRequestVerify} accessibilityRole="button">
                <Text style={styles.submitBtnText}>Verify my college</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ) : loadError && rides.length === 0 ? (
          <View style={styles.centerContainer}>
            <Text style={styles.emptyTitle}>Rides didn't load</Text>
            <Text style={[styles.emptySubtitle, { textAlign: 'center', marginVertical: 8 }]}>{loadError}</Text>
            <TouchableOpacity style={styles.submitBtn} onPress={loadData}>
              <Text style={styles.submitBtnText}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <ScrollView
            style={styles.listScroll}
            contentContainerStyle={styles.listContent}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={() => {
                  setRefreshing(true);
                  loadData();
                }}
                tintColor={CampusColors.accent}
              />
            }
          >
            {filteredRides.length === 0 ? (
              <View style={styles.emptyState}>
                <Sparkles size={36} color={CampusColors.muted} />
                <Text style={styles.emptyTitle}>No active rides right now</Text>
                <Text style={styles.emptySubtitle}>
                  Heading to railway station, airport, or mall? Tap 'Offer Ride' to share costs!
                </Text>
              </View>
            ) : (
              filteredRides.map((ride) => {
                const isJoined = (ride.passengers || []).some((p) => p.id === currentUser?.id);
                const isCreator = currentUser?.id === ride.creatorId;

                return (
                  <View key={ride.id} style={styles.card}>
                    {/* Top Row: Vehicle & Fare */}
                    <View style={styles.cardTop}>
                      <View style={styles.vehicleBadge}>
                        {ride.vehicleType === 'Car' ? (
                          <Car size={14} color={CampusColors.accentDeep} />
                        ) : ride.vehicleType === 'Bike' ? (
                          <Bike size={14} color={CampusColors.warmDeep} />
                        ) : (
                          <Navigation size={14} color="#059669" />
                        )}
                        <Text style={styles.vehicleText}>{ride.vehicleType}</Text>
                      </View>

                      <View style={styles.fareBadge}>
                        <IndianRupee size={12} color={CampusColors.accent} />
                        <Text style={styles.fareText}>{ride.farePerSeat > 0 ? `₹${ride.farePerSeat} / seat` : "Free ride"}</Text>
                      </View>
                    </View>

                    {/* Route */}
                    <View style={styles.routeWrap}>
                      <View style={styles.routeRow}>
                        <View style={[styles.dot, { backgroundColor: CampusColors.muted }]} />
                        <Text style={styles.originText}>{ride.origin || 'Campus Main Gate'}</Text>
                      </View>
                      <View style={styles.routeLine} />
                      <View style={styles.routeRow}>
                        <View style={[styles.dot, { backgroundColor: CampusColors.accent }]} />
                        <Text style={styles.destinationText}>{ride.destination}</Text>
                      </View>
                    </View>

                    {/* Meta Row: Departure, Seats */}
                    <View style={styles.metaRow}>
                      <View style={styles.metaCol}>
                        <Clock size={13} color={CampusColors.muted} />
                        <Text style={styles.metaText}>
                          {ride.departureTime ? new Date(ride.departureTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Soon'}
                        </Text>
                      </View>
                      <View style={styles.metaCol}>
                        <Users size={13} color={CampusColors.muted} />
                        <Text style={[styles.metaText, ride.availableSeats === 0 && { color: CampusColors.rose }]}>
                          {ride.availableSeats > 0 ? `${ride.availableSeats} of ${ride.totalSeats} seats open` : 'Full'}
                        </Text>
                      </View>
                    </View>

                    {/* Footer */}
                    <View style={styles.cardFooter}>
                      <Text style={styles.creatorText}>
                        Offered by <Text style={{ fontWeight: '700' }}>{ride.creatorName || 'Student'}</Text>
                      </Text>

                      {!isCreator && (
                        <TouchableOpacity
                          style={[
                            styles.joinBtn,
                            isJoined && styles.joinedBtn,
                            ride.availableSeats === 0 && !isJoined && styles.disabledBtn,
                          ]}
                          onPress={() => handleToggleJoin(ride)}
                          disabled={ride.availableSeats === 0 && !isJoined}
                        >
                          {isJoined ? (
                            <>
                              <Check size={13} color="#FFFFFF" strokeWidth={2.5} />
                              <Text style={styles.joinBtnText}>Joined</Text>
                            </>
                          ) : (
                            <Text style={styles.joinBtnText}>
                              {ride.availableSeats === 0 ? 'Full' : 'Join Ride'}
                            </Text>
                          )}
                        </TouchableOpacity>
                      )}
                    </View>
                  </View>
                );
              })
            )}
          </ScrollView>
        )}

        {/* Offer Ride Sub-Modal */}
        <Modal
          visible={createModalVisible}
          animationType="slide"
          transparent
          onRequestClose={() => setCreateModalVisible(false)}
        >
          <KeyboardAvoidingView style={styles.modalOverlay}>
            <View style={styles.modalSheet}>
              <View style={styles.sheetHeader}>
                <Text style={styles.sheetTitle}>Offer Campus Ride</Text>
                <TouchableOpacity onPress={() => setCreateModalVisible(false)}>
                  <X size={20} color={CampusColors.muted} />
                </TouchableOpacity>
              </View>

              <ScrollView showsVerticalScrollIndicator={false}>
                {/* Vehicle Selection */}
                <Text style={styles.inputLabel}>Vehicle Type</Text>
                <View style={styles.vehicleSelector}>
                  {(['Car', 'Auto', 'Bike'] as const).map((v) => (
                    <TouchableOpacity
                      key={v}
                      style={[styles.vehBtn, vehicleType === v && styles.vehBtnActive]}
                      onPress={() => setVehicleType(v)}
                    >
                      <Text style={[styles.vehBtnText, vehicleType === v && styles.vehBtnTextActive]}>
                        {v === 'Car' ? '🚗 Car / Cab' : v === 'Auto' ? '🛺 Auto' : '🏍️ Bike'}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <Text style={styles.inputLabel}>Pickup Location</Text>
                <TextInput
                  style={styles.inputField}
                  placeholder="e.g. Campus Main Gate, Hostel Block B"
                  placeholderTextColor={CampusColors.muted}
                  value={origin}
                  onChangeText={setOrigin}
                />

                <Text style={styles.inputLabel}>Destination *</Text>
                <TextInput
                  style={styles.inputField}
                  placeholder="e.g. Vijayawada Railway Station, Gannavaram Airport"
                  placeholderTextColor={CampusColors.muted}
                  value={destination}
                  onChangeText={setDestination}
                />

                <Text style={styles.inputLabel}>Leaving</Text>
                <View style={[styles.vehicleSelector, { flexWrap: 'wrap' }]}>
                  {[15, 30, 60, 120, 240].map((m) => (
                    <TouchableOpacity
                      key={m}
                      style={[styles.vehBtn, departInMins === m && styles.vehBtnActive]}
                      onPress={() => setDepartInMins(m)}
                    >
                      <Text style={[styles.vehBtnText, departInMins === m && styles.vehBtnTextActive]}>
                        {m < 60 ? `In ${m} min` : `In ${m / 60} hr${m > 60 ? 's' : ''}`}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <View style={styles.formRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.inputLabel}>Total Seats (incl. you)</Text>
                    <TextInput
                      style={styles.inputField}
                      keyboardType="numeric"
                      value={totalSeats}
                      onChangeText={(t) => setTotalSeats(t.replace(/[^0-9]/g, ''))}
                      maxLength={1}
                    />
                  </View>
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <Text style={styles.inputLabel}>Fare / Seat (₹)</Text>
                    <TextInput
                      style={styles.inputField}
                      keyboardType="numeric"
                      value={farePerSeat}
                      onChangeText={(t) => setFarePerSeat(t.replace(/[^0-9]/g, ''))}
                      placeholder="0 = free"
                      placeholderTextColor={CampusColors.muted}
                    />
                  </View>
                </View>

                <TouchableOpacity
                  style={[styles.submitBtn, submitting && { opacity: 0.6 }]}
                  onPress={handleCreate}
                  disabled={submitting}
                >
                  {submitting ? (
                    <ActivityIndicator color="#FFFFFF" />
                  ) : (
                    <Text style={styles.submitBtnText}>Publish Ride</Text>
                  )}
                </TouchableOpacity>
              </ScrollView>
            </View>
          </KeyboardAvoidingView>
        </Modal>
      </View>
      </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: CampusColors.paper,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
    backgroundColor: CampusColors.card,
    borderBottomWidth: 1,
    borderBottomColor: CampusColors.line,
  },
  closeBtn: {
    padding: 6,
    marginRight: 8,
  },
  headerTitleWrap: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: CampusColors.ink,
  },
  headerSubtitle: {
    fontSize: 12,
    color: CampusColors.accent,
    fontWeight: '600',
  },
  postBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: CampusColors.accent,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: CampusLayout.radius.pill,
    gap: 4,
  },
  postBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  filterRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    marginVertical: 12,
    gap: 8,
  },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: CampusLayout.radius.pill,
    backgroundColor: CampusColors.card,
    borderWidth: 1,
    borderColor: CampusColors.chipBorder,
  },
  filterChipActive: {
    backgroundColor: CampusColors.accent,
    borderColor: CampusColors.accent,
  },
  filterChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: CampusColors.muted,
  },
  filterChipTextActive: {
    color: '#FFFFFF',
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  listScroll: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 32,
    gap: 12,
  },
  card: {
    backgroundColor: CampusColors.card,
    borderRadius: CampusLayout.radius.card,
    padding: 16,
    borderWidth: 1,
    borderColor: CampusColors.line,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  vehicleBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: CampusColors.accentSoft,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    gap: 5,
  },
  vehicleText: {
    fontSize: 12,
    fontWeight: '700',
    color: CampusColors.accentDeep,
  },
  fareBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: CampusColors.paper,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    gap: 2,
    borderWidth: 1,
    borderColor: CampusColors.line,
  },
  fareText: {
    fontSize: 12,
    fontWeight: '700',
    color: CampusColors.ink,
  },
  routeWrap: {
    marginBottom: 14,
  },
  routeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  routeLine: {
    width: 2,
    height: 14,
    backgroundColor: CampusColors.line,
    marginLeft: 4,
    marginVertical: 2,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  originText: {
    fontSize: 13,
    color: CampusColors.muted,
  },
  destinationText: {
    fontSize: 15,
    fontWeight: '700',
    color: CampusColors.ink,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    marginBottom: 12,
  },
  metaCol: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  metaText: {
    fontSize: 12,
    color: CampusColors.muted,
  },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: CampusColors.line,
  },
  creatorText: {
    fontSize: 12,
    color: CampusColors.muted,
  },
  joinBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: CampusColors.accent,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: CampusLayout.radius.pill,
    gap: 4,
  },
  joinedBtn: {
    backgroundColor: '#059669',
  },
  disabledBtn: {
    backgroundColor: CampusColors.placeholderFill,
  },
  joinBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  emptyState: {
    paddingTop: 48,
    alignItems: 'center',
    gap: 8,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: CampusColors.ink,
  },
  emptySubtitle: {
    fontSize: 13,
    color: CampusColors.muted,
    textAlign: 'center',
    maxWidth: 260,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: CampusColors.card,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 32,
    maxHeight: '88%',
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: CampusColors.line,
    marginBottom: 14,
  },
  sheetTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: CampusColors.ink,
  },
  vehicleSelector: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 14,
  },
  vehBtn: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    backgroundColor: CampusColors.paper,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: CampusColors.line,
  },
  vehBtnActive: {
    backgroundColor: CampusColors.accentSoft,
    borderColor: CampusColors.accent,
  },
  vehBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: CampusColors.muted,
  },
  vehBtnTextActive: {
    color: CampusColors.accentDeep,
    fontWeight: '700',
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: CampusColors.ink,
    marginBottom: 6,
  },
  inputField: {
    backgroundColor: CampusColors.paper,
    borderWidth: 1,
    borderColor: CampusColors.line,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: CampusColors.ink,
    marginBottom: 14,
  },
  formRow: {
    flexDirection: 'row',
  },
  submitBtn: {
    backgroundColor: CampusColors.accent,
    height: 46,
    borderRadius: CampusLayout.radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 6,
    marginBottom: 20,
  },
  submitBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});
