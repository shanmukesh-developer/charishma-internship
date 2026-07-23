import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Alert,
  Modal,
  Dimensions,
  Platform,
  KeyboardAvoidingView,
  TouchableWithoutFeedback,
  Keyboard,
  Animated,
  Vibration,
  SafeAreaView,
  StatusBar
} from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import * as Contacts from 'expo-contacts';
import { COLORS, SHADOWS } from '../constants/theme';
import { ENDPOINTS, API_URL } from '../constants/api';
import { apiFetch } from '../utils/auth';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { connectSocket } from '../utils/socket';
import { FloatingPulse } from '../components/AnimatedSection';
import DopaminePressable from '../components/DopaminePressable';

const { width: SW, height: SH } = Dimensions.get('window');

// Visual styling constants
const GRAPHITE_BG = '#0E1116';
const VIOLET_ACCENT = '#6E5BFF';
const EMBER_ORANGE = '#FF7A59';

const ZENVY_STICKERS = [
  '⚡', '🔥', '🏆', '🎁', '🚀', '🤫', '💖', '💀', '🎉', '🍔', '🍕', '🍦'
];

const CAMPUS_TRUTHS = [
  "Hostel warden movie villain aithe, vaallu evariki matching?",
  "Nee classmate GPA entha low ante, repati exam pass ayye chances kante thakkuva?",
  "Canteen lo free ga dorukuthundi ani thinna chetha food ento cheppu?",
  "Room lo vachina gubulu vasanani, nee roommate meedha thosesi thappinchukunnava?",
  "Exam week lo snanam cheyakunda enni rojulu unnav?",
  "Ae professor voice vinte neeku ventane nidra vasthundi?",
  "Nee crush mundhu nuvvu chesina goppa comedy panento gurthunda?",
  "Roommate sodhi chepthanu ante, act cheyataniki eppudaina padukunnattu natinchava?",
  "Curfew time tharwatha bayataki velladaniki warden ki cheppina peddha abaddham enti?",
  "Nee Netflix password evariki isthe nuvvu safe kadhu anukuntunnav?",
  "Classes ki regular ga vellina, ae subject lo neeku 'zero knowledge' undi?",
  "Oke jodu socks ni enni rojulu thodigaav?",
  "Hostel pocket money tho nuvvu konna parama chetha vasthuuvu enti?",
  "Shared fridge lo unna pakkanolla food ni eppudaina dhochi thinnava?",
  "Nuvvu classes bunk kotte companion tho date ki vellalsi vasthe, pararisthithi entha ghoranga untundi?",
  "Class lo extra homework adige aadini chusthe neeku ae range lo kopam vasthundi?",
  "Proxy sign kosam senior padhaalu eppudaina patte range lo try chesava?",
  "English assignments kosam entha mandhi Google Translate ni vaaduthunnaru?",
  "Campus Wi-Fi lo nuvvu search chesina weirdest vishayam enti?",
  "Ae friend accident ga edhoka pichi pani chesi police case varaku velthadu?",
  "Room lo kettle vaadi nuvvu chesina ghoramaina vanta enti?",
  "If you had to trade your roommate for a bag of Lays, ae flavor choose chesukuntavu?",
  "Library book return cheyakunda fine book cost kante ekkuva chesava?",
  "Nee friends circle lo evari guraka valla hostel shake avthundi?",
  "Nee parents ninnu piliche embarrassing pet name enti?",
  "Internal marks kosam professor chese chetha joke ki navvaka thappaledha?",
  "Class WhatsApp group lo nuvvu accidental ga send chesina awkward message enti?",
  "Study group munigipoye badava aithe, ninnu nuvvu kapadukovadaniki evarini thosesthavu?",
  "Class ki level up avvadaniki enni sarlu alarm snooze chesav?",
  "Roommate clothes valla permission lekunda vesukuni dirty ga return chesava?",
  "Ae canteen food tinte direct ga emergency ward ki pampinchochu?",
  "Assignment submit cheyakunda cheppina worst reason enti?",
  "Nee department lo active gossip partner evaru?",
  "Frustrate ayyi ae friend messages naina mute chesava?",
  "Study time lo Reels scroll cheyataniki enni hours waste chesav?",
  "Dean badhulu oka movie star ni dean ga pedithe, evarini pedathav?",
  "Campus lo bike riding cheyyadam rani worst rider evaru?",
  "Group study session lo emi ardham kakapoina 'ardhamaindi' ani thala oopava?",
  "Phone muttukokunda nuvvu unna maximum time entha?",
  "Nee search history screen meedha play chesthe, campus nundi entha fast ga paripothav?",
  "Back bench lo kurchuni gaming aade target class edhi?",
  "Seniors neeku cheppina absolute waste advice enti?",
  "Roommate tho velladam ishtam leka, eppudaina fake emergency drama aadav?",
  "Canteen tea kosam oka week lo spend chesina highest money entha?",
  "Hostel room thagalabadithe, pranam leni ae vasthuvuni first save chesthav?",
  "Ae exam ni pakkana unna genius paper chusi copy kotti pass ayyav?",
  "Nidra lo eppudaina hostel lo gattiga edhaina embarrassing ga arichava?",
  "Assignment fast ga rayadaniki pakkanolla peru tho paatu copy kottava?",
  "Nee gang lo overaction star evaru?",
  "Ae department ki convert avvadaniki ready ga unnav?",
  "If {friendName} movie villain aithe, first ae professor ni target chestharu?",
  "Nuvvu, {friendName} classes ni skip chesi ae canteen lo spend chestharu?",
  "{friendName} canteen lo thinna ghoramaina food item enti?",
  "{friendName} ni oka plate samosa badhulu trade chesi paneer samosa choose chesthava?",
  "GPA lo evaru topper: nuvva leka {friendName} aa?",
  "{friendName} gurinchi nuvvu vinna worst gossip enti?",
  "{friendName} hostel rule break chesthe evari meedha blame thosestharu?",
  "Warden tho fight chesthe evaru win avtharu: nuvva, {friendName} aa?",
  "{friendName} tho elevator lo irukkapothe first evaru gattiga edustharu?",
  "Ae subject gurinchi {friendName} ki absolute ga emi theliyadhu?",
  "{friendName} unna weirdest habit enti?",
  "If {friendName} hostel warden aithe, first change chese rule enti?",
  "Exam hall lo nidrapoye chance evariki ekkuva undi: neeka leka {friendName} ka?",
  "{friendName} canteen lo unna ae food ki sync avtharu?",
  "{friendName} ki nuvvu iche embarrassing nickname edinaina?",
  "If {friendName} caught you stealing {canteenFood} in the {locationName}, first em ani arusthav?",
  "Nuvvu {friendName} kalisi {locationName} lo edhaina block-list activity chesthe, evarini throw chesthav?",
  "Ae subject kante {friendName} icche free advice waste anukuntunnav: {subjectName} aa leka normal aa?",
  "If you, {friendName}, and {professorRole} were locked in {locationName}, first evaru gattiga edustharu?",
  "GPA ranking lo {friendName} kante nee {subjectName} skills better aa kadha?",
  "If the {professorRole} catches you with {itemName} in the class, direct ga {locationName} ki send chesthara?",
  "{friendName} room lo {itemName} dhochi {canteenFood} thinadam direct ga crime aa kadha?",
  "Dean/Warden room lo {friendName} with {itemName} unte, clear ga photo petti expose chesthava?",
  "Ae {subjectName} exam roju nuvvu {friendName} kante ekkuva sleep veshav?",
  "{friendName} dynamic personality character low aa leka canteen {canteenFood} low aa?"
];

const CAMPUS_DARES = [
  "Roommate ki 'Room lo unna sock ekkado cheppu' ani message petti 1 hour follow up cheyyaku.",
  "Eroju nee phone Screen Time screenshot ni ee chat ki send chey.",
  "WhatsApp status 'Hostel gossip speed calculator' ga 24 hours change chey.",
  "Crush ki 'Library stairs nundi padinapudu emaina debba thagilindha?' ani text petti screenshot pettu.",
  "Extreme confusion face selfie petti send chey.",
  "Creepy voice lo 'Warden chusthunnaru' ani voice note pettu.",
  "Senior ki '1+1 endhuku 3 kadhu?' ani text petti reaction screenshot pettu.",
  "Class WhatsApp group lo 'Exam cancel ayyindha?' ani message petti 5 seconds lo delete chey.",
  "Profile name ni 'Hostel Legend' ga change chesi 2 hours unchu.",
  "Textbook lo unna oka bore line ni voice note lo full dramatic ga read chey.",
  "Kotha number ki 'Nuvvu last semester chesindi naku thelsu' ani text petti screenshot pettu.",
  "Nee room messiest corner photo petti send chey right now.",
  "Keyboard language change chesi kotha language lo message pettu.",
  "Best friend ki 'Nenu Mars ki vellipothunna, emaina kavala?' ani message petti screenshot pettu.",
  "Alphabet song reverse lo voice note pettu fast ga.",
  "Hostel food gurinchi 3 lines bad kavitha rasi send chey.",
  "Spoon microphone ga petti selfie pettu.",
  "Roommate ki 'Room lo unna kettle key dynamic ga configure ayyi automatic ga alert isthundi' ani text pettu.",
  "WhatsApp profile pic okka potato image ga 1 hour change chey.",
  "Evil laugh note pettu for 5 seconds.",
  "Class group chat lo 'Nene design chesina champion' ani petti, reason cheppaku.",
  "Desk photo cleanup cheyakunda pettu.",
  "Senior ki 'Canteen tea lo actual ga warm water kaluputhara?' ani adigi reply screenshot pettu.",
  "Voice note lo 'Zenvy tips kosam subscribe cheyandi' ani radio jockey la cheppu.",
  "Best friend ki 'Naku plate samosa kurchovali nuvvu' ani message petti reaction pettu.",
  "WhatsApp status 'Currently under warden investigation' ga change chey.",
  "Canteen food gurinchi voice note lo Michelin star chef style lo review cheppu.",
  "Roommate ki 'Room door lock chesuko, eroju dheyyaalu active ga unnayi' ani text pettu.",
  "Room lo unna patha plastic container wrapper photo pettu.",
  "Group chat lo 'Repu ae class bunk kodudham?' ani text pettu.",
  "WhatsApp status 'Sleeping until graduation' ga 12 hours change chey.",
  "Microwave oven sound voice note pettu.",
  "Selfie indoors sunglasses to petti send chey.",
  "Crush ki 'Nuvvu library book va? Ninnu check out cheyakunda undalenu' ani message petti screenshot pettu.",
  "Kettle ki apology letter rasina photo pettu.",
  "Classmate ki 'Last week exam notes kavali' ani text petti screenshot pettu.",
  "WhatsApp status 'Motivation missing' ga 24 hours change chey.",
  "Grocery list ni voice note lo complete mass voice lo read chey.",
  "Roommate ki 'Fan chala fast ga thiruguthundi, launch ayye la undi' ani message petti screenshot pettu.",
  "Book thala meedha petti selfie send chey.",
  "Senior ki 'Seniors ki tea bill juniors ye kadathara?' ani adigi screenshot pettu.",
  "Paper meedha 'Zenvy helps my survival' ani rasi photo send chey.",
  "Hostel emergency warning voice note pettu.",
  "Friend ki 'Accidental ga bike konna' ani cheppi screenshot pettu.",
  "WhatsApp status 'Warden tracking me' ga 4 hours update chey.",
  "Text {friendName}: 'Room kettle automatic ga sound chesthundi' ani petti screenshot pettu.",
  "Text {friendName}: 'Library stairs nundi padinapudu emaina debba thagilindha?' ani adigi screenshot pettu.",
  "Text {friendName}: 'Last semester chesindi naku thelsu' ani text petti screenshot pettu.",
  "Text {friendName}: 'Naku plate samosa buy cheyali nuvvu' ani message petti screenshot pettu.",
  "Text {friendName}: 'Block {blockName} lo dheyyaalu unnayanta ga' ani petti screenshot pettu.",
  "Text {friendName}: 'Nuvvu library book va? Ninnu check out cheyakunda undalenu' ani message petti screenshot pettu.",
  "Text {friendName}: 'Phone missing, call chey naku' ani petti screenshot pettu.",
  "Text {friendName}: 'Room {roomNumber} lo fan launch avthundi' ani text petti screenshot pettu.",
  "Text {friendName}: 'Nenu bullet bandi konna' ani message petti screenshot pettu.",
  "Text {friendName}: 'Repati exam cancel ayyindha?' ani message petti screenshot pettu.",
  "Text {friendName}: 'I lost my {itemName} in {locationName}, can you search it?' and screenshot it.",
  "Text {friendName}: 'Please buy me {canteenFood} right now, naku low sugar vundi' and screenshot it.",
  "Change your WhatsApp status to 'Currently learning {subjectName} from {friendName}' for 4 hours.",
  "Text {friendName}: 'Warden has detected your {itemName} in {locationName}' and screenshot the reaction.",
  "Text {friendName}: 'I am declaring {itemName} as national hostel item' and screenshot it.",
  "Voice note {friendName}: whisper '{canteenFood} smell is coming from {locationName}' in a scary tone.",
  "Text {friendName}: 'I accidentally dropped your {itemName} in canteen {canteenFood}' and screenshot the reaction.",
  "Write 'I love {subjectName} and {friendName}' on a paper, take a photo and send it.",
  "Text {friendName}: 'Let's skip {subjectName} class and go to {locationName}' and screenshot it.",
  "Text {friendName}: 'Can you explain why {professorRole} is searching for your {itemName}?' and screenshot it."
];

