import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import {
  PhoneOff,
  Phone,
  Mic,
  MicOff,
  Video,
  VideoOff,
  ShieldCheck,
  User,
  AlertTriangle,
} from '../../../components/lucide';
import * as Haptics from 'expo-haptics';
import { CampusColors } from '../../../constants/campusTheme';
import { connectCampusSocket } from '../campusSocketClient';
import { WEBRTC_CALL_HTML } from '../webrtcCallHtml';

export type CampusCallRole = 'caller' | 'callee';

export interface CampusCallSession {
  chatId: string;
  peerName: string;
  callType: 'voice' | 'video';
  role: CampusCallRole;
  callId?: string;
}

export interface IncomingCampusCall {
  callId: string;
  chatId: string;
  chatName: string;
  callType: 'voice' | 'video';
  callerId: string;
  callerName: string;
}

interface CampusCallModalProps {
  visible: boolean;
  onClose: () => void;
  session: CampusCallSession;
}

type CallFailure = { kind: 'permission' | 'network' | 'remote'; message: string };

const classifyMediaError = (raw?: string): CallFailure => {
  const m = String(raw || '');
  if (/permission|notallowed|denied|not allowed|notfound|could not start|notreadable/i.test(m)) {
    return {
      kind: 'permission',
      message: 'ZENV needs microphone (and camera for video) access to make calls. Allow it in Settings and try again.',
    };
  }
  return {
    kind: 'network',
    message: "Couldn't connect the call. Check your internet connection and try again.",
  };
};

export const IncomingCampusCallOverlay: React.FC<{
  incoming: IncomingCampusCall;
  onAccept: () => void;
  onDecline: () => void;
}> = ({ incoming, onAccept, onDecline }) => (
  <Modal visible animationType="fade" transparent onRequestClose={onDecline}>
    <View style={styles.incomingWrap}>
      <Text style={styles.incomingType}>
        {incoming.callType === 'video' ? 'Campus video call' : 'Campus voice call'}
      </Text>
      <Text style={styles.incomingName}>{incoming.callerName}</Text>
      <Text style={styles.incomingHint}>Encrypted campus call</Text>
      <View style={styles.incomingAvatar}>
        <User size={48} color="#FFFFFF" />
      </View>
      <View style={styles.incomingActions}>
        <TouchableOpacity
          style={[styles.incomingBtn, { backgroundColor: CampusColors.sos }]}
          onPress={onDecline}
        >
          <PhoneOff size={26} color="#FFFFFF" />
          <Text style={styles.incomingBtnText}>Decline</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.incomingBtn, { backgroundColor: '#16A34A' }]}
          onPress={onAccept}
        >
          <Phone size={26} color="#FFFFFF" />
          <Text style={styles.incomingBtnText}>Accept</Text>
        </TouchableOpacity>
      </View>
    </View>
  </Modal>
);

