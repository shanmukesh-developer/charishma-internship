"use client";
import { useState, useEffect, useRef } from 'react';
import { Socket } from 'socket.io-client';

interface Message {
  sender: string;
  senderRole: 'rider' | 'customer';
  message: string;
  timestamp: Date;
}

interface Props {
  orderId: string;
  userName: string;
  userRole: 'rider' | 'customer';
  socket: Socket;
  isOpen: boolean;
  onClose: () => void;
}

const QUICK_REPLIES = {
  rider: [
    "On my way to pick up the order! 🏍️",
    "Picked up your order, heading to you now! 🚀",
    "I have reached the hostel gate/block. Please come down. 🛎️",
    "Almost there, 2 minutes away! ⏳",
    "I am waiting near the entrance. 🏫"
  ],
  customer: [
    "Got it, coming down in 2 mins! 🏃‍♂️",
    "Please leave it with the gate warden/security. 🛡️",
    "Please leave it outside my room door. 🛏️",
    "Thanks, on my way! 🙌",
    "Please call me when you reach the gate. 📞"
  ]
};

export default function ChatDrawer({ orderId, userName, userRole, socket, isOpen, onClose }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [remoteTyping, setRemoteTyping] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const replies = QUICK_REPLIES[userRole] || [];

  useEffect(() => {
    if (!socket || !orderId) return;

    const handleMessage = (msg: Message) => {
      setMessages(prev => [...prev, msg]);
    };

    socket.on('receiveMessage', handleMessage);

    socket.on('typing_start', (data: { sender: string }) => {
      if (data.sender !== userName) setRemoteTyping(true);
    });
    socket.on('typing_end', (data: { sender: string }) => {
      if (data.sender !== userName) setRemoteTyping(false);
    });

    return () => {
      socket.off('receiveMessage', handleMessage);
      socket.off('typing_start');
      socket.off('typing_end');
    };
  }, [socket, orderId, userName]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSendMessage = () => {
    if (!inputValue.trim() || !socket || !orderId) return;
    const messageData = {
      orderId,
      sender: userName,
      senderRole: userRole,
      message: inputValue.trim()
    };
    socket.emit('sendMessage', messageData);
    socket.emit('typing_end', { orderId, sender: userName });
    setInputValue('');
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputValue(e.target.value);
    if (!socket || !orderId) return;
    socket.emit('typing_start', { orderId, sender: userName });
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      socket.emit('typing_end', { orderId, sender: userName });
    }, 1500);
  };

  return (
    <div className={`fixed inset-0 z-[100] flex items-end justify-center bg-black/60 backdrop-blur-sm transition-all duration-300 ${
      isOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
    }`}>
      <div className={`w-full max-w-lg bg-[#11111A] border-t sm:border border-white/10 rounded-t-[32px] sm:rounded-b-[32px] h-[80vh] flex flex-col shadow-2xl transition-all duration-300 ${
        isOpen ? 'translate-y-0' : 'translate-y-full'
      }`}>
        {/* Header */}
        <div className="p-6 border-b border-white/5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-emerald-500/10 flex items-center justify-center text-xl">
              {userRole === 'customer' ? '🛵' : '👤'}
            </div>
            <div>
              <p className="text-[10px] text-emerald-500 uppercase font-black tracking-widest">Live Chat</p>
              <h3 className="text-white font-bold">{userRole === 'customer' ? 'Zenvy Captain' : 'Customer'}</h3>
            </div>
          </div>
          <button onClick={onClose} className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center text-gray-400 hover:text-white transition-colors text-xl font-bold">✕</button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4 scrollbar-hide">
          {messages.length === 0 && (
            <div className="text-center py-10">
              <div className="w-16 h-16 bg-white/5 rounded-full flex items-center justify-center text-2xl mx-auto mb-4 grayscale opacity-30">💬</div>
              <p className="text-gray-500 text-sm italic">Direct messages are masked for your privacy.</p>
            </div>
          )}
          {messages.map((msg, idx) => {
            const isMe = msg.sender === userName;
            return (
              <div key={idx} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[80%] p-4 rounded-2xl ${
                  isMe ? 'bg-emerald-600 text-white rounded-tr-none' : 'bg-white/10 text-gray-200 rounded-tl-none border border-white/5'
                }`}>
                  <p className="text-sm font-medium leading-relaxed">{msg.message}</p>
                  <p className="text-[8px] mt-1.5 opacity-50 font-bold uppercase tracking-widest">
                    {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
              </div>
            );
          })}
          {/* Typing Indicator */}
          {remoteTyping && (
            <div className="flex justify-start">
              <div className="bg-white/10 border border-white/5 px-5 py-3 rounded-2xl rounded-tl-none flex items-center gap-1.5">
                <span className="w-2 h-2 bg-emerald-400 rounded-full animate-bounce [animation-delay:0ms]"/>
                <span className="w-2 h-2 bg-emerald-400 rounded-full animate-bounce [animation-delay:150ms]"/>
                <span className="w-2 h-2 bg-emerald-400 rounded-full animate-bounce [animation-delay:300ms]"/>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="p-6 border-t border-white/5 bg-[#11111A]">
          {/* Quick Replies */}
          {replies.length > 0 && (
            <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-3 mb-1 -mx-2 px-2">
              {replies.map((reply, i) => (
                <button
                  key={i}
                  onClick={() => {
                    if (!socket || !orderId) return;
                    const messageData = {
                      orderId,
                      sender: userName,
                      senderRole: userRole,
                      message: reply
                    };
                    socket.emit('sendMessage', messageData);
                  }}
                  className="shrink-0 px-4 py-2 rounded-full bg-white/5 border border-white/10 hover:border-emerald-500/30 hover:bg-emerald-500/10 text-[10px] font-black uppercase tracking-wider text-slate-300 transition-all active:scale-95"
                >
                  {reply}
                </button>
              ))}
            </div>
          )}
          <div className="flex gap-3">
            <input
              type="text"
              value={inputValue}
              onChange={handleInputChange}
              onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
              placeholder="Type a message..."
              className="flex-1 px-5 py-4 bg-white/5 border border-white/10 rounded-2xl text-white outline-none focus:border-emerald-500/50 transition-all text-sm"
            />
            <button
              onClick={handleSendMessage}
              disabled={!inputValue.trim()}
              className="w-14 h-14 bg-emerald-600 hover:bg-emerald-500 disabled:bg-gray-700 rounded-2xl flex items-center justify-center text-xl transition-all shadow-lg shadow-emerald-900/20"
            >
              🚀
            </button>
          </div>
          <p className="text-center text-[8px] text-gray-600 font-bold uppercase tracking-widest mt-4">Powered by Zenvy Real-Time Engines</p>
        </div>
      </div>
    </div>
  );
}
