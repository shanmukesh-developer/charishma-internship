import React, { useState, useEffect } from 'react';
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
  Linking,
} from 'react-native';
import { KeyboardAvoidingView } from '../../../components/KeyboardAvoidingView';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import {
  X,
  Plus,
  Search,
  MapPin,
  CheckCircle,
  PhoneCall,
  Clock,
  Sparkles,
  Camera,
  ImagePlus,
  MoreHorizontal,
  MessageCircle,
} from '../../../components/lucide';
import { ActionMenu } from '../friends/shared/ActionMenu';
import * as Haptics from 'expo-haptics';
import { pickImageAsset, prepareAndUploadImage, alertUploadError, resolveMediaUrl } from '../../../utils/imageUpload';
import { CampusColors, CampusLayout } from '../../../constants/campusTheme';
import {
  CampusLostFoundItem,
  fetchLostFound,
  createLostFoundItem,
  resolveLostFoundItem,
  openCampusDm,
} from '../campusApi';
import { CampusUserData } from '../../../types/campus';
import { dial } from '../../../utils/dial';

import { themedSheet } from '../../../utils/themeNow';
interface LostFoundModalProps {
  visible: boolean;
  onClose: () => void;
  currentUser: CampusUserData | null;
  /** Short code of the student's campus (e.g. from the campus profile). */
  campusCode?: string | null;
  /** Opens college verification (the board is for verified students of this campus only). */
  onRequestVerify?: () => void;
  /** Opens an in-app chat (Campus chats) with the poster: the main way to reach them. */
  onOpenChat?: (chatId: string, name: string) => void;
}