const CHAT_THEMES = [
  { name: 'friendship', colors: ['#140D07', '#25170B', '#160E08'], accent: '#FF7A59' },
  { name: 'crazy', colors: ['#0F0C20', '#1C0B36', '#09151B'], accent: '#a855f7' },
  { name: 'love', colors: ['#1F080F', '#350A19', '#1C060E'], accent: '#ec4899' },
  { name: 'graphite', colors: ['#0E1116', '#171B22', '#0E1116'], accent: '#6E5BFF' }
];

const STATUS_GRADIENTS: readonly (readonly [string, string])[] = [
  ['#FF512F', '#DD2476'],
  ['#4776E6', '#8E54E9'],
  ['#00B4DB', '#0083B0'],
  ['#f12711', '#f5af19'],
  ['#8E2DE2', '#4A00E0'],
  ['#11998e', '#38ef7d'],
  ['#0E1116', '#171B22'],
];

const CANTEEN_FOODS = ['samosa', 'maggi', 'canteen tea', 'fried rice', 'dosa', 'veg puff', 'aloo bajji', 'biryani', 'watery dal', 'burnt chapati', 'cement idli', 'diluted milk', 'chemical paneer', 'half-boiled egg', 'mystery gravy', 'rubber parotta', 'yellow drinking water', 'undercooked noodles', 'smelly boiled rice', 'expired tomato ketchup', 'diluted rasam', 'sour curd', 'plastic cup tea', 'half-fried onion samosa', 'dusty peanuts', 'uncooked maggi crumbs'];
const SUBJECTS = ['Maths', 'Physics', 'Coding', 'DBMS', 'OS', 'English', 'Data Structures', 'Chemistry', 'Boring Lecture 101', 'Proxy Attendance Class', 'Copy-Paste Lab', 'Sleeping Session', 'Seniors Ragging Class', 'Exam Hall Torture', 'Viva Voce Disaster', 'Seminar Presentation Boredom', 'Assigned Project Failure', 'Assignment Copying Hour', 'Last Bench Gaming session', 'Record Book Writing marathon'];
const PROFESSOR_ROLES = ['HOD', 'lab assistant', 'dean', 'librarian', 'warden', 'maths prof', 'physics prof', 'security guard', 'canteen owner', 'exam supervisor', 'proxy checker', 'gatekeeper', 'fees collector', 'attendance monitor', 'record book signature manager', 'external examiner', 'internship coordinator', 'canteen cashier'];
const LOCATIONS = ['library', 'girls hostel', 'canteen back area', 'seminar hall', 'dean office', 'hostel terrace', 'main gate', 'exam hall bench', 'warden checking post', 'hostel washroom', 'seniors corner', 'dark alley near gate', 'class back row', 'canteen queue', 'admin cell queue', 'security check gate', 'attendance office desk', 'common room television bench', 'hostel lobby elevator', 'parking slot back'];
const ITEMS = ['kettle', 'missing sock', 'cheat sheet', 'hot sauce', 'sunglasses', 'bicycle', 'slipper', 'broken plastic mug', 'empty wallet', '2-rupee coin', 'stolen assignment book', 'mosquito bat', 'expired noodle pack', 'wifi password paper', 'fake medical certificate', 'one-side earphone', 'torn textbook', 'empty water bottle', 'crushed tea cup', 'proxy signature pen', 'dirty bedsheet', 'broken charger cable', 'stolen hanger', 'lost library card', 'used face mask'];

// Helper to resolve profile image fallbacks using premium Unsplash avatars
const getAvatarUrl = (profileImage: string | null, id: string) => {
  if (profileImage && (profileImage.startsWith('http') || profileImage.startsWith('data:'))) {
    return profileImage;
  }
  if (profileImage) {
    return `${API_URL}${profileImage.startsWith('/') ? '' : '/'}${profileImage}`;
  }
  const placeholders = [
    'https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?w=120&q=80',
    'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=120&q=80',
    'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=120&q=80',
    'https://images.unsplash.com/photo-1522075469751-3a6694fb2f61?w=120&q=80',
    'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=120&q=80'
  ];
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = id.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % placeholders.length;
  return placeholders[index];
};

// Reusable hook for orbit calculations in polar coordinates
function useOrbitLayout(
  center: { x: number; y: number },
  items: any[],
  minRadius: number,
  maxRadius: number,
  isPending: boolean = false
) {
  return React.useMemo(() => {
    if (!items || items.length === 0) return [];
    
    return items.map((item, idx) => {
      // Offset starting angle to make it look organic
      const baseAngle = -Math.PI / 2;
      const angle = baseAngle + (idx * 2 * Math.PI) / items.length;
      
      let radius = maxRadius;
      if (!isPending) {
        // Higher streaks = closer to center (smaller radius)
        const streak = item.streakCount || 0;
        const streakWeight = Math.min(streak / 20, 1);
        radius = maxRadius - (maxRadius - minRadius) * streakWeight;
      } else {
        // Pending items populate the outer orbit
        radius = maxRadius + 45;
      }
      
      const x = center.x + radius * Math.cos(angle);
      const y = center.y + radius * Math.sin(angle);
      
      return {
        ...item,
        x,
        y,
        angle,
        radius,
      };
    });
  }, [center.x, center.y, items, minRadius, maxRadius, isPending]);
}