export const CampusCallModal: React.FC<CampusCallModalProps> = ({
  visible,
  onClose,
  session,
}) => {
  const { chatId, peerName, callType, role } = session;
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOn, setIsVideoOn] = useState(callType === 'video');
  const [seconds, setSeconds] = useState(0);
  const [callStatus, setCallStatus] = useState<'Connecting...' | 'Ringing...' | 'Connected' | string>(
    role === 'caller' ? 'Connecting...' : 'Connecting...'
  );
  const [failure, setFailure] = useState<CallFailure | null>(null);
  const [mediaReady, setMediaReady] = useState(false);

  const webRef = useRef<WebView>(null);
  const callIdRef = useRef<string | null>(session.callId || null);
  const loadedRef = useRef(false);
  const queueRef = useRef<any[]>([]);
  const connectedRef = useRef(false);
  const endedRef = useRef(false);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const failCallRef = useRef<(f: CallFailure, notifyPeer?: boolean) => void>(() => {});

  const later = useCallback((fn: () => void, ms: number) => {
    const t = setTimeout(fn, ms);
    timersRef.current.push(t);
  }, []);

  const sendToWeb = useCallback((msg: any) => {
    if (!loadedRef.current) {
      queueRef.current.push(msg);
      return;
    }
    const js = `window.__fromRN && window.__fromRN(${JSON.stringify(msg)}); true;`;
    webRef.current?.injectJavaScript(js);
  }, []);

  const emitSignal = useCallback((payload: any) => {
    const callId = callIdRef.current;
    if (!callId) return;
    connectCampusSocket().emit('call:signal', { callId, payload });
  }, []);

  const closeLocal = useCallback(() => {
    if (endedRef.current) return;
    endedRef.current = true;
    sendToWeb({ cmd: 'hangup' });
    onClose();
  }, [onClose, sendToWeb]);

  const hangup = useCallback(
    (notify = true) => {
      if (endedRef.current) return;
      const callId = callIdRef.current;
      if (notify && callId) {
        connectCampusSocket().emit('call:end', { callId });
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      closeLocal();
    },
    [closeLocal]
  );
  const hangupRef = useRef(hangup);
  hangupRef.current = hangup;

  useEffect(() => {
    if (!visible) return;
    endedRef.current = false;
    connectedRef.current = false;
    loadedRef.current = false;
    queueRef.current = [];
    setSeconds(0);
    setFailure(null);
    setMediaReady(false);
    setCallStatus('Connecting...');
    callIdRef.current = session.callId || null;

    const socket = connectCampusSocket();

    const onAccepted = (data: { callId: string; userName?: string }) => {
      if (data.callId !== callIdRef.current) return;
      setCallStatus('Connecting...');
      sendToWeb({ cmd: 'create-offer' });
    };
    const onRejected = (data: { callId: string; reason?: string }) => {
      if (data.callId !== callIdRef.current) return;
      setCallStatus(data.reason === 'busy' ? `${peerName} is on another call` : 'Call declined');
      later(() => hangupRef.current(false), 1400);
    };
    const onEnded = (data: { callId: string; reason?: string }) => {
      if (data.callId !== callIdRef.current) return;
      // Tell the caller why an unanswered call stopped instead of just closing.
      const why = data.reason === 'missed' ? 'No answer'
        : data.reason === 'busy' ? `${peerName} is on another call`
        : data.reason === 'declined' ? 'Call declined'
        : null;
      if (why) {
        setCallStatus(why);
        later(() => hangupRef.current(false), 1400);
        return;
      }
      hangupRef.current(false);
    };
    const onSignal = (data: { callId: string; payload: any }) => {
      if (data.callId !== callIdRef.current || !data.payload) return;
      const p = data.payload;
      if (p.type === 'fallback-jitsi' || p.type === 'failed') {
        // The other side could not set up the call (older app versions send 'fallback-jitsi').
        failCallRef.current({ kind: 'remote', message: `${peerName} couldn't connect to the call. Please try again.` }, false);
        return;
      }
      if (p.type === 'offer') sendToWeb({ cmd: 'remote-offer', sdp: p.sdp });
      if (p.type === 'answer') sendToWeb({ cmd: 'remote-answer', sdp: p.sdp });
      if (p.type === 'ice') sendToWeb({ cmd: 'ice', candidate: p.candidate });
    };

    socket.on('call:accepted', onAccepted);
    socket.on('call:rejected', onRejected);
    socket.on('call:ended', onEnded);
    socket.on('call:signal', onSignal);

    if (role === 'caller') {
      sendToWeb({ cmd: 'start', role: 'prepare', video: callType === 'video' });
      socket.emit('call:invite', { chatId, callType }, (res: any) => {
        if (endedRef.current) {
          if (res?.callId) socket.emit('call:end', { callId: res.callId });
          return;
        }
        if (res?.error) {
          setCallStatus(typeof res.error === 'string' ? res.error : "Couldn't start the call");
          later(() => hangupRef.current(false), 1600);
          return;
        }
        callIdRef.current = res.callId;
        setCallStatus('Ringing...');
      });
    } else if (session.callId) {
      socket.emit('call:accept', { callId: session.callId }, (res: any) => {
        if (endedRef.current) return;
        if (res?.error) {
          setCallStatus(typeof res.error === 'string' ? res.error : 'This call has ended');
          later(() => hangupRef.current(false), 1600);
          return;
        }
        sendToWeb({ cmd: 'start', role: 'answer', video: callType === 'video' });
      });
    }

    const interval = setInterval(() => {
      setSeconds((s) => (connectedRef.current ? s + 1 : s));
    }, 1000);

    return () => {
      clearInterval(interval);
      timersRef.current.forEach(clearTimeout);
      timersRef.current = [];
      socket.off('call:accepted', onAccepted);
      socket.off('call:rejected', onRejected);
      socket.off('call:ended', onEnded);
      socket.off('call:signal', onSignal);
    };
  }, [visible, chatId, callType, role, session.callId, sendToWeb, later, peerName]);

  /** Stop the call on both ends but keep the screen open so the user sees why. */
  const failCall = useCallback(
    (f: CallFailure, notifyPeer = true) => {
      if (endedRef.current) return;
      endedRef.current = true;
      const callId = callIdRef.current;
      if (callId) {
        if (notifyPeer) emitSignal({ type: 'failed' });
        connectCampusSocket().emit('call:end', { callId });
      }
      sendToWeb({ cmd: 'hangup' });
      connectedRef.current = false;
      setFailure(f);
      setCallStatus(f.kind === 'permission' ? 'Microphone access needed' : 'Call failed');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    },
    [emitSignal, sendToWeb]
  );
  failCallRef.current = failCall;

  const onWebMessage = (event: any) => {
    try {
      const msg = JSON.parse(event.nativeEvent.data);
      if (msg.type === 'ready') setMediaReady(true);
      if (msg.type === 'offer') emitSignal({ type: 'offer', sdp: msg.sdp });
      if (msg.type === 'answer') emitSignal({ type: 'answer', sdp: msg.sdp });
      if (msg.type === 'ice') emitSignal({ type: 'ice', candidate: msg.candidate });
      if (msg.type === 'state' && msg.state === 'connected') {
        connectedRef.current = true;
        setCallStatus('Connected');
      }
      if (msg.type === 'error') {
        failCall(classifyMediaError(msg.message));
      }
    } catch {
      // ignore
    }
  };

  const handleEndCall = () => {
    if (failure) {
      onClose();
      return;
    }
    hangup(true);
  };

  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  const timeStr = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;


  return (
    <Modal visible={visible} animationType="slide" onRequestClose={handleEndCall}>
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <View style={styles.topInfo}>
          <View style={styles.encryptBadge}>
            <ShieldCheck size={12} color="#FFFFFF" />
            <Text style={styles.encryptText}>Encrypted call</Text>
          </View>
          <Text style={styles.peerName}>{peerName}</Text>
          <Text style={styles.statusText}>
            {callStatus === 'Connected' ? timeStr : callStatus}
          </Text>
        </View>

        <View style={styles.mediaArea}>
          <WebView
              ref={webRef}
              originWhitelist={['*']}
              source={{ html: WEBRTC_CALL_HTML, baseUrl: 'https://localhost' }}
              style={styles.webview}
              allowsInlineMediaPlayback
              mediaPlaybackRequiresUserAction={false}
              mediaCapturePermissionGrantType="grant"
              javaScriptEnabled
              domStorageEnabled
              allowsFullscreenVideo
              mixedContentMode="always"
              onLoadEnd={() => {
                loadedRef.current = true;
                queueRef.current.forEach((m) => sendToWeb(m));
                queueRef.current = [];
              }}
              onMessage={onWebMessage}
            />
          {(!mediaReady || callStatus !== 'Connected' || !!failure) && (
            <View style={styles.centerOverlay} pointerEvents="none">
              <View style={styles.avatarCircle}>
                <User size={64} color="#FFFFFF" />
              </View>
              <Text style={styles.campusTag}>
                {callType === 'video' ? 'Video call' : 'Voice call'}
              </Text>
            </View>
          )}
          {!!failure && (
            <View style={styles.failurePanel}>
              <AlertTriangle size={28} color="#FBBF24" />
              <Text style={styles.failureText}>{failure.message}</Text>
              <View style={styles.failureActions}>
                {failure.kind === 'permission' && (
                  <TouchableOpacity
                    style={[styles.failureBtn, { backgroundColor: CampusColors.accent }]}
                    onPress={() => Linking.openSettings().catch(() => {})}
                  >
                    <Text style={styles.failureBtnText}>Open Settings</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity style={styles.failureBtn} onPress={onClose}>
                  <Text style={styles.failureBtnText}>Close</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>

        <View style={styles.controlsBar}>
          <TouchableOpacity
            style={[styles.controlBtn, isMuted && styles.controlBtnActive]}
            disabled={!!failure}
            onPress={() => {
              Haptics.selectionAsync();
              const next = !isMuted;
              setIsMuted(next);
              sendToWeb({ cmd: 'mute', muted: next });
            }}
          >
            {isMuted ? <MicOff size={24} color="#FFFFFF" /> : <Mic size={24} color="#FFFFFF" />}
            <Text style={styles.controlLabel}>{isMuted ? 'Unmute' : 'Mute'}</Text>
          </TouchableOpacity>

          {callType === 'video' && (
          <TouchableOpacity
            style={[styles.controlBtn, !isVideoOn && styles.controlBtnActive]}
            disabled={!!failure}
            onPress={() => {
              Haptics.selectionAsync();
              const next = !isVideoOn;
              setIsVideoOn(next);
              sendToWeb({ cmd: 'video', on: next });
            }}
          >
            {isVideoOn ? <Video size={24} color="#FFFFFF" /> : <VideoOff size={24} color="#FFFFFF" />}
            <Text style={styles.controlLabel}>{isVideoOn ? 'Camera' : 'Camera off'}</Text>
          </TouchableOpacity>
          )}
        </View>

        <View style={styles.endCallWrap}>
          <TouchableOpacity
            style={styles.endCallBtn}
            onPress={handleEndCall}
            accessibilityLabel={failure ? 'Close' : 'End call'}
          >
            <PhoneOff size={32} color="#FFFFFF" />
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F172A',
    justifyContent: 'space-between',
    paddingVertical: 16,
  },
  topInfo: {
    alignItems: 'center',
    paddingTop: 8,
    gap: 8,
    zIndex: 4,
  },
  encryptBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 5,
  },
  encryptText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
  peerName: {
    fontSize: 26,
    fontWeight: '800',
    color: '#FFFFFF',
    marginTop: 6,
  },
  statusText: {
    fontSize: 15,
    color: '#94A3B8',
    fontWeight: '600',
  },
  mediaArea: {
    flex: 1,
    marginHorizontal: 12,
    marginVertical: 12,
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: '#020617',
  },
  webview: {
    flex: 1,
    backgroundColor: '#0F172A',
  },
  centerOverlay: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  avatarCircle: {
    width: 128,
    height: 128,
    borderRadius: 64,
    backgroundColor: CampusColors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 4,
    borderColor: 'rgba(255, 255, 255, 0.15)',
  },
  campusTag: {
    fontSize: 13,
    color: '#64748B',
    fontWeight: '600',
  },
  failurePanel: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(2, 6, 23, 0.92)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 28,
    gap: 14,
  },
  failureText: {
    color: '#E2E8F0',
    fontSize: 15,
    fontWeight: '600',
    textAlign: 'center',
    lineHeight: 21,
  },
  failureActions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 4,
  },
  failureBtn: {
    paddingHorizontal: 20,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  failureBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 14,
  },
  controlsBar: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 32,
  },
  controlBtn: {
    width: 64,
    height: 72,
    borderRadius: 18,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  controlBtnActive: {
    backgroundColor: 'rgba(255, 255, 255, 0.35)',
  },
  controlLabel: {
    fontSize: 12,
    color: '#FFFFFF',
    fontWeight: '600',
  },
  endCallWrap: {
    alignItems: 'center',
    paddingTop: 16,
  },
  endCallBtn: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: CampusColors.sos,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  incomingWrap: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.96)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 10,
  },
  incomingType: {
    color: '#94A3B8',
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
    fontSize: 12,
  },
  incomingName: {
    color: '#FFFFFF',
    fontSize: 28,
    fontWeight: '800',
  },
  incomingHint: {
    color: '#64748B',
    fontSize: 13,
    fontWeight: '600',
  },
  incomingAvatar: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: CampusColors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 28,
  },
  incomingActions: {
    flexDirection: 'row',
    gap: 28,
  },
  incomingBtn: {
    width: 96,
    height: 96,
    borderRadius: 48,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  incomingBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 12,
  },
});