export const LostFoundModal: React.FC<LostFoundModalProps> = ({
  visible,
  onClose,
  currentUser,
  campusCode,
  onRequestVerify,
  onOpenChat,
}) => {
  const [messagingId, setMessagingId] = useState<string | null>(null);
  // In-app chat with the poster (no phone number needed). Same rules as Campus chats.
  const messagePoster = async (item: CampusLostFoundItem) => {
    if (!onOpenChat || messagingId) return;
    setMessagingId(item.id);
    try {
      const { chatId, name } = await openCampusDm(item.userId);
      if (chatId) onOpenChat(chatId, name || item.userName || 'Chat');
    } catch (e: any) {
      Alert.alert("Couldn't open the chat", e?.message || 'Please try again in a moment.');
    } finally {
      setMessagingId(null);
    }
  };
  const [filter, setFilter] = useState<'all' | 'lost' | 'found'>('all');
  const [items, setItems] = useState<CampusLostFoundItem[]>([]);
  // C2: Report / Block on other people's posts.
  const [menuItem, setMenuItem] = useState<CampusLostFoundItem | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
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
  const [searchQuery, setSearchQuery] = useState('');

  // Create form modal state
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [itemType, setItemType] = useState<'lost' | 'found'>('lost');
  const [title, setTitle] = useState('');
  const [location, setLocation] = useState('');
  const [claimContact, setClaimContact] = useState('');
  const [description, setDescription] = useState('');
  const [itemImage, setItemImage] = useState<{ uri: string; width?: number; height?: number } | null>(null);
  // The uploaded copy of the current photo, so a retry after a failed post doesn't upload twice.
  const uploadedRef = React.useRef<{ localUri: string; url: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  const loadData = async () => {
    try {
      setLoading(true);
      setLoadError(null);
      setNeedsVerify(false);
      const data = await fetchLostFound();
      setItems(data);
    } catch (e: any) {
      if (e?.code === 'VERIFICATION_REQUIRED') setNeedsVerify(true);
      setLoadError(
        typeof e?.message === 'string' && e.message && !/^Failed/i.test(e.message)
          ? e.message
          : "Couldn't load the board. Check your connection and try again."
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

  const resetCreateForm = () => {
    setTitle('');
    setLocation('');
    setClaimContact('');
    setDescription('');
    setItemImage(null);
    setItemType('lost');
  };

  const pickItemImage = async (fromCamera: boolean) => {
    const asset = await pickImageAsset({ source: fromCamera ? 'camera' : 'library', allowsEditing: true });
    if (!asset) return;
    setItemImage({ uri: asset.uri, width: asset.width, height: asset.height });
    uploadedRef.current = null;
    Haptics.selectionAsync();
  };

  const handlePickPhoto = () => {
    Alert.alert('Item photo', 'Add a picture so others can recognise the item.', [
      { text: 'Camera', onPress: () => pickItemImage(true) },
      { text: 'Gallery', onPress: () => pickItemImage(false) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const handleCreate = async () => {
    if (submitting) return;
    if (!title.trim() || !location.trim()) {
      Alert.alert('Required fields', 'Please enter the item and where it was last seen or found.');
      return;
    }
    try {
      setSubmitting(true);
      let imageUrl: string | undefined;
      if (itemImage) {
        if (uploadedRef.current?.localUri === itemImage.uri) {
          imageUrl = uploadedRef.current.url;
        } else {
          try {
            const up = await prepareAndUploadImage(itemImage, 'lost_found');
            uploadedRef.current = { localUri: itemImage.uri, url: up.url };
            imageUrl = up.url;
          } catch (e: any) {
            alertUploadError(e, handleCreate);
            return;
          }
        }
      }
      const created = await createLostFoundItem({
        type: itemType,
        title: title.trim(),
        location: location.trim(),
        claimContact: claimContact.trim() || undefined,
        description: description.trim() || undefined,
        imageUrl,
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setItems((prev) => [created, ...prev]);
      setCreateModalVisible(false);
      resetCreateForm();
    } catch (e: any) {
      if (verifyGate(e)) return;
      Alert.alert(e?.code === 'CONTENT_BLOCKED' ? 'Please rephrase' : "Couldn't post", e?.message || 'Please try again in a moment.');
    } finally {
      setSubmitting(false);
    }
  };

  const resolvingRef = React.useRef<Set<string>>(new Set());
  const doResolve = async (item: CampusLostFoundItem) => {
    if (resolvingRef.current.has(item.id)) return;
    resolvingRef.current.add(item.id);
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const updated = await resolveLostFoundItem(item.id, 'resolved');
      setItems((prev) => prev.map((i) => (i.id === item.id ? updated : i)));
      Alert.alert('Marked as resolved', 'Glad it worked out! The post is now closed.');
    } catch (e: any) {
      if (verifyGate(e)) return;
      Alert.alert("Couldn't update the post", e?.message || 'Please try again in a moment.');
    } finally {
      resolvingRef.current.delete(item.id);
    }
  };
  // Closing a post can't be undone from the app, so confirm first.
  const handleResolve = (item: CampusLostFoundItem) => {
    Alert.alert(
      item.type === 'lost' ? 'Found it?' : 'Returned to the owner?',
      'This closes the post for everyone.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Mark resolved', onPress: () => doResolve(item) },
      ]
    );
  };

  const filteredItems = items.filter((item) => {
    if (filter !== 'all' && item.type !== filter) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return (
        item.title.toLowerCase().includes(q) ||
        item.location.toLowerCase().includes(q) ||
        (item.description && item.description.toLowerCase().includes(q))
      );
    }
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
            <Text style={styles.headerTitle}>Lost & Found Desk</Text>
            <Text style={styles.headerSubtitle}>{campusCode ? `${campusCode} Campus Recovery` : 'Campus Recovery'}</Text>
          </View>
          <TouchableOpacity
            style={styles.postBtn}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setCreateModalVisible(true);
            }}
          >
            <Plus size={16} color="#FFFFFF" strokeWidth={2.5} />
            <Text style={styles.postBtnText}>Post</Text>
          </TouchableOpacity>
        </View>

        {/* Search & Filter Chips */}
        <View style={styles.searchBarWrap}>
          <Search size={16} color={CampusColors.muted} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search items, locations (e.g. ALH, Canteen)..."
            placeholderTextColor={CampusColors.muted}
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')}>
              <X size={16} color={CampusColors.muted} />
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.filterRow}>
          {(['all', 'lost', 'found'] as const).map((tab) => {
            const active = filter === tab;
            return (
              <TouchableOpacity
                key={tab}
                style={[styles.filterChip, active && styles.filterChipActive]}
                onPress={() => {
                  Haptics.selectionAsync();
                  setFilter(tab);
                }}
              >
                <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>
                  {tab === 'all' ? 'All Items' : tab === 'lost' ? '🔍 Lost Items' : '📦 Found Items'}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Items List */}
        {loading && !refreshing ? (
          <View style={styles.centerContainer}>
            <ActivityIndicator size="large" color={CampusColors.accent} />
          </View>
        ) : needsVerify ? (
          <View style={[styles.centerContainer, { paddingHorizontal: 32 }]}>
            <Text style={styles.emptyTitle}>Verify your college to use this</Text>
            <Text style={[styles.emptySubtitle, { textAlign: 'center', marginVertical: 8 }]}>Lost & Found is only for verified students of your campus.</Text>
            {onRequestVerify ? (
              <TouchableOpacity style={[styles.submitBtn, { paddingHorizontal: 28 }]} onPress={onRequestVerify} accessibilityRole="button">
                <Text style={styles.submitBtnText}>Verify my college</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ) : loadError && items.length === 0 ? (
          <View style={[styles.centerContainer, { paddingHorizontal: 32 }]}>
            <Text style={styles.emptyTitle}>The board didn't load</Text>
            <Text style={[styles.emptySubtitle, { textAlign: 'center', marginVertical: 8 }]}>{loadError}</Text>
            <TouchableOpacity style={[styles.submitBtn, { paddingHorizontal: 28 }]} onPress={loadData}>
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
            {filteredItems.length === 0 ? (
              <View style={styles.emptyState}>
                <Sparkles size={36} color={CampusColors.muted} />
                <Text style={styles.emptyTitle}>No items found</Text>
                <Text style={styles.emptySubtitle}>
                  {filter === 'lost'
                    ? 'No open lost notices right now.'
                    : filter === 'found'
                    ? 'No found items posted yet.'
                    : 'Everything is accounted for on campus!'}
                </Text>
              </View>
            ) : (
              filteredItems.map((item) => {
                const isLost = item.type === 'lost';
                const isResolved = item.status === 'resolved' || item.status === 'claimed';
                const isOwner = currentUser?.id === item.userId;

                return (
                  <View key={item.id} style={[styles.card, isResolved && styles.cardResolved]}>
                    <View style={styles.cardHeader}>
                      <View
                        style={[
                          styles.badge,
                          isLost ? styles.badgeLost : styles.badgeFound,
                        ]}
                      >
                        <Text
                          style={[
                            styles.badgeText,
                            isLost ? styles.badgeTextLost : styles.badgeTextFound,
                          ]}
                        >
                          {isLost ? 'LOST' : 'FOUND'}
                        </Text>
                      </View>

                      {isResolved && (
                        <View style={styles.resolvedBadge}>
                          <CheckCircle size={12} color="#166534" />
                          <Text style={styles.resolvedText}>RESOLVED</Text>
                        </View>
                      )}
                      {!isOwner && currentUser ? (
                        <TouchableOpacity
                          style={{ marginLeft: 'auto', padding: 4 }}
                          onPress={() => {
                            setMenuItem(item);
                            setMenuOpen(true);
                          }}
                          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                          accessibilityRole="button"
                          accessibilityLabel="Post options"
                        >
                          <MoreHorizontal size={18} color={CampusColors.muted} />
                        </TouchableOpacity>
                      ) : null}
                    </View>

                    <Text style={styles.itemTitle}>{item.title}</Text>
                    {item.imageUrl ? (
                      <TouchableOpacity
                        activeOpacity={0.9}
                        onPress={() => setPreviewImage(resolveMediaUrl(item.imageUrl))}
                      >
                        <Image
                          source={{ uri: resolveMediaUrl(item.imageUrl) || undefined }}
                          style={styles.itemPhoto}
                          contentFit="cover"
                        />
                      </TouchableOpacity>
                    ) : null}
                    {item.description ? (
                      <Text style={styles.itemDescription}>{item.description}</Text>
                    ) : null}

                    <View style={styles.metaRow}>
                      <View style={styles.metaCol}>
                        <MapPin size={13} color={CampusColors.muted} />
                        <Text style={styles.metaText}>{item.location}</Text>
                      </View>
                      <View style={styles.metaCol}>
                        <Clock size={13} color={CampusColors.muted} />
                        <Text style={styles.metaText}>
                          {item.createdAt ? new Date(item.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric' }) : 'Today'}
                        </Text>
                      </View>
                    </View>

                    <View style={styles.cardFooter}>
                      <View style={styles.ownerWrap}>
                        <Text style={styles.ownerText}>
                          Posted by <Text style={{ fontWeight: '700' }}>{item.userName || 'Student'}</Text>
                        </Text>
                      </View>

                      <View style={styles.actionRow}>
                        {!isOwner && onOpenChat ? (
                          <TouchableOpacity
                            style={styles.contactBtn}
                            onPress={() => messagePoster(item)}
                            disabled={messagingId === item.id}
                            accessibilityRole="button"
                            accessibilityLabel={`Message ${item.userName || 'the poster'} about ${item.title}`}
                          >
                            {messagingId === item.id ? (
                              <ActivityIndicator size="small" color={CampusColors.accent} />
                            ) : (
                              <MessageCircle size={13} color={CampusColors.accent} />
                            )}
                            <Text style={styles.contactBtnText}>Message</Text>
                          </TouchableOpacity>
                        ) : null}
                        {/* Contact details only when the poster chose to add them */}
                        {item.claimContact && !isOwner ? (
                          <TouchableOpacity
                            style={styles.contactBtn}
                            onPress={() => {
                              const contact = String(item.claimContact || '').trim();
                              const digits = contact.replace(/[^0-9+]/g, '');
                              const isPhone = /^\+?[0-9]{10,13}$/.test(digits);
                              const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact);
                              const buttons: any[] = [{ text: 'Close', style: 'cancel' }];
                              if (isPhone) {
                                buttons.push({ text: 'Call', onPress: () => dial(digits) });
                              } else if (isEmail) {
                                buttons.push({ text: 'Email', onPress: () => Linking.openURL(`mailto:${contact}`).catch(() => {}) });
                              }
                              Alert.alert(`Contact ${item.userName || 'the poster'}`, contact, buttons);
                            }}
                          >
                            <PhoneCall size={13} color={CampusColors.accent} />
                            <Text style={styles.contactBtnText}>Contact details</Text>
                          </TouchableOpacity>
                        ) : null}

                        {isOwner && !isResolved && (
                          <TouchableOpacity
                            style={styles.resolveBtn}
                            onPress={() => handleResolve(item)}
                          >
                            <CheckCircle size={13} color="#FFFFFF" />
                            <Text style={styles.resolveBtnText}>Mark returned</Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    </View>
                  </View>
                );
              })
            )}
          </ScrollView>
        )}

        <ActionMenu
          visible={menuOpen}
          onClose={() => setMenuOpen(false)}
          title="Board post"
          report={menuItem ? { type: 'lost_found', id: menuItem.id, label: `"${menuItem.title}" by ${menuItem.userName || 'a student'}` } : null}
          block={menuItem && menuItem.userId ? { userId: String(menuItem.userId), name: menuItem.userName || 'this student' } : null}
          onReported={() => {
            const id = menuItem?.id;
            if (id) setItems((prev) => prev.filter((x) => x.id !== id));
          }}
          onBlocked={(uid) => setItems((prev) => prev.filter((x) => String(x.userId) !== String(uid)))}
        />

        {/* Post Item Sub-Modal */}
        <Modal
          visible={createModalVisible}
          animationType="slide"
          transparent
          onRequestClose={() => setCreateModalVisible(false)}
        >
          <KeyboardAvoidingView style={styles.modalOverlay}>
            <View style={styles.modalSheet}>
              <View style={styles.sheetHeader}>
                <Text style={styles.sheetTitle}>Post Lost or Found Item</Text>
                <TouchableOpacity onPress={() => { resetCreateForm(); setCreateModalVisible(false); }}>
                  <X size={20} color={CampusColors.muted} />
                </TouchableOpacity>
              </View>

              <ScrollView showsVerticalScrollIndicator={false}>
                {/* Type toggle */}
                <View style={styles.typeToggle}>
                  <TouchableOpacity
                    style={[styles.toggleBtn, itemType === 'lost' && styles.toggleBtnActiveLost]}
                    onPress={() => setItemType('lost')}
                  >
                    <Text style={[styles.toggleBtnText, itemType === 'lost' && styles.toggleBtnTextActive]}>
                      I Lost Something
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.toggleBtn, itemType === 'found' && styles.toggleBtnActiveFound]}
                    onPress={() => setItemType('found')}
                  >
                    <Text style={[styles.toggleBtnText, itemType === 'found' && styles.toggleBtnTextActive]}>
                      I Found Something
                    </Text>
                  </TouchableOpacity>
                </View>

                <Text style={styles.inputLabel}>Item Name *</Text>
                <TextInput
                  style={styles.inputField}
                  placeholder="e.g. Casio fx-991EX Calculator, Hostel Room Key"
                  placeholderTextColor={CampusColors.muted}
                  value={title}
                  onChangeText={setTitle}
                />

                <Text style={styles.inputLabel}>Item Photo</Text>
                <Text style={styles.photoOptional}>Optional — a picture helps others recognise the item</Text>
                {itemImage ? (
                  <View style={styles.photoPreviewWrap}>
                    <Image source={{ uri: itemImage.uri }} style={styles.photoPreview} contentFit="cover" />
                    <View style={styles.photoPreviewActions}>
                      <TouchableOpacity style={styles.photoChangeBtn} onPress={handlePickPhoto}>
                        <Camera size={14} color={CampusColors.accent} />
                        <Text style={styles.photoChangeText}>Change</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.photoRemoveBtn}
                        onPress={() => setItemImage(null)}
                      >
                        <X size={14} color={CampusColors.sos} />
                        <Text style={styles.photoRemoveText}>Remove</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ) : (
                  <TouchableOpacity style={styles.photoPicker} onPress={handlePickPhoto} activeOpacity={0.85}>
                    <View style={styles.photoPickerIcon}>
                      <ImagePlus size={26} color={CampusColors.accent} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.photoPickerTitle}>Add a photo of the item</Text>
                      <Text style={styles.photoPickerHint}>Camera or gallery</Text>
                    </View>
                  </TouchableOpacity>
                )}

                <Text style={styles.inputLabel}>Location *</Text>
                <TextInput
                  style={styles.inputField}
                  placeholder="e.g. ALH-304 Desk 4, Central Library 2F"
                  placeholderTextColor={CampusColors.muted}
                  value={location}
                  onChangeText={setLocation}
                />

                <Text style={styles.inputLabel}>Contact details (optional)</Text>
                <Text style={[styles.metaText, { marginBottom: 6 }]}>Students can message you in the app. Add a phone number only if you are happy to share it.</Text>
                <TextInput
                  style={styles.inputField}
                  placeholder="e.g. collect from Ganga block, room 312"
                  placeholderTextColor={CampusColors.muted}
                  value={claimContact}
                  onChangeText={setClaimContact}
                />

                <Text style={styles.inputLabel}>Description and marks</Text>
                <TextInput
                  style={[styles.inputField, { height: 75, textAlignVertical: 'top' }]}
                  placeholder="Any scratches, stickers, covers, or marks to verify ownership..."
                  placeholderTextColor={CampusColors.muted}
                  value={description}
                  onChangeText={setDescription}
                  multiline
                />

                <TouchableOpacity
                  style={[styles.submitBtn, submitting && { opacity: 0.6 }]}
                  onPress={handleCreate}
                  disabled={submitting}
                >
                  {submitting ? (
                    <ActivityIndicator color="#FFFFFF" />
                  ) : (
                    <Text style={styles.submitBtnText}>Post Notice</Text>
                  )}
                </TouchableOpacity>
              </ScrollView>
            </View>
          </KeyboardAvoidingView>
        </Modal>

        <Modal visible={!!previewImage} transparent animationType="fade" onRequestClose={() => setPreviewImage(null)}>
          <TouchableOpacity style={styles.previewOverlay} activeOpacity={1} onPress={() => setPreviewImage(null)}>
            {previewImage ? (
              <Image source={{ uri: previewImage }} style={styles.previewFull} contentFit="contain" />
            ) : null}
            <Text style={styles.previewHint}>Tap anywhere to close</Text>
          </TouchableOpacity>
        </Modal>
      </View>
      </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
};

const styles = themedSheet(() => ({
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
  searchBarWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: CampusColors.card,
    marginHorizontal: 16,
    marginTop: 12,
    paddingHorizontal: 12,
    height: 42,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: CampusColors.line,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 13,
    color: CampusColors.ink,
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
  cardResolved: {
    opacity: 0.65,
    backgroundColor: '#FAF9F6',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  badgeLost: {
    backgroundColor: CampusColors.roseSoft,
  },
  badgeFound: {
    backgroundColor: CampusColors.accentSoft,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  badgeTextLost: {
    color: CampusColors.roseDeep,
  },
  badgeTextFound: {
    color: CampusColors.accentDeep,
  },
  resolvedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#DCFCE7',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
    gap: 4,
  },
  resolvedText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#166534',
  },
  itemTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: CampusColors.ink,
    marginBottom: 8,
  },
  itemPhoto: {
    width: '100%',
    height: 180,
    borderRadius: 12,
    backgroundColor: CampusColors.placeholderFill,
    marginBottom: 10,
  },
  itemDescription: {
    fontSize: 13,
    color: CampusColors.muted,
    lineHeight: 18,
    marginBottom: 10,
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
    gap: 4,
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
  ownerWrap: {
    flex: 1,
  },
  ownerText: {
    fontSize: 12,
    color: CampusColors.muted,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  contactBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: CampusColors.accentSoft,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: CampusLayout.radius.pill,
    gap: 4,
  },
  contactBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: CampusColors.accent,
  },
  resolveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#166534',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: CampusLayout.radius.pill,
    gap: 4,
  },
  resolveBtnText: {
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
    maxWidth: 240,
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
  typeToggle: {
    flexDirection: 'row',
    backgroundColor: CampusColors.paper,
    borderRadius: 10,
    padding: 4,
    marginBottom: 16,
  },
  toggleBtn: {
    flex: 1,
    paddingVertical: 9,
    alignItems: 'center',
    borderRadius: 8,
  },
  toggleBtnActiveLost: {
    backgroundColor: CampusColors.rose,
  },
  toggleBtnActiveFound: {
    backgroundColor: CampusColors.accent,
  },
  toggleBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: CampusColors.muted,
  },
  toggleBtnTextActive: {
    color: '#FFFFFF',
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
  photoOptional: {
    fontSize: 12,
    color: CampusColors.muted,
    marginBottom: 8,
    marginTop: -2,
  },
  photoPicker: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: CampusColors.accentSoft,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: CampusColors.accent,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 16,
    marginBottom: 14,
  },
  photoPickerIcon: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: CampusColors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoPickerTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: CampusColors.ink,
  },
  photoPickerHint: {
    fontSize: 12,
    color: CampusColors.muted,
    marginTop: 2,
  },
  photoPreviewWrap: {
    marginBottom: 14,
  },
  photoPreview: {
    width: '100%',
    height: 180,
    borderRadius: 12,
    backgroundColor: CampusColors.placeholderFill,
  },
  photoPreviewActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 8,
  },
  photoChangeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: CampusColors.accentSoft,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: CampusLayout.radius.pill,
  },
  photoChangeText: {
    fontSize: 12,
    fontWeight: '700',
    color: CampusColors.accent,
  },
  photoRemoveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: CampusColors.roseSoft,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: CampusLayout.radius.pill,
  },
  photoRemoveText: {
    fontSize: 12,
    fontWeight: '700',
    color: CampusColors.sos,
  },
  previewOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.88)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  previewFull: {
    width: '100%',
    height: '78%',
  },
  previewHint: {
    marginTop: 12,
    color: '#FFFFFF',
    fontWeight: '600',
    fontSize: 13,
  },
}));