export default function FriendsScreen() {
  const router = useRouter();
  const { user, refreshUser } = useAuth();
  const { isDark } = useTheme();
  const myUserId = user?.id || user?._id;

  // Core list state
  const [friends, setFriends] = useState<any[]>([]);
  const [pendingRequests, setPendingRequests] = useState<any[]>([]);
  const [syncedContacts, setSyncedContacts] = useState<any[]>([]);
  const [showSyncModal, setShowSyncModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  
  // Interactive nodes state
  const [activeChat, setActiveChat] = useState<any | null>(null);
  const activeChatRef = useRef<any>(null);
  activeChatRef.current = activeChat;
  const [popoverPending, setPopoverPending] = useState<any | null>(null);
  const [chatMessages, setChatMessages] = useState<any[]>([]);
  const [draftMessage, setDraftMessage] = useState('');
  const [sendingMessage, setSendingMessage] = useState(false);
  const [showStickers, setShowStickers] = useState(false);
  const [showGames, setShowGames] = useState(false);
  const [usedTruths, setUsedTruths] = useState<number[]>([]);
  const [usedDares, setUsedDares] = useState<number[]>([]);
  
  // Nickname Editing State
  const [isEditingNickname, setIsEditingNickname] = useState(false);
  const [nicknameInput, setNicknameInput] = useState('');

  // Status Modal & Values
  const [showStatusModal, setShowStatusModal] = useState(false);
  const [activeStatusView, setActiveStatusView] = useState<any | null>(null);
  const [statusText, setStatusText] = useState(user?.statusText || '');
  const [statusEmoji, setStatusEmoji] = useState(user?.statusEmoji || '');
  const [statusBgIndex, setStatusBgIndex] = useState(0);
  const [updatingStatus, setUpdatingStatus] = useState(false);

  useEffect(() => {
    if (user) {
      setStatusText(user.statusText || '');
      setStatusEmoji(user.statusEmoji || '');
    }
  }, [user]);

  // Typing status states
  const [isFriendTyping, setIsFriendTyping] = useState(false);
  const [isTypingLocal, setIsTypingLocal] = useState(false);
  const typingTimeoutRef = useRef<any>(null);
  
  // Real-Time Buddy Notifications Toast State
  const [activeToast, setActiveToast] = useState<{ title: string; text: string } | null>(null);

  const progressAnim = useRef(new Animated.Value(0)).current;

  const markStatusAsSeen = async (friendId: string) => {
    try {
      await apiFetch(`${API_URL}/api/friends/status/seen`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ friendId })
      });
      loadFriendsData();
    } catch (error) {
      console.error('[MARK_SEEN_ERROR]', error);
    }
  };

  useEffect(() => {
    if (activeStatusView) {
      progressAnim.setValue(0);
      Animated.timing(progressAnim, {
        toValue: 1,
        duration: 5000,
        useNativeDriver: false
      }).start();

      if (!activeStatusView.isSelf) {
        markStatusAsSeen(activeStatusView.friendId);
      }

      const timer = setTimeout(() => {
        setActiveStatusView(null);
      }, 5000);

      return () => clearTimeout(timer);
    }
  }, [activeStatusView]);

  const triggerToast = (title: string, text: string) => {
    setActiveToast({ title, text });
    setTimeout(() => setActiveToast(null), 4500);
  };
  
  // Theme state updates instantly
  const [chatTheme, setChatTheme] = useState<string>('graphite');
  const chatScrollRef = useRef<ScrollView>(null);

  // Orbit Center position configuration
  const centerPoint = { x: SW / 2, y: 220 };
  const MIN_RADIUS = 75;
  const MAX_RADIUS = 135;

  // Compute orbits using hook
  const friendNodes = useOrbitLayout(centerPoint, friends, MIN_RADIUS, MAX_RADIUS, false);
  const pendingNodes = useOrbitLayout(centerPoint, pendingRequests, MIN_RADIUS, MAX_RADIUS, true);

  // Load friends and pending requests on load
  useEffect(() => {
    loadFriendsData();
    const interval = setInterval(loadFriendsData, 8000);
    return () => clearInterval(interval);
  }, []);

  // Global user socket listener for real-time buddy notifications
  useEffect(() => {
    if (!myUserId) return;
    const socket = connectSocket();
    socket.emit('joinRoom', `user-${myUserId}`);
    
    const onIncomingRequest = (data: any) => {
      Vibration.vibrate([0, 100, 50, 100]);
      triggerToast('⚡ FRIEND REQUEST', `${data.requester?.name || 'Someone'} requested to join your orbit!`);
      loadFriendsData();
    };

    const onRequestAccepted = (data: any) => {
      Vibration.vibrate([0, 80, 40, 80]);
      triggerToast('🤝 ORBIT LINKED', `${data.friendName || 'A friend'} accepted your request!`);
      loadFriendsData();
    };

    const onNudge = (data: any) => {
      Vibration.vibrate([0, 120, 60, 120]);
      triggerToast('⚡ ORBIT NUDGE', `${data.senderName || 'Your friend'} nudged your orbit flame! 🔥`);
      loadFriendsData();
    };

    const onFriendStatusUpdated = () => {
      loadFriendsData();
    };

    socket.on('incoming_friend_request', onIncomingRequest);
    socket.on('friend_request_accepted', onRequestAccepted);
    socket.on('friend_nudge', onNudge);
    socket.on('friend_status_updated', onFriendStatusUpdated);

    return () => {
      socket.off('incoming_friend_request', onIncomingRequest);
      socket.off('friend_request_accepted', onRequestAccepted);
      socket.off('friend_nudge', onNudge);
      socket.off('friend_status_updated', onFriendStatusUpdated);
    };
  }, [myUserId]);

  // Socket listener for messaging integration
  const activeConversationId = activeChat?.conversationId;
  const activeFriendshipId = activeChat?.friendshipId;

  useEffect(() => {
    setIsFriendTyping(false);
    setIsTypingLocal(false);
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);

    if (!activeConversationId) return;

    const socket = connectSocket();
    socket.emit('joinConversation', activeConversationId);

    const onNewMessage = (msg: any) => {
      if (msg.conversationId === activeConversationId) {
        setChatMessages(prev => {
          if (prev.some(m => m.id === msg.id)) return prev;
          
          // Deduplicate optimistic messages with same text
          const hasOptimistic = prev.some(m => m.id.startsWith('temp-') && m.text === msg.text);
          if (hasOptimistic) {
            // Replace the optimistic message with the real one
            return prev.map(m => (m.id.startsWith('temp-') && m.text === msg.text) ? msg : m);
          }
          return [...prev, msg];
        });
        setTimeout(() => chatScrollRef.current?.scrollToEnd({ animated: true }), 100);
        if (msg.senderId !== myUserId) {
          Vibration.vibrate(80);
        }
      }
    };

    const onThemeUpdated = (data: any) => {
      if (data.friendshipId === activeFriendshipId) {
        setChatTheme(data.theme);
      }
    };

    const onFriendTypingStart = (data: any) => {
      if (data.senderId !== myUserId) {
        setIsFriendTyping(true);
      }
    };

    const onFriendTypingEnd = (data: any) => {
      if (data.senderId !== myUserId) {
        setIsFriendTyping(false);
      }
    };

    socket.on('new_friend_message', onNewMessage);
    socket.on('friendship_theme_updated', onThemeUpdated);
    socket.on('friend_typing_start', onFriendTypingStart);
    socket.on('friend_typing_end', onFriendTypingEnd);

    fetchChatHistory(activeConversationId);

    return () => {
      socket.off('new_friend_message', onNewMessage);
      socket.off('friendship_theme_updated', onThemeUpdated);
      socket.off('friend_typing_start', onFriendTypingStart);
      socket.off('friend_typing_end', onFriendTypingEnd);
    };
  }, [activeConversationId, activeFriendshipId]);

  const loadFriendsData = async () => {
    try {
      refreshUser();
      const res = await apiFetch(ENDPOINTS.friendsList);
      if (res.ok) {
        let data = await res.json();
        if (data.length > 10) {
          data = data.slice(0, 10);
        }
        setFriends(data);
        
        // Sync activeChat state if open to update dynamic fields (like conversationId and streakCount)
        if (activeChatRef.current) {
          const updated = data.find((f: any) => f.friendshipId === activeChatRef.current.friendshipId);
          if (updated) {
            setActiveChat(updated);
          }
        }
      }
      const resPending = await apiFetch(ENDPOINTS.friendsPending);
      if (resPending.ok) {
        const data = await resPending.json();
        setPendingRequests(data);
      }
    } catch (e) {
      console.error('[LOAD_DATA_ERROR]', e);
    }
  };

  const fetchChatHistory = async (convId: string) => {
    try {
      const res = await apiFetch(ENDPOINTS.friendsMessages(convId));
      if (res.ok) {
        const data = await res.json();
        setChatMessages(data);
        setTimeout(() => chatScrollRef.current?.scrollToEnd({ animated: false }), 200);
      }
    } catch (e) {
      console.error('[CHAT_HISTORY_ERROR]', e);
    }
  };

  const handleSaveNickname = async () => {
    if (!activeChat) return;
    const cleanNickname = nicknameInput.trim();
    const originalName = activeChat.originalName || activeChat.name;
    const finalDisplayName = cleanNickname || originalName;

    // Optimistically update current chat and friends list
    setActiveChat((prev: any) => prev ? { ...prev, name: finalDisplayName, nickname: cleanNickname || null } : null);
    setFriends(prev => prev.map(f =>
      f.friendshipId === activeChat.friendshipId
        ? { ...f, name: finalDisplayName, nickname: cleanNickname || null }
        : f
    ));
    setIsEditingNickname(false);
    Vibration.vibrate(50);

    try {
      await apiFetch(`${API_URL}/api/friends/${activeChat.friendshipId}/nickname`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nickname: cleanNickname })
      });
    } catch (e) {
      console.error('[NICKNAME_SAVE_ERROR]', e);
    }
  };

  const handleSendNudge = async () => {
    if (!activeChat) return;
    Vibration.vibrate(100);
    try {
      const res = await apiFetch(`${API_URL}/api/friends/nudge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ friendshipId: activeChat.friendshipId })
      });
      if (res.ok) {
        const data = await res.json();
        Alert.alert('Nudge Transmitted! ⚡', `Streak maintained at ${data.streakCount} days!`);
        loadFriendsData();
      }
    } catch (e) {
      console.error('[NUDGE_ERROR]', e);
    }
  };

  const handleRemoveFriend = async () => {
    if (!activeChat) return;
    Alert.alert(
      'Remove Friend',
      `Are you sure you want to remove ${activeChat.name} from your orbit?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            try {
              const res = await apiFetch(`${API_URL}/api/friends/${activeChat.friendshipId}`, {
                method: 'DELETE'
              });
              if (res.ok) {
                activeChatRef.current = null;
                setActiveChat(null);
                loadFriendsData();
                Alert.alert('Removed', 'Friend removed from your orbit.');
              }
            } catch (e) {
              console.error('[REMOVE_FRIEND_ERROR]', e);
            }
          }
        }
      ]
    );
  };

  const handleCloseChat = () => {
    activeChatRef.current = null;
    setActiveChat(null);
    setIsEditingNickname(false);
    loadFriendsData();
  };

  const getUniqueQuestion = (type: 'truth' | 'dare') => {
    const pool = type === 'truth' ? CAMPUS_TRUTHS : CAMPUS_DARES;
    const used = type === 'truth' ? usedTruths : usedDares;
    const setUsed = type === 'truth' ? setUsedTruths : setUsedDares;

    // Filter out indices that were used recently
    let availableIndices = pool.map((_, i) => i).filter(i => !used.includes(i));
    
    // If we've run out of unique questions, reset the used history
    if (availableIndices.length === 0) {
      availableIndices = pool.map((_, i) => i);
      setUsed([]);
    }

    const randomIndex = availableIndices[Math.floor(Math.random() * availableIndices.length)];
    
    // Add to used list
    setUsed(prev => [...prev, randomIndex]);

    let question = pool[randomIndex];

    // Dynamic variable substitutions
    if (question.includes('{friendName}')) {
      const friendPool = friends.map(f => f.name).filter(Boolean);
      const randomFriend = friendPool.length > 0 ? friendPool[Math.floor(Math.random() * friendPool.length)] : 'your roommate';
      question = question.replace(/{friendName}/g, randomFriend);
    }
    if (question.includes('{blockName}')) {
      const blocks = ['A', 'B', 'C', 'D', 'LH', 'MH'];
      const randomBlock = blocks[Math.floor(Math.random() * blocks.length)];
      question = question.replace(/{blockName}/g, randomBlock);
    }
    if (question.includes('{roomNumber}')) {
      const randomRoom = Math.floor(Math.random() * 400 + 100).toString();
      question = question.replace(/{roomNumber}/g, randomRoom);
    }
    if (question.includes('{canteenFood}')) {
      const randomFood = CANTEEN_FOODS[Math.floor(Math.random() * CANTEEN_FOODS.length)];
      question = question.replace(/{canteenFood}/g, randomFood);
    }
    if (question.includes('{subjectName}')) {
      const randomSubject = SUBJECTS[Math.floor(Math.random() * SUBJECTS.length)];
      question = question.replace(/{subjectName}/g, randomSubject);
    }
    if (question.includes('{professorRole}')) {
      const randomProf = PROFESSOR_ROLES[Math.floor(Math.random() * PROFESSOR_ROLES.length)];
      question = question.replace(/{professorRole}/g, randomProf);
    }
    if (question.includes('{locationName}')) {
      const randomLoc = LOCATIONS[Math.floor(Math.random() * LOCATIONS.length)];
      question = question.replace(/{locationName}/g, randomLoc);
    }
    if (question.includes('{itemName}')) {
      const randomItem = ITEMS[Math.floor(Math.random() * ITEMS.length)];
      question = question.replace(/{itemName}/g, randomItem);
    }

    return question;
  };

  // Optimistic UI interaction handlers
  const handleAcceptFriend = async (friendshipId: string, nodeItem: any) => {
    if (friends.length >= 10) {
      Alert.alert('Circle Limit Reached', 'You can only have up to 10 close friends in your orbit circle.');
      return;
    }
    setPopoverPending(null);
    Vibration.vibrate(100);

    // Optimistic state promote: remove from pending list and add to friends list
    const promotedRequester = nodeItem.requester;
    setPendingRequests(prev => prev.filter(p => p.friendshipId !== friendshipId));
    setFriends(prev => [
      ...prev,
      {
        friendshipId,
        friendId: promotedRequester.id,
        name: promotedRequester.name,
        originalName: promotedRequester.name,
        nickname: null,
        phone: promotedRequester.phone,
        profileImage: promotedRequester.profileImage,
        streakCount: 1, // Starts with a small streak
        lastInteractionAt: new Date().toISOString(),
        theme: 'graphite',
        conversationId: null
      }
    ].slice(0, 10));

    try {
      const res = await apiFetch(ENDPOINTS.friendsAccept, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ friendshipId })
      });
      if (!res.ok) {
        loadFriendsData(); // Fallback to server state if failed
      }
    } catch (e) {
      loadFriendsData();
    }
  };

  const handleDeclineFriend = async (friendshipId: string) => {
    setPopoverPending(null);
    Vibration.vibrate(50);
    // Optimistic removal
    setPendingRequests(prev => prev.filter(p => p.friendshipId !== friendshipId));
    try {
      await apiFetch(`${API_URL}/api/friends/${friendshipId}`, {
        method: 'DELETE'
      });
    } catch (e) {
      console.error('[DECLINE_FRIEND_ERROR]', e);
      loadFriendsData();
    }
  };

  const handleThemeDotPress = async (themeName: string) => {
    if (!activeChat) return;
    setChatTheme(themeName); // Optimistic UI theme update
    
    try {
      const res = await apiFetch(ENDPOINTS.friendsTheme(activeChat.friendshipId), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ theme: themeName })
      });
      if (res.ok) {
        // Sync local object state
        setFriends(prev =>
          prev.map(f => f.friendshipId === activeChat.friendshipId ? { ...f, theme: themeName } : f)
        );
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleSendMessage = async (stickerText?: string) => {
    const text = stickerText || draftMessage;
    if (!text.trim() || !activeChat) return;

    const optimisticMsg = {
      id: `temp-${Date.now()}`,
      senderId: myUserId,
      senderName: user?.name,
      text: text.trim(),
      createdAt: new Date().toISOString()
    };

    setChatMessages(prev => [...prev, optimisticMsg]);
    if (!stickerText) setDraftMessage('');
    setShowStickers(false);
    setShowGames(false);
    setTimeout(() => chatScrollRef.current?.scrollToEnd({ animated: true }), 80);

    try {
      const res = await apiFetch(ENDPOINTS.friendsSendMessage, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId: activeChat.conversationId,
          friendshipId: activeChat.friendshipId,
          text: text.trim()
        })
      });
      if (res.ok) {
        const newMsg = await res.json();
        // If this is the first message and it created a conversation, update conversationId locally
        if (newMsg.conversationId && !activeChat.conversationId) {
          setActiveChat((prev: any) => prev ? { ...prev, conversationId: newMsg.conversationId } : null);
          setFriends(prev => prev.map(f => 
            f.friendshipId === activeChat.friendshipId 
              ? { ...f, conversationId: newMsg.conversationId } 
              : f
          ));
        }
      } else {
        Alert.alert('Send Failed', 'Failed to send secure message.');
      }
    } catch (e) {
      Alert.alert('Error', 'Message transmission failed.');
    }
  };

  const handleInputChange = (text: string) => {
    setDraftMessage(text);
    if (!activeConversationId) return;

    const socket = connectSocket();
    if (!isTypingLocal) {
      setIsTypingLocal(true);
      socket.emit('friend_typing_start', { conversationId: activeConversationId });
    }

    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      setIsTypingLocal(false);
      socket.emit('friend_typing_end', { conversationId: activeConversationId });
    }, 3000);
  };

  const handleUpdateStatus = async () => {
    if (!statusText.trim() && !statusEmoji.trim()) {
      Alert.alert('Status Required', 'Please set a status text or emoji.');
      return;
    }
    setUpdatingStatus(true);
    try {
      const res = await apiFetch(`${API_URL}/api/friends/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ statusText: statusText.trim(), statusEmoji: statusEmoji.trim() })
      });
      if (res.ok) {
        Alert.alert('Status Set! 🚀', 'Your status has been updated across your orbit!');
        setShowStatusModal(false);
        await refreshUser();
        loadFriendsData();
      } else {
        Alert.alert('Error', 'Failed to update status.');
      }
    } catch (e) {
      console.error(e);
      Alert.alert('Error', 'Status update request failed.');
    } finally {
      setUpdatingStatus(false);
    }
  };

  const handleContactsSync = async () => {
    setSyncing(true);
    try {
      const { status } = await Contacts.requestPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Denied', 'Permission to access contacts is required to scan for friends on Zenvy.');
        setSyncing(false);
        return;
      }

      const { data } = await Contacts.getContactsAsync({
        fields: [Contacts.Fields.PhoneNumbers],
      });

      if (data && data.length > 0) {
        const phoneNumbers: string[] = [];
        data.forEach(contact => {
          if (contact.phoneNumbers) {
            contact.phoneNumbers.forEach(p => {
              if (p.number) {
                // Strip whitespace & formatting before collecting
                const cleanNum = p.number.replace(/\s+/g, '').replace(/[-()]/g, '');
                if (cleanNum) phoneNumbers.push(cleanNum);
              }
            });
          }
        });

        const uniqueNumbers = [...new Set(phoneNumbers.filter(Boolean))];
        
        if (uniqueNumbers.length === 0) {
          Alert.alert('No Contacts Found', 'No contacts with valid phone numbers were detected.');
          setSyncing(false);
          return;
        }

        const res = await apiFetch(ENDPOINTS.friendsContacts, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contacts: uniqueNumbers })
        });
        
        if (res.ok) {
          const matched = await res.json();
          setSyncedContacts(matched);
          Vibration.vibrate([0, 80, 40, 80]);
        } else {
          Alert.alert('Error', 'Failed to scan matching users from contacts.');
        }
      } else {
        Alert.alert('No Contacts', 'No contacts found on this device.');
      }
    } catch (e) {
      console.error(e);
      Alert.alert('Error', 'Could not sync contacts.');
    } finally {
      setSyncing(false);
    }
  };

  const handleSearchUsers = async (queryText: string) => {
    setSearchQuery(queryText);
    if (!queryText.trim()) {
      setSyncedContacts([]);
      return;
    }
    setSyncing(true);
    try {
      const res = await apiFetch(ENDPOINTS.friendsContacts, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: queryText })
      });
      if (res.ok) {
        const data = await res.json();
        setSyncedContacts(data);
      }
    } catch (e) {
      console.error('[SEARCH_USERS_ERROR]', e);
    } finally {
      setSyncing(false);
    }
  };

  const handleAddFriend = async (friendId: string) => {
    if (friends.length >= 10) {
      Alert.alert('Circle Limit Reached', 'Your orbit is full (10 friends max). Remove someone before adding new friends.');
      return;
    }
    try {
      const res = await apiFetch(ENDPOINTS.friendsRequest, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipientId: friendId })
      });
      if (res.ok) {
        Alert.alert('Request Sent', 'Friend request sent!');
        setSyncedContacts(prev =>
          prev.map(c => c.id === friendId ? { ...c, friendshipStatus: 'pending' } : c)
        );
        loadFriendsData();
      }
    } catch (e) {
      console.error(e);
    }
  };

  const getActiveThemeColors = () => {
    const current = CHAT_THEMES.find(t => t.name === chatTheme);
    return current ? current.colors : ['#0E1116', '#171B22', '#0E1116'];
  };

  const getActiveThemeAccent = () => {
    const current = CHAT_THEMES.find(t => t.name === chatTheme);
    return current ? current.accent : '#6E5BFF';
  };

  return (
    <SafeAreaView style={s.container}>
      <StatusBarBackground />
      
      {/* REAL-TIME BUDDY NOTIFICATION TOAST BANNER */}
      {activeToast && (
        <TouchableOpacity style={s.toastBannerContainer} onPress={() => setActiveToast(null)}>
          <View style={s.toastBannerGradient}>
            <Text style={s.toastTitleText}>{activeToast.title}</Text>
            <Text style={s.toastBodyText}>{activeToast.text}</Text>
          </View>
        </TouchableOpacity>
      )}

      {/* Top Header Navigation */}
      <View style={s.topHeader}>
        <TouchableOpacity style={s.backButton} onPress={() => router.back()}>
          <Text style={s.backText}>← CLOSE CIRCLE</Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.syncButtonTrigger} onPress={() => setShowSyncModal(true)}>
          <Text style={s.syncButtonText}>➕ SCAN & ADD</Text>
        </TouchableOpacity>
      </View>

      {/* Dynamic Instagram-style Stories (Status) Row */}
      <View style={s.storiesWrapper}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.storiesScrollContent}>
          {/* YOU Avatar */}
          <TouchableOpacity
            style={s.storyItem}
            onPress={() => {
              if (user?.statusText || user?.statusEmoji) {
                setActiveStatusView({
                  name: 'Your Status',
                  profileImage: user?.profileImage,
                  statusText: user?.statusText,
                  statusEmoji: user?.statusEmoji,
                  isSelf: true
                });
              } else {
                setStatusText('');
                setStatusEmoji('');
                setShowStatusModal(true);
              }
            }}
          >
            {user?.statusText || user?.statusEmoji ? (
              <View>
                <LinearGradient
                  colors={['#6E5BFF', '#FF7A59', '#FF1493']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={s.storyAvatarOutline}
                >
                  <Image
                    source={{ uri: getAvatarUrl(user?.profileImage || null, myUserId || 'self') }}
                    style={[s.storyAvatar, { borderWidth: 2, borderColor: '#07090C' }]}
                  />
                </LinearGradient>
                {user?.statusEmoji && (
                  <View style={s.storyEmojiBadge}>
                    <Text style={s.storyEmojiBadgeText}>{user.statusEmoji}</Text>
                  </View>
                )}
              </View>
            ) : (
              <View style={[s.storyAvatarOutline, s.storyUserOutline]}>
                <Image
                  source={{ uri: getAvatarUrl(user?.profileImage || null, myUserId || 'self') }}
                  style={s.storyAvatar}
                />
                <View style={s.storyUserAddBadge}>
                  <Text style={s.storyUserAddText}>+</Text>
                </View>
              </View>
            )}
            <Text style={s.storyName} numberOfLines={1}>Your Status</Text>
          </TouchableOpacity>

          {/* Friends Avatars */}
          {friends.map((friend) => {
            const hasStatus = !!(friend.statusText || friend.statusEmoji);
            const isSeen = friend.statusSeenBy && friend.statusSeenBy.includes(myUserId);

            return (
              <TouchableOpacity
                key={friend.friendshipId}
                style={s.storyItem}
                onPress={() => {
                  if (hasStatus) {
                    setActiveStatusView(friend);
                  } else {
                    setActiveChat(friend);
                    setChatTheme(friend.theme || 'graphite');
                  }
                }}
              >
                {hasStatus ? (
                  <LinearGradient
                    colors={isSeen ? ['#444752', '#2E323A'] : ['#6E5BFF', '#FF7A59', '#FF1493']}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={s.storyAvatarOutline}
                  >
                    <Image
                      source={{ uri: getAvatarUrl(friend.profileImage, friend.friendId) }}
                      style={[s.storyAvatar, { borderWidth: 2, borderColor: '#07090C' }]}
                    />
                  </LinearGradient>
                ) : (
                  <View style={[s.storyAvatarOutline, { padding: 0 }]}>
                    <Image
                      source={{ uri: getAvatarUrl(friend.profileImage, friend.friendId) }}
                      style={s.storyAvatar}
                    />
                  </View>
                )}
                {friend.statusEmoji && hasStatus && (
                  <View style={s.storyEmojiBadge}>
                    <Text style={s.storyEmojiBadgeText}>{friend.statusEmoji}</Text>
                  </View>
                )}
                <Text style={s.storyName} numberOfLines={1}>{friend.name}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {/* WhatsApp/Insta Direct Chat List */}
      <View style={s.chatListWrapper}>
        <View style={s.chatListHeader}>
          <Text style={s.chatListTitle}>SECURE VAULTS</Text>
          {pendingRequests.length > 0 && (
            <TouchableOpacity style={s.pendingBannerBadge} onPress={() => setShowSyncModal(true)}>
              <Text style={s.pendingBannerBadgeText}>{pendingRequests.length} INCOMING</Text>
            </TouchableOpacity>
          )}
        </View>

        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 24 }} showsVerticalScrollIndicator={false}>
          {friends.length === 0 ? (
            <View style={s.emptyChatListContainer}>
              <Text style={{ fontSize: 48, marginBottom: 16 }}>🛸</Text>
              <Text style={s.emptyChatListTitle}>Your Orbit is Empty</Text>
              <Text style={s.emptyChatListSub}>Connect with campus friends to start secure messaging and sharing statuses!</Text>
              <TouchableOpacity
                style={{
                  marginTop: 24,
                  backgroundColor: '#6E5BFF',
                  paddingVertical: 14,
                  paddingHorizontal: 28,
                  borderRadius: 30,
                  flexDirection: 'row',
                  alignItems: 'center',
                  shadowColor: '#6E5BFF',
                  shadowOffset: { width: 0, height: 4 },
                  shadowOpacity: 0.3,
                  shadowRadius: 8,
                }}
                onPress={() => setShowSyncModal(true)}
              >
                <Text style={{ color: '#FFF', fontSize: 16, fontWeight: '800', letterSpacing: 0.5 }}>
                  🔍 FIND FRIENDS
                </Text>
              </TouchableOpacity>
            </View>
          ) : (
            friends.map((friend) => (
              <TouchableOpacity
                key={friend.friendshipId}
                style={s.chatListItem}
                activeOpacity={0.7}
                onPress={() => {
                  setActiveChat(friend);
                  setChatTheme(friend.theme || 'graphite');
                }}
              >
                {/* Left side: Avatar */}
                <View style={s.chatListAvatarContainer}>
                  <Image
                    source={{ uri: getAvatarUrl(friend.profileImage, friend.friendId) }}
                    style={s.chatListAvatar}
                  />
                  {friend.statusEmoji && (
                    <View style={s.chatListEmojiBadge}>
                      <Text style={{ fontSize: 10 }}>{friend.statusEmoji}</Text>
                    </View>
                  )}
                </View>

                {/* Center side: Names and Status */}
                <View style={s.chatListMiddle}>
                  <View style={s.chatListNameRow}>
                    <Text style={s.chatListFriendName} numberOfLines={1}>{friend.name}</Text>
                    {friend.streakCount > 0 && (
                      <Text style={s.chatListStreakText}>🔥 {friend.streakCount}</Text>
                    )}
                  </View>
                  <Text style={s.chatListStatusText} numberOfLines={1}>
                    {friend.statusText ? `💬 ${friend.statusText}` : 'Tap to encrypt transmission...'}
                  </Text>
                </View>

                {/* Right side: Time/Arrow */}
                <View style={s.chatListRight}>
                  <Text style={s.chatListTimeText}>
                    {friend.lastInteractionAt ? new Date(friend.lastInteractionAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                  </Text>
                  <View style={[s.themeDotIndicator, { backgroundColor: CHAT_THEMES.find(t => t.name === (friend.theme || 'graphite'))?.accent || '#6E5BFF' }]} />
                </View>
              </TouchableOpacity>
            ))
          )}
        </ScrollView>
      </View>

      {/* SLIDE-UP BOTTOM SHEET FOR SECURE CHATS */}
      {activeChat && (
        <Modal visible={!!activeChat} animationType="slide" transparent={true} onRequestClose={handleCloseChat}>
          <KeyboardAvoidingView
            style={{ flex: 1 }}
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          >
            <View style={s.modalContainer}>
              <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
                <View style={s.bottomSheetDimmer} />
              </TouchableWithoutFeedback>
              
              <View style={[s.bottomSheetContent, { backgroundColor: getActiveThemeColors()[0] }]}>
                {/* Top Grab Handle decor */}
                <View style={s.bottomSheetGrabHandle} />

                {/* Header Row: Navigation & Actions */}
                <View style={s.chatHeaderRow}>
                  <TouchableOpacity style={s.chatCloseBtn} onPress={handleCloseChat}>
                    <Text style={s.chatCloseText}>✕ CLOSE</Text>
                  </TouchableOpacity>

                  <View style={s.chatHeaderActions}>
                    <TouchableOpacity style={s.nudgeActionBtn} onPress={handleSendNudge}>
                      <Text style={s.nudgeActionText}>⚡ NUDGE</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={s.removeActionBtn} onPress={handleRemoveFriend}>
                      <Text style={s.removeActionText}>🗑️</Text>
                    </TouchableOpacity>
                  </View>
                </View>

                {/* Friend Display Profile Section */}
                <View style={s.friendProfileSection}>
                  {isEditingNickname ? (
                    <View style={s.nameEditRowInline}>
                      <TextInput
                        style={s.nicknameInputField}
                        value={nicknameInput}
                        onChangeText={setNicknameInput}
                        placeholder="Set nickname..."
                        placeholderTextColor="rgba(255,255,255,0.4)"
                        autoFocus
                      />
                      <TouchableOpacity style={s.nicknameSaveBtn} onPress={handleSaveNickname}>
                        <Text style={s.nicknameSaveBtnText}>Save</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={s.nicknameCancelBtn} onPress={() => setIsEditingNickname(false)}>
                        <Text style={s.nicknameCancelBtnText}>✕</Text>
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <View style={s.friendNameInfo}>
                      <TouchableOpacity
                        style={s.nameEditRow}
                        onPress={() => {
                          setNicknameInput(activeChat.nickname || '');
                          setIsEditingNickname(true);
                        }}
                      >
                        <Text style={s.chatHeaderTitle} numberOfLines={1}>{activeChat?.name}</Text>
                        <Text style={{ fontSize: 10, marginLeft: 6 }}>✏️</Text>
                      </TouchableOpacity>
                      <Text style={s.chatHeaderSubtitle}>
                        {activeChat?.nickname ? `REAL: ${activeChat?.originalName || activeChat?.name}` : 'SECURE END-TO-END LINK'}
                      </Text>
                    </View>
                  )}

                  {/* Active Chat theme selector */}
                  <View style={s.themeDotsRow}>
                    {CHAT_THEMES.map(themeItem => (
                      <TouchableOpacity
                        key={themeItem.name}
                        style={[
                          s.themeDot,
                          { backgroundColor: themeItem.accent },
                          chatTheme === themeItem.name && s.activeThemeDot
                        ]}
                        onPress={() => handleThemeDotPress(themeItem.name)}
                      />
                    ))}
                  </View>
                </View>

              {/* Streak Banner */}
              <View style={[s.streakBanner, { borderBottomColor: 'rgba(255,255,255,0.06)' }]}>
                <Text style={s.streakBannerText}>
                  STREAK COUNT: <Text style={s.monoText}>🔥{activeChat?.streakCount || 0}</Text>
                </Text>
                <Text style={s.streakBannerSub}>🔒 AES-256 SECURED VAULT</Text>
              </View>

              {/* Message scroll views */}
              <ScrollView
                ref={chatScrollRef}
                style={s.messagesScrollView}
                contentContainerStyle={{ paddingVertical: 12, paddingHorizontal: 16 }}
                showsVerticalScrollIndicator={false}
              >
                {chatMessages.length === 0 ? (
                  <View style={s.messagesEmptyContainer}>
                    <Text style={s.emptySymbol}>🤫</Text>
                    <Text style={s.emptyInstruction}>No chats yet. Make the first move.</Text>
                  </View>
                ) : (
                  chatMessages.map((msg, index) => {
                    const isMe = msg.senderId === myUserId;
                    const isSticker = ZENVY_STICKERS.includes(msg.text);
                    const isTruth = msg.text.startsWith('[TRUTH]');
                    const isDare = msg.text.startsWith('[DARE]');

                    return (
                      <View key={msg.id || index} style={[s.msgRow, isMe ? s.msgRowMe : s.msgRowThem]}>
                        {!isMe && (
                          <View style={s.msgAvatarCircle}>
                            <Text style={s.msgAvatarInitials}>
                              {msg.senderName?.charAt(0).toUpperCase() || activeChat?.name?.charAt(0).toUpperCase()}
                            </Text>
                          </View>
                        )}
                        {isSticker ? (
                          <View style={s.stickerMessageContainer}>
                            <Text style={s.stickerMessageChar}>{msg.text}</Text>
                          </View>
                        ) : isTruth ? (
                          <View style={[s.gameCard, { backgroundColor: '#8E2DE2', borderBottomRightRadius: isMe ? 2 : 16, borderBottomLeftRadius: isMe ? 16 : 2 }]}>
                            <Text style={s.gameCardTag}>💡 CAMPUS TRUTH</Text>
                            <Text style={s.gameCardQuestion}>"{msg.text.replace('[TRUTH]', '').trim()}"</Text>
                          </View>
                        ) : isDare ? (
                          <View style={[s.gameCard, { backgroundColor: '#DD2476', borderBottomRightRadius: isMe ? 2 : 16, borderBottomLeftRadius: isMe ? 16 : 2 }]}>
                            <Text style={s.gameCardTag}>😈 CAMPUS DARE</Text>
                            <Text style={s.gameCardQuestion}>"{msg.text.replace('[DARE]', '').trim()}"</Text>
                          </View>
                        ) : (
                          <View
                            style={[
                              s.msgBubble,
                              isMe ? [s.msgBubbleMe, { backgroundColor: getActiveThemeAccent() }] : s.msgBubbleThem
                            ]}
                          >
                            <Text style={[s.msgBodyText, isMe ? s.msgBodyTextMe : s.msgBodyTextThem]}>
                              {msg.text}
                            </Text>
                          </View>
                        )}
                      </View>
                    );
                  })
                )}
              </ScrollView>

              {/* Expressive sticker drawer */}
              {showStickers && (
                <View style={s.stickerSelectionPanel}>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.stickerHorizontalScroll}>
                    {ZENVY_STICKERS.map(emoji => (
                      <TouchableOpacity
                        key={emoji}
                        style={s.stickerBubbleBtn}
                        onPress={() => handleSendMessage(emoji)}
                      >
                        <Text style={{ fontSize: 26 }}>{emoji}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>
              )}

              {/* Expressive games drawer */}
              {showGames && (
                <View style={s.stickerSelectionPanel}>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.stickerHorizontalScroll}>
                    <TouchableOpacity
                      style={[s.stickerBubbleBtn, { width: 110, backgroundColor: '#8E2DE2', flexDirection: 'row', gap: 6, paddingHorizontal: 12, height: 44, borderRadius: 22 }]}
                      onPress={() => {
                        const uniqueTruth = getUniqueQuestion('truth');
                        handleSendMessage(`[TRUTH] ${uniqueTruth}`);
                      }}
                    >
                      <Text style={{ fontSize: 20 }}>💡</Text>
                      <Text style={{ color: '#FFF', fontSize: 12, fontWeight: '900' }}>TRUTH</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[s.stickerBubbleBtn, { width: 110, backgroundColor: '#DD2476', flexDirection: 'row', gap: 6, paddingHorizontal: 12, height: 44, borderRadius: 22 }]}
                      onPress={() => {
                        const uniqueDare = getUniqueQuestion('dare');
                        handleSendMessage(`[DARE] ${uniqueDare}`);
                      }}
                    >
                      <Text style={{ fontSize: 20 }}>😈</Text>
                      <Text style={{ color: '#FFF', fontSize: 12, fontWeight: '900' }}>DARE</Text>
                    </TouchableOpacity>
                  </ScrollView>
                </View>
              )}

              {/* Quick reactions & typing status overlay */}
              <View style={s.chatInputTopAccessory}>
                {isFriendTyping ? (
                  <View style={s.typingIndicatorWrap}>
                    <Text style={s.typingIndicatorText}>{activeChat?.nickname || activeChat?.name} is typing...</Text>
                  </View>
                ) : (
                  <View style={s.quickReactionsRow}>
                    {['❤️', '🔥', '😂', '😮', '😢', '👍'].map((emoji) => (
                      <TouchableOpacity key={emoji} onPress={() => handleSendMessage(emoji)} style={s.quickReactionBtn}>
                        <Text style={s.quickReactionEmoji}>{emoji}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </View>

              {/* Chat Input controls */}
              <View style={s.chatInputContainer}>
                <TouchableOpacity
                  style={[s.stickerTriggerButton, showStickers && s.stickerTriggerButtonActive]}
                  onPress={() => {
                    setShowStickers(!showStickers);
                    setShowGames(false);
                  }}
                >
                  <Text style={{ fontSize: 20 }}>🎭</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[s.stickerTriggerButton, showGames && s.stickerTriggerButtonActive]}
                  onPress={() => {
                    setShowGames(!showGames);
                    setShowStickers(false);
                  }}
                >
                  <Text style={{ fontSize: 20 }}>🎮</Text>
                </TouchableOpacity>

                <TextInput
                  style={s.chatTextInputField}
                  placeholder="Transmit encrypted message..."
                  placeholderTextColor="rgba(255,255,255,0.3)"
                  value={draftMessage}
                  onChangeText={handleInputChange}
                  onSubmitEditing={() => handleSendMessage()}
                />

                <TouchableOpacity
                  disabled={sendingMessage || !draftMessage.trim()}
                  style={[s.sendMessageBtn, { backgroundColor: getActiveThemeAccent() }]}
                  onPress={() => handleSendMessage()}
                >
                  {sendingMessage ? (
                    <ActivityIndicator size="small" color="#000" />
                  ) : (
                    <Text style={s.sendMessageBtnText}>SEND</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
      )}

      {/* SYNC CONTACTS AND ADD FRIENDS DRAWER / MODAL */}
      <Modal visible={showSyncModal} animationType="slide" transparent={false} onRequestClose={() => setShowSyncModal(false)}>
        <SafeAreaView style={[s.syncModalContainer, { backgroundColor: GRAPHITE_BG }]}>
          <View style={s.syncModalHeader}>
            <Text style={s.syncModalTitle}>FIND & ADD FRIENDS</Text>
            <TouchableOpacity style={s.syncModalCloseBtn} onPress={() => { setShowSyncModal(false); setSearchQuery(''); setSyncedContacts([]); }}>
              <Text style={s.syncModalCloseText}>✕ CLOSE</Text>
            </TouchableOpacity>
          </View>

          {/* Interactive Search Bar */}
          <View style={s.searchBarContainer}>
            <TextInput
              style={s.searchBarInput}
              placeholder="Search by name or phone..."
              placeholderTextColor="rgba(255,255,255,0.3)"
              value={searchQuery}
              onChangeText={handleSearchUsers}
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity onPress={() => handleSearchUsers('')} style={s.searchClearBtn}>
                <Text style={s.searchClearText}>✕</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Fallback to bulk contact sync if not searching */}
          {searchQuery.trim().length === 0 && (
            <View style={s.syncPromptBox}>
              <Text style={s.syncPromptText}>
                Or quickly scan registered campus buddies matching your local phone contacts list!
              </Text>
              <TouchableOpacity
                disabled={syncing}
                style={[s.primarySyncBtn, { backgroundColor: VIOLET_ACCENT }]}
                onPress={handleContactsSync}
              >
                {syncing ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={s.primarySyncBtnText}>🔄 SCAN REGISTERED CONTACTS</Text>
                )}
              </TouchableOpacity>
            </View>
          )}

          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16 }}>
            {/* INCOMING REQUESTS PANEL */}
            {pendingRequests.length > 0 && searchQuery.trim().length === 0 && (
              <View style={{ marginBottom: 24 }}>
                <Text style={s.syncedContactsTitle}>INCOMING REQUESTS ({pendingRequests.length})</Text>
                {pendingRequests.map(r => {
                  const reqNode = { requester: r.requester };
                  return (
                    <View key={r.friendshipId} style={s.contactItemRow}>
                      <View style={[s.contactAvatarCircle, { backgroundColor: 'rgba(110, 91, 255, 0.15)' }]}>
                        <Text style={[s.contactAvatarInitials, { color: VIOLET_ACCENT }]}>
                          {(r.requester?.name || 'U').charAt(0).toUpperCase()}
                        </Text>
                      </View>
                      <View style={{ flex: 1, marginLeft: 12 }}>
                        <Text style={s.contactItemName}>{r.requester?.name || 'Buddy'}</Text>
                        <Text style={s.contactItemPhone}>{r.requester?.phone || ''}</Text>
                      </View>
                      <View style={{ flexDirection: 'row', gap: 6 }}>
                        <TouchableOpacity
                          style={[s.contactAddBtn, { borderColor: '#4CAF50' }]}
                          onPress={() => handleAcceptFriend(r.friendshipId, reqNode)}
                        >
                          <Text style={[s.contactAddBtnText, { color: '#4CAF50' }]}>ACCEPT</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[s.contactAddBtn, { borderColor: '#FF5252' }]}
                          onPress={() => handleDeclineFriend(r.friendshipId)}
                        >
                          <Text style={[s.contactAddBtnText, { color: '#FF5252' }]}>DECLINE</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  );
                })}
              </View>
            )}

            {syncedContacts.length > 0 && (
              <View>
                <Text style={s.syncedContactsTitle}>
                  {searchQuery.trim().length > 0 ? 'SEARCH RESULTS' : 'SYNCED USERS FOUND'}
                </Text>
                {syncedContacts.map(c => (
                  <View key={c.id} style={s.contactItemRow}>
                    <View style={s.contactAvatarCircle}>
                      <Text style={s.contactAvatarInitials}>{c.name.charAt(0).toUpperCase()}</Text>
                    </View>
                    <View style={{ flex: 1, marginLeft: 12 }}>
                      <Text style={s.contactItemName}>{c.name}</Text>
                      <Text style={s.contactItemPhone}>{c.phone}</Text>
                    </View>
                    {c.friendshipStatus === 'none' && (
                      <TouchableOpacity style={s.contactAddBtn} onPress={() => handleAddFriend(c.id)}>
                        <Text style={s.contactAddBtnText}>+ ADD</Text>
                      </TouchableOpacity>
                    )}
                    {c.friendshipStatus === 'pending' && (
                      <Text style={s.contactPendingLabel}>PENDING</Text>
                    )}
                    {c.friendshipStatus === 'accepted' && (
                      <Text style={s.contactFriendLabel}>FRIEND</Text>
                    )}
                  </View>
                ))}
              </View>
            )}

            {searchQuery.trim().length > 0 && syncedContacts.length === 0 && !syncing && (
              <View style={{ alignItems: 'center', marginTop: 40 }}>
                <Text style={{ color: '#8A94A6', fontSize: 13 }}>No users match "{searchQuery}"</Text>
              </View>
            )}
          </ScrollView>
        </SafeAreaView>
      </Modal>

      {/* Innovative Full-Screen Status Creator */}
      <Modal visible={showStatusModal} animationType="slide" transparent={false} onRequestClose={() => setShowStatusModal(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
          <LinearGradient
            colors={STATUS_GRADIENTS[statusBgIndex]}
            style={{ flex: 1 }}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
          >
            {/* Top Navigation */}
            <SafeAreaView style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', padding: 20, paddingTop: Platform.OS === 'ios' ? 10 : 40 }}>
                <TouchableOpacity onPress={() => setShowStatusModal(false)} style={{ padding: 8, backgroundColor: 'rgba(0,0,0,0.3)', borderRadius: 20 }}>
                  <Text style={{ color: '#FFF', fontSize: 16, fontWeight: '700' }}>✕ Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity 
                  onPress={() => setStatusBgIndex((prev) => (prev + 1) % STATUS_GRADIENTS.length)} 
                  style={{ padding: 8, paddingHorizontal: 16, backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 20 }}
                >
                  <Text style={{ color: '#FFF', fontSize: 16, fontWeight: '700' }}>🎨 Theme</Text>
                </TouchableOpacity>
              </View>

              {/* Central Text Input */}
              <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
                <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 30 }}>
                  <TextInput
                    style={{
                      fontSize: statusText.length > 30 ? 28 : 42,
                      color: '#FFF',
                      fontWeight: '800',
                      textAlign: 'center',
                      width: '100%',
                      textShadowColor: 'rgba(0,0,0,0.2)',
                      textShadowOffset: { width: 0, height: 2 },
                      textShadowRadius: 10,
                    }}
                    multiline
                    maxLength={100}
                    value={statusText}
                    onChangeText={setStatusText}
                    placeholder="Type a status..."
                    placeholderTextColor="rgba(255,255,255,0.5)"
                    autoFocus
                  />
                  
                  {/* Optional Emoji Badge */}
                  <View style={{ marginTop: 40, alignItems: 'center' }}>
                    <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 14, marginBottom: 12, fontWeight: '600' }}>Vibe (Emoji)</Text>
                    <View style={{ flexDirection: 'row', gap: 10 }}>
                      {['🔥', '✨', '💀', '🍔', '😴', '🎮'].map(emoji => (
                        <TouchableOpacity 
                          key={emoji} 
                          onPress={() => setStatusEmoji(emoji)}
                          style={{
                            padding: 10,
                            backgroundColor: statusEmoji === emoji ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.2)',
                            borderRadius: 20,
                            borderWidth: 2,
                            borderColor: statusEmoji === emoji ? '#FFF' : 'transparent'
                          }}
                        >
                          <Text style={{ fontSize: 24 }}>{emoji}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>
                </View>
              </TouchableWithoutFeedback>

              {/* Bottom Post Button */}
              <View style={{ padding: 24, paddingBottom: 40 }}>
                <TouchableOpacity 
                  style={{
                    backgroundColor: '#FFF',
                    paddingVertical: 18,
                    borderRadius: 30,
                    alignItems: 'center',
                    shadowColor: '#000',
                    shadowOffset: { width: 0, height: 4 },
                    shadowOpacity: 0.3,
                    shadowRadius: 10,
                  }} 
                  onPress={handleUpdateStatus} 
                  disabled={updatingStatus}
                >
                  {updatingStatus ? (
                    <ActivityIndicator size="small" color="#000" />
                  ) : (
                    <Text style={{ color: '#000', fontSize: 18, fontWeight: '900', letterSpacing: 1 }}>
                      🚀 POST STATUS
                    </Text>
                  )}
                </TouchableOpacity>
              </View>
            </SafeAreaView>
          </LinearGradient>
        </KeyboardAvoidingView>
      </Modal>

      {/* Immersive Instagram-style Status Viewer Modal */}
      <Modal visible={activeStatusView !== null} animationType="fade" transparent={false} onRequestClose={() => setActiveStatusView(null)}>
        {activeStatusView && (() => {
          // Select gradient index based on user ID or deterministic logic
          const indexSeed = activeStatusView.friendId || (activeStatusView.isSelf ? 'self' : 'seed');
          let hash = 0;
          for (let i = 0; i < indexSeed.length; i++) {
            hash = indexSeed.charCodeAt(i) + ((hash << 5) - hash);
          }
          const bgIndex = Math.abs(hash) % STATUS_GRADIENTS.length;
          
          return (
            <View style={{ flex: 1, backgroundColor: '#000' }}>
              <LinearGradient
                colors={STATUS_GRADIENTS[bgIndex]}
                style={{ flex: 1 }}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
              >
                <SafeAreaView style={{ flex: 1 }}>
                  {/* Progress Indicator */}
                  <View style={{ height: 3, backgroundColor: 'rgba(255,255,255,0.25)', marginHorizontal: 16, marginTop: Platform.OS === 'ios' ? 10 : 30, borderRadius: 2, overflow: 'hidden' }}>
                    <Animated.View style={{ height: '100%', backgroundColor: '#FFF', width: progressAnim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) }} />
                  </View>

                  {/* Header Row */}
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, marginTop: 16 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                      <Image
                        source={{ uri: getAvatarUrl(activeStatusView.profileImage, activeStatusView.friendId || 'self') }}
                        style={{ width: 36, height: 36, borderRadius: 18, borderWidth: 1.5, borderColor: '#FFF' }}
                      />
                      <View>
                        <Text style={{ color: '#FFF', fontWeight: '800', fontSize: 14 }}>{activeStatusView.name}</Text>
                        <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 11 }}>TRANSMITTING LIVE</Text>
                      </View>
                    </View>
                    
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                      {activeStatusView.isSelf && (
                        <>
                          <TouchableOpacity
                            onPress={() => {
                              setActiveStatusView(null);
                              setStatusText(user?.statusText || '');
                              setStatusEmoji(user?.statusEmoji || '');
                              setShowStatusModal(true);
                            }}
                            style={{ padding: 8, backgroundColor: 'rgba(255, 255, 255, 0.2)', borderRadius: 16, marginRight: 6 }}
                          >
                            <Text style={{ color: '#FFF', fontSize: 11, fontWeight: '700' }}>✏️ Edit</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            onPress={async () => {
                              setActiveStatusView(null);
                              try {
                                const res = await apiFetch(`${API_URL}/api/friends/status`, {
                                  method: 'PUT',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ statusText: '', statusEmoji: '' })
                                });
                                if (res.ok) {
                                  await refreshUser();
                                  loadFriendsData();
                                  Alert.alert('Status Deleted', 'Your status has been cleared.');
                                }
                              } catch (err) {
                                console.error(err);
                              }
                            }}
                            style={{ padding: 8, backgroundColor: 'rgba(255, 0, 0, 0.25)', borderRadius: 16 }}
                          >
                            <Text style={{ color: '#FF7B7B', fontSize: 11, fontWeight: '700' }}>🗑️ Delete</Text>
                          </TouchableOpacity>
                        </>
                      )}
                      <TouchableOpacity onPress={() => setActiveStatusView(null)} style={{ padding: 8, backgroundColor: 'rgba(0,0,0,0.3)', borderRadius: 20 }}>
                        <Text style={{ color: '#FFF', fontSize: 14, fontWeight: '700' }}>✕ Close</Text>
                      </TouchableOpacity>
                    </View>
                  </View>

                  {/* Center Content: Status Text & Emoji */}
                  <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 30 }}>
                    {activeStatusView.statusEmoji ? (
                      <Text style={{ fontSize: 72, marginBottom: 20 }}>{activeStatusView.statusEmoji}</Text>
                    ) : null}
                    <Text style={{ color: '#FFF', fontSize: 26, fontWeight: '900', textAlign: 'center', lineHeight: 36, letterSpacing: 0.5, textShadowColor: 'rgba(0,0,0,0.25)', textShadowOffset: { width: 1, height: 2 }, textShadowRadius: 6 }}>
                      {activeStatusView.statusText || 'No transmission.'}
                    </Text>
                  </View>

                  {/* Footer message indicator or Seen By list */}
                  {!activeStatusView.isSelf ? (
                    <TouchableOpacity
                      onPress={() => {
                        setActiveStatusView(null);
                        setActiveChat(activeStatusView);
                      }}
                      style={{ padding: 16, backgroundColor: 'rgba(255,255,255,0.12)', margin: 20, borderRadius: 20, alignItems: 'center' }}
                    >
                      <Text style={{ color: '#FFF', fontWeight: '800', fontSize: 13 }}>💬 Send Encrypted Message</Text>
                    </TouchableOpacity>
                  ) : (() => {
                    const seenBy = user?.statusSeenBy || [];
                    const seenNames = seenBy
                      .map(id => friends.find(f => f.friendId === id)?.name)
                      .filter(Boolean);
                    if (seenNames.length === 0) {
                      return (
                        <View style={{ padding: 16, backgroundColor: 'rgba(255,255,255,0.08)', margin: 20, borderRadius: 20, alignItems: 'center' }}>
                          <Text style={{ color: 'rgba(255,255,255,0.6)', fontWeight: '600', fontSize: 13 }}>👁️ No views yet</Text>
                        </View>
                      );
                    }
                    return (
                      <View style={{ padding: 16, backgroundColor: 'rgba(255,255,255,0.12)', margin: 20, borderRadius: 20 }}>
                        <Text style={{ color: '#FFF', fontWeight: '800', fontSize: 11, letterSpacing: 1, marginBottom: 6 }}>👁️ SEEN BY ({seenNames.length})</Text>
                        <Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: 13, lineHeight: 18 }}>
                          {seenNames.join(', ')}
                        </Text>
                      </View>
                    );
                  })()}
                </SafeAreaView>
              </LinearGradient>
            </View>
          );
        })()}
      </Modal>
    </SafeAreaView>
  );
}

// Custom StatusBarBackground to handle spacing on Android/iOS
function StatusBarBackground() {
  return (
    <View style={{ height: Platform.OS === 'ios' ? 44 : (StatusBar.currentHeight || 24), backgroundColor: GRAPHITE_BG }} />
  );
}

const s = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: GRAPHITE_BG
  },
  topHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'ios' ? 12 : 38,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.05)'
  },
  backButton: {
    paddingVertical: 6,
  },
  backText: {
    color: '#FFF',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1.2
  },
  syncButtonTrigger: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: 'rgba(110, 91, 255, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(110, 91, 255, 0.3)'
  },
  syncButtonText: {
    color: VIOLET_ACCENT,
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1
  },
  storiesWrapper: {
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.05)',
    backgroundColor: '#07090C'
  },
  storiesScrollContent: {
    paddingHorizontal: 16,
    gap: 16
  },
  storyItem: {
    alignItems: 'center',
    width: 68
  },
  storyAvatarOutline: {
    width: 58,
    height: 58,
    borderRadius: 29,
    padding: 2,
    justifyContent: 'center',
    alignItems: 'center'
  },
  storyUserOutline: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    borderStyle: 'dashed'
  },
  storyAvatar: {
    width: '100%',
    height: '100%',
    borderRadius: 27,
    backgroundColor: '#13161C'
  },
  storyUserAddBadge: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    backgroundColor: '#6E5BFF',
    borderRadius: 10,
    width: 20,
    height: 20,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#07090C'
  },
  storyUserAddText: {
    color: '#FFF',
    fontSize: 10,
    fontWeight: '900'
  },
  storyEmojiBadge: {
    position: 'absolute',
    bottom: 12,
    right: 2,
    backgroundColor: '#1E232E',
    borderWidth: 1.5,
    borderColor: '#6E5BFF',
    borderRadius: 10,
    paddingHorizontal: 3,
    paddingVertical: 1,
    elevation: 3
  },
  storyEmojiBadgeText: {
    fontSize: 10
  },
  storyName: {
    color: '#8A94A6',
    fontSize: 9,
    fontWeight: '800',
    marginTop: 6,
    textAlign: 'center',
    width: 68
  },
  chatListWrapper: {
    flex: 1,
    backgroundColor: '#07090C'
  },
  chatListHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.03)'
  },
  chatListTitle: {
    color: '#FFF',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1.2
  },
  pendingBannerBadge: {
    backgroundColor: 'rgba(110, 91, 255, 0.15)',
    borderWidth: 1,
    borderColor: '#6E5BFF',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8
  },
  pendingBannerBadgeText: {
    color: '#6E5BFF',
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 0.5
  },
  chatListItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.02)'
  },
  chatListAvatarContainer: {
    position: 'relative'
  },
  chatListAvatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: '#13161C'
  },
  chatListEmojiBadge: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    backgroundColor: '#1E232E',
    borderRadius: 10,
    width: 18,
    height: 18,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#07090C'
  },
  chatListMiddle: {
    flex: 1,
    marginLeft: 16
  },
  chatListNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8
  },
  chatListFriendName: {
    color: '#FFF',
    fontSize: 13,
    fontWeight: '800'
  },
  chatListStreakText: {
    color: '#FF7A59',
    fontSize: 10,
    fontWeight: '900'
  },
  chatListStatusText: {
    color: '#8A94A6',
    fontSize: 10.5,
    fontWeight: '600',
    marginTop: 4
  },
  chatListRight: {
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    height: 40
  },
  chatListTimeText: {
    color: '#8A94A6',
    fontSize: 9,
    fontWeight: '800'
  },
  themeDotIndicator: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginTop: 8
  },
  emptyChatListContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: 80
  },
  emptyChatListTitle: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: '900',
    marginBottom: 4
  },
  emptyChatListSub: {
    color: '#8A94A6',
    fontSize: 10.5,
    textAlign: 'center',
    paddingHorizontal: 40,
    lineHeight: 14
  },
  modalContainer: {
    flex: 1,
    justifyContent: 'flex-end'
  },
  bottomSheetDimmer: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0, 0, 0, 0.6)'
  },
  bottomSheetContent: {
    height: '84%',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingTop: 8,
    overflow: 'hidden'
  },
  bottomSheetGrabHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    alignSelf: 'center',
    marginBottom: 10
  },
  chatHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.05)'
  },
  chatHeaderActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8
  },
  friendProfileSection: {
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.04)',
    backgroundColor: 'rgba(0, 0, 0, 0.1)'
  },
  friendNameInfo: {
    alignItems: 'center',
    marginBottom: 8
  },
  nameEditRowInline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    width: '100%',
    paddingHorizontal: 8,
    marginBottom: 8
  },
  chatCloseBtn: {
    paddingVertical: 6,
    paddingHorizontal: 8
  },
  chatCloseText: {
    color: '#8A94A6',
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 0.5
  },
  chatHeaderTitleContainer: {
    alignItems: 'center',
    flex: 1
  },
  chatHeaderTitleContainerInline: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 8,
    marginHorizontal: 8
  },
  nameEditRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4
  },
  nicknameInputField: {
    flex: 1,
    height: 38,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 8,
    paddingHorizontal: 10,
    color: '#FFF',
    fontSize: 15,
    fontWeight: '700'
  },
  nicknameSaveBtn: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    backgroundColor: VIOLET_ACCENT,
    borderRadius: 6
  },
  nicknameSaveBtnText: {
    color: '#FFF',
    fontSize: 13,
    fontWeight: '900'
  },
  nicknameCancelBtn: {
    padding: 6
  },
  nicknameCancelBtnText: {
    color: '#8A94A6',
    fontSize: 15,
    fontWeight: '900'
  },
  chatHeaderTitle: {
    color: '#FFF',
    fontSize: 18,
    fontWeight: '900',
    fontFamily: Platform.OS === 'ios' ? 'Georgia' : 'serif',
    letterSpacing: 0.5
  },
  toastBannerContainer: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 50 : 44,
    left: 16,
    right: 16,
    zIndex: 999
  },
  toastBannerGradient: {
    backgroundColor: '#1C222D',
    borderWidth: 1,
    borderColor: VIOLET_ACCENT,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    shadowColor: VIOLET_ACCENT,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 10
  },
  toastTitleText: {
    color: VIOLET_ACCENT,
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1.2,
    marginBottom: 2
  },
  toastBodyText: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: '700'
  },
  nudgeActionBtn: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(255, 122, 89, 0.2)',
    borderWidth: 1,
    borderColor: EMBER_ORANGE,
    borderRadius: 6,
    marginLeft: 6
  },
  nudgeActionText: {
    color: EMBER_ORANGE,
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 0.5
  },
  removeActionBtn: {
    padding: 4,
    marginLeft: 4
  },
  removeActionText: {
    fontSize: 16
  },
  chatHeaderSubtitle: {
    color: '#8A94A6',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1.5,
    marginTop: 1
  },
  themeDotsRow: {
    flexDirection: 'row',
    gap: 4
  },
  themeDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    opacity: 0.5
  },
  activeThemeDot: {
    opacity: 1,
    borderWidth: 1.5,
    borderColor: '#FFF'
  },
  streakBanner: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    backgroundColor: 'rgba(0,0,0,0.1)'
  },
  streakBannerText: {
    color: EMBER_ORANGE,
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 0.5
  },
  streakBannerSub: {
    color: '#6E5BFF',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0.5
  },
  monoText: {
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    fontWeight: '900'
  },
  messagesScrollView: {
    flex: 1
  },
  messagesEmptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60
  },
  emptySymbol: {
    fontSize: 48,
    marginBottom: 8
  },
  emptyInstruction: {
    color: '#8A94A6',
    fontSize: 13,
    fontWeight: '800'
  },
  msgRow: {
    flexDirection: 'row',
    marginBottom: 14,
    alignItems: 'flex-end',
    maxWidth: '85%'
  },
  msgRowMe: {
    alignSelf: 'flex-end',
    flexDirection: 'row-reverse'
  },
  msgRowThem: {
    alignSelf: 'flex-start'
  },
  msgAvatarCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 6
  },
  msgAvatarInitials: {
    color: '#FFF',
    fontSize: 11,
    fontWeight: '900'
  },
  msgBubble: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 16
  },
  msgBubbleMe: {
    borderBottomRightRadius: 2
  },
  msgBubbleThem: {
    backgroundColor: '#1E222B',
    borderBottomLeftRadius: 2
  },
  msgBodyText: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '600'
  },
  msgBodyTextMe: {
    color: '#FFF'
  },
  msgBodyTextThem: {
    color: '#E4E7EB'
  },
  stickerMessageContainer: {
    padding: 2
  },
  stickerMessageChar: {
    fontSize: 48
  },
  stickerSelectionPanel: {
    backgroundColor: 'rgba(0,0,0,0.15)',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.04)',
    paddingVertical: 12
  },
  stickerHorizontalScroll: {
    paddingHorizontal: 16,
    gap: 12
  },
  stickerBubbleBtn: {
    width: 50,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.04)',
    alignItems: 'center',
    justifyContent: 'center'
  },
  chatInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === 'ios' ? 16 : 10,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.05)',
    backgroundColor: 'rgba(0,0,0,0.2)'
  },
  stickerTriggerButton: {
    padding: 6,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.04)',
    marginRight: 8
  },
  stickerTriggerButtonActive: {
    backgroundColor: 'rgba(110, 91, 255, 0.2)'
  },
  chatTextInputField: {
    flex: 1,
    height: 44,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 12,
    paddingHorizontal: 12,
    color: '#FFF',
    fontSize: 14,
    fontWeight: '700'
  },
  sendMessageBtn: {
    height: 44,
    paddingHorizontal: 16,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 8
  },
  sendMessageBtnText: {
    color: '#000',
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 0.5
  },
  syncModalContainer: {
    flex: 1
  },
  syncModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'ios' ? 12 : 38,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.05)'
  },
  syncModalTitle: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: 1.5
  },
  syncModalCloseBtn: {
    padding: 6
  },
  syncModalCloseText: {
    color: '#8A94A6',
    fontSize: 13,
    fontWeight: '900'
  },
  searchBarContainer: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    position: 'relative',
    justifyContent: 'center'
  },
  searchBarInput: {
    backgroundColor: '#13161C',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    color: '#FFF',
    fontSize: 15,
    fontWeight: '700'
  },
  searchClearBtn: {
    position: 'absolute',
    right: 28,
    padding: 6
  },
  searchClearText: {
    color: '#8A94A6',
    fontSize: 13,
    fontWeight: '900'
  },
  syncPromptBox: {
    padding: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#13161C',
    marginHorizontal: 16,
    marginVertical: 8,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.04)'
  },
  syncPromptText: {
    color: '#8A94A6',
    fontSize: 12,
    textAlign: 'center',
    marginBottom: 12,
    lineHeight: 16
  },
  primarySyncBtn: {
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 12,
    width: '100%',
    alignItems: 'center'
  },
  primarySyncBtnText: {
    color: '#FFF',
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 1
  },
  syncedContactsTitle: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1.2,
    marginBottom: 12
  },
  contactItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.04)'
  },
  contactAvatarCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(110, 91, 255, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(110, 91, 255, 0.2)'
  },
  contactAvatarInitials: {
    color: VIOLET_ACCENT,
    fontSize: 15,
    fontWeight: '900'
  },
  contactItemName: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: '800'
  },
  contactItemPhone: {
    color: '#8A94A6',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 2
  },
  contactAddBtn: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: VIOLET_ACCENT
  },
  contactAddBtnText: {
    color: VIOLET_ACCENT,
    fontSize: 12,
    fontWeight: '900'
  },
  contactPendingLabel: {
    color: '#8A94A6',
    fontSize: 12,
    fontWeight: '900'
  },
  contactFriendLabel: {
    color: EMBER_ORANGE,
    fontSize: 12,
    fontWeight: '900'
  },
  centerStatusBubble: {
    position: 'absolute',
    top: -8,
    right: -8,
    backgroundColor: '#1E232E',
    borderWidth: 2,
    borderColor: '#6E5BFF',
    borderRadius: 12,
    paddingHorizontal: 6,
    paddingVertical: 2,
    shadowColor: '#6E5BFF',
    shadowOpacity: 0.8,
    shadowRadius: 6,
    elevation: 4
  },
  friendStatusBubble: {
    position: 'absolute',
    top: -6,
    right: -6,
    backgroundColor: '#1E232E',
    borderWidth: 1.5,
    borderColor: '#6E5BFF',
    borderRadius: 10,
    paddingHorizontal: 4,
    paddingVertical: 1,
    zIndex: 10
  },
  statusBubbleEmoji: {
    fontSize: 12
  },
  chatInputTopAccessory: {
    width: '100%',
    paddingHorizontal: 16,
    paddingBottom: 8,
    alignItems: 'flex-start'
  },
  typingIndicatorWrap: {
    backgroundColor: 'rgba(110, 91, 255, 0.1)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(110, 91, 255, 0.3)'
  },
  typingIndicatorText: {
    color: '#6E5BFF',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.5,
    fontStyle: 'italic'
  },
  quickReactionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12
  },
  quickReactionBtn: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    padding: 6,
    borderRadius: 16
  },
  quickReactionEmoji: {
    fontSize: 16
  },
  statusEmojiInput: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 12,
    padding: 12,
    fontSize: 24,
    color: '#FFF',
    width: 60,
    textAlign: 'center'
  },
  statusTextInput: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 12,
    padding: 16,
    fontSize: 14,
    color: '#FFF'
  },
  saveStatusBtn: {
    backgroundColor: '#6E5BFF',
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 24
  },
  saveStatusBtnText: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1
  },
  gameCard: {
    padding: 14,
    borderRadius: 16,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    maxWidth: '75%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 3,
    marginVertical: 4
  },
  gameCardTag: {
    color: 'rgba(255, 255, 255, 0.7)',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1,
    marginBottom: 4
  },
  gameCardQuestion: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: '800',
    lineHeight: 18,
    fontStyle: 'italic'
  }
});
